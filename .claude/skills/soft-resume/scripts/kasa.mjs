#!/usr/bin/env node
/**
 * kasa.mjs — OTURUM KASASI: AÇIK SEKMELERİN yeniden-başlatılabilir yedeği.
 *
 * SINIF: motor · deterministik · 0 token · LLM DOĞURMAZ · **aide GEREKTİRMEZ**
 * TAŞIYICI: session-yerleşik (SessionEnd/SessionStart hook'u çağırır) + elle.
 *
 * NEDEN VAR — devir zincirindeki KÖR NOKTA:
 *   `oturum.mjs devir` yalnız KAPANAN oturumun notunu yazar. Devralan kişi geldiğinde ise
 *   ortada bir oturum değil, BİR EKRAN DOLUSU AÇIK SEKME vardı: her biri kendi bağlamını
 *   taşıyan, hiçbirinin kapanış notu olmayan N canlı session. Hesap/makine değişince ya da
 *   pencere topluca ölünce (limit · logout · crash · reboot) o N bağlamın tamamı buharlaşırdı —
 *   transcript hesaba bağlıdır, devir notu ise henüz YAZILMAMIŞTIR (oturum kapanmadı ki).
 *   Kasa o boşluğu kapatır: her AÇIK sekmenin sıkıştırılmış özetini + YENİDEN BAŞLATMA
 *   KOMUTUNU projeye (git'e) düşürür. Devralan, sekmeleri tek tek geri açabilir.
 *
 * KASA ≠ DEVİR NOTU (ikisi de gerekir, karıştırma):
 *   devir notu → KAPANAN oturumun HÜKMÜ (hedef · todo · kilit · sıradaki adım). Bir tanedir.
 *   kasa       → O AN AÇIK olan HER oturumun FOTOĞRAFI + başlatma komutu. N tanedir.
 *
 * ÖZET NEREDEN GELİR (0 token sözleşmesi buna dayanır): harness context sıfırlarken KENDİ
 * yazdığı compact özeti transcript'e bırakır; kasa onu HASAT eder, ÜRETMEZ. Compact yoksa
 * özet alanı boş kalır ve bu İLAN edilir — motor metin uydurmaz.
 *
 * SÖZLEŞME (2026-07-23 kullanıcı kararı, soft-resume ile ortak): kapatan taraf agentic iş
 * YAPMAZ. Kasa deterministik toplar; anlamlandırma DEVRALANIN işidir.
 *
 * KAPSAM (İLANLI muafiyet): kasa PROJE kapsamlıdır — bu repodaki canlı session'ları yazar.
 * Başka projenin sekmeleri o projenin kasasına düşer (her projenin kendi SessionEnd zinciri
 * yazar); projeler-arası bakış `~/.claude/oturum/KILAVUZ.md`'nin işidir.
 *
 * Kullanım:
 *   node kasa.mjs yaz    [--proje <root>] [--bayat <dk>] [--tail N] [--zorla] [--kuru]
 *   node kasa.mjs list   [--proje <root>] [--json]
 *   node kasa.mjs goster <kisa|id> [--proje <root>]
 *   node kasa.mjs baslat <kisa|id> [--ates] [--zorla] [--proje <root>]
 *   node kasa.mjs unut   <kisa|id> [--proje <root>]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, rmSync, renameSync } from "node:fs";
import { join, dirname, resolve, basename, relative } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SURUM = 1;
const HOME = process.env.HOME || homedir();
const CLAUDE = process.env.CLAUDE_CONFIG_DIR || join(HOME, ".claude");
const BURASI = dirname(fileURLToPath(import.meta.url));
const TOPLA = join(BURASI, "topla.mjs");
const LIB = join(CLAUDE, "hooks", "claims-lib.mjs");

// ── argümanlar ───────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const cmd = (argv[0] || "").replace(/^--/, "");
const hedefArg = argv[1] && !argv[1].startsWith("--") ? argv[1] : null;
const opt = (ad, varsayilan = null) => {
  const i = argv.indexOf(ad);
  return i > -1 && argv[i + 1] ? argv[i + 1] : varsayilan;
};
const bayrak = (ad) => argv.includes(ad);

const O = {
  proje: opt("--proje") ? resolve(opt("--proje")) : null,
  bayat: Number(opt("--bayat", "0")) || 0,   // dk — bu kadar taze kayıt yeniden yazılmaz
  tail: Number(opt("--tail", "14")) || 14,
  json: bayrak("--json"),
  zorla: bayrak("--zorla"),
  kuru: bayrak("--kuru"),
  ates: bayrak("--ates"),
};

/** Proje kökü: cwd'den yukarı `plans/` taşıyan ilk dizin (oturum-kapanis.mjs emsali).
 *  plans/ yoksa bu klasörün plan katmanıyla ilişkisi yoktur → kasa da yoktur. */
