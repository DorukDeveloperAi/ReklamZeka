#!/usr/bin/env node
/**
 * oturum-kapanis.mjs — OTURUM boyutunun kapanış VE açılış halkası.
 *
 * ⚠ **İKİ UÇLU HOOK; AD TARİHSELDİR.** Dosya SessionEnd için doğdu (aşama-05), aşama-06'da
 * SessionStart ucunu da üstlendi — ad değiştirilmedi çünkü ad bir YOLDUR: kayıtlı `settings.json`
 * girişleri, kit paketi (`hook:oturum-kapanis`), hata defteri (`oturum-kapanis.err.jsonl`) ve
 * `aide kurulum doctor` ekseni hepsi bu adı taşır; yeniden adlandırma dört yüzeyde eşzamanlı
 * göç isterdi. Emsal: `claim-guard.mjs` tek dosyadan DÖRT olayı sürer (`ctx`·`pre`·`post`·`stop`).
 *
 *   argümansız     → SessionEnd  (kapanış zinciri: tohumla → kapat → devir → durum → global)
 *   `acilis`       → SessionStart (açılış özeti → `additionalContext`; devralma bloğu
 *                    ≤12 satır / ≤900 karakter · akış/slot bloğu AYRI ve aynı tavanda)
 *   `akis-tazele`  → HOOK OLAYI DEĞİL (aşama-08): açılışın ayrık tetiklediği tazeleyici.
 *                    `settings.json`da kaydı yoktur; ölçümü senkron yoldan uzak tutar.
 *
 * İki uç arasında ORTAK olan tek şey `projeKoku` + `OTURUM` yoludur; karar mantığı İKİSİNDE DE
 * hook'ta DEĞİL `oturum.mjs`tedir (tek yazar: oturum domain'i). Hook yalnız taşır.
 *
 * SINIF: motor · deterministik · 0 token · **aide GEREKTİRMEZ**.
 *
 * NEDEN HOOK (kullanıcı kararı 2026-07-27): "aide sisteminin değil, session'ların kendi
 * talimatlarının da rol alması lazım; yani aide kapalıyken de çalışmalı." Hook'lar Claude
 * Code'un yüzeyidir — Maestro/daemon/tmux şalterinden BAĞIMSIZ koşar. `aide sistem kapat`
 * bu halkayı DURDURMAZ. aide katmanı (pano · bekçi · boot adımı) bunun ÜSTÜNE kalite koyar;
 * tabanı taşımaz.
 *
 * NE YAPAR (sırayla, hepsi deterministik):
 *   1. tohumla — oturum dosyasını kaptan nabzından tazele (yeni hedef ekle, tamamlananı işaretle)
 *   2. kapat   — dosyayı `Durum: KAPALI` damgala → açık iş artık EKSİK sayılır (hüküm sertleşir)
 *   3. devir   — DEVİR NOTU yaz: `plans/oturumlar/devir/<ref>.json` (niyet · nerede kaldı ·
 *                açık hedef/todo · hüküm · tutulan+bırakılan kilitler · sıradaki adım ·
 *                varsa devam-modeli önerisi · TAM session id). Session ölümü niyeti diske
 *                bırakır — transcript hesaba bağlıdır, bu not PROJEYE (git'e) düşer.
 *   4. durum   — projenin `plans/OTURUMLAR.md` roll-up'ını türet (beyan ↔ gerçek yan yana)
 *   5. global  — projeler-arası `~/.claude/oturum/KILAVUZ.md` sıralı devralma listesini türet
 *   6. kasa    — OTURUM KASASI: bu repoda O AN AÇIK olan HER sekmenin (yalnız kapananın değil)
 *                sıkıştırılmış fotoğrafı + yeniden başlatma komutu → `plans/oturumlar/kasa/`.
 *                Devir notu KAPANANIN hükmüdür; kasa AÇIK KALANLARIN yedeğidir — devralan
 *                ekranı değil klasörü devralır ve sekmeleri tek tek geri açabilir.
 *
 * DOSYA AÇMA EŞİĞİ — ilanlı muafiyet: her oturum dosya AÇMAZ. Dosya YOKKEN hook ancak nabızda
 * ≥ EŞİK (varsayılan 3, `AIDE_OTURUM_ESIK` ile ayarlanır) madde varsa açar. Gerekçe: "burası
 * tamamlandı mı?" gibi tek soruluk oturumlar için kanonda dosya üretmek `plans/oturumlar/`'ı
 * gürültüyle doldurur ve asıl sinyali gömerdi; eşik altındaki oturumun todo'ları kaptan
 * nabzında ZATEN duruyor (kendi kanalı var). Dosya VARSA eşik uygulanmaz — oturum beyanını
 * bir kez yaptıysa kapanışı her koşulda işlenir.
 *
 * ASLA BLOKE ETMEZ: her hata yutulur, exit 0. Sapma sessiz de kalmaz —
 * `{{CLAUDE}}/hooks/oturum-kapanis.err.jsonl`'a yazılır (kit-bootstrap emsali: çift ilan).
 */

