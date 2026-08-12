#!/usr/bin/env node
/**
 * kaptan DAMITMA KATMANI — ham nabzı okur, LLM ile künye üretir. İKİ AŞAMA:
 *
 *   Stage A → kaptan/epics/<slug>.json   epic gruplama + temiz başlık + kategori + amaç
 *   Stage B → kaptan/kunye/<slug>.json   AÇIK task'ların kısa başlığı (short) + türü (kind)
 *                                        + session kısa adı ve epic içindeki rolü
 *
 * model.mjs bu iki defteri yalnızca OKUR (hiçbir şey yazmaz):
 *   goals/<slug>/*.json (+_archive) → claude CLI (headless) → epics/ + kunye/
 * Sonuç: epic'ler provisional olmaktan çıkar, çok-session tek epic'te birleşir, başlıklar
 * ham prompt yerine küratörlü olur, task satırları yol yığını yerine insan başlığı gösterir.
 *
 * Yıkıcı değil: dosya yazılmazsa model deterministik fallback'e düşer (shortTitle/kindOf).
 * Faturalı (LLM) → otomatik hook'a BAĞLANMAZ; elle veya /zamanla ile koşulur.
 *
 * PROJE BAŞINA İKİ KADEMELİ ATLAMA (günlük /zamanla işi durağan günde bedelsiz olsun):
 *   1) AKTİVİTE KAPISI — projenin nabzı son başarılı koşumdan beri hiç değişmediyse o proje
 *      hiç işlenmez (kapsam hesabı bile yapılmaz). Damga: kaptan/distill-state.json, AŞAMA BAŞINA
 *      (Stage A çöktüyse Stage B'nin damgası onu maskelemesin). Yalnız BAŞARIDA ilerler.
 *   2) KAPSAMA KAPISI — nabız değişmiş olsa da: Stage A'da gruplanacak yeni oturum,
 *      Stage B'de künyesiz açık task yoksa LLM'e gidilmez.
 *
 *   node distill.mjs --project agent-ide [--dry-run] [--skip-a|--force-a] [--skip-b] [--force]
 *   node distill.mjs                       # tüm projeler (dokunulmayanlar atlanır)
 */

import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { listProjects, loadSessions, TASK_KINDS, EPIC_KATEGORILER } from "./model.mjs";

const CLAUDE = join(homedir(), ".claude");
const EPICS_DIR = join(CLAUDE, "kaptan", "epics");
const KUNYE_DIR = join(CLAUDE, "kaptan", "kunye");
const STATE_FILE = join(CLAUDE, "kaptan", "distill-state.json");

/** Damıtma modeli — MODEL POLİTİKASINDAN okunur (`~/.claude/model-policy.json` → `tiers.hizli`).
 *  persona.mjs ile AYNI desen; ikinci bir model kaynağı yazılmaz.
 *
 *  BURASI BİR ZAMANLAR HARDCODE'DU (`claude-sonnet-5`) ve politikanın bilinen TEK canlı
 *  baypasıydı: "tek kaynak config.json→models" kanonunun dışında bir model, hiçbir tier'da
 *  tanımlı olmadan koşuyordu (persona'da aynı hata düzeltilmiş, burada kalmıştı).
 *  Policy okunamazsa haiku'ya düşer — sessiz sonnet'e DEĞİL. */
function hizliModel() {
  try {
    const p = JSON.parse(readFileSync(join(homedir(), ".claude", "model-policy.json"), "utf8"));
    return p?.tiers?.hizli?.model || "claude-haiku-4-5";
  } catch {
    return "claude-haiku-4-5";
  }
}
const MAX_TODOS = 14;   // Stage A: session başına prompt'a giren todo sayısı
const MAX_LEN = 130;    // içerik kırpma
const TITLE_MAX = 60;
const SHORT_MAX = 42;   // task/session kısa başlığı (model.mjs SHORT_MAX aynası)
const AMAC_MAX = 80;
const ROL_MAX = 24;
const MAX_TASKS_B = 80; // Stage B: tek çağrıda etiketlenecek task tavanı