function projeKoku(cwd) {
  let d = resolve(cwd);
  for (let i = 0; i < 12 && d && d !== dirname(d); i++) {
    try { if (statSync(join(d, "plans")).isDirectory()) return d; } catch { /* yukarı */ }
    d = dirname(d);
  }
  return null;
}
const KOK = O.proje || projeKoku(process.cwd());
if (!KOK) {
  console.error("KASA YOK: plan katmanı olmayan klasör (plans/ bulunamadı) — muaf");
  process.exit(2);
}
const KASA_DIR = join(KOK, "plans", "oturumlar", "kasa");
const INDEX_MD = join(KASA_DIR, "KASA.md");

/** Bu script'in KOPYALANABİLİR yolu — `~` kısaltmalı mutlak (her cwd'de çalışır). */
const BEN = fileURLToPath(import.meta.url).replace(new RegExp(`^${HOME}`), "~");
const kisaId = (s) => (s ? String(s).slice(0, 8) : null);
const kirp = (s, n) => {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};
/** session-status başlığı harness etiketiyle başlayabilir (`<ide_opened_file>…`, `<command…>`):
 *  o etiket kullanıcının cümlesi DEĞİL, IDE'nin sesidir — kasadaki başlık insanın tanıyacağı
 *  ad olmalı. Etiket(ler) soyulur; geriye anlamlı metin kalmazsa başlık null'dır (uydurulmaz). */
function temizBaslik(s) {
  if (!s) return null;
  let t = String(s);
  // 1) KAPANIŞLI blok: `<tag>…</tag>` komple düşer — geriye kullanıcının cümlesi kalır.
  for (let i = 0; i < 4; i++) {
    const y = t.replace(/^<([a-zA-Z0-9_-]+)>[\s\S]*?<\/\1>\s*/, "");
    if (y === t) break;
    t = y;
  }
  // 2) KAPANIŞSIZ etiket: başlık kaynakta zaten kırpılmıştır (~64 karakter), kapanış hiç
  //    gelmemiştir. Yalnız etiketi atarız; kalan metin IDE'nin cümlesi olabilir — kırpılmış
  //    olanı geri getiremeyiz, uydurmayız da.
  t = t.replace(/^<[a-zA-Z0-9_-]+>\s*/, "");
  t = t.replace(/\s+/g, " ").trim();
  return t || null;
}
const yasKisa = (ms) => {
  if (ms == null) return "?";
  const d = Math.max(0, Date.now() - ms);
  const dk = Math.round(d / 60_000);
  if (dk < 60) return `${dk} dk`;
  const sa = Math.round(dk / 60);
  return sa < 48 ? `${sa} sa` : `${Math.round(sa / 24)} gün`;
};
/** Yazım idempotenttir: içerik aynıysa dosyaya DOKUNULMAZ (mtime de sabit kalır —
 *  `--bayat` guard'ı ve git diff'i buna güvenir). */
function yazIfFarkli(yol, icerik) {
  try { if (readFileSync(yol, "utf8") === icerik) return false; } catch { /* yok */ }
  if (O.kuru) return true;
  mkdirSync(dirname(yol), { recursive: true });
  const tmp = `${yol}.tmp-${process.pid}`;
  writeFileSync(tmp, icerik);
  renameSync(tmp, yol);
  return true;
}