import {
  readFileSync, existsSync, appendFileSync, statSync, readdirSync, writeSync,
  mkdirSync, writeFileSync, renameSync,
} from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync, spawn } from 'node:child_process';

// KOŞUM DAMGASI (otonomi-merdiveni:02.3) — `aide otomasyon durum`un akıbet ekseni bunu okur.
// Dinamik import + try: damga yazarı yoksa ya da bozuksa hook KOŞMAYA DEVAM EDER; bir ölçüm
// aracı ölçtüğü şeyi asla bozamaz. Maliyet: bir dosya yazımı, 0 token.
try { (await import("./hook-nabiz.mjs")).nabiz("oturum-kapanis", process.argv[2]); } catch {}

const CLAUDE = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
const OTURUM = join(CLAUDE, 'skills', 'plan-organizatoru', 'scripts', 'oturum.mjs');
const KASA = join(CLAUDE, 'skills', 'soft-resume', 'scripts', 'kasa.mjs');
const SLOT = join(CLAUDE, 'skills', 'planla-kos', 'scripts', 'slot.mjs');
const ERR = join(CLAUDE, 'hooks', 'oturum-kapanis.err.jsonl');
const ESIK = Number(process.env.AIDE_OTURUM_ESIK || 3);

/* ═══════════ AKIŞ/SLOT bloğu — sabitler (otonomi-merdiveni:08) ═══════════
 *
 * SINIFI **DURUM**tur (Sınıf 2): makineye bağlı, türetilebilir, handover'da TAŞINMAZ. Bu
 * yüzden `~/.claude` altına DEĞİL `~/.config/agent-ide/` altına yazılır (emsal: `hook-nabiz`
 * → aynı dizin). Kararın bedeli ölçüldü: `~/.claude`a yeni bir yol açmak `aide filing kapsam`
 * için sınıflandırma borcu doğururdu; DURUM sınıfı bir defterde yaşamayı zaten hak etmiyor.
 */
const AKIS_DEFTER_DIZIN = join(process.env.HOME || homedir(), '.config', 'agent-ide', 'acilis-akis');
/** Defter bundan eskiyse ARKA PLANDA tazelenir (senkron yolda ölçüm YOK — aşağıdaki K2). */
const AKIS_TAZE_MS = 10 * 60 * 1000;
/** Defter bundan eskiyse BASILMAZ: bayat "sahipsiz iş" listesi insanı olmayan işe koşturur. */
const AKIS_BAYAT_MS = 6 * 60 * 60 * 1000;
/** FREN (08.2): AYNI parmak izi bu pencerede bir kez basılır. Parmak izi DEĞİŞİRSE pencere
 *  beklenmez — yeni bir tıkanma anında görünür. Yani fren zamanı değil TEKRARI bastırır. */
