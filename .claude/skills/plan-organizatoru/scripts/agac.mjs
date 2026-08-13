#!/usr/bin/env node
// sg: katman=modul rol=motor
// agac.mjs — plan ağacı türetici + tazelik kapısı (plan-organizatoru'nun makine katmanı)
//
// INDEX.md ve INDEX.json ELLE YAZILMAZ — tek yazar bu script'tir (Ders 15/17:
// elle tutulan endeks yalan söyler; endeks kaynaklardan TÜRETİLİR).
// Tazelik içerik damgasıyla ölçülür (Ders 16: mtime değil).
//
// Kullanım (proje kökünde ya da --proje <yol> ile):
//   node agac.mjs                 INDEX.md + INDEX.json türet (idempotent)
//   node agac.mjs --gate          damga/drift + governance denetimi; ihlalde exit 1
//   node agac.mjs --durum         "nerede kalmıştık" brifi (md; --json ile json)
//   node agac.mjs --denetle       governance süpürmesi raporu (yazmaz)
//   node agac.mjs --legacy        legacy.json girdilerini doğrula
//   node agac.mjs --graf --json   plan AĞI grafı (düğüm+kenar; harita/runner'ın TEK veri kaynağı)
//   node agac.mjs --kunye         plan künyesi raporu (kategori·hedef·kritiklik·aciliyet·hacim)
//   node agac.mjs --todo          GENEL TODO listesi (md; --json ile json) — salt-okur, exit 0
//   node agac.mjs --bagimlilik-tohumla   MASTER `bağımlı` sütununu STATE tablosuna işle (idempotent)
//
// GENEL TODO (2026-07-27 kullanıcı kararı) — projenin TEK ve GÜNCEL iş listesi. Sınıf: motor ·
//   deterministik · 0 token. MELEZ model, İKİ DOSYA İKİ YAZAR (bir dosyanın tek yazarı olur):
//     plans/TODO-ELLE.md  ← ELLE yazılan KAYNAK (insan/PM/işi kapatan session); madde çıpası
//                            `<!-- td:elle/<slug> -->`. Script buraya YALNIZ yokken tohum atar.
//     plans/TODO.md       ← TÜREV çıktı (+ INDEX.json → todo). ELLE YAZILMAZ; tek yazar bu script.
//   Kaynaklar (5): açık CHECKLIST maddeleri METNİYLE · elle maddeler · HUKUM.md EKSİK/STUCK ·
//   eksik-künye advisory'si · sarkık oturum alarmı (EKSİK oturum → tek satır). İLANLI MUAF (5): alerts.jsonl · parked işler · doctor fix: ·
//   teslim onar: · kaptan task'ları — hepsi plans/ alanı DIŞI yazarlardan gelir ve her birinin
//   KENDİ görünürlük kanalı vardır. Uzatma noktası: `TODO_KAYNAKLARI` dizisi — yeni kaynak = tek
//   saf fonksiyon `(ctx) => madde[]`.
//   ÇİFT YÖN: plan→madde ELLE yazılır (MASTER künye bloğunda `> Kapatır: td:<ref>[, …]`),
//   madde→plan TÜREVDİR (`kapatan[]`). Biçimsiz ref gate FAIL (yanlış yazım sessizce bağsız
//   kalırdı); şemalı ama karşılıksız ref ADVISORY (türev maddeler UÇUCUDUR).
//   UTOPYA SINIRI: `td:` ad-alanı `uy:`den AYRIDIR ve bu script `uy:` çıpasını NE PARSE EDER NE
//   KOPYALAR — utopya "ne istiyoruz"u (şartname) söyler, TODO "ne yapılacak"ı (iş kalemi).
//
// PLAN KÜNYESİ (2026-07-26 kullanıcı kararı — aide felsefesi, tüm ~/dev projelerine iner):
//   Her planın MASTER.md üst bloğu planın KİMLİK KARTINI taşır; "hangi plan önce" sorusu
//   tahminle değil KÜNYEYLE yanıtlanır:
//     > Kategori: <proje|özellik|altyapı|süreç|araştırma> · Üst: <slug|—>
//     > Kritiklik: <kritik|yüksek|orta|düşük> · Aciliyet: <acil|yakın|normal|ertelenebilir> · Hacim: <küçük|orta|büyük|epik>
//     > Hedef: <tek cümle — bu plan bitince dünyada ne değişmiş olur>
//     > Oturum: ot:<YYYY-MM-DD>/<slug>       ← KAYNAK OTURUM (2026-07-27 kullanıcı kararı)
//
// OTURUM (session) BOYUTU — "bu oturumda koyduğum hedefleri ve planları bitirdim mi?" (2026-07-27):
//   Plan katmanı PROJE eksenlidir; ama iş OTURUMLARDA yapılır ve bir oturumun kendi hedefini
//   tamamlayıp tamamlamadığı proje ekseninden GÖRÜLMEZ. İkinci eksen bu yüzden var. ÇİFT DİKİŞ:
//     plan → oturum   ELLE  (künyedeki `> Oturum:` — planın kendi beyanı)
//     oturum → plan   TÜREV (`oturum-lib.mjs` → `plans/OTURUMLAR.md` roll-up'ı + hüküm)
//   Bu dosyanın oturum tarafındaki SORUMLULUĞU üçtür ve daha fazlası DEĞİL: (1) `Oturum:` alanını
//   parse edip `kunye.oturum` olarak yayınlamak, (2) governance'a GEÇERSİZ OTURUM bulgusunu
//   eklemek (biçimsiz beyan gate FAIL; beyansızlık ADVISORY), (3) hükmü EKSİK olan oturumu genel
//   TODO'ya TEK satır olarak düşürmek (`kaynakOturum`). Roll-up/kılavuz/tohumlama `oturum.mjs`in.
//   AIDE'DEN BAĞIMSIZ: bu yol node + dosya sistemidir; `aide sistem` kapalıyken de döner.
//   `oncelik` (0-3) TÜREVDİR, elle yazılmaz: oncelik = min(3, round((kritiklik + aciliyet)/2))
//   (Eisenhower ekseni; puanlar kritik/acil=3 … düşük/ertelenebilir=0). Toplam sıra anahtarı
//   `puan = kritiklik*4 + aciliyet` (0-15) — eşitlikte kritiklik, sonra slug (deterministik).
//   LEGACY SÖZLEŞMESİ (kosum: emsali): künye YOKSA alanlar null'dur, gate KIRILMAZ (advisory,
//   `--kunye`); künye VARSA ve değer şema dışıysa gate FAIL eder (yanlış künye, künyesizlikten
//   beterdir — tüketici ona göre sıralar).
//
// DAG modeli (runner-ağı): STATE "Aşama durumları" tablosu opsiyonel `bağımlı` sütunu taşır —
//   "00, 01" = VE (hepsi KAPALI) · "01/02" = VEYA (biri KAPALI; ayraç `/` — `|` markdown tablo
//   hücresini BÖLER, o yüzden yasak) · "kalite-turu:03" = çapraz-plan
//   gate · "—" = başlangıç düğümü. Sütun YOKSA plan lineer-legacy'dir (eski davranış birebir:
//   hazır küme = ilk AÇIK aşama). `hazir[]` (ready-set) hükmünün TEK sahibi bu dosyadır (Ders 17);
//   runner'lar kendi ölçütünü yazmaz, buraya sorar.
//
// AKTİVASYON ANAHTARI (kullanıcı kararı 2026-07-16): DAG DAVRANIŞI `plans/.dag-aktif` işaret
//   dosyası varken açılır. İşaret YOKKEN sistem GÖRSELLEŞTİRME-MODUNDADIR: `--graf`/hazir[]/
//   bekleyen[] hesaplanır (harita çalışır) ama (a) `siradaki`/`goal` seçimi ESKİ lineer davranıştır
//   (ilk SÜRÜYOR, yoksa ilk AÇIK — bağımlılığa bakılmaz), (b) DAG governance bulguları
//   (DÖNGÜ/KOPUK BAĞ/GEÇERSİZ/UYUMSUZ) gate'i KIRMAZ (--denetle "pasif" diye listeler).
//   Mevcut /goal-planla-kos akışları böylece hiç etkilenmez.
//
// TÜKETİCİ (2026-07-17): `hazir[]` ready-set'inin tüketicisi artık `packages/rotaci` reconciler'ıdır
//   (`aide rota tick`). O, VALFTEN BAĞIMSIZ olarak `hazir[]`'i okur — bu alan `.dag-aktif` yokken de
//   hesaplanır (bkz. satır ~244/257), yalnız `siradaki`/`goal` seçimi valfe bağlıdır.
//   2026-07-16'nın fraktal runner-ağı (kosucu.mjs + degerlendirici) ARŞİVLENDİ:
//   `<agent-ide>/archive/2026-07-16-runner-agi/ARSIV.md` — gerekçe: hüküm veren el eylemi de
//   yapıyordu (öz-tetikleme), runner runner doğuruyordu, ve hiç koşmadan tasarlanmıştı.
//
// GETİRİR BEYANI (aşama 31 — sistem grafı v4): "bu aşama sisteme hangi düğümü/kenarı/katmanı
//   GETİRECEK" bilgisi bugüne dek SERBEST CÜMLEYDİ ve makineye OPAKTI. Aşama frontmatter'ı artık
//   KAPALI ŞEMALI bir `getirir:` bloğu taşıyabilir; bu script onu PARSE eder, INDEX.json'a ve
//   `--graf`a ADDITIVE özetler, damgaya katar. Tüketici: planlanan-graf projeksiyonu (aşama 32) —
//   ikinci bir parser YAZMAZ, bunu okur.  Gramer (kanon: plans/sistem-graf/v4/kanit/asama-31/
//   getirir-sozlesmesi.txt — çelişkide O dosya kazanır, bu özet düzeltilir):
//     beyan   := 'getirir: yok'  |  'getirir:' + madde+
//     madde   := GIRINTI '- ' anahtar ': ' değer      anahtar ∈ {katman,dugum,kenar,kaldir,dokunur}
//     AD := [a-z][a-z0-9-]*   ID := AD ':' YOL   YOL := [A-Za-z0-9_./:-]+   UC := AD ':' (YOL|'*')
//     katman: AD · dugum: ID (joker YOK) · dokunur: ID · kenar: TIP UC -> UC
//     kaldir: 'katman ' AD | 'dugum ' ID | 'kenar ' TIP UC -> UC
//   Kurallar: satır-sonu ` # yorum` kırpılır · aynı anahtar TEKRARLANABİLİR · BİREBİR tekrar
//   GEÇERSİZ · `yok` altına madde GEÇERSİZ · blok madde olmayan ilk satırda biter, ARDINDAN
//   frontmatter'da girintili-ama-madde-olmayan satır kalırsa GEÇERSİZ (yazım hatası yutulmaz) ·
//   `*` yalnız kenar UCUNDA ve TEK BAŞINA.
//   HÜKÜM: beyan VAR + şema dışı → GATE FAIL (`GEÇERSİZ GETİRİR`, VALFSİZ — GEÇERSİZ KOŞUM
//   emsali, sıfır legacy etki). Beyan YOK → ADVISORY, plan-başına TEK satır (`--kunye`/`--denetle`;
//   KAPALI plan/aşama MUAF, sayı İLANLI). `--durum`a satır EKLENMEZ (İLANLI karar: --durum insan
//   brifidir; beyan eksikliği makine-projeksiyon meselesidir).
//   BEYAN HARİTADIR, EYLEM DEĞİLDİR: `kaldir:` dahil hiçbir madde bir şey YÜRÜTMEZ.
//   ŞEKİL doğrulanır, VARLIK doğrulanmaz — uçların bugün var olmaması NORMALDİR (gelecek tarifi);
//   varlık/mutabakat denetimi 32'nin işidir (İLANLI muafiyet: bu script taşınabilirdir ve yabancı
//   bir projenin katman envanterini BİLEMEZ). Tek anlam istisnası kenar TİPİdir — kapalı liste.
//
// Kaynaklar: plans/<slug>/v<N>/{MASTER,STATE,CHECKLIST}.md (+ asama-*.md adları)
//            plans/legacy.json (yerinde endekslenen, taşınmamış plan parçaları)

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
// OTURUM boyutu — parse/hüküm TEK yerde (oturum-lib.mjs); bu dosya onu TÜKETİR, çoğaltmaz.
import { OT_RE, oturumTablosu, refDosyaAdi } from './oturum-lib.mjs';

const argv = process.argv.slice(2);
const flag = (f) => argv.includes(f);
const opt = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };

const ROOT = path.resolve(opt('--proje') || process.cwd());
const PLANS = path.join(ROOT, 'plans');
const INDEX_MD = path.join(PLANS, 'INDEX.md');
const INDEX_JSON = path.join(PLANS, 'INDEX.json');
const LEGACY = path.join(PLANS, 'legacy.json');
// GENEL TODO (2026-07-27) — plan katmanının TEK iş listesi. MELEZ model:
//   TODO-ELLE.md = ELLE yazılan KAYNAK (yazarı insan/PM/işi kapatan session; çıpa `td:elle/<slug>`)
//   TODO.md      = TÜREV çıktı (+ INDEX.json → todo). TEK YAZAR bu script'tir; elle yazılmaz.
// İki dosya, iki yazar — çünkü bir dosyanın TEK yazarı olur (INDEX kuralının aynısı).
const TODO_MD = path.join(PLANS, 'TODO.md');
const TODO_ELLE = path.join(PLANS, 'TODO-ELLE.md');
// Kapsamdaki 5 kaynak: chk (açık CHECKLIST maddesi) · elle · hukum (EKSİK/STUCK) · kunye (advisory) · oturum (sarkık).
// İLANLI MUAF 5 kaynak — hepsi `plans/` alanı DIŞI yazarlardan gelir; bu script saf-builtins ve
// plans-kapsamlı kalır, kaptan verisi ise hesaba bağlı DURUM'dur (git-izli kanona sızmamalı).
// Her birinin kendi görünürlük kanalı VAR: alerts→PM brifingi · parked→Rotacı teşhis · doctor→exit≠0.
const TODO_MUAF = ['alerts.jsonl', 'parked işler', 'doctor fix:', 'teslim onar:', "kaptan task'ları"];
const TD_RE = /^td:(chk|elle|hukum|kunye|oturum)\/[a-z0-9][a-z0-9./-]*$/;
// `uy:<hedef>/<yetenek>` — utopya çıpası (adres uzayının `uy:` tipi). `Capability:` alanının
// ŞEMASI budur; şema dışı parça gate FAIL eder (GEÇERSİZ KAPATIR emsali), beyansızlık ADVISORY.
const UY_RE = /^uy:[a-z0-9][a-z0-9-]*\/[a-z0-9][a-z0-9./-]*$/;
const KATEGORILER = ['proje', 'özellik', 'altyapı', 'süreç', 'araştırma'];
const DURUMLAR = ['AÇIK', 'SÜRÜYOR', 'KAPALI', 'BLOKE'];
// Plan künyesi ekseneri — sıra ANLAMLIDIR (indeks = puan; yüksek = önce)
const KRITIKLIK = ['düşük', 'orta', 'yüksek', 'kritik'];
const ACILIYET = ['ertelenebilir', 'normal', 'yakın', 'acil'];
const HACIM = ['küçük', 'orta', 'büyük', 'epik'];
// DAG davranış anahtarı — yokken görselleştirme-modu (üstteki blok açıklar)
const DAG_AKTIF = fs.existsSync(path.join(PLANS, '.dag-aktif'));
// `getirir:` beyanının KAPALI anahtar kümesi (aşama 31). Başka anahtar = GEÇERSİZ GETİRİR.
const GETIRIR_ANAHTARLAR = ['katman', 'dugum', 'kenar', 'kaldir', 'dokunur'];
// KENAR TİPLERİ — SABİT KOPYA. KANON: packages/core/src/sistem-graf.ts → `export type SGEdgeTip`
// (+ runtime aynası `KENAR_TIPLERI`, bekçi `sgKenarTipiMi()`), aşama 28'de kuruldu.
// NEDEN KOPYA: bu script saf .mjs'dir ve YABANCI projelerde de koşar (~/.claude/plan-global/,
// ~/dev altındaki her proje) → core'un TypeScript'inden import EDEMEZ.
// KOPYA MÜHÜRLÜDÜR: packages/core/test/sg-kenar-esleme.test.ts küme-eşitliği assert eder —
// 28'in union'ı değişir de bu liste durursa O TEST KIRILIR. Sessiz drift imkânsız.
// Küme bağlayıcıdır, SIRA DEĞİL.
const KENAR_TIPLERI = ['icerir', 'ust', 've', 'veya', 'capraz', 'aittir', 'calistirir', 'dogurur',
  'bagli', 'uyesi', 'tutar', 'esler', 'catisir', 'korur', 'dagitir', 'izler', 'tetikler'];
