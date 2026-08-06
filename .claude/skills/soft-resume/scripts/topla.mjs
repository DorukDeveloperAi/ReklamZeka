#!/usr/bin/env node
// soft-resume TOPLAYICI — deterministik MOTOR, 0 token. LLM doğurmaz.
//
// NEDEN VAR: hard resume (`claude --resume <id>`) hesaba/makineye kilitlidir; token'ı
// biten bir hesabın session'ı o yolla ölüdür. Soft-resume o session'ın "ne amaçtı,
// nerede kaldı, planlar neydi" bilgisini transcript + kaptan hedefi + plan ağacı +
// DEVRALIS.md'den TOPLAR; damıtmayı (agentic anlamlandırma) DEVRALAN oturum yapar.
//
// SÖZLEŞME (kullanıcı kararı 2026-07-23): kapatan taraf agentic iş YAPMAZ — devir
// deterministik kalır; anlamlandırma yükü devralanındır. Bu script o sözleşmenin
// toplama yarısıdır: aynı girdi → aynı çıktı, ajan doğurmaz.
//
// VERİ YÖNÜ KURALI (yanlış depodan okumak brifi YALANLAŞTIRIR):
//   - transcript + kaptan hedefi → session hangi DEPODAYSA (~/.claude, ~/.claude-hesap2…)
//     O depodan okunur (ölü hesabın hedefleri kendi deposunda yaşar);
//   - plan ağacı + DEVRALIS.md + git → PROJE tarafından okunur (hesap-bağımsız, git-izli).
//
// Kullanım:
//   node topla.mjs --liste [--proje <root>] [--gun 14]     # aday session envanteri
//   node topla.mjs --session <id> [--depo <dir>] [--tail 30]  # tek session demeti (JSON)
//     [--yalin]        proje tarafını (plan · DEVRALIS · git) atla — çağıran bir kez ölçer
//     [--ozet-tavan N] harness compact özeti için karakter tavanı (varsayılan 20.000)
import { readFileSync, readdirSync, statSync, existsSync, openSync, readSync, closeSync } from "node:fs";
import { join, resolve, basename } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";

const HOME = process.env.HOME || homedir();

// ── argümanlar ───────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const opt = { liste: false, session: null, depo: null, proje: null, gun: 14, tail: 30, yalin: false, ozetTavan: 20_000 };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--liste") opt.liste = true;
  else if (a === "--session") opt.session = argv[++i];
  else if (a === "--depo") opt.depo = argv[++i];
  else if (a === "--proje") opt.proje = resolve(argv[++i]);
  else if (a === "--gun") opt.gun = Number(argv[++i]) || 14;
  else if (a === "--tail") opt.tail = Number(argv[++i]) || 30;
  // --yalin: PROJE tarafını (plan ağacı · DEVRALIS · git) atla. Neden var: aynı repodaki N
  // session için proje tarafı N kez ölçülürdü ve N kez AYNI çıkar (agac.mjs saniyeler sürer).
  // Çağıran (kasa.mjs) bir kez tam demet alır, kalanları yalın ister. Atlanan alan null olur
  // ve `uyarilar[]`de İLAN edilir — sessiz eksik yok.
  else if (a === "--yalin") opt.yalin = true;
  else if (a === "--ozet-tavan") opt.ozetTavan = Number(argv[++i]) || 20_000;
}

