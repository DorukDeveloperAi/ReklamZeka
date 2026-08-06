#!/usr/bin/env node
// slot.mjs — SLOT SEÇİCİ (otonomi-merdiveni:04 · merdivenin B1 basamağı).
//
// SINIF: motor (seçim) · deterministik · 0 token · **LLM DOĞURMAZ** · **tmux GEREKTİRMEZ** ·
// **aide GEREKTİRMEZ** (`oturum.mjs` emsali: L0 yüzeyleri üst katmanın şalterine bağlı olamaz;
// `aide sistem kapat` bu script'i susturmaz).
//
// ── NİÇİN VAR ───────────────────────────────────────────────────────────────────────────
// "Hangi işi alayım" kararını bugün İNSAN veriyor: sekme açılıyor, `/goal` yapıştırılıyor.
// Rotacı'nın E4 hamlesi aynı işi yapabilir ama K1 daemon kapısı `paused:true` iken BOŞ döner
// ve metronom K-MA1 gereği en son açılacak. Yani merdivenin en temel işlevi — sıradaki işi
// bulmak — bugün hiçbir otomatik katmanda YOK. Bu script o boşluğu, **yetki açmadan** doldurur.
//
// ── İKİ KADEME (kullanıcı kararı K1, 2026-08-03) ────────────────────────────────────────
//   K0  `slot.mjs oner`  → ADAY LİSTESİ. Salt-okur: yazmaz, claim ALMAZ, hiçbir şey başlatmaz.
//   K1  `slot.mjs al`    → ÜSTLENME. **YALNIZ kullanıcı komutuyla.** Sessiz çek-başla YOKTUR.
// Gerekçe ölçülmüştür: kullanıcının sözlü ya da henüz todo'ya düşmemiş işi ölçülemez;
// ölçülemeyeni varsayılan yapmak 2026-07-16'da arşivlenen runner ağının dersinin tekrarı olurdu.
//
// ── ÜÇ SERT YASAK ───────────────────────────────────────────────────────────────────────
// 1. **FAN-OUT YOK (R4).** Bu dosyada yeni koşum doğuran hiçbir yol yoktur ve olmayacaktır.
//    Çıktı bir KOMUT METNİdir; onu çalıştıran insandır. Yetki B3'te (Rotacı) kalır.
// 2. **İKİNCİ SIRALAYICI YOK (01 §5).** Sıra hükmünün tek sahibi `agac.mjs`tir; burada
//    yalnız künye alanları OKUNUR (`kunye.oncelik` → `kunye.puan` → `slug`). Rotacı'nın
//    `profil.oncelik` ezmesi B1'de YOKTUR — ilan edilmiş fark.
// 3. **SESSİZ PASS YOK.** Ölçülemeyen (`oturum.mjs bu` exit 2) hüküm doğurmaz: K0'a düşülür.
//
// ── ÇIKIŞ SÖZLEŞMESİ ────────────────────────────────────────────────────────────────────
//   0  slot alındı (`al`) · liste basıldı ya da aday yok (`oner`)
//   1  RED — ölçtüm, olmaz (açık işim var · tavan doldu)
//   2  ÖLÇÜLEMEDİ — hüküm yok, K0 listesi basıldı ("ölçemedim" ≠ "ölçtüm, kötü")
//   3  ÇAKIŞMA — kaynağı başkası tutuyor (claim DENY)
//   4  BAYAT AŞAMA — `hazirla.mjs`in kapısı; YUTULMAZ, aynen taşınır

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// Uçların hepsi CLAUDE_CONFIG_DIR-farkındadır (hazirla.mjs:55-56 emsali): seçici ile ağaç
// AYNI hesabın kopyaları olmalı, yoksa iki farklı ready-set doğar. Env ezmeleri TEST içindir.
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
const AGAC = process.env.SLOT_AGAC || path.join(CLAUDE_DIR, "skills/plan-organizatoru/scripts/agac.mjs");
const HAZIRLA = process.env.SLOT_HAZIRLA || path.join(CLAUDE_DIR, "skills/planla-kos/scripts/hazirla.mjs");
const OTURUM = process.env.SLOT_OTURUM || path.join(CLAUDE_DIR, "skills/plan-organizatoru/scripts/oturum.mjs");
const CLAIM = process.env.SLOT_CLAIM || path.join(CLAUDE_DIR, "skills/eszamanli/scripts/claim.mjs");

