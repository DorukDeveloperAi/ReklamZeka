#!/usr/bin/env node
/**
 * Session hedef takibi hook'u.
 *
 * TodoWrite çağrılarının içeriğini (madde + durum) kalıcı bir hedef defterine
 * yazar: ~/.claude/kaptan/goals/<cwd-slug>/<session_id>.json
 * session-status'un aksine session bitince SİLİNMEZ — kaptan "başlattığımız
 * hedefleri tamamladık mı?" sorusunu bu dosyalardan cevaplar.
 *
 * Ayrıca PLAN BAĞI'nı kaydeder (2026-07-16): dispatcher (Maestro scheduler) bir /goal
 * işini ateşlerken Claude'un session_id'sini BİLEMEZ — onu Claude üretir. Ama planı
 * BİLİR (job.plan) ve `AIDE_PLAN_REF` env'i olarak spawn edilen pane'e geçirir. Env,
 * pane'den claude'a ve claude'un hook alt-süreçlerine miras kalır (ölçüldü) → bu hook
 * env'i KENDİ session_id'siyle eşleyip kalıcılaştırır:
 *   ~/.claude/kaptan/planref/<session_id>.json  {sessionId, cwd, planRef, jobId, ts}
 * Yük göstergesi (agent-ide core/src/gorev.ts) bunu OTORİTER kaynak sayar.
 * Env yoksa HİÇBİR ŞEY yazılmaz → bağ "yok"tur; uydurma yasak (kullanıcı kararı).
 *
 * STOP DALI (2026-07-29, seviye-0-otonomi/v1 aşama 04): açık iş bırakıp erken duran
 * oturumu deterministik olarak BİR KEZ geri çevirir — `{"decision":"block","reason":…}`
 * + exit 0. Sınıf: motor (LLM yok, 0 token); taşıyıcı: session-yerleşik (Claude Code'un
 * Stop olayı — `aide` şalterlerinden bağımsız). Kullanıcı kesmesi (Esc) bu olayı
 * TETİKLEMEZ (yapısal — issue #9516), yani "durdur" dediğinde hiçbir blok görmezsin.
 * Muafiyetler İLANLI: `SubagentStop` kapsam dışı; "açık iş"in TEK kaynağı bu deftere
 * yazılan todo'lar + `/goal` metni (oturum defteri/planref Stop'ta okunmaz).
 * Döngü kilidi üç katmanlı ve ŞÜPHE SERBEST BIRAKMA yönünedir: `stop_hook_active` ∧
 * aynı `prompt_id`'ye ikinci blok yok ∧ aynı açık-küme imzasına oturum başına tek blok.
 *
 * Usage (from settings.json hooks):
 *   node ~/.claude/hooks/goal-tracker.mjs todo          # PostToolUse, matcher TodoWrite
 *   node ~/.claude/hooks/goal-tracker.mjs session_start # SessionStart — plan bağı
 *   node ~/.claude/hooks/goal-tracker.mjs session_end   # SessionEnd
 *   node ~/.claude/hooks/goal-tracker.mjs prompt        # UserPromptSubmit — /goal kaydı
 *   node ~/.claude/hooks/goal-tracker.mjs stop          # Stop — erken durmayı geri çevir
 *
 * Designed to be safe + non-blocking (configured with "async": true). Any
 * failure exits 0 so it never disrupts the session.
 */

import { homedir } from "node:os";
import { join } from "node:path";
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  renameSync,
} from "node:fs";
import { createHash } from "node:crypto";

// KOŞUM DAMGASI (otonomi-merdiveni:02.3) — `aide otomasyon durum`un akıbet ekseni bunu okur.
// Dinamik import + try: damga yazarı yoksa ya da bozuksa hook KOŞMAYA DEVAM EDER; bir ölçüm
// aracı ölçtüğü şeyi asla bozamaz. Maliyet: bir dosya yazımı, 0 token.
try { (await import("./hook-nabiz.mjs")).nabiz("goal-tracker", process.argv[2]); } catch {}

const CLAUDE = join(homedir(), ".claude");
const GOALS_DIR = join(CLAUDE, "kaptan", "goals");
/** Plan bağı defteri — dispatcher'ın env'i × oturumun kendi session_id'si. */
const PLANREF_DIR = join(CLAUDE, "kaptan", "planref");
const ARCHIVE_DIR = join(GOALS_DIR, "_archive");
const STATUS_DIR = join(CLAUDE, "session-status");
/** Stop dalı ayarı — KULLANICI MALI: kit bu dosyayı DAĞITMAZ, yokluğu varsayılandır. */
const STOP_CFG = join(CLAUDE, "kaptan", "stop-dali.json");
const PRUNE_MS = 30 * 24 * 3600_000;
/** Reason gövdesinde listelenecek en fazla madde; fazlası "+N daha" olarak sayılır. */
const REASON_MAX_ITEM = 8;
/** Blok işaretinde saklanan imza tavanı (defter şişmesin; en yenisi sonda). */
const IMZA_TAVAN = 20;
const event = process.argv[2] || "";

