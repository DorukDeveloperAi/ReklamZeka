#!/usr/bin/env node
/**
 * pm PERSONA KATMANI — kullanıcının ham transcript'lerinden DEĞER/ÖNCELİK profili damıtır.
 *
 *   ~/.claude/projects/<slug>/<sid>.jsonl  →  claude CLI (headless)  →  pm/persona/profil.md
 *
 * distill.mjs'in kardeşi: aynı callClaude/parseJSONLoose/writeAtomic/aktivite-kapısı desenleri.
 * Ayrım: distill TodoWrite NABZINI okur (goals/*.json), persona ham KULLANICI METNİNİ okur.
 * Nabızda kullanıcının cümlesi yoktur; persona'nın hammaddesi tam da o cümledir.
 *
 * ÜRÜN, bir davranış kafesi DEĞİL bir LENS'tir. Profil PM'e "şöyle düşün" demez;
 * "şunu önemse, şuna dikkat et, şu çizgiyi geçme" der. PM'in yaratıcılığı, kod becerisi
 * ve mimari zekâsı serbest kalır — profil yalnız neyi ÖNEMSEYECEĞİNİ söyler.
 *
 * ÜÇ KATMANLI PERFORMANS SAVUNMASI (1108 jsonl, bazıları 300MB+; tam parse kabul edilemez):
 *   1) ALT-DİZİN ELEMESİ — yalnız <slug>/*.jsonl top-level. subagents/ ve workflows/ hiç
 *      açılmaz; devasa dosyaların çoğu oradadır ve isSidechain elemesini dosya açmadan halleder.
 *   2) mtime/size ÖN-FİLTRESİ — dokunulmamış dosya stat maliyetiyle atlanır, açılmaz.
 *   3) BYTE-OFFSET ARTIMLI STREAM — yalnız yeni byte'lar okunur. 44MB dosyaya 3 mesaj
 *      eklendiyse birkaç KB okunur. Truncate guard: size < offset ise offset sıfırlanır.
 *
 * İKİ KAPI (çalışılmayan saatte sıfır token — "eğer ben çalışmış isem" şartı):
 *   1) AKTİVİTE KAPISI — dokunulmuş dosya yoksa sessiz çık, LLM yok.
 *   2) KAPSAMA KAPISI  — dokunulmuş ama yeni SİNYAL mesajı çıkmadıysa (hepsi gürültü)
 *      offset'leri ilerlet, LLM'e gitme.
 * Damga yalnız BAŞARIDA ilerler: LLM çökerse profil de offset'ler de yazılmaz → aynı
 * mesajlar sonraki turda tekrar denenir, veri kaybı yok.
 *
 *   node persona.mjs [--dry-run] [--force] [--since <ISO>] [--model <m>] [--json]
 *   node persona.mjs --sayim    # LLM'siz teşhis: kapılar + stream + isSignal ölçümü
 */