const argv = process.argv.slice(2);
const cmd = argv[0] || "oner";
const opt = (ad, d = null) => { const i = argv.indexOf(ad); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };
const bayrak = (ad) => argv.includes(ad);

const PROJE = path.resolve(opt("--proje", process.cwd()));
const SESSION_ID = opt("--session") || process.env.CLAUDE_CODE_SESSION_ID || null;
/** Kaç aday basılır. Liste bir MENÜ değil, bir işaret — uzunluğu bilgi taşımaz. */
const N = parseInt(opt("--n", "5"), 10);

const die = (kod, msg) => { console.error(msg); process.exit(kod); };

function kos(bin, args, opts = {}) {
  const r = spawnSync(bin, args, { encoding: "utf8", timeout: 60_000, ...opts });
  return { exit: r.status, out: r.stdout ?? "", err: r.stderr ?? "", spawnHatasi: r.error?.message ?? null };
}

// ── VERİ (04.1) — ready-set'in TEK sahibi agac.mjs -------------------------------------
// `agac.mjs` SPAWN edilir; `plans/INDEX.json` OKUNMAZ (bayat-INDEX bağışıklığı,
// `hazirla.mjs:5-7` emsali). `siradaki` alanı **OKUNMAZ**: o, `.dag-aktif` yokken üretilen
// lineer-legacy alandır; DAG çözümlü doğru küme `hazir[]`tir (`agac.mjs:460` vs `:473`).
function planlariOku() {
  const r = kos("node", [AGAC, "--durum", "--json", "--proje", PROJE]);
  if (r.exit !== 0 && !r.out.trim()) return { hata: r.spawnHatasi || r.err.trim() || `agac.mjs exit ${r.exit}` };
  let j;
  try { j = JSON.parse(r.out); } catch (e) { return { hata: `agac.mjs --durum --json parse edilemedi: ${e.message}` }; }
  const plans = Array.isArray(j?.plans) ? j.plans : Array.isArray(j?.planlar) ? j.planlar : null;
  if (!plans) return { hata: "agac.mjs çıktısında plans[] yok" };
  return { plans };
}

// ── SÜZGEÇ (04.2) — kim DOLU ------------------------------------------------------------
// İki bağımsız kaynak; ikisi de "o aşamada zaten biri var" der ama farklı şeyi ölçer:
//   (a) CANLI SESSION — pid+procStart doğrulamalı; başlığı `/goal plans/<slug>/v<N>/asama-<NN>`
//       taşıyorsa o aşama dolu. Session henüz claim ALMAMIŞ olabilir (claim yazım penceresinde
//       alınır) — bu yüzden claim'e bakmak TEK BAŞINA yetmez.
//   (b) AKTİF CLAIM — `plan:<slug>:asama:<no>` ⊕ `glob:plans/<slug>/**`. Aşama 03'ün köprüsü
//       ikisini aynı aileye soktu; burada da İKİSİ birden sayılır, yoksa köprünün açtığı
//       yarış B1'de yeniden doğardı.
// Claim biçimi PLAN düzeyindeyse (`glob:…/**`) o planın TÜM hazır aşamaları dolu sayılır —
// glob gerçekten hepsini kilitler; daha dar davranmak DENY'i garanti eden bir öneri üretirdi.

const BASLIK_RE = /plans\/([A-Za-z0-9._-]+)\/v(\d+)\/asama-(\d+)/;

/** claims-lib'i KİT içinden çöz; yoksa süzgecin o bacağı "ölçülemedi"dir (sessizce boş değil). */
async function claimsLib() {
  const adaylar = [
    process.env.SLOT_CLAIMS_LIB,
    path.join(CLAUDE_DIR, "hooks/claims-lib.mjs"),
    path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../../hooks/claims-lib.mjs"),
  ].filter(Boolean);
  for (const y of adaylar) {
    if (!existsSync(y)) continue;
    try { return await import(y.startsWith("/") ? `file://${y}` : y); } catch { /* sonraki aday */ }
  }
  return null;
}

/** Defter anahtarı KANONİK repo kökü olmalı. `repoRootOf` cwd'yi realpath'ler; ham yolla
 *  sorarsak macOS'ta `/var/…` ile `/private/var/…` (ya da `/tmp` ↔ `/private/tmp`) aynı repoyu
 *  İKİ deftere böler ve süzgeç sessizce BOŞ döner — yani her aşama "boş" görünür ve seçici
 *  dolu bir aşamayı önerir. claims-lib bu tuzağı kendi yorumunda ilan ediyor (`repoRootOf`);
 *  ölçüldü: ham yolla canlı-session süzgeci fikstürde hiçbir şeyi elemedi. */