const readJSON = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
const clean = (s) => String(s || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

/** Bir kanonik slug'ın BİRLEŞTİRİLMİŞ session kayıtları (cwd-parçaları tek kayıtta). */
function readGoals(slug) {
  return (loadSessions().get(slug) || []).map((w) => w.rec);
}

/**
 * Projenin NABIZ DAMGASI: en son dokunulma anı. Hook her TodoWrite'ta `updatedAt` yazar;
 * backfill/session_end kayıtlarında da `endedAt`/`lastChange` bulunur — hepsinin max'ı.
 * Bu damga son başarılı koşumdakinden büyük değilse projede yapacak iş YOKTUR.
 */
function pulseStamp(goals) {
  let mx = "";
  for (const g of goals) {
    for (const c of [g.updatedAt, g.endedAt, g.startedAt]) if (c && c > mx) mx = c;
    for (const t of g.todos || []) if (t.lastChange && t.lastChange > mx) mx = t.lastChange;
  }
  return mx || null;
}

const readState = () => readJSON(STATE_FILE) || {};
/** Aşama damgasını yalnız BAŞARIDA ilerlet (kısmi/çökmüş koşum atlanmayı hak etmez). */
function bumpState(slug, stage, stamp) {
  const s = readState();
  s[slug] = { ...(s[slug] || {}), [stage]: stamp, [`${stage}RunAt`]: new Date().toISOString() };
  const tmp = `${STATE_FILE}.tmp-${process.pid}`;
  mkdirSync(join(CLAUDE, "kaptan"), { recursive: true });
  writeFileSync(tmp, JSON.stringify(s, null, 2));
  renameSync(tmp, STATE_FILE);
}

/** Atomik yazım (tmp + rename). */
function writeAtomic(dir, slug, obj) {
  mkdirSync(dir, { recursive: true });
  const target = join(dir, `${slug}.json`);
  const tmp = `${target}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(obj, null, 2));
  renameSync(tmp, target);
  return target;
}

/** Hesap/API limiti (429) — claude'un KENDİ çıktısından tanınır. Bu, "hata metnine bakma"
 *  anti-pattern'i DEĞİL: üretici tek ve güvenilir (claude süreci), rastgele bir kabuk komutu
 *  değil. Sınıf buradan çıkış KODUNA (75/EX_TEMPFAIL) çevrilir; Maestro yalnız kodu okur. */
const LIMIT_DESENI =
  /rate[_\s-]?limit|usage limit|spend limit|session limit|quota exceeded|too many requests|"?apiErrorStatus"?\s*:\s*429/i;
/** Koşum sırasında hesap limiti görüldü mü — çıkış kodunu 75'e (EX_TEMPFAIL) çeker. */
let limitGoruldu = false;
function limitHatasiYap(mesaj) {
  const e = new Error(mesaj);
  e.limit = true;
  return e;
}

/** claude CLI headless — stdout'ta {type:"result", result:"<metin>"} döner. */
function callClaude(prompt, model) {
  return new Promise((resolve, reject) => {
    // cwd = tmp: proje CLAUDE.md'si prompt'a sızmasın (ucuz + tarafsız).
    const cp = spawn("claude", ["-p", "--output-format", "json", "--model", model], {
      cwd: tmpdir(),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let out = "", err = "";
    cp.stdout.on("data", (d) => (out += d));
    cp.stderr.on("data", (d) => (err += d));
    cp.on("error", (e) => reject(new Error(`claude çalıştırılamadı: ${e.message}`)));
    // claude prompt'u okumadan çıkarsa (çökme/erken exit) stdin EPIPE atar. Dinlenmezse
    // 'error' unhandled olur ve TÜM koşum düşer — gözetimsiz günlük işte kabul edilemez.
    // Yut: gerçek sebep zaten 'close' içinde exit koduyla raporlanıyor.
    cp.stdin.on("error", () => {});
    cp.on("close", (code) => {
      if (code !== 0) {
        // claude -p hata sebebini stderr'e DEĞİL stdout'a JSON olarak yazar (limit, auth,
        // geçersiz model…). Yalnız stderr raporlamak sebebi görünmez kılar: "claude exit 1: ".
        const sebep = [err.trim(), out.trim()].filter(Boolean).join(" | ") || "(stdout+stderr boş)";
        const m = `claude exit ${code}: ${sebep.slice(0, 400)}`;
        return reject(LIMIT_DESENI.test(sebep) ? limitHatasiYap(m) : new Error(m));
      }
      let env;
      try { env = JSON.parse(out); } catch { return reject(new Error("claude çıktısı JSON değil")); }
      // Limit exit 0 + is_error:true olarak da gelebilir (envelope yazılır, içerik hata).
      if (env.is_error) {
        const sebep = `${env.api_error_status ?? ""} ${String(env.subtype ?? "")} ${String(env.result)}`;
        const m = `claude hata: ${String(env.result).slice(0, 300)}`;
        return reject(LIMIT_DESENI.test(sebep) ? limitHatasiYap(m) : new Error(m));
      }
      resolve(String(env.result || ""));
    });
    cp.stdin.end(prompt);
  });
}

/** LLM metninden JSON çıkar (kod bloğu sarmalını tolere et). */
function parseJSONLoose(text) {
  let s = text.trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) s = fence[1].trim();
  const a = s.indexOf("{"), b = s.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("çıktıda JSON bulunamadı");
  return JSON.parse(s.slice(a, b + 1));
}

// ═══════════════════════════════════════════════════════════════════════════
// STAGE A — epic gruplama + kategori + amaç
// ═══════════════════════════════════════════════════════════════════════════

/** LLM'e gidecek kompakt session özeti (gürültüsüz, kırpılmış). */
function summarize(goals) {
  return goals.map((g) => {
    const todos = [];
    const seen = new Set();
    for (const t of g.todos || []) {
      const c = String(t.content || "").replace(/\s+/g, " ").trim().slice(0, MAX_LEN);
      if (!c || seen.has(c)) continue;
      seen.add(c);
      todos.push(c);
      if (todos.length >= MAX_TODOS) break;
    }
    return {
      sessionId: g.sessionId,
      rawTitle: clean(g.title).slice(0, MAX_LEN),
      startedAt: g.startedAt || null,
      endedAt: g.endedAt || null,
      todos,
    };
  });
}

function buildPromptA(dirName, sessions) {
  return `Aşağıda "${dirName}" projesindeki Claude Code oturumlarının görev nabzı var.
Her oturumun ham başlığı (kullanıcının ilk promptu — çoğu zaman dağınık) ve TodoWrite maddeleri listeli.

GÖREV: Bu oturumları anlamlı EPIC'lere grupla; her epic'e temiz başlık, kategori ve amaç yaz.

KURALLAR:
- Aynı işin devamı olan oturumları (ör. bir özelliğin planlanması + uygulanması + doğrulanması) TEK epic'te birleştir.
- İlgisiz oturumlar ayrı epic olsun. Tek oturumluk epic tamamen normaldir.
- title: TÜRKÇE, en fazla ${TITLE_MAX} karakter, NE YAPILDIĞINI anlatır. Ham promptu kopyalama, özetle.
  Kötü: "uygula" · "devam" · "görevlerde, aksi söylenmedikçe yalnızca o vscode windowun..."
  İyi:  "kaptan görev panosu — VSCode + terminal kısayolu" · "Doktor sayfaları: 210 detay çıkarımı"
- id: kısa kebab-case ingilizce/türkçe slug (ör. "kaptan-gorev-panosu"). Benzersiz.
- tags: 0-3 kısa etiket.
- kategori: epic'in AMACINI sınıflar; ŞU KAPALI listeden TAM BİR değer (başka değer YOK):
    ozellik   = kullanıcıya görünür yeni yetenek
    altyapi   = iç mimari / araç / CI / otomasyon (son kullanıcıya görünmez)
    hata      = mevcut bir kusurun onarımı
    icerik    = sayfa / metin / veri üretimi (kod değil, içerik)
    arastirma = keşif / analiz / karar (kalıcı ürün çıkmayabilir)
    bakim     = yeniden düzenleme / temizlik / uyum / iyileştirme
- amac: TEK cümle, en fazla ${AMAC_MAX} karakter, epic'in NEDEN var olduğu. Başlığı tekrarlama; gerekçeyi yaz.
- HER sessionId tam olarak BİR epic'in members listesinde geçmeli. Hiçbirini atlama, tekrarlama.

ÇIKTI: SADECE geçerli JSON. Markdown kod bloğu, açıklama, önsöz YOK.
Şema:
{"epics":[{"id":"...","title":"...","tags":["..."],"kategori":"...","amac":"...","members":[{"sessionId":"..."}]}]}

VERİ:
${JSON.stringify(sessions, null, 1)}`;
}

function parseEpics(text) {
  const obj = parseJSONLoose(text);
  if (!Array.isArray(obj?.epics)) throw new Error("şema: epics[] yok");
  return obj.epics;
}

/** Kapsama + benzersizlik denetimi (YAPISAL → hatalıysa hiçbir şey yazma). */
function validate(epics, sessions) {
  const known = new Set(sessions.map((s) => s.sessionId));
  const seenIds = new Set(), seenSess = new Set();
  for (const e of epics) {
    if (!e?.id || !e?.title) throw new Error("epic'te id/title eksik");
    if (seenIds.has(e.id)) throw new Error(`epic id tekrar: ${e.id}`);
    seenIds.add(e.id);
    for (const m of e.members || []) {
      const sid = m?.sessionId;
      if (!known.has(sid)) throw new Error(`bilinmeyen sessionId: ${sid}`);
      if (seenSess.has(sid)) throw new Error(`sessionId iki epic'te: ${sid}`);
      seenSess.add(sid);
    }
  }
  const missing = [...known].filter((s) => !seenSess.has(s));
  if (missing.length) throw new Error(`kapsanmayan session: ${missing.length} adet`);
}