import { homedir, tmpdir } from "node:os";
import { join, basename } from "node:path";
import { createHash } from "node:crypto";
import { spawn, execFileSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import {
  readFileSync, writeFileSync, mkdirSync, renameSync, statSync,
  readdirSync, existsSync, unlinkSync,
} from "node:fs";

const CLAUDE = join(homedir(), ".claude");
const PROJECTS = join(CLAUDE, "projects");
const PM = join(CLAUDE, "pm");
const PERSONA_DIR = join(PM, "persona");
const PROFILE = join(PERSONA_DIR, "profil.md");
const STATE_FILE = join(PERSONA_DIR, "persona-state.json");
const LOCK = join(PERSONA_DIR, ".lock");

// Model POLİTİKADAN gelir (hardcode yok — burada duran "claude-sonnet-5" sabiti
// politikanın hiçbir tier'ında olmayan bir modeli sürüyordu: tek baypas noktasıydı).
// Damıtma bir meta-LLM işidir → `hizli` tier'ı. Policy okunamazsa haiku'ya düşer.
const MAX_ITEMS = 8;             // bölüm başına madde tavanı
const ITEM_MAX = 140;            // madde karakter tavanı
const PROFILE_MAX_BYTES = 2560;  // profil toplam bütçesi (PM system prompt'unu şişirmesin)
const MAX_MSGS_PER_RUN = 60;     // tek LLM çağrısına (chunk) giren sinyal mesajı tavanı
const MAX_TOTAL_PER_RUN = 240;   // tek koşumdaki toplam sinyal tavanı → en fazla 4 LLM çağrısı
const MSG_MAX = 200;             // prompt'a giren mesaj kırpması
const DECAY_DAYS = 30;           // bu süre teyit edilmeyen madde "SOLMUŞ" işaretlenir

// ── STAGE P: proje profilleri (pm/projeler/<slug>/profil.md) ─────────────────
// Global profilin tam tersi yönde çalışır: domain SERBEST — "şirkete alışmak"
// burada olur. Global lens değerleri, proje profili o projenin dilini/araçlarını taşır.
const PROJELER_DIR = join(PM, "projeler");
const KAPTAN_PROJECTS = join(CLAUDE, "kaptan", "projects.json");
const PROJ_MAX_ITEMS = 6;        // bölüm başına madde tavanı
const PROJ_MAX_BYTES = 2048;     // proje profili toplam bütçesi
const PROJ_MIN_SIGNALS = 8;      // bu kadar YENİ sinyal birikmeden proje damıtılmaz
const PROJ_MAX_PER_RUN = 3;      // koşum başına damıtılan proje tavanı (maliyet)
const PROJ_MSGS_CAP = 60;        // proje başına LLM'e giren en yeni sinyal

const readJSON = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
const clean = (s) => String(s || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const hash = (s) => createHash("sha256").update(s).digest("hex").slice(0, 12);

// ═══════════════════════════════════════════════════════════════════════════
// ALTYAPI (distill.mjs'ten uyarlandı)
// ═══════════════════════════════════════════════════════════════════════════

/** Hesap/API limiti (429) — claude'un KENDİ çıktısından tanınır. Bu, "hata metnine bakma"
 *  anti-pattern'i DEĞİL: üretici tek ve güvenilir (claude süreci), rastgele bir kabuk komutu
 *  değil. Sınıf buradan çıkış KODUNA (75/EX_TEMPFAIL) çevrilir; Maestro yalnız kodu okur. */
const LIMIT_DESENI =
  /rate[_\s-]?limit|usage limit|spend limit|session limit|quota exceeded|too many requests|"?apiErrorStatus"?\s*:\s*429/i;
function limitHatasiYap(mesaj) {
  // F3: ham mesajı core'a PARSE ettir → limit-son.json'a HAZIR resetTs yaz (scheduler.mjs headless
  // retry'ı kör 15dk yerine GERÇEK reset anına çeker; B3 korunur: parse core'da, scheduler yalnız sayı
  // okur). Best-effort — aide erişilemezse limit-son güncellenmez → scheduler 15dk'ya düşer (asla kötü değil).
  try {
    execFileSync("aide", ["limit", "son", "--mesaj", String(mesaj).slice(0, 400)],
                 { timeout: 12_000, stdio: "ignore" });
  } catch { /* aide yok/yavaş → sessizce geç (never-worse fallback devrede) */ }
  const e = new Error(mesaj);
  e.limit = true; // → process.exit(75): "kaynak bekleyişi", deterministik arıza değil
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
    // claude prompt'u okumadan çıkarsa stdin EPIPE atar; dinlenmezse tüm koşum düşer.
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
      // Limit exit 0 + is_error:true olarak da gelebilir (envelope başarıyla yazılır, içerik hata).
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

/** Atomik yazım (tmp + rename). */
function writeAtomic(target, data) {
  mkdirSync(join(target, ".."), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}`;
  writeFileSync(tmp, typeof data === "string" ? data : JSON.stringify(data, null, 2), { mode: 0o600 });
  renameSync(tmp, target);
  return target;
}

const readState = () => readJSON(STATE_FILE) || { schemaVersion: 1, files: {}, maddeLastSeen: {} };
function writeState(s) { writeAtomic(STATE_FILE, s); }

/** Kilidin sahibi hâlâ yaşıyor mu — PID ile ölçülür, SÜRE ile değil.
 *
 *  signal 0: süreci öldürmez, yalnız varlığını sorar. ESRCH → süreç yok (kilit ölü).
 *  EPERM → süreç var ama başka kullanıcının (bizde olmaz; canlı say, güvenli taraf). */
function sahibiYasiyorMu(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false; // pid okunamadı → ölü say
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

/** Tek-koşum kilidi: saatlik job ile elle --force çakışırsa çift LLM faturası olmasın.
 *
 *  CANLILIK ÖLÇÜTÜ = PID, süre/mtime DEĞİL (aide /eszamanli doktrini; bu script ondan sapıyordu).
 *  Neden önemli: mtime eşiği iki yönden de yanılır. Ölçülen olay (2026-07-17): ölmüş bir --force
 *  koşumunun bıraktığı kilit 20 dakika boyunca CANLI sayıldı → o penceredeki saatlik koşum
 *  hiçbir şey yapmadan atlandı. Ters yönde daha kötüsü mümkündü: 20 dakikayı aşan meşru bir
 *  damıtma (büyük transcript) "bayat" sayılıp kilidi elinden alınır, iki koşum aynı profile
 *  yazardı — çift LLM faturası ve bozuk çıktı, yani kilidin var oluş sebebinin ihlali.
 *  PID ile ikisi de imkânsız: sahip yaşıyorsa bekle, ölmüşse DERHAL devral (süre beklemeden). */
function acquireLock() {
  mkdirSync(PERSONA_DIR, { recursive: true });
  try {
    writeFileSync(LOCK, String(process.pid), { flag: "wx" });
    return true;
  } catch {
    try {
      const sahip = Number.parseInt(readFileSync(LOCK, "utf8").trim(), 10);
      if (sahibiYasiyorMu(sahip)) return false; // gerçekten koşuyor → çekil
      // Sahip ölmüş: kilit öksüz. Süre beklemeden biç.
      unlinkSync(LOCK);
      writeFileSync(LOCK, String(process.pid), { flag: "wx" });
      process.stderr.write(`· öksüz kilit devralındı (sahip pid ${sahip} ölü)\n`);
      return true;
    } catch {
      return false; // yarış: başkası aldı ya da kilit okunamadı → çekil (güvenli taraf)
    }
  }
}
const releaseLock = () => { try { unlinkSync(LOCK); } catch {} };

// ═══════════════════════════════════════════════════════════════════════════
// KAYNAK KEŞİF + ARTIMLI OKUMA
// ═══════════════════════════════════════════════════════════════════════════

/**
 * YALNIZ top-level transcript'ler: <slug>/<sessionId>.jsonl
 * subagents/ ve workflows/ alt dizinlerine ASLA inilmez — hem devasa dosyaların çoğu
 * oradadır hem de onlar zaten isSidechain (kullanıcı sesi değil, agent sesi).
 */
function listTranscripts() {
  const out = [];
  let slugs;
  try { slugs = readdirSync(PROJECTS, { withFileTypes: true }); } catch { return out; }
  for (const d of slugs) {
    if (!d.isDirectory()) continue;
    const dir = join(PROJECTS, d.name);
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const f of entries) {
      if (!f.isFile() || !f.name.endsWith(".jsonl")) continue;   // alt dizinler burada düşer
      const file = join(dir, f.name);
      let st;
      try { st = statSync(file); } catch { continue; }
      out.push({
        key: `${d.name}/${f.name}`,
        file,
        slug: d.name,
        sessionId: basename(f.name, ".jsonl"),
        size: st.size,
        mtimeMs: st.mtimeMs,
      });
    }
  }
  return out;
}

/** Dosyanın yalnız YENİ byte'larını satır satır oku. Truncate guard dahil. */
function readNewLines(file, prevOffset) {
  return new Promise((resolve, reject) => {
    let start = prevOffset || 0, reset = false;
    let size;
    try { size = statSync(file).size; } catch { return resolve({ lines: [], newOffset: prevOffset || 0, reset: false }); }
    if (size < start) { start = 0; reset = true; }          // dosya yeniden yazılmış/kısalmış
    if (size === start) return resolve({ lines: [], newOffset: start, reset });

    const lines = [];
    const rs = createReadStream(file, { start, encoding: "utf8" });
    const rl = createInterface({ input: rs, crlfDelay: Infinity });
    rl.on("line", (l) => { if (l) lines.push(l); });
    rl.on("close", () => resolve({ lines, newOffset: size, reset }));
    rl.on("error", reject);
    rs.on("error", reject);
  });
}

/**
 * Satırlardan kullanıcının GERÇEKTEN yazdığı metni çıkar.
 * tool_result blokları da type:"user" altında gelir — yalnız type:"text" blokları alınır.
 */
function extractUserMessages(lines, ctx, stats) {
  const out = [];
  for (const line of lines) {
    let o;
    try { o = JSON.parse(line); } catch { stats.parseFail++; continue; }   // bozuk satır tüm dosyayı düşürmez
    if (o?.type !== "user" || o.isSidechain) continue;
    const c = o.message?.content;
    let text = null;
    if (typeof c === "string") text = c;
    else if (Array.isArray(c)) {
      const parts = c.filter((b) => b?.type === "text").map((b) => b.text);
      if (parts.length) text = parts.join(" ");
    }
    if (!text) continue;
    out.push({
      ts: o.timestamp || null,
      sessionId: o.sessionId || ctx.sessionId,
      slug: ctx.slug,
      userType: o.userType || null,
      text,
    });
  }
  return out;
}

const NOISE_TAG = /<(command-name|command-message|system-reminder|ide_selection|local-command)/;

/**
 * HARNESS SESİ — kullanıcı değil, Claude Code'un kendisi yazdı. Hepsi satır BAŞINDA görünür;
 * kullanıcı "Stop hook feedback:" diye bir cümleye başlamaz.
 * Not: hook sarmalları (`Stop hook feedback: [<koşul>]`) içinde kullanıcının gerçek talimatı
 * gömülüdür, ama harness onu tekrar tekrar enjekte eder ve kullanıcı o talimatı zaten normal
 * bir prompt olarak da yazmıştır. Sarmalı soymak kırılgan; elemek güvenli.
 */
const HARNESS = /^(\[Request interrupted|\[Image:|\[Tool |Stop hook feedback:|A session-scoped Stop hook|Continue from where you left off|Caveat:|This session is being continued|Base directory for this skill|Your tool call was malformed|<)/;

/** MAESTRO/AGENT İNJEKSİYONU — cümlenin ortasında da geçebilir (dağıtım metni sarmalı).
 *  Son iki desen: persona/distill damıtıcılarının KENDİ prompt'ları (tmpdir'deki headless
 *  `claude -p` oturumu transcript'e düşer) — damıtıcı kendi sesini sinyal sanmasın. */
const INJECTED = /\(kaptan dagitimi\)|\(kaptan dağıtımı\)|ON KOSUL:|ON KOŞUL:|^İşin hedefi:|^Kullanıcı isteği:|^Aşağıda "ybg" adlı|SADECE geçerli JSON/m;

const FILLER = /^(ok|okey|tamam|devam|devam et|evet|hayır|hayir|yes|no|dur|bekle|teşekkürler|tesekkurler|sağol|sagol|merhaba|selam|peki)[.!]?$/i;

const MIN_LEN = 12;

/**
 * GÜRÜLTÜ KAPISI. Elenen: harness sesi, maestro injeksiyonu, slash komutlar, içeriksiz
 * onaylar, yapıştırılmış kod/log/veri blokları. Kalan: kullanıcının gerçek talimatı.
 *
 * promptSource'a GÜVENME. Ölçüldü: "sdk" = VSCode eklentisinden gelen GERÇEK kullanıcı
 * promptu (entrypoint:claude-vscode, userType:external) — mesajların %61'i. Onu elemek
 * hammaddenin çoğunu atıyordu. Ters yönde: hook/maestro injeksiyonu tmux send-keys ile
 * girdiği için "typed" görünür. Yani kaynak alanı injeksiyonu ayırt EDEMEZ; ayrımı
 * yalnız içerik yapar (HARNESS + INJECTED). İnsan/agent ayrımı için userType kullanılır.
 */
function isSignal(m) {
  if (m.userType && m.userType !== "external") return false;                  // agent sesi
  const raw = String(m.text).trim();
  if (!raw) return false;
  if (raw.startsWith("/")) return false;                                      // slash komut
  if (NOISE_TAG.test(raw)) return false;                                      // harness tag'i
  if (HARNESS.test(raw)) return false;                                        // harness sesi
  if (INJECTED.test(raw)) return false;                                       // maestro/agent injeksiyonu
  if (FILLER.test(raw)) return false;                                         // içeriksiz onay

  // Yapıştırılmış kod/log/traceback: persona için değersiz, prompt'u şişirir.
  if (raw.includes("```") || raw.includes("Traceback")) return false;
  const nl = raw.split("\n").length;
  if (nl > 15 && (raw.match(/[{};]|=>|^\s{4,}/gm) || []).length > nl) return false;
  // Yapıştırılmış sayı tablosu/veri dökümü: normal cümlede rakam yoğunluğu %30'u geçmez.
  const digits = (raw.match(/\d/g) || []).length;
  if (raw.length > 40 && digits > raw.length * 0.3) return false;

  return clean(raw).length >= MIN_LEN;
}

/**
 * SİNYAL KURTARMA (isSignal'den ÖNCE koşar) — iki eski kör nokta:
 * 1) Slash-komut argümanı: "/iyilestirme şunu standart yap" gerçek niyettir; komut adı
 *    soyulur, ARGÜMAN sinyal sayılır. Çıplak "/komut" (argümansız) gürültü kalır.
 * 2) Kod bloklu mesaj: bloklar soyulduktan sonra kalan düzyazı yeterliyse (talimat +
 *    örnek kod deseni) metin tutulur; esas içerik kodduysa elenir.
 */
function refineSignal(m) {
  let t = String(m.text).trim();
  if (t.startsWith("/")) {
    const sp = t.search(/\s/);
    if (sp < 0) return null;                          // çıplak komut
    t = t.slice(sp + 1).trim();
    if (!t || /^--?[a-z]/i.test(t)) return null;      // yalnız bayrak/parametre
  }
  if (t.includes("```")) {
    const dis = t.replace(/```[\s\S]*?```/g, " ").replace(/```[\s\S]*$/, " ");
    if (clean(dis).length < MIN_LEN * 2) return null; // esas içerik koddu
    t = dis.trim();
  }
  return t === m.text ? m : { ...m, text: t };
}

/** Aynı talimat birçok dosyada/kez görünür (resume, hook tekrarı). İlk görüleni tut. */
function dedupe(msgs) {
  const seen = new Set();
  return msgs.filter((m) => {
    const k = clean(m.text).slice(0, 160).toLowerCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * PROJE DENGESİ — profilin tek projenin diline bulaşmasını önler.
 * Ölçüldü: dengesiz beslemede profil "doktor/şube/kurum/vergi" gibi domain terimleri
 * üretti; oysa profil PROJEDEN BAĞIMSIZ olmalı. Projelere round-robin pay verilir,
 * her projeden EN YENİ mesajlar alınır (güncel değerler daha alakalı), sonuç kronolojik
 * sıraya döndürülür (fold eskiden yeniye ilerlesin).
 */
function balance(msgs, cap) {
  const byProj = new Map();
  for (const m of msgs) {
    if (!byProj.has(m.slug)) byProj.set(m.slug, []);
    byProj.get(m.slug).push(m);
  }
  // her proje kendi içinde YENİDEN eskiye
  const lists = [...byProj.values()].map((a) => a.sort((x, y) => String(y.ts).localeCompare(String(x.ts))));
  const out = [];
  for (let i = 0; out.length < cap; i++) {
    let ekledi = false;
    for (const l of lists) {
      if (i >= l.length) continue;
      out.push(l[i]);
      ekledi = true;
      if (out.length >= cap) break;
    }
    if (!ekledi) break;   // tüm listeler tükendi
  }
  return out.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));   // kronolojik
}

// ═══════════════════════════════════════════════════════════════════════════
// PROFİL — parse / normalize / render / merge
// ═══════════════════════════════════════════════════════════════════════════

const H1 = "## 1. Çalışma tarzı ve hassasiyetler";
const H2 = "## 2. Karar kalıpları ve kırmızı çizgiler";
const H3 = "## 3. Elle küratörlü";

/** profil.md'yi üç bölüme ayır. CURATED bölümü HAM STRING olarak korunur. */
function splitProfile(md) {
  if (!md) return { bolum1: [], bolum2: [], curated: null };
  const i1 = md.indexOf(H1), i2 = md.indexOf(H2), i3 = md.indexOf(H3);
  if (i1 < 0 || i2 < 0 || i3 < 0) throw new Error("profil.md bölüm başlıkları bozuk");
  const items = (s) => s.split("\n").filter((l) => l.trim().startsWith("- ")).map((l) => l.trim().slice(2).trim());
  return {
    bolum1: items(md.slice(i1, i2)),
    bolum2: items(md.slice(i2, i3)),
    curated: md.slice(i3),   // başlık dahil, aynen geri konur
  };
}

/** Alan-düzeyi coerce: tek bozuk madde tüm turu çöpe atmaz (distill normalizeB felsefesi). */
function normalizeProfile(parsed) {
  const norm = (arr) => (Array.isArray(arr) ? arr : [])
    .map((x) => clean(String(x || "")).slice(0, ITEM_MAX))
    .filter(Boolean)
    .slice(0, MAX_ITEMS);
  const b1 = norm(parsed?.calisma_tarzi), b2 = norm(parsed?.karar_kaliplari);
  if (!b1.length && !b2.length) throw new Error("şema: iki bölüm de boş");
  return { bolum1: b1, bolum2: b2 };
}

function renderProfile({ bolum1, bolum2 }, curated) {
  const kur = curated ?? `${H3}\n<!-- CURATED: bu bölümü sen yazarsın, damıtıcı ASLA ezmez. -->\n\n`;
  return `# Persona: ybg — çalışma değerleri
<!-- Bu dosya PM agent'ın DEĞER/ÖNCELİK lensidir, davranış kafesi DEĞİLDİR.
     PM'e "şöyle düşün" demez; "şunu önemse, şuna dikkat et, şu çizgiyi geçme" der.
     Otomatik damıtılır (persona.mjs). Bölüm 3 elle yazılır ve korunur. -->

${H1}
<!-- LLM-yönetimli · en fazla ${MAX_ITEMS} madde · madde başına ≤${ITEM_MAX} karakter -->
${bolum1.map((x) => `- ${x}`).join("\n")}

${H2}
<!-- LLM-yönetimli · en fazla ${MAX_ITEMS} madde · kırmızı çizgiler ASLA/HER ZAMAN formunda -->
${bolum2.map((x) => `- ${x}`).join("\n")}

${kur}`;
}

// ═══════════════════════════════════════════════════════════════════════════
// STAGE P — proje profilleri
// ═══════════════════════════════════════════════════════════════════════════

const PH1 = "## 1. Bu projede çalışma tarzı";
const PH2 = "## 2. Doğrulama araçları ve kanıt reçeteleri";
const PH3 = "## 3. Proje kırmızı çizgileri";
const PH4 = "## 4. Elle küratörlü";

/** Slug kanonikleştirme — kaptan/projects.json aliases + ev-altı kuralının hafif hali. */
function slugAliases() {
  const cfg = readJSON(KAPTAN_PROJECTS);
  return cfg?.aliases || {};
}

function splitProjProfile(md) {
  if (!md) return { bolum1: [], bolum2: [], bolum3: [], curated: null };
  const i1 = md.indexOf(PH1), i2 = md.indexOf(PH2), i3 = md.indexOf(PH3), i4 = md.indexOf(PH4);
  if (i1 < 0 || i2 < 0 || i3 < 0 || i4 < 0) throw new Error("proje profili bölüm başlıkları bozuk");
  const items = (s) => s.split("\n").filter((l) => l.trim().startsWith("- ")).map((l) => l.trim().slice(2).trim());
  return {
    bolum1: items(md.slice(i1, i2)),
    bolum2: items(md.slice(i2, i3)),
    bolum3: items(md.slice(i3, i4)),
    curated: md.slice(i4),
  };
}

function normalizeProjProfile(parsed) {
  const norm = (arr) => (Array.isArray(arr) ? arr : [])
    .map((x) => clean(String(x || "")).slice(0, ITEM_MAX))
    .filter(Boolean)
    .slice(0, PROJ_MAX_ITEMS);
  const b1 = norm(parsed?.calisma_tarzi), b2 = norm(parsed?.dogrulama), b3 = norm(parsed?.kirmizi);
  if (!b1.length && !b2.length && !b3.length) throw new Error("şema: üç bölüm de boş");
  return { bolum1: b1, bolum2: b2, bolum3: b3 };
}

function renderProjProfile(slug, { bolum1, bolum2, bolum3 }, curated) {
  const kur = curated ?? `${PH4}\n<!-- CURATED: bu bölümü sen yazarsın, damıtıcı ASLA ezmez. -->\n\n`;
  return `# Proje profili: ${slug}
<!-- PM'in PROJE lensi — global persona/profil.md'nin tersine domain SERBEST:
     bu projenin dili, araçları, kanıt reçeteleri burada yaşar ("şirkete alışmak").
     Otomatik damıtılır (persona.mjs Stage P). Bölüm 4 elle yazılır ve korunur.
     Çatışma kuralı: kırmızı çizgiler global ∪ proje (asla gevşemez); tarzda spesifik kazanır. -->

${PH1}
<!-- LLM-yönetimli · ≤${PROJ_MAX_ITEMS} madde -->
${bolum1.map((x) => `- ${x}`).join("\n") || "- (henüz sinyal yok)"}

${PH2}
<!-- LLM-yönetimli · hangi iddia hangi komut/skill ile kanıtlanır -->
${bolum2.map((x) => `- ${x}`).join("\n") || "- (henüz sinyal yok)"}

${PH3}
<!-- LLM-yönetimli · ASLA/HER ZAMAN formunda -->
${bolum3.map((x) => `- ${x}`).join("\n") || "- (henüz sinyal yok)"}

${kur}`;
}

function buildProjPrompt(slug, messages, prev, solmus, mode) {
  const mevcut = mode === "seed"
    ? "(profil henüz yok — sıfırdan kur)"
    : `Bölüm 1 (bu projede tarz):\n${prev.bolum1.map((x) => `- ${x}${solmus.has(x) ? "   [SOLMUŞ]" : ""}`).join("\n") || "(boş)"}
Bölüm 2 (doğrulama/kanıt):\n${prev.bolum2.map((x) => `- ${x}${solmus.has(x) ? "   [SOLMUŞ]" : ""}`).join("\n") || "(boş)"}
Bölüm 3 (kırmızı çizgiler):\n${prev.bolum3.map((x) => `- ${x}${solmus.has(x) ? "   [SOLMUŞ]" : ""}`).join("\n") || "(boş)"}`;

  return `Aşağıda "ybg" adlı yazılımcının "${slug}" PROJESİNDEKİ Claude Code oturumlarında ajana
yazdığı gerçek talimatlar var. Görevin: bu PROJEYE ÖZGÜ çalışma profilini damıtmak.

Bu, global değer profilinin TERSİ: burada domain/araç dili SERBEST ve İSTENİR.
Proje adları, komutlar, skill'ler (/ana-kontrol gibi), dosya/dizin kalıpları, alan
terimleri — hepsi yazılabilir; PM bu projede çalışırken bu dili bilmek zorunda.

ÇIKTI BÖLÜMLERİ:
1) calisma_tarzi — bu projede nasıl çalışılıyor: iş akışı alışkanlıkları, hangi katman
   kanonik, neye önce bakılıyor, nelere tahammül yok.
2) dogrulama — KANIT REÇETELERİ: hangi iddia hangi komutla/skill'le kanıtlanır
   ("sayfa eklendi → /sayfa-kontrol", "kod değişti → bun run check" gibi).
3) kirmizi — bu projeye özgü kırmızı çizgiler, "ASLA ..." / "HER ZAMAN ..." formunda.

BÜTÇE: bölüm başına EN FAZLA ${PROJ_MAX_ITEMS} madde, madde ≤${ITEM_MAX} karakter. Mevcudu koru,
benzerleri birleştir, [SOLMUŞ] olanları tavan baskısında önce düşür. Türkçe, tek cümle, somut.
Sinyallerde geçmeyen şeyi UYDURMA; emin olmadığın reçeteyi yazma.

MEVCUT PROFİL:
${mevcut}

YENİ SİNYALLER (${messages.length} adet, kronolojik):
${messages.map((m, i) => `${i + 1}. ${clean(m.text).slice(0, MSG_MAX)}`).join("\n")}

ÇIKTI: SADECE geçerli JSON: {"calisma_tarzi":["..."],"dogrulama":["..."],"kirmizi":["..."]}`;
}

/**
 * Stage P ana akışı. Yeni sinyalleri kanonik slug'a kovalar; eşiği aşan projeleri
 * (en çok sinyalli PROJ_MAX_PER_RUN tanesi) `hizli` tier modeliyle damıtır.
 * Proje hatası koşumu düşürmez (yalnız o projenin state'i ilerlemez — offset'ler
 * paylaşıldığı için o sinyaller yeniden görülmez; profil kayan bir lens, defter değil).
 * Dönen: { rapor: [...], projeler: <state.projeler yeni hali> }
 */
/** Koşum sırasında hesap limiti görüldü mü — çıkış kodunu 75'e (EX_TEMPFAIL) çeker. */
let limitGoruldu = false;

async function stagePProjeler(tumSinyaller, state, { dryRun, model }) {
  const aliases = slugAliases();
  const kova = new Map();
  for (const m of tumSinyaller) {
    const slug = aliases[m.slug] || m.slug;
    if (slug === "-Users-ybg") continue;                              // ev dizini proje değil
    if (/^-(private-)?(var|tmp)-/.test(slug)) continue;               // tmpdir oturumları (headless -p)
    if (!kova.has(slug)) kova.set(slug, []);
    kova.get(slug).push(m);
  }
  const projState = { ...(state.projeler || {}) };
  const adaylar = [...kova.entries()]
    .filter(([, msgs]) => msgs.length >= PROJ_MIN_SIGNALS)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, PROJ_MAX_PER_RUN);
  const rapor = [];
  for (const [slug, msgs] of adaylar) {
    const dosya = join(PROJELER_DIR, slug, "profil.md");
    try {
      const prev = splitProjProfile(existsSync(dosya) ? readFileSync(dosya, "utf8") : null);
      const mode = prev.bolum1.length || prev.bolum2.length || prev.bolum3.length ? "update" : "seed";
      const lastSeen = projState[slug]?.maddeLastSeen || {};
      const esik = new Date(Date.now() - DECAY_DAYS * 864e5).toISOString();
      const solmus = new Set([...prev.bolum1, ...prev.bolum2, ...prev.bolum3].filter((x) => {
        const t = lastSeen[hash(x)];
        return t && t < esik;
      }));
      const grup = msgs.sort((a, b) => String(a.ts).localeCompare(String(b.ts))).slice(-PROJ_MSGS_CAP);
      process.stderr.write(`[persona:P] ${slug}: ${grup.length} sinyal → proje profili (model ${model})…\n`);
      const out = normalizeProjProfile(parseJSONLoose(await callClaude(buildProjPrompt(slug, grup, prev, solmus, mode), model)));
      let md = renderProjProfile(slug, out, prev.curated);
      if (Buffer.byteLength(md) > PROJ_MAX_BYTES) {
        out.bolum1 = out.bolum1.slice(0, PROJ_MAX_ITEMS - 1);
        out.bolum2 = out.bolum2.slice(0, PROJ_MAX_ITEMS - 1);
        out.bolum3 = out.bolum3.slice(0, PROJ_MAX_ITEMS - 1);
        md = renderProjProfile(slug, out, prev.curated);
      }
      if (dryRun) {
        rapor.push({ slug, sinyal: grup.length, dryRun: true, bytes: Buffer.byteLength(md) });
        process.stdout.write(`\n--- ${slug} (dry-run) ---\n${md}\n`);
      } else {
        writeAtomic(dosya, md);
        const now = new Date().toISOString();
        const seen = { ...lastSeen };
        for (const x of [...out.bolum1, ...out.bolum2, ...out.bolum3]) seen[hash(x)] = now;
        projState[slug] = {
          maddeLastSeen: seen,
          processedCount: (projState[slug]?.processedCount || 0) + grup.length,
          lastSuccessStamp: now,
        };
        rapor.push({ slug, sinyal: grup.length, bytes: Buffer.byteLength(md), wrote: true });
      }
    } catch (e) {
      // Tek projenin hatası koşumu düşürmez (damga ilerlemedi → sonraki turda yeniden denenir).
      // AMA limit sınıfı yukarı taşınır: yutulursa koşum exit 0 verir, Maestro "başarılı" sanar
      // ve 15 dk'lık limit backoff'u yerine tetiğin 1 saatini bekler.
      if (e.limit) limitGoruldu = true;
      process.stderr.write(`  ✗ ${slug} proje profili: ${e.message} (koşum sürüyor)\n`);
      rapor.push({ slug, hata: e.message });
    }
  }
  return { rapor, projeler: projState };
}

/** Damıtma modeli: aide model-policy `hizli` tier'ı. NOT: "hizli" ucuz DEMEK DEĞİLDİR —
 *  bu tier'ın modeli kullanıcı ayarıdır (bugün Opus 4.8; bilinçli seçim). Tier işin
 *  TİPİNİ söyler (mekanik/meta-LLM), fiyatını değil. Policy yoksa haiku'ya düşer. */
function hizliModel() {
  return readJSON(join(CLAUDE, "model-policy.json"))?.tiers?.hizli?.model || "claude-haiku-4-5";
}

// ═══════════════════════════════════════════════════════════════════════════
// DAMITMA PROMPT'U
// ═══════════════════════════════════════════════════════════════════════════

function buildPrompt(messages, prev, solmus, mode) {
  const mevcut = mode === "seed"
    ? "(profil henüz yok — sıfırdan kur)"
    : `Bölüm 1 (çalışma tarzı):\n${prev.bolum1.map((x) => `- ${x}${solmus.has(x) ? "   [SOLMUŞ]" : ""}`).join("\n") || "(boş)"}
Bölüm 2 (karar kalıpları):\n${prev.bolum2.map((x) => `- ${x}${solmus.has(x) ? "   [SOLMUŞ]" : ""}`).join("\n") || "(boş)"}
${prev.curated ? `\nKullanıcının ELLE yazdığı bölüm (yalnız bağlam — ÇIKTIYA KOYMA):\n${prev.curated.slice(0, 800)}` : ""}`;

  return `Aşağıda "ybg" adlı bir yazılımcının Claude Code oturumlarında AJANA yazdığı gerçek talimatlar var.
Görevin: bu talimatlardan onun PROJEDEN BAĞIMSIZ çalışma değerlerini damıtmak.

Bu profil, ybg adına karar veren bir PM ajanının system prompt'una girecek.

EN ÖNEMLİ KURAL — bu bir DAVRANIŞ KAFESİ değil, bir DEĞER/ÖNCELİK LENSİ'dir:
- Profil "şöyle düşün", "şu adımları izle" DEMEZ. PM'in yaratıcılığına, kod becerisine ve
  mimari zekâsına ket vurmamalı.
- Profil "şunu önemse", "şuna dikkat et", "şu çizgiyi asla geçme" DER. ybg'nin önemsediği
  sistematik şeyler, kreatif yaklaşımlar ve tekrar tekrar hatırlattığı kurallara sadakat.

PROJEDEN BAĞIMSIZ OL — bu EN SIK YAPILAN HATA, en çok buna dikkat et:
- YASAK (teknik): dosya yolu, port, CSS/framework/kütüphane/repo/fonksiyon adı.
- YASAK (ALAN/DOMAIN): sinyallerin geçtiği işin konusuna ait HİÇBİR terim. Örneğin
  doktor, hastane, randevu, fatura, vergi, zip, sayfa, tedavi, kurum, şube, slot...
  Bunlar o projenin dili; profil hepsinden bağımsız olmalı. Maddeyi ALAN-NÖTR yaz.
- İSTENEN: her projede geçerli, transfer edilebilir değer.

  KÖTÜ: "Kurum seviyesinde özetle yetinme, doktor kırılımına in."      ← domain sızmış
  İYİ : "Toplu özetle yetinmez; en granüler kırılımda çalışmak ister."

  KÖTÜ: "Faturayı hem KDV dahil hem hariç göster."                     ← domain sızmış
  İYİ : "Bir değerin ham ve türetilmiş hallerini birlikte görmek ister."

  KÖTÜ: "Sayfaları /sayfa-kontrol ile doğrula."                        ← araç sızmış
  İYİ : "Kanıtsız 'bitti' demeyi reddeder; her iddiayı çalıştırıp gösterir."

  Test: madde bambaşka bir projede aynen geçerli mi? Değilse yeniden yaz.

ÇIKTI BÖLÜMLERİ:
1) calisma_tarzi   — nasıl çalışmayı sever, neyi önce ister, neye tahammülü yok, kalite çıtası.
2) karar_kaliplari — tekrar eden talimatları ve kırmızı çizgileri. Kırmızı çizgiler
                     "ASLA ..." / "HER ZAMAN ..." formunda yazılır.

BÜTÇE VE BUDAMA (kritik — profil şişmemeli):
- Bölüm başına EN FAZLA ${MAX_ITEMS} madde, madde başına EN FAZLA ${ITEM_MAX} karakter.
- Yeni madde eklemek ZORUNDA DEĞİLSİN. Mevcut maddeleri koru, benzer olanları BİRLEŞTİR,
  artık gözlenmeyen zayıf maddeleri ÇIKAR. Amaç en keskin ${MAX_ITEMS} madde — biriktirme değil.
- [SOLMUŞ] işaretli maddeler ${DECAY_DAYS}+ gündür yeni sinyalle teyit edilmedi. Tavan baskısı
  varsa ÖNCE onları düşür. Yeni sinyal onları teyit ediyorsa işareti yok say ve koru.
- Maddeler TÜRKÇE, tek cümle, somut. Genel geçer laf yazma ("kaliteli kod sever" gibi).

MEVCUT PROFİL:
${mevcut}

YENİ SİNYALLER (${messages.length} adet, kronolojik):
${messages.map((m, i) => `${i + 1}. ${clean(m.text).slice(0, MSG_MAX)}`).join("\n")}

ÇIKTI: SADECE geçerli JSON. Markdown kod bloğu, açıklama, önsöz YOK.
Şema: {"calisma_tarzi":["..."],"karar_kaliplari":["..."]}`;
}

const chunk = (arr, n) => { const o = []; for (let i = 0; i < arr.length; i += n) o.push(arr.slice(i, i + n)); return o; };

// ═══════════════════════════════════════════════════════════════════════════
// ANA AKIŞ
// ═══════════════════════════════════════════════════════════════════════════

const argv = process.argv.slice(2);
const has = (f) => argv.includes(`--${f}`);
const opt = (f, d) => { const i = argv.indexOf(`--${f}`); return i > -1 ? argv[i + 1] : d; };

const dryRun = has("dry-run");
const force = has("force");
const asJson = has("json");
const sayim = has("sayim");   // LLM'siz teşhis: kapıları ve gürültü filtresini ölç, hiçbir şey yazma
const since = opt("since", null);
const model = opt("model", hizliModel());

const rapor = { taranan: 0, okunan: 0, okunanByte: 0, sinyal: 0, ham: 0, parseFail: 0, chunks: 0, profileBytes: 0, wrote: false, atlandi: null };
const log = (s) => { if (!asJson) console.log(s); };

// KİLİT MEŞGUL = "kaynak bekleyişi", BAŞARI DEĞİL → 75 (EX_TEMPFAIL), limit deseniyle aynı sınıf.
//
// Eskiden exit(0) idi ve bu SESSİZ ÖLÜM üretiyordu: Maestro 0'ı başarı sayıp "fired ✓"
// yazıyor, fail_count'u sıfırlıyor, next_fire'ı ileri atıyordu. Ölçülen sonuç (2026-07-17):
// asılı bir --force koşumunun bıraktığı kilit yüzünden saatlik iş damıtma YAPMADAN
// "başarılı" göründü; persona profili 18 saat bayatladı ve HİÇBİR alarm çıkmadı.
// Hiçbir şey yapmayan bir iş, gürültülü başarısız olandan daha tehlikelidir.
// 75 ile Maestro bunu `busy` sınıfına alır: park YOK, retry VAR, sahte başarı YOK.
if (!acquireLock()) {
  if (asJson) console.log(JSON.stringify({ ...rapor, atlandi: "kilit" }));
  else console.log("· başka bir persona koşumu sürüyor → atlandı (kilit meşgul)");
  process.exit(75);
}
// process.exit() finally'yi ATLAR — kilit yalnız 'exit' olayıyla güvenle bırakılır.
process.on("exit", releaseLock);

try {
  const state = readState();
  const files = listTranscripts();
  rapor.taranan = files.length;

  // ── KAPI 1: AKTİVİTE ────────────────────────────────────────────────────
  // Dokunulmamış dosya açılmaz bile — yalnız stat maliyeti.
  const touched = files.filter((f) => {
    if (force) return true;
    const p = state.files[f.key];
    return !p || f.mtimeMs > p.mtimeMs || f.size !== p.size;
  });

  if (!touched.length) {
    log(`· nabız değişmedi (${files.length} transcript taranmış, hiçbiri dokunulmamış) → atlandı`);
    rapor.atlandi = "aktivite";
    if (asJson) console.log(JSON.stringify(rapor));
    process.exit(0);
  }

  // ── Artımlı okuma: yalnız yeni byte'lar ─────────────────────────────────
  const stats = { parseFail: 0 };
  let mesajlar = [];
  const nextFiles = { ...state.files };

  for (const f of touched) {
    const prev = force || sayim ? null : state.files[f.key];
    const start = prev?.offset || 0;
    const { lines, newOffset, reset } = await readNewLines(f.file, start);
    if (reset) process.stderr.write(`  · offset sıfırlandı (dosya kısalmış): ${f.key}\n`);
    rapor.okunan++;
    rapor.okunanByte += Math.max(0, newOffset - start);
    mesajlar.push(...extractUserMessages(lines, f, stats));
    nextFiles[f.key] = { offset: newOffset, mtimeMs: f.mtimeMs, size: f.size };
  }
  rapor.parseFail = stats.parseFail;
  rapor.ham = mesajlar.length;

  // ── KAPI 2: KAPSAMA ─────────────────────────────────────────────────────
  let sinyaller = dedupe(mesajlar.map(refineSignal).filter(Boolean).filter(isSignal));
  if (since) sinyaller = sinyaller.filter((m) => m.ts && m.ts >= since);
  const bulunan = sinyaller.length;
  // Stage P proje kovaları GLOBAL tavandan ÖNCE ayrılır (balance 240'a kırpar;
  // proje damıtması kendi projesinin tüm yeni sinyalini görmeli).
  const tumSinyaller = sinyaller;
  // Proje-dengeli örnekleme + tavan. Tavana takılan sinyal SESSİZCE düşmez, bildirilir.
  sinyaller = balance(sinyaller, MAX_TOTAL_PER_RUN);
  rapor.sinyal = sinyaller.length;
  rapor.tavanaTakilan = bulunan - sinyaller.length;
  if (rapor.tavanaTakilan > 0) {
    process.stderr.write(`  uyarı: ${bulunan} sinyalden en yeni ${sinyaller.length} tanesi alındı (proje-dengeli); ${rapor.tavanaTakilan} tanesi tavana takıldı\n`);
  }

  // Teşhis: LLM'e gitmeden kapıların ve gürültü filtresinin ne yaptığını göster.
  if (sayim) {
    if (asJson) console.log(JSON.stringify({ ...rapor, atlandi: "sayim" }));
    else {
      const mb = (rapor.okunanByte / 1048576).toFixed(1);
      console.log(`taranan transcript : ${rapor.taranan}`);
      console.log(`dokunulmuş (açılan): ${rapor.okunan}  (${mb} MB okundu)`);
      console.log(`ham kullanıcı mesajı: ${rapor.ham}`);
      console.log(`sinyal (gürültü sonrası): ${rapor.sinyal}   [eleme: %${rapor.ham ? Math.round(100 - (rapor.sinyal / rapor.ham) * 100) : 0}]`);
      console.log(`bozuk satır: ${rapor.parseFail}`);
      const n = +opt("ornek", 5);
      const adim = Math.max(1, Math.floor(sinyaller.length / n));
      console.log(`\n${n} örnek sinyal (eşit aralıklı):`);
      for (let i = 0; i < sinyaller.length && i / adim < n; i += adim) {
        console.log(`  · ${clean(sinyaller[i].text).slice(0, 110)}`);
      }
      // Stage P kovaları: hangi proje eşiği aşıyor?
      const aliases = slugAliases();
      const kova = new Map();
      for (const m of tumSinyaller) {
        const s = aliases[m.slug] || m.slug;
        if (s === "-Users-ybg" || /^-(private-)?(var|tmp)-/.test(s)) continue;
        kova.set(s, (kova.get(s) || 0) + 1);
      }
      console.log(`\nStage P kovaları (eşik ${PROJ_MIN_SIGNALS}, koşum tavanı ${PROJ_MAX_PER_RUN} proje):`);
      for (const [s, c] of [...kova.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)) {
        console.log(`  ${c >= PROJ_MIN_SIGNALS ? "✓" : "·"} ${s}: ${c}`);
      }
    }
    process.exit(0);
  }

  if (!sinyaller.length) {
    log(`· ${rapor.okunan} dosya okundu, sinyal mesaj yok (hepsi gürültü/injeksiyon) → LLM çağrısı yok`);
    rapor.atlandi = "kapsama";
    if (!dryRun) writeState({ ...state, schemaVersion: 2, files: nextFiles, lastRunAt: new Date().toISOString() });
    if (asJson) console.log(JSON.stringify(rapor));
    process.exit(0);
  }

  // ── Mevcut profil + çürüme ──────────────────────────────────────────────
  let prev;
  try {
    prev = splitProfile(existsSync(PROFILE) ? readFileSync(PROFILE, "utf8") : null);
  } catch (e) {
    // Kullanıcı elle bozmuşsa: HİÇBİR ŞEY YAZMA. Elle emek asla riske girmez.
    console.error(`✗ ${e.message} → profil dokunulmadan bırakıldı`);
    process.exit(1);
  }
  const mode = prev.bolum1.length || prev.bolum2.length ? "update" : "seed";

  const lastSeen = state.maddeLastSeen || {};
  const esik = new Date(Date.now() - DECAY_DAYS * 864e5).toISOString();
  const solmus = new Set([...prev.bolum1, ...prev.bolum2].filter((x) => {
    const t = lastSeen[hash(x)];
    return t && t < esik;
  }));

  // ── Damıtma: chunk + fold (her chunk'ın çıktısı sonrakinin "mevcut profil"i) ──
  const gruplar = chunk(sinyaller, MAX_MSGS_PER_RUN);
  rapor.chunks = gruplar.length;
  let cur = { bolum1: prev.bolum1, bolum2: prev.bolum2, curated: prev.curated };

  for (const [i, grup] of gruplar.entries()) {
    process.stderr.write(`[persona] damıtılıyor: chunk ${i + 1}/${gruplar.length} (${grup.length} sinyal, model ${model})…\n`);
    const out = normalizeProfile(parseJSONLoose(await callClaude(buildPrompt(grup, cur, solmus, i === 0 ? mode : "update"), model)));
    cur = { ...out, curated: prev.curated };
  }

  // ── Bütçe denetimi + yazım ──────────────────────────────────────────────
  let md = renderProfile(cur, prev.curated);
  if (Buffer.byteLength(md) > PROFILE_MAX_BYTES) {
    process.stderr.write(`  uyarı: profil ${Buffer.byteLength(md)}B > ${PROFILE_MAX_BYTES}B tavanı — maddeler kırpıldı\n`);
    cur.bolum1 = cur.bolum1.slice(0, MAX_ITEMS - 1);
    cur.bolum2 = cur.bolum2.slice(0, MAX_ITEMS - 1);
    md = renderProfile(cur, prev.curated);
  }
  rapor.profileBytes = Buffer.byteLength(md);

  // ── STAGE P: proje profilleri (global damıtma başarısından sonra, state'ten önce) ──
  const stageP = await stagePProjeler(tumSinyaller, state, { dryRun, model: hizliModel() });
  rapor.projeler = stageP.rapor;

  if (dryRun) {
    if (!asJson) console.log(md);
  } else {
    writeAtomic(PROFILE, md);
    rapor.wrote = true;
    // Damga + lastSeen yalnız BAŞARIDA ilerler.
    const now = new Date().toISOString();
    const seen = { ...lastSeen };
    for (const x of [...cur.bolum1, ...cur.bolum2]) seen[hash(x)] = now;
    writeState({
      schemaVersion: 2,
      lastRunAt: now,
      lastSuccessStamp: now,
      processedCount: (state.processedCount || 0) + sinyaller.length,
      files: nextFiles,
      maddeLastSeen: seen,
      projeler: stageP.projeler,
    });
    const pOzet = stageP.rapor.filter((r) => r.wrote).map((r) => r.slug).join(", ") || "-";
    log(`✓ persona: ${sinyaller.length} sinyal · ${gruplar.length} çağrı · ${rapor.profileBytes}B → ${PROFILE} · proje profilleri: ${pOzet}`);
  }
  if (asJson) console.log(JSON.stringify({ ...rapor, limit: limitGoruldu }));
  // Kısmi limit: ana profil geçmiş olsa da bir proje profili limite çarptıysa koşum BİTMEMİŞTİR.
  // 75 → Maestro 15 dk sonra yeniden dener; damgalar sayesinde yalnız eksik kalan parça koşar.
  if (limitGoruldu) console.error("  ⏳ hesap limiti: bazı proje profilleri atlandı — 75 ile çıkılıyor (yeniden denenecek)");
  process.exit(limitGoruldu ? 75 : 0);
} catch (e) {
  // Hata → profil de state de YAZILMAZ: aynı mesajlar sonraki turda tekrar denenir.
  // ÇIKIŞ KODU SINIFI TAŞIR: 75 (EX_TEMPFAIL) = hesap limiti, deterministik arıza DEĞİL —
  // Maestro bunu `busy` gibi ele alır (sayaca yazmaz, park etmez, 15 dk sonra yeniden dener).
  // Kod yerine mesaj metnine bakmak, bu sınıfı taklit edilebilir kılardı (bkz. scheduler B3).
  console.error(`✗ persona: ${e.message}`);
  if (asJson) console.log(JSON.stringify({ ...rapor, hata: e.message, limit: !!e.limit }));
  process.exit(e.limit ? 75 : 1);
}