const AKIS_FREN_MS = 30 * 60 * 1000;
/** BÜTÇE (08.1) — bu bloğun KENDİ tavanı. Devralma bloğunun (≤12 satır / ≤900 karakter)
 *  tavanına EKLENMEZ, onunla YARIŞMAZ: ölçüldü 2026-08-04, devralma bloğu canlıda 8 satır /
 *  876 karakter ile kendi tavanının %97'sini zaten dolduruyordu. Tek bütçeye sıkıştırmak
 *  bu bloğu doğduğu gün susturur, ya da devralma satırlarını kırpardı — ikisi de sinyal
 *  kaybı. İLAN: açılış enjeksiyonunun en kötü hâli artık 12+12 satırdır. */
const AKIS_TAVAN_SATIR = 12;
const AKIS_TAVAN_KARAKTER = 900;

const ilanEt = (asama, hata) => {
  try {
    appendFileSync(ERR, JSON.stringify({
      ts: new Date().toISOString(), asama, hata: String(hata?.message || hata).slice(0, 400),
    }) + '\n');
  } catch { /* ilan bile edilemiyorsa sessizce çık — hook ASLA bloke etmez */ }
};

/** Proje kökü: cwd'den yukarı yürü, `plans/` taşıyan ilk dizin. plans/ YOKSA bu oturumun
 *  plan katmanıyla ilişkisi yoktur → hiçbir şey yapılmaz (rastgele klasörde dosya üretmeyiz). */
function projeKoku(cwd) {
  let d = cwd;
  for (let i = 0; i < 12 && d && d !== dirname(d); i++) {
    try { if (statSync(join(d, 'plans')).isDirectory()) return d; } catch { /* yukarı devam */ }
    d = dirname(d);
  }
  return null;
}

function nabizSayisi(root, sessionId) {
  if (!sessionId) return 0;
  try {
    const f = join(CLAUDE, 'kaptan', 'goals', String(root).replace(/[^A-Za-z0-9]/g, '-'), `${sessionId}.json`);
    return (JSON.parse(readFileSync(f, 'utf8')).todos || []).filter((t) => !t.removed).length;
  } catch { return 0; }
}

/** Bu oturumun dosyası var mı? (kısa id eşleşmesi — `Session:` alanı kısa id taşır) */
function dosyaVarMi(root, sessionId) {
  if (!sessionId) return false;
  try {
    const dir = join(root, 'plans', 'oturumlar');
    const kisa = String(sessionId).slice(0, 8);
    return readdirSync(dir).some((f) => {
      if (!f.endsWith('.md')) return false;
      try { return new RegExp(`Session:\\s*${kisa}`).test(readFileSync(join(dir, f), 'utf8')); } catch { return false; }
    });
  } catch { return false; }
}

/** KASA adımı — AYRI koşucu: farklı script (skill:soft-resume), farklı argüman sözleşmesi
 *  (`--session` ALMAZ; kasa TEK bir oturumu değil O AN CANLI OLAN HEPSİNİ yazar) ve ayrı
 *  zaman bütçesi (N transcript taranır). Kurulu değilse sessizce atlanır — kit işi. */
const kasaKos = (args, root, ms) => {
  if (!existsSync(KASA)) return;
  try {
    execFileSync(process.execPath, [KASA, ...args, '--proje', root],
      { stdio: 'ignore', timeout: ms, env: { ...process.env } });
  } catch (e) { ilanEt('kasa', e); }
};

const kos = (asama, args, root, sessionId) => {
  try {
    // `--session` AÇIKÇA geçilir: OTORİTER kimlik stdin payload'ıdır, env DEĞİL. Env'e
    // güvenilirse (ölçüldü 2026-07-27, proof) hook A oturumu için koşarken ortamdaki BAŞKA bir
    // CLAUDE_CODE_SESSION_ID'yi çözer → yanlış oturumun nabzını okur, yanlış dosyayı kapatır.
    const kimlik = sessionId ? ['--session', sessionId] : [];
    execFileSync(process.execPath, [OTURUM, ...args, ...kimlik, '--proje', root],
      { stdio: 'ignore', timeout: 20_000, env: { ...process.env } });
    return true;
  } catch (e) {
    // `bu` gibi kapı komutları exit≠0 verebilir; buradaki komutlar üretici, yine de hüküm vermeyiz.
    ilanEt(asama, e);
    return false;
  }
};

