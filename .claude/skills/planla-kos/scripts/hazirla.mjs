#!/usr/bin/env node
// hazirla.mjs — /planla-kos'un makine katmanı: /goal satırını agac.mjs'ten TÜKETİR,
// derinlik politikalarını SONUNA ekler, 4000ch kapısını ölçer ve zamanla komutunu monte eder.
//
// /goal satırı burada ASLA yeniden üretilmez (Ders 2/17) — tek kaynak
// plan-organizatoru/scripts/agac.mjs (--durum --json → plans[].goal). Bu script
// `agac.mjs`'i SPAWN eder (INDEX dosyasını okumaz → bayat-INDEX bağışıklığı).
// Tırnak kaçışı + karakter bütçesi + komut montajı LLM ağzında değil burada yaşar.
//
// Kullanım (varsayılan KURU — hiçbir şey yazmaz/ateşlemez, yalnız basar):
//   node hazirla.mjs --proje <kök> [--slug <slug>] --kapsam 1|<N>|hepsi \
//        --otonomi sor|kapi|ates [--talimat "<≤200ch özet>"] [--socket <ad>] \
//        [--json] [--dispatch]
//
// Rota bayrakları (TÜKETİCİ: packages/rotaci/lib/eylem.mjs, aşama 02 — İNSAN yolu /planla-kos
// bunları KULLANMAZ; verilmezlerse zamanla'ya giden argv BYTE-AYNI kalır — geriye uyum R-01):
//   [--ek-metin "<metin>"]  goal satırının MUTLAK SONUNA verbatim + AYRAÇSIZ eklenir (ayraç
//                           çağıranın malı: rota "\n\n<PROTOKOL>" ile başlatır). 4000ch'de
//                           korumalı sınıf — nezaket/talimat düşer, ek-metin ASLA (R-02/R-03).
//   [--grup <ad> [--cap N]] zamanla --group/--cap'e geçer. --cap YALNIZ --grup ile (grupsuz cap
//                           zamanla.mjs:199'da SESSİZCE düşer → burada exit 2). N pozitif tamsayı.
//   [--muhur "<K1> <K2> …"] zamanla --muhur'a geçer (mührü MAKİNE kurar). ≥2 kelime (zamanla.mjs:
//                           118-121 aynası) — tek kelime yankıya eşleşir → exit 2.
//   [--on-fail park|retry]  zamanla --on-fail'e geçer (içerik yorumlanmaz — ince geçiş R-07).
//   [--manual]              --at ÇIKARILIR → iş tetiksiz doğar (trigger.manual'i zamanla.mjs:177
//                           yazar); run-now'a dek ateşlenmez. izle → onay/run-now yolu.
//   [--title-onek "<ön>"]   başlığın BAŞINA verbatim (rota dedupe anahtarı, ör. "rota:<fp>:").
//   [--asama <no>]          goal'ü agac'ın plan.hazir[] listesinden O aşamadan VERBATIM çeker
//                           (kapsam/otonomi cümleleri normal eklenir). Aşama hazir'da yoksa exit 4
//                           (bayat-karar koruması). Session adı planla-kos-<slug>-a<NN>.
//   [--ham-metin "<metin>"] agac TÜKETİLMEZ; goal = bu metin. kapsam/otonomi/talimat/nezaket
//                           cümlesi EKLENMEZ (yalnız ek-metin sona). "/goal " önekli metin exit 2
//                           (goal tek-kaynak kilidi). --slug zorunlu; session adı <slug>-ham.
//
// Çıkış kodları: 0 hazır · 2 kullanım/plan bulunamadı/rota kapı ihlali (cap-grupsuz · mühür-tek ·
//                ham-metin /goal öneki · asama+ham-metin çakışması · tanınmayan kosum.tur) · 3 koşacak aşama yok (tümü
//                KAPALI) · 4 governance (aşama açık ama /goal satırı yok · --asama hazir-dışı)
//                5 4000ch aşımı · 6 dispatch hatası

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const argv = process.argv.slice(2);
const flag = (f) => argv.includes(f);
const opt = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };
const die = (code, msg) => { console.error(msg); process.exit(code); };

