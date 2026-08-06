#!/usr/bin/env node
// /devam — GEÇERLİLİK MOTORU  ·  sınıf: motor (deterministik) · maliyet: 0 token
//
// Soru: "kesinti öncesi yarım kalan bu iş HÂLÂ GEÇERLİ Mİ?"
// Bu script CEVAP VERMEZ — KANIT toplar ve sapma sayar (hüküm ≠ eylem,
// uy:ilke/kanit-kendini-imzalayamaz). Sapma yoksa hüküm zaten bellidir (GECERLI)
// ve HİÇBİR AJAN DOĞMAZ; sapma ya da ölçülemeyen eksen varsa hüküm INCELE'dir ve
// kararı /devam skill'ini çağıran oturum (ajan) verir.
//
// Girdi: soft-resume'un demeti (topla.mjs --session <id>) — çoğaltmıyoruz, tüketiyoruz.
//   node gecerlilik.mjs --session <id> [--depo <dir>] [--esik-saat 24] [--json]
//   node topla.mjs --session <id> | node gecerlilik.mjs --demet -
//
// Çıkış kodu: 0 = GECERLI · 1 = INCELE (sapma/ölçülemedi) · 2 = kullanım/girdi hatası.
// FAIL-CLOSED: ölçülemeyen eksen "temiz" SAYILMAZ — INCELE'ye düşer (uy:ilke/fren-fail-closed).

import { readFileSync, existsSync, statSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";

const HOME = process.env.HOME || homedir();
const BURASI = dirname(fileURLToPath(import.meta.url));

const argv = process.argv.slice(2);
const opt = { session: null, depo: null, demet: null, esikSaat: 24, json: false };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--session") opt.session = argv[++i];
  else if (a === "--depo") opt.depo = argv[++i];
  else if (a === "--demet") opt.demet = argv[++i];
  else if (a === "--esik-saat") opt.esikSaat = Number(argv[++i]) || 24;
  else if (a === "--json") opt.json = true;
}

// ── demet edinme: stdin | dosya | topla.mjs'i kendimiz koşarak ───────────────
function toplaYolu() {
  // Kurulu kopyada iki skill kardeştir: <skills>/devam/scripts ↔ <skills>/soft-resume/scripts
  const adaylar = [
    resolve(BURASI, "..", "..", "soft-resume", "scripts", "topla.mjs"),
    join(HOME, ".claude", "skills", "soft-resume", "scripts", "topla.mjs"),
  ];
  if (process.env.CLAUDE_CONFIG_DIR)
    adaylar.push(join(process.env.CLAUDE_CONFIG_DIR, "skills", "soft-resume", "scripts", "topla.mjs"));
  return adaylar.find((p) => existsSync(p)) || null;
}

function demetAl() {
  if (opt.demet) {
    const ham = opt.demet === "-" ? readFileSync(0, "utf8") : readFileSync(opt.demet, "utf8");
    return JSON.parse(ham);
  }
  if (!opt.session) {
    console.error("kullanım: gecerlilik.mjs --session <id> [--depo <dir>] [--esik-saat N] [--json]");
    console.error("     ya da: topla.mjs --session <id> | gecerlilik.mjs --demet -");
    process.exit(2);
  }
  const t = toplaYolu();
  if (!t) {
    console.error("HATA: soft-resume/scripts/topla.mjs bulunamadı — /devam onun toplayıcısını tüketir.");
    console.error("onar: aide sync --project ~   (soft-resume paketini kur)");
    process.exit(2);
  }
  const arg = ["--session", opt.session, ...(opt.depo ? ["--depo", opt.depo] : [])];
  return JSON.parse(execFileSync("node", [t, ...arg], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }));
}

// ── eksen yardımcıları ───────────────────────────────────────────────────────
const eksenler = [];
/** durum: "temiz" | "sapma" | "olculemedi" — sapma ve olculemedi ikisi de INCELE'ye götürür. */
function eksen(ad, durum, detay, onar) {
  eksenler.push({ ad, durum, detay, ...(onar ? { onar } : {}) });
}

