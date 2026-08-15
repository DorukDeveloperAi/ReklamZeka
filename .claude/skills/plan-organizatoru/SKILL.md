---
name: plan-organizatoru
description: /plan-kur'un governance/double-check tamamlayıcısı — planları kategorilendirir, proje plan AĞACINDA doğru dala yerleştirir, dosyalar/klasörler; "yeni plan mı revizyon mu" denetimi yapar (minor değişiklik → v(N+1), yeni plan DEĞİL); "proje planı tektir" kuralını korur; PM veya kullanıcı işe başladığında "nerede kalmıştık / ne düşünmüştük / ne planlamıştık" ağacını güncel gösterir. INDEX'i elle değil scripts/agac.mjs ile TÜRETİR; PM/kaptan bunun tüketicisidir (plan ağacı PM.json + aide kaptan panosuna akar). Kullanıcı "planı yerleştir/kaydet", "plan ağacı", "planları düzenle/organize et", "nerede kalmıştık planlarda", "plan governance/denetle", "bu yeni plan mı revizyon mu" dediğinde, /plan-kur bir plan yazdıktan sonra veya /plan-organizatoru çağrıldığında kullan.
rol: ajan
---

# /plan-organizatoru — Plan ağacı governance katmanı

`/plan-kur` planı ÜRETİR; bu skill planı **yerleştirir, denetler ve görünür kılar**.
İkisi paralel değil tamamlayıcıdır; PM/kaptan'a paralel değil onların **aracıdır**:
PM plan üretimini `/plan-kur` görevi olarak dağıtır, plan durumunu bu skill'in
türettiği INDEX üzerinden izler (PM.json `plans` alanı + `aide kaptan` panosu).

## Rol sınırı — ben ne DEĞİLİM, ne zaman devret

İrtifam proje-içi **PLAN geçmişi/governance**: "nerede kalmıştık, ne planlamıştık"
sorusunun cevabı bende — ama yalnız plan ekseninde.