const slugOf = (p) => String(p).replace(/[^A-Za-z0-9]/g, "-");

function readStdin() {
  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function safeParse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function loadJSON(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function atomicWrite(file, obj) {
  const tmp = `${file}.tmp-${process.pid}-${process.hrtime.bigint()}`;
  writeFileSync(tmp, JSON.stringify(obj, null, 1), { mode: 0o600 });
  renameSync(tmp, file);
}

function recount(todos) {
  const counts = { total: 0, completed: 0, in_progress: 0, pending: 0 };
  for (const t of todos) {
    if (t.removed) continue;
    counts.total++;
    if (counts[t.status] !== undefined) counts[t.status]++;
  }
  return counts;
}

// Aynı session farklı cwd'lerden yazmış olabilir (nadiren); dosyayı tüm slug
// dizinlerinde ara — todo modunda payload cwd'sinin slug'ı önceliklidir.
function findGoalFile(sessionId, preferredSlug) {
  const name = `${sessionId}.json`;
  const dirs = [];
  if (preferredSlug) dirs.push(preferredSlug);
  try {
    for (const d of readdirSync(GOALS_DIR)) if (d !== preferredSlug) dirs.push(d);
  } catch {
    /* goals dizini henüz yok */
  }
  for (const d of dirs) {
    const file = join(GOALS_DIR, d, name);
    if (loadJSON(file)) return file;
  }
  return null;
}

function handleTodo(payload, sessionId, now) {
  const todos = payload.tool_input?.todos;
  if (!Array.isArray(todos) || todos.length === 0) return;

  const cwd = payload.cwd || process.cwd();
  const slug = slugOf(cwd);
  const dir = join(GOALS_DIR, slug);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = join(dir, `${sessionId}.json`);

  const prev = loadJSON(file) || {
    sessionId,
    cwd,
    dirName: cwd.split("/").filter(Boolean).pop() || cwd,
    title: null,
    agent: null,
    transcriptPath: null,
    startedAt: now,
    endedAt: null,
    todos: [],
  };

  const status = loadJSON(join(STATUS_DIR, `${sessionId}.json`));
  if (status?.title) prev.title = status.title;

  // Agent boyutu: subagent tool çağrılarında payload agent_id/agent_type taşır
  // (ana döngüde bu alanlar yok → null kalır). session_id subagent'ın kendi
  // id'si olduğundan dosya zaten agent-run başına ayrışır; agent alanı türe
  // göre gruplamayı sağlar. transcript_path = kaydın adresi.
  if (payload.agent_id || payload.agent_type) {
    prev.agent = {
      id: payload.agent_id ?? null,
      type: payload.agent_type ?? null,
    };
  }
  if (payload.transcript_path) prev.transcriptPath = payload.transcript_path;

  const seen = new Set();
  for (const t of todos) {
    if (!t?.content) continue;
    seen.add(t.content);
    const existing = prev.todos.find((x) => x.content === t.content);
    if (!existing) {
      prev.todos.push({
        content: t.content,
        status: t.status || "pending",
        firstSeen: now,
        lastChange: now,
        removed: false,
      });
    } else if (existing.status !== t.status || existing.removed) {
      existing.status = t.status || existing.status;
      existing.removed = false;
      existing.lastChange = now;
    }
  }
  for (const x of prev.todos) {
    if (!seen.has(x.content) && !x.removed) {
      x.removed = true;
      x.lastChange = now;
    }
  }

  prev.updatedAt = now;
  prev.counts = recount(prev.todos);
  atomicWrite(file, prev);
}

function handleSessionEnd(payload, sessionId, now) {
  const preferredSlug = payload.cwd ? slugOf(payload.cwd) : null;
  const file = findGoalFile(sessionId, preferredSlug);
  if (file) {
    const rec = loadJSON(file);
    rec.endedAt = now;
    atomicWrite(file, rec);
  }
  prune(now);
}

// 30 günden eski VE tüm maddeleri kapanmış (completed/removed) kayıtları ARŞİVLE.
// Yıkıcı-olmayan: silmek yerine goals/_archive/<slug>/'e taşınır — türetme katmanı
// (model.mjs) arşivi de okur, böylece "done-EVER" ve geçmiş kaybolmaz.
function prune(now) {
  const cutoff = Date.parse(now) - PRUNE_MS;
  let dirs;
  try {
    dirs = readdirSync(GOALS_DIR);
  } catch {
    return;
  }
  for (const d of dirs) {
    if (d === "_archive") continue; // arşiv dizinini tekrar tarama
    let files;
    try {
      files = readdirSync(join(GOALS_DIR, d));
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith(".json")) continue;
      const file = join(GOALS_DIR, d, f);
      const rec = loadJSON(file);
      if (!rec) continue;
      const updated = Date.parse(rec.updatedAt || rec.startedAt || "") || 0;
      const open = (rec.todos || []).some(
        (t) => !t.removed && t.status !== "completed"
      );
      if (updated < cutoff && !open) {
        try {
          const archDir = join(ARCHIVE_DIR, d);
          mkdirSync(archDir, { recursive: true, mode: 0o700 });
          renameSync(file, join(archDir, f));
        } catch {
          /* ignore */
        }
      }
    }
  }
}

/** PLAN BAĞI — dispatcher'ın enjekte ettiği AIDE_PLAN_REF'i session_id ile eşle.
 *  Env YOKSA hiçbir şey yazma: bağ "yok"tur ve panelde öyle görünür. Uydurma yasak —
 *  plan yolunu prompt'tan/başlıktan ÇIKARMA (reddedilen heuristik). */
function handlePlanRef(payload, sessionId, now) {
  const planRef = process.env.AIDE_PLAN_REF;
  if (!planRef) return;
  mkdirSync(PLANREF_DIR, { recursive: true, mode: 0o700 });
  atomicWrite(join(PLANREF_DIR, `${sessionId}.json`), {
    sessionId,
    cwd: payload.cwd || process.cwd(),
    planRef,
    jobId: process.env.MAESTRO_FIRE_JOB || null,
    ts: now,
  });
}

/* ─────────────────────────── STOP DALI (+ prompt dalı) ─────────────────────────── */

/** T4 · Config okuyucu. Dosya yok / bozuk / tanınmayan değer → `acik` (tam kapsam).
 *  Sessizdir: bir ayar dosyasının yazım hatası oturumu uyarıya boğmaz. */
function loadStopConfig() {
  const raw = loadJSON(STOP_CFG);
  const k = raw?.kapsam ?? raw?.stopDali?.kapsam;
  return { kapsam: k === "goal" || k === "kapali" ? k : "acik" };
}

const acikMaddeler = (rec) =>
  (rec?.todos || []).filter((t) => !t.removed && t.status !== "completed");

/** Açık-küme imzası: madde METİNLERİ (durum değil) — bir maddenin pending→in_progress
 *  geçişi işi bitirmez, o yüzden imzayı değiştirip yeni blok hakkı DOĞURMAMALI. */
function acikKumeImzasi(acik) {
  const gövde = acik
    .map((t) => String(t.content))
    .sort()
    .join("\n");
  return createHash("sha1").update(gövde).digest("hex").slice(0, 16);
}

function reasonMetni(rec, acik) {
  const suruyor = acik.filter((t) => t.status === "in_progress").length;
  const bekleyen = acik.length - suruyor;
  const satirlar = [];
  const hedef = rec?.goal?.text ? String(rec.goal.text).trim() : null;
  if (hedef) satirlar.push(`/goal hedefi: ${hedef}`);
  satirlar.push(
    `${acik.length} açık madde: ${suruyor} sürüyor, ${bekleyen} bekliyor.`
  );
  for (const t of acik.slice(0, REASON_MAX_ITEM)) {
    satirlar.push(`  • [${t.status === "in_progress" ? "sürüyor" : "bekliyor"}] ${t.content}`);
  }
  if (acik.length > REASON_MAX_ITEM)
    satirlar.push(`  • … +${acik.length - REASON_MAX_ITEM} madde daha`);
  satirlar.push(
    "Bitmediyse devam et. Kullanıcı durmanı istediyse ya da madde gerçekten kapandıysa " +
      "TodoWrite ile defteri güncelle ve gerekçeyle dur — ikinci durma bloklanmaz."
  );
  return satirlar.join("\n");
}

/** T2 · Stop dalı. Karar zinciri — İLK DÜŞEN SERBEST BIRAKIR (şüphe serbest bırakma
 *  yönünedir: bir belirsizlik oturumu kilitlemektense bir erken durmayı kaçırsın). */
function handleStop(payload, sessionId, now) {
  const cfg = loadStopConfig();
  if (cfg.kapsam === "kapali") return; // 1 · kapalı

  const preferredSlug = payload.cwd ? slugOf(payload.cwd) : null;
  const file = findGoalFile(sessionId, preferredSlug);
  if (!file) return; // 2 · bu oturumun defteri yok → hedefsiz oturum, sessiz
  const rec = loadJSON(file);
  if (!rec) return;

  const hedef = rec.goal?.text ? String(rec.goal.text).trim() : "";
  if (cfg.kapsam === "goal" && !hedef) return; // 2b · yalnız /goal kademesi

  const acik = acikMaddeler(rec);
  if (acik.length === 0) return; // 3 · açık iş yok

  if (payload.stop_hook_active === true) return; // 4 · zaten bu blokla dönmüşüz

  const promptId = payload.prompt_id ?? payload.promptId ?? null;
  const imza = acikKumeImzasi(acik);
  const isaret = rec.stopDali || null;
  if (isaret) {
    if (promptId && isaret.promptId === promptId) return; // 5 · aynı prompt'ta ikinci blok YOK
    const gorulen = Array.isArray(isaret.imzalar) ? isaret.imzalar : [];
    if (isaret.acikKumeImza === imza || gorulen.includes(imza)) return; // 6 · aynı küme
  }

  // İşaret ÖNCE diske yazılır: yazamıyorsak bloklamıyoruz (yoksa aynı Stop sonsuza
  // dek bloklanır — kilit defteri tutmayan bir kilit, kilit değildir).
  const gorulen = Array.isArray(isaret?.imzalar) ? isaret.imzalar.slice() : [];
  if (isaret?.acikKumeImza && !gorulen.includes(isaret.acikKumeImza))
    gorulen.push(isaret.acikKumeImza);
  gorulen.push(imza);
  rec.stopDali = {
    promptId,
    acikKumeImza: imza,
    ts: now,
    imzalar: gorulen.slice(-IMZA_TAVAN),
  };
  try {
    atomicWrite(file, rec);
  } catch {
    return;
  }

  process.stdout.write(
    JSON.stringify({ decision: "block", reason: reasonMetni(rec, acik) })
  );
}

/** T3 · Prompt dalı (UserPromptSubmit). Ham prompt slash-expansion'dan ÖNCE görülür →
 *  `/goal <metin>` burada yakalanır ve deftere yazılır. Hedefsiz sıradan prompt'ta
 *  defter YOKSA hiçbir şey yazılmaz: her oturum için boş dosya üretmek nabzı kirletir. */
function handlePrompt(payload, sessionId, now) {
  const raw = typeof payload.prompt === "string" ? payload.prompt : "";
  const m = /^\s*\/goal(?:\s+([\s\S]*))?$/.exec(raw);
  const cwd = payload.cwd || process.cwd();
  const preferredSlug = slugOf(cwd);
  const promptId = payload.prompt_id ?? payload.promptId ?? null;

  let file = findGoalFile(sessionId, preferredSlug);
  if (!m && !file) return; // hedef kurulmuyor ∧ defter yok → HİÇ yazım

  if (!file) {
    const dir = join(GOALS_DIR, preferredSlug);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    file = join(dir, `${sessionId}.json`);
  }
  const rec = loadJSON(file) || {
    sessionId,
    cwd,
    dirName: cwd.split("/").filter(Boolean).pop() || cwd,
    title: null,
    agent: null,
    transcriptPath: null,
    startedAt: now,
    endedAt: null,
    todos: [],
  };

  if (m) {
    const metin = (m[1] || "").trim();
    if (metin) rec.goal = { text: metin, setAt: now, promptId };
  }
  rec.lastPromptAt = now;
  rec.lastPromptId = promptId;
  rec.updatedAt = now;
  atomicWrite(file, rec);
}

function main() {
  const payload = safeParse(readStdin());
  const sessionId =
    payload.session_id || payload.sessionId || process.env.CLAUDE_SESSION_ID;
  if (!sessionId) return;

  const now = new Date().toISOString();
  if (event === "todo") handleTodo(payload, sessionId, now);
  else if (event === "session_start") handlePlanRef(payload, sessionId, now);
  else if (event === "session_end") handleSessionEnd(payload, sessionId, now);
  else if (event === "prompt") handlePrompt(payload, sessionId, now);
  else if (event === "stop") handleStop(payload, sessionId, now);
}

try {
  main();
} catch {
  /* never disrupt the session */
}
process.exit(0);
