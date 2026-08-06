#!/usr/bin/env node
/**
 * kaptan GÖREV VERİ MODELİ — tek kaynak türetme katmanı (schemaVersion 3).
 *
 * Ham nabız (goal-tracker.mjs'in yazdığı session-başına goal dosyaları) + arşiv +
 * epic künye defteri + task künyesi + proje backlog.md → normalize edilmiş, epic-gruplu,
 * resolution ve staleness taşıyan TAM görev modeli. gorunum.mjs ve durum.mjs bu kütüphaneyi
 * tüketir; dashboard.mjs buildModel() sözleşmesini okur.
 *
 * Kusur düzeltmeleri (bkz plan):
 *   - GRUPLAMA: project → epic (session-üstü) → task rollup
 *   - YIKICI-OLMAYAN REMOVE: removed maddeler resolution ile korunur; done-EVER sayımı
 *   - KÜNYE: epics/<slug>.json (epic) + kunye/<slug>.json (session+task kısa başlık)
 *   - ZAMAN ETİKETLERİ: firstActivity/lastActivity/ageDays/staleDays + 5-durum
 *   - SLUG EKSENİ: projects.json takma-adı + aynı session'ın cwd-parçalarını birleştirme.
 *     Hook dosyayı payload cwd'sinin slug'ına yazar; session cd'lerse todo listesi parçalanır.
 *     Hook aptal kaydedici kalır (dürüst provenans); yorumlama burada yapılır.
 *   - KISA BAŞLIK: her task'ta short+kind. Künye varsa oradan, yoksa deterministik türetme
 *     (shortTitle/kindOf) → distill hiç koşmasa bile pano okunur.
 *
 * CLI:
 *   node model.mjs --json [--project <slug>]   # stabil şema, stdout
 *   node model.mjs --write                      # kaptan/model.json + GORUNUM.md yaz
 * Kütüphane:
 *   import { buildModel, readGoal, openItems, loadSessions } from "./model.mjs"
 */

import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync, appendFileSync,
} from "node:fs";

// KOŞUM DAMGASI (otonomi-merdiveni:02.3) — `aide otomasyon durum`un akıbet ekseni bunu okur.
// Dinamik import + try: damga yazarı yoksa ya da bozuksa hook KOŞMAYA DEVAM EDER; bir ölçüm
// aracı ölçtüğü şeyi asla bozamaz. Maliyet: bir dosya yazımı, 0 token.
try { (await import("../../../hooks/hook-nabiz.mjs")).nabiz("kaptan-model", process.argv[2]); } catch {}
import { olayYaz } from "./_olay.mjs";  // GÖZLEMLENEBİLİRLİK (olay-log.ts şema aynası)

const HOME = homedir();
const CLAUDE = join(HOME, ".claude");
const GOALS_DIR = join(CLAUDE, "kaptan", "goals");
const ARCHIVE_DIR = join(GOALS_DIR, "_archive");
const EPICS_DIR = join(CLAUDE, "kaptan", "epics");
const KUNYE_DIR = join(CLAUDE, "kaptan", "kunye");
const PROJECTS_CFG = join(CLAUDE, "kaptan", "projects.json");
const MODEL_OUT = join(CLAUDE, "kaptan", "model.json");
const GORUNUM_OUT = join(CLAUDE, "kaptan", "GORUNUM.md");
/** PM katmanının yazdığı proje-seviyesi hedefler (epics/kunye ile aynı per-slug desen). */
const HEDEFLER_DIR = join(CLAUDE, "kaptan", "hedefler");
/** PM'in poll ettiği küçük sözleşme yüzeyi (model.json 2 MB+, bunu parse etmesin). */
const PM_OUT = join(CLAUDE, "kaptan", "PM.json");
const TIMING_OUT = join(CLAUDE, "kaptan", "derive-timing.jsonl");
// kaptan katmanı gözlem defteri (tek-yazar bu türetme chokepoint'i). Yol: ~/.claude/kaptan/olay.jsonl.
// Yalnız `--write` türetmesi (Stop hook — seyrek) enstrümante edilir; okuma yolları DEĞİL.
const OLAY_DEFTERI = join(CLAUDE, "kaptan", "olay.jsonl");

export const SCHEMA_VERSION = 3;
const DAY = 24 * 3600_000;
const ACTIVE_DAYS = 3; // bu kadar gündür dokunulmamışsa artık "aktif" değil
const STALE_DAYS = 7;  // bu kadar gündür açık+dokunulmamış → BAYAT
const OVERLAP = 0.6;   // superseded eşiği (token örtüşme oranı)

export const slugOf = (p) => String(p).replace(/[^A-Za-z0-9]/g, "-");
const readJSON = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
const nowISO = () => new Date().toISOString();
const daysSince = (iso, now) => {
  const t = Date.parse(iso || "");
  if (!t) return null;
  return Math.max(0, Math.round((Date.parse(now) - t) / DAY));
};
const minISO = (a, b) => (!a ? b : !b ? a : (a < b ? a : b));
const maxISO = (a, b) => (!a ? b : !b ? a : (a > b ? a : b));

// ── içerik normalize + benzerlik (superseded tespiti) ────────────────────────
const tokens = (s) =>
  new Set(String(s).toLowerCase().replace(/[^a-z0-9çğıöşü ]/gi, " ").split(/\s+/).filter((w) => w.length > 2));
function overlapRatio(a, b) {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let hit = 0;
  for (const w of A) if (B.has(w)) hit++;
  return hit / Math.min(A.size, B.size);
}