// Test dikişleri (yalnız proof.mjs kullanır — üründe env verilmez, varsayılanlar geçerli):
// AGAC CLAUDE_CONFIG_DIR-farkında olmalı: hazirla ↔ agac AYNI hesabın kopyaları olmalı, yoksa
// (03 köprüsü) hazirla stale bir agac'a düşer, kosum:workflow beyanı hazir[]'e taşınmaz ve workflow
// aşaması SESSİZCE klasik koşar (Risk-3'ün deployment ikizi). Klasik yolda goal her sürümde AYNI →
// argv BYTE-AYNI (R-01 korunur); yalnız kosum taşıma bu tutarlılığa bağlıdır.
const CLAUDE_DIR = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const AGAC = process.env.PLANLA_KOS_AGAC || path.join(CLAUDE_DIR, 'skills/plan-organizatoru/scripts/agac.mjs');
// /Users/ybg/dev/agent-ide kurulumda çözülür (kit.ts → replaceAll). Ham kalmışsa script ŞABLONDAN
// koşuluyor demektir — ölü yolla spawn edip anlaşılmaz hata vermek yerine söyle.
const ZAMANLA = process.env.PLANLA_KOS_ZAMANLA || '/Users/ybg/dev/agent-ide/packages/maestro/bin/zamanla.mjs';
if (ZAMANLA.includes('{{')) {
  console.error('❌ hazirla: ZAMANLA yolu çözülmemiş — bu script KURULU kopyadan koşulur.');
  console.error('   onar: node ~/.claude/skills/planla-kos/scripts/hazirla.mjs …');
  console.error('   ya da: PLANLA_KOS_ZAMANLA=<zamanla.mjs yolu> node <bu dosya> …');
  process.exit(2);
}
const GOAL_LIMIT = parseInt(process.env.PLANLA_KOS_LIMIT || '4000', 10); // OEM /goal koşul sınırı (binary'de sert)

const proje = path.resolve(opt('--proje') || process.cwd());
const slugArg = opt('--slug');
const kapsam = opt('--kapsam');
const otonomi = opt('--otonomi');
const talimat = (opt('--talimat') || '').trim();
const socket = opt('--socket');

// --- Rota bayrakları (TÜKETİCİ eylem.mjs/aşama 02 üretir; insan yolu KULLANMAZ). İNCE GEÇİŞ:
// içerik yorumlanmaz, yalnız zamanla'ya taşınır — İKİ AYNA ön-kontrol hariç: aşağıdaki kapılar
// zamanla'nın SESSİZCE düşürdüğü/reddettiği kombinasyonları KURU modda erkenden yakalar. ---
const ekMetin = opt('--ek-metin') || '';        // satırın MUTLAK SONUNA verbatim + ayraçsız (R-02)
const grup = opt('--grup');                       // → zamanla --group
const capArg = opt('--cap');                      // → zamanla --cap (yalnız --grup ile anlamlı)
const muhur = (opt('--muhur') || '').trim();      // → zamanla --muhur (≥2 kelime; makine kurar)
const onFail = opt('--on-fail');                  // → zamanla --on-fail
const manual = flag('--manual');                  // --at ÇIKAR → trigger.manual (zamanla tek yazar)
const titleOnek = opt('--title-onek') || '';      // başlık öneki verbatim (rota dedupe anahtarı)
const asamaArg = opt('--asama');                  // goal'ü plan.hazir[] içindeki O aşamadan çek
const hamMetin = opt('--ham-metin');              // agac tüketilmez; goal = bu metin
const uretici = opt('--uretici');                 // → zamanla --uretici (adli iz; bayraksız → geçmez, argv BYTE-AYNI R-01)

// Rota kapıları — KURU mod yalan söylemesin (zamanla downstream'de sessizce düşen/reddedilen kombinasyonlar):
if (capArg != null) {
  if (!grup) die(2, '--cap yalnız --grup ile anlamlı — zamanla.mjs:199 grupsuz cap\'i SESSİZCE düşürür');
  if (!/^[1-9]\d*$/.test(capArg)) die(2, `--cap "${capArg}" geçersiz (pozitif tamsayı ister)`);
}
if (muhur && muhur.split(/\s+/).filter(Boolean).length < 2)
  die(2, '--muhur en az İKİ kelime ister (zamanla.mjs:118-121 aynası — tek kelime yankıya eşleşebilir)');