function repoAnahtari(L) {
  try { return L?.repoRootOf ? L.repoRootOf(PROJE) || PROJE : PROJE; } catch { return PROJE; }
}

/** Canlı session başlıklarından dolu aşama kümesi. Kendi session'ımı SAYMAM (kendi turumda
 *  koşacağım iş, kendime "dolu" görünmemeli). */
function canliDolu(L) {
  const dolu = new Set();
  if (!L?.liveSessionsIn) return { dolu, olculdu: false };
  let sessions = [];
  try { sessions = L.liveSessionsIn(repoAnahtari(L)) || []; } catch { return { dolu, olculdu: false }; }
  for (const s of sessions) {
    const sid = String(s?.sessionId || s?.session_id || "");
    if (SESSION_ID && sid && (sid === SESSION_ID || SESSION_ID.startsWith(sid) || sid.startsWith(SESSION_ID))) continue;
    const m = BASLIK_RE.exec(String(s?.title || ""));
    if (m) dolu.add(`${m[1]}:${String(m[3])}`);
  }
  return { dolu, olculdu: true };
}

/** Aktif claim'lerden dolu aşama/plan kümesi. `*` = plan düzeyi kilit (tüm aşamalar). */
function claimDolu(L) {
  const asama = new Set(), plan = new Set();
  if (!L?.activeClaims || !L?.planSlugOfKey) return { asama, plan, olculdu: false };
  let claims = [];
  try { claims = L.activeClaims(repoAnahtari(L)) || []; } catch { return { asama, plan, olculdu: false }; }
  for (const c of claims) {
    const sid = String(c?.owner?.sessionId || "");
    if (SESSION_ID && sid && (sid === SESSION_ID || SESSION_ID.startsWith(sid) || sid.startsWith(SESSION_ID))) continue;
    const k = L.planSlugOfKey(c?.resource?.key || c?.key || "");
    if (!k) continue;
    if (k.no === "*") plan.add(k.slug); else asama.add(`${k.slug}:${k.no}`);
  }
  return { asama, plan, olculdu: true };
}

/** Künye sırası — `agac.mjs`in TÜRETTİĞİ alanlar OKUNUR, yeniden hesaplanmaz (01 §5).
 *  Künyesiz planın puanı −1'dir: beyan yoksa üstünlük de yok (reconcile.mjs ile aynı ilke). */
function kunyeSirasi(a, b) {
  const o = (p) => (p.kunye?.oncelik ?? 0), u = (p) => (p.kunye?.puan ?? -1);
  return o(b) - o(a) || u(b) - u(a) || String(a.slug).localeCompare(String(b.slug));
}

async function adaylar() {
  const { plans, hata } = planlariOku();
  if (hata) return { hata };
  const L = await claimsLib();
  const c = canliDolu(L), q = claimDolu(L);
  const olculemeyen = [];
  if (!L) olculemeyen.push("claims-lib bulunamadı — canlı session ve claim süzgeci KOŞMADI");
  else {
    if (!c.olculdu) olculemeyen.push("canlı session süzgeci ölçülemedi");
    if (!q.olculdu) olculemeyen.push("aktif claim süzgeci ölçülemedi");
  }
  const out = [];
  for (const p of [...plans].sort(kunyeSirasi)) {
    if (q.plan.has(p.slug)) continue; // plan düzeyi kilit → TÜM aşamaları dolu
    for (const h of Array.isArray(p.hazir) ? p.hazir : []) {
      const anahtar = `${p.slug}:${String(h.no)}`;
      if (c.dolu.has(anahtar) || q.asama.has(anahtar)) continue;
      out.push({ slug: p.slug, v: p.v, no: String(h.no), ad: h.ad, goal: h.goal, anahtar });
    }
  }
  return { adaylar: out, olculemeyen };
}

// ── K0 — ÖNERİ (04.3) -------------------------------------------------------------------
// SALT-OKUR. Aday yoksa **0 bayt** (sinyalsiz çıktı yasağı, `acilis.mjs` emsali): "aday yok"
// diye bir satır basmak, her açılışta gürültü üretir ve kanalı köreltirdi.
function k0Bas(list, olculemeyen = []) {
  const satirlar = [];
  for (const a of list.slice(0, N)) {
    satirlar.push(`${a.anahtar}  ${a.ad || ""}`.trimEnd());
    satirlar.push(`  al : node slot.mjs al --slug ${a.slug} --asama ${a.no}`);
    satirlar.push(`  ya da elle: ${a.goal}`);
  }
  // Ölçülemeyen süzgeç İLAN edilir: eksik süzgeçle üretilmiş liste "temiz" sanılmamalı.
  for (const o of olculemeyen) satirlar.push(`  ⚠ ölçülemedi: ${o} — liste DOLU aşama içerebilir`);
  if (satirlar.length) console.log(satirlar.join("\n"));
}