// Başlık olarak değersiz tek-kelime imperatifler — ham prompt bunlardan ibaretse
// gerçek iş todo içeriğindedir, ona düş.
const STOP_TITLES = new Set([
  "uygula", "devam", "test", "fix", "wip", "dene", "tamamla", "tamam",
  "bak", "kontrol", "düzelt", "güncelle", "ekle", "calis", "çalış",
]);
const TITLE_MAX = 60;
const SHORT_MAX = 42;
const stripNoise = (s) => String(s || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();

/** Kelime sınırında kırp (ortadan bölmez). */
function clip(s, max) {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const sp = cut.lastIndexOf(" ");
  const body = sp > max * 0.6 ? cut.slice(0, sp) : cut;
  return body.replace(/[\s:;,+·/\-–—]+$/, "") + "…";
}

// ── temiz başlık (gorunum.mjs cleanTitle aynası) ─────────────────────────────
export function cleanTitle(goal) {
  const t = String(goal?.title || "").trim();
  const active = (goal?.todos || []).filter((x) => !x.removed);
  const junk =
    !t ||
    t.startsWith("<") ||          // <task-notification>, <ide_opened_file> gibi bildirim gürültüsü
    t.startsWith("/") ||          // slash komut
    t.length < 4 ||
    STOP_TITLES.has(t.toLowerCase());
  let name = junk
    ? (active.find((x) => x.status === "in_progress")?.content ||
       active.filter((x) => x.status === "completed").slice(-1)[0]?.content ||
       active[0]?.content ||
       (goal?.todos || []).slice(-1)[0]?.content ||
       "(başlıksız)")
    : t;
  name = stripNoise(name);
  if (!name) name = "(başlıksız)";
  return name.length > TITLE_MAX ? name.slice(0, TITLE_MAX - 1) + "…" : name;
}

// ── task künyesi: kısa başlık + tür (deterministik fallback) ─────────────────
export const TASK_KINDS = ["plan", "kesif", "uygula", "dogrula", "duzelt", "belge", "kapanis"];
export const EPIC_KATEGORILER = ["ozellik", "altyapi", "hata", "icerik", "arastirma", "bakim"];

export const KIND_META = {
  plan: { icon: "◇", label: "plan" },
  kesif: { icon: "⌕", label: "keşif" },
  uygula: { icon: "⚒", label: "uygula" },
  dogrula: { icon: "⊙", label: "doğrula" }, // ⊙ — durum glif'i ✓ ile karışmasın
  duzelt: { icon: "↺", label: "düzelt" },
  belge: { icon: "✎", label: "belge" },
  kapanis: { icon: "⚑", label: "kapanış" },
};
export const KATEGORI_META = {
  ozellik: { icon: "✨", label: "ÖZELLİK" },
  altyapi: { icon: "🧱", label: "ALTYAPI" },
  hata: { icon: "🐞", label: "HATA" },
  icerik: { icon: "📝", label: "İÇERİK" },
  arastirma: { icon: "🔬", label: "ARAŞTIRMA" },
  bakim: { icon: "🧹", label: "BAKIM" },
};

// "Faz 2:", "İŞ 3b —", "Adım 1:", "P0-5:", "S2:", "USP-1 —", "Round 5:" gibi
// numaralandırıcı KODU at; anlamlı gövdeyi bırak.
const ENUM_PREFIX =
  /^\s*(?:faz|iş|is|adım|adim|aşama|asama|round|paket|step|bölüm|bolum|usp|sp|[a-zçğıöşü])\s*[-–]?\s*\d[0-9a-zçğıöşü.\-]*\s*[:\-–—]\s+/i;
// Türkçe alışkanlık: "yol/dosya yığını — insan özeti". Em-dash'ten SONRASI özettir.
const DASH_SPLIT = /\s+[—–]\s+/;
const PAREN_TAIL = /\s*\([^()]*\)\s*$/;

/** Ham todo içeriğinden ≤42 karakter ekran başlığı. Künye yoksa devreye girer. */
export function shortTitle(content) {
  const raw = stripNoise(content);
  if (!raw) return "(görevsiz)";
  let s = raw;
  const stripped = s.replace(ENUM_PREFIX, "");
  if (stripped.length >= 6) s = stripped;          // "Faz 2: doc: paketi …" → "doc: paketi …"
  const parts = s.split(DASH_SPLIT);
  if (parts.length > 1) {
    const tail = parts[parts.length - 1].trim();   // "core/scope.ts + … — kapsam çekirdeği"
    if (tail.length >= 6) s = tail;                //                     → "kapsam çekirdeği"
  }
  s = s.replace(PAREN_TAIL, "").trim();            // sondaki "(nabız tazeliği)" parantezini at
  s = s.replace(/[\s:;,\-–—]+$/, "").trim();
  if (!s) s = raw;
  return clip(s, SHORT_MAX);
}

// SIRALI — ilk eşleşen kazanır ("gate + commit" → kapanis; commit doğrulamayı yener)
const KIND_RULES = [
  ["kapanis", /(kapa(t|n)|commit|merge|yay(ı|i)n|release|final|teslim|dağıt|dagit)/i],
  ["dogrula", /(doğrula|dogrula|verify|proof|kan(ı|i)t|idempoten|\bgate\b|regres|teyit|\btest)/i],
  ["duzelt", /(düzelt|duzelt|\bfix\b|\bhata|\bbug\b|onar)/i],
  ["kesif", /(keşif|kesif|denetim|audit|review|inceleme|araştır|arastir|tarama|analiz)/i],
  ["belge", /(belge|\bdocs?\b|doküman|dokuman|readme|rehber|kılavuz|manifesto|memory)/i],
  ["plan", /(plan|tasar(ı|i)m|şema|sema|mimari|iskele|taslak|karar)/i],
];
/** Ham todo içeriğinden görev türü. Künye yoksa devreye girer. */
export function kindOf(content) {
  const s = String(content || "");
  for (const [k, re] of KIND_RULES) if (re.test(s)) return k;
  return "uygula";
}

// ── ham goal dosyası okuma (canlı VEYA arşiv) — durum.mjs sözleşmesi ─────────
export function readGoal(slug, sessionId) {
  return (
    readJSON(join(GOALS_DIR, slug, `${sessionId}.json`)) ||
    readJSON(join(ARCHIVE_DIR, slug, `${sessionId}.json`)) ||
    null
  );
}

// açık (resolution=null) madde metinleri — durum.mjs sözleşmesi için
export function openItems(goal, limit = 160) {
  return (goal?.todos || [])
    .filter((t) => !t.removed && t.status !== "completed")
    .map((t) => String(t.content).slice(0, limit));
}

export const readKunye = (slug) => readJSON(join(KUNYE_DIR, `${slug}.json`)) || { sessions: {}, tasks: {} };

// ── slug ekseni: takma-ad çözümü ─────────────────────────────────────────────
function readProjectsCfg() {
  const cfg = readJSON(PROJECTS_CFG) || {};
  return { home: cfg.home || HOME, aliases: cfg.aliases || {} };
}

/** Tüm slug dizinlerindeki ham fragment'ler. (slug, sessionId) başına canlı arşivi ezer. */
function loadAllFragments() {
  const seen = new Map(); // `${slug}\u0000${sessionId}` → {slug, rec, archived}
  for (const [base, archived] of [[GOALS_DIR, false], [ARCHIVE_DIR, true]]) {
    let slugs;
    try { slugs = readdirSync(base); } catch { continue; }
    for (const slug of slugs) {
      if (slug === "_archive") continue;
      let files;
      try { files = readdirSync(join(base, slug)); } catch { continue; }
      for (const f of files) {
        if (!f.endsWith(".json")) continue;
        const rec = readJSON(join(base, slug, f));
        if (!rec?.sessionId) continue;
        const k = `${slug}\u0000${rec.sessionId}`;
        if (!seen.has(k) || !archived) seen.set(k, { slug, rec, archived });
      }
    }
  }
  return [...seen.values()];
}

/**
 * slug → kanonik slug. Açık takma-ad öncelikli; yoksa "cwd'si başka bir projenin
 * ALT dizini olan slug o projeye düşer" (home ata olamaz, yoksa her şey eve çöker).
 */
function buildCanonicalizer(frags) {
  const { home, aliases } = readProjectsCfg();
  const homeSlug = slugOf(home);
  const cwdBy = new Map();
  for (const f of frags) if (f.rec.cwd && !cwdBy.has(f.slug)) cwdBy.set(f.slug, f.rec.cwd);

  const direct = (slug) => {
    if (aliases[slug]) return aliases[slug];
    const cwd = cwdBy.get(slug);
    if (!cwd) return slug;
    let best = null; // en DERİN ata
    for (const [s, c] of cwdBy) {
      if (s === slug || s === homeSlug) continue;
      if (!cwd.startsWith(c + "/")) continue;
      if (!best || c.length > cwdBy.get(best).length) best = s;
    }
    return best || slug;
  };

  const memo = new Map();
  return (slug) => {
    if (memo.has(slug)) return memo.get(slug);
    let cur = slug;
    for (let i = 0; i < 8; i++) {           // zincirli alias; döngü koruması
      const next = direct(cur);
      if (next === cur) break;
      cur = next;
    }
    memo.set(slug, cur);
    return cur;
  };
}

/**
 * Aynı sessionId'nin cwd-parçalarını TEK kayda birleştir (hook'un merge semantiğinin aynası).
 * Her todo'ya `_frag` (kaynak slug) iliştirilir → deriveTasks fragment-arası kopyayı sönümler.
 */
function mergeFragments(frags, homeFrag) {
  const ordered = [...frags].sort((a, b) => String(a.rec.updatedAt || a.rec.startedAt || "")
    .localeCompare(String(b.rec.updatedAt || b.rec.startedAt || "")));

  const todos = new Map(); // content → todo
  for (const f of ordered) {
    for (const t of f.rec.todos || []) {
      const c = String(t.content);
      const prev = todos.get(c);
      if (!prev) { todos.set(c, { ...t, content: c, _frag: f.slug }); continue; }
      // çakışma: geç lastChange kazanır, firstSeen = min
      const win = String(t.lastChange || "") >= String(prev.lastChange || "") ? t : prev;
      todos.set(c, {
        ...win, content: c,
        firstSeen: minISO(prev.firstSeen, t.firstSeen),
        lastChange: maxISO(prev.lastChange, t.lastChange),
        _frag: win === t ? f.slug : prev._frag,
      });
    }
  }

  const rec = { ...homeFrag.rec };
  rec.todos = [...todos.values()];
  rec.startedAt = ordered.map((f) => f.rec.startedAt).filter(Boolean).reduce(minISO, null);
  // session_end endedAt'i TEK parçaya yazar → "herhangi biri bittiyse session bitti"
  rec.endedAt = ordered.map((f) => f.rec.endedAt).filter(Boolean).reduce(maxISO, null) || null;
  rec.updatedAt = ordered.map((f) => f.rec.updatedAt).filter(Boolean).reduce(maxISO, null) || null;
  rec.counts = { total: 0, completed: 0, in_progress: 0, pending: 0 };
  for (const t of rec.todos) {
    if (t.removed) continue;
    rec.counts.total++;
    if (rec.counts[t.status] !== undefined) rec.counts[t.status]++;
  }
  rec.fragments = frags.length > 1 ? [...new Set(frags.map((f) => f.slug))] : undefined;
  return rec;
}

/** Bir session'ın ev slug'ı: home asla kazanmaz (home-dışı aday varsa) → en çok todo → en derin cwd → en geç updatedAt. */
function pickHome(byCanon, homeSlug) {
  const cands = [...byCanon.entries()];
  const nonHome = cands.filter(([s]) => s !== homeSlug);
  const pool = nonHome.length ? nonHome : cands;
  pool.sort((a, b) => {
    const ta = a[1].reduce((n, f) => n + (f.rec.todos?.length || 0), 0);
    const tb = b[1].reduce((n, f) => n + (f.rec.todos?.length || 0), 0);
    if (ta !== tb) return tb - ta;
    const da = (a[1][0].rec.cwd || "").length, db = (b[1][0].rec.cwd || "").length;
    if (da !== db) return db - da;
    const ua = a[1].map((f) => f.rec.updatedAt).filter(Boolean).reduce(maxISO, null) || "";
    const ub = b[1].map((f) => f.rec.updatedAt).filter(Boolean).reduce(maxISO, null) || "";
    return String(ub).localeCompare(String(ua));
  });
  return pool[0][0];
}

/**
 * Kanonik slug → birleştirilmiş session kayıtları.
 * Fragment birleştirme slug'lar ARASI olduğundan global okumak zorunlu.
 */
export function loadSessions() {
  const frags = loadAllFragments();
  const canon = buildCanonicalizer(frags);
  const homeSlug = slugOf(readProjectsCfg().home);

  const bySid = new Map(); // sessionId → fragment[]
  for (const f of frags) {
    if (!bySid.has(f.rec.sessionId)) bySid.set(f.rec.sessionId, []);
    bySid.get(f.rec.sessionId).push(f);
  }

  const out = new Map(); // canonSlug → [{rec, archived}]
  for (const fs of bySid.values()) {
    const byCanon = new Map();
    for (const f of fs) {
      const c = canon(f.slug);
      if (!byCanon.has(c)) byCanon.set(c, []);
      byCanon.get(c).push(f);
    }
    const home = pickHome(byCanon, homeSlug);
    const homeFrag = byCanon.get(home)[0];
    const rec = fs.length > 1 ? mergeFragments(fs, homeFrag) : { ...fs[0].rec, todos: (fs[0].rec.todos || []).map((t) => ({ ...t, _frag: fs[0].slug })) };
    if (!out.has(home)) out.set(home, []);
    out.get(home).push({ rec, archived: fs.every((f) => f.archived) });
  }
  return out;
}

/**
 * Ucuz proje envanteri (epic türetmeden) — pano seçicisi + distill hedef çözümü için.
 */
export function listProjects() {
  const out = [];
  for (const [slug, wraps] of loadSessions()) {
    if (!wraps.length) continue;
    const cwd = wraps.find((g) => g.rec.cwd)?.rec.cwd || null;
    const dirName = wraps.find((g) => g.rec.dirName)?.rec.dirName || slug;
    out.push({ slug, dirName, cwd });
  }
  return out.sort((a, b) => a.dirName.localeCompare(b.dirName));
}

// ── resolution: her todo (removed dahil) sınıflandır ─────────────────────────
function deriveTasks(goal, now, kunye) {
  const todos = goal.todos || [];
  const activeContents = todos.filter((t) => !t.removed).map((t) => t.content);
  const tk = (kunye?.tasks || {})[goal.sessionId] || {};

  // Fragment-arası yakın-kopya: aynı iş iki cwd'de ayrı yazılmış olabilir. FARKLI
  // _frag'lardan gelen açık maddeler ≥OVERLAP örtüşüyorsa eskisi superseded olur.
  // Tek-fragment'li session'da hiçbir çift eşleşmez → davranış bugünküyle birebir aynı.
  //
  // En YENİden eskiye tara: bir madde ancak HAYATTA KALAN (kendisi düşmemiş) daha yeni
  // bir eşdeğeri varsa düşer. Çift-çift karşılaştırma zincir kurup (a~b, b~c) hem a'yı
  // hem b'yi düşürür ve a'nın yerine geçeni bırakmazdı — iş sessizce kaybolurdu.
  const demote = new Set();
  const survivors = [];
  const open = todos
    .filter((t) => !t.removed && t.status !== "completed")
    .sort((a, b) => String(b.lastChange || "").localeCompare(String(a.lastChange || "")));
  for (const t of open) {
    const supersededBy = survivors.find(
      (s) => s._frag && t._frag && s._frag !== t._frag && overlapRatio(s.content, t.content) >= OVERLAP
    );
    if (supersededBy) demote.add(t.content);
    else survivors.push(t);
  }

  return todos.map((t, i) => {
    let resolution;
    if (!t.removed) {
      resolution = t.status === "completed" ? "completed"
        : demote.has(t.content) ? "superseded"   // fragment-arası kopya
        : null;                                  // null = açık
    } else if (t.status === "completed") {
      resolution = "completed"; // tamamlanıp sonra listeden düşmüş → gerçek done, korunur
    } else if (activeContents.some((c) => c !== t.content && overlapRatio(c, t.content) >= OVERLAP)) {
      resolution = "superseded"; // re-plan; aktif eşdeğeri var → ilerlemeyi sıfırlamaz
    } else {
      resolution = "dropped"; // gerçekten bırakılmış
    }
    const content = String(t.content);
    const k = tk[content];
    return {
      id: `${goal.sessionId}:${i}`,
      content,
      short: k?.short || shortTitle(content),
      kind: (k?.kind && TASK_KINDS.includes(k.kind)) ? k.kind : kindOf(content),
      kunyeli: !!k,
      status: t.status || "pending",
      resolution,
      sessionId: goal.sessionId,
      firstSeen: t.firstSeen || null,
      lastChange: t.lastChange || null,
      ageDays: daysSince(t.lastChange || t.firstSeen, now),
    };
  });
}

// ── epic ataması (registry → provisional) ────────────────────────────────────
function epicAssigner(slug) {
  const reg = readJSON(join(EPICS_DIR, `${slug}.json`));
  const epics = Array.isArray(reg?.epics) ? reg.epics : [];
  const bySession = new Map();
  for (const e of epics) for (const m of e.members || []) if (m?.sessionId) bySession.set(m.sessionId, e);
  return (goal) => {
    // 1) açık üyelik
    let e = bySession.get(goal.sessionId);
    // 2) match.titleIncludes (elle members yazmadan otomatik çekme)
    if (!e) {
      const hay = `${goal.title || ""} ${goal.goalCondition || ""}`.toLowerCase();
      e = epics.find((x) => (x.match?.titleIncludes || []).some((k) => hay.includes(String(k).toLowerCase())));
    }
    if (e) {
      return {
        id: e.id, title: e.title || e.id, provisional: false, reg: e,
        kategori: EPIC_KATEGORILER.includes(e.kategori) ? e.kategori : null,
        amac: e.amac || null,
      };
    }
    // 3) provisional — her session kendi epic'i
    return {
      id: `sess:${String(goal.sessionId).slice(0, 8)}`, title: cleanTitle(goal),
      provisional: true, reg: null, kategori: null, amac: null,
    };
  };
}

// ── backlog.md içe-alım (proje bazlı, salt-okunur) ───────────────────────────
export function parseBacklog(cwd) {
  if (!cwd) return [];
  const path = join(cwd, "scripts", ".iyilestirme", "backlog.md");
  let raw;
  try { raw = readFileSync(path, "utf8"); } catch { return []; }
  const out = [];
  for (const line of raw.split("\n")) {
    // yalnız §1 tablosu satırları: | S<n> | Skill | Eksik | Önem | Durum |
    const m = line.match(/^\|\s*(S\d+)\s*\|(.+)\|\s*$/);
    if (!m) continue;
    const cells = m[2].split("|").map((c) => c.trim());
    if (cells.length < 4) continue;
    const [skill, eksik, onem, durum] = cells;
    const severity = onem.includes("🔴") ? "yuksek" : onem.includes("🟡") ? "orta" : onem.includes("⚪") ? "dusuk" : null;
    const closed = /✅|KAPANDI/.test(durum);
    out.push({
      id: m[1], skill, desc: eksik.slice(0, 200),
      severity, status: closed ? "closed" : "open",
      closedInfo: closed ? durum.replace(/\s+/g, " ").slice(0, 240) : null,
    });
  }
  return out;
}

// ── plans/INDEX.json içe-alım (proje bazlı, salt-okunur) ─────────────────────
/** Plan ağacı projeksiyonu. TEK YAZAR plan-organizatoru/scripts/agac.mjs'tir;
 *  burada parse YENİDEN YAZILMAZ (Ders 2/17: ikinci motor drift üretir) —
 *  agac.mjs'in türettiği INDEX.json aynen okunur. Tazelik agac.mjs --gate'in işi. */
export function readPlans(cwd) {
  if (!cwd) return [];
  const j = readJSON(join(cwd, "plans", "INDEX.json"));
  if (!Array.isArray(j?.plans)) return [];
  return j.plans.map((p) => ({
    slug: p.slug, v: p.v, title: p.title, kategori: p.kategori, ust: p.ust,
    // künye (kritiklik·aciliyet·hacim·hedef + TÜREV oncelik/puan): agac.mjs'ten AYNEN taşınır.
    // Kaptan önem/aciliyet ÇIKARSAMAZ — planın kendi beyanını gösterir ("hangi plan önce"
    // sorusunun tek kaynağı künyedir; ikinci bir sıralama motoru yazılmaz).
    kunye: p.kunye ?? null,
    durum: p.durum, asamaKapali: p.asamaKapali, asamaToplam: p.asamaToplam,
    checklistAcik: p.checklistAcik, checklistKapali: p.checklistKapali,
    siradaki: p.siradaki, goal: p.goal, master: p.master, sonTur: p.sonTur,
  })).sort((a, b) => ((b.kunye?.puan ?? -1) - (a.kunye?.puan ?? -1))
    || String(a.slug).localeCompare(String(b.slug)));  // künye sırası = pano sırası (P3 üstte)
}

// ── PM katmanı: registry + proje hedefleri (salt-okunur) ─────────────────────
/** Ham epic registry — buildModel üyesiz PM epic'lerini buradan enjekte eder. */
export const readEpicsReg = (slug) => {
  const r = readJSON(join(EPICS_DIR, `${slug}.json`));
  return Array.isArray(r?.epics) ? r.epics : [];
};
/** Proje-seviyesi hedefler. PM yazar; damıtıcı önerir; model yalnız okur+roll-up eder. */
export const readHedefler = (slug) => {
  const r = readJSON(join(HEDEFLER_DIR, `${slug}.json`));
  return Array.isArray(r?.hedefler) ? r.hedefler : [];
};
/** epics/ ve hedefler/ altındaki tüm slug'lar — hiç oturumu olmayan projeler de görünsün. */
function registrySlugs() {
  const out = new Set();
  for (const d of [EPICS_DIR, HEDEFLER_DIR]) {
    try { for (const f of readdirSync(d)) if (f.endsWith(".json") && !f.startsWith("_")) out.add(f.slice(0, -5)); }
    catch { /* dizin yoksa yok */ }
  }
  return out;
}
const ONCELIK_RANK = { P0: 0, P1: 1, P2: 2, P3: 3 };
const oncelikRank = (o) => ONCELIK_RANK[o] ?? 9;

/** PM sözleşme alanları epic'ten geçer; damıtıcı bunları üretmez (distill.mjs CURATED). */
const pmFields = (reg) => ({
  origin: reg?.origin || "derived",
  oncelik: reg?.oncelik || null,
  kabul: Array.isArray(reg?.kabul) ? reg.kabul : [],
  bagimli: Array.isArray(reg?.bagimli) ? reg.bagimli : [],
  atama: reg?.atama || null,
  hedefRef: reg?.hedefRef || null,
});

// ── epic statü türetimi ──────────────────────────────────────────────────────
function epicStatus({ hasOpen, staleDays, epicEnded, regStatus, origin, hasMembers }) {
  // küratörlü statü her zaman türetmeyi ezer
  if (regStatus === "planned") return "planned";
  if (regStatus === "done") return "done";
  if (regStatus === "dropped") return "dropped";
  if (regStatus === "paused") return "paused";
  // PM hedefi henüz kimseye atanmadı: "hasOpen yok → done" tuzağına DÜŞMEMELİ
  if (origin === "pm" && !hasMembers) return "planned";
  if (!hasOpen) return "done";
  if (staleDays != null && staleDays > STALE_DAYS) return "stale"; // "AKTİF forever" düzeltmesi
  if (epicEnded) return "paused";
  return "active";
}

/** Üyesiz (henüz başlamamış) PM epic'i — nabızda izi yok, registry'den sentezlenir. */
function syntheticEpic(reg) {
  const hasMembers = (reg.members || []).length > 0;
  return {
    id: reg.id,
    title: reg.title || reg.id,
    provisional: false,
    // üyesi var ama nabızda yok → oturumları arşive düşmüş: "paused" dürüst cevap
    status: reg.status || (hasMembers ? "paused" : "planned"),
    kategori: EPIC_KATEGORILER.includes(reg.kategori) ? reg.kategori : null,
    amac: reg.amac || null,
    kunyeli: !!reg.kategori,
    tags: reg.tags || [],
    backlogRef: reg.backlogRef || null,
    ...pmFields(reg),
    progress: { doneEver: 0, openActive: 0, dropped: 0, pct: 0 },
    firstActivity: null, lastActivity: null, ageDays: null, staleDays: null,
    sessions: (reg.members || []).map((m) => m.sessionId),
    members: (reg.members || []).map((m) => ({ sessionId: m.sessionId, short: null, rol: null, kunyeli: false })),
    tasks: [],
  };
}

/** Hedefin durumu: küratörlü `durum` kazanır; yoksa bağlı epic'lerden türer. */
function hedefDurum(h, linked) {
  if (h.durum) return h.durum;
  if (!linked.length) return "planned";
  if (linked.every((e) => ["done", "dropped"].includes(e.status))) return "done";
  if (linked.some((e) => e.status === "active")) return "active";
  if (linked.some((e) => e.status === "stale")) return "stale";
  if (linked.some((e) => e.status === "planned")) return "planned";
  return "paused";
}

/** Proje hedeflerini bağlı epic'lerden roll-up et (blokaj ikinci geçişte).
 *  Hedef opsiyonel `planRef` taşır (plan slug'ı ya da plans/<slug> yolu) →
 *  plan ağacındaki karşılığı hedefe iliştirilir; kırık referans açıkça işaretlenir. */
function rollupHedefler(slug, epics, plans = []) {
  const raw = readHedefler(slug);
  if (!raw.length) return [];
  const findPlan = (ref) => ref ? plans.find((pl) =>
    pl.slug === ref || pl.master === ref || `plans/${pl.slug}` === ref) || null : null;
  const hedefler = raw.map((h) => {
    const linked = epics.filter((e) => e.hedefRef === h.id);
    const plan = findPlan(h.planRef);
    const doneEver = linked.reduce((n, e) => n + e.progress.doneEver, 0);
    const openActive = linked.reduce((n, e) => n + e.progress.openActive, 0);
    const total = doneEver + openActive;
    return {
      id: h.id,
      text: h.text || h.id,
      neden: h.neden || null,
      oncelik: h.oncelik || null,
      origin: h.origin || "pm",       // "pm" (elle) | "damitma" (LLM önerisi)
      onaylandi: h.onaylandi ?? (h.origin !== "damitma"),
      guven: h.guven ?? null,
      kabul: Array.isArray(h.kabul) ? h.kabul : [],
      bagimli: Array.isArray(h.bagimli) ? h.bagimli : [],
      durum: hedefDurum(h, linked),
      progress: { doneEver, openActive, pct: total ? Math.round((doneEver / total) * 100) : 0 },
      epics: linked.map((e) => ({ id: e.id, title: e.title, status: e.status, pct: e.progress.pct })),
      tip: h.tip || "ozellik",         // hedef türü: ozellik (varsayılan/geriye-uyum) | plan-tamamlama
      otonomi: h.otonomi ?? null,      // hedefin rota profili niyeti (opsiyonel); PM köprüsü çevirir
      utopyaRef: h.utopyaRef || null,  // kutup yıldızı çıpası — graf vizyon→hedef kenarının kaynağı (vizyon-katmani 04)
      planRef: h.planRef || null,
      plan: plan ? { slug: plan.slug, v: plan.v, durum: plan.durum, asamaKapali: plan.asamaKapali, asamaToplam: plan.asamaToplam, siradaki: plan.siradaki }
        : (h.planRef ? { broken: true, ref: h.planRef } : null),
      blokaj: [],
    };
  });
  // ikinci geçiş: bagimli[] içinde henüz bitmemiş hedefler = blokaj
  const byId = new Map(hedefler.map((h) => [h.id, h]));
  for (const h of hedefler) {
    h.blokaj = h.bagimli.filter((id) => byId.get(id)?.durum !== "done");
  }
  return hedefler.sort((a, b) => oncelikRank(a.oncelik) - oncelikRank(b.oncelik) || a.id.localeCompare(b.id));
}

// ── ana model ─────────────────────────────────────────────────────────────────
export function buildModel({ projectFilter = null, cwdPrefix = null, now = nowISO() } = {}) {
  const projects = [];
  for (const [slug, goalWraps] of loadSessions()) {
    if (projectFilter && slug !== projectFilter) continue;
    if (!goalWraps.length) continue;
    const assign = epicAssigner(slug);
    const kunye = readKunye(slug);
    const dirName = goalWraps.find((g) => g.rec.dirName)?.rec.dirName || slug;
    const cwd = goalWraps.find((g) => g.rec.cwd)?.rec.cwd || null;
    // Kapsam: cwd-prefix (slug kayıplı/tersine çevrilemez).
    if (cwdPrefix && !(cwd === cwdPrefix || String(cwd || "").startsWith(cwdPrefix + "/"))) continue;

    // goal'leri epic'e grupla
    const epicMap = new Map();
    for (const { rec, archived } of goalWraps) {
      const a = assign(rec);
      if (!epicMap.has(a.id)) epicMap.set(a.id, { info: a, goals: [], tasks: [] });
      const bucket = epicMap.get(a.id);
      bucket.goals.push({ rec, archived });
      bucket.tasks.push(...deriveTasks(rec, now, kunye));
    }

    const epics = [];
    for (const { info, goals, tasks } of epicMap.values()) {
      const doneEver = tasks.filter((t) => t.resolution === "completed").length;
      const openActive = tasks.filter((t) => t.resolution === null).length;
      const dropped = tasks.filter((t) => t.resolution === "dropped").length;
      const total = doneEver + openActive;
      const changeTimes = tasks.map((t) => t.lastChange).filter(Boolean);
      const seenTimes = tasks.map((t) => t.firstSeen).filter(Boolean);
      const lastActivity = changeTimes.sort().slice(-1)[0] || null;
      const firstActivity = seenTimes.sort()[0] || null;
      const epicEnded = goals.every((g) => g.rec.endedAt != null);
      const staleDays = daysSince(lastActivity, now);
      const status = epicStatus({
        hasOpen: openActive > 0, staleDays, epicEnded, regStatus: info.reg?.status,
        origin: info.reg?.origin, hasMembers: true, // nabızda göründüyse üyesi var
      });
      const sessionIds = [...new Set(goals.map((g) => g.rec.sessionId))];
      const members = sessionIds.map((sid) => {
        const sk = kunye.sessions?.[sid] || null;
        return { sessionId: sid, short: sk?.short || null, rol: sk?.rol || null, kunyeli: !!sk };
      });
      epics.push({
        id: info.id,
        title: info.title,
        provisional: info.provisional,
        status,
        kategori: info.kategori,
        amac: info.amac,
        kunyeli: !info.provisional && !!info.kategori,
        tags: info.reg?.tags || [],
        backlogRef: info.reg?.backlogRef || null,
        ...pmFields(info.reg),
        progress: { doneEver, openActive, dropped, pct: total ? Math.round((doneEver / total) * 100) : (doneEver ? 100 : 0) },
        firstActivity, lastActivity,
        ageDays: daysSince(firstActivity, now),
        staleDays,
        sessions: sessionIds,   // geriye-uyum: sid[]
        members,                // zengin biçim: {sessionId, short, rol, kunyeli}
        tasks: tasks.sort((a, b) => String(b.lastChange).localeCompare(String(a.lastChange))),
      });
    }
    // Nabızda izi olmayan PM epic'leri (henüz başlamamış hedefler) — registry'den enjekte et.
    // epicAssigner yalnız oturumdan epic doğurur; üyesiz hedef aksi halde HİÇ görünmez.
    injectPlanned(slug, epics);
    finalizeEpics(epics);

    const plans = readPlans(cwd);
    projects.push({ slug, dirName, cwd, epics, hedefler: rollupHedefler(slug, epics, plans), backlog: parseBacklog(cwd), plans });
  }

  // Hiç oturumu olmayan proje (PM hedef yazdı, iş henüz başlamadı) → loadSessions onu
  // hiç döndürmez. Registry slug'larından tamamla.
  const covered = new Set(projects.map((p) => p.slug));
  for (const slug of registrySlugs()) {
    if (covered.has(slug) || (projectFilter && slug !== projectFilter)) continue;
    const epics = [];
    injectPlanned(slug, epics);
    // cwd/dirName nabızdan gelemez; PM `atama` alanında verebilir (slug geri-çevrilemez).
    const at = epics.map((e) => e.atama).find(Boolean) || {};
    const cwd = at.cwd || null;
    const plans = readPlans(cwd);
    const hedefler = rollupHedefler(slug, epics, plans);
    if (!epics.length && !hedefler.length && !plans.length) continue;
    if (cwdPrefix && !(cwd === cwdPrefix || String(cwd || "").startsWith(cwdPrefix + "/"))) continue;
    finalizeEpics(epics);
    projects.push({ slug, dirName: at.dirName || slug, cwd, epics, hedefler, backlog: [], plans });
  }

  projects.sort((a, b) => a.dirName.localeCompare(b.dirName));

  // düz backlog[] (dashboard kolaylığı) + projede de tutulur
  const backlog = projects.flatMap((p) => p.backlog.map((b) => ({ project: p.slug, ...b })));
  return { schemaVersion: SCHEMA_VERSION, generatedAt: now, projects, backlog, pm: pmProjection(projects) };
}

function injectPlanned(slug, epics) {
  const seen = new Set(epics.map((e) => e.id));
  for (const reg of readEpicsReg(slug)) {
    if (reg.origin !== "pm" || seen.has(reg.id)) continue;
    epics.push(syntheticEpic(reg));
  }
}

/** epic blokajı (bagimli[] içinde bitmemiş epic'ler) + sıralama. */
function finalizeEpics(epics) {
  const byId = new Map(epics.map((e) => [e.id, e]));
  for (const e of epics) e.blokaj = (e.bagimli || []).filter((id) => byId.get(id)?.status !== "done");
  // açık işler önce; planlı (henüz başlamamış) hemen ardında; biten en altta
  const rank = { active: 0, planned: 1, stale: 2, paused: 3, dropped: 4, done: 5 };
  epics.sort((a, b) =>
    ((rank[a.status] ?? 9) - (rank[b.status] ?? 9)) ||
    (oncelikRank(a.oncelik) - oncelikRank(b.oncelik)) ||
    String(b.lastActivity).localeCompare(String(a.lastActivity)));
}

/** PM'in poll ettiği küçük yüzey: yalnız hedefler + PM kökenli/öncelikli epic'ler. */
function pmProjection(projects) {
  const out = [];
  for (const p of projects) {
    const epics = p.epics
      .filter((e) => e.origin === "pm" || e.oncelik)
      .map((e) => ({
        id: e.id, title: e.title, status: e.status, oncelik: e.oncelik, origin: e.origin,
        hedefRef: e.hedefRef, kabul: e.kabul, bagimli: e.bagimli, blokaj: e.blokaj,
        atama: e.atama, progress: e.progress, sessions: e.sessions,
      }));
    if (!epics.length && !p.hedefler.length && !(p.plans?.length)) continue;
    out.push({ slug: p.slug, dirName: p.dirName, cwd: p.cwd, hedefler: p.hedefler, epics, plans: p.plans || [] });
  }
  return { projects: out };
}

// ── GORUNUM.md projeksiyonu (epic-gruplu, BAYAT etiketli) ─────────────────────
export const STATUS_META = {
  active: { icon: "▶", label: "AKTİF" },
  planned: { icon: "◇", label: "PLANLANDI (henüz başlamadı)" },
  stale: { icon: "◑", label: "BAYAT (>7g dokunulmadı)" },
  paused: { icon: "⏸", label: "DURAKLADI (oturum kapandı, açık iş var)" },
  done: { icon: "✓", label: "TAMAMLANDI" },
  dropped: { icon: "✗", label: "BIRAKILDI" },
};
export function toMarkdown(model) {
  const L = [];
  L.push("# GÖRÜNÜM — görev veri modelinden türetildi (epic-gruplu)");
  L.push("");
  L.push("> Tek kaynak: `~/.claude/kaptan/goals/*` (+arşiv) + `epics/*` + `kunye/*` + `hedefler/*` + backlog.md + `<proje>/plans/INDEX.json` → `model.mjs`.");
  L.push("> Yeniden üret: `node ~/.claude/skills/kaptan/scripts/model.mjs --write`");
  L.push(`> Üretim: \`${model.generatedAt.slice(0, 16).replace("T", " ")}\` · schemaVersion ${model.schemaVersion}`);
  L.push("");
  const order = ["active", "planned", "stale", "paused", "done", "dropped"];
  for (const p of model.projects) {
    L.push(`## ${p.dirName}`);
    // PM proje hedefleri — epic'lerin üstünde, çünkü epic'ler bunlara hizmet eder
    if (p.hedefler?.length) {
      L.push("");
      L.push(`### ◎ PROJE HEDEFLERİ (${p.hedefler.length})`);
      for (const h of p.hedefler) {
        const meta = STATUS_META[h.durum] || { icon: "·" };
        const onc = h.oncelik ? ` \`${h.oncelik}\`` : "";
        const prog = h.progress.doneEver + h.progress.openActive > 0
          ? ` (${h.progress.doneEver}/${h.progress.doneEver + h.progress.openActive}, %${h.progress.pct})` : "";
        const oneri = h.origin === "damitma" && !h.onaylandi ? " ⟨öneri — onay bekliyor⟩" : "";
        L.push(`- ${meta.icon}${onc} **${h.text}**${prog}${oneri}`);
        if (h.neden) L.push(`  > ${h.neden}`);
        if (h.blokaj.length) L.push(`  ⛔ blokaj: ${h.blokaj.join(", ")}`);
        if (h.plan?.broken) L.push(`  ⛔ planRef kırık: ${h.plan.ref} (plans/INDEX.json'da yok)`);
        else if (h.plan) L.push(`  🗺 plan: ${h.plan.slug} v${h.plan.v} · ${h.plan.durum} · aşama ${h.plan.asamaKapali}/${h.plan.asamaToplam}`);
        for (const e of h.epics) L.push(`  - ${STATUS_META[e.status]?.icon || "·"} ${e.title} (%${e.pct})`);
        if (!h.epics.length) L.push("  - _(bağlı epic yok — iş henüz atanmadı)_");
      }
    }
    // plan ağacı (varsa) — kaynak: plan-organizatoru agac.mjs'in INDEX.json'u
    if (p.plans?.length) {
      const PLAN_ICON = { "AÇIK": "◇", "SÜRÜYOR": "▶", "KAPALI": "✓", "BLOKE": "⛔" };
      L.push("");
      L.push(`### 🗺 PLANLAR (${p.plans.length} · plans/INDEX.md)`);
      for (const pl of p.plans) {
        const asama = pl.asamaToplam ? ` · aşama ${pl.asamaKapali}/${pl.asamaToplam}` : "";
        const sira = pl.siradaki ? ` · sıradaki: ${pl.siradaki.no}-${pl.siradaki.ad}` : "";
        // künye: PM/insan "hangisi önce" sorusunu brifingde de künyeden okusun (liste zaten
        // künye puanına göre sıralı; künyesiz plan `künyesiz` ile İLAN edilir — sessiz eksik yok).
        const k = pl.kunye;
        const kunye = k && k.oncelik != null
          ? ` \`P${k.oncelik}\` ${k.kritiklik}/${k.aciliyet} · ${k.hacim}` : " `künyesiz`";
        const hedef = k?.hedef ? `\n    ↳ hedef: ${k.hedef}` : "";
        L.push(`- ${PLAN_ICON[pl.durum] || "·"} **${pl.slug}** v${pl.v}${pl.kategori ? ` \`${pl.kategori}\`` : ""}${kunye} — ${pl.title}${asama}${sira}${hedef}`);
      }
    }
    for (const st of order) {
      const grp = p.epics.filter((e) => e.status === st);
      if (!grp.length) continue;
      const meta = STATUS_META[st];
      L.push("");
      L.push(`### ${meta.icon} ${meta.label}`);
      for (const e of grp) {
        const prog = e.progress.doneEver + e.progress.openActive > 0
          ? ` (${e.progress.doneEver}/${e.progress.doneEver + e.progress.openActive}, %${e.progress.pct})` : "";
        const drop = e.progress.dropped ? ` · ${e.progress.dropped} bırakıldı` : "";
        const age = e.staleDays != null ? ` · son aktivite ${e.staleDays}g önce` : "";
        const sess = e.sessions.length > 1 ? ` · ${e.sessions.length} oturum` : "";
        const kat = e.kategori ? ` ${KATEGORI_META[e.kategori].icon}` : "";
        const box = st === "done" ? "x" : " ";
        const onc = e.oncelik ? ` \`${e.oncelik}\`` : "";
        const pm = e.origin === "pm" ? " ⟨PM⟩" : "";
        L.push(`- [${box}]${kat}${onc} **${e.title}**${prog}${drop}${age}${sess}${e.provisional ? "" : " ⟨künye⟩"}${pm}`);
        if (e.amac) L.push(`  > ${e.amac}`);
        if (e.blokaj?.length) L.push(`  ⛔ blokaj: ${e.blokaj.join(", ")}`);
        if (st !== "done" && st !== "dropped") {
          for (const t of e.tasks.filter((x) => x.resolution === null)) {
            const ki = KIND_META[t.kind]?.icon || "·";
            L.push(`  - ${t.status === "in_progress" ? "◐" : "○"} ${ki} ${t.short}`);
          }
        }
      }
    }
    // backlog (varsa) proje altında ayrı blok
    const openBL = p.backlog.filter((b) => b.status === "open");
    if (openBL.length) {
      L.push("");
      L.push(`### ⚙ BACKLOG (açık mühendislik borcu · ${openBL.length})`);
      for (const b of openBL) {
        const sev = b.severity === "yuksek" ? "🔴" : b.severity === "orta" ? "🟡" : "⚪";
        L.push(`- [ ] ${sev} **${b.id}** (${b.skill}) — ${b.desc.slice(0, 120)}`);
      }
    }
    L.push("");
  }
  if (!model.projects.length) L.push("_(nabızda görünür görev yok)_");
  return L.join("\n");
}

// ── CLI ───────────────────────────────────────────────────────────────────────
const isMain = (() => {
  try { return process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]; }
  catch { return false; }
})();
if (isMain) {
  const args = process.argv.slice(2);
  const val = (f) => (args.includes(f) ? args[args.indexOf(f) + 1] : null);
  const t0 = Date.now();
  if (args.includes("--write")) {
    // HATA YOLU: türetme/yazım okunamayan-kaynak/bozuk-arşiv/disk hatasıyla düşerse
    // `turetme` sınıfı bir HATA satırı düşür (sessiz ölme yok), sonra hatayı yeniden fırlat.
    let model;
    try {
      model = buildModel({ projectFilter: val("--project") });
      mkdirSync(join(CLAUDE, "kaptan"), { recursive: true });
      const body = JSON.stringify(model, null, 2);
      writeFileSync(MODEL_OUT, body);
      writeFileSync(GORUNUM_OUT, toMarkdown(model));
      // PM'in poll ettiği küçük yüzey — 2 MB'lık model.json'u parse etmesin
      writeFileSync(PM_OUT, JSON.stringify({ schemaVersion: SCHEMA_VERSION, generatedAt: model.generatedAt, ...model.pm }, null, 2));
      // Ölçüm: Stop hook'unda her duruşta TÜM arşiv global yeniden türetiliyor.
      // p95 > ~400ms ya da model.json > ~4MB olursa per-slug artımlı cache'e geç.
      try {
        appendFileSync(TIMING_OUT, JSON.stringify({
          ts: model.generatedAt, ms: Date.now() - t0, bytes: body.length, nSlugs: model.projects.length,
        }) + "\n");
      } catch { /* ölçüm asla yazımı bozmasın */ }
      const nHedef = model.projects.reduce((n, p) => n + (p.hedefler?.length || 0), 0);
      const nEpic = model.projects.reduce((n, p) => n + p.epics.length, 0);
      // OLAY: kaptan görev modeli yeniden türetildi (nabız→model chokepoint'i).
      olayYaz(OLAY_DEFTERI, {
        katman: "kaptan", tur: "event", sinif: "turetme", olay: "model-turetildi",
        baglam: { nProje: model.projects.length, nEpic, nHedef, ms: Date.now() - t0, bytes: body.length },
      });
      console.log(`yazıldı: ${MODEL_OUT} + ${GORUNUM_OUT} + ${PM_OUT} (${model.projects.length} proje, ${nEpic} epic, ${nHedef} hedef, ${Date.now() - t0}ms)`);
    } catch (e) {
      olayYaz(OLAY_DEFTERI, {
        katman: "kaptan", tur: "error", sinif: "turetme", olay: "turetme-basarisiz",
        baglam: { hata: String(e && e.message ? e.message : e).slice(0, 200), ms: Date.now() - t0 },
      });
      throw e;
    }
  } else {
    const model = buildModel({ projectFilter: val("--project") });
    process.stdout.write(JSON.stringify(args.includes("--pm") ? model.pm : model, null, 2) + "\n");
  }
}