if (asamaArg != null && hamMetin != null)
  die(2, '--asama ile --ham-metin birlikte kullanılamaz — goal kaynağı tek olmalı');
if (hamMetin != null && /^\/goal\s/.test(hamMetin))
  die(2, '--ham-metin "/goal " önekiyle başlayamaz — goal tek-kaynak kilidi (satır agac.mjs\'ten türer, elle /goal montajı YASAK)');

// kapsam/otonomi yalnız NORMAL + --asama yolunda zorunlu; --ham-metin onları KULLANMAZ.
const kapsamN = kapsam === 'hepsi' ? Infinity : parseInt(kapsam, 10);
if (hamMetin == null) {
  if (!kapsam || !otonomi) die(2, 'kullanım: --kapsam 1|<N>|hepsi --otonomi sor|kapi|ates zorunlu (bkz. dosya başı)');
  if (!['sor', 'kapi', 'ates'].includes(otonomi)) die(2, `--otonomi "${otonomi}" geçersiz (sor|kapi|ates)`);
  if (kapsam !== 'hepsi' && (!Number.isInteger(kapsamN) || kapsamN < 1)) die(2, `--kapsam "${kapsam}" geçersiz (1, pozitif sayı ya da "hepsi")`);
}

// ---------- 1. tek kaynaktan tüket ----------

const durum = spawnSync('node', [AGAC, '--durum', '--json', '--proje', proje], { encoding: 'utf8' });
if (durum.status !== 0) die(2, `agac.mjs --durum başarısız (exit ${durum.status}):\n${durum.stderr || durum.stdout}`);
let model;
try { model = JSON.parse(durum.stdout); } catch (e) { die(2, `agac.mjs --durum --json çıktısı parse edilemedi: ${e.message}`); }

let plan;
if (slugArg) {
  plan = model.plans.find((p) => p.slug === slugArg);
  if (!plan) die(2, `plans/${slugArg} bulunamadı — mevcut: ${model.plans.map((p) => p.slug).join(', ') || '(hiç plan yok)'}`);
} else if (hamMetin != null || asamaArg != null) {
  die(2, '--ham-metin / --asama ile --slug zorunlu (hangi planın adına dispatch edileceği açık olmalı)');
} else {
  const adaylar = model.plans.filter((p) => p.goal);
  if (adaylar.length === 1) plan = adaylar[0];
  else die(2, adaylar.length === 0
    ? 'hazır /goal satırı taşıyan plan yok — slug ver ya da önce /plan-kur koştur'
    : `birden çok açık plan var, --slug ver: ${adaylar.map((p) => p.slug).join(', ')}`);
}