function gitCalistir(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
}

const d = demetAl();
const cwd = d?.meta?.cwd && d.meta.cwd !== "?" ? d.meta.cwd : null;
const sonAktivite = d?.meta?.sonAktivite ? Date.parse(d.meta.sonAktivite) : NaN;
const simdi = Date.now();

// ── A1 · kesinti yaşı ────────────────────────────────────────────────────────
let yasSaat = null;
if (Number.isNaN(sonAktivite)) {
  eksen("kesinti-yasi", "olculemedi", "meta.sonAktivite okunamadı", "topla.mjs çıktısını doğrula (transcript erişilebilir mi)");
} else {
  yasSaat = (simdi - sonAktivite) / 36e5;
  const y = yasSaat.toFixed(1);
  if (yasSaat > opt.esikSaat)
    eksen("kesinti-yasi", "sapma", `${y} sa beklemiş (eşik ${opt.esikSaat} sa)`, "işin hâlâ gerekli olduğunu doğrula: hedef değişti mi, başkası yaptı mı");
  else eksen("kesinti-yasi", "temiz", `${y} sa (eşik ${opt.esikSaat} sa)`);
}

// ── A2 · dayanak değişimi — kesintiden bu yana repo hareket etti mi ─────────
if (!cwd) {
  eksen("dayanak-degisimi", "olculemedi", "cwd çözülemedi — git ölçümü yapılamıyor", "session'ın çalıştığı dizini --depo/--session ile netleştir");
} else if (Number.isNaN(sonAktivite)) {
  eksen("dayanak-degisimi", "olculemedi", "kesinti anı bilinmiyor, 'o zamandan beri' hesaplanamaz");
} else {
  try {
    const cikti = gitCalistir(cwd, ["log", `--since=${new Date(sonAktivite).toISOString()}`, "--name-only", "--pretty=format:"]);
    const dosyalar = [...new Set(cikti.split("\n").map((s) => s.trim()).filter(Boolean))];
    if (dosyalar.length === 0) eksen("dayanak-degisimi", "temiz", "kesintiden bu yana commit yok");
    else
      eksen(
        "dayanak-degisimi",
        "sapma",
        `${dosyalar.length} dosya değişti (ilk 8: ${dosyalar.slice(0, 8).join(", ")})`,
        "brife 'şunlar değişti, devam etmeden önce doğrula' satırı ekle",
      );
  } catch (e) {
    eksen("dayanak-degisimi", "olculemedi", `git okunamadı: ${String(e.message).slice(0, 120)}`, "dizin git deposu mu kontrol et");
  }
}

// ── A3 · yarım iş envanteri — kırık kalanlar (sapma DEĞİL, iş listesi) ──────
const todolar = Array.isArray(d?.neredeKaldi?.sonTodolar) ? d.neredeKaldi.sonTodolar : null;
let yarim = [];
if (!todolar) {
  eksen("yarim-is", "olculemedi", "son TodoWrite yok — 'nerede kaldı' nabzı okunamadı", "brifi son istek + kuyruk üzerinden kur; iş listesi tahmin edilmesin");
} else {
  yarim = todolar.filter((t) => t.status !== "completed");
  eksen("yarim-is", "temiz", `${yarim.length} açık madde / ${todolar.length} toplam`);
}

// ── A4 · plan aşaması — session'ın koştuğu aşama hâlâ açık mı ───────────────
const izler = [d?.neredeKaldi?.sonIstek, d?.amac?.ilkIstek, ...(todolar || []).map((t) => t.content)]
  .filter(Boolean)
  .join(" \n ");
