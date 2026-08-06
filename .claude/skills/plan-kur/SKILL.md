---
name: plan-kur
description: Herhangi bir ana görevi (genel/geniş VEYA spesifik) hiyerarşik planlama ajanlarıyla TAM bir yol haritasına çevirir — ana çerçeve (Fable) → aşama başına ayrı planlama ajanı fan-out (Fable) → komple plan + checklist + requirements içeren versiyonlanabilir roadmap (plans/<slug>/v<N>/). Aşamalar /goal ile fire-and-forget koşulur. Kullanıcı "roadmap çıkar", "komple plan yap", "bunu planla, aşama aşama koşacağım", "plan-kur", "planı revize et / v2 yap", "planın durumu ne" dediğinde veya /plan-kur çağrıldığında kullan.
rol: ajan
---

# /plan-kur — Hiyerarşik Roadmap-Planlama

Ana görev tarifini alır; **ana çerçeve → aşama kırılımları → birleştirme** zinciriyle,
tek yerde yaşayan, versiyonlanabilir bir roadmap üretir. Roadmap İŞ değil **SONUÇ**
tarif eder: her madde ya somut subtask taşır ya da subtask'ları ÜRETECEK ölçüm/komut
("bulgu-üretici") + requirement taşır. Kullanıcı aşamaları `/goal` ile ayrı ayrı,
ateşle-unut koşturur.

## Çağrı biçimleri

| çağrı | iş |
|---|---|
| `/plan-kur <ana görev tarifi>` | yeni roadmap → `plans/<slug>/v1/` |
| `/plan-kur revize <slug> [talimat]` | mevcut roadmap'ten v(N+1) (AYNI yaklaşım) |
| `/plan-kur revize <slug> --pivot [talimat]` | v(N+1) YAKLAŞIM DEĞİŞİKLİĞİyle (otopsi zorunlu; TEK hak) |
| `/plan-kur durum <slug>` | STATE + checklist özeti + sıradaki aşamanın hazır `/goal` komutu |

`<slug>`: görevden türetilen kısa kebab-case ad (`proje` slug'ı REZERVE — proje ana planı tektir).
Çıktı yeri: **çağrıldığı projenin kökü** `plans/<slug>/v<N>/`; proje yoksa (ya da kullanıcı
isterse) sentetik kök **`~/.claude/plan-global/plans/<slug>/v<N>/`**.

> `~/.claude/plans/` DEĞİL: orası OEM plan-modunun düz `.md` karalama alanıdır (governance'sız,
> ad-uzayı çakışmalı) ve `readPlans()` proje kökü beklediği için oraya yazılan plan panoya
> yapısal olarak giremez — yani governance'sız VE tüketicisiz doğardı. Sentetik kök üçünü de
> çözer: `agac.mjs --proje ~/.claude/plan-global` değişmeden çalışır ve günlük gate işi onu tarar.

## Ekosistem (bu skill tek başına değil — kaptan/PM'in TOOL'udur)

| katman | rol | temas |
|---|---|---|
| **/plan-kur** (bu) | ÜRETİCİ: roadmap'i yazar (v'li klasör) | dosyaları yazar, sonra kaydeder ↓ |
| **/plan-organizatoru** (`~/.claude/skills/plan-organizatoru/scripts/agac.mjs`) | ENDEKS + governance: `plans/INDEX.md` + `INDEX.json` TEK YAZARI; kategori/ağaç/damga/`--gate` | Faz D sonunda ve her revizyonda çağrılır |
| **/planla-kos** (`~/.claude/skills/planla-kos/`) | ATEŞLEYİCİ: planla → gate → tek tur derinlik sorusu → sıradaki aşamayı Maestro üzerinden yeni tmux session'ında koşturur | bu skill'i ÇAĞIRIR; kullanıcı "planla ve koştur" derse giriş kapısı odur |
| **kaptan / PM / görevler** | TÜKETİCİ: `INDEX.json` üzerinden planlar dashboard'da (Planlar bölümü, planRef); PM plan üretmek istediğinde /plan-kur'u çağırır, takip için `agac.mjs --durum` okur | plan-kur onların yerini almaz, onları besler |