// Goal kaynağı — ÜÇ YOL, hepsinde hamGoal VERBATIM'dir (yeniden üretilmez; Ders 2/17):
// kosum: KOŞUM TÜRÜ beyanı (01 teslimi) — agac.mjs `hazir[]` girdisine {tur,sablon?} olarak taşır.
// D1 KARAR A: hazirla türü agac'tan OKUR (frontmatter'ı kendi parse etmez — tek parser). İLAN (01 wins):
//   (a) `h.kosum` NESNEdir ({tur:'workflow',sablon} | {tur:'tek-ajan'}), asama-03 doc'un varsaydığı
//       string 'workflow' DEĞİL; (b) agac kosum'u YALNIZ hazir[]'e koyar, `siradaki`ye KOYMAZ
//       (siradaki={no,ad}; 01 muafiyeti "tüketici hazir[]"), o yüzden normal yolda kosum siradaki.no'ya
//       eşleşen hazir[] girdisinden okunur. `gecersiz` kosum agac gate'inde düşer (01), hazir[]'e HİÇ
//       ulaşmaz — aşağıdaki tur guard'ı bozuk hazir[] JSON'una karşı fail-closed bekçidir (R: sessiz düşme yok).
let hamGoal, kosum = null;
if (hamMetin != null) {
  hamGoal = hamMetin; // G2: agac TÜKETİLMEZ — ham metin doğrudan goal'dir
  // İLANLI MUAFİYET (D1): --ham-metin workflow TAŞIMAZ. Revize/pivot metinleri klasik session ister;
  // bir workflow aşamasını koşmak gerekiyorsa --asama kullanılır. kosum = null → klasik yol.
} else if (asamaArg != null) {
  // G1: goal'ü plan.hazir[] içindeki O aşamadan verbatim çek (bayat-karar koruması: hazir DIŞI → exit 4)
  const asamaNo = String(asamaArg).padStart(2, '0');
  const h = (plan.hazir || []).find((x) => String(x.no).padStart(2, '0') === asamaNo);
  if (!h) die(4, `plans/${plan.slug} v${plan.v}: aşama ${asamaNo} "hazir" listesinde değil (hazır: ${(plan.hazir || []).map((x) => x.no).join(', ') || '—'}) — bayat/dışı aşama koşturulamaz. Dispatch YOK.`);
  hamGoal = h.goal; // VERBATIM — agac'ın hükmü dokunulmaz
  kosum = h.kosum || null;
} else {
  if (!plan.goal) {
    if (plan.durum === 'KAPALI') die(3, `plans/${plan.slug} v${plan.v}: tüm aşamalar KAPALI — koşacak iş yok. Devam istersen: /plan-kur revize ${plan.slug}`);
    die(4, `plans/${plan.slug} v${plan.v}: sıradaki aşama ${plan.siradaki ? `${plan.siradaki.no}-${plan.siradaki.ad}` : '?'} açık ama /goal satırı sentezlenemedi (asama-NN dosyası kayıp?) — governance sorunu; agac.mjs --denetle çıktısına bak. Dispatch YOK.`);
  }
  hamGoal = plan.goal; // VERBATIM — dokunulmaz
  // normal yol: kosum siradaki aşamadan (goal ile AYNI aşama). siradaki kosum taşımaz → hazir[]'den no eşleşmesiyle.
  const sn = plan.siradaki ? String(plan.siradaki.no).padStart(2, '0') : null;
  const h = sn ? (plan.hazir || []).find((x) => String(x.no).padStart(2, '0') === sn) : null;
  kosum = h ? (h.kosum || null) : null;
}

// Koşum türü guard (fail-closed) — tanınan: yok/null (klasik), {tur:'tek-ajan'} (klasik), {tur:'workflow',sablon}.
// Bunun dışı → exit 2 + alan adı (sessiz düşme YASAK; workflow'u sessizce klasik koşmak Risk-3).
if (kosum != null) {
  if (typeof kosum !== 'object' || (kosum.tur !== 'workflow' && kosum.tur !== 'tek-ajan'))
    die(2, `tanınmayan kosum.tur: ${JSON.stringify(kosum)} — şema: {tur:"tek-ajan"} | {tur:"workflow",sablon:"<ref>"} (agac.mjs hazir[].kosum). Bozuk hazir[] JSON'u ya da desteklenmeyen koşum türü.`);
  if (kosum.tur === 'workflow' && !/^[a-z0-9-]+$/.test(String(kosum.sablon || '')))
    die(2, `kosum.tur=workflow ama sablon-ref geçersiz/eksik: ${JSON.stringify(kosum.sablon)} — <sablon-ref> [a-z0-9-]+ olmalı (agac frontmatter şeması).`);
}
const wflow = kosum?.tur === 'workflow' ? kosum : null; // yalnız workflow köprü metnini tetikler

// ---------- 2. politika cümleleri (yalnız SONA eklenir; --ham-metin bunları EKLEMEZ) ----------