| Değilim | O soru kimin |
|---|---|
| Genel durum panosu — "şu an ne oluyor" | **kaptan** (tek ön kapı) |
| Karar merci — "hangi plan öncelikli" | **pm** |
| Koşum hakemi — "aşama gerçekten bitti mi" | **rota** (reconciler + hakem; hüküm HUKUM.md'de) |
| Plan üreticisi — içerik yazmak | **/plan-kur** (ben yerleştirir + denetlerim) |

## Kanonik yapı (proje başına)

```
<proje>/plans/
  INDEX.md + INDEX.json  ← ağacın kökü — ELLE YAZILMAZ; tek yazar scripts/agac.mjs
  TODO-ELLE.md           ← genel TODO'nun ELLE kaynağı (çıpa `td:elle/<slug>`; insan/PM yazar)
  TODO.md                ← TÜREV — ELLE YAZILMAZ; tek yazar scripts/agac.mjs (INDEX.json→todo ile birlikte)
  legacy.json            ← taşınmamış plan parçalarının GEREKÇELİ ilanı (elle, kısa)
  oturumlar/<tarih>-<ad>.md  ← OTURUM defteri: o oturumun ELLE hedef beyanı (çıpa `ot:<tarih>/<ad>`)
  OTURUMLAR.md           ← TÜREV — oturum × plan çift dikişi + hüküm; tek yazar scripts/oturum.mjs
  proje/v<N>/…           ← REZERVE slug: projenin TEK ana planı
  <slug>/v<N>/…          ← /plan-kur çıktıları (MASTER/CHECKLIST/REQUIREMENTS/asama/STATE/REVIZYON)
```

## Plan künyesi — "hangi plan önce" sorusunun tek yanıt yeri

Her planın `MASTER.md` üst bloğu planın **KÜNYESİNİ** taşır (plan-kur şablonunda var; eski
planlara intake'te eklenir):

```
> Kategori: <proje|özellik|altyapı|süreç|araştırma> · Üst: <slug|proje|—>
> Kritiklik: <düşük|orta|yüksek|kritik> · Aciliyet: <ertelenebilir|normal|yakın|acil> · Hacim: <küçük|orta|büyük|epik>
> Hedef: <TEK cümle — bu plan bitince dünyada ne değişmiş olur>
> Oturum: ot:<YYYY-MM-DD>/<slug>     ← planı DOĞURAN oturum (çift dikişin plan ucu)
```

| alan | ne ölçer | kim karar verir |
|---|---|---|
| Kategori | işin cinsi (ağaç grubu) | plan-kur / intake |
| Üst | ağaçtaki dal | intake (bu skill) |
| **Kritiklik** | **önem**: olmazsa ne kırılır | kullanıcı / PM |
| **Aciliyet** | zaman baskısı | kullanıcı / PM |
| **Hacim** | iş büyüklüğü (slot·bütçe) | plan-kur (aşama sayısı/efor) |
| **Hedef** | tek cümlelik varış hali | plan-kur |
| **Oturum** | planı DOĞURAN oturum çıpası | planı yazan oturum (kendisi) |

**`oncelik` (P0–P3) TÜREVDİR — elle YAZILMAZ.** Tek hesap yeri `agac.mjs`:
`oncelik = min(3, round((kritiklik + aciliyet) / 2))` (Eisenhower ekseni; puanlar
kritik/acil=3 … düşük/ertelenebilir=0). Toplam sıra anahtarı `puan = kritiklik*4 + aciliyet`,
eşitlikte kritiklik, sonra slug — **deterministik**. Künyesiz plan sıranın SONUNA düşer
(puan −1): sıraya girmek isteyen künyesini yazar.

```bash
node ~/.claude/skills/plan-organizatoru/scripts/agac.mjs --kunye          # sıra + eksik künye + onar:
node ~/.claude/skills/plan-organizatoru/scripts/agac.mjs --kunye --json   # tüketici projeksiyonu
```

**İki sınıf, iki sonuç (legacy sözleşmesi — `kosum:` emsali):**
- **Künye EKSİK** → ADVISORY: `--kunye`/`--denetle` alarm basar, `onar:` satırı verir, **gate
  KIRILMAZ**. Eski planlar bu hâldedir; künyesizlik yalanlamaz, yalnız sırasız bırakır.
- **Künye GEÇERSİZ** (şema dışı değer) → **gate FAIL** (`GEÇERSİZ KÜNYE`). Gerekçe: yanlış künye
  künyesizlikten beterdir — Rotacı/PM ona göre SIRALAR.
- **`Kapatır` sorunu** (genel TODO bağı) → İKİ ALT SINIF: **biçimsiz** ref (şema dışı) **gate
  FAIL** eder (`GEÇERSİZ KAPATIR`) — sessizce bağsız kalırsa plan "kapatıyorum" der ama hiçbir
  madde kapanmaz; **şemalı ama karşılıksız** ref ise ADVISORY + `onar:`, **gate KIRILMAZ**.
  Künyeden farkı: `Kapatır` SIRALAMAYI etkilemez, yalnız kapsama raporunu besler; ayrıca türev
  maddeler UÇUCUDUR (checklist maddesi kapanınca ref'i doğal olarak kaybolur). KAPALI planın
  sarkık ref'i büsbütün MUAFtır (`--todo` sayıyla ilan eder).

Tüketiciler (kendi ölçütünü yazmaz, künyeyi okur): `INDEX.json → plans[].kunye` ·
`--graf` plan düğümü · Rotacı E4 sıralaması · kaptan panosu · PM · VSCode planlar sekmesi.

## Çağrı biçimleri

| çağrı | iş |
|---|---|
| `/plan-organizatoru kaydet <slug>` | intake: kategori+dal ata, yeni-mi-revizyon-mu denetimi, INDEX'i türet |
| `/plan-organizatoru agac` | ağacı türet + "nerede kalmıştık" brifini bas |
| `/plan-organizatoru denetle` | governance süpürmesi (rapor; yazmaz) |
| `/plan-organizatoru durum` | salt-okunur: plan durumları + sıradaki açık aşamaların hazır `/goal` komutları |

Makine katmanı (hepsinin altında): `node ~/.claude/skills/plan-organizatoru/scripts/agac.mjs
[--proje <yol>] [--gate|--durum|--denetle|--legacy|--graf|--bagimlilik-tohumla] [--json]`.
Varsayılan çağrı INDEX'i türetir ve **idempotenttir** (kaynak değişmediyse bayt-aynı). Tazelik
**içerik damgasıyla** ölçülür (mtime değil): INDEX kaynakların hash'ini taşır; `--gate`
uyuşmazlıkta FAIL basar → tek çare yeniden türetmek.

**DAG modeli — DAVRANIŞ VALFİ (kullanıcı kararı 2026-07-16):**
DAG *davranışı* projede `plans/.dag-aktif` işareti varken açılır; işaret yokken `--graf`/`hazir[]`
hesaplanır (harita ve Rotacı çalışır) ama `siradaki`/`goal` seçimi eski lineer davranıştır ve DAG
governance bulguları gate'i kırmaz (--denetle "pasif" listeler).
STATE tablosunun opsiyonel `bağımlı` sütunu plan ağını kurar
(`00, 01` VE · `01/02` VEYA, ayraç `/` — `|` tablo hücresini böler, yasak · `slug:NN`
çapraz-plan gate · `—` başlangıç). agac.mjs bundan
`hazir[]` (ready-set — paralel koşulabilir aşamalar; hükmün TEK sahibi bu dosyadır, runner'lar
kendi ölçüt yazmaz), `bekleyen[]`, `baslangiclar[]` ve `--graf` (harita/runner'ın tek veri
kaynağı: düğüm+kenar JSON) türetir. Governance'a DÖNGÜ · KOPUK BAĞ · GEÇERSİZ BAĞIMLILIK ·
MASTER↔STATE BAĞIMLILIK UYUMSUZ eklendi (hepsi gate FAIL). Sütunu olmayan plan lineer-legacy'dir
(eski davranış birebir: hazır küme = ilk AÇIK); MASTER'ında `bağımlı` sütunu olan plana sütun
elle değil `--bagimlilik-tohumla` ile işlenir (idempotent; parantez notlarını atar, `01–05`
aralığını açar).

**Aşama koşum türü (`kosum:`) — opsiyonel frontmatter (workflow katmanı):**
Bir `asama-NN-*.md`'nin başındaki `---` frontmatter bloğu opsiyonel `kosum:` alanı taşıyabilir.
Şema **kapalıdır, iki değer**: `tek-ajan` · `workflow:<sablon-ref>` (`<sablon-ref>` = `[a-z0-9-]+`,
aşama 02 kütüphanesindeki şablon adı). agac.mjs değeri yalnız **parse** eder (koşum türü kararı
plan yazımında verilir, koşum anında değil): beyanı `hazir[]` girdisine `{"tur":"tek-ajan"}` |
`{"tur":"workflow","sablon":"<ref>"}` olarak taşır (köprü/aşama-03 tüketir). **Alan yoksa**
`hazir[]`'da anahtar HİÇ yoktur = `tek-ajan` (yokluk tanım gereği tek-ajan). Şemasız değer
`GEÇERSİZ KOŞUM` governance bulgusudur ve **gate FAIL eder** (VALFSİZ — DAG işareti gerekmez).
Damga koşulludur: bir aşama `kosum:` beyan ediyorsa frontmatter bloğu içerik damgasına girer
(beyan değişince INDEX bayat → `--gate` FAIL); beyan yokken damga bugünküyle **bayt-aynı** kalır.

## `kaydet <slug>` — intake süreci

1. `plans/<slug>/` var mı, plan-kur formatında mı bak (`v<N>/MASTER.md`).
2. **Yeni plan mı, revizyon mu (double-check):** INDEX'teki mevcut slug'ların
   başlık+kapsamıyla karşılaştır. Aynı işin devamı/minor değişikliği ise plan
   YENİ SLUG ALMAZ → kullanıcıya/PM'e `/plan-kur revize <eski-slug>` öner ve dur.
   Kararsızsan TEK soru sor (AskUserQuestion). Proje-genelini anlatan bir plansa
   ve `proje` slug'ı doluysa → `/plan-kur revize proje`ye yönlendir (**proje planı
   tektir**).
3. MASTER.md üst bloğuna `Kategori:` ve `Üst:` yaz (yoksa). Kategori seçimi:
   proje=projenin tamamını anlatan tek plan · özellik=ürün yüzeyi · altyapı=araç/CI/
   sistem · süreç=işleyiş/protokol · araştırma=karar öncesi keşif. `Üst:` planın
   mantıksal ebeveyni — **BAĞLANMA açık karardır (2026-08-14, "çoğu plan proje" bias'ı
   kaldırıldı):** roadmap'in bariz parçası → `proje`/ilgili dal; tek-seferlik/koş-ve-bitir
   (tipik /planla-kos çıktısı) → `—`; **gri alanda TEK soru sor** (AskUserQuestion —
   adım 2 emsali). Kaynak akış kararı zaten taşıyorsa (`bağlanma=…`) sorgusuz uygula.
4. **`Kapatır` bağını doğrula (genel TODO):** MASTER `> Kapatır: td:…` satırı taşıyorsa her
   ref'i `agac.mjs --todo --json` çıktısına karşı kontrol et. Bilinmeyen/biçimsiz ref kaydı
   **DURDURMAZ** — `onar:` önerisini uygula (ref'i düzelt ya da satırdan çıkar) ve ADVISORY'yi
   kullanıcıya bas. Satır YOKSA: `agac.mjs --kunye` plansız-madde raporunu göster — plan bir
   maddeyi kapatıyor da beyan unutulmuş olabilir (plansız madde = plan-üretim adayı).
5. `agac.mjs` koş → INDEX + TODO türet. Governance bulguları çıktıysa kullanıcıya bas.
6. Proje kaptan'a kayıtlıysa: ilgili proje hedefinde `planRef` bağlamayı öner
   (hedef↔plan bağını PM kurar; sen sadece hatırlat — tek-yazar disiplini).

## Governance kuralları (denetle + gate'in ölçtükleri)

- **Proje planı tektir:** `proje` slug'ı + `Kategori: proje` başka slug'da → FAIL.
- **Yetim:** `plans/` altında `v<N>` içermeyen dizin → ya `legacy.json`'a gerekçesiyle
  ilan edilir ya kaldırılır. Sessiz durmaz.
- **Bayat:** INDEX damgası kaynaklarla uyuşmuyor → yeniden türet.
- **Tutarsız:** STATE tüm aşamaları KAPALI derken CHECKLIST'te açık madde → FAIL.
- **Kırık dal:** `Üst:` var olmayan slug'a işaret ediyor → FAIL.
- **Kategorisiz plan** → FAIL (intake atlanmış demektir).
- **Legacy kırık:** `legacy.json` girdisinin yolu diskte yok → FAIL.
- **Geçersiz oturum beyanı:** künyedeki `> Oturum:` şema dışı (`ot:<YYYY-MM-DD>/<slug>` değil)
  → FAIL. Beyanın YOKLUĞU advisory'dir; **yanlış** beyan FAIL eder.
- **Oturum çıpası uyuşmazlığı:** dosya adı ⊕ künye ⊕ HTML çıpası üçü aynı ref'i göstermiyor → FAIL.

## Oturum boyutu — "bu oturumda amaçladığımı bitirdim mi?" (2026-07-27)

Plan ve TODO **proje** eksenlidir; iş ise **oturumlarda** yapılır. Bir oturumun kendi
hedeflerini kapattığı proje ekseninden GÖRÜLMEZ — bu yüzden ikinci bir eksen var ve iki
eksen **çift dikişle** birbirine bağlanır (biri bayatlarsa öteki söyler):

| yön | kim yazar | nerede |
|---|---|---|
| plan → oturum | planı yazan oturum (ELLE) | `MASTER.md` künyesi: `> Oturum: ot:<tarih>/<slug>` |
| oturum → hedef | oturumun kendisi (ELLE) | `plans/oturumlar/<tarih>-<ad>.md` → `## Hedefler` |
| kesişim + hüküm | **TÜREV** (`oturum.mjs`) | `plans/OTURUMLAR.md` · `~/.claude/oturum/KILAVUZ.md` |

```bash
O=~/.claude/skills/plan-organizatoru/scripts/oturum.mjs
node $O tohumla --baslik "<ad>" --hedef "<tek cümle>"   # defteri aç (hedefler NABIZDAN tohumlanır)
node $O durum          # proje roll-up'ı → plans/OTURUMLAR.md (beyan ↔ gerçek yan yana)
node $O bu             # BU oturumun hükmü — açık iş varsa exit 1 (kapanış KAPISI)
node $O global         # projeler-arası SIRALI devralma kılavuzu (yeni oturum buradan başlar)
node $O backfill       # beyansız LEGACY planları git doğum tarihi kovasına bağla (--uygula ile yazar)
```

**HÜKÜM:** `TAM` (açık hedef ∧ açık plan yok) · `SÜRÜYOR` (dosya AÇIK, iş var) ·
`EKSİK` (dosya KAPALI ama iş var → genel TODO'ya **tek satır** alarm) · `BOŞ` (beyansız).

**Sert kurallar:**
- **Beyansız plan ADVISORY, biçimsiz beyan gate FAIL** (künye emsali: yanlış beyan
  tüketiciyi yanlış yere götürür; eksik beyan yalnız görünmez kılar).
- **Çıpa üç yerde uyuşmalı** (yorum · künye · dosya adı) — uyuşmazlık gate FAIL.
- **Terfi asimetriktir:** oturum-düzeyi todo proje düzeyine kendiliğinden ÇIKMAZ (`TODO-ELLE.md`
  + hedefte `→ td:elle/<slug>` işareti gerekir). **Planlar istisnasız roadmap'e işler.**
- **EKSİK oturum TODO'ya hedeflerini DÖKMEZ**, tek satır alarm düşürür — oturum listesi
  proje listesini boğmasın (`plans/OTURUMLAR.md` tam dökümün yeri).
- **aide GEREKMEZ:** üretim yolu node + dosya sistemidir; `aide sistem kapat` bu boyutu
  DURDURMAZ. Kapanış damgasını `hook:oturum-kapanis` (SessionEnd) atar; aide katmanı
  yalnız pano/bekçi/kılavuz kalitesi ekler.

## Devir notu — session ölümü NİYETİ diske bırakır (2026-07-29)

Oturum defteri "ne hedefledim, bitti mi" sorusunu yanıtlar. **Devir notu** başka bir soruyu
yanıtlar: *"bu session tam olarak ne yapıyordu, nerede kaldı, neyi tutuyordu?"* — cevabı
bugüne dek yalnız **transcript** taşıyordu ve transcript **hesaba bağlıdır** (taşınmaz).
Not o niyeti git-izli proje tarafına indirir.

| ne | nerede |
|---|---|
| yazan | `oturum.mjs devir` (SessionEnd zincirinde, `kapat`tan SONRA) |
| dosya | `plans/oturumlar/devir/<tarih>-<ad>.json` — çıpayla birebir (`devirDosyaYolu`) |
| şema | `oturum-lib.mjs` → `DEVIR_SURUM = 1` · doğrulayan `devirDogrula(obj)` |
| okuyan | seviye-0'ın 06 (açılış devralma) · 07 (limit nabzı) · 08 (kilit ömrü) |

```bash
node $O devir [--transcript <jsonl>] [--sebep <kapanış cinsi>]   # defter yoksa exit 2
```

**Şema (zorunlu alanlar; bilinmeyen alan SERBEST — ileri sürümler ekleyebilir):**

- **kimlik** — `surum · ref · session{id,kisa} · proje · kok · baslangic · kapanis · kapanisSebebi`
- **niyet** — `niyet` (defterin `> Hedef:`i) · `acilisIstek` · `sonIstek` (transcript'ten)
- **iş durumu** — `hedefler[] · todos{acik[],inProgress[],toplam} · planlar[] · oturumDefteri{dosya,durum,hukum}`
- **devir** — `kilitler[]{key,intent,breadth,durum:aktif|birakildi} · siradakiAdim · devamModeli|null`
- **dürüstlük** — `olculemedi[] · ozet`

**Sert kurallar:**
- **`session.id` TAM id taşır** (kısa id kimlik DEĞİLDİR) — tüketiciler biçimi TAHMİN ETMEZ,
  `devirDogrula` ile ÖLÇER. Şema dışı not okunmaz.
- **Motor metin UYDURMAZ:** ölçülemeyen alan `null` kalır ve adı `olculemedi[]`ye düşer;
  `ozet` serbest yorum değil ŞABLONLA dizilir.
- **`siradakiAdim` DETERMİNİSTİKtir:** ilk `in_progress` todo ?? ilk açık hedef ?? `null`.
- **İdempotent:** `kapanis` defterin `Bitiş` damgasından okunur (taze `new Date()` DEĞİL) →
  aynı girdiyle 2. koşum **bayt-özdeş**tir ve yazım atlanır ("aynı — yazılmadı").
- **Sır eleği bu yolun TEK eleğidir:** filing'in sır kapısı `plans/` altını taramaz. Elenen
  değer `«sır elendi»` ile İLAN edilir (sessiz kırpma yasak).
- **Kilitler AKTİF ∪ ARŞİV okunur.** SessionEnd hook sırası garanti değildir; `claim-guard
  release_all` kilidi silmez, `_archive/`e taşır ve `owner.sessionId`i korur → yarış
  TASARIMLA kapalı, yalnız `durum` alanı `aktif`↔`birakildi` değişir.
- **`DEVRALIS.md`yi İKAME ETMEZ:** o PROJE düzeyidir ve canlı session'ları özetler; bu
  SESSION düzeyidir ve kapanışta donar.
- **TTL yok:** bayat devir notunu kimse otomatik silmez (ilanlı muafiyet); yaş ilanı ve
  eskalasyon denetçi katmanının işidir.
- **Roll-up yalnız İLAN eder:** `OTURUMLAR.md` ve global `KILAVUZ.md` notun yolunu +
  `siradakiAdim`ı basar; notu MODELE almak (içeriğinden karar üretmek) tüketicinin işidir.

## Açılış devralması — yeni oturum sarkık işi OKUYARAK başlar (2026-07-29)

Devir notu yazmanın karşılığı OKUMAKTIR. `acilis` "hangi işi devralayım?" sorusunu **model
hatırasından değil okunan uçtan** yanıtlar; SessionStart hook'u (`oturum-kapanis.mjs acilis`)
çıktıyı `additionalContext` olarak enjekte eder.

```bash
node $O acilis [--ctx|--json] [--session <TAM id>]   # sinyal yoksa BOŞ çıktı + exit 0
```

| ne | nasıl |
|---|---|
| sinyal (tetik) | bu projede devir notu VAR **∨** KILAVUZ türevinde BU projeye ait sarkık kayıt |
| kaynaklar | `devirNotuBul(plansDir,…)` (şemadan geçen en taze not) · `~/.claude/oturum/oturumlar.json` |
| bütçe | **≤ 12 satır / ≤ 900 karakter** (test mühürlü); aşarsa satır DÜŞER ve `kirpilan[]`e yazılır |
| `--json` | `{sinyal, satirlar[], butce{…,tavanSatir,tavanKarakter}, kaynaklar{devirNotu,kilavuzYasSaat}, kirpilan[], muafiyet[]}` — denetçinin assert yüzeyi |

**Sert kurallar:**
- **ÜRETMEZ, OKUR.** `global` ASLA çağrılmaz (o birden çok projede `agac.mjs` koşturur).
  Türev bayatsa (> 24 sa) **BAYAT satırı** + tazeleme komutu basılır; sessizce tazelenmez.
- **ÖLÇMEZ, İŞARET EDER.** Geçerlilik ("bu iş hâlâ geçerli mi") süresi öngörülemez → hook'ta
  koşmaz; `gecerlilik.mjs --session <TAM id>` **komut satırı** basılır. TAM id yoksa satır
  "ölçülemedi (legacy kova)" der — kısa id kimlik değildir.
- **DAYATMAZ.** Bloğun ilk satırı "BİLGİ verir, görev DAYATMAZ", son satırı "Kullanıcının
  açılış isteği ÖNCELİKLİDİR" der; ikisi de satır sözlüğünün parçasıdır (doğaçlama yok).
- **Kendi kaydını önermez** (kısa id filtresi) — yeni oturum kendi devrini devralmaz.
- **İLANLI muafiyetler:** `source=resume` → tamamen sessiz (hard resume zaten bağlamı taşır) ·
  projeler-arası sarkık **tek başına tetiklemez** (DURUM bloğunun session-scoped kuralı;
  sinyal varken tek SAYAÇ satırı olarak görünür).

## Tek-yazar disiplini (İHLAL ETME)

- `INDEX.md`/`INDEX.json` → yalnız `agac.mjs` yazar. Elle düzenleme, "küçük rötuş"
  dahil YASAK — endeks kaynaklardan türetilir, türetilmeyen endeks yalan söyler.
- Plan içeriği (MASTER/asama/STATE/CHECKLIST) → `/plan-kur` ve `/goal` session'ları
  yazar. Organizatör yalnız MASTER üst bloğundaki `Kategori:`/`Üst:` alanlarına dokunur.
- `TODO.md` + `INDEX.json → todo` → yalnız `agac.mjs` yazar (INDEX kuralının aynısı).
  `TODO-ELLE.md` → insan/PM ELLE yazar (çıpa sözleşmesiyle); agac.mjs oraya yalnız dosya hiç
  yokken BİR KEZ tohum atar. `Kapatır:` satırının yazarı PLAN ÜRETİCİSİdir (`/plan-kur`);
  organizatör onu yalnız DOĞRULAR.
- `plans/oturumlar/<tarih>-<ad>.md` → o oturum ELLE yazar (tek yazarı KENDİSİ; `tohumla`
  nabızdan MONOTON tazeler: madde ekler/işaretler, asla silmez ve işareti KALDIRMAZ).
  `OTURUMLAR.md` + `~/.claude/oturum/*` → yalnız `oturum.mjs` yazar (INDEX kuralının aynısı).
- `legacy.json` → elle, kısa, gerekçeli. Format: `{"entries":[{"ad","path","tur","not"}]}`
  (path proje köküne göre). Legacy dosyalar TAŞINMAZ — referans veren araçlar
  (runner, kapılar) kırılmasın diye yerinde endekslenir.
- PM proje dosyasına doğrudan yazmaz → plan işlerini görev olarak dağıtır
  (`/plan-kur …` dispatch), sonucu INDEX/PM.json'dan okur.

## Versiyonlama yönlendirmesi (özet)

- Minor revizyon / kapsam düzeltmesi → `/plan-kur revize <slug>` → aynı slug `v(N+1)`;
  eski `v<N>` dokunulmaz; INDEX her zaman en yüksek sürümü gösterir.
- Gerçekten yeni iş → yeni slug + `kaydet`.
- Projenin tamamını anlatan plan → HER ZAMAN `proje` slug'ı (yoksa oluştur, varsa revize).

## PM/kaptan köprüsü (bu skill'in tüketicileri)

- **`/planla-kos`** (`scripts/hazirla.mjs`): `--durum --json` çıktısındaki `goal` alanının
  TÜKETİCİSİ — sıradaki aşamayı Maestro üzerinden yeni tmux session'ında ateşler. `/goal`
  satırını asla yeniden üretmez; bu skill tek kaynaktır. Harita: `~/dev/agent-ide/docs/plan-katmani.md`
- `kaptan/scripts/model.mjs → readPlans()` her projenin `plans/INDEX.json`'ını okur;
  plan ağacı `model.json`/`PM.json`'a ve `aide kaptan` panosundaki "Planlar" bölümüne girer.
- `kaptan/hedefler/<slug>.json` hedefleri opsiyonel `planRef` taşır; rollup plan
  ilerlemesini hedef ilerlemesine katar.
- Günlük Maestro işi her kayıtlı projede `agac.mjs && agac.mjs --gate` koşar
  (türet + doğrula); FAIL → alert → PM brifingi.

## Model politikası

Bu skill'in işi çoğunlukla mekaniktir (script + dosyalama) — ana loop yapar.
Kapsam karşılaştırması belirsizse (yeni-mi-revizyon-mu gri alan) karar kullanıcıya
sorulur; derin plan İÇERİĞİ işi çıkarsa o `/plan-kur`'undur (planlayici/Fable).