/** claims-lib TEK canlılık kaynağıdır (pid + procStart ölçümü orada yaşar). Yoksa hüküm
 *  vermeyiz: ikinci bir canlılık ölçütü icat etmek "ölmedi ama kırık" sınıfını doğururdu. */
async function lib() {
  if (!existsSync(LIB)) {
    console.error(`ÖLÇÜLEMEDİ: ${LIB} yok — canlı session ölçümü yapılamaz`);
    console.error("  onar: aide sync --project . && aide kurulum");
    process.exit(3);
  }
  return import(`file://${LIB}`);
}

// ── toplama ──────────────────────────────────────────────────────────────────
function demetAl(sessionId, yalin) {
  const r = spawnSync(process.execPath,
    [TOPLA, "--session", sessionId, "--tail", String(O.tail), ...(yalin ? ["--yalin"] : [])],
    { encoding: "utf8", timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0 || !r.stdout?.trim()) return null;
  try { return JSON.parse(r.stdout); } catch { return null; }
}

/** Bu session'ın TUTTUĞU kilitler — devralan "neyi bırakmam gerekiyor"u bilmeden başlayamaz. */
function kilitleriAl(L, sessionId) {
  try {
    if (!L.ledgerExists?.()) return [];
    return L.activeClaims(L.repoRootOf(KOK))
      .filter((c) => c.owner?.sessionId === sessionId)
      .map((c) => ({ kaynak: c.resource?.key ?? null, breadth: c.breadth ?? null, niyet: kirp(c.intent, 160) || null }));
  } catch { return []; }
}

/** YENİDEN BAŞLATMA — üç yol, hangisinin GEÇERLİ olduğu ölçülür, tahmin edilmez.
 *  hard  : session AKTİF depoda → `aide open` (kosum chokepoint'i; yüzey ayarına saygı duyar)
 *  ham   : aide yoksa doğrudan `claude --resume` (aynı hesap şartı yine geçerli)
 *  soft  : başka depo/hesap → resume ÇALIŞMAZ; taze oturum + bu kasa dosyası brif olarak okunur */
function baslatmaYollari(demet, sessionId, kisa) {
  const cwd = demet?.meta?.cwd || KOK;
  const brif = relative(KOK, join(KASA_DIR, `${kisa}.md`));
  const aktifDepo = resolve(process.env.CLAUDE_CONFIG_DIR || join(HOME, ".claude"));
  const baskaDepo = demet?.meta?.depo ? resolve(demet.meta.depo) !== aktifDepo : false;
  return {
    baskaDepo,
    hard: baskaDepo ? null : `aide open ${sessionId} --cwd ${cwd}`,
    ham: baskaDepo ? null : `cd ${cwd} && claude --resume ${sessionId}`,
    soft: `cd ${KOK} && claude "OTURUM KASASI devralması: ${brif} dosyasını OKU ve 'İLK İŞ' bölümünden başla."`,
    brif,
  };
}

/** İLK İŞ — deterministik, yorumsuz: ilk in_progress todo ?? ilk açık todo ?? son istek. */
function ilkIs(demet) {
  const t = demet?.neredeKaldi?.sonTodolar || [];
  const yuruyen = t.find((x) => x.status === "in_progress");
  if (yuruyen) return yuruyen.content;
  const acik = t.find((x) => x.status !== "completed");
  if (acik) return acik.content;
  return demet?.neredeKaldi?.sonIstek ?? null;
}

function kayitKur(st, demet, kilitler) {
  const kisa = kisaId(st.sessionId);
  const yollar = baslatmaYollari(demet, st.sessionId, kisa);
  const todolar = demet?.neredeKaldi?.sonTodolar || [];
  const olculemedi = [];
  if (!demet) olculemedi.push("transcript demeti (topla.mjs çalışmadı)");
  if (demet && !demet.compact) olculemedi.push("compact özet (bu oturum henüz context sıfırlamadı — özet YOK, uydurulmaz)");
  if (demet?.yalin) olculemedi.push("plan ağacı · DEVRALIS · git (yalın mod — proje tarafı ilk kayıtta)");
  return {
    surum: SURUM,
    kisa,
    sessionId: st.sessionId,
    proje: basename(KOK),
    kok: KOK,
    cwd: demet?.meta?.cwd ?? st.cwd ?? null,
    baslik: kirp(temizBaslik(st.title), 200) || null,
    // KAYIT ANI değil ÖLÇÜLEN AN yazılır: `new Date()` idempotensi öldürürdü (her koşumda
    // taze damga → içerik hiç aynı kalmaz → "aynıysa yazma" yolu ölür). Emsal: devir notu.
    sonAktivite: st.updated ? new Date(st.updated).toISOString() : null,
    yazimAninkiDurum: st.state ?? null,       // generating · idle … (o anki hâl, hüküm DEĞİL)
    depo: demet?.meta?.depo ?? null,
    amac: demet?.amac?.ilkIstek ?? null,
    sonIstek: demet?.neredeKaldi?.sonIstek ?? null,
    sonZaman: demet?.neredeKaldi?.sonZaman ?? null,
    todolar: todolar.map((t) => ({ metin: t.content, durum: t.status })),
    acikTodo: todolar.filter((t) => t.status !== "completed").length,
    compact: demet?.compact ?? null,
    kaptanHedefi: demet?.kaptanHedefi ?? null,
    planlar: demet?.planlar?.planlar
      ? demet.planlar.planlar.filter((p) => p.durum !== "KAPALI").map((p) => `${p.slug} v${p.v} ${p.durum}`)
      : null,
    git: demet?.git ?? null,
    kuyruk: demet?.neredeKaldi?.kuyruk ?? [],
    kilitler,
    ilkIs: ilkIs(demet),
    yenidenBaslat: yollar,
    uyarilar: demet?.uyarilar ?? [],
    olculemedi,
  };
}

// ── MD render: devralanın OKUYACAĞI brif ─────────────────────────────────────
function renderMd(k) {
  const S = [];
  S.push(`# OTURUM KASASI — ${k.proje} · ${k.kisa}`);
  S.push("");
  S.push(`> **TÜREV — ELLE YAZILMAZ.** Tek yazar: \`kasa.mjs\`. Motor · deterministik · 0 token.`);
  S.push(`> Bu dosya AÇIK bir sekmenin fotoğrafıdır; içindeki özet harness'ın compact özetinden`);
  S.push(`> HASAT edilmiştir (üretilmemiştir). Devralıyorsan: aşağıdaki **YENİDEN BAŞLAT**`);
  S.push(`> komutunu çalıştır, sonra **İLK İŞ**'ten devam et.`);
  S.push("");
  S.push(`- başlık: ${k.baslik || "(başlıksız)"}`);
  S.push(`- session: \`${k.sessionId}\` · cwd: \`${k.cwd || "?"}\``);
  S.push(`- son aktivite: ${k.sonAktivite || "ölçülemedi"} · yazım anındaki hâl: ${k.yazimAninkiDurum || "?"}`);
  if (k.depo) S.push(`- depo: \`${k.depo}\`${k.yenidenBaslat.baskaDepo ? " ⚠ **BAŞKA HESAP** — hard resume ÇALIŞMAZ" : ""}`);
  S.push("");
  S.push("## YENİDEN BAŞLAT");
  S.push("");
  S.push("```sh");
  if (k.yenidenBaslat.hard) {
    S.push(`# aynı hesap → oturum kaldığı yerden açılır (koşum yüzeyi ayarına saygı duyar)`);
    S.push(k.yenidenBaslat.hard);
    S.push(`# aide yoksa:`);
    S.push(`# ${k.yenidenBaslat.ham}`);
  } else {
    S.push(`# session BAŞKA depoda/hesapta — resume çalışmaz, taze oturum bu brifi okur:`);
  }
  S.push(k.yenidenBaslat.soft);
  S.push("```");
  S.push("");
  S.push("## İLK İŞ");
  S.push("");
  S.push(k.ilkIs ? `${k.ilkIs}` : "_ölçülemedi — açık todo yok, son istek de okunamadı._");
  S.push("");
  S.push("## AMAÇ (oturum ne için açılmıştı)");
  S.push("");
  S.push(k.amac ? `${k.amac}` : "_ölçülemedi._");
  S.push("");
  S.push("## NEREDE KALDI");
  S.push("");
  S.push(`- son istek: ${k.sonIstek ? k.sonIstek : "_ölçülemedi_"}`);
  if (k.sonZaman) S.push(`- son istek zamanı: ${k.sonZaman}`);
  if (k.todolar.length) {
    S.push(`- todo'lar (${k.acikTodo} açık / ${k.todolar.length}):`);
    for (const t of k.todolar) S.push(`  - [${t.durum === "completed" ? "x" : t.durum === "in_progress" ? "~" : " "}] ${t.metin}`);
  } else S.push("- todo: yok (nabız boş)");
  if (k.kaptanHedefi?.title) S.push(`- kaptan hedefi: ${k.kaptanHedefi.title}`);
  if (k.planlar?.length) S.push(`- açık plan: ${k.planlar.join(" · ")}`);
  if (k.git) S.push(`- git: ${k.git.dal} · ${k.git.kirliDosya} kirli dosya`);
  S.push("");
  if (k.kilitler.length) {
    S.push("## TUTULAN KİLİTLER (devralan BUNLARI da devralır)");
    S.push("");
    for (const c of k.kilitler) S.push(`- \`${c.kaynak}\`${c.breadth === "broad" ? " [broad]" : ""} — ${c.niyet || "(niyet belirtilmemiş)"}`);
    S.push("");
  }
  S.push("## COMPACT ÖZET (harness'tan hasat)");
  S.push("");
  if (k.compact) {
    S.push(`<!-- ${k.compact.uzunluk} karakter · ${k.compact.ts || "zaman yok"}`
      + `${k.compact.kirpildi ? " · KIRPILDI (baştan)" : ""}`
      + `${k.compact.sirElenenSatir ? ` · ${k.compact.sirElenenSatir} satır sır elendi` : ""} -->`);
    S.push("");
    S.push(k.compact.metin);
  } else {
    S.push("_YOK — bu oturum henüz context sıfırlamadı, dolayısıyla harness özeti yok._");
    S.push("_Motor özet UYDURMAZ; yukarıdaki \"nerede kaldı\" + aşağıdaki kuyruk tek kanıttır._");
  }
  S.push("");
  if (k.kuyruk.length) {
    S.push("## SON KONUŞMA KUYRUĞU");
    S.push("");
    for (const m of k.kuyruk) S.push(`- **${m.role}:** ${kirp(m.text, 500)}`);
    S.push("");
  }
  if (k.olculemedi.length || k.uyarilar.length) {
    S.push("## ÖLÇÜLEMEDİ / UYARI");
    S.push("");
    for (const x of [...k.olculemedi, ...k.uyarilar]) S.push(`- ${x}`);
    S.push("");
  }
  return S.join("\n");
}

// ── kayıt okuma ──────────────────────────────────────────────────────────────
function kayitlar() {
  let dosyalar = [];
  try { dosyalar = readdirSync(KASA_DIR).filter((f) => f.endsWith(".json")); } catch { return []; }
  const out = [];
  for (const f of dosyalar) {
    const yol = join(KASA_DIR, f);
    try {
      const j = JSON.parse(readFileSync(yol, "utf8"));
      if (j?.surum !== SURUM) continue;
      out.push({ ...j, _yol: yol, _mtime: statSync(yol).mtimeMs });
    } catch { /* bozuk kayıt sayılmaz */ }
  }
  out.sort((a, b) => String(b.sonAktivite || "").localeCompare(String(a.sonAktivite || "")));
  return out;
}
const kayitBul = (anahtar) => {
  const a = String(anahtar || "").toLowerCase();
  return kayitlar().find((k) => k.kisa === a.slice(0, 8) || k.sessionId === anahtar) || null;
};

function renderIndex(ks, canliSet) {
  const S = [];
  S.push("# OTURUM KASASI — açık sekmelerin yeniden-başlatılabilir yedeği (TÜREV — ELLE YAZILMAZ)");
  S.push("");
  S.push("> Tek yazar: `kasa.mjs yaz`. Motor · deterministik · 0 token · **aide gerekmez**.");
  S.push("> NE İÇİN: devralan kişi ekranı devralmaz — bu klasörü devralır. Her kayıt bir AÇIK");
  S.push("> sekmenin fotoğrafı + onu geri açan komuttur. Ölç: `node kasa.mjs list`.");
  S.push("");
  if (!ks.length) { S.push("_Kayıt yok — bu projede kasaya alınmış açık oturum bulunmuyor._"); S.push(""); return S.join("\n"); }
  S.push(`## Kayıtlar (${ks.length})`);
  S.push("");
  for (const k of ks) {
    const canli = canliSet ? (canliSet.has(k.sessionId) ? "CANLI" : "ÖLÜ → yeniden başlatılabilir") : "canlılık ölçülmedi";
    S.push(`### ${k.kisa} — ${k.baslik || "(başlıksız)"}`);
    S.push("");
    S.push(`- durum: ${canli} · son aktivite: ${k.sonAktivite || "?"} · açık todo: ${k.acikTodo}/${k.todolar.length}`);
    if (k.ilkIs) S.push(`- ilk iş: ${kirp(k.ilkIs, 160)}`);
    if (k.kilitler.length) S.push(`- tuttuğu kilit: ${k.kilitler.map((c) => c.kaynak).join(" · ")}`);
    S.push(`- brif: \`${k.yenidenBaslat.brif}\``);
    S.push(`- başlat: \`${k.yenidenBaslat.hard || k.yenidenBaslat.soft}\``);
    S.push("");
  }
  return S.join("\n");
}

// ── komut: yaz ───────────────────────────────────────────────────────────────
async function yaz() {
  const L = await lib();
  const repo = L.repoRootOf(KOK);
  const canli = L.liveSessionsIn(repo);
  if (!canli.length) {
    console.log("KASA: bu repoda canlı oturum yok — yazılacak sekme yok.");
    // Index yine de tazelensin (eski kayıtların canlılık rozeti değişmiş olabilir).
    const ks = kayitlar();
    if (ks.length) yazIfFarkli(INDEX_MD, renderIndex(ks, new Set()) );
    return;
  }
  canli.sort((a, b) => (b.updated || 0) - (a.updated || 0));

  let yazilan = 0, atlanan = 0, ilkTam = false;
  for (const st of canli) {
    const kisa = kisaId(st.sessionId);
    const jsonYol = join(KASA_DIR, `${kisa}.json`);
    // ── guard 1: TAZELİK. `--bayat N` verilmişse N dk'dan taze kayıt yeniden ölçülmez
    //    (SessionStart tazelemesi bunu kullanır: her yeni sekme transcript taramaz).
    if (O.bayat && !O.zorla) {
      try {
        if ((Date.now() - statSync(jsonYol).mtimeMs) / 60_000 < O.bayat) { atlanan++; continue; }
      } catch { /* kayıt yok — yaz */ }
    }
    // ── guard 2: DEĞİŞMEMİŞLİK. session-status `updated` damgası aynıysa oturumda yeni bir
    //    şey OLMAMIŞTIR → transcript'i baştan okumanın anlamı yok (10 MB dosyalar ölçüldü).
    if (!O.zorla) {
      try {
        const eski = JSON.parse(readFileSync(jsonYol, "utf8"));
        if (eski?.sonAktivite && st.updated && eski.sonAktivite === new Date(st.updated).toISOString()) { atlanan++; continue; }
      } catch { /* kayıt yok/bozuk — yaz */ }
    }
    // Proje tarafı (plan ağacı · DEVRALIS · git) repo başına AYNIdır: bir kez tam ölç, kalanı yalın.
    const demet = demetAl(st.sessionId, ilkTam);
    if (demet && !ilkTam) ilkTam = true;
    const k = kayitKur(st, demet, kilitleriAl(L, st.sessionId));
    const a = yazIfFarkli(jsonYol, JSON.stringify(k, null, 1) + "\n");
    const b = yazIfFarkli(join(KASA_DIR, `${kisa}.md`), renderMd(k) + "\n");
    if (a || b) { yazilan++; console.log(`${O.kuru ? "KURU " : ""}KASA ${a || b ? "YAZILDI" : "aynı"}: ${kisa} — ${kirp(k.baslik, 60) || "(başlıksız)"}`); }
    else atlanan++;
  }
  const canliSet = new Set(canli.map((s) => s.sessionId));
  yazIfFarkli(INDEX_MD, renderIndex(kayitlar(), canliSet));
  console.log(`KASA: ${canli.length} canlı oturum · ${yazilan} yazıldı · ${atlanan} atlandı (değişmemiş/taze) · ${relative(KOK, KASA_DIR)}`);
}

// ── komut: list ──────────────────────────────────────────────────────────────
async function list() {
  const L = await lib();
  const canliSet = new Set(L.liveSessionsIn(L.repoRootOf(KOK)).map((s) => s.sessionId));
  const ks = kayitlar();
  if (O.json) {
    console.log(JSON.stringify(ks.map((k) => ({
      kisa: k.kisa, sessionId: k.sessionId, baslik: k.baslik, sonAktivite: k.sonAktivite,
      canli: canliSet.has(k.sessionId), acikTodo: k.acikTodo, ilkIs: k.ilkIs,
      kilit: k.kilitler.map((c) => c.kaynak), yenidenBaslat: k.yenidenBaslat,
      brifYolu: relative(KOK, k._yol).replace(/\.json$/, ".md"),
    })), null, 1));
    return;
  }
  if (!ks.length) { console.log(`KASA BOŞ: ${relative(KOK, KASA_DIR)} — yaz: node kasa.mjs yaz`); return; }
  console.log(`KASA — ${basename(KOK)} · ${ks.length} kayıt (${relative(KOK, KASA_DIR)})`);
  for (const k of ks) {
    const rozet = canliSet.has(k.sessionId) ? "● CANLI" : "○ ÖLÜ  ";
    console.log(`  ${rozet} ${k.kisa} · ${yasKisa(Date.parse(k.sonAktivite))} · açık todo ${k.acikTodo} — ${kirp(k.baslik, 56) || "(başlıksız)"}`);
    if (k.ilkIs) console.log(`      ilk iş: ${kirp(k.ilkIs, 88)}`);
    // U1 — onarım/eylem talimatı KOPYALA-YAPIŞTIR çalışmalı: göreli yol yalnız o anki cwd'de
    // geçerlidir (ölçüldü: repo kökünden `node ../../.claude/…` basıyordu). Mutlak yol + `~`.
    console.log(`      başlat: node ${BEN} baslat ${k.kisa}`);
  }
  console.log(`  brifler: ${relative(KOK, KASA_DIR)}/<kisa>.md · CANLI olanı başlatmak İKİZ oturum doğurur (--zorla ister)`);
}

// ── komut: goster ────────────────────────────────────────────────────────────
function goster() {
  const k = kayitBul(hedefArg);
  if (!k) { console.error(`KASADA YOK: ${hedefArg || "(anahtar verilmedi)"} — gör: node kasa.mjs list`); process.exit(1); }
  const md = k._yol.replace(/\.json$/, ".md");
  try { process.stdout.write(readFileSync(md, "utf8")); }
  catch { console.log(JSON.stringify(k, null, 1)); }
}

// ── komut: baslat ────────────────────────────────────────────────────────────
async function baslat() {
  const k = kayitBul(hedefArg);
  if (!k) { console.error(`KASADA YOK: ${hedefArg || "(anahtar verilmedi)"} — gör: node kasa.mjs list`); process.exit(1); }
  const L = await lib();
  const canli = L.liveSessionsIn(L.repoRootOf(KOK)).some((s) => s.sessionId === k.sessionId);
  if (canli && !O.zorla) {
    // İKİZ OTURUM koruması: canlı bir session'ı ikinci kez açmak aynı işi iki yerde yürütür;
    // kilit protokolü bunu çözmez (aynı sessionId iki pencerede kendi kendine çakışır).
    console.error(`REDDEDİLDİ: ${k.kisa} ŞU AN CANLI — yeniden başlatmak İKİZ oturum doğurur.`);
    console.error(`  o sekmeye git, ya da gerçekten istiyorsan: --zorla`);
    process.exit(1);
  }
  const y = k.yenidenBaslat;
  const komut = y.hard || y.soft;
  if (!O.ates) {
    console.log(`# ${k.kisa} — ${k.baslik || "(başlıksız)"}`);
    if (y.hard) { console.log(y.hard); console.log(`# aide yoksa: ${y.ham}`); }
    else console.log(`# başka depo/hesap — resume çalışmaz, brifle taze oturum:`);
    console.log(y.soft);
    console.log(`# brif: ${y.brif}   ·   ateşle: --ates`);
    return;
  }
  if (!y.hard) {
    // Taze oturum AÇMAK kasa'nın işi değildir: spawn tek noktadan (kosum/Maestro) geçer,
    // ikinci bir spawn yolu icat etmek koşum yüzeyi ayarını sessizce delerdi (İLANLI sınır).
    console.error("ATEŞLENMEDİ: bu kayıt yalnız SOFT yolla açılır (başka hesap) — taze oturum açmak");
    console.error("koşum yüzeyinin işidir. Komutu kendin çalıştır ya da /soft-resume ile ateşle:");
    console.log(y.soft);
    process.exit(3);
  }
  const [bin, ...args] = komut.split(" ");
  const r = spawnSync(bin, args, { stdio: "inherit" });
  if (r.error || r.status !== 0) {
    console.error(`ATEŞLEME BAŞARISIZ (${r.error?.message || `exit ${r.status}`}) — elle: ${y.ham}`);
    process.exit(2);
  }
}

// ── komut: unut ──────────────────────────────────────────────────────────────
async function unut() {
  const k = kayitBul(hedefArg);
  if (!k) { console.error(`KASADA YOK: ${hedefArg || "(anahtar verilmedi)"}`); process.exit(1); }
  for (const y of [k._yol, k._yol.replace(/\.json$/, ".md")]) {
    try { rmSync(y); console.log(`SİLİNDİ: ${relative(KOK, y)}`); } catch { /* zaten yok */ }
  }
  const L = await lib().catch(() => null);
  const canliSet = L ? new Set(L.liveSessionsIn(L.repoRootOf(KOK)).map((s) => s.sessionId)) : null;
  yazIfFarkli(INDEX_MD, renderIndex(kayitlar(), canliSet));
}

// ── dispatch ─────────────────────────────────────────────────────────────────
const KOMUTLAR = { yaz, list, goster, baslat, unut };
if (!KOMUTLAR[cmd]) {
  console.error(`bilinmeyen komut: ${cmd || "(yok)"}\n  komutlar: ${Object.keys(KOMUTLAR).join(" · ")}`);
  console.error("  node kasa.mjs yaz [--proje <root>] [--bayat <dk>] [--zorla] [--kuru]");
  console.error("  node kasa.mjs list [--json] · goster <kisa> · baslat <kisa> [--ates] · unut <kisa>");
  process.exit(2);
}
const _s = KOMUTLAR[cmd]();
if (_s && typeof _s.then === "function")
  _s.catch((e) => { console.error(`${cmd} HATASI: ${String(e?.message || e)}`); process.exit(2); });