const cumleler = [];
let talimatC = null;
let nezaketC = null;
if (hamMetin == null) { // G2: ham metin "olduğu gibi" taşınır — augmentasyon yalnız normal/--asama yolunda
  if (kapsamN === 1) {
    cumleler.push('YALNIZ bu aşamayı koş — sonraki aşamayı BAŞLATMA, bitince raporla ve dur');
  } else {
    const bitis = kapsam === 'hepsi'
      ? "tüm aşamalar KAPALI olana ya da BLOKE'ye çarpana dek devam et"
      : `toplam en fazla ${kapsamN} aşama koş, sonra dur`;
    cumleler.push(`bu aşama kapanınca proje kökünde \`node ~/.claude/skills/plan-organizatoru/scripts/agac.mjs --durum\` çıktısındaki sıradaki hazır /goal satırının planını da AYNI sözleşmeyle uygula; ${bitis}`);
    // Erken-teslim dersi (2026-07-17): OEM /goal öz-hükmü satırın İLK cümlesine ("bu aşamayı
    // uygula") bakıp tek aşama sonrası "achieved" diyebiliyor — bitiş şartı AÇIKÇA ilan edilir.
    cumleler.push(`TAMAMLANMA KOŞULU: hedefe ulaşılmış sayılman için ${kapsam === 'hepsi' ? 'plan ağacındaki TÜM aşamaların KAPALI (ya da BLOKE) olması' : `bu turda ${kapsamN} aşamanın KAPALI olması`} gerekir — tek aşama kapatmak hedefi TAMAMLAMAZ`);
  }
  if (otonomi === 'sor') cumleler.push('plan dosyalarındaki "kullanıcı kararı" işaretli maddelerde DUR ve AskUserQuestion ile sor; geri-alınamaz adım (publish · deploy · --write migrasyon · veri silme) ATMA');
  if (otonomi === 'kapi') cumleler.push("ara kararları kendin ver ve gerekçesini STATE.md'ye yaz; yalnız geri-alınamaz adımda ve çözemediğin kapı FAIL'inde dur");
  if (otonomi === 'ates') cumleler.push("kullanıcıya soru sorma — kararları gerekçesiyle STATE.md'ye yaz; geri-alınamaz adımı ATMA, backlog'a yaz");
  talimatC = talimat ? `ana talimat: "${talimat.slice(0, 200)}" — bu kapsamın dışına taşma` : null;
  nezaketC = fs.existsSync(path.join(proje, '.claude/claims-resources.json'))
    ? "bu repoda eşzamanlı session'lar çalışır — /eszamanli claim protokolü geçerli" : null;
}

// ---------- WORKFLOW-PROTOKOL (yalnız kosum: workflow; eylem.mjs PROTOKOL'ün ikizi — D2) ----------

// SONUÇ hükmünün ikizi iskelet: kilit al → workflow başlat (00 sözdizimi: script'i Workflow
// tool'una ver, slash-komut DEĞİL — 00 Not-1) → kanıt (rota kanit exit 0; Maestro "done" DEĞİL) →
// STATE KAPALI → kilit bırak + agac --durum → mühür → ÖL. İlk satır Risk-3 kalkanı: workflow
// başlatmak "ajan doğurma" yasağına girmez, ama fan-out YALNIZ script içinde. <sablon-ref> → kanon
// skill yoluna deterministik montaj (runtime'da OKUNMAZ; VAR MI denetlenmez — 01 muafiyeti).
const WFLOW_PROTOKOL = ({ slug, v, no, ad, sablon }) => `--- WORKFLOW KOŞUMU (kosum: workflow:${sablon}) ---
Bu aşama (${slug} v${v} aşama ${no}${ad ? `-${ad}` : ''}) Dynamic Workflow ile koşar. ROTACI PROTOKOLÜ ile birlikte geldiyse İSKELET AYNIDIR (kilit→uygula→kanıt→STATE→bırak→öl); bu blok yalnız 2. adımın (uygulama) NASIL'ını tanımlar. Workflow BAŞLATMAK "ajan doğurma" yasağına GİRMEZ — fan-out YALNIZ workflow script'indedir; script DIŞINDA ajan doğurmak, iş kuyruklamak ya da başka aşama açmak YASAK.
1. Kilidi al: node ~/.claude/skills/eszamanli/scripts/claim.mjs claim --res "plan:${slug}:asama:${no}" --intent "workflow: ${ad}" — reddedilirse başkası koşuyor, çık.
2. ~/.claude/skills/workflow/sablonlar/${sablon}.mjs kanon şablonundan çalışma script'ini üret (placeholder'ları doldur; ~/.claude/skills/workflow/SKILL.md). ÖNCE KAPI: node ~/.claude/skills/workflow/scripts/dogrula.mjs <script> exit 0 olmadan KOŞMA; sonra script'i Workflow tool'una vererek koş (slash-komut DEĞİL — 00 Not-1).
3. Kanıt: aide rota kanit --sinif hizli — exit 0 olmadan "bitti" YAZMA (Maestro "done" / workflow "completed" kanıt DEĞİLDİR); runId'yi STATE'e yaz.
4. STATE.md → KAPALI + kanıt yolu (plan-state kilidi altında).
5. Kilitleri bırak; node ~/.claude/skills/plan-organizatoru/scripts/agac.mjs --durum ile INDEX tazele; mührü pane'e yaz; ÖL.`;