// Damıtıcının ASLA üretmediği/ezmediği alanlar. İlk üçü elle küratörlük;
// kalanlar PM katmanının yukarıdan yazdığı sözleşme (origin:"pm").
const CURATED = ["status", "backlogRef", "match", "origin", "oncelik", "kabul", "bagimli", "atama", "hedefRef"];

/**
 * Elle küratörlük alanlarını koru; başlık/üyelik tazelenir.
 * kategori/amac ALAN hatasıysa fatal değil: eski değere düş (yoksa null).
 *
 * Eşleştirme ÜYE OTURUM ÖRTÜŞMESİYLE yapılır, epic id'siyle DEĞİL: LLM her koşuda
 * id'leri serbestçe yeniden uydurur ("aide-pane-yonetimi" → "aide-tmux-sekme-surukleme"),
 * id ile eşleyen eski sürüm elle konmuş her status'ü sessizce siliyordu. Oturum kimliği
 * ise sabittir — epic'in ne olduğunu üyeleri tanımlar, adı değil.
 *
 * PM epic'leri (origin:"pm") iki ek güvence ister:
 *   1. ÜYESİZ doğarlar (hedef, iş başlamadan konur) → hiçbir yeni epic onları
 *      üye-örtüşmesiyle sahiplenemez → eski sürümde her damıtmada SİLİNİRLERDİ.
 *      Artık sahiplenilmeyen PM epic'i olduğu gibi taşınır (verbatim pass-through).
 *   2. id'leri SABİT ÇIPADIR: `bagimli[]` ve `hedefRef` epic id'sine atıf yapar.
 *      Küratörlük bir türetilmiş epic'e geçerken LLM'in uydurduğu id değil,
 *      PM'in id'si kazanır — yoksa iş başlar başlamaz bağımlılık grafiği kopar.
 */