// Gramer ilkelleri — charset ÖLÇÜLDÜ (2026-08-04, canlı graf 864 düğüm: `AD:YOL` desenine
// uymayan 0). Taslaktan İKİ DARALTMA yapıldı (genişletme yasak): `@` düştü (0 kullanım) ·
// `*` YOL'dan düştü (joker rezervi; `*` taşıyan 7 düğümün tamamı UÇUCU `kilit:` katmanıdır ve
// hiçbir aşamanın yapısal vaadi değildir — İLANLI muafiyet).
const G_AD = '[a-z][a-z0-9-]*';
const G_YOL = '[A-Za-z0-9_./:-]+';
const G_AD_RE = new RegExp(`^${G_AD}$`);
const G_ID_RE = new RegExp(`^${G_AD}:${G_YOL}$`);
const G_UC_RE = new RegExp(`^${G_AD}:(?:${G_YOL}|\\*)$`);
// `onar:` metni — her sapma çaresini TAŞIR (çaresi olmayan alarm alarmı köreltir).
const GETIRIR_ONAR = `onar: şema — 'getirir: yok' YA DA '  - <${GETIRIR_ANAHTARLAR.join('|')}>: <değer>' satırları` +
  ` (katman: ad · dugum/dokunur: ad:yol · kenar: <tip> uc -> uc · kaldir: katman|dugum|kenar …` +
  ` · tip ∈ ${KENAR_TIPLERI.join(',')})`;

const readIf = (p) => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };

// ---------- kaynak tarama ----------

function listPlanSlugs() {
  if (!isDir(PLANS)) return [];
  return fs.readdirSync(PLANS)
    .filter((e) => isDir(path.join(PLANS, e)))
    .filter((e) => fs.readdirSync(path.join(PLANS, e)).some((v) => /^v\d+$/.test(v)))
    .sort((a, b) => (a === 'proje' ? -1 : b === 'proje' ? 1 : a.localeCompare(b, 'tr')));
}

function orphanDirs() {
  if (!isDir(PLANS)) return [];
  return fs.readdirSync(PLANS)
    .filter((e) => isDir(path.join(PLANS, e)))
    .filter((e) => !fs.readdirSync(path.join(PLANS, e)).some((v) => /^v\d+$/.test(v)))
    .sort();
}

function highestVersion(slug) {
  const vs = fs.readdirSync(path.join(PLANS, slug))
    .filter((v) => /^v\d+$/.test(v))
    .map((v) => parseInt(v.slice(1), 10))
    .sort((a, b) => a - b);
  return vs[vs.length - 1];
}

// ---------- parser'lar (plan-kur şablon formatı) ----------