// workflow bloğunun aşama no/ad'ı goal ile AYNI aşamadan (asama → asamaArg; normal → siradaki).
const wflowNo = asamaArg != null ? String(asamaArg).padStart(2, '0') : (plan.siradaki ? String(plan.siradaki.no).padStart(2, '0') : '??');
const wflowAd = asamaArg != null
  ? ((plan.hazir || []).find((x) => String(x.no).padStart(2, '0') === wflowNo)?.ad || '')
  : (plan.siradaki?.ad || '');
// Kırpılmaz sınıf, ek-metin'den ÖNCE, cümlelerden SONRA (D2). Ayracı ('\n\n') hazirla OMLET olarak
// SAHİPLENİR (ek-metin ayracı çağıranın malıydı; bu blok hazirla'nın malı). Workflow yoksa '' → BYTE-AYNI (R-01).
const wflowBlok = wflow ? `\n\n${WFLOW_PROTOKOL({ slug: plan.slug, v: plan.v, no: wflowNo, ad: wflowAd, sablon: wflow.sablon })}` : '';

// ---------- 3. 4000ch kapısı (kırpma sırası: nezaket → talimat; kapsam/otonomi + workflow + ek-metin ASLA düşmez) ----------

// ek-metin AYRAÇSIZ ve MUTLAK SON + workflow bloğu ondan ÖNCE: ikisi de join'in DIŞINDA (R-02) → kırpma
// hiçbirini düşürmez, aralarına '; ' koymaz (ayraç sahibi ekler; rota ek-metni "\n\n" ile başlatır).
// Bayraksız/klasik → wflowBlok='' ∧ ekMetin='' → biçim BYTE-AYNI.
const kur = () => [hamGoal, ...cumleler, ...(talimatC ? [talimatC] : []), ...(nezaketC ? [nezaketC] : [])].join('; ') + wflowBlok + ekMetin;
let satir = kur();
const kirpilan = [];
if (satir.length > GOAL_LIMIT && nezaketC) { nezaketC = null; kirpilan.push('nezaket cümlesi'); satir = kur(); }
if (satir.length > GOAL_LIMIT && talimatC) {
  const sar = (oz) => `ana talimat: "${oz}" — bu kapsamın dışına taşma`;
  const pay = GOAL_LIMIT - (kur().length - talimatC.length) - sar('…').length; // özet için kalan net pay (ek-metin dahil sayılır)
  talimatC = pay > 0 ? sar(talimat.slice(0, pay) + '…') : null;
  kirpilan.push('talimat özeti'); satir = kur();
}
if (satir.length > GOAL_LIMIT)
  die(5, `4000ch aşımı: kırpma sonrası ${satir.length}ch${wflowBlok ? ` (workflow bloğu ${wflowBlok.length}ch — kırpılamaz sınıf)` : ''}${ekMetin ? ` (ek-metin ${ekMetin.length}ch — kırpılamaz sınıf)` : ''} — kapsam/otonomi + workflow cümleleri düşürülemez. Slug/aşama/ek-metin olağandışı uzun; planı revize et ya da ek-metni kısalt.`);

// ---------- 4. zamanla komutu montajı ----------

// --asama verildiyse etiket O aşamadan; değilse sıradaki hazır aşamadan (mevcut davranış).
const asamaEtiket = asamaArg != null
  ? `asama-${String(asamaArg).padStart(2, '0')}`
  : (plan.siradaki ? `asama-${String(plan.siradaki.no).padStart(2, '0')}` : 'asama-?');
// Session adı — G4: paralel aşamalar/rota-modu tmux'ta çakışmasın (--asama → -a<NN>, --ham-metin → -ham).
const newName = asamaArg != null
  ? `planla-kos-${plan.slug.slice(0, 12)}-a${String(asamaArg).padStart(2, '0')}`
  : hamMetin != null
    ? `${plan.slug.slice(0, 20)}-ham`
    : `planla-kos-${plan.slug.slice(0, 12)}`;