function mergeExisting(slug, epics) {
  const prev = readJSON(join(EPICS_DIR, `${slug}.json`));
  const prevEpics = prev?.epics || [];
  const claimed = new Set();

  const out = epics.map((e) => {
    const sids = new Set((e.members || []).map((m) => m.sessionId));
    // en çok üye paylaşan eski epic → küratörlüğün mirasçısı
    let best = null, bestN = 0;
    for (const p of prevEpics) {
      const n = (p.members || []).filter((m) => sids.has(m.sessionId)).length;
      if (n > bestN) { best = p; bestN = n; }
    }
    if (best) claimed.add(best);
    // PM epic'i "terfi ediyor" (üye kazandı): id'si korunur, atıflar kopmasın.
    const id = best?.origin === "pm" ? best.id : e.id;
    const o = {
      id,
      title: String(e.title).slice(0, TITLE_MAX),
      tags: Array.isArray(e.tags) ? e.tags.slice(0, 3) : [],
      kategori: EPIC_KATEGORILER.includes(e.kategori) ? e.kategori : (best?.kategori || null),
      amac: (typeof e.amac === "string" && e.amac.trim())
        ? clean(e.amac).slice(0, AMAC_MAX) : (best?.amac || null),
      members: (e.members || []).map((m) => ({ sessionId: m.sessionId })),
    };
    for (const k of CURATED) if (best?.[k] != null) o[k] = best[k];
    if (best && best.id !== id && CURATED.some((k) => best[k] != null)) {
      process.stderr.write(`  · küratörlük taşındı: ${best.id} → ${id} (${bestN} ortak oturum)\n`);
    }
    if (best?.origin === "pm" && bestN > 0) {
      process.stderr.write(`  · PM hedefi terfi etti: "${id}" artık ${bestN} oturumla çalışılıyor\n`);
    }
    return o;
  });

  const outIds = new Set(out.map((o) => o.id));
  for (const p of prevEpics) {
    if (claimed.has(p)) continue;
    // PM hedefi henüz başlamamış (üyesiz) ya da nabzı arşive düşmüş olabilir.
    // Damıtıcı onu üretemez — silmemeli de. Olduğu gibi taşı.
    if (p.origin === "pm") {
      if (outIds.has(p.id)) continue; // savunma: id çakışması varsa türetilmiş kazansın
      out.push(p);
      continue;
    }
    // Hiçbir yeni epic'in sahiplenmediği küratörlü eski epic = sessiz kayıp. Sesli uyar.
    const lost = CURATED.filter((k) => p[k] != null);
    if (lost.length) process.stderr.write(`  ! UYARI: "${p.id}" küratörlüğü (${lost.join(",")}) devralınmadı — üyeleri nabızda yok\n`);
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// STAGE B — açık task kısa başlığı + türü, session kısa adı + rolü (incremental)
// ═══════════════════════════════════════════════════════════════════════════

const readKunyeFile = (slug) =>
  readJSON(join(KUNYE_DIR, `${slug}.json`)) || { schemaVersion: 1, sessions: {}, tasks: {} };

const isOpen = (t) => !t.removed && t.status !== "completed";

/** AÇIK + henüz künyesiz task'lar. Cache hit → LLM'e gitmez. */
function collectOpenUnlabelled(goals, kunye) {
  const items = [];
  let capped = 0;
  for (const g of goals) {
    const have = kunye.tasks?.[g.sessionId] || {};
    const seen = new Set();
    for (const t of g.todos || []) {
      if (!isOpen(t)) continue;
      const c = String(t.content || "").trim();
      if (!c || seen.has(c)) continue;
      seen.add(c);
      if (have[c]) continue;                         // CACHE HIT
      if (items.length >= MAX_TASKS_B) { capped++; continue; }
      items.push({ sessionId: g.sessionId, content: c.slice(0, MAX_LEN) });
    }
  }
  return { items, capped };
}

/** Açık işi olan + henüz künyesiz session'lar. */
function collectUnlabelledSessions(goals, kunye, epicOf) {
  return goals
    .filter((g) => (g.todos || []).some(isOpen))
    .filter((g) => !kunye.sessions?.[g.sessionId])
    .map((g) => ({
      sessionId: g.sessionId,
      rawTitle: clean(g.title).slice(0, MAX_LEN),
      epic: epicOf(g.sessionId) || null,
      todos: (g.todos || []).filter(isOpen).slice(0, 6).map((t) => clean(t.content).slice(0, 90)),
    }));
}

function buildEpicOf(slug) {
  const reg = readJSON(join(EPICS_DIR, `${slug}.json`));
  const by = new Map();
  for (const e of reg?.epics || []) for (const m of e.members || []) if (m?.sessionId) by.set(m.sessionId, e.title || e.id);
  return (sid) => by.get(sid) || null;
}

function buildPromptB(dirName, items, sessions) {
  return `Aşağıda "${dirName}" projesindeki AÇIK (henüz tamamlanmamış) görevler ve oturumlar var.

GÖREV: Her görev için kısa bir EKRAN BAŞLIĞI (short) ve bir TÜR (kind) üret.
Her oturum için kısa ad (short) ve epic içindeki ROL üret.

short (görev): en fazla ${SHORT_MAX} karakter, TÜRKÇE, tek satırda NE yapılacağını söyler.
  Dosya yolu / parametre yığınını at; FİİL + NESNE bırak.
  Kötü: "core/scope.ts + config (scopeProjects, viewPrefs) — kapsam çekirdeği"
  İyi:  "Kapsam çekirdeği: scope + config"
  Kötü: "İŞ 2: COMPLETENESS süpürme — 109 sayfa alan-batch (Opus ajanları)"
  İyi:  "109 sayfa completeness süpürmesi"
kind (görev): ŞU KAPALI listeden TAM BİR değer (başka değer YOK):
  plan    = tasarım / şema / mimari / karar
  kesif   = inceleme / denetim / araştırma (MEVCUT durumu okuma)
  uygula  = kod veya içerik üret
  dogrula = test / kanıt / gate (DEĞİŞİKLİĞİ kanıtlama)
  duzelt  = mevcut hatanın onarımı
  belge   = doküman / README / rehber
  kapanis = commit / merge / yayın / final teslim
short (oturum): en fazla ${SHORT_MAX} karakter, oturumun tek satır özeti.
rol (oturum): epic içindeki işlevi, kısa (ör. "planlama", "uygulama", "doğrulama", "kapanış").

KRİTİK: Her görevin "content" alanını SANA VERDİĞİM GİBİ BİREBİR geri yaz — eşleştirme anahtarı budur.
Kırpma, düzeltme, yeniden yazma yapma.

ÇIKTI: SADECE geçerli JSON. Markdown kod bloğu, açıklama, önsöz YOK.
Şema:
{"tasks":[{"sessionId":"...","content":"...","short":"...","kind":"..."}],
 "sessions":[{"sessionId":"...","short":"...","rol":"..."}]}

VERİ:
${JSON.stringify({ tasks: items, sessions }, null, 1)}`;
}

/**
 * Alan-düzeyi hataları coerce/düş; YAPISAL hata çağıran tarafta fatal.
 * Tek bozuk enum yüzünden 38 oturumluk partiyi çöpe atma.
 */
function normalizeB(parsed, items) {
  if (!Array.isArray(parsed?.tasks) && !Array.isArray(parsed?.sessions)) {
    throw new Error("şema: tasks[]/sessions[] yok");
  }
  const want = new Set(items.map((x) => x.sessionId + " " + x.content));
  const tasks = {};
  let dropped = 0;
  for (const r of parsed.tasks || []) {
    const content = String(r?.content ?? "");
    if (!want.has(r?.sessionId + " " + content)) { dropped++; continue; } // istenmemiş/uydurulmuş → düş
    const short = clean(r.short).slice(0, SHORT_MAX);
    if (!short) { dropped++; continue; }
    const kind = TASK_KINDS.includes(r.kind) ? r.kind : "uygula";
    (tasks[r.sessionId] ??= {})[content] = { short, kind };
  }
  const sessions = {};
  for (const s of parsed.sessions || []) {
    const short = clean(s?.short).slice(0, SHORT_MAX);
    if (!short || !s?.sessionId) continue;
    sessions[s.sessionId] = { short, rol: clean(s.rol).slice(0, ROL_MAX) || null };
  }
  return { tasks, sessions, dropped };
}

/** Mevcut etiketleri ASLA silmez; nabızdan düşmüş session'ları GC eder. */
function mergeKunye(prev, add, liveSids) {
  const out = { schemaVersion: 1, updatedAt: new Date().toISOString(), sessions: {}, tasks: {} };
  for (const [sid, m] of Object.entries(prev.tasks || {})) if (liveSids.has(sid)) out.tasks[sid] = { ...m };
  for (const [sid, v] of Object.entries(prev.sessions || {})) if (liveSids.has(sid)) out.sessions[sid] = v;
  for (const [sid, m] of Object.entries(add.tasks)) Object.assign((out.tasks[sid] ??= {}), m);
  for (const [sid, v] of Object.entries(add.sessions)) out.sessions[sid] = v;
  return out;
}

/** --project değeri: slug | cwd | dirName ile eşleşsin. */
function resolveTargets(arg) {
  const all = listProjects();
  if (!arg) return all;
  const hit = all.filter(
    (p) => p.slug === arg || p.cwd === arg || p.dirName === arg || (p.cwd || "").endsWith("/" + arg)
  );
  if (!hit.length) {
    throw new Error(`proje bulunamadı: ${arg}\nmevcut: ${all.map((p) => p.dirName).join(", ")}`);
  }
  return hit;
}

const isMain = (() => {
  try { return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]; }
  catch { return false; }
})();

if (isMain) {
  const args = process.argv.slice(2);
  const val = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : null);
  const dryRun = args.includes("--dry-run");
  const skipA = args.includes("--skip-a");
  const skipB = args.includes("--skip-b");
  const forceA = args.includes("--force-a"); // kapsam tam olsa da epic'leri yeniden grupla
  const force = args.includes("--force");    // nabız değişmemiş olsa da projeye bak
  const model = val("--model") || hizliModel();

  let targets;
  try { targets = resolveTargets(val("--project")); }
  catch (e) { console.error(e.message); process.exit(1); }

  let failed = 0, uyandi = 0, uyuyan = 0;
  const st = readState();
  for (const p of targets) {
    const goals = readGoals(p.slug);
    if (!goals.length) { console.error(`atlandı (nabız yok): ${p.dirName}`); continue; }
    const liveSids = new Set(goals.map((g) => g.sessionId));
    const stamp = pulseStamp(goals);
    const prev = st[p.slug] || {};

    // ── KAPI 1: AKTİVİTE. Proje son başarılı koşumdan beri hiç dokunulmadıysa geç.
    const aBayat = !force && !forceA && stamp && prev.a && stamp <= prev.a;
    const bBayat = !force && stamp && prev.b && stamp <= prev.b;
    if ((skipA || aBayat) && (skipB || bBayat)) {
      uyuyan++;
      console.log(`· ${p.dirName}: nabız değişmedi (son koşum ${String(prev.aRunAt || prev.bRunAt || "?").slice(0, 16)}) → atlandı`);
      continue;
    }
    uyandi++;

    // ── STAGE A ────────────────────────────────────────────────────────────
    // Stage A, Stage B'nin aksine bütün epic gruplamasını baştan sorar (incremental değil).
    // KAPI 2 (kapsama): gruplanacak YENİ oturum yoksa LLM'e hiç gitme. Tazelemek için --force-a.
    let skipStageA = skipA || aBayat;
    if (aBayat) console.log(`· [A] ${p.dirName}: nabız değişmedi → atlandı`);
    if (!skipStageA) {
      const reg = readJSON(join(EPICS_DIR, `${p.slug}.json`));
      const covered = new Set((reg?.epics || []).flatMap((e) => (e.members || []).map((m) => m.sessionId)));
      const yeni = goals.filter((g) => !covered.has(g.sessionId));
      if (!forceA && covered.size && !yeni.length) {
        console.log(`✓ [A] ${p.dirName}: künye kapsamı tam, yeni oturum yok (LLM çağrısı yok)`);
        if (!dryRun) bumpState(p.slug, "a", stamp);   // yapacak iş yoktu → damga ilerler
        skipStageA = true;
      }
    }
    if (!skipStageA) {
      const sessions = summarize(goals);
      process.stderr.write(`[A] damıtılıyor: ${p.dirName} (${sessions.length} oturum, model ${model})…\n`);
      try {
        const epics = parseEpics(await callClaude(buildPromptA(p.dirName, sessions), model));
        validate(epics, sessions);                       // YAPISAL → hatalıysa yazma
        const merged = mergeExisting(p.slug, epics);
        if (dryRun) console.log(JSON.stringify({ stage: "A", project: p.dirName, epics: merged }, null, 2));
        else {
          console.log(`✓ [A] ${p.dirName}: ${merged.length} epic ← ${sessions.length} oturum → ${writeAtomic(EPICS_DIR, p.slug, { epics: merged })}`);
          bumpState(p.slug, "a", stamp);                // yalnız BAŞARIDA
        }
      } catch (e) {
        // LİMİT `failed` DEĞİLDİR: kod bozuk değil, pencere dolu. `failed` sayılsaydı çıkış 1
        // olur, Maestro deterministik arıza sanıp 5 hatada işi kalıcı park ederdi (16 Tem vakası).
        if (e.limit) limitGoruldu = true; else failed++;
        console.error(`✗ [A] ${p.dirName}: ${e.message}`);  // hatalıysa dosya ve damga YAZILMAZ
      }
    }

    // ── STAGE B (incremental) ──────────────────────────────────────────────
    if (bBayat) console.log(`· [B] ${p.dirName}: nabız değişmedi → atlandı`);
    if (!skipB && !bBayat) {
      const kunye = readKunyeFile(p.slug);
      const { items, capped } = collectOpenUnlabelled(goals, kunye);
      const sess = collectUnlabelledSessions(goals, kunye, buildEpicOf(p.slug));
      if (capped) console.error(`  uyarı: ${capped} açık task tavana (${MAX_TASKS_B}) takıldı, sonraki koşuda etiketlenecek`);
      if (!items.length && !sess.length) {
        console.log(`✓ [B] ${p.dirName}: künye güncel (LLM çağrısı yok)`);
        if (!dryRun) bumpState(p.slug, "b", stamp);
      } else {
        process.stderr.write(`[B] etiketleniyor: ${p.dirName} (${items.length} task, ${sess.length} oturum)…\n`);
        try {
          const add = normalizeB(parseJSONLoose(await callClaude(buildPromptB(p.dirName, items, sess), model)), items);
          if (add.dropped) console.error(`  uyarı: ${add.dropped} etiket eşleşmedi (content birebir değil) → sonraki koşuda tekrar denenecek`);
          const next = mergeKunye(kunye, add, liveSids);
          const nT = Object.values(next.tasks).reduce((n, m) => n + Object.keys(m).length, 0);
          if (dryRun) console.log(JSON.stringify({ stage: "B", project: p.dirName, ...next }, null, 2));
          else {
            console.log(`✓ [B] ${p.dirName}: +${Object.values(add.tasks).reduce((n, m) => n + Object.keys(m).length, 0)} task künyesi (toplam ${nT}) → ${writeAtomic(KUNYE_DIR, p.slug, next)}`);
            // Tavana takılan/eşleşmeyen etiket kaldıysa damgayı İLERLETME: sonraki koşu devam etsin.
            if (!capped && !add.dropped) bumpState(p.slug, "b", stamp);
          }
        } catch (e) {
          if (e.limit) limitGoruldu = true; else failed++;  // bkz. [A]: limit ≠ arıza
          console.error(`✗ [B] ${p.dirName}: ${e.message}`);  // hatalıysa dosya ve damga YAZILMAZ
        }
      }
    }
  }
  if (targets.length > 1) console.log(`\n${uyandi} proje işlendi, ${uyuyan} proje dokunulmadığı için atlandı`);
  // ÇIKIŞ KODU SINIFI TAŞIR. Gerçek arıza limiti EZER: `failed` varsa 1 (auto-park koruması
  // yaşamalı); yalnız limit varsa 75 → Maestro sayaca yazmaz, park etmez, 15 dk sonra dener.
  if (limitGoruldu && !failed) console.error("⏳ hesap limiti: damıtma eksik kaldı — 75 ile çıkılıyor (yeniden denenecek)");
  process.exit(failed ? 1 : limitGoruldu ? 75 : 0);
}

export { readGoals, summarize, parseEpics, validate, normalizeB, mergeKunye, collectOpenUnlabelled, mergeExisting, CURATED };