// ── K1 — ÇEK-BAŞLA (04.4) ---------------------------------------------------------------
// Kapılar SIRALIDIR ve sıra sözleşmedir: önce "benim hakkım var mı" (oturum defteri + tavan),
// sonra "kaynak boş mu" (claim), en sonra "iş hâlâ geçerli mi" (hazirla exit 4). Claim'i en
// başta almak, tavana takılan bir seçicinin kilidi boşuna tutması demekti.

/** `oturum.mjs bu` — üç değerli. exit 0 temiz · 1 açık iş var · 2 ÖLÇÜLEMEDİ.
 *  `--json` GEÇİLMEZ: `bu` onu tanımıyor (ölçüldü 2026-08-03, bayrak sessizce yutuluyor);
 *  tanımayan bir bayraktan alan okumak, tavanı üretimde ÖLÜ bırakırdı. */
function oturumHukmu() {
  const args = ["bu"];
  if (SESSION_ID) args.push("--session", SESSION_ID);
  const r = kos("node", [OTURUM, ...args]);
  if (r.spawnHatasi) return { exit: 2, detay: r.spawnHatasi };
  return { exit: r.exit, detay: (r.out || r.err).trim().split("\n")[0] || "" };
}

/** ARDIŞIK ÇEKİŞ SAYISI — oturum defterinden TÜRETİLİR (04.5).
 *
 *  AYRI SAYAÇ DOSYASI YOKTUR ve olmayacaktır: ikinci bir sayaç, defterle ayrışabilen ikinci
 *  bir doğru üretirdi (bu planın bütün derdi tam olarak bu). Türetme şu olguya dayanır:
 *  bir slot üstlenildiğinde o iş için `plans/oturumlar/<tarih>-<slug>.md` defteri açılır ve
 *  künyesine `Session: <kısa-id>` yazılır. Bu session'a ait defter sayısı = bu session'ın
 *  şimdiye dek üstlendiği iş sayısıdır. Sayı ÖLÇÜLEMEZSE (dizin yok/okunamıyor) tavan
 *  UYGULANMAZ — ölçemediğimiz şeyle kimseyi reddetmeyiz (şüphe serbest bırakma yönünde). */
function cekisSayisi() {
  if (!SESSION_ID) return { sayi: 0, olculdu: false };
  const kisa = String(SESSION_ID).slice(0, 8);
  const dir = path.join(PROJE, "plans", "oturumlar");
  let dosyalar;
  try { dosyalar = readdirSync(dir).filter((f) => f.endsWith(".md")); } catch { return { sayi: 0, olculdu: false }; }
  let n = 0;
  for (const f of dosyalar) {
    try { if (new RegExp(`Session:\\s*${kisa}`).test(readFileSync(path.join(dir, f), "utf8"))) n++; } catch { /* okunamayan defter sayılmaz */ }
  }
  return { sayi: n, olculdu: true };
}