function main() {
  let girdi = {};
  try { girdi = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { /* stdin yok — env'e düşülür */ }
  const sessionId = girdi.session_id || process.env.CLAUDE_CODE_SESSION_ID || null;
  const cwd = girdi.cwd || process.cwd();

  if (!existsSync(OTURUM)) return;                    // skill kurulu değil — sessiz çık (kit işi)
  const root = projeKoku(cwd);
  if (!root) return;                                  // plan katmanı olmayan klasör — muaf

  const dosyali = dosyaVarMi(root, sessionId);
  if (!dosyali && nabizSayisi(root, sessionId) < ESIK) return;   // eşik altı — ilanlı muafiyet

  // SIRA SÖZLEŞMEDİR: tohumla(taze) → kapat(hüküm sertleşir) → devir(notu yaz) → durum(proje
  // türevi) → global(kılavuz). Ters sırada kapanan oturum tazelenmemiş hedeflerle EKSİK damgası
  // yerdi. `devir`in yeri iki taraftan da SIKI:
  //   · `kapat`tan SONRA — not `Bitiş` damgasını ve sertleşmiş hükmü taşısın (ayrıca `kapanis`
  //     alanı defterden okunduğu için notun İDEMPOTENS'i buna bağlıdır);
  //   · `durum`/`global`den ÖNCE — roll-up'lar devir satırını (K8 ilanı) basabilsin.
  // Payload geçirimi: transcript_path → --transcript ("nerede kaldı"), reason → --sebep
  // (kapanışın cinsi: clear · logout · prompt_input_exit …).
  const devirArg = [];
  if (girdi.transcript_path) devirArg.push('--transcript', String(girdi.transcript_path));
  if (girdi.reason) devirArg.push('--sebep', String(girdi.reason));

  kos('tohumla', ['tohumla'], root, sessionId);
  kos('kapat', ['kapat'], root, sessionId);
  kos('devir', ['devir', ...devirArg], root, sessionId);
  kos('durum', ['durum'], root, sessionId);
  kos('global', ['global'], root, sessionId);
  // KASA en SONdadır ve zinciri ETKİLEMEZ: en pahalı adımdır (N transcript) ve ürünü hiçbir
  // önceki adımın girdisi değildir. Kapanan oturum HÂLÂ CANLIdır (pid yaşıyor, SessionEnd
  // içindeyiz) → kendi fotoğrafı da kasaya düşer; asıl kazanç, kapanmayan KARDEŞ sekmelerdir.
  kasaKos(['yaz'], root, 90_000);
}

/* ═══════════ AKIŞ/SLOT bacağı (otonomi-merdiveni:08) ═══════════
 *
 * NE VERİR: "bu projede sahipsiz hazır iş var mı" bilgisi, oturum AÇILIŞINDA. `04` (slot
 * adayları) ve `07` (akış tıkanmaları) bunu ölçebiliyordu ama ikisi de ELLE çağrılan komuttu;
 * ölçülebilir ama görünmeyen bir bilgi, olmayan bilgidir.
 *
 * ── K1 (kullanıcı kararı): K0 OTOMATİK BASILIR, K1 ASLA OTOMATİK BAŞLAMAZ ───────────────
 * Bu blok bir MENÜ değil bir İŞARETtir: emir kipi yoktur, "almak istersen" der, komutu
 * basar ve orada durur. Hiçbir claim alınmaz, hiçbir koşum doğmaz (fan-out yasağı R4 burada
 * da geçerlidir — bu dosyada `zamanla`/`tmux`/`slot.mjs al` çağrısı YOKTUR).
 *
 * ── K2 · SENKRON YOLDA ÖLÇÜM YOKTUR — açılış dalının 2. sert kuralı KIRILMADI ────────────
 * Ölçüldü 2026-08-04: `aide akis durum --json` **2.0–2.5 sn**, `slot.mjs oner` **0.24 sn**.
 * İkisi de açılışın <200 ms hedefine sığmaz; `aide` çağrısı üstelik bu dosyanın künyesindeki
 * **"aide GEREKTİRMEZ"** sözünü de senkron yolda çiğnerdi. Çözüm KASA emsalidir (aynı
 * fonksiyonda, üç satır yukarıda): ölçüm AYRIK sürece iner, açılış yalnız DEFTERİ OKUR
 * (~1 ms). Bedeli ilan edilmiştir: ilk açılışta defter boştur → **0 bayt** basılır, blok
 * bir sonraki açılıştan itibaren konuşur. Soğuk başlangıçta sessizlik, yanlış bilgiden iyidir.
 *
 * ── DEGRADE ───────────────────────────────────────────────────────────────────────────
 * `aide` yoksa/çökerse akış bacağı boş kalır, **slot bacağı yaşamaya devam eder** (slot.mjs
 * da `aide GEREKTİRMEZ`). Tek bacak ölünce blok susmaz; iki bacak da ölürse 0 bayt.
 */

/** Defter yolu — repo kökü başına bir dosya (bir makinede N repo, N defter). */
function akisDefteri(root) {
  return join(AKIS_DEFTER_DIZIN, `${String(root).replace(/[^A-Za-z0-9]/g, '-')}.json`);
}

/** İÇERİK parmak izi (08.2). **ZAMAN ALANI GİRMEZ** — girseydi her tazelemede yeni damga
 *  doğar, fren HİÇ tetiklenmezdi (emsal: DURUM logu döngü yasağı, `aide durum`). Kaynak
 *  yalnız basılacak satırlardır: aynı satırlar = aynı iz. Kriptografik güç gerekmez, bu bir
 *  eşitlik testidir; hash değil toplam kullanmak dosyayı bağımlılıksız tutar. */
function parmakIzi(satirlar) {
  const s = satirlar.join('\n');
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return `${h.toString(16)}-${s.length}`;
}

/** TAZELEYİCİ — AYRIK süreçte koşar (`oturum-kapanis.mjs akis-tazele --proje <kök>`).
 *  Yeni bir hook KAYDI açmaz (aşama-08 §2 GİRMEZ): aynı dosyanın üçüncü modudur, tetikleyeni
 *  açılış dalının kendisidir. Ürünü SATIRLARdır — karar değil, metin. */
function akisTazeleMain() {
  const i = process.argv.indexOf('--proje');
  // MUTLAKLAŞTIR: `projeKoku` göreli yolla ÇALIŞMAZ — `dirname('.') === '.'` olduğu için
  // yukarı-yürüme döngüsü hiç dönmez ve null döner (ölçüldü 2026-08-04, tazeleyici sessizce
  // hiçbir şey yapmıyordu). Açılış dalı mutlak `cwd` geçtiği için bu tuzağı görmüyordu.
  const ham = i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : process.cwd();
  const root = projeKoku(resolve(ham));
  if (!root) return;

  /* KİMLİKSİZ ÖLÇÜM — `CLAUDE_CODE_SESSION_ID` ÇOCUĞA GEÇMEZ. Ölçüldü 2026-08-04: geçtiğinde
     `slot.mjs` "kendi claim'imi dolu sayma" kuralını uyguluyor ve tazeleyeni ÇAĞIRAN oturumun
     kilitli planını ADAY olarak yazıyordu. Defter PAYLAŞIMLIDIR: onu bir sonraki açılışta
     BAŞKA bir oturum okur ve sahipli işe yönlendirilirdi — akış kapısının tam da yasakladığı
     yanlış-pozitif ("insanı olmayan işe koşturmak"). Kimliksiz ölçümde HER aktif claim
     doludur; kilidi tutan oturuma kendi işi önerilmez — zaten üstünde olduğu için doğrusu bu. */
  const ENV = { ...process.env };
  delete ENV.CLAUDE_CODE_SESSION_ID;

  const akisSatir = [];
  const slotSatir = [];
  let akmiyor = [];
  let adaylar = [];

  // (a) AKIŞ — `07`nin kapısı. `aide` YOKSA bu bacak sessizce boş kalır (künye sözü).
  try {
    const out = execFileSync('aide', ['akis', 'durum', '--json', '--proje', root],
      { encoding: 'utf8', timeout: 20_000, stdio: ['ignore', 'pipe', 'ignore'], env: ENV });
    const j = JSON.parse(out || '{}');
    akmiyor = (Array.isArray(j.bulgular) ? j.bulgular : []).filter((b) => b?.tip === 'akmiyor');
  } catch (e) {
    // exit 1 = KAPI kırmızı (bulgu VAR) — `execFileSync` bunu da fırlatır; stdout'u kurtar.
    try {
      const j = JSON.parse(String(e?.stdout || '') || '{}');
      akmiyor = (Array.isArray(j.bulgular) ? j.bulgular : []).filter((b) => b?.tip === 'akmiyor');
    } catch { ilanEt('akis-tazele-akis', e); }
  }

  // (b) SLOT — `04`ün adayları. `--json` bu aşamada eklendi (insan metnini parse etmek yerine).
  try {
    const out = execFileSync(process.execPath, [SLOT, 'oner', '--json', '--n', '2', '--proje', root],
      { encoding: 'utf8', timeout: 20_000, stdio: ['ignore', 'pipe', 'ignore'], env: ENV });
    adaylar = (JSON.parse(out || '{}').adaylar || []).slice(0, 2);
  } catch (e) { ilanEt('akis-tazele-slot', e); }

  // ── SATIRLAR ──────────────────────────────────────────────────────────────────────────
  // Aday olarak ZATEN basılacak planı akış satırında TEKRAR anmayız: iki bacak aynı olguyu
  // görür (hazır aşama + sahipsiz), tekrar bütçeyi yer ve bloğu gürültüye çevirir.
  const adayPlan = new Set(adaylar.map((a) => String(a.slug)));
  const artan = akmiyor.filter((b) => !adayPlan.has(String(b.slug)));
  if (akmiyor.length) {
    akisSatir.push(`[akış] ${akmiyor.length} plan akmıyor (hazır aşama var, koşan session/claim yok) — BİLGİ; alma kararı senin`);
    for (const b of artan.slice(0, 2)) akisSatir.push(`  akmıyor: ${b.slug} · ${String(b.detay || '').slice(0, 120)}`);
  }
  for (const a of adaylar) {
    slotSatir.push(`hazır: ${a.slug}:${a.no} ${a.ad || ''}`.trimEnd());
    slotSatir.push(`  almak istersen: node ${SLOT} al --slug ${a.slug} --asama ${a.no}`);
  }

  /* BÜTÇE — iki tavan (satır ∧ karakter) AYNI ANDA tutmalı ve kırpma İLANI ile K1 cümlesi
     kırpmadan SAĞ ÇIKMALI. Ölçüldü 2026-08-04: önce kırpıp sonra karakter tavanı için
     sondan `pop()` etmek, ilanı ve K1 cümlesini kurbanlık seçiyordu — yani bütçe aşımı
     sessiz kırpmaya, K1 beyanı da kayba dönüşüyordu (testin yakaladığı gerçek hata).
     Doğrusu: GÖVDE kırpılır, iki değişmez satır her turda yeniden EKLENİR. */
  const KAPANIS = 'K1 KAPALIDIR: bu blok iş başlatmaz, claim almaz — alma kararı senin, üstlenmek komutla olur.';
  const govde = [...akisSatir, ...slotSatir];
  let kirpildi = 0;
  const olustur = () => {
    const s = [...govde];
    if (kirpildi) s.push(`  … +${kirpildi} satır kırpıldı (bütçe ${AKIS_TAVAN_SATIR}) — tamamı: aide akis durum`);
    s.push(KAPANIS);
    return s;
  };
  let satirlar = govde.length ? olustur() : [];
  while (govde.length
    && (satirlar.length > AKIS_TAVAN_SATIR || satirlar.join('\n').length > AKIS_TAVAN_KARAKTER)) {
    govde.pop();
    kirpildi++;
    satirlar = olustur();
  }

  const defter = akisDefteri(root);
  try {
    mkdirSync(dirname(defter), { recursive: true });
    let onceki = {};
    try { onceki = JSON.parse(readFileSync(defter, 'utf8')); } catch { /* ilk yazım */ }
    const gecici = `${defter}.${process.pid}.tmp`;
    // `basildi` KORUNUR: tazeleme freni SIFIRLAMAZ. Sıfırlasaydı her tazeleme bloğu yeniden
    // konuşturur, fren 10 dk'lık bir gecikmeye dönüşürdü — yani hiç olmazdı.
    writeFileSync(gecici, JSON.stringify({
      ts: Date.now(), fp: parmakIzi(satirlar), satirlar, basildi: onceki.basildi || null,
    }));
    renameSync(gecici, defter);                       // atomik: eşzamanlı okuyucu yarım dosya görmez
  } catch (e) { ilanEt('akis-tazele-yazim', e); }
}

/** OKUYUCU — açılış dalının senkron yolu. ÖLÇMEZ, yalnız defteri okur ve freni uygular. */
function akisSatirlari(root) {
  const defter = akisDefteri(root);
  let d = null;
  try { d = JSON.parse(readFileSync(defter, 'utf8')); } catch { /* defter yok — 0 bayt */ }

  const yas = d?.ts ? Date.now() - Number(d.ts) : Infinity;
  // TAZELEME TETİĞİ — ayrık, beklenmez, tek bayt yazamaz (KASA emsali). Bayat defter de
  // tazelenir: basılmayacak olması ölçümü gereksiz kılmaz, tam tersine.
  if (yas > AKIS_TAZE_MS) {
    try {
      spawn(process.execPath, [process.argv[1], 'akis-tazele', '--proje', root],
        { detached: true, stdio: 'ignore', env: { ...process.env } }).unref();
    } catch (e) { ilanEt('akis-tazele-spawn', e); }
  }

  const satirlar = Array.isArray(d?.satirlar) ? d.satirlar : [];
  if (!satirlar.length) return [];                    // sinyal yok → 0 bayt
  if (yas > AKIS_BAYAT_MS) return [];                 // bayat veri sessizce doğru sanılmaz

  // FREN (08.2): aynı parmak izi + pencere içinde basıldıysa TEKRAR BASMA.
  const fp = parmakIzi(satirlar);
  const b = d?.basildi;
  if (b && b.fp === fp && Date.now() - Number(b.ts || 0) < AKIS_FREN_MS) return [];

  try {                                               // basıldı damgası — fren bunun üstünde çalışır
    const gecici = `${defter}.${process.pid}.bas.tmp`;
    writeFileSync(gecici, JSON.stringify({ ...d, basildi: { fp, ts: Date.now() } }));
    renameSync(gecici, defter);
  } catch (e) { ilanEt('akis-basildi-yazim', e); }
  return satirlar;
}

/* ═══════════ SessionStart ucu — açılış devralması (aşama-06) ═══════════
 *
 * NE YAPAR: `oturum.mjs acilis --ctx` çıktısını `additionalContext` olarak enjekte eder.
 * Sinyal yoksa komut TEK BAYT basmaz → hook da hiçbir şey basmaz (sinyalsiz oturumun
 * token maliyeti SIFIR). Emsal: `claim-guard.mjs ctx`.
 *
 * ÜÇ SERT KURAL:
 *   1. `source === "resume"` → TAMAMEN SESSİZ (İLANLI muafiyet). Hard resume kaldığı yerden
 *      devam eder: devralınacak iş ZATEN context'tedir, blok gürültüdür. `source` yoksa
 *      `startup` varsayılır — fail-open zararsız: en kötü ihtimalle bir bilgi bloğu fazla basar.
 *   2. HİÇBİR ÖLÇÜM KOŞMAZ. Geçerlilik/toplama süresi öngörülemez; hook yalnız İŞARET taşır
 *      (komut satırı basılır). `timeout: 3000` bir üst sınırdır, hedef <200 ms.
 *   3. HER HATA → exit 0 + `ilanEt`. Açılışı bloke eden bir hook, oturumu öldürür.
 *
 * STDOUT: `fs.writeSync(1, …)` ile BLOKLAYARAK yazılır — `process.exit(0)` bir pipe'a yazılan
 * tamponu kesebilir (async `console.log` + hemen exit = sessiz kayıp).
 */
function acilisMain() {
  let girdi = {};
  try { girdi = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch { /* stdin yok — env'e düşülür */ }
  const source = girdi.source || 'startup';
  const sessionId = girdi.session_id || process.env.CLAUDE_CODE_SESSION_ID || null;
  const cwd = girdi.cwd || process.cwd();
  const root = projeKoku(cwd);
  if (!root) return;                                  // plan katmanı olmayan klasör — muaf

  /* KASA TAZELEME — SessionEnd'in KÖR NOKTASINI kapatır: limit · crash · logout · reboot ile
     ölen pencere SessionEnd ateşlemez, dolayısıyla kasa kaydı da yazılmaz. Yeni bir sekmenin
     açılması ise sık ve UCUZ bir andır: `--bayat 30` sayesinde 30 dk'dan taze kayıtlar hiç
     ölçülmez (transcript okunmaz), yalnız eskiyenler tazelenir.
     ÜÇ SINIR: (1) AYRIK süreç — açılış bloğu bunu BEKLEMEZ (hedef <200 ms korunur);
     (2) stdout'a TEK BAYT yazamaz (stdio ignore) — enjeksiyon sözleşmesi bozulmaz;
     (3) `resume` muafiyetinden ÖNCEdir: muafiyet ÇIKTIya dairdir, yedeklemeye değil. */
  if (existsSync(KASA)) {
    try {
      spawn(process.execPath, [KASA, 'yaz', '--bayat', '30', '--proje', root],
        { detached: true, stdio: 'ignore', env: { ...process.env } }).unref();
    } catch (e) { ilanEt('kasa-acilis', e); }
  }

  if (source === 'resume') return;                    // ilanlı muafiyet — hard resume sessizdir

  /* AKIŞ/SLOT bloğu (aşama-08) — devralma bloğundan BAĞIMSIZ toplanır ve `OTURUM` kurulu
     olmasa da yaşar: farklı SORUYU yanıtlar. Devralma "SEN nerede kalmıştın", akış/slot
     "bu projede SAHİPSİZ ne var" der; birini ötekinin varlığına bağlamak, kurulmamış bir
     skill yüzünden ilgisiz bir sinyali susturmak olurdu. Her hata yutulur (08.3). */
  let akis = [];
  try { akis = akisSatirlari(root); } catch (e) { ilanEt('akis-blok', e); }

  let ctx = '';
  if (existsSync(OTURUM)) {                           // skill kurulu değilse devralma bacağı atlanır (kit işi)
    try {
      ctx = execFileSync(process.execPath,
        [OTURUM, 'acilis', '--ctx', ...(sessionId ? ['--session', sessionId] : []), '--proje', root],
        { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env } });
    } catch (e) { ilanEt('acilis', e); }
  }
  const metin = [String(ctx || '').trim(), akis.join('\n').trim()].filter(Boolean).join('\n');
  if (!metin) return;                                 // sinyal yok — enjeksiyon YOK

  const cikti = JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: metin },
  });
  try { writeSync(1, `${cikti}\n`); } catch (e) { ilanEt('acilis-yazim', e); }
}

// argümansız = SessionEnd (BYTE-BYTE eski davranış) · `acilis` = SessionStart
// `akis-tazele` = AYRIK tazeleyici (aşama-08) — hook OLAYI değildir, `settings.json`da KAYDI
// YOKTUR ve olmayacaktır; tek çağıranı `acilisSatirlari`nın detached spawn'ıdır.
const MOD = (process.argv[2] || '').replace(/^--/, '');
try {
  if (MOD === 'acilis') acilisMain();
  else if (MOD === 'akis-tazele') akisTazeleMain();
  else main();
} catch (e) { ilanEt(MOD || 'main', e); }
process.exit(0);
