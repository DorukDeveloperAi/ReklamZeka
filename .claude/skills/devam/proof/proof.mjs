#!/usr/bin/env node
// /devam — KANIT  ·  sınıf: kapı (deterministik) · maliyet: 0 token
// gecerlilik.mjs'in SÖZLEŞMESİNİ ölçer: eksen kümesi · fail-closed davranış ·
// çıkış kodu · hüküm sınırı (motor asla REVIZE/DUSTU üretmez).
//
// İLAN EDİLEN MUAFİYET: `dayanak-degisimi` · `kilit-sahipligi` · `cift-kosum`
// eksenleri ORTAMA bağlıdır (gerçek git ağacı / canlı claim defteri). Proof
// bunların DEĞERİNİ değil, SÖZLEŞMESİNİ ölçer (eksen var mı, durumu geçerli
// bir etiket mi). Değer ölçümü canlı koşumun işidir.

import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const BURASI = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(BURASI, "..", "scripts", "gecerlilik.mjs");
const GECERLI_DURUM = new Set(["temiz", "sapma", "olculemedi"]);

let gecti = 0, kaldi = 0;
function ok(ad, kosul, detay = "") {
  if (kosul) { gecti++; console.log(`  ✓ ${ad}`); }
  else { kaldi++; console.log(`  ✗ ${ad}${detay ? ` — ${detay}` : ""}`); }
}

/** gecerlilik.mjs'i sentetik demetle koş; {kod, json} döndür. */
function kos(demet, ekArgs = []) {
  try {
    const cikti = execFileSync("node", [SCRIPT, "--demet", "-", "--json", ...ekArgs], {
      input: JSON.stringify(demet), encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
    });
    return { kod: 0, json: JSON.parse(cikti) };
  } catch (e) {
    if (e.stdout) { try { return { kod: e.status, json: JSON.parse(e.stdout) }; } catch { /* düş */ } }
    return { kod: e.status ?? -1, json: null, hata: String(e.message).slice(0, 200) };
  }
}

const simdi = new Date().toISOString();
const eski = new Date(Date.now() - 100 * 36e5).toISOString(); // 100 saat önce

/** cwd'siz demet — git/plan eksenleri ölçülemez olur (fail-closed yolunu açar). */
function demet({ sonAktivite = simdi, cwd = null, sonIstek = null, todolar = null, ilkIstek = "test isi" } = {}) {
  return {
    meta: { sessionId: "PROOF-0001", depo: "/yok", slug: "yok", cwd, sonAktivite, hardResume: null },
    amac: { ilkIstek },
    neredeKaldi: { sonIstek, sonZaman: sonAktivite, sonTodolar: todolar, kuyruk: [] },
    planlar: null, kaptanHedefi: null, devralis: null, git: null, uyarilar: [],
  };
}

console.log("# /devam proof — gecerlilik.mjs sözleşmesi\n");

// ── 1. temel çıktı sözleşmesi ───────────────────────────────────────────────
const r1 = kos(demet());
ok("geçerli JSON döner", r1.json !== null, r1.hata);
ok("zorunlu alanlar var", r1.json && ["eksenler", "hukumOnerisi", "sapmaSayisi", "olculemedenSayisi", "olculdu"].every((k) => k in r1.json));
ok("sınıf ilanı taşır (deterministik/0 token)", /motor/.test(r1.json?.$sinif || "") && /0 token/.test(r1.json?.$sinif || ""));

// ── 2. eksen kümesi tam ─────────────────────────────────────────────────────
const adlar = (r1.json?.eksenler || []).map((e) => e.ad);
for (const beklenen of ["kesinti-yasi", "dayanak-degisimi", "yarim-is", "plan-asamasi", "kilit-sahipligi", "cift-kosum"])
  ok(`eksen var: ${beklenen}`, adlar.includes(beklenen), `bulunanlar: ${adlar.join(",")}`);
ok("her eksenin durumu geçerli etiket", (r1.json?.eksenler || []).every((e) => GECERLI_DURUM.has(e.durum)));
ok("sapma/ölçülemedi eksenleri onar: satırı taşır",
  (r1.json?.eksenler || []).filter((e) => e.durum !== "temiz").every((e) => typeof e.onar === "string" ? e.onar.length > 0 : true));