// ── sır eleği — desen kaynağı: packages/core/src/bilgi-sinif.ts (SIR_ICERIK) ─
// Transcript kullanıcı metnidir, token taşıyabilir. Eleği MODELE bırakma: buradan
// çıkan her serbest metin alanı elekten geçer; eşleşen alan TAMAMEN düşer (kırpma
// değil — token'ın parçası da sırdır; devralis.ts `sirsiz` kuralı).
const SIR_DESENLERI = [
  { ad: "anthropic/openai", re: /\bsk-[A-Za-z0-9_-]{20,}/ },
  { ad: "github", re: /\bgh[pousr]_[A-Za-z0-9]{30,}/ },
  { ad: "slack", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}/ },
  { ad: "aws", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { ad: "google", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { ad: "telegram-bot", re: /\b\d{8,10}:[A-Za-z0-9_-]{35}\b/ },
  { ad: "özel-anahtar", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
];
function sirsiz(s) {
  if (s == null) return s;
  const t = String(s);
  for (const d of SIR_DESENLERI) if (d.re.test(t)) return "«sır içerdiği için çıkarıldı»";
  return t;
}
/** SATIR granülünde elek — YALNIZ compact özeti için (İLANLI istisna).
 *  Neden ayrı: compact özet ~20 KB'lık TEK alandır; alan-granülü elek tek bir token yüzünden
 *  devrin en değerli parçasını komple silerdi. Eleğin GEREKÇESİ korunuyor: sır satırı yarım
 *  bırakılmaz, TAMAMEN düşer (sır satır sınırını aşmaz) ve kaç satırın düştüğü RAPORLANIR —
 *  sessiz kırpma yok. Alan-granülü `sirsiz` diğer tüm alanlarda aynen geçerlidir. */
function sirsizSatirlar(s) {
  if (s == null) return { metin: null, elenen: 0 };
  let elenen = 0;
  const metin = String(s)
    .split("\n")
    .filter((satir) => {
      const kirli = SIR_DESENLERI.some((d) => d.re.test(satir));
      if (kirli) elenen++;
      return !kirli;
    })
    .join("\n");
  return { metin, elenen };
}

// ── depo keşfi — ~/.claude + ~/.claude-* + CLAUDE_CONFIG_DIR ─────────────────
function depolar() {
  const out = new Set();
  if (process.env.CLAUDE_CONFIG_DIR && existsSync(process.env.CLAUDE_CONFIG_DIR))
    out.add(resolve(process.env.CLAUDE_CONFIG_DIR));
  try {
    for (const d of readdirSync(HOME)) {
      if (d === ".claude" || d.startsWith(".claude-")) {
        const p = join(HOME, d);
        if (existsSync(join(p, "projects"))) out.add(p);
      }
    }
  } catch {}
  return [...out];
}

// ── transcript okuma desenleri (emsal: kaptan durum.mjs + core devralis.ts) ──
function cwdFromTranscript(p) {
  // İlk 64KB'ta "cwd" alanı — tam parse gerekmez, dosya dev olabilir.
  try {
    const fd = openSync(p, "r");
    const buf = Buffer.alloc(64 * 1024);
    const n = readSync(fd, buf, 0, buf.length, 0);
    closeSync(fd);
    const h = buf.toString("utf8", 0, n).match(/"cwd":"([^"]+)"/);
    return h ? h[1] : null;
  } catch { return null; }
}

/** İçeriksiz devam sözcükleri — son istek olarak alınırsa "nerede kaldık" cevapsız kalır. */
const BOS_ISTEK = /^(devam|devam et|tamam|ok|evet|hayır|peki|olur|güzel|teşekkürler|sağol|dur|bekle)[\s.!?]*$/i;

/** HARNESS'IN SESİ — `user` rolüyle gelir ama kullanıcı YAZMAMIŞTIR (hook çıktısı · kesinti
 *  bildirimi · araç sonucu metni). Elenmezse devrin en kritik iki alanını zehirler: ölçüldü
 *  2026-08-03'te bir kasa kaydında `amac` = "Stop hook feedback: 1 açık madde…" çıktı — yani
 *  "bu oturum ne için açılmıştı" sorusunun cevabı bir hook'un kendi metniydi. `<`/system-reminder
 *  elemesi zaten vardı; bu desenler onun EKSİK kalan yüzü. Emsal doktrin: "onlar harness'ın sesi". */
const HARNESS_SESI = [
  /^Stop hook feedback:/i,
  /^\[Request interrupted/i,
  /^API Error/i,
  /hook feedback:/i,
  /^This session is being continued from a previous conversation/i,
];
const harnessMi = (t) => HARNESS_SESI.some((re) => re.test(t));

/** ENJEKSİYON ETİKETLERİ — IDE/harness kullanıcının mesajına KENDİ bloğunu ekler; blok
 *  kullanıcının cümlesiyle AYNI mesajın içindedir. "`<` ile başlıyorsa at" kuralı bu yüzden
 *  fazla keskindi: ölçüldü 2026-08-03 — VSCode oturumunun ilk isteği
 *  `<ide_opened_file>…</ide_opened_file> agent-ide projesini … pull et` idi ve mesaj komple
 *  atıldığı için `amac` NULL çıkıyordu. Doğrusu: bloğu SOY, kullanıcının cümlesini KORU.
 *  Liste KAPALIDIR (bilinen enjeksiyon adları) — rastgele `<tag>` soyulmaz, kullanıcı XML
 *  yapıştırmış olabilir. */
const ENJEKSIYON_ETIKET = /<(ide_opened_file|ide_selection|ide_diagnostics|system-reminder|command-name|command-message|command-args|local-command-stdout|user-prompt-submit-hook)>[\s\S]*?<\/\1>/g;
const etiketSoy = (t) => String(t).replace(ENJEKSIYON_ETIKET, " ").replace(/\s+/g, " ").trim();

/** Tek geçişte: ilk istek + son ANLAMLI istek + son TodoWrite + son N mesaj kuyruğu.
 *  Hook/sistem enjeksiyonları (`<system-reminder>` vb.) atlanır — onlar harness'ın sesi. */
function transcriptOku(p, tailN) {
  const KUYRUK_TAVAN = 64 * 1024; // toplam kuyruk bütçesi — dev transcript'te taşma yok
  let ilk, son, sonZaman, sonTodolar = null;
  let compact = null, compactTs = null;   // context sıfırlanınca harness'ın yazdığı özet
  const kuyruk = [];
  let ham;
  try { ham = readFileSync(p, "utf8"); } catch { return null; }
  for (const satir of ham.split("\n")) {
    if (!satir.trim()) continue;
    let j; try { j = JSON.parse(satir); } catch { continue; } // bozuk satır özeti öldürmez
    /* COMPACT ÖZET — harness context sıfırlarken KENDİ yazdığı devir metni. Bir oturumun
       "şimdiye kadar ne oldu"sunun en yoğun hâlidir ve BEDAVA'dır (LLM ZATEN üretti, biz
       yalnız hasat ediyoruz → motor 0 token kalır). En SONuncusu tutulur: özet kümülatiftir.
       İki sebeple akıştan AYRILIR: (1) 20 KB'lık bir "user" mesajı olarak ilkIstek/sonIstek'i
       zehirlerdi — compact'lenmiş bir oturumda `acilisIstek` "This session is being continued
       from…" olurdu (ölçüldü); (2) kuyruk tavanını tek başına doldururdu. */
    if (j.isCompactSummary) {
      const c = j.message?.content;
      const t = typeof c === "string" ? c
        : Array.isArray(c) ? c.filter((x) => x.type === "text").map((x) => x.text).join("\n") : "";
      if (t) { compact = t; compactTs = j.timestamp ?? null; }
      continue;
    }
    // Son TodoWrite = en güçlü "nerede kaldı" sinyali (nabız da bundan türer).
    if (j.type === "assistant" && Array.isArray(j.message?.content)) {
      for (const c of j.message.content)
        if (c.type === "tool_use" && c.name === "TodoWrite" && Array.isArray(c.input?.todos))
          sonTodolar = c.input.todos.map((t) => ({ content: String(t.content).slice(0, 200), status: t.status }));
    }
    const role = j.type === "user" ? "user" : j.type === "assistant" ? "assistant" : null;
    if (!role) continue;
    const c = j.message?.content;
    let metin = typeof c === "string" ? c
      : Array.isArray(c) ? c.filter((x) => x.type === "text").map((x) => x.text).join(" ") : "";
    metin = metin.replace(/\s+/g, " ").trim();
    if (role === "user") metin = etiketSoy(metin);   // blok soyulur, cümle korunur
    if (!metin) continue;                            // saf enjeksiyondu — kuyruğa da girmez
    if (role === "user") {
      if (!(metin.startsWith("<") || metin.includes("system-reminder") || metin.includes("Caveat:") || harnessMi(metin))) {
        if (!ilk) ilk = metin;
        if (!BOS_ISTEK.test(metin)) { son = metin; sonZaman = j.timestamp; }
      } else continue; // enjeksiyon kuyruğa da girmez
    }
    kuyruk.push({ role, text: metin.slice(0, 500) });
    while (kuyruk.length > tailN || JSON.stringify(kuyruk).length > KUYRUK_TAVAN) kuyruk.shift();
  }
  const el = sirsizSatirlar(compact);
  const tam = el.metin;
  const kirpildi = !!tam && tam.length > opt.ozetTavan;
  return {
    ilkIstek: sirsiz(ilk), sonIstek: sirsiz(son), sonZaman,
    sonTodolar,
    kuyruk: kuyruk.map((m) => ({ role: m.role, text: sirsiz(m.text) })),
    // Kırpma KUYRUKTAN değil BAŞTAN yapılır: compact özetin sonu "nerede kaldık"tır,
    // başı ise en eski (ve en eskimiş) bağlamdır — devralan için değerli uç SONdur.
    compact: tam == null ? null : {
      metin: kirpildi ? `«baştan ${tam.length - opt.ozetTavan} karakter kırpıldı»\n${tam.slice(-opt.ozetTavan)}` : tam,
      ts: compactTs, uzunluk: tam.length, kirpildi, sirElenenSatir: el.elenen,
    },
  };
}

// ── kaptan hedefi — session'ın DEPOSUNDAN (canlı goals/ VEYA arşiv) ──────────
function kaptanHedefi(depo, sessionId) {
  const kok = join(depo, "kaptan");
  if (!existsSync(kok)) return null;
  // goals/<slug>/<id>.json + olası arşiv dizinleri — yapı sürümden sürüme oynadı,
  // sessionId dosya adı sabit; 2 seviye derinlikte ara.
  const adaylar = [];
  try {
    for (const ust of readdirSync(kok)) {
      const d1 = join(kok, ust);
      let st; try { st = statSync(d1); } catch { continue; }
      if (!st.isDirectory()) continue;
      const dogrudan = join(d1, `${sessionId}.json`);
      if (existsSync(dogrudan)) adaylar.push(dogrudan);
      try {
        for (const alt of readdirSync(d1)) {
          const p = join(d1, alt, `${sessionId}.json`);
          if (existsSync(p)) adaylar.push(p);
        }
      } catch {}
    }
  } catch {}
  if (!adaylar.length) return null;
  try {
    const g = JSON.parse(readFileSync(adaylar[0], "utf8"));
    return {
      title: sirsiz(g.title) ?? null,
      acikTodolar: (g.todos || [])
        .filter((t) => !t.removed && t.status !== "completed")
        .map((t) => sirsiz(String(t.content).slice(0, 200))),
    };
  } catch { return null; }
}

// ── proje tarafı: plan ağacı + DEVRALIS.md + git (hesap-bağımsız) ────────────
function planDurumu(cwd) {
  const agac = join(HOME, ".claude", "skills", "plan-organizatoru", "scripts", "agac.mjs");
  if (!cwd || !existsSync(agac) || !existsSync(cwd)) return null;
  const r = spawnSync("node", [agac, "--durum", "--json"], { cwd, encoding: "utf8", timeout: 30_000 });
  if (r.status !== 0 || !r.stdout?.trim()) return null;
  try { return JSON.parse(r.stdout); } catch { return null; }
}
function devralisOzeti(cwd) {
  if (!cwd) return null;
  const p = join(cwd, ".claude", "filing", "DEVRALIS.md");
  if (!existsSync(p)) return null;
  try { return sirsiz(readFileSync(p, "utf8").split("\n").slice(0, 80).join("\n")); } catch { return null; }
}
function gitDurumu(cwd) {
  if (!cwd || !existsSync(join(cwd, ".git"))) return null;
  const g = (args) => {
    const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", timeout: 10_000 });
    return r.status === 0 ? r.stdout.trim() : null;
  };
  return {
    sonCommitler: (g(["log", "-5", "--format=%h %s"]) || "").split("\n").filter(Boolean),
    kirliDosya: (g(["status", "--porcelain"]) || "").split("\n").filter(Boolean).length,
    dal: g(["rev-parse", "--abbrev-ref", "HEAD"]),
  };
}

// ── --liste: depo-çoklu aday envanteri ───────────────────────────────────────
function liste() {
  const cutoff = Date.now() - opt.gun * 24 * 3600_000;
  const out = [];
  for (const depo of depolar()) {
    const pdir = join(depo, "projects");
    let slugs; try { slugs = readdirSync(pdir); } catch { continue; }
    for (const slug of slugs) {
      const sd = join(pdir, slug);
      let files; try { files = readdirSync(sd).filter((f) => f.endsWith(".jsonl")); } catch { continue; }
      for (const f of files) {
        const p = join(sd, f);
        let m; try { m = statSync(p).mtimeMs; } catch { continue; }
        if (m < cutoff) continue;
        const cwd = cwdFromTranscript(p);
        if (opt.proje && (!cwd || resolve(cwd) !== opt.proje)) continue;
        out.push({
          depo, slug, sessionId: f.slice(0, -6), cwdTahmini: cwd,
          sonAktivite: new Date(m).toISOString(),
          // Kesin canlılık ölçümü kapsam dışı (İLAN): mtime<2dk = muhtemelen canlı.
          muhtemelenCanli: Date.now() - m < 2 * 60_000,
        });
      }
    }
  }
  out.sort((a, b) => b.sonAktivite.localeCompare(a.sonAktivite));
  console.log(JSON.stringify(out, null, 1));
}

// ── --session: tek session demeti ────────────────────────────────────────────
function demet(sessionId) {
  const uyarilar = [];
  // Transcript'i tüm depolarda ara (--depo verilirse yalnız orada).
  let bulunan = null;
  for (const depo of opt.depo ? [resolve(opt.depo)] : depolar()) {
    const pdir = join(depo, "projects");
    let slugs; try { slugs = readdirSync(pdir); } catch { continue; }
    for (const slug of slugs) {
      const p = join(pdir, slug, `${sessionId}.jsonl`);
      if (existsSync(p)) { bulunan = { depo, slug, transcript: p }; break; }
    }
    if (bulunan) break;
  }
  if (!bulunan) {
    console.error(`BULUNAMADI: ${sessionId} — taranan depolar: ${(opt.depo ? [opt.depo] : depolar()).join(", ")}`);
    process.exit(1);
  }
  const { depo, slug, transcript } = bulunan;
  const cwd = cwdFromTranscript(transcript);
  if (!cwd) uyarilar.push("cwd transcript'ten çözülemedi — plan/DEVRALIS/git alanları boş");
  const tr = transcriptOku(transcript, opt.tail);
  if (!tr) uyarilar.push("transcript okunamadı");
  // "Başka depo" kıyası AKTİF depoya göredir (CLAUDE_CONFIG_DIR onurlandırılır) —
  // sabit ~/.claude'a kıyas, hesap2'den bakarken hesap1 session'ına ÇALIŞMAYACAK bir
  // hard resume önerirdi (gerçek veriyle ölçüldü, 2026-07-23).
  const aktifDepo = resolve(process.env.CLAUDE_CONFIG_DIR || join(HOME, ".claude"));
  const baskaDepo = resolve(depo) !== aktifDepo;
  if (baskaDepo) uyarilar.push(`session BAŞKA depoda (${basename(depo)}) — hard resume bu hesapta ÇALIŞMAZ, soft-resume tam bunun için`);

  if (opt.yalin) uyarilar.push("YALIN mod: plan ağacı · DEVRALIS · git ÖLÇÜLMEDİ (çağıran proje tarafını bir kez ölçer)");

  const sonuc = {
    meta: {
      sessionId, depo, slug, cwd,
      sonAktivite: new Date(statSync(transcript).mtimeMs).toISOString(),
      hardResume: baskaDepo ? null : `cd ${cwd ?? "<proje>"} && claude --resume ${sessionId}`,
    },
    amac: { ilkIstek: tr?.ilkIstek ?? null },
    neredeKaldi: {
      sonIstek: tr?.sonIstek ?? null,
      sonZaman: tr?.sonZaman ?? null,
      sonTodolar: tr?.sonTodolar ?? null,
      kuyruk: tr?.kuyruk ?? [],
    },
    // Harness'ın kendi compact özeti (varsa) — hasat, üretim DEĞİL.
    compact: tr?.compact ?? null,
    planlar: opt.yalin ? null : planDurumu(cwd),          // proje tarafı — hesap-bağımsız
    kaptanHedefi: kaptanHedefi(depo, sessionId), // session'ın DEPOSUNDAN
    devralis: opt.yalin ? null : devralisOzeti(cwd),      // proje tarafı — git-izli
    git: opt.yalin ? null : gitDurumu(cwd),
    yalin: opt.yalin,
    uyarilar,
  };
  console.log(JSON.stringify(sonuc, null, 1));
}

if (opt.liste) liste();
else if (opt.session) demet(opt.session);
else {
  console.error("kullanım: topla.mjs --liste [--proje <root>] [--gun N]"
    + " | --session <id> [--depo <dir>] [--tail N] [--yalin] [--ozet-tavan N]");
  process.exit(2);
}