Zincirin haritası (roller · değişmezler · veri akışı): `~/dev/agent-ide/docs/plan-katmani.md`

Kurallar: `plans/INDEX.*` **ASLA elle yazılmaz** (tek yazar agac.mjs). MASTER.md üst bloğu
planın **KÜNYESİNİ** taşımak ZORUNDA — governance kapısı (`agac.mjs --gate`) kategorisiz/
kırık-dallı planı ve **şema dışı künye değerini** FAIL eder:

```
> Kategori: <proje|özellik|altyapı|süreç|araştırma> · Üst: <üst-plan-slug ya da —>
> Kritiklik: <düşük|orta|yüksek|kritik> · Aciliyet: <ertelenebilir|normal|yakın|acil> · Hacim: <küçük|orta|büyük|epik>
> Hedef: <TEK cümle — bu plan bitince dünyada ne değişmiş olur>
```

**Künye = planın kimlik kartı** (aide felsefesi, 2026-07-26): "hangi plan önce koşsun"
sorusunu tahmin değil künye yanıtlar. `Kritiklik` = olmazsa ne kırılır (önem ekseni) ·
`Aciliyet` = zaman baskısı · `Hacim` = iş büyüklüğü (slot/bütçe planlaması) · `Hedef` =
tek cümlelik varış hali (BAŞARI'nın kısa yüzü; ölçülebilir tanım "Amaç ve başarı"da kalır).
**`oncelik` (P0–P3) TÜREVDİR — MASTER'a ELLE YAZILMAZ:** `agac.mjs` hesaplar
(`min(3, round((kritiklik+aciliyet)/2))`, Eisenhower ekseni) ve INDEX/graf/Rotacı/PM'e
dağıtır. Tüketici kendi ölçütünü yazmaz, künyeyi okur (`agac.mjs --kunye [--json]`).
Künye **eksikse** ADVISORY (legacy plan koşar, sıranın sonuna düşer); **geçersizse** gate FAIL.
Revizyonda künye de taşınır: değişiyorsa REVIZYON bloğunda gerekçesiyle, değişmiyorsa "aynen".
STATE.md "Aşama durumları" tablosunun sütun düzeni (`# · aşama · durum · bağımlı · son dokunuş ·
kanıt`) ve durum sözlüğü (`AÇIK · SÜRÜYOR · KAPALI · BLOKE`) agac.mjs parser sözleşmesidir —
değiştirme. Sütunlar başlık SATIRINDAN eşlenir (ad sözleşmesi); `bağımlı` sütunu DAG modelidir:
`00, 01` = VE (hepsi KAPALI olmalı) · `01/02` = VEYA (biri yeterli; ayraç `/` — `|` markdown
tablo hücresini böler, YASAK) · `kalite-turu:03` = çapraz-plan gate · `—` = başlangıç düğümü
(rota başı). YENİ plan üretirken bu sütunu MASTER
aşama tablosundaki `bağımlı` ile BİREBİR aynı yaz (uyumsuzluk governance FAIL'idir); eski plana
sütunu elle değil `agac.mjs --bagimlilik-tohumla` ile ekle. agac.mjs bundan `hazir[]` (ready-set:
paralel koşulabilir aşamalar), `bekleyen[]` ve `--graf` (plan ağı haritası) türetir; döngü ve
kopuk bağ gate'te FAIL'dir.

## Model politikası (ZORUNLU)

Tüm planlama `Agent(subagent_type:"planlayici", model:"fable")` ile delege edilir —
kanon: `~/.claude/CLAUDE.md` ("Fable yürütmez, Opus planlamaz"; ihlali `model-policy-guard`
hook'u reddeder). Ana loop yalnız: bağlam toplar (Explore), ajan çıktısını **birleştirir ve
dosyalara döker**, kullanıcıya `/goal` komutlarını verir. Ana loop kendi başına aşama
İCAT ETMEZ — aşama sınırları ve içerik Fable'dan gelir; ana loop projeksiyon yapar.

## Süreç

### Faz A — Bağlam toplama (ana loop)
- Görev bir kod tabanına/altyapıya dokunuyorsa: 1–3 **paralel Explore** ajanı ile ÖLÇÜM
  (mevcut araçlar, envanterler, sayılar, açık borçlar). Dokunmuyorsa atla.
- Elde hazır ölçüm/analiz varsa (önceki session, mevcut rapor) YENİDEN ölçme — girdi olarak taşı.
- Kullanıcıya **en fazla 1 tur** AskUserQuestion: yalnız kullanıcıya ait kararlar
  (kapsam sınırı, sertlik/kanıt seviyesi, tempo, bütçe). Koddan çözülebilecek şeyi sorma.
- **KÜNYEYİ belirle (kategori · üst · kritiklik · aciliyet · hacim · hedef):** kategori
  (proje·özellik·altyapı·süreç·araştırma) görevden çıkarılabiliyorsa çıkar; Üst dalı mevcut
  ağaçtan oku (`node ~/.claude/skills/plan-organizatoru/scripts/agac.mjs --durum`). Kritiklik
  ve aciliyet **kullanıcıya ait kararlardır** — koddan çıkarsanamaz; belirsizse 1-tur soruya
  DAHİL ET (mevcut sırayı `--kunye` ile göster ki kullanıcı yeni planı ona göre konumlasın).
  Hacim Faz B/C efor notlarından türer (küçük: tek aşama · orta: 2-4 · büyük: 5-8 · epik: 9+). **Yeni plan mı revizyon mu** şüphesi varsa /plan-organizatoru
  denetimine uy: mevcut bir planın kapsam düzeltmesi → `revize` (v(N+1)), yeni plan AÇMA.

- **Genel TODO'yu OKU (ZORUNLU):** `node ~/.claude/skills/plan-organizatoru/scripts/agac.mjs --todo --json`
  → çıktıdaki **plansız** maddelerden (elle madde + `kapatan` boş) bu görevin kapsamına girenleri
  belirle; kapsananları Faz D'de MASTER `> Kapatır:` satırına yaz. Böylece yeni plan, projenin
  zaten bilinen iş listesine BAĞLANIR — aynı iş ikinci kez planlanmaz, plansız kalan iş görünür olur.
  Komut yoksa/başarısızsa (eski kurulum) adımı **İLAN EDEREK ATLA** — plan üretimi DURMAZ
  (graceful default, model-policy emsali). **utopya sınırı:** TODO `uy:` çıpası taşımaz; utopya
  isteği ancak İŞE dönüşünce TODO'ya düşer — `Kapatır:` yalnız `td:` referansı alır.

### Faz B — Ana çerçeve (1× planlayici/Fable)
Girdi: görev tarifi + Faz A ölçümleri + kullanıcı kararları. Ajan promptuna şu çıktı
sözleşmesini birebir koy:

> Çıktın şunları içermeli:
> 1. **Aşama listesi** — her aşama: `id · ad · SONUÇ ifadesi (ölçülebilir ürün-gerçeği
>    yüklemi; "X yapılır" değil "X artık şöyledir") · kapsam · bağımlılıklar`.
>    Aşamalar /goal-boyutunda olmalı: tek bir session'ın bir oturuşta bitirebileceği,
>    kendi kanıtını üretebilen birimler.
> 2. **Global requirements** — ölçülebilir yüklemler; her biri "hangi komut/kanıt bunu doğrular".
> 3. **Başarı tanımı + durma kuralı** — roadmap ne zaman BİTMİŞtir; yakınsama nasıl ölçülür
>    (loop-until-dry vb.); STUCK/eskalasyon koşulu.
> 4. **Riskler + İLAN EDİLMİŞ muafiyetler** — kapsam dışı bırakılan her şey gerekçesiyle
>    (sessiz kırpma yasak).

### Faz C — Aşama kırılımları (N× planlayici/Fable, PARALEL fan-out)
Her aşamaya **ayrı** bir planlama ajanı; hepsini TEK mesajda paralel gönder.
Girdi: ana çerçevenin tamamı + o aşamanın briefi + ilgili ölçümler. Ajan promptuna şu
çıktı sözleşmesini birebir koy:

> Bu aşama için çıktın:
> 1. **Task listesi** — her task: `SONUÇ ifadesi` + şunlardan BİRİ:
>    (a) somut subtask'lar (adım adım, dosya/komut düzeyinde), YA DA
>    (b) **subtask-üretici**: subtask'ları üretecek ölçüm/komut + o komutun bulgularının
>    nasıl task'a çevrileceği kuralı + requirement. (Bulgu kaybolunca task kapanır —
>    liste bayatlayamaz.)
> 2. **Task-düzeyi checklist** — her maddede kabul kriteri: "hangi kanıt bu maddeyi kapatır"
>    (komut + beklenen çıktı). "Yapıldı" hissi değil, kanıt.
> 3. **Requirements** — aşamaya özgü; önkoşullar ve aşamalar-arası bağımlılıklar açık.
> 4. **Doğrulama** — aşama bitince uçtan uca nasıl kanıtlanır (idempotens dahil: iki kez
>    koşmak hükmü değiştirmemeli).
> 5. **Efor/maliyet notu** — tarayıcı-ağır mı, token-ağır mı, tahmini süre.

### Faz D — Birleştirme + yayın (ana loop)
`sablonlar/` iskeletlerine dökerek yaz (şablonlar bu skill'in klasöründe):

```
plans/<slug>/v1/
  MASTER.md        # çerçeve, bağımlılık grafiği, başarı tanımı, aşama→/goal komut tablosu
  CHECKLIST.md     # GENEL checklist (aşama maddeleri) + her maddenin task-checklist bağı
  REQUIREMENTS.md  # global + aşama-bazlı requirements tek toplamda
  asama-01-<ad>.md # aşama detayı: tasklar, subtasklar/üreticiler, kabul kriterleri, doğrulama
  asama-02-<ad>.md …
  STATE.md         # ilerleme defteri: aşama durumları, tur günlüğü
  REVIZYON.md      # (yalnız v2+) neyin neden değiştiği
```

Kurallar:
- Her `asama-NN-*.md` **kendi başına yeterli** olmalı: taze bir /goal session'ı yalnız o
  dosyayı (+ MASTER.md atfını) okuyarak işi bitirebilmeli. Bağlamı dosyanın başına göm.
- CHECKLIST maddelerinin HER biri ya subtask ya subtask-üretici taşır; çıplak
  "yapılacak" maddesi YASAK.
- **Doğrulama kanıta bağlanır (`kanit.json`):** REQUIREMENTS'taki her doğrulama mümkünse
  `kanit:<giriş-adı>` olur (projenin `.claude/kanit.json` tablosundaki hizli/tam/surus girişi;
  hakem `aide rota kanit` ile koşar). **Roadmap YENİ bir kanıt komutu icat ediyorsa** (yeni
  test/derleme/sürüş), o girişi `.claude/kanit.json`'a eklemek **PLANIN bir TASK'ıdır** —
  çıplak serbest-metin doğrulama ("testler geçer") YASAK, ölçülemez.
- **`Kapatır:` satırı (genel TODO bağı):** plan, Faz A'da okuduğun genel-TODO maddelerinden
  birini/birkaçını kapatıyorsa MASTER künye bloğuna TEK satır ekle:
  `> Kapatır: td:<etiket>/<ref>[, td:<etiket>/<ref>…]` (ayraç virgül; ref biçimi
  `agac.mjs --todo --json` çıktısındaki `ref` alanıyla **BİREBİR** — elle uydurma).
  Kapsanan madde YOKSA satırı **HİÇ YAZMA** (boş `Kapatır:` YASAK — yokluk "kapatmıyor" demektir).
  **Ters yön TÜREVDİR:** madde→plan bağını `agac.mjs` kurar (`todo.maddeler[].kapatan`) ve
  `--kunye` plansız madde sayısını raporlar — bu alan REZERV DEĞİLDİR, tüketicisi bu ikisidir.
  Biçimsiz ref `--gate`'i **FAIL** eder (sessizce bağsız kalmasın); şemalı ama karşılığı olmayan
  ref **ADVISORY** + `onar:` üretir, gate'i KIRMAZ (türev maddeler uçucudur — künyeden farkı:
  Kapatır sıralamayı etkilemez, yalnız kapsama raporunu besler).
- **KAYDET (zorunlu son adım):** `/plan-organizatoru kaydet <slug>` intake'ini uygula —
  yeni-mi-revizyon-mu double-check + Kategori/Üst doğrulaması + INDEX türetimi (makine katmanı:
  proje kökünde `node ~/.claude/skills/plan-organizatoru/scripts/agac.mjs`, ardından `--gate` PASS).
  Plan böylece kaptan/PM dashboard'una girer (INDEX.json → readPlans → PM.json "Planlar").
  Not: proje ana planı (`proje` slug'ı) varsa yeni planların `Üst:`ü çoğunlukla `proje`dir;
  ana plan sonradan doğarsa mevcut planlar organizatör intake'iyle yeniden ebeveynlenir.
- Son çıktı olarak kullanıcıya, aşama başına yapıştırılmaya hazır komut listesi bas:
  `/goal plans/<slug>/v1/asama-NN-<ad>.md planını uygula; bitince aynı klasördeki STATE.md ve CHECKLIST.md'yi güncelle; kanıt yollarını STATE.md'ye yaz`

### Koşum türü (`kosum:`) karar kılavuzu

Her `asama-NN-*.md` başında opsiyonel `kosum:` frontmatter alanı vardır (şablon `tek-ajan`
ile gelir). Bu alan aşamanın **nasıl koşulacağını PLAN YAZIMINDA beyan eder** — koşum anında
LLM/heuristic karar VERMEZ (R1); `agac.mjs` değeri yalnız parse edip `hazir[]`'a taşır, köprü
(aşama 03) oradan tüketir.

Şema **kapalıdır, iki değer**:
- **`kosum: tek-ajan`** — VARSAYILAN. Aşama tek bir /goal oturumunun (Opus ana loop) bir
  oturuşta bitireceği iş.
- **`kosum: workflow:<sablon-ref>`** — aşama çok-ajanlı bir Workflow ile koşulur; `<sablon-ref>`
  aşama 02 workflow kütüphanesindeki şablon adıdır (`[a-z0-9-]+`).

**`workflow` yalnız şu üç ölçütten BİRİ tuttuğunda seçilir; aksi HER durumda `tek-ajan`:**
1. **≥3 bağımsız paralel parça** — aşama, birbirinden bağımsız ≥3 alt-işe bölünüyor (paralel
   fan-out gerçek hızlanma verir).
2. **Adversarial doğrulama şartı** — bulgu/hüküm bağımsız skeptik ajanlarca (refute-et) sınanmalı
   (tek ajan kendi çıktısını yeterince kıramaz).
3. **Adım-memoizasyonu isteyen uzun zincir** — kesinti/limit sonrası `resumeFromRunId` ile
   adım-cache'ten devam kritik (uzun, pahalı, tekrarlanabilir aşamalar).

**Anthropic dersi (varsayılan neden `tek-ajan`):** çok-ajanlı koşum tek-ajanın **~15x token**
maliyetidir — `workflow` İSTİSNADIR, varsayılan değil. Ölçütlerden hiçbiri net tutmuyorsa
`tek-ajan` yaz. Geçersiz değer (`tek-ajan`/`workflow:<ref>` dışı) `agac.mjs --gate`'i
`GEÇERSİZ KOŞUM` ile FAIL eder.
### Küçük görev kısayolu
Görev küçükse (tahminen ≤3 aşama), Faz B ve C **tek Fable ajanında** birleştirilebilir
(çıktı sözleşmeleri aynen; yalnız fan-out atlanır). Dosya yapısı değişmez.

## Revizyon (`revize <slug> [talimat]`)

1. En yüksek `v<N>` okunur + `STATE.md`'deki gerçekleşme.
2. Kullanıcı talimatı + (gerekirse yeni Faz A ölçümü) Fable'a verilir → **yalnız değişen
   aşamalar yeniden kırılır**; değişmeyenler kopyalanır, yeniden planlatılmaz (kanıt ekonomisi).
3. `v<N+1>/` yazılır; v<N> DOKUNULMAZ. Tamamlanmış checkbox'lar + STATE işaretli taşınır.
   **KÜNYE de taşınır** (kritiklik·aciliyet·hacim·hedef): revizyonun sebebi çoğu zaman künyeyi
   de değiştirir (kapsam daraldı → hacim düştü; borç büyüdü → aciliyet arttı). Değişiyorsa
   REVIZYON bloğunda gerekçesiyle yaz; değişmiyorsa "aynen" de.
4. `REVIZYON.md`: **kümülatif defter — bu revizyonu tek blokla ekle, önceki blokları AYNEN taşı.**
   Blok makine-okunur başlıkla açılır (Rotacı `fiili.revizyonlar` parser'ı bu satırdan revize/pivot
   sayısını türetir; sayaç dosyası YOK): `## r<N> — tip: revize|pivot — <YYYY-MM-DDTHH:mmZ>`
   (`revize` = aynı yaklaşım). Altında serbest gövde: neyin neden değiştiği, taşınan/yeniden kırılan
   aşamalar. Başlık sözleşmesini bozma — parser eşleşmezse Rotacı revizyon sayısını YANLIŞ sayar.
5. KAYDET: `agac.mjs` yeniden koş (INDEX v(N+1)'i göstersin) + `--gate` PASS.

### `--pivot` modu (YAKLAŞIM DEĞİŞİKLİĞİ — TEK hak)

`revize` aynı yaklaşımı yamar; **`--pivot` yaklaşımı DEĞİŞTİRİR.** Rotacı bunu yalnız hakem 2 kez
EKSİK verdiğinde, `profil.pivot` açık ve kadran `tam` iken (en riskli otonom karar) ateşler; insan
da doğrudan çağırabilir. Normal revizyon akışının üç FARKI:

- **(a) v(N+1) MASTER'ında ZORUNLU `## Önceki yaklaşımın otopsisi`:** hangi yaklaşım 2 turda neden
  tutmadı; yeni yaklaşımın FARKI nedir. Cümlesi birebir: "AYNI yaklaşımın üçüncü denemesi YASAK."
  Otopsideki dersi tek-cümlelik kurala çevirip MASTER `## Riskler`e ekle (ders → kural).
- **(b) REVIZYON bloğu `tip: pivot`:** `## r<N> — tip: pivot — <ts>` (parser bunu sayar; bir pivot
  sonrası revize sayacı SIFIRLANIR, ikinci pivot mekanik olarak `pivot-tavani` → İNSAN).
- **(c) kalan revize akışı (adım 1-5) aynen** uygulanır.

Pivot bir planın **TEK hakkıdır**: v(N+1) de EKSİK gelirse Rotacı revize/pivot ATEŞLEMEZ → KESİN
insan (2 revize + 1 pivot = 5 tur tavanı).

## Durum (`durum <slug>`)

**Delege et, yeniden yazma** (Ders 17): `node ~/.claude/skills/plan-organizatoru/scripts/agac.mjs --durum`
zaten aşama durumlarını, sıradaki aşamayı ve hazır `/goal` komutunu basar. Bu skill yalnız
istenirse ilgili slug'ın STATE.md tur günlüğünden ayrıntı ekler. Hiçbir şey yazma (salt-okunur).

## Kalite sözleşmesi (üretilen her roadmap için)

- **İş değil SONUÇ:** her aşama ve task, tamamlandığında DÜNYANIN nasıl olacağını söyler.
- **Kanıt zorunlu:** her kabul kriteri bir komut/gözlem + beklenen çıktıdır. Mümkünse mevcut
  bir kapıya DELEGE edilir; yeni ölçüt icat etmeden önce "bu soruyu yanıtlayan kaynak zaten
  var mı?" sorulur (varsa çağrılır, kopyalanmaz).
- **Muafiyet ilan edilir:** kapsam dışı her şey gerekçesiyle MASTER.md'de yaşar.
- **Bayatlamaya karşı:** statik subtask listesi yerine mümkün olan her yerde subtask-üretici;
  elle yazılan tek şey niyettir.