const m = izler.match(/plans\/([a-z0-9._-]+)\/(v\d+)\/asama-(\d+)/i);
if (!m) {
  eksen("plan-asamasi", "temiz", "session bir plan aşamasına bağlı görünmüyor (muaf)");
} else if (!cwd) {
  eksen("plan-asamasi", "olculemedi", `aşama ${m[0]} anıldı ama cwd yok`, "plan STATE'ini elle kontrol et");
} else {
  const state = join(cwd, "plans", m[1], m[2], "STATE.md");
  if (!existsSync(state)) {
    eksen("plan-asamasi", "olculemedi", `${state} yok`, "plan taşınmış olabilir — agac.mjs --durum ile doğrula");
  } else {
    const no = m[3];
    const satir = readFileSync(state, "utf8")
      .split("\n")
      .find((s) => new RegExp(`^\\|\\s*${no}\\s*\\|`).test(s));
    if (!satir) eksen("plan-asamasi", "olculemedi", `STATE.md'de ${no} satırı bulunamadı`, "STATE tablosunu elle oku");
    else if (/KAPALI/.test(satir))
      eksen("plan-asamasi", "sapma", `aşama ${m[1]}/${m[2]}/${no} artık KAPALI — iş başkası tarafından bitirilmiş olabilir`, "devam ettirme; önce kanıtı oku, gerekirse işi DÜŞTÜ ilan et");
    else eksen("plan-asamasi", "temiz", `aşama ${no} hâlâ açık (${satir.trim().slice(0, 80)})`);
  }
}

// ── A5/A6 · eşzamanlılık: kilit sahipliği + çift koşum ──────────────────────
function claimDurum() {
  const adaylar = [
    resolve(BURASI, "..", "..", "eszamanli", "scripts", "claim.mjs"),
    join(HOME, ".claude", "skills", "eszamanli", "scripts", "claim.mjs"),
  ];
  const p = adaylar.find((x) => existsSync(x));
  if (!p) return null;
  try {
    return JSON.parse(execFileSync("node", [p, "status", "--json"], { encoding: "utf8", cwd: cwd || process.cwd(), maxBuffer: 8 * 1024 * 1024 }));
  } catch {
    return null;
  }
}
const cd = claimDurum();
const benim = d?.meta?.sessionId;
if (!cd) {
  eksen("kilit-sahipligi", "olculemedi", "claim.mjs status okunamadı", "node ~/.claude/skills/eszamanli/scripts/claim.mjs status");
  eksen("cift-kosum", "olculemedi", "canlı session envanteri okunamadı");
} else {
  const baskasinin = (cd.claims || []).filter((c) => c?.owner?.sessionId && c.owner.sessionId !== benim);
  if (baskasinin.length === 0) eksen("kilit-sahipligi", "temiz", "işin dokunacağı kaynaklarda başkasının kilidi yok");
  else
    eksen(
      "kilit-sahipligi",
      "sapma",
      `${baskasinin.length} kaynak başka session'da: ${baskasinin.map((c) => `${c.resource?.key} ← ${String(c.intent || "").slice(0, 60)}`).join(" | ")}`,
      "devam etmeden önce kesişimi ölç; kesişiyorsa claim.mjs wait ile sıraya gir",
    );

  // Çift koşum SEZGİSELDİR (İLAN edilir, kesin kanıt değildir). İki sıkılaştırma:
  // (1) yalnız AYNI cwd'deki session'lar — farklı proje alakasızdır;
  // (2) ayırt edici kelime (≥6 harf) kümeleri üzerinde kesişim: |∩| ≥ 3 VE
  //     |∩| / min(|A|,|B|) ≥ 0.3. Uzun bir ilk istekte "≥2 ortak kelime" bedava
  //     sağlanıyordu (canlı ölçüm 2026-07-27: 5 sahte eşleşme) — oran şart.
  const kelimeKumesi = (s) => new Set(String(s || "").toLowerCase().split(/\W+/).filter((w) => w.length >= 6));
  const canli = Array.isArray(cd.live) ? cd.live : [];
  const A = kelimeKumesi(d?.amac?.ilkIstek);
  const benzer = [];
  for (const s of canli) {
    const sid = s?.sessionId || s?.id;
    if (!sid || sid === benim) continue;
    if (s?.cwd && cwd && s.cwd !== cwd) continue; // farklı proje → alakasız
    const B = kelimeKumesi(s?.title || s?.baslik || s?.ozet);
    if (A.size === 0 || B.size === 0) continue;
    const ortak = [...A].filter((w) => B.has(w));
    if (ortak.length >= 3 && ortak.length / Math.min(A.size, B.size) >= 0.3)
      benzer.push({ sid, ortak });
  }
  const olcut = "sezgisel: aynı cwd ∧ ayırt edici kelime kesişimi ≥3 ∧ oran ≥0.3";
  if (benzer.length === 0) eksen("cift-kosum", "temiz", `aynı işi anlatan canlı session yok (${canli.length} canlı tarandı — ${olcut})`);
  else
    eksen(
      "cift-kosum",
      "sapma",
      `${benzer.length} canlı session benzer iş anlatıyor (${benzer.map((b) => `${String(b.sid).slice(0, 8)}:${b.ortak.slice(0, 4).join("/")}`).join(" | ")}) — ${olcut}`,
      "devam ettirmeden önce o session'ı kontrol et; sürüyorsa bu işi DÜŞTÜ ilan et",
    );
}