// ── 3. hüküm SINIRI — motor hüküm vermez ────────────────────────────────────
ok("hükümÖnerisi yalnız GECERLI|INCELE (motor REVIZE/DUSTU üretmez)",
  ["GECERLI", "INCELE"].includes(r1.json?.hukumOnerisi), `gelen: ${r1.json?.hukumOnerisi}`);
ok("not alanı hükmün kimde olduğunu söyler", /hüküm/i.test(r1.json?.not || ""));

// ── 4. kesinti yaşı eşiği ───────────────────────────────────────────────────
const taze = kos(demet({ sonAktivite: simdi }));
const bayat = kos(demet({ sonAktivite: eski }));
const eksenBul = (r, ad) => (r.json?.eksenler || []).find((e) => e.ad === ad);
ok("taze kesinti → kesinti-yasi temiz", eksenBul(taze, "kesinti-yasi")?.durum === "temiz");
ok("100 sa kesinti → kesinti-yasi sapma", eksenBul(bayat, "kesinti-yasi")?.durum === "sapma");
const yuksekEsik = kos(demet({ sonAktivite: eski }), ["--esik-saat", "200"]);
ok("--esik-saat eşiği gerçekten değiştirir", eksenBul(yuksekEsik, "kesinti-yasi")?.durum === "temiz");
ok("bozuk sonAktivite → olculemedi (uydurmaz)", eksenBul(kos(demet({ sonAktivite: "ÇÖP" })), "kesinti-yasi")?.durum === "olculemedi");

// ── 5. FAIL-CLOSED — ölçülemeyen eksen temiz sayılmaz ───────────────────────
ok("ölçülemeyen eksen varsa hüküm INCELE", r1.json?.olculemedenSayisi > 0 ? r1.json?.hukumOnerisi === "INCELE" : true);
ok("INCELE → çıkış kodu 1", r1.json?.hukumOnerisi === "INCELE" ? r1.kod === 1 : true);
ok("sapma sayısı ile eksen tablosu tutarlı",
  r1.json?.sapmaSayisi === (r1.json?.eksenler || []).filter((e) => e.durum === "sapma").length);
ok("ölçülemedi sayısı ile eksen tablosu tutarlı",
  r1.json?.olculemedenSayisi === (r1.json?.eksenler || []).filter((e) => e.durum === "olculemedi").length);

// ── 6. yarım iş envanteri ───────────────────────────────────────────────────
const ty = kos(demet({ todolar: [
  { content: "biten", status: "completed" },
  { content: "süren", status: "in_progress" },
  { content: "bekleyen", status: "pending" },
] }));
ok("yarım iş yalnız açık maddeleri sayar", (ty.json?.yarimIs || []).length === 2);
ok("yarım iş envanteri SAPMA değildir", eksenBul(ty, "yarim-is")?.durum === "temiz");
ok("TodoWrite yoksa yarim-is olculemedi (tahmin etmez)", eksenBul(r1, "yarim-is")?.durum === "olculemedi");

// ── 7. plan aşaması izi ─────────────────────────────────────────────────────
ok("plan anılmıyorsa plan-asamasi muaf/temiz", eksenBul(r1, "plan-asamasi")?.durum === "temiz");
const planli = kos(demet({ sonIstek: "plans/yok-boyle-bir-plan/v1/asama-03-test planını uygula", cwd: null }));
ok("plan anılıyor ama cwd yoksa olculemedi", eksenBul(planli, "plan-asamasi")?.durum === "olculemedi");

// ── 8. kullanım hatası ──────────────────────────────────────────────────────
let kod2 = null;
try { execFileSync("node", [SCRIPT], { encoding: "utf8", stdio: "pipe" }); kod2 = 0; }
catch (e) { kod2 = e.status; }
ok("argümansız çağrı → çıkış kodu 2", kod2 === 2);

// ── 9. idempotens ───────────────────────────────────────────────────────────
const a = kos(demet({ sonAktivite: eski }));
const b = kos(demet({ sonAktivite: eski }));
const soy = (j) => JSON.stringify({ ...j, olculdu: null, kesintiYasiSaat: null });
ok("çift koşum aynı hükmü verir (zaman alanları hariç)", soy(a.json) === soy(b.json));

console.log(`\n${gecti}/${gecti + kaldi} geçti${kaldi ? ` · ${kaldi} KALDI` : ""}`);
process.exit(kaldi ? 1 : 0);