function masterUstBlok(md) {
  // H1'i izleyen alıntı (`>`) bloğu = künye alanı. Künye YALNIZ burada aranır: "Hedef:" kelimesi
  // gövde metninde de geçebilir (Ders 5: makine, sözleşmeli yeri okur — metni tarayıp tahmin etmez).
  if (!md) return '';
  const m = md.match(/^#[^\n]*\n+((?:[ \t]*>[^\n]*\n)+)/m);
  return m ? m[1] : '';
}

function kunyeAlan(blok, ad, { satirSonu = false } = {}) {
  // `> A: x · B: y` biçiminde tek alan; değer bir sonraki `·` ya da satır sonuna kadar.
  // `satirSonu:true` → değer SATIR SONUNA kadar okunur: serbest metin alanları (Hedef) `·`
  // içerebilir ve `·`de kesilirse cümle sessizce kırpılırdı (kanıtta yakalandı: "…dört
  // yüzeyden (CLI" — sessiz kırpma yasak). Bu yüzden serbest alan KENDİ SATIRINDA yaşar.
  const son = satirSonu ? '[^\\n]+' : '[^·\\n]+';
  const re = new RegExp(`(?:^|[>·])\\s*${ad}:\\s*(${son})`, 'm');
  const v = (blok.match(re) || [])[1]?.trim().replace(/\s*<.*>\s*$/, '').trim();
  return v || null;
}

function eksenDegeri(ham, eksen) {
  // Şema KAPALI: değer listedeyse normalize edilmiş hâli, değilse {gecersiz} — çıkarsama YOK.
  if (ham == null) return { deger: null, puan: null };
  const k = trKey(ham);
  const i = eksen.findIndex((e) => trKey(e) === k);
  if (i < 0) return { deger: null, puan: null, gecersiz: ham };
  return { deger: eksen[i], puan: i };
}

function parseKunye(md) {
  // Dönen künye alanları: kategori · ust · hedef · kritiklik · aciliyet · hacim (+ türev oncelik/puan).
  // Künyesiz plan legaldir (alanlar null) — governance onu ADVISORY sayar, gate'i kırmaz.
  const blok = masterUstBlok(md);
  const kategoriHam = kunyeAlan(blok, 'Kategori') || (md ? (md.match(/Kategori:\s*([^\s·|>]+)/) || [])[1] : null);
  const ustHam = kunyeAlan(blok, 'Üst') || (md ? (md.match(/Üst:\s*([^\s·|>]+)/) || [])[1] : null);
  const kritiklik = eksenDegeri(kunyeAlan(blok, 'Kritiklik'), KRITIKLIK);
  const aciliyet = eksenDegeri(kunyeAlan(blok, 'Aciliyet'), ACILIYET);
  const hacim = eksenDegeri(kunyeAlan(blok, 'Hacim'), HACIM);
  const hedefHam = kunyeAlan(blok, 'Hedef', { satirSonu: true });
  const hedef = hedefHam && !/^<.*>$/.test(hedefHam) ? hedefHam : null;   // şablon placeholder'ı künye sayılmaz
  // TÜREV: elle yazılmaz. Kritiklik ile aciliyetin ikisi de yoksa öncelik de yoktur (uydurma yasak).
  const puan = kritiklik.puan != null && aciliyet.puan != null ? kritiklik.puan * 4 + aciliyet.puan : null;
  const oncelik = kritiklik.puan != null && aciliyet.puan != null
    ? Math.min(3, Math.round((kritiklik.puan + aciliyet.puan) / 2)) : null;
  const gecersiz = [];
  for (const [ad, e] of [['Kritiklik', kritiklik], ['Aciliyet', aciliyet], ['Hacim', hacim]])
    if (e.gecersiz != null) gecersiz.push({ alan: ad, deger: e.gecersiz });
  const kategori = (kategoriHam || '').trim() || null;
  const ust = (ustHam || '').trim() || null;
  // `Kapatır: td:a/b, td:c/d` — plan→madde bağı (ELLE yazılır; ters yön TÜREVDİR, buildTodo kurar).
  // OPSİYONEL: satır yoksa boş dizi. Şema dışı parça gate FAIL eder (yanlış yazım sessizce bağsız
  // kalırdı); şemalı ama karşılığı olmayan ref ise ADVISORY'dir — türev maddeler UÇUCUDUR
  // (checklist maddesi kapanınca ref'i doğal olarak kaybolur; bu alarm değil yaşam döngüsüdür).
  const kapatirHam = kunyeAlan(blok, 'Kapatır', { satirSonu: true });
  const kapatir = []; const kapatirGecersiz = [];
  for (const parca of String(kapatirHam || '').split(',').map((s) => s.trim()).filter(Boolean)) {
    if (/^<.*>$/.test(parca)) continue;                 // şablon placeholder'ı — beyan sayılmaz
    if (TD_RE.test(parca)) kapatir.push(parca); else kapatirGecersiz.push(parca);
  }
  // `Oturum: ot:<YYYY-MM-DD>/<slug>` — planın KAYNAK OTURUMU (2026-07-27 kullanıcı kararı).
  // ÇİFT DİKİŞİN ELLE UCU: plan hangi oturumdan doğduğunu KENDİ söyler; ters yön (oturum → plan
  // listesi + hüküm) TÜREVDİR (oturum-lib). Eksik beyan ADVISORY (künye emsali), YANLIŞ beyan
  // gate FAIL (tüketici — kılavuz sırası, "bu oturumu bitirdim mi" hükmü — ona göre karar verir).
  // `End-goal:` + `Capability:` (aide-l:02 D7) — planın NE DAVRANIŞ bırakacağı ve hangi
  // utopya çıpalarını karşıladığı. Sözleşme künye emsalinin AYNISI: beyansızlık ADVISORY
  // (legacy plan kırılmaz), BİÇİMSİZ beyan gate FAIL (yanlış beyan beyansızlıktan beterdir).
  // Ölçen ikinci uç `aide mutabakat` ②: Capability'siz açık plan "vizyonsuz plan" olarak GÖRÜNÜR.
  const endGoalHam = kunyeAlan(blok, 'End-goal', { satirSonu: true });
  const endGoal = endGoalHam && !/^<.*>$/.test(endGoalHam) ? endGoalHam : null;
  const capHam = kunyeAlan(blok, 'Capability', { satirSonu: true });
  const capability = []; const capabilityGecersiz = [];
  for (const parca of String(capHam || '').split(/[,·]/).map((x) => x.trim()).filter(Boolean)) {
    if (/^<.*>$/.test(parca)) continue;                 // şablon placeholder'ı — beyan sayılmaz
    if (UY_RE.test(parca)) capability.push(parca); else capabilityGecersiz.push(parca);
  }
  const oturumHam = kunyeAlan(blok, 'Oturum');
  const oturum = oturumHam && OT_RE.test(oturumHam) ? oturumHam : null;
  const oturumGecersiz = oturumHam && !oturum ? oturumHam : null;
  return {
    kategori, ust: ust === '—' ? null : ust, hedef,
    kritiklik: kritiklik.deger, aciliyet: aciliyet.deger, hacim: hacim.deger,
    oncelik, puan, gecersiz, kapatir, kapatirGecersiz, oturum, oturumGecersiz,
    endGoal, capability, capabilityGecersiz,
    eksik: ['Kritiklik', 'Aciliyet', 'Hacim', 'Hedef', 'End-goal', 'Capability'].filter((a, i) =>
      [kritiklik.deger, aciliyet.deger, hacim.deger, hedef, endGoal, capability.length || null][i] == null),
  };
}

function parseMaster(md) {
  if (!md) return { title: null, kategori: null, ust: null, kunye: parseKunye(null) };
  const title = (md.match(/^#\s+(.+)$/m) || [])[1]?.replace(/\s*—\s*MASTER.*$/i, '').trim() || null;
  const kunye = parseKunye(md);
  return { title, kategori: kunye.kategori, ust: kunye.ust, kunye };
}

// Plan sıra anahtarı — TEK yer (Ders 4: değer kopyalanmaz, çözümlenir). Künyesiz plan sona düşer
// (puan -1): sıraya girmek isteyen künyesini yazar.
const kunyePuan = (p) => (p?.kunye?.puan ?? -1);
const kunyeSirala = (a, b) => (kunyePuan(b) - kunyePuan(a))
  || ((b?.kunye?.oncelik ?? -1) - (a?.kunye?.oncelik ?? -1))
  || String(a.slug).localeCompare(String(b.slug));
const kunyeOzet = (k) => !k || (k.kritiklik == null && k.aciliyet == null && k.hacim == null) ? '—'
  : `${k.kritiklik || '?'}/${k.aciliyet || '?'} · ${k.hacim || '?'}${k.oncelik != null ? ` (P${k.oncelik})` : ''}`;

const trKey = (s) => String(s || '').toLowerCase()
  .replace(/ş/g, 's').replace(/ğ/g, 'g').replace(/ı/g, 'i')
  .replace(/ü/g, 'u').replace(/ö/g, 'o').replace(/ç/g, 'c').trim();

function parseDeps(cell) {
  // "—"|"" → [] (başlangıç düğümü). Dönen yapı: VE-listesi; her eleman VEYA-grubu
  // [{plan|null, no}] — "00, 01/02, kalite-turu:03" → [[00],[01,02],[kalite-turu:03]]
  // VEYA ayracı `/` — `|` markdown tablo hücresini böldüğü için SÖZDİZİMİ OLARAK YASAK
  // (kanıtta yakalandı: "00|01" hücresi iki sütuna bölünüp OR'u sessizce yutuyordu).
  const s = String(cell || '').trim().replace(/\\\|/g, '/');
  if (!s || s === '—' || s === '-') return [];
  return s.split(',').map((t) => t.trim()).filter(Boolean).map((term) =>
    term.split('/').map((alt) => {
      const m = alt.trim().match(/^(?:([a-z0-9-]+):)?(\d{2,})$/i);
      return m ? { plan: m[1] || null, no: m[2] } : { plan: null, no: alt.trim(), gecersiz: true };
    }));
}

const depStr = (deps) => !deps || !deps.length ? '—'
  : deps.map((g) => g.map((d) => (d.plan ? d.plan + ':' : '') + d.no).join('/')).join(', ');

function parseStateTable(md) {
  // "## Aşama durumları" altındaki | # | aşama | durum | [bağımlı] | ... | tablosu.
  // Sütunlar başlık SATIRINDAN eşlenir (konum değil ad sözleşmesi — Ders 5: makine, yazılanı
  // okumalı); `bağımlı` opsiyonel: yoksa bagimli=null → plan lineer-legacy.
  if (!md) return [];
  const sec = md.split(/^##\s+Aşama durumları\s*$/m)[1];
  if (!sec) return [];
  const rows = [];
  let cols = null;
  for (const line of sec.split('\n')) {
    if (!line.trim().startsWith('|')) { if (rows.length) break; continue; }
    const cells = line.split('|').map((c) => c.trim()).filter((_, i, a) => i > 0 && i < a.length - 1);
    if (cells.length < 3) continue;
    if (cells[0] === '#') { cols = {}; cells.forEach((c, i) => { cols[trKey(c)] = i; }); continue; }
    if (/^-+$/.test(cells[0].replace(/[:\s]/g, '-'))) continue;
    const at = (name, fb) => { const i = cols ? cols[name] : undefined; return i != null ? (cells[i] || '') : (fb != null ? (cells[fb] || '') : ''); };
    const durumRaw = at('durum', 2);
    const durum = DURUMLAR.find((d) => durumRaw.toUpperCase().includes(d)) || durumRaw || '?';
    rows.push({
      no: cells[0], ad: at('asama', 1) || cells[1], durum,
      bagimli: cols && cols['bagimli'] != null ? parseDeps(cells[cols['bagimli']]) : null,
      kanit: at('kanit', 4),
    });
  }
  return rows;
}

function parseMasterDeps(md) {
  // MASTER'daki aşama tablosundan (başlığında `#` + `bağımlı` olan ilk tablo) no → bağımlılık
  // haritası türetir. Hücre serbest metin olabilir: parantez içi not atılır, "01–05" aralığı
  // açılır, `slug:NN` ve `NN` referansları toplanır. Dönen değer: Map(no → deps[]) | null.
  if (!md) return null;
  let cols = null; const map = new Map();
  for (const line of md.split('\n')) {
    if (!line.trim().startsWith('|')) { if (map.size) break; cols = null; continue; }
    const cells = line.split('|').map((c) => c.trim()).filter((_, i, a) => i > 0 && i < a.length - 1);
    if (!cols) {
      const k = cells.map(trKey);
      if (k[0] === '#' && k.includes('bagimli')) cols = k;
      continue;
    }
    if (/^-+$/.test(cells[0].replace(/[:\s]/g, '-'))) continue;
    const noM = cells[0].match(/\d+/);
    if (!noM) continue;
    let cell = (cells[cols.indexOf('bagimli')] || '').replace(/\([^)]*\)/g, ' ');
    cell = cell.replace(/(\d{2})\s*[–-]\s*(\d{2})/g, (_, a, b) => {
      const out = []; for (let i = +a; i <= +b; i++) out.push(String(i).padStart(2, '0'));
      return out.join(', ');
    });
    const refs = [...cell.matchAll(/(?:\b([a-z0-9-]+):)?(\d{2})\b/gi)]
      .map((m) => ({ plan: m[1] || null, no: m[2] }));
    const seen = new Set(); const deps = [];
    for (const r of refs) { const k = (r.plan || '') + ':' + r.no; if (!seen.has(k)) { seen.add(k); deps.push([r]); } }
    map.set(noM[0].padStart(2, '0'), deps);
  }
  return cols ? map : null;
}

function parseSonTur(md) {
  // "## Tur günlüğü" altındaki ilk ### başlık + ilk "- Yapılan:" satırı
  if (!md) return null;
  const sec = md.split(/^##\s+Tur günlüğü.*$/m)[1];
  if (!sec) return null;
  const h = (sec.match(/^###\s+(.+)$/m) || [])[1]?.trim();
  if (!h || /<.*>/.test(h)) return null; // şablon placeholder'ı
  const yapilan = (sec.match(/^-\s*Yapılan:\s*(.+)$/m) || [])[1]?.trim() || '';
  return { baslik: h, yapilan };
}

// Madde etiketi: "**A01**", "T01.1", "T1-T2", "T03.2" … (gerçek CHECKLIST'lerde ölçüldü).
// Etiket `td:chk/...` ref'inin KİMLİK parçasıdır: satır/konum ref'e GİRMEZ, böylece madde dosya
// içinde taşınınca ref SABİT kalır. Etiketsiz maddede ref metin hash'ine düşer (ilan edilen sınır:
// metni değişince ref değişir — kalıcı bağ isteyen madde etiket alır).
const MADDE_ETIKET_RE = /^[*_]*([A-Za-z]{1,3}\d+(?:\.\d+)?(?:[–-][A-Za-z]{0,3}\d+(?:\.\d+)?)?)/;

function parseChecklist(md) {
  // GENİŞLETİLDİ (2026-07-27): sayılar KORUNUR (eski regex ile bire bir aynı), üstüne AÇIK
  // maddelerin METNİ eklenir. Bugüne dek metin ATILIYORDU — repoda ~75 açık madde hiçbir türev
  // çıktıya girmiyordu; genel TODO'nun asıl değeri bu metindir.
  // Geriye uyum: `acik`/`kapali` alanları aynen durur (tüketiciler: governance :501,
  // renderIndexMd, renderIndexJson, kaptan readPlans). Yeni alan `maddeler` YALNIZ açık maddeler.
  if (!md) return { acik: 0, kapali: 0, maddeler: [] };
  let acik = 0, kapali = 0, asama = null;
  const maddeler = [];
  for (const line of md.split('\n')) {
    const h = /^##\s+(.+)$/.exec(line);
    if (h) { asama = (/\bA?(\d{2})\b/.exec(h[1]) || [])[1] || null; continue; }
    // TEK SATIR sözleşmesi (İLANLI muafiyet): devam satırları maddeye girmez — çok satırlı madde
    // gövdesi taşımak listeyi belgeye çevirirdi; başlık yeterli, detay plan dosyasındadır.
    const m = /^\s*[-*]\s*\[( |x|X)\]\s*(.*)$/.exec(line);
    if (!m) continue;
    if (m[1] === ' ') {
      acik++;
      const metin = m[2].trim();
      maddeler.push({ metin, etiket: (MADDE_ETIKET_RE.exec(metin) || [])[1] || null, asama });
    } else kapali++;
  }
  return { acik, kapali, maddeler };
}

function asamaDosyasi(vdir, no) {
  const n = String(no).padStart(2, '0');
  try {
    return fs.readdirSync(vdir).find((f) => f.startsWith(`asama-${n}`) && f.endsWith('.md')) || null;
  } catch { return null; }
}

function frontmatterBlok(raw) {
  // Dosyanın başındaki YAML frontmatter'ının GÖVDESİNİ döndürür (---'ler hariç); yoksa null.
  // Frontmatter YENİ desendir (bugün hiçbir aşama dosyasında yok) — yokluk sessizce null'dur,
  // BYTE-AYNI şartı bu koşulluluğa dayanır. YAML kütüphanesi YOK: node builtins sözleşmesi korunur.
  if (!raw) return null;
  const lines = raw.split('\n');
  if (lines[0] !== '---') return null;                 // `---\n` ile başlamıyor → frontmatter yok
  for (let i = 1; i < lines.length; i++)
    if (lines[i] === '---') return lines.slice(1, i).join('\n');
  return null;                                          // açıldı ama kapanmadı → frontmatter yok
}

function parseKosumFromBlok(blok) {
  // Şema İKİ değerlidir (kapalı): `tek-ajan` · `workflow:<ref>` (`<ref>` = [a-z0-9-]+).
  // Dönüş: null (beyan yok) · {tur:'tek-ajan'} · {tur:'workflow', sablon} · {gecersiz:<ham>}.
  if (blok == null) return null;
  const m = blok.match(/^kosum:\s*(.+)$/m);
  if (!m) return null;
  const val = m[1].replace(/\s+#.*$/, '').trim();       // satır-sonu `#` yorumunu kırp
  if (val === 'tek-ajan') return { tur: 'tek-ajan' };
  const wm = val.match(/^workflow:\s*([a-z0-9-]+)$/);
  if (wm) return { tur: 'workflow', sablon: wm[1] };
  return { gecersiz: val };
}

// `getirir:` — kapalı-şema YAPISAL VAAT bloğu (aşama 31). `parseKosumFromBlok` ile AYNI
// ilkellik: satır tarayıcı, YAML kütüphanesi YOK (node builtins sözleşmesi korunur).
// Dönüş: null (beyan yok) · {yok:true} · {katman?,dugum?,kenar?,kaldir?,dokunur?} (YALNIZ dolu
// anahtarlar — beyansızlıkla aynı baytları üretmek için boş dizi YAZILMAZ) · {gecersiz:[sebep…]}.
function parseGetirirFromBlok(blok) {
  if (blok == null) return null;
  const satirlar = blok.split('\n');
  const bas = satirlar.findIndex((l) => /^getirir:/.test(l));
  if (bas < 0) return null;                              // beyan yok — SESSİZ (advisory'nin işi)
  const sebepler = [];
  const basDeger = satirlar[bas].slice('getirir:'.length).replace(/\s+#.*$/, '').trim();

  // Madde satırları: blok, madde desenine uymayan İLK satırda biter.
  const MADDE_RE = /^[ \t]+- ([a-z][a-z0-9-]*): (.*)$/;
  const maddeler = [];
  let i = bas + 1;
  for (; i < satirlar.length; i++) {
    const m = satirlar[i].match(MADDE_RE);
    if (!m) break;
    maddeler.push({ anahtar: m[1], deger: m[2].replace(/\s+#.*$/, '').trim(), ham: satirlar[i] });
  }
  // Blok BİTTİKTEN sonra frontmatter'da girintili-ama-madde-olmayan boş-olmayan satır kalırsa
  // GEÇERSİZ: `  - dugm: x` gibi bir yazım hatası aksi hâlde SESSİZCE YUTULURDU.
  for (let j = i; j < satirlar.length; j++)
    if (satirlar[j].trim() && /^[ \t]/.test(satirlar[j]))
      sebepler.push(`madde olmayan girintili satır "${satirlar[j].trim()}"`);

  if (basDeger === 'yok') {
    if (maddeler.length) sebepler.push(`"getirir: yok" altına madde yazılamaz (${maddeler.length} madde)`);
    return sebepler.length ? { gecersiz: sebepler } : { yok: true };
  }
  if (basDeger) sebepler.push(`"getirir:" değeri yalnız "yok" olabilir ("${basDeger}" yazılmış)`);
  else if (!maddeler.length) sebepler.push('boş blok — madde yaz ya da "getirir: yok" beyan et');

  // Uç doğrulayıcı: kenar/kaldir-kenar ortak grameri  TIP UC -> UC
  const kenarCoz = (deger, nereden) => {
    const m = deger.match(/^([a-z][a-z0-9-]*)\s+(\S+)\s*->\s*(\S+)$/);
    if (!m) { sebepler.push(`${nereden} biçimi "<tip> <uc> -> <uc>" değil: "${deger}"`); return null; }
    const [, tip, from, to] = m;
    if (!KENAR_TIPLERI.includes(tip)) sebepler.push(`${nereden}: geçersiz kenar tipi "${tip}"`);
    if (!G_UC_RE.test(from)) sebepler.push(`${nereden}: geçersiz uç "${from}"`);
    if (!G_UC_RE.test(to)) sebepler.push(`${nereden}: geçersiz uç "${to}"`);
    return { tip, from, to };
  };

  const out = {};
  const ekle = (k, v) => { (out[k] = out[k] || []).push(v); };
  const gorulen = new Set();
  for (const { anahtar, deger } of maddeler) {
    if (!GETIRIR_ANAHTARLAR.includes(anahtar)) { sebepler.push(`bilinmeyen anahtar "${anahtar}"`); continue; }
    if (!deger) { sebepler.push(`"${anahtar}" değeri boş`); continue; }
    // BİREBİR tekrar GEÇERSİZ (K3) — kopyala-yapıştır hatası sessiz yutulmaz. Normalizasyon
    // yalnız kenarda anlamlıdır (boşluklar tek boşluğa iner); ötekilerde değer birebirdir.
    const norm = `${anahtar}: ${deger.replace(/\s+/g, ' ')}`;
    if (gorulen.has(norm)) { sebepler.push(`tekrarlanan madde "${anahtar}: ${deger}"`); continue; }
    gorulen.add(norm);

    if (anahtar === 'katman') {
      if (!G_AD_RE.test(deger)) sebepler.push(`geçersiz katman adı "${deger}" (şema: ${G_AD})`);
      else ekle('katman', deger);
    } else if (anahtar === 'dugum' || anahtar === 'dokunur') {
      // Joker KABUL EDİLMEZ — somut düğüm ister (K7).
      if (!G_ID_RE.test(deger)) sebepler.push(`geçersiz ${anahtar} id "${deger}"${deger.includes('*') ? ' (joker yalnız kenar ucunda)' : ' (şema: ad:yol)'}`);
      else ekle(anahtar, deger);
    } else if (anahtar === 'kenar') {
      const k = kenarCoz(deger, 'kenar');
      if (k) ekle('kenar', k);
    } else if (anahtar === 'kaldir') {
      const m = deger.match(/^(katman|dugum|kenar)\s+(.+)$/);
      if (!m) { sebepler.push(`kaldir biçimi "katman <ad>|dugum <id>|kenar <tip> <uc> -> <uc>" değil: "${deger}"`); continue; }
      const [, tur, kalan] = m;
      if (tur === 'katman') {
        if (!G_AD_RE.test(kalan)) sebepler.push(`kaldir katman: geçersiz ad "${kalan}"`);
        else ekle('kaldir', { tur: 'katman', ad: kalan });
      } else if (tur === 'dugum') {
        if (!G_ID_RE.test(kalan)) sebepler.push(`kaldir dugum: geçersiz id "${kalan}"`);
        else ekle('kaldir', { tur: 'dugum', id: kalan });
      } else {
        const k = kenarCoz(kalan, 'kaldir kenar');
        if (k) ekle('kaldir', { tur: 'kenar', ...k });
      }
    }
  }
  // GEÇERSİZLİK BÜTÜNCÜLDÜR: tek bir bozuk madde bloğun tamamını geçersiz kılar — yarım
  // ayrıştırılmış bir vaat, 32'ye EKSİK harita verirdi (yanlış beyan beyansızlıktan beterdir).
  if (sebepler.length) return { gecersiz: sebepler };
  return out;
}

function parseBeyanlar(vdir, no) {
  // Dosya İKİ KEZ OKUNMAZ: frontmatter bloğu bir kez çıkarılır, `kosum`+`getirir` birlikte döner.
  // agac.mjs değerleri yalnız PARSE eder, hiçbir yerde ÇIKARSAMAZ (R1: karar plan yazımında
  // verilir; koşum anında LLM/heuristic karar vermez).
  const f = asamaDosyasi(vdir, no);
  if (!f) return { kosum: null, getirir: null };
  const blok = frontmatterBlok(readIf(path.join(vdir, f)));
  return { kosum: parseKosumFromBlok(blok), getirir: parseGetirirFromBlok(blok) };
}

// ---------- model ----------

function buildPlan(slug) {
  const v = highestVersion(slug);
  const vdir = path.join(PLANS, slug, `v${v}`);
  const master = readIf(path.join(vdir, 'MASTER.md'));
  const state = readIf(path.join(vdir, 'STATE.md'));
  const checklist = readIf(path.join(vdir, 'CHECKLIST.md'));
  const { title, kategori, ust, kunye } = parseMaster(master);
  const asamalar = parseStateTable(state);
  // kosum: her aşama için frontmatter beyanı (no → yapı). Aşama dosyası zaten asamaDosyasi()
  // ile bulunuyor — yeni dosya-bulma mantığı icat edilmez. Beyansız aşama haritaya GİRMEZ
  // (yokluk = tek-ajan; anahtar hiç yok → hazir[] baytları bugünküyle aynı kalır).
  // getirir: aynı frontmatter bloğundan (aşama 31) — dosya İKİ KEZ OKUNMAZ. Beyansız aşama
  // getirirMap'e de GİRMEZ (aynı BYTE-AYNI gerekçesi).
  const kosumMap = {};
  const getirirMap = {};
  for (const a of asamalar) {
    const b = parseBeyanlar(vdir, a.no);
    if (b.kosum) kosumMap[a.no] = b.kosum;
    if (b.getirir) getirirMap[a.no] = b.getirir;
  }
  const sonTur = parseSonTur(state);
  const cl = parseChecklist(checklist);
  const kapaliN = asamalar.filter((a) => a.durum === 'KAPALI').length;
  const durum = !asamalar.length ? '?' :
    asamalar.every((a) => a.durum === 'KAPALI') ? 'KAPALI' :
    asamalar.some((a) => a.durum === 'BLOKE') ? 'BLOKE' :
    asamalar.some((a) => a.durum === 'SÜRÜYOR') || kapaliN > 0 ? 'SÜRÜYOR' : 'AÇIK';
  // siradaki/goal/hazir BURADA hesaplanmaz — çapraz-plan bağımlılık çözümü tüm planları ister;
  // tek çözüm yeri resolveGraph (Ders 4: değer kopyalanmaz, çözümlenir).
  return { slug, v, title: title || slug, kategori, ust, kunye, durum, asamalar, kapaliN, sonTur, checklist: cl,
    masterDeps: parseMasterDeps(master), kosumMap, getirirMap,
    depli: asamalar.some((a) => a.bagimli !== null),
    eksik: { master: !master, state: !state, checklist: !checklist } };
}

function goalCmd(slug, v, no) {
  const f = asamaDosyasi(path.join(PLANS, slug, `v${v}`), no);
  return f ? `/goal plans/${slug}/v${v}/${f} planını uygula; bitince aynı klasördeki STATE.md ve CHECKLIST.md'yi güncelle; kanıt yollarını STATE.md'ye yaz` : null;
}

// ---------- graf çözümü (ready-set + döngü/kopuk-bağ denetimi) ----------

function resolveGraph(model) {
  const byPlan = new Map(model.plans.map((p) => [p.slug, p]));
  const bulgular = [];
  const stageOf = (slug, no) => byPlan.get(slug)?.asamalar.find((a) => a.no === no) || null;
  const kapali = (p, d) => { const h = stageOf(d.plan || p.slug, d.no); return !!h && h.durum === 'KAPALI'; };

  for (const p of model.plans) {
    // kopuk bağ / sözdizimi denetimi
    for (const a of p.asamalar) for (const grup of a.bagimli || []) for (const d of grup) {
      if (d.gecersiz) { bulgular.push(`GEÇERSİZ BAĞIMLILIK: ${p.slug} ${a.no} → "${d.no}" (sözdizimi: NN · NN/NN · slug:NN · —)`); continue; }
      const hp = d.plan || p.slug;
      if (!byPlan.has(hp)) bulgular.push(`KOPUK BAĞ: ${p.slug} ${a.no} → ${hp}:${d.no} — plan yok`);
      else if (!stageOf(hp, d.no)) bulgular.push(`KOPUK BAĞ: ${p.slug} ${a.no} → ${hp}:${d.no} — aşama yok`);
    }
    const tatmin = (a) => (a.bagimli || []).every((grup) => grup.some((d) => !d.gecersiz && kapali(p, d)));
    // kosum beyanını hazir[] girdisine taşı — YALNIZ şemalı yapı ({tur,sablon?}) taşınır; gecersiz
    // beyan hazir[]'a GİRMEZ (o governance bulgusudur, gate FAIL eder). Beyan yoksa anahtar HİÇ
    // eklenmez (spread ile) → 104 frontmatter'sız aşamada hazir[] baytları bugünküyle AYNI kalır.
    const hazirKosum = (no) => { const k = p.kosumMap?.[no]; return k && k.tur ? { kosum: k } : {}; };
    // `dokunur` PROJEKSİYONU (AIDE S temel:05 · orkestrator-dagitim:01 ile aynı sözleşme):
    // aşamanın DOKUNACAĞI kaynaklar hazır-küme girdisine taşınır — çakışma eleği ve harita
    // hat ataması bunu okur. `kosum` emsaliyle birebir: YALNIZ dolu beyan taşınır, beyansız
    // aşamada anahtar HİÇ eklenmez (spread) → beyansız aşamalarda hazir[] baytları AYNI kalır.
    // `dugum` TAŞINMAZ (aşamanın ÜRETECEĞİ dosyadır; eleğe girerse aşama kendi çıktısıyla
    // çakışır sanılır) — İLANLI sınır.
    const hazirDokunur = (no) => { const d = p.getirirMap?.[no]?.dokunur; return d?.length ? { dokunur: d } : {}; };
    if (p.depli) {
      p.baslangiclar = p.asamalar.filter((a) => !(a.bagimli || []).length).map((a) => a.no);
      p.hazir = p.asamalar.filter((a) => a.durum === 'AÇIK' && tatmin(a))
        .map((a) => ({ no: a.no, ad: a.ad, goal: goalCmd(p.slug, p.v, a.no), ...hazirKosum(a.no), ...hazirDokunur(a.no) }));
      p.bekleyen = p.asamalar.filter((a) => a.durum === 'AÇIK' && !tatmin(a))
        .map((a) => ({
          no: a.no, ad: a.ad,
          bekledigi: (a.bagimli || []).filter((grup) => !grup.some((d) => !d.gecersiz && kapali(p, d)))
            .map((grup) => grup.map((d) => (d.plan ? d.plan + ':' : '') + d.no).join('/')),
        }));
    } else {
      // lineer-legacy: eski davranış birebir — hazır küme TEK elemanlıdır (ilk AÇIK); sırasız
      // paralel tüketim ancak bağımlılık İLAN edilmiş planda meşrudur.
      const ilkAcik = p.asamalar.find((a) => a.durum === 'AÇIK');
      p.baslangiclar = p.asamalar.length ? [p.asamalar[0].no] : [];
      p.hazir = ilkAcik ? [{ no: ilkAcik.no, ad: ilkAcik.ad, goal: goalCmd(p.slug, p.v, ilkAcik.no), ...hazirKosum(ilkAcik.no), ...hazirDokunur(ilkAcik.no) }] : [];
      p.bekleyen = [];
    }
    const suren = p.asamalar.find((a) => a.durum === 'SÜRÜYOR');
    // siradaki: DAG aktifken ready-set'in başı; PASİFKEN eski lineer davranış birebir
    // (ilk AÇIK — bağımlılığa bakılmaz) → mevcut /goal-planla-kos akışları etkilenmez.
    const ilkAcikHam = p.asamalar.find((a) => a.durum === 'AÇIK');
    p.siradaki = suren ? { no: suren.no, ad: suren.ad, durum: 'SÜRÜYOR' }
      : DAG_AKTIF
        ? (p.hazir[0] ? { no: p.hazir[0].no, ad: p.hazir[0].ad, durum: 'AÇIK' } : null)
        : (ilkAcikHam ? { no: ilkAcikHam.no, ad: ilkAcikHam.ad, durum: 'AÇIK' } : null);
    p.goal = p.siradaki ? goalCmd(p.slug, p.v, p.siradaki.no) : null;
    // MASTER ↔ STATE bağımlılık uyumu (ikisi de taşıyorsa; STATE tohumsuzsa gate DEĞİL, --durum ipucu)
    if (p.depli && p.masterDeps) {
      for (const a of p.asamalar) {
        if (a.bagimli === null || !p.masterDeps.has(a.no)) continue;
        const mSet = new Set(p.masterDeps.get(a.no).flat().map((d) => (d.plan || p.slug) + ':' + d.no));
        const sSet = new Set((a.bagimli || []).flat().filter((d) => !d.gecersiz).map((d) => (d.plan || p.slug) + ':' + d.no));
        const eksik = [...mSet].filter((x) => !sSet.has(x));
        const fazla = [...sSet].filter((x) => !mSet.has(x));
        if (eksik.length || fazla.length)
          bulgular.push(`BAĞIMLILIK UYUMSUZ: ${p.slug} ${a.no} — MASTER{${[...mSet].join(' ')}} ≠ STATE{${[...sSet].join(' ')}}`);
      }
    }
  }

  // döngü tespiti (DFS; VEYA alternatifi de kenar sayılır — muhafazakâr)
  const renk = new Map(); const yol = [];
  const komsu = (key) => {
    const [slug, no] = key.split(':');
    const a = stageOf(slug, no); if (!a) return [];
    return (a.bagimli || []).flat().filter((d) => !d.gecersiz).map((d) => (d.plan || slug) + ':' + d.no);
  };
  const dfs = (key) => {
    renk.set(key, 1); yol.push(key);
    for (const n of komsu(key)) {
      if (renk.get(n) === 1) { bulgular.push(`DÖNGÜ: ${[...yol.slice(yol.indexOf(n)), n].join(' → ')}`); continue; }
      if (!renk.has(n)) dfs(n);
    }
    yol.pop(); renk.set(key, 2);
  };
  for (const p of model.plans) for (const a of p.asamalar) {
    const key = p.slug + ':' + a.no;
    if (!renk.has(key)) dfs(key);
  }
  model.grafBulgular = bulgular;
}

function loadLegacy() {
  const raw = readIf(LEGACY);
  if (!raw) return { entries: [], err: null };
  try {
    const j = JSON.parse(raw);
    const entries = (Array.isArray(j) ? j : j.entries || []).map((e) => ({
      ad: e.ad || path.basename(e.path || '?'),
      path: e.path, tur: e.tur || 'plan-parçası', not: e.not || '',
      var: e.path ? fs.existsSync(path.join(ROOT, e.path)) : false,
    }));
    return { entries, err: null };
  } catch (e) { return { entries: [], err: `legacy.json parse hatası: ${e.message}` }; }
}

function computeDamga(slugs) {
  const h = crypto.createHash('sha1');
  for (const slug of slugs) {
    const v = highestVersion(slug);
    const vdir = path.join(PLANS, slug, `v${v}`);
    // HUKUM.md damgaya GİRER (2026-07-27): genel TODO'nun kaynaklarından biri — hüküm değişip
    // türev koşulmazsa TODO.md bayatlar ve gate bunu görmezdi.
    for (const f of ['MASTER.md', 'STATE.md', 'CHECKLIST.md', 'HUKUM.md']) {
      const c = readIf(path.join(vdir, f));
      h.update(`${slug}/v${v}/${f}\0${c || ''}\0`);
    }
    // KOŞULLU damga girdisi: bir aşama dosyası `kosum:` YA DA `getirir:` BEYAN ediyorsa frontmatter
    // bloğu damgaya girer (beyan değişince gate BAYAT INDEX FAIL eder — INDEX.json artık `getirir`
    // özetini taşıyor, beyan değişip türev koşulmazsa projeksiyon YALANLAŞIRDI). Beyan YOKKEN hiç
    // girdi eklenmez → beyansız projede damga bayt-aynı kalır (BYTE-AYNI şartının damga ayağı).
    // Sıralı okuma: readdir determinist değil.
    let asamaDosyalar; try { asamaDosyalar = fs.readdirSync(vdir); } catch { asamaDosyalar = []; }
    for (const f of asamaDosyalar.filter((x) => /^asama-.*\.md$/.test(x)).sort()) {
      const blok = frontmatterBlok(readIf(path.join(vdir, f)));
      if (blok != null && (/^kosum:\s*.+$/m.test(blok) || /^getirir:/m.test(blok)))
        h.update(`${slug}/v${v}/${f}#fm\0${blok}\0`);
    }
  }
  h.update('legacy\0' + (readIf(LEGACY) || '') + '\0');
  // TODO-ELLE.md KAYNAKTIR → damgaya girer (değişip türev koşulmazsa gate BAYAT der).
  // TODO.md TÜREVDİR → damgaya GİRMEZ; bayatlığı kendi damga satırıyla ölçülür (INDEX.json emsali).
  h.update('todo-elle\0' + (readIf(TODO_ELLE) || '') + '\0');
  return h.digest('hex').slice(0, 12);
}

function buildModel() {
  const slugs = listPlanSlugs();
  const plans = slugs.map(buildPlan);
  const legacy = loadLegacy();
  const model = { root: ROOT, plans, legacy, orphans: orphanDirs(), damga: computeDamga(slugs) };
  resolveGraph(model);
  // OTURUM tablosu — buildTodo'dan ÖNCE: `kaynakOturum` bunu tüketir (yeniden hesaplanmaz).
  // Plan tarafını SADELEŞTİRİP veririz: oturum-lib plan dosyalarını kendi OKUMAZ (tek okuyucu
  // burasıdır), yalnız künyenin `oturum` alanına bakar.
  model.oturum = oturumTablosu(PLANS, plans.map((p) => ({
    slug: p.slug, v: p.v, durum: p.durum, oturum: p.kunye?.oturum ?? null,
    puan: p.kunye?.puan ?? null, oncelik: p.kunye?.oncelik ?? null,
  })));
  model.todo = buildTodo(model);   // resolveGraph SONRASI: plan durumları/sırası hazır olmalı
  return model;
}

// ---------- GENEL TODO (melez: TODO-ELLE.md kaynak · TODO.md + INDEX.json→todo türev) ----------

const TODO_ELLE_TOHUM = `# GENEL TODO — elle kaynak

> Bu dosyanın yazarı SENSİN (insan · PM · işi kapatan session). \`agac.mjs\` buraya YALNIZ bir kez,
> dosya hiç yokken tohum atar; bundan sonra ASLA dokunmaz.
>
> **Türev \`TODO.md\`'ye madde YAZMA** — o dosyayı agac.mjs üretir, yazdığın kaybolur. Elle madde
> BURAYA yazılır.
>
> Biçim: \`- [ ] <metin> <!-- td:elle/<slug> -->\`
> - Yalnız \`[ ]\` maddeler türev listeye girer; \`[x]\` düşer (arşivi git tutar).
> - Çıpa bu dosyada BENZERSİZDİR (çift çıpa gate'i FAIL eder — yanlış kimlik, kimliksizlikten beter).
> - Fenced (\\\`\\\`\\\`) blok içindeki örnek çıpalar sayılmaz.
> - Bir planın bu maddeyi kapattığını beyan etmek için o planın MASTER künye bloğuna
>   \`> Kapatır: td:elle/<slug>\` satırını ekle; ters yönü (madde→plan) agac.mjs TÜRETİR.

## Maddeler

`;

function seedTodoElle() {
  // Tohum YALNIZ dosya hiç yokken atılır (filing "başlat" emsali: ilk yazım kurulum sayılır,
  // sapma değil). Var olan dosyaya asla dokunulmaz — tek yazar kuralı.
  if (fs.existsSync(TODO_ELLE)) return false;
  try { fs.writeFileSync(TODO_ELLE, TODO_ELLE_TOHUM); return true; } catch { return false; }
}

function fencedSiz(md) {
  // ``` blokları içini boşalt (satır sayısı korunur). Örnek çıpa çıpa SAYILMAZ — analiz.mjs'in
  // (vizyon-damit) aynı sözleşmesi; 4 satırlık yardımcı skill'ler arası import'a değmez.
  return String(md || '').replace(/```[\s\S]*?```/g, (b) => b.replace(/[^\n]/g, ' '));
}

function parseTodoElle(raw) {
  // Dönüş: { maddeler[{metin,ref|null}], cift[ref], cipasiz[metin] }
  const maddeler = []; const gorulen = new Map(); const cift = []; const cipasiz = [];
  for (const line of fencedSiz(raw).split('\n')) {
    const m = /^\s*[-*]\s*\[( |x|X)\]\s*(.*)$/.exec(line);
    if (!m || m[1] !== ' ') continue;                    // [x] türev listeye GİRMEZ
    const govde = m[2];
    const c = /<!--\s*(td:elle\/[a-z0-9-]+)\s*-->/.exec(govde);
    const metin = govde.replace(/<!--[\s\S]*?-->/g, '').trim();
    if (!metin) continue;
    if (!c) { cipasiz.push(metin); maddeler.push({ metin, ref: null }); continue; }
    if (gorulen.has(c[1])) cift.push(c[1]); else gorulen.set(c[1], metin);
    maddeler.push({ metin, ref: c[1] });
  }
  return { maddeler, cift, cipasiz };
}

const sha6 = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 6);

// KAYNAK SÖZLEŞMESİ (uzatma noktası): her kaynak `(ctx) => madde[]` SAF fonksiyondur.
// ctx = { model, elle }. fs'e yalnız readIf ile dokunur, YAZMAZ, SIRALAMAZ (sıralama tek yerde:
// buildTodo). Yeni kaynak eklemek = bu diziye tek fonksiyon — başka hiçbir yer değişmez.
function kaynakChk(ctx) {
  const out = [];
  for (const p of ctx.model.plans) {
    if (p.durum === 'KAPALI') continue;                  // kapalı plan sıraya girmez (kunyeMuaf emsali)
    const sayac = new Map();
    for (const m of p.checklist.maddeler || []) {
      const anahtar = m.etiket ? trKey(m.etiket).replace(/–/g, '-') : 'h' + sha6(trKey(m.metin));
      const n = (sayac.get(anahtar) || 0) + 1; sayac.set(anahtar, n);
      const ref = `td:chk/${p.slug}/${anahtar}${n > 1 ? `-${n}` : ''}`;
      out.push({ ref, tur: 'chk', metin: m.metin, plan: p.slug, asama: m.asama, kapatan: [], kapatAdayi: false, onar: null });
    }
  }
  return out;
}

function kaynakElle(ctx) {
  return ctx.elle.maddeler.map((m) => ({
    ref: m.ref || `td:elle/h${sha6(m.metin)}`,
    tur: 'elle', metin: m.metin, plan: null, asama: null, kapatan: [], kapatAdayi: false,
    onar: m.ref ? null : `TODO-ELLE.md'de bu maddeye çıpa ekle: <!-- td:elle/<slug> --> (çıpasız ref GÜVENİLMEZ: metin değişince değişir)`,
  }));
}

function kaynakHukum(ctx) {
  // Hakem hükmü EKSİK|STUCK ise plan başına TEK madde. Biçim `packages/rotaci/lib/fiili.mjs`
  // ile TEK KAYNAKTAN türer (hakem.md sözleşmesi) — sapamazlar.
  const out = [];
  for (const p of ctx.model.plans) {
    const t = readIf(path.join(PLANS, p.slug, `v${p.v}`, 'HUKUM.md'));
    if (!t) continue;
    const hepsi = [...t.matchAll(/^##\s+(\S+)\s+—\s+hüküm:\s*(TAM|EKSİK|STUCK)\s*$/gim)];
    if (!hepsi.length) continue;
    const son = hepsi[hepsi.length - 1];
    if (son[2] === 'TAM') continue;
    const g = /\*\*Gerekçe:\*\*\s*(.+)/i.exec(t.slice(son.index));
    out.push({
      ref: `td:hukum/${p.slug}`, tur: 'hukum',
      metin: `${p.slug} v${p.v} — ${son[2]}${g ? ': ' + g[1].trim().slice(0, 200) : ''}`,
      plan: p.slug, asama: null, kapatan: [], kapatAdayi: false,
      onar: `hükmü kapat: /plan-kur revize ${p.slug} (EKSİK) ya da insan eskalasyonu (STUCK)`,
    });
  }
  return out;
}

function kaynakKunye(ctx) {
  // kunyeBulgular() YENİDEN HESAPLANMAZ — tek hesap yeri orası (Ders 4: değer kopyalanmaz).
  return kunyeBulgular(ctx.model).map((e) => ({
    ref: `td:kunye/${e.slug}`, tur: 'kunye',
    metin: `${e.slug} v${e.v} — künye eksik: ${e.eksik.join(', ')}`,
    plan: e.slug, asama: null, kapatan: [], kapatAdayi: false, onar: e.onar,
  }));
}

function kaynakOturum(ctx) {
  // OTURUM kaynağı (2026-07-27) — YALNIZ hükmü EKSİK oturumlar: kapanmış bir oturumun sarkık işi.
  // NEDEN OTURUM BAŞINA TEK MADDE: kullanıcı kararı "todoların hepsi proje düzeyine kopyalanmayabilir,
  // ama planların hepsi roadmap'e işlemelidir". Oturum hedeflerinin TAMAMINI TODO'ya dökmek o kararı
  // ihlal ederdi (oturum-düzeyi iş proje-düzeyi listeyi boğardı); tek satırlık ALARM ise sarkık işi
  // GÖRÜNÜR kılar ve terfi yolunu (`→ td:elle/<slug>`) `onar:` ile söyler. `kunye` advisory emsali.
  // SÜRÜYOR oturum madde ÜRETMEZ: canlı oturumun açık hedefi borç değil, işin kendisidir.
  return (ctx.model.oturum?.oturumlar || []).filter((o) => o.hukum === 'EKSİK').map((o) => ({
    ref: `td:oturum/${o.ref.replace(/^ot:/, '').replace('/', '-')}`, tur: 'oturum',
    metin: `oturum ${o.ref} EKSİK — ${o.hedefAcik.length} açık hedef${o.planAcik.length ? ` · ${o.planAcik.length} açık plan (${o.planAcik.map((p) => p.slug).join(', ')})` : ''}`,
    plan: o.planAcik[0]?.slug || null, asama: null, kapatan: [], kapatAdayi: false,
    onar: `hedefleri kapat, ya da proje düzeyine terfi ettir: plans/TODO-ELLE.md'ye madde yaz + plans/oturumlar/${refDosyaAdi(o.ref)} içinde hedefe "→ td:elle/<slug>" ekle`,
  }));
}

const TODO_KAYNAKLARI = [kaynakElle, kaynakHukum, kaynakChk, kaynakKunye, kaynakOturum];

function buildTodo(model) {
  const elle = parseTodoElle(readIf(TODO_ELLE) || '');
  const ctx = { model, elle };
  const maddeler = TODO_KAYNAKLARI.flatMap((f) => f(ctx));
  const byRef = new Map(maddeler.map((m) => [m.ref, m]));

  // Çift yön: plan `Kapatır:` → maddeye `kapatan[]`. Çözülemeyen ref ADVISORY (gate FAIL DEĞİL);
  // kapatan planı KAPALI olan sarkık ref MUAF (doğal yaşam döngüsü — alarm üretmek alarmı köreltir).
  const cozulemeyen = []; let sarkikMuaf = 0;
  for (const p of model.plans) {
    for (const ref of p.kunye?.kapatir || []) {
      const m = byRef.get(ref);
      if (m) { m.kapatan.push(p.slug); continue; }
      if (p.durum === 'KAPALI') { sarkikMuaf++; continue; }
      cozulemeyen.push({ slug: p.slug, ref, onar: `plans/${p.slug}/v${p.v}/MASTER.md "Kapatır:" satırından düşür ya da ref'i düzelt (geçerli ref'ler: agac.mjs --todo --json)` });
    }
  }
  const kapaliMi = new Map(model.plans.map((p) => [p.slug, p.durum === 'KAPALI']));
  for (const m of maddeler) {
    if (m.tur !== 'elle' || !m.kapatan.length) continue;
    if (m.kapatan.every((s) => kapaliMi.get(s))) {
      m.kapatAdayi = true;
      m.onar = m.onar || `kapatan plan(lar) KAPALI — TODO-ELLE.md'de bu maddeyi [x] işaretle`;
    }
  }

  // Sıra DETERMİNİSTİK ve TEK YERDE: elle-plansız → elle-planlı → hukum → chk (künye sırasında,
  // plan içinde dosya sırası) → kunye.
  const planSira = new Map([...model.plans].sort(kunyeSirala).map((p, i) => [p.slug, i]));
  const grup = (m) => m.tur === 'elle' ? (m.kapatan.length ? 1 : 0) : m.tur === 'hukum' ? 2 : m.tur === 'chk' ? 3 : 4;
  const sirali = maddeler.map((m, i) => ({ m, i })).sort((a, b) =>
    (grup(a.m) - grup(b.m))
    || ((planSira.get(a.m.plan) ?? 99) - (planSira.get(b.m.plan) ?? 99))
    || (a.i - b.i)).map((x) => x.m);

  const kaynakSayim = { chk: 0, elle: 0, hukum: 0, kunye: 0, oturum: 0 };
  for (const m of sirali) kaynakSayim[m.tur]++;
  return {
    acik: sirali.length, kaynak: kaynakSayim, muaf: TODO_MUAF, maddeler: sirali,
    bulgular: { cift: elle.cift, cipasiz: elle.cipasiz, cozulemeyen, sarkikMuaf },
  };
}

function renderTodoMd(model) {
  const t = model.todo;
  const L = [];
  const plansiz = t.maddeler.filter((m) => m.tur === 'elle' && !m.kapatan.length);
  const elleBagli = t.maddeler.filter((m) => m.tur === 'elle' && m.kapatan.length);
  const hukum = t.maddeler.filter((m) => m.tur === 'hukum');
  const chk = t.maddeler.filter((m) => m.tur === 'chk');
  const kunye = t.maddeler.filter((m) => m.tur === 'kunye');
  const oturum = t.maddeler.filter((m) => m.tur === 'oturum');

  L.push(`# GENEL TODO — ${path.basename(model.root)}`);
  L.push('');
  L.push('> **TÜREV — elle düzenlenmez.** Tek yazar `agac.mjs` (motor · deterministik · 0 token).');
  L.push('> Elle madde buraya değil **`TODO-ELLE.md`**\'ye yazılır.');
  L.push(`> Damga: \`${model.damga}\` · Kaynak: CHECKLIST(açık) · TODO-ELLE.md · HUKUM.md(EKSİK/STUCK) · künye-eksikleri · sarkık-oturum`);
  L.push(`> İLANLI MUAF (bu listeye GİRMEZ, her birinin kendi kanalı var): ${t.muaf.join(' · ')}`);
  L.push('');
  L.push(`**${t.acik} açık madde** · plansız: ${plansiz.length} · chk: ${t.kaynak.chk} · elle: ${t.kaynak.elle} · hüküm: ${t.kaynak.hukum} · künye: ${t.kaynak.kunye} · oturum: ${t.kaynak.oturum}`);
  L.push('');

  const blok = (baslik, list, ciz) => {
    L.push(`## ${baslik} (${list.length})`);
    L.push('');
    if (!list.length) L.push('_yok_');
    else for (const m of list) L.push(ciz(m));
    L.push('');
  };
  const ref = (m) => ` \`${m.ref}\``;
  const onar = (m) => (m.onar ? `\n  - onar: ${m.onar}` : '');

  blok('Plansız maddeler — plan-üretim adayları', plansiz, (m) => `- [ ] **${m.metin}**${ref(m)}${onar(m)}`);
  blok('Plana bağlı elle maddeler', elleBagli, (m) =>
    `- [ ] ${m.metin}${ref(m)} ⟵ kapatır: ${m.kapatan.join(', ')}${m.kapatAdayi ? ' — **KAPAT ADAYI**' : ''}${onar(m)}`);
  blok('Hükümler — EKSİK/STUCK', hukum, (m) => `- [ ] ${m.metin}${ref(m)}${onar(m)}`);

  L.push(`## Plan checklist maddeleri (${chk.length}) — künye önceliği sırasında`);
  L.push('');
  if (!chk.length) L.push('_yok_');
  else {
    let sonPlan = null;
    for (const m of chk) {
      if (m.plan !== sonPlan) {
        sonPlan = m.plan;
        const p = model.plans.find((x) => x.slug === m.plan);
        L.push('');
        L.push(`### ${m.plan} v${p?.v ?? '?'}${p?.kunye?.oncelik != null ? ` · P${p.kunye.oncelik}` : ''}`);
      }
      L.push(`- [ ] ${m.asama ? `[${m.asama}] ` : ''}${m.metin}${ref(m)}`);
    }
  }
  L.push('');
  blok('Künye eksikleri — advisory', kunye, (m) => `- [ ] ${m.metin}${ref(m)}${onar(m)}`);
  // OTURUM sarkığı — oturum başına TEK satır (hedeflerin tamamı buraya DÖKÜLMEZ: oturum-düzeyi iş
  // proje-düzeyi listeye kopyalanmaz; tam liste `plans/OTURUMLAR.md` + global kılavuzdadır).
  blok('Sarkık oturum işi — advisory', oturum, (m) => `- [ ] ${m.metin}${ref(m)}${onar(m)}`);

  const b = t.bulgular;
  if (b.cift.length || b.cipasiz.length || b.cozulemeyen.length) {
    L.push('## Bulgular');
    L.push('');
    for (const c of b.cift) L.push(`- ✗ ÇİFT ÇIPA (gate FAIL): \`${c}\` — TODO-ELLE.md'de iki kez geçiyor`);
    for (const c of b.cipasiz) L.push(`- ⚠ ÇIPASIZ madde (advisory): "${c}" — onar: \`<!-- td:elle/<slug> -->\` ekle`);
    for (const c of b.cozulemeyen) L.push(`- ⚠ ÇÖZÜLEMEYEN KAPATIR (advisory): ${c.slug} → \`${c.ref}\`\n  - onar: ${c.onar}`);
    L.push('');
  }
  if (b.sarkikMuaf) L.push(`_MUAF: KAPALI planlardan ${b.sarkikMuaf} sarkık \`Kapatır\` ref'i — doğal yaşam döngüsü, alarm üretilmez._`);
  return L.join('\n') + '\n';
}

// ---------- governance ----------

function governance(model) {
  // DAG bulguları gate'i yalnız AKTİF moddayken kırar; pasif modda --denetle "pasif" listeler
  // (görselleştirme-modu mevcut akışların gate'ini kırmamalı — kullanıcı kararı 2026-07-16).
  const bulgular = [...(DAG_AKTIF ? model.grafBulgular || [] : [])];
  for (const p of model.plans) {
    if (p.eksik.master) bulgular.push(`EKSIK: plans/${p.slug}/v${p.v}/MASTER.md yok`);
    if (p.eksik.state) bulgular.push(`EKSIK: plans/${p.slug}/v${p.v}/STATE.md yok`);
    // GEÇERSİZ KÜNYE — VALFSİZ ve GATE KIRAR (GEÇERSİZ KOŞUM emsali): şema dışı değer ancak künye
    // YAZAN bir MASTER'da doğar; künyesiz legacy planlar bu bulguyu hiç üretmez → sıfır legacy etki.
    // Gerekçe: yanlış künye künyesizlikten beterdir — tüketici (Rotacı/PM) ona göre SIRALAR.
    for (const g of p.kunye?.gecersiz || [])
      bulgular.push(`GEÇERSİZ KÜNYE: plans/${p.slug} — ${g.alan}: "${g.deger}" (geçerli: ${
        (g.alan === 'Kritiklik' ? KRITIKLIK : g.alan === 'Aciliyet' ? ACILIYET : HACIM).join('|')})`);
    if (!p.kategori) bulgular.push(`KATEGORISIZ: plans/${p.slug} — MASTER.md üst bloğunda "Kategori:" yok (${KATEGORILER.join('|')})`);
    else if (!KATEGORILER.includes(p.kategori)) bulgular.push(`GEÇERSİZ KATEGORİ: plans/${p.slug} → "${p.kategori}" (geçerli: ${KATEGORILER.join('|')})`);
    if (p.ust && p.ust !== 'proje' && !model.plans.some((q) => q.slug === p.ust))
      bulgular.push(`KIRIK DAL: plans/${p.slug} → Üst: "${p.ust}" diye bir plan yok`);
    if (p.durum === 'KAPALI' && p.checklist.acik > 0)
      bulgular.push(`TUTARSIZ: plans/${p.slug} tüm aşamalar KAPALI ama CHECKLIST'te ${p.checklist.acik} açık madde`);
    // GEÇERSİZ KOŞUM — VALFSİZ (DAG_AKTIF'e bağlı DEĞİL): şemasız `kosum:` beyanı ancak alanı
    // KULLANAN yeni bir aşama dosyasında doğar; legacy/frontmatter'sız aşamalarda kosumMap boştur →
    // bu bulgu sıfır legacy etkiyle üretilir, o yüzden görselleştirme valfine bağlanmaz, gate'i kırar.
    for (const [no, k] of Object.entries(p.kosumMap || {}))
      if (k.gecersiz != null)
        bulgular.push(`GEÇERSİZ KOŞUM: ${p.slug} ${no} — "${k.gecersiz}" (şema: tek-ajan · workflow:<sablon-ref>)`);
    // GEÇERSİZ GETİRİR — VALFSİZ (GEÇERSİZ KOŞUM emsali, aynı gerekçe): bu bulgu ancak alanı
    // KULLANAN bir aşama dosyasında doğar; beyansız aşamalarda getirirMap boştur → SIFIR legacy
    // etki, o yüzden görselleştirme valfine bağlanmaz ve gate'i kırar. AŞAMA BAŞINA TEK bulgu:
    // sebepler `; ` ile birleşir (5 bozuk satır 5 alarm değildir — alarm sayısı gürültü olur).
    for (const [no, g] of Object.entries(p.getirirMap || {}))
      if (g.gecersiz)
        bulgular.push(`GEÇERSİZ GETİRİR: ${p.slug} ${no} — ${g.gecersiz.join('; ')} · ${GETIRIR_ONAR}`);
    // GEÇERSİZ KAPATIR — GATE KIRAR (GEÇERSİZ KÜNYE emsali): şema dışı ref ancak `Kapatır:` YAZAN
    // bir MASTER'da doğar; satırsız planlar bu bulguyu hiç üretmez → sıfır legacy etki. Gerekçe:
    // biçimsiz ref sessizce BAĞSIZ kalırdı ve plan "kapatıyorum" der, hiçbir madde kapanmazdı.
    // (Şemalı ama karşılıksız ref AYRI SINIFTIR: ADVISORY — bkz. buildTodo `cozulemeyen`.)
    for (const g of p.kunye?.kapatirGecersiz || [])
      bulgular.push(`GEÇERSİZ KAPATIR: plans/${p.slug} — "${g}" (şema: td:(chk|elle|hukum|kunye|oturum)/<yol>)`);
    // GEÇERSİZ OTURUM — GATE KIRAR (aynı emsal): biçimsiz `Oturum:` ref'i sessizce BAĞSIZ kalırdı;
    // plan "şu oturumdan doğdum" der, hiçbir oturum onu görmez ve "bu oturumu bitirdim mi?" sorusu
    // YANLIŞ cevaplanır. Beyansız plan bu bulguyu üretmez (ADVISORY'dir — bkz. oturumsuz[]).
    // GEÇERSİZ CAPABILITY — GATE KIRAR (GEÇERSİZ KAPATIR emsali): `Capability:` YAZAN plan
    // şemayı da tutturmalıdır; şema dışı çıpa mutabakat ölçümünde sessizce karşılıksız kalırdı.
    for (const g of p.kunye?.capabilityGecersiz || [])
      bulgular.push(`GEÇERSİZ CAPABILITY: plans/${p.slug} — "${g}" (şema: uy:<hedef>/<yetenek>)`);
    if (p.kunye?.oturumGecersiz)
      bulgular.push(`GEÇERSİZ OTURUM: plans/${p.slug} — "${p.kunye.oturumGecersiz}" (şema: ot:<YYYY-MM-DD>/<slug>)`);
  }
  // OTURUM DOSYASI bulguları — geçersiz çıpa/durum/uyuşmazlık. Tek ölçüm yeri oturum-lib.
  for (const o of model.oturum?.oturumlar || [])
    for (const g of o.gecersiz)
      bulgular.push(`GEÇERSİZ OTURUM DOSYASI: plans/oturumlar/${path.basename(o.dosya)} — ${g.alan}: "${g.deger}" (${g.neden})`);
  // ÇİFT ÇIPA — GATE KIRAR: aynı `td:elle/<slug>` iki maddede ise madde↔plan bağı hangisine
  // gideceğini bilemez. Yanlış kimlik, kimliksizlikten beterdir (künye emsali).
  for (const c of model.todo?.bulgular?.cift || [])
    bulgular.push(`GEÇERSİZ TODO-ELLE: çift çıpa "${c}" — plans/TODO-ELLE.md'de iki kez geçiyor`);
  // proje planı tektir: rezerve slug 'proje' + kategori:proje olan başka plan = ihlal
  const projePlanlari = model.plans.filter((p) => p.slug === 'proje' || p.kategori === 'proje');
  if (projePlanlari.length > 1)
    bulgular.push(`PROJE PLANI TEK OLMALI: ${projePlanlari.map((p) => p.slug).join(', ')} — ikincisi revizyona yönlendirilmeli (/plan-kur revize proje)`);
  const legacyDeclared = (name) => model.legacy.entries.some((e) =>
    e.path === `plans/${name}` || String(e.path || '').startsWith(`plans/${name}/`));
  for (const o of model.orphans)
    // TODO.md / TODO-ELLE.md beyaz listede: plan katmanının kendi dosyaları, yetim DEĞİL.
    // (Dürüst not: orphanDirs() bugün yalnız DİZİN döndürüyor, yani bu iki DOSYA zaten buraya
    // düşmezdi — ekleme DEFANSİF ve emsallidir: INDEX.md/legacy.json da dosyadır ve listededir.
    // İleride dosya-düzeyi süpürme eklenirse sessiz kırılmayı önler.)
    if (!['INDEX.md', 'INDEX.json', 'legacy.json', 'TODO.md', 'TODO-ELLE.md', 'oturumlar'].includes(o) && !legacyDeclared(o))
      bulgular.push(`YETİM: plans/${o}/ — v<N> içermiyor (plan-kur formatı değil; ya legacy.json'a ilan et ya kaldır)`);
  if (model.legacy.err) bulgular.push(model.legacy.err);
  for (const e of model.legacy.entries)
    if (!e.var) bulgular.push(`LEGACY KIRIK: ${e.ad} → ${e.path} diskte yok`);
  return bulgular;
}

// İLAN EDİLMİŞ MUAFİYET: KAPALI plan künye alarmı üretmez. Gerekçe — künyenin işi SIRALAMAKtır;
// kapalı plan hiçbir sıraya girmez (öncelik listesi `durum !== KAPALI` süzer, Rotacı'nın hazir[]'i
// zaten boştur), dolayısıyla künyesizliği kimseyi yanıltmaz. Çaresi olmayan/karşılığı olmayan alarm
// alarmı KÖRELTİR. Muafiyet sessiz değildir: `--kunye` kaç planın muaf olduğunu YAZAR.
const kunyeMuaf = (p) => p.durum === 'KAPALI';

function kunyeBulgular(model) {
  // ADVISORY (gate'i KIRMAZ — bekçi sözleşmesi: bulgu = alarm, exit 0). Künye eksikliği
  // legacy planların normal hâlidir; her sapma kendi `onar:` satırını taşır.
  const out = [];
  for (const p of model.plans) {
    if (kunyeMuaf(p)) continue;
    const eksik = p.kunye?.eksik || [];
    if (!eksik.length) continue;
    out.push({
      slug: p.slug, v: p.v, eksik,
      onar: `plans/${p.slug}/v${p.v}/MASTER.md üst bloğuna ekle: ${eksik.map((a) =>
        a === 'Hedef' ? 'Hedef: <tek cümle>'
          : a === 'End-goal' ? 'End-goal: <plan bitince sistemde ne DAVRANIŞ olacak>'
          : a === 'Capability' ? 'Capability: uy:<hedef>/<yetenek> (virgülle çoklu)'
          : `${a}: <${(a === 'Kritiklik' ? KRITIKLIK : a === 'Aciliyet' ? ACILIYET : HACIM).join('|')}>`).join(' · ')}`,
    });
  }
  return out;
}

// `getirir:` BEYANSIZLIĞI — ADVISORY (aşama 31). `kunyeBulgular` ikizi, aynı bekçi sözleşmesi:
// bulgu = alarm, exit 0. İKİ KADEMELİ MUAFİYET (İLANLI):
//   · KAPALI plan MUAF  — kapalı plan hiçbir sıraya girmez; vaadi artık GELECEK değil GEÇMİŞtir.
//   · KAPALI aşama MUAF — aynı gerekçe, aşama düzeyinde (kunyeMuaf emsali).
// GERİYE DÖNÜK BEYAN YAZILMAZ (R9): eksiklik ADVISORY kalır, uydurulmaz — yanlış beyan
// beyansızlıktan BETERDİR.
// PLAN-BAŞINA TEK SATIR: 23 plan × onlarca aşama = aşama-başına alarm listeyi KÖRELTİRDİ.
const getirirMuaf = (p) => p.durum === 'KAPALI';
const getirirAsamaMuaf = (a) => a.durum === 'KAPALI';

function getirirBulgular(model) {
  const out = [];
  for (const p of model.plans) {
    if (getirirMuaf(p)) continue;
    const eksik = p.asamalar.filter((a) => !getirirAsamaMuaf(a) && !p.getirirMap?.[a.no]).map((a) => a.no);
    if (!eksik.length) continue;
    out.push({
      slug: p.slug, v: p.v, asamalar: eksik,
      onar: `asama-NN frontmatter'ına getirir: bloğu ekle; yapısal değişiklik yoksa 'getirir: yok'`,
    });
  }
  return out;
}

/** Muafiyet SESSİZ DEĞİLDİR — kaç plan/aşama alarm dışı bırakıldı, sayıyla İLAN edilir. */
function getirirMuafSayisi(model) {
  let planlar = 0, asamalar = 0;
  for (const p of model.plans) {
    if (getirirMuaf(p)) { if (p.asamalar.some((a) => !p.getirirMap?.[a.no])) planlar++; continue; }
    asamalar += p.asamalar.filter((a) => getirirAsamaMuaf(a) && !p.getirirMap?.[a.no]).length;
  }
  return { planlar, asamalar };
}

/** Beyanı INDEX/graf projeksiyonuna geçirilecek ÖZETE indirger; geçersiz beyan projeksiyona
 *  GİRMEZ (o governance bulgusudur — `hazir[]`in gecersiz kosum'u dışlamasının aynısı). */
const getirirOzet = (g) => (!g || g.gecersiz) ? null : g;

// ---------- render ----------

function agacSatirlari(model) {
  // kök: proje planı; sonra Üst zinciriyle girinti; kategorisizler düz listede
  const byUst = new Map();
  for (const p of model.plans) {
    const key = p.slug === 'proje' ? '__root' : (p.ust || '__top');
    if (!byUst.has(key)) byUst.set(key, []);
    byUst.get(key).push(p);
  }
  const lines = [];
  const etiket = (p) => {
    const asama = p.asamalar.length ? ` · aşama ${p.kapaliN}/${p.asamalar.length}` : '';
    const sira = p.siradaki ? ` · sıradaki: ${p.siradaki.no}-${p.siradaki.ad}` : '';
    const kn = p.kunye?.oncelik != null ? ` \`P${p.kunye.oncelik}\`` : '';
    return `**${p.slug}** (v${p.v} · ${p.durum}${asama}${sira}) — ${p.title}${p.kategori ? ` \`[${p.kategori}]\`` : ''}${kn}`;
  };
  const walk = (slug, depth) => {
    for (const c of byUst.get(slug) || []) {
      lines.push(`${'  '.repeat(depth)}- ${etiket(c)}`);
      walk(c.slug, depth + 1);
    }
  };
  const proje = model.plans.find((p) => p.slug === 'proje');
  if (proje) { lines.push(`- ${etiket(proje)}`); walk('proje', 1); }
  // Üst'ü olmayan (ya da proje-dışı köke bağlı) planlar
  for (const p of byUst.get('__top') || []) {
    if (p.slug === 'proje') continue;
    lines.push(`- ${etiket(p)}`);
    walk(p.slug, 1);
  }
  return lines;
}

function renderIndexMd(model) {
  const rel = path.relative(ROOT, PLANS) || 'plans';
  const L = [];
  L.push(`# PLAN AĞACI — ${path.basename(ROOT)}`);
  L.push('');
  L.push('> **ELLE DÜZENLEME YAPMA** — bu dosyayı `plan-organizatoru/scripts/agac.mjs` türetir (tek yazar).');
  L.push(`> Damga: \`${model.damga}\` · Kaynak: \`${rel}/*/v*/{MASTER,STATE,CHECKLIST}.md\` + \`${rel}/legacy.json\``);
  L.push('> Tazelik: `node ~/.claude/skills/plan-organizatoru/scripts/agac.mjs --gate` (damga uyuşmazlığı = bayat INDEX → yeniden türet)');
  L.push('');
  L.push('## Ağaç');
  L.push('');
  const agac = agacSatirlari(model);
  L.push(...(agac.length ? agac : ['_Henüz kanonik plan yok (`plans/<slug>/v<N>/`). Yeni plan: `/plan-kur <görev>` → `/plan-organizatoru kaydet <slug>`._']));
  L.push('');
  L.push('## Planlar');
  L.push('');
  L.push('| plan | kategori | künye (kritiklik/aciliyet · hacim) | üst | sürüm | durum | aşamalar | checklist (açık/kapalı) | son tur |');
  L.push('|---|---|---|---|---|---|---|---|---|');
  for (const p of model.plans) {
    L.push(`| [${p.slug}](${p.slug}/v${p.v}/MASTER.md) | ${p.kategori || '—'} | ${kunyeOzet(p.kunye)} | ${p.ust || '—'} | v${p.v} | ${p.durum} | ${p.kapaliN}/${p.asamalar.length} | ${p.checklist.acik}/${p.checklist.kapali} | ${p.sonTur ? p.sonTur.baslik : '—'} |`);
  }
  if (!model.plans.length) L.push('| — | | | | | | | | |');
  L.push('');
  // ÖNCELİK SIRASI — türev, elle yazılmaz: açık planlar künye puanına göre. "Hangi plan önce"
  // sorusunun tek yanıt yeri (PM/Rotacı bunu okur; ikinci bir sıralama motoru yazılmaz).
  const acikSirali = model.plans.filter((p) => p.durum !== 'KAPALI').sort(kunyeSirala);
  if (acikSirali.length) {
    L.push('## Öncelik sırası (türev — künye: kritiklik × aciliyet)');
    L.push('');
    acikSirali.forEach((p, i) => {
      L.push(`${i + 1}. **${p.slug}** — ${kunyeOzet(p.kunye)}${p.kunye?.hedef ? ` · hedef: ${p.kunye.hedef}` : ''}${
        (p.kunye?.eksik || []).length ? ` \`künye eksik: ${p.kunye.eksik.join(', ')}\`` : ''}`);
    });
    L.push('');
  }
  L.push('## Nerede kalmıştık');
  L.push('');
  const acikPlanlar = model.plans.filter((p) => p.durum !== 'KAPALI');
  if (!acikPlanlar.length) L.push('_Açık plan yok._');
  for (const p of acikPlanlar) {
    L.push(`### ${p.slug} — ${p.title}`);
    L.push(`- Künye: ${p.kategori || 'kategorisiz'} · ${kunyeOzet(p.kunye)}${p.kunye?.hedef ? ` · **hedef:** ${p.kunye.hedef}` : ''}`);
    L.push(`- Kaynak oturum: ${p.kunye?.oturum ? `\`${p.kunye.oturum}\`` : '— _(beyansız — onar: MASTER künye bloğuna `> Oturum: ot:<YYYY-MM-DD>/<slug>`)_'}`);
    if (p.sonTur) L.push(`- Son tur: **${p.sonTur.baslik}**${p.sonTur.yapilan ? ` — ${p.sonTur.yapilan}` : ''}`);
    if (p.siradaki) L.push(`- Sıradaki aşama: **${p.siradaki.no} — ${p.siradaki.ad}** (${p.siradaki.durum})`);
    if (p.depli && p.hazir.length > 1)
      L.push(`- Hazır küme (paralel koşulabilir): ${p.hazir.map((h) => `**${h.no}-${h.ad}**`).join(' · ')}`);
    if (p.depli && p.bekleyen.length)
      L.push(`- Bekleyen: ${p.bekleyen.map((b) => `${b.no}-${b.ad} ⟵ ${b.bekledigi.join(', ')}`).join(' · ')}`);
    if (p.goal) L.push('- Hazır komut: `' + p.goal + '`');
    L.push('');
  }
  if (model.legacy.entries.length) {
    L.push('## Legacy (yerinde endeksli — taşınmadı, ilan edildi)');
    L.push('');
    L.push('| ad | yol | tür | diskte | not |');
    L.push('|---|---|---|---|---|');
    for (const e of model.legacy.entries)
      L.push(`| ${e.ad} | [${e.path}](../${e.path}) | ${e.tur} | ${e.var ? '✓' : '✗ YOK'} | ${e.not} |`);
    L.push('');
  }
  return L.join('\n') + '\n';
}

function renderIndexJson(model) {
  return JSON.stringify({
    _uyari: 'ELLE DÜZENLEME — agac.mjs türetir; makine tüketicisi (kaptan readPlans) için projeksiyon',
    damga: model.damga,
    plans: model.plans.map((p) => ({
      slug: p.slug, v: p.v, title: p.title, kategori: p.kategori, ust: p.ust, durum: p.durum,
      // künye: planın kimlik kartı (MASTER üst bloğu) + TÜREV öncelik. Tüketici (Rotacı E4
      // sıralaması · PM · kaptan panosu · VSCode) kendi ölçütünü yazmaz, bunu okur.
      kunye: {
        hedef: p.kunye?.hedef ?? null, kritiklik: p.kunye?.kritiklik ?? null,
        aciliyet: p.kunye?.aciliyet ?? null, hacim: p.kunye?.hacim ?? null,
        oncelik: p.kunye?.oncelik ?? null, puan: p.kunye?.puan ?? null,
        eksik: p.kunye?.eksik ?? [],
        // ÇİFT DİKİŞİN plan ucu: planın KAYNAK OTURUMU (`ot:<tarih>/<slug>`). Tüketici
        // (oturum.mjs roll-up + global kılavuz · pano) bunu okur; ters yönü kendi türetir.
        oturum: p.kunye?.oturum ?? null,
      },
      asamaToplam: p.asamalar.length, asamaKapali: p.kapaliN,
      checklistAcik: p.checklist.acik, checklistKapali: p.checklist.kapali,
      sonTur: p.sonTur, siradaki: p.siradaki ? { no: p.siradaki.no, ad: p.siradaki.ad } : null, goal: p.goal,
      depli: p.depli, hazir: p.hazir, bekleyen: p.bekleyen, baslangiclar: p.baslangiclar,
      // GETİRİR (aşama 31) — ADDITIVE: `hazir[]`/`bekleyen[]` DEĞİŞMEDİ (Rotacı kırılmaz), yalnız
      // plan düzeyine yeni bir dizi eklendi. DURUM DAHİL, KAPALI DAHİL: 32 açık aşamaların
      // deltasını PROJEKSİYON yapar, kapalı aşamaların beyanını canlı grafla MUTABAKAT için
      // kullanır — "KAPALI aşama INDEX'te hiç yok" boşluğu böylece ek şema kırmadan kapanır.
      // Hiç beyan yoksa anahtar HİÇ doğmaz (spread) → beyansız projede INDEX.json BAYT-AYNI.
      ...(() => {
        const gs = p.asamalar
          .filter((a) => getirirOzet(p.getirirMap?.[a.no]))
          .map((a) => ({ no: a.no, ad: a.ad, durum: a.durum, ...getirirOzet(p.getirirMap[a.no]) }));
        return gs.length ? { getirir: gs } : {};
      })(),
      master: `plans/${p.slug}/v${p.v}/MASTER.md`,
    })),
    legacy: model.legacy.entries,
    // GENEL TODO (2026-07-27) — ADDITIVE: `plans[]` eleman şeması DEĞİŞMEDİ, yalnız tepe seviyeye
    // yeni anahtar eklendi. Tüketiciler (core planIndeksi · kaptan readPlans) anahtar-erişimli
    // okuyor → onu bilmeyen tüketici kırılmaz.
    todo: model.todo ? {
      acik: model.todo.acik, kaynak: model.todo.kaynak, muaf: model.todo.muaf,
      maddeler: model.todo.maddeler,
    } : null,
  }, null, 2) + '\n';
}

// ---------- graf projeksiyonu (haritanın + runner'ın tek veri kaynağı) ----------

function renderGraf(model) {
  const g = { _uyari: 'agac.mjs --graf türetir — harita/runner bu projeksiyonu tüketir, ikinci motor yazılmaz', damga: model.damga, nodes: [], edges: [] };
  for (const p of model.plans) {
    g.nodes.push({
      id: `plan:${p.slug}`, tip: 'plan', slug: p.slug, v: p.v, ad: p.title, kategori: p.kategori,
      // PROJEKSİYON SABİT: yalnız iki sayı. `p.checklist` artık `maddeler[]` de taşıyor —
      // ham nesneyi geçirmek graf JSON'unu sessizce şişirir ve graf tüketicisinin baytlarını
      // değiştirirdi (TODO listesi grafın işi değil, `--todo`nun işi).
      durum: p.durum, ust: p.ust,
      checklist: { acik: p.checklist.acik, kapali: p.checklist.kapali },
      master: `plans/${p.slug}/v${p.v}/MASTER.md`,
      kunye: { hedef: p.kunye?.hedef ?? null, kritiklik: p.kunye?.kritiklik ?? null,
        aciliyet: p.kunye?.aciliyet ?? null, hacim: p.kunye?.hacim ?? null,
        oncelik: p.kunye?.oncelik ?? null, puan: p.kunye?.puan ?? null },
    });
    if (p.ust) g.edges.push({ from: `plan:${p.ust}`, to: `plan:${p.slug}`, tip: 'ust' });
    for (const a of p.asamalar) {
      const id = `${p.slug}:${a.no}`;
      g.nodes.push({
        id, tip: 'asama', slug: p.slug, no: a.no, ad: a.ad, durum: a.durum, kanit: a.kanit || '',
        baslangic: p.baslangiclar.includes(a.no), hazir: p.hazir.some((h) => h.no === a.no),
        goal: goalCmd(p.slug, p.v, a.no),
        // GETİRİR (aşama 31) — düğüm zaten no/ad/durum taşıyor, özet onlarsız girer.
        // Beyansız aşamada anahtar HİÇ doğmaz → beyansız projede --graf BAYT-AYNI.
        ...(getirirOzet(p.getirirMap?.[a.no]) ? { getirir: getirirOzet(p.getirirMap[a.no]) } : {}),
      });
      g.edges.push({ from: `plan:${p.slug}`, to: id, tip: 'icerir' });
      for (const grup of a.bagimli || []) for (const d of grup) {
        if (d.gecersiz) continue;
        g.edges.push({
          from: `${d.plan || p.slug}:${d.no}`, to: id,
          tip: grup.length > 1 ? 'veya' : 've', capraz: !!d.plan && d.plan !== p.slug,
        });
      }
    }
  }
  return JSON.stringify(g, null, 2) + '\n';
}

// ---------- bağımlılık tohumlama (MASTER → STATE, idempotent) ----------

function injectDeps(st, depsMap) {
  const lines = st.split('\n');
  const out = []; let inSec = false, cols = null, bitti = false;
  for (const line of lines) {
    if (/^##\s+Aşama durumları\s*$/.test(line)) { inSec = true; out.push(line); continue; }
    if (!inSec || bitti) { out.push(line); continue; }
    if (!line.trim().startsWith('|')) { if (cols) bitti = true; out.push(line); continue; }
    let cells = line.split('|').map((c) => c.trim()).filter((_, i, a) => i > 0 && i < a.length - 1);
    if (!cols && cells[0] === '#') {
      cols = cells.map(trKey);
      if (!cols.includes('bagimli')) { cells = [...cells]; cells.splice(3, 0, 'bağımlı'); cols.splice(3, 0, 'bagimli'); }
      out.push('| ' + cells.join(' | ') + ' |'); continue;
    }
    if (!cols) { out.push(line); continue; }
    if (/^-+$/.test(cells[0].replace(/[:\s]/g, '-'))) { out.push('|' + cols.map(() => '---').join('|') + '|'); continue; }
    const bi = cols.indexOf('bagimli');
    if (cells.length < cols.length) cells.splice(bi, 0, '');
    const no = (cells[0].match(/\d+/) || [])[0]?.padStart(2, '0');
    if (no && depsMap.has(no)) cells[bi] = depStr(depsMap.get(no));
    else if (!cells[bi]) cells[bi] = '—';
    out.push('| ' + cells.join(' | ') + ' |');
  }
  return out.join('\n');
}

function tohumla() {
  let degisen = 0;
  for (const slug of listPlanSlugs()) {
    const v = highestVersion(slug);
    const vdir = path.join(PLANS, slug, `v${v}`);
    const deps = parseMasterDeps(readIf(path.join(vdir, 'MASTER.md')));
    if (!deps) { console.log(`atlandı (MASTER'da bağımlı sütunu yok): ${slug} v${v}`); continue; }
    const sp = path.join(vdir, 'STATE.md');
    const st = readIf(sp);
    if (!st) { console.log(`atlandı (STATE.md yok): ${slug} v${v}`); continue; }
    const yeni = injectDeps(st, deps);
    if (yeni !== st) { fs.writeFileSync(sp, yeni); degisen++; console.log(`tohumlandı: ${slug} v${v} (${deps.size} aşama)`); }
    else console.log(`değişiklik yok (idempotent): ${slug} v${v}`);
  }
  return degisen;
}

// ---------- komutlar ----------

function main() {
  if (!isDir(PLANS)) {
    if (flag('--gate')) { console.log(`plans/ yok (${ROOT}) — denetlenecek bir şey yok, PASS (boş kapsam İLANI: bu proje plan ağacına henüz katılmadı)`); process.exit(0); }
    console.error(`plans/ dizini yok: ${PLANS} — önce /plan-kur ile bir plan üret ya da mkdir plans + legacy.json ile başla.`);
    process.exit(2);
  }
  if (flag('--bagimlilik-tohumla')) {
    const n = tohumla();
    seedTodoElle();                       // damga tohumlu içeriği GÖRMELİ → buildModel'den ÖNCE
    const m2 = buildModel();
    fs.writeFileSync(INDEX_MD, renderIndexMd(m2));
    fs.writeFileSync(INDEX_JSON, renderIndexJson(m2));
    // İKİNCİ YAZIM NOKTASI — burası unutulursa bu dal bayat TODO bırakır ve gate onu SONRAKİ
    // koşumda yakalar (kafa karıştıran gecikmeli FAIL). İki nokta HEP birlikte güncellenir.
    fs.writeFileSync(TODO_MD, renderTodoMd(m2));
    console.log(`${n} STATE tohumlandı · INDEX + TODO yeniden türetildi · damga ${m2.damga}`);
    return;
  }

  // SALT-OKUR dallar HİÇBİR dosya yazmaz (tek yazar sözleşmesinin ikinci yarısı: yalnız türetim
  // dalları yazar). Tohum bu yüzden koşullu ve buildModel'den ÖNCE — damga tohumu görmeli.
  const SALT_OKUR = ['--gate', '--kunye', '--durum', '--denetle', '--legacy', '--graf', '--todo'];
  if (!SALT_OKUR.some(flag)) seedTodoElle();

  const model = buildModel();
  const bulgular = governance(model);

  if (flag('--graf')) { process.stdout.write(renderGraf(model)); return; }

  if (flag('--todo')) {
    // BEKÇİ sözleşmesi: bulgu = alarm, exit 0 (kendi bulgusuyla park olmaz). SALT-OKUR: TODO.md YAZMAZ.
    const t = model.todo;
    if (flag('--json')) { process.stdout.write(JSON.stringify({ damga: model.damga, todo: t }, null, 2) + '\n'); return; }
    const plansiz = t.maddeler.filter((m) => m.tur === 'elle' && !m.kapatan.length);
    console.log(`# genel TODO — ${path.basename(ROOT)} (deterministik · 0 token · damga ${model.damga})`);
    console.log(`  ${t.acik} açık madde · plansız ${plansiz.length} · chk ${t.kaynak.chk} · elle ${t.kaynak.elle} · hüküm ${t.kaynak.hukum} · künye ${t.kaynak.kunye} · oturum ${t.kaynak.oturum}`);
    if (plansiz.length) {
      console.log('\nPLAN BEKLEYEN (plan-üretim adayları):');
      for (const m of plansiz) console.log(`  · ${m.metin}  [${m.ref}]`);
    }
    for (const [baslik, tur] of [['HÜKÜM (EKSİK/STUCK)', 'hukum'], ['PLANA BAĞLI ELLE', 'elle'], ['KÜNYE EKSİĞİ', 'kunye']]) {
      const list = t.maddeler.filter((m) => m.tur === tur && !(tur === 'elle' && !m.kapatan.length));
      if (!list.length) continue;
      console.log(`\n${baslik}:`);
      for (const m of list) console.log(`  · ${m.metin}  [${m.ref}]${m.kapatan.length ? ` ⟵ ${m.kapatan.join(', ')}` : ''}${m.kapatAdayi ? ' — KAPAT ADAYI' : ''}`);
    }
    const chk = t.maddeler.filter((m) => m.tur === 'chk');
    if (chk.length) {
      console.log(`\nPLAN CHECKLIST maddeleri (${chk.length}) — künye önceliği sırasında:`);
      let sonPlan = null;
      for (const m of chk) {
        if (m.plan !== sonPlan) { sonPlan = m.plan; console.log(`  ${m.plan}:`); }
        console.log(`    · ${m.asama ? `[${m.asama}] ` : ''}${m.metin}  [${m.ref}]`);
      }
    }
    const b = t.bulgular;
    for (const c of b.cift) console.log(`\n✗ ÇİFT ÇIPA (gate FAIL): ${c}`);
    for (const c of b.cipasiz) console.log(`\n⚠ ÇIPASIZ madde: "${c}"\n  onar: TODO-ELLE.md'de <!-- td:elle/<slug> --> ekle`);
    for (const c of b.cozulemeyen) console.log(`\n⚠ ÇÖZÜLEMEYEN KAPATIR: ${c.slug} → ${c.ref}\n  onar: ${c.onar}`);
    if (b.sarkikMuaf) console.log(`\nℹ MUAF: KAPALI planlardan ${b.sarkikMuaf} sarkık Kapatır ref'i (doğal yaşam döngüsü — alarm üretilmez)`);
    console.log(`\nℹ İLANLI MUAF kaynaklar (bu listeye GİRMEZ): ${t.muaf.join(' · ')}`);
    return;
  }

  if (flag('--kunye')) {
    // BEKÇİ sözleşmesi: eksik künye alarm üretir, exit 0 (kendi bulgusuyla park olmaz).
    // GEÇERSİZ künye ayrı sınıftır — o gate'in işi (--gate exit 1).
    const eksikler = kunyeBulgular(model);
    const sirali = [...model.plans].sort(kunyeSirala);
    if (flag('--json')) {
      process.stdout.write(JSON.stringify({
        damga: model.damga,
        sira: sirali.map((p) => ({ slug: p.slug, v: p.v, durum: p.durum, kategori: p.kategori, ...(p.kunye || {}) })),
        eksik: eksikler,
        muaf: model.plans.filter((p) => kunyeMuaf(p) && (p.kunye?.eksik || []).length)
          .map((p) => ({ slug: p.slug, sebep: 'KAPALI plan sıraya girmez' })),
        gecersiz: governance(model).filter((b) => b.startsWith('GEÇERSİZ KÜNYE')),
        // GETİRİR advisory'si (aşama 31) — 32'nin kapsama raporunun girdisi.
        getirirEksik: getirirBulgular(model),
        getirirMuaf: getirirMuafSayisi(model),
        // plan üretiminin referansı: hangi iş HENÜZ hiçbir planın kapsamında değil
        plansizTodo: (model.todo?.maddeler || [])
          .filter((m) => m.tur === 'elle' && !m.kapatan.length)
          .map((m) => ({ ref: m.ref, metin: m.metin })),
      }, null, 2) + '\n');
      return;
    }
    console.log(`# plan künyeleri — ${path.basename(ROOT)} (${model.plans.length} plan · damga ${model.damga})`);
    console.log('  sıra  plan                 durum    kategori   kritiklik/aciliyet · hacim   hedef');
    sirali.forEach((p, i) => {
      console.log(`  ${String(i + 1).padStart(4)}  ${p.slug.padEnd(20)} ${p.durum.padEnd(8)} ${(p.kategori || '—').padEnd(10)} ${kunyeOzet(p.kunye).padEnd(28)} ${p.kunye?.hedef || '—'}`);
    });
    const muaf = model.plans.filter((p) => kunyeMuaf(p) && (p.kunye?.eksik || []).length);
    if (eksikler.length) {
      console.log(`\n⚠ künyesi eksik ${eksikler.length} AÇIK plan (advisory — gate'i kırmaz):`);
      for (const e of eksikler) console.log(`  · ${e.slug} v${e.v} → eksik: ${e.eksik.join(', ')}\n    onar: ${e.onar}`);
    } else console.log('\nAçık planların künyesi tam.');
    if (muaf.length) console.log(`ℹ MUAF: ${muaf.length} KAPALI plan künyesiz (kapalı plan sıraya girmez — alarm üretmez): ${muaf.map((p) => p.slug).join(', ')}`);
    // GETİRİR BEYANI (aşama 31) — ADVISORY, plan-başına TEK satır. Bekçi sözleşmesi: exit 0.
    const gEksik = getirirBulgular(model);
    const gMuaf = getirirMuafSayisi(model);
    if (gEksik.length) {
      console.log(`\n⚠ getirir: beyanı eksik ${gEksik.length} plan (advisory — gate'i kırmaz):`);
      for (const e of gEksik) console.log(`  · ${e.slug} v${e.v} → ${e.asamalar.join(',')}\n    onar: ${e.onar}`);
    } else console.log("\nAçık aşamaların getirir: beyanı tam.");
    if (gMuaf.planlar || gMuaf.asamalar)
      console.log(`ℹ MUAF (getirir): ${gMuaf.planlar} KAPALI plan · ${gMuaf.asamalar} KAPALI aşama — kapalı iş sıraya girmez, geriye dönük beyan YAZILMAZ`);
    // PLANSIZ TODO — plan üretiminin referansı (2026-07-27): hiçbir planın `Kapatır:` satırına
    // bağlanmamış elle madde = plan-üretim adayı. Bekçi sözleşmesi: alarm, exit 0.
    const plansiz = (model.todo?.maddeler || []).filter((m) => m.tur === 'elle' && !m.kapatan.length);
    if (plansiz.length) {
      console.log(`\n⚠ plansız TODO maddesi: ${plansiz.length} (hiçbir planın "Kapatır:" satırına bağlı değil)`);
      for (const m of plansiz.slice(0, 10)) console.log(`  · ${m.metin}  [${m.ref}]`);
      if (plansiz.length > 10) console.log(`  … ${plansiz.length - 10} madde daha (tamamı: agac.mjs --todo)`);
      console.log(`  onar: kapsayan plana MASTER künye bloğunda '> Kapatır: td:<ref>' ekle ya da /plan-kur ile plan aç`);
    } else console.log('Plansız TODO maddesi yok (her elle madde bir plana bağlı).');
    return;
  }

  if (flag('--gate')) {
    const stored = (readIf(INDEX_MD) || '').match(/Damga:\s*`([0-9a-f]+)`/)?.[1];
    const jsonStored = (() => { try { return JSON.parse(readIf(INDEX_JSON) || '{}').damga; } catch { return null; } })();
    const sorunlar = [...bulgular];
    if (!stored) sorunlar.push('INDEX.md yok ya da damgasız — türet: agac.mjs');
    else if (stored !== model.damga) sorunlar.push(`BAYAT INDEX: damga ${stored} ≠ kaynak ${model.damga} — yeniden türet: agac.mjs`);
    if (jsonStored && jsonStored !== model.damga) sorunlar.push(`BAYAT INDEX.json: damga ${jsonStored} ≠ kaynak ${model.damga}`);
    // TODO.md TÜREVDİR (damganın GİRDİSİ değil, TÜKETİCİSİ) — bayatlığı kendi damga satırıyla
    // ölçülür; INDEX.json'un yukarıdaki muamelesinin aynısı. TODO-ELLE.md/HUKUM.md değişip türev
    // koşulmadıysa gate bunu İLAN eder (sessizce bayat liste = yalan söyleyen liste).
    const todoStored = (readIf(TODO_MD) || '').match(/Damga:\s*`([0-9a-f]+)`/)?.[1];
    if (fs.existsSync(TODO_MD) && todoStored !== model.damga)
      sorunlar.push(`BAYAT TODO: damga ${todoStored || '(yok)'} ≠ kaynak ${model.damga} — yeniden türet: agac.mjs`);
    if (sorunlar.length) { console.error(`GATE FAIL (${sorunlar.length}):\n` + sorunlar.map((s) => `  ✗ ${s}`).join('\n')); process.exit(1); }
    console.log(`GATE PASS — ${model.plans.length} plan · damga ${model.damga} · governance temiz`);
    return;
  }

  if (flag('--denetle') || flag('--legacy')) {
    const set = flag('--legacy') ? bulgular.filter((b) => b.includes('LEGACY') || b.includes('legacy')) : bulgular;
    if (set.length) console.log(`${set.length} bulgu:\n` + set.map((s) => `  ✗ ${s}`).join('\n'));
    else console.log('Governance temiz — bulgu yok.');
    if (!flag('--legacy')) {
      const kEksik = kunyeBulgular(model);
      if (kEksik.length) console.log(`ℹ KÜNYE EKSİK (ADVISORY — gate'i kırmaz; ayrıntı: --kunye):\n` +
        kEksik.map((e) => `  · ${e.slug}: ${e.eksik.join(', ')}\n    onar: ${e.onar}`).join('\n'));
      // GETİRİR EKSİK — künye deseninin ikizi (aşama 31): ADVISORY, plan-başına tek satır.
      const gEksik = getirirBulgular(model);
      if (gEksik.length) console.log(`ℹ GETİRİR EKSİK (ADVISORY — gate'i kırmaz; ayrıntı: --kunye):\n` +
        gEksik.map((e) => `  · ${e.slug}: ${e.asamalar.join(',')}\n    onar: ${e.onar}`).join('\n'));
    }
    if (!flag('--legacy') && !DAG_AKTIF && (model.grafBulgular || []).length)
      console.log(`ℹ DAG bulguları (PASİF — gate'e girmez; aktifleştir: touch plans/.dag-aktif):\n` +
        model.grafBulgular.map((s) => `  · ${s}`).join('\n'));
    process.exit(flag('--gate') && set.length ? 1 : 0);
  }

  if (flag('--durum')) {
    if (flag('--json')) { process.stdout.write(renderIndexJson(model)); return; }
    const acik = model.plans.filter((p) => p.durum !== 'KAPALI');
    console.log(`# ${path.basename(ROOT)} — plan durumu (${model.plans.length} plan, ${acik.length} açık)`);
    for (const p of model.plans)
      console.log(`  ${p.durum.padEnd(7)} ${p.slug} v${p.v} · aşama ${p.kapaliN}/${p.asamalar.length}${p.kunye?.oncelik != null ? ` · P${p.kunye.oncelik} ${kunyeOzet(p.kunye)}` : ''}${p.siradaki ? ` · sıradaki: ${p.siradaki.no}-${p.siradaki.ad}` : ''}${p.depli && p.hazir.length > 1 ? ` · hazır küme: ${p.hazir.map((h) => h.no).join(',')}` : ''}`);
    const sirali = acik.filter((p) => p.kunye?.puan != null).sort(kunyeSirala);
    if (sirali.length) console.log(`\nöncelik sırası (künye türevi): ${sirali.map((p) => `${p.slug}(P${p.kunye.oncelik})`).join(' > ')}`);
    const kEksik = kunyeBulgular(model);
    if (kEksik.length) console.log(`\n⚠ künyesi eksik ${kEksik.length} plan (ayrıntı + onar: --kunye)`);
    for (const p of acik) {
      if (!p.depli && p.masterDeps && p.asamalar.length)
        console.log(`  ⚠ ${p.slug}: MASTER bağımlılık taşıyor ama STATE tohumsuz — node agac.mjs --bagimlilik-tohumla`);
    }
    for (const p of acik) if (p.goal) console.log(`\n${p.slug} için hazır komut:\n  ${p.goal}`);
    if (bulgular.length) console.log(`\n⚠ governance: ${bulgular.length} bulgu (ayrıntı: --denetle)`);
    return;
  }

  // varsayılan: türet (idempotent — kaynak değişmediyse bayt-aynı)
  // NOT: seedTodoElle() burada DEĞİL, main() başında çağrılır — tohumun damgaya girmesi için
  // buildModel()'den ÖNCE olmak zorunda (aksi halde bu koşumda yazılan INDEX damgası tohumsuz
  // içerikten hesaplanır ve hemen ardından gate BAYAT der).
  fs.writeFileSync(INDEX_MD, renderIndexMd(model));
  fs.writeFileSync(INDEX_JSON, renderIndexJson(model));
  fs.writeFileSync(TODO_MD, renderTodoMd(model));
  console.log(`INDEX + TODO türetildi: ${path.relative(process.cwd(), INDEX_MD)} (+ INDEX.json, TODO.md) · ${model.plans.length} plan · ${model.todo.acik} açık TODO maddesi · damga ${model.damga}`);
  if (bulgular.length) { console.log(`⚠ governance: ${bulgular.length} bulgu:\n` + bulgular.map((s) => `  ✗ ${s}`).join('\n')); }
}

main();