// --title-onek başa VERBATIM (rota dedupe anahtarı title.includes('rota:<fp>:')); bayraksız → '' → mevcut biçim.
// KÜNYE ROZETİ (2026-07-26): planın künyesi Maestro yüzeyine (zamanla list · aide otomasyon ·
// kokpit) TAŞINIR — metronomun kuyruğuna bakan insan/ajan işin hangi kritiklikte bir plandan
// geldiğini iş kaydında görür. SONA eklenir: tüm dedupe `includes(...)` ön-ek/işaret eşlemesidir
// (rota:<fp>: · planIsareti), sonek onları BOZMAZ. Künyesiz planda ek YOK → başlık bayt-aynı.
const kunyeRozeti = plan.kunye?.oncelik != null
  ? ` · P${plan.kunye.oncelik} ${plan.kunye.kritiklik}/${plan.kunye.aciliyet}` : '';
const title = `${titleOnek}planla-kos: ${plan.slug} v${plan.v} ${asamaEtiket}${kunyeRozeti}`;

// Model kanonu: uygulama koşusu ANA tier'la açılır ("Fable yürütmez, Opus planlamaz" —
// ~/.claude/CLAUDE.md). Tek kaynak ~/.config/agent-ide/config.json → tiers.ana; buraya
// model adı YAZILMAZ (kanon değişirse dispatch kendiliğinden takip eder). Binary de tek
// kaynaktan: Maestro config claude_bin (login-shell PATH'i bayat sistem claude'u seçebilir).
let newCmd = null;
try {
  const aideCfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.config/agent-ide/config.json'), 'utf8'));
  const tiers = aideCfg.models?.tiers || aideCfg.tiers;
  const mc = JSON.parse(fs.readFileSync(path.join(path.dirname(ZAMANLA), '../config.json'), 'utf8'));
  const bin = mc.claude_bin || 'claude';
  if (tiers?.ana?.model) newCmd = `${bin} --model '${tiers.ana.model}'`; // [1m] zsh glob'una karşı tırnaklı
} catch { /* kanon dosyası yoksa daemon varsayılanı açılır */ }

// --timeout REAP EMNİYETİ (A2): planla-kos işi mühürsüz → `dispatched`'ta donuyor, oturum
// (planla-kos-<slug>) iş bitince idle birikiyordu (kanıtlı çöp: planla-kos-tuner-saglam, 17
// Tem'den beri). Timeout terminal bir hüküm doğurur → scheduler reap eder. 4sa cömert üst sınır
// (kapsam='hepsi' turu tüm planı koşabilir). Tam mühür simetrisi B1'de (uygulayıcıya katlama).
const args = ['add', '--text', satir, '--new-cwd', proje, '--new-name', newName,
  ...(newCmd ? ['--new-cmd', newCmd] : []),
  ...(socket ? ['--socket', socket] : []),
  ...(manual ? [] : ['--at', '+5s']), // --manual: tetik ÇIKAR → trigger.manual (zamanla.mjs:177 tek yazar)
  '--title', title, '--timeout', '14400',
  // İnce geçiş (R-07): grup/cap/muhur/on-fail içerik yorumlanmadan zamanla'ya taşınır (bayraksız → hepsi boş → argv BYTE-AYNI).
  ...(grup ? ['--group', grup] : []),
  ...(capArg != null ? ['--cap', capArg] : []), // capArg varsa --grup zaten var (yukarıda kapı)
  ...(muhur ? ['--muhur', muhur] : []),
  ...(onFail ? ['--on-fail', onFail] : []),
  ...(uretici ? ['--uretici', uretici] : [])]; // R22 adli iz — bayraksız → boş → argv BYTE-AYNI (R-01)