async function k1Al() {
  const slug = opt("--slug"), no = opt("--asama");
  if (!slug || !no) die(1, "kullanım: slot.mjs al --slug <slug> --asama <no> [--zorla]");

  // 1) Oturum defteri — hakkım var mı?
  const h = oturumHukmu();
  if (h.exit === 2) {
    // ÖLÇÜLEMEDİ → hüküm YOK. Sessiz başlatma yerine K0'a düşülür (K1 kararının çekirdeği).
    const a = await adaylar();
    if (!a.hata) k0Bas(a.adaylar, a.olculemeyen);
    die(2, `oturum defteri ÖLÇÜLEMEDİ (${h.detay || "?"}) — slot ALINMADI, yukarıdaki liste yalnız ÖNERİdir.\n  onar: node oturum.mjs tohumla   # bu oturumun dosyasını aç`);
  }
  if (h.exit !== 0) die(1, `bu oturumda AÇIK iş var — slot alınmaz (${h.detay || "oturum.mjs bu exit 1"}).\n  onar: açık hedefi kapat ya da işi bitir, sonra tekrar dene`);

  // 2) Ardışık çekiş tavanı N=1 — oturum defterinden TÜRETİLİR.
  //    `--zorla` tavanın DIŞINDADIR: tavan ZİNCİRİ sonlu tutar, kullanıcının iradesini değil.
  const cekis = cekisSayisi();
  if (cekis.olculdu && cekis.sayi >= 1 && !bayrak("--zorla")) {
    die(1, `ardışık çekiş tavanı doldu (N=1; bu session'ın defterinde ${cekis.sayi} iş var) — zincir sonlu tutulur.\n  onar: gerçekten istiyorsan --zorla ekle (kullanıcı komutu tavanın DIŞINDADIR)`);
  }

  // 3) Claim — kanonik biçim (03'ün köprüsü bunu `plans/<slug>/**`e çözer).
  const res = `plan:${slug}:asama:${no}`;
  const c = kos("node", [CLAIM, "claim", "--res", res, "--intent", `slot: ${slug} aşama ${no}`]);
  if (c.exit !== 0) die(3, `${(c.err || c.out).trim() || `claim reddedildi: ${res}`}`);
  const birak = () => kos("node", [CLAIM, "release", "--res", res]);

  // 4) `hazirla.mjs` KURU — /goal satırı TÜKETİLİR, asla yeniden üretilmez (Ders 2/17).
  //    exit 4 = bayat/hazir-dışı aşama. YUTULMAZ: claim bırakılır ve kod aynen taşınır,
  //    yoksa seçici kapanmış bir aşamayı canlıymış gibi sunardı.
  const p = kos("node", [HAZIRLA, "--proje", PROJE, "--slug", slug, "--asama", no, "--kapsam", "1", "--otonomi", "sor", "--json"]);
  if (p.exit === 4) { birak(); die(4, `${(p.err || "aşama hazir listesinde değil").trim()}\n  claim BIRAKILDI: ${res}`); }
  if (p.exit !== 0) { birak(); die(2, `hazirla.mjs ölçülemedi (exit ${p.exit}): ${(p.err || p.spawnHatasi || "?").trim()}\n  claim BIRAKILDI: ${res}`); }
  let satir;
  try { satir = JSON.parse(p.out)?.satir; } catch { /* aşağıda ele alınır */ }
  if (!satir) { birak(); die(2, `hazirla.mjs --json çıktısında 'satir' yok — claim BIRAKILDI: ${res}`); }

  // 5) Çıktı bir KOMUT METNİdir. Dispatch YOK, tetik YOK — çalıştıran insandır (R4).
  console.log(`SLOT ALINDI: ${slug} aşama ${no}  (claim: ${res})`);
  console.log("");
  console.log(satir);
  console.log("");
  console.log(`bitince BIRAK: node ${path.basename(CLAIM)} release --res "${res}"`);
  process.exit(0);
}

// ── giriş ------------------------------------------------------------------------------
const komutlar = {
  async oner() {
    const a = await adaylar();
    if (a.hata) die(2, `ADAY KÜMESİ ÖLÇÜLEMEDİ: ${a.hata}\n  onar: node agac.mjs --durum --json --proje ${PROJE}`);
    // `--json` (otonomi-merdiveni:08) — MAKİNE ucu. Neden eklendi: 08'in hook bacağı bu listeyi
    // TÜKETİR ve insan metnini parse etmek kırılgandır (k0Bas'ın satır biçimi bir SÖZLEŞME
    // değil, bir sunumdur). ÖLÇÜLDÜ 2026-08-04: bayrak daha önce YOKTU ve `argv`de sessizce
    // yutuluyordu — plan metni onu var sayıyordu (bayat beyan). Sessiz PASS yasağı burada da
    // geçerli: `olculemeyen` JSON'da da TAŞINIR, yoksa eksik süzgeçle üretilmiş liste
    // makine ucunda "temiz" sanılırdı.
    if (bayrak("--json")) {
      console.log(JSON.stringify({ adaylar: a.adaylar.slice(0, N), olculemeyen: a.olculemeyen }));
      process.exit(0);
    }
    k0Bas(a.adaylar, a.olculemeyen); // aday yoksa 0 bayt
    process.exit(0);
  },
  al: k1Al,
};

const fn = komutlar[cmd];
if (!fn) die(1, `bilinmeyen komut: ${cmd}\nkullanım: slot.mjs oner [--n N] [--json] | al --slug <s> --asama <no> [--zorla]`);
fn().catch((e) => die(2, `SLOT HATASI: ${String(e?.message || e)}`));