// ── hüküm önerisi ────────────────────────────────────────────────────────────
const sapmalar = eksenler.filter((e) => e.durum === "sapma");
const olculemedi = eksenler.filter((e) => e.durum === "olculemedi");
const hukumOnerisi = sapmalar.length === 0 && olculemedi.length === 0 ? "GECERLI" : "INCELE";

const sonuc = {
  $sinif: "motor · deterministik · 0 token",
  session: benim ?? null,
  cwd,
  olculdu: new Date(simdi).toISOString(),
  kesintiYasiSaat: yasSaat === null ? null : Number(yasSaat.toFixed(2)),
  esikSaat: opt.esikSaat,
  eksenler,
  yarimIs: yarim,
  sapmaSayisi: sapmalar.length,
  olculemedenSayisi: olculemedi.length,
  hukumOnerisi,
  not:
    hukumOnerisi === "GECERLI"
      ? "Sapma yok — hüküm GEÇERLİ, ajan DOĞMAZ (0 token). Doğrudan devam ettirilebilir."
      : "Sapma/ölçülemeyen eksen var — hükmü (GEÇERLİ | REVİZE | DÜŞTÜ) /devam'ı çağıran oturum verir. Bu motor hüküm VERMEZ.",
};

if (opt.json) {
  console.log(JSON.stringify(sonuc, null, 1));
} else {
  console.log(`# /devam geçerlilik — ${sonuc.session ?? "(session?)"}  [${sonuc.$sinif}]`);
  console.log(`  kesinti: ${sonuc.kesintiYasiSaat ?? "?"} sa (eşik ${opt.esikSaat})   cwd: ${cwd ?? "?"}`);
  for (const e of eksenler) {
    const im = e.durum === "temiz" ? "✓" : e.durum === "sapma" ? "⚠" : "?";
    console.log(`  ${im} ${e.ad.padEnd(20)} ${e.detay}`);
    if (e.onar) console.log(`      onar: ${e.onar}`);
  }
  if (yarim.length) {
    console.log(`  yarım iş (${yarim.length}):`);
    for (const t of yarim.slice(0, 10)) console.log(`      [${t.status}] ${t.content}`);
  }
  console.log(`\n  HÜKÜM ÖNERİSİ: ${hukumOnerisi}   (sapma ${sapmalar.length} · ölçülemedi ${olculemedi.length})`);
  console.log(`  ${sonuc.not}`);
}

process.exit(hukumOnerisi === "GECERLI" ? 0 : 1);
