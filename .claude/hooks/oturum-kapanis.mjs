#!/usr/bin/env node
// sg: katman=modul rol=motor
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
 *                    ≤12 satır / ≤900 karakter)
 *   (AKIŞ/SLOT bacağı 2026-10-22'de söküldü: `aide akis` ve `planla-kos/slot.mjs` arşive gidiyor —
 *    toolkit-donusum v1 aşama 02. Eski hâli: `git show toolkit-oncesi:<bu dosyanın yolu>`.)
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
} from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { execFileSync, spawn } from 'node:child_process';

// KOŞUM DAMGASI (otonomi-merdiveni:02.3) — `aide otomasyon durum`un akıbet ekseni bunu okur.
// Dinamik import + try: damga yazarı yoksa ya da bozuksa hook KOŞMAYA DEVAM EDER; bir ölçüm
// aracı ölçtüğü şeyi asla bozamaz. Maliyet: bir dosya yazımı, 0 token.
try { (await import("./hook-nabiz.mjs")).nabiz("oturum-kapanis", process.argv[2]); } catch {}

const CLAUDE = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
const OTURUM = join(CLAUDE, 'skills', 'plan-organizatoru', 'scripts', 'oturum.mjs');
const KASA = join(CLAUDE, 'skills', 'soft-resume', 'scripts', 'kasa.mjs');
const ERR = join(CLAUDE, 'hooks', 'oturum-kapanis.err.jsonl');
const ESIK = Number(process.env.AIDE_OTURUM_ESIK || 3);

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

  let ctx = '';
  if (existsSync(OTURUM)) {                           // skill kurulu değilse devralma bacağı atlanır (kit işi)
    try {
      ctx = execFileSync(process.execPath,
        [OTURUM, 'acilis', '--ctx', ...(sessionId ? ['--session', sessionId] : []), '--proje', root],
        { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'], env: { ...process.env } });
    } catch (e) { ilanEt('acilis', e); }
  }
  const metin = String(ctx || '').trim();
  if (!metin) return;                                 // sinyal yok — enjeksiyon YOK

  const cikti = JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: metin },
  });
  try { writeSync(1, `${cikti}\n`); } catch (e) { ilanEt('acilis-yazim', e); }
}

// argümansız = SessionEnd (BYTE-BYTE eski davranış) · `acilis` = SessionStart
const MOD = (process.argv[2] || '').replace(/^--/, '');
try {
  if (MOD === 'acilis') acilisMain();
  else main();
} catch (e) { ilanEt(MOD || 'main', e); }
process.exit(0);