const sq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`; // POSIX tek-tırnak kaçışı (Türkçe kesmeler dahil)
const cmdStr = `aide zamanla ${args.map((a) => (/^[\w@%+=:,.\/-]+$/.test(a) ? a : sq(a))).join(' ')}`;

// ---------- 5. çıktı / dispatch ----------

// İzleme komutu: session doğana dek bekle (metronom ~5s'te açar), sonra attach.
// Attach yalnız İZLEYİCİdir — enjeksiyonu metronom yapar; Enter'a basma guardrail'i bozulmaz.
// --manual'de İZLE ANLAMSIZ (iş tetiksiz, session doğmaz): onay/run-now yolu basılır (T7).
const tmuxSock = socket ? `tmux -L ${socket}` : 'tmux';
const izle = manual
  ? 'aide zamanla onay-list   # iş tetiksiz kuyrukta; ateşlemek için: aide zamanla run-now <id>'
  : `n=0; until ${tmuxSock} has-session -t ${newName} 2>/dev/null || [ $n -ge 120 ]; do sleep 1; n=$((n+1)); done; ${tmuxSock} attach -t ${newName} || echo 'planla-kos: session 120sn içinde doğmadı — aide zamanla list ile kuyruğa bak'`;

// T6: mevcut alanlara DOKUNMA — ek `manual` (her zaman) + `rota` (yalnız bir rota bayrağı verildiyse).
// R-05: yeni bilgi yeni alanlarla; alan adları/anlamları değişmez.
const rotaVerildi = !!(grup || capArg != null || muhur || onFail || titleOnek || ekMetin || asamaArg != null || hamMetin != null);
const rapor = {
  plan: { slug: plan.slug, v: plan.v, siradaki: plan.siradaki, asamaToplam: plan.asamaToplam, asamaKapali: plan.asamaKapali },
  hamGoal, satir, chars: satir.length, limit: GOAL_LIMIT, kirpilan,
  kapsam: kapsam == null ? null : (kapsam === 'hepsi' ? 'hepsi' : kapsamN), otonomi: otonomi ?? null,
  newName, title, cmdStr, izle,
  manual,
  // R-05: yeni bilgi yeni alanda — yalnız workflow aşamasında (klasikte anahtar HİÇ yok → rapor BYTE-AYNI).
  ...(wflow ? { workflow: { kosum: 'workflow', sablon: wflow.sablon, wflowProtokolChars: wflowBlok.length } } : {}),
  ...(rotaVerildi ? {
    rota: {
      ...(grup ? { grup } : {}),
      ...(capArg != null ? { cap: +capArg } : {}),
      muhur: !!muhur,
      ...(onFail ? { onFail } : {}),
      ...(titleOnek ? { titleOnek } : {}),
      ...(asamaArg != null ? { asama: String(asamaArg).padStart(2, '0') } : {}),
      ...(hamMetin != null ? { hamMetin: true } : {}),
      ekMetinChars: ekMetin.length,
    },
  } : {}),
};

if (flag('--dispatch')) {
  const r = spawnSync('bun', [ZAMANLA, ...args], { encoding: 'utf8', cwd: proje });
  if (r.status !== 0) die(6, `zamanla add başarısız (exit ${r.status}):\n${r.stderr || r.stdout}`);
  rapor.dispatch = (r.stdout || '').trim();
  // Görünürlük BURADA açılmaz — tek chokepoint metronom spawn'ıdır (tmux.mjs makeVisible,
  // config spawn_visible). İki yüzey iki pencere açardı; izle komutu yalnız yedek/elle yol.
}

if (flag('--json')) { process.stdout.write(JSON.stringify(rapor, null, 2) + '\n'); process.exit(0); }

console.log(`plan: ${plan.slug} v${plan.v} · sıradaki: ${plan.siradaki ? `${plan.siradaki.no} — ${plan.siradaki.ad}` : '—'} (${plan.asamaKapali}/${plan.asamaToplam} kapalı)`);
console.log(`\nham /goal (agac.mjs'ten verbatim):\n  ${hamGoal}`);
console.log(`\neklenmiş satır (${satir.length}/${GOAL_LIMIT}ch${kirpilan.length ? ` · kırpılan: ${kirpilan.join(', ')}` : ''}):\n  ${satir}`);
console.log(`\nzamanla komutu${flag('--dispatch') ? ' (ATEŞLENDİ)' : ' (KURU — ateşlemek için --dispatch)'}:\n  ${cmdStr}`);
if (manual) console.log(`\n(MANUAL — tetiksiz; kuyrukta bekler) onay/ateşleme: aide zamanla onay-list → aide zamanla run-now <id>`);
if (rapor.dispatch) console.log(`\ndispatch sonucu:\n  ${rapor.dispatch}`);
