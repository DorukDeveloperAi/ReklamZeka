---
name: planla-kos
description: Bir ana görevi uçtan uca yürütmeye hazırlar — /plan-kur zinciriyle (yeni ya da revizyon) TAM roadmap üretir, plan-organizatoru gate'ini doğrular, kullanıcıdan TEK turda derinlik kararlarını (titizlik · ilk koşu kapsamı · otonomi) alır ve ilk aşamanın /goal komutunu agac.mjs'ten TÜKETİP Maestro kuyruğu üzerinden YENİ tmux session'ında ateşler. Skill Enter'a basmaz; enjeksiyonu metronom daemon yapar. Kullanıcı "şunu planla ve koştur", "baştan sona yürüt", "roadmap çıkar ve başlat", "bu hedefi uçtan uca al", "planla-kos" dediğinde veya /planla-kos çağrıldığında kullan.
rol: ajan
---

# /planla-kos — Planla → Doğrula → Sor → Ateşle

Ana görev tarifini alır; planlamayı **mevcut zincire delege eder**, organizasyon kapısını
doğrular, derinlik kararlarını tek turda toplar ve ilk uygulama koşusunu **OEM `/goal`
semantiği bozulmadan** yeni bir tmux session'ında başlatır. Hiçbir katmanı yeniden yazmaz —
hepsini ÇAĞIRIR.

## Ekosistem konumu

| katman | rol | bu skill'in teması |
|---|---|---|
| **/planla-kos** (bu) | ORKESTRA: planla → doğrula → sor → ateşle | aşağıdakilerin hepsini çağırır, hiçbirini fork'lamaz |
| /plan-kur | üretici | Skill invocation ile in-session çağrılır; şablon kopyalama YASAK |
| /plan-organizatoru (`agac.mjs`) | endeks + gate + **/goal satırının TEK kaynağı** | `--gate` doğrulanır; `--durum --json`'daki `goal` alanı TÜKETİLİR |
| Maestro (/zamanla) | ateşleme | temas YALNIZ `zamanla` CLI; `tmux send-keys`/Enter YASAK |
| kaptan / PM | takip | dispatch sonrası akıbet oradan izlenir; bu skill takipçi değildir |

Makine katmanı: `scripts/hazirla.mjs` — /goal satırı tüketimi + politika ekleme + 4000ch
kapısı + tırnak kaçışı + `zamanla add` montajı LLM ağzında değil orada yaşar (kaptan
`--muhur` emsali). Varsayılanı KURU: `--dispatch` verilmeden hiçbir şey ateşlemez.

## Süreç

### Faz 0 — Bağlam + keşif (salt-okunur)

- **Proje kökü:** cwd git kökü mü doğrula (`git rev-parse --show-toplevel`). Değilse ya da
  görev başka projeyi işaret ediyorsa SOR — tahminle yanlış projeye plan yazma.
- `node ~/.claude/skills/plan-organizatoru/scripts/agac.mjs --durum --json` → mevcut ağaç.
  Ana talimatla başlık/kapsam örtüşen **açık plan adayı** var mı bak (fuzzy hükmü SEN verme:
  aday varsa Faz A sorusuna seçenek olarak taşınır; kalan gri alan organizatörün
  yeni-mi-revizyon-mu intake kuralına gider).
- `pgrep -f bin/metronom.mjs` → daemon durumu ŞİMDİ ölçülür (Faz E'de sürpriz yok), karar
  Faz E'de verilir.

### Faz A — TEK tur AskUserQuestion (en başta)

**Zamanlama gerekçesi:** titizlik planlamadan ÖNCE gelmek zorunda; kapsam+otonomi ise plana
bakmadan da POLİTİKA olarak ifade edilebilir ("aşama 1" her plan için iyi tanımlı). İki-tur
alternatifi elendi: Fable fan-out'lu planlama dakikalar sürer, ikinci tur kullanıcıyı akışın
ortasında ikinci kez masaya çağırır. Kaçış kapısı: kapsam sorusunda "planı görünce karar
veririm" → yalnız o seçilirse plan bitince mini ikinci tur açılır (opt-in iki-tur).

Tek AskUserQuestion çağrısı, en fazla 4 soru (tool tavanı 4 — taşma kuralı aşağıda):

1. **(koşullu — Faz 0 aday plan bulduysa)** "Mevcut plan: `<slug>` (v<N>, aşama k/t). Ne
   yapalım?" → `Revize et (v N+1)` / `Yeni plan aç` / `Planlamayı atla — mevcut plandan direkt koş`
2. **Titizlik** → `Hızlı` (plan-kur küçük-görev kısayolu: tek Fable ajanı; stale-plan
   taraması yüzeysel) / `Standart` (plan-kur varsayılanı: çerçeve + aşama başına fan-out) /
   `Titiz` (fan-out + ek Explore ölçümü + mevcut/bayat planların derin taranması)
3. **İlk koşu kapsamı** → `Yalnız aşama 1` / `Birkaç aşama` (Other ile sayı) / `Hepsi bitene
   kadar` (açıklamaya uyarı: büyük planda tek session bağlam tavanına çarpabilir; N öner) /
   `Planı görünce karar veririm`
4. **Otonomi** → `Sorarak ilerle` (açıklamaya uyarı: koşu bağımsız tmux penceresinde sorar —
   soru geldiğinde `tmux attach` ile girip yanıtlaman gerekir; uzaktan takip istiyorsan
   Ateşle-unut seç) / `Kapılarda dur` / `Ateşle-unut`
5. **Bağlanma (2026-08-14)** → `Bağımsız plan (Üst: —)` (önerilen İLK seçenek — planla-kos
   işi tipik koş-ve-bitir'dir, roadmap'e dikilmez) / `Master ağaca bağla (Üst: proje)` /
   `Şu dalın altına` (Other ile slug). **Taşma kuralı:** koşullu 1. soru da masadaysa toplam
   5 > tool tavanı 4 → bağlanma sorusu DÜŞER, varsayılan `Üst: —` uygulanır ve dispatch
   özetinde İLAN edilir ("bağımsız kuruldu; master'a bağlamak: organizatör intake").

Cevaplar `/plan-kur` çağrısına **girdi olarak taşınır** ("kullanıcı kararları verildi"
bloğu, `bağlanma=bağımsız|proje|<slug>` dahil — plan-kur bunu sorgusuz uygular) —
plan-kur'un kendi 1-tur hakkı saklıdır: görev-özgü bir kullanıcı kararı görürse
sorabilir (meşru; toplam tur normalde 1'dir).

### Faz B — Planlama (delege)

- Yeni plan: Skill invocation → `/plan-kur <ana görev tarifi> — [kararlar: titizlik=…,
  kapsam-politikası=…, bağlanma=…; mevcut ağaç özeti: <Faz 0 --durum çıktısı>]`
- Revizyon: `/plan-kur revize <slug> <talimat>`
- "Planlamayı atla" seçildiyse bu faz atlanır.
- plan-kur'un Faz D'si `/plan-organizatoru kaydet` + `agac.mjs` + `--gate`'i ZATEN zorunlu
  kılar — burada tekrar İSTENMEZ, yalnız Faz C'de doğrulanır (yaptırım plan-kur'da, ölçüm burada).

### Faz C — Gate doğrulaması

```bash
node ~/.claude/skills/plan-organizatoru/scripts/agac.mjs --gate    # proje kökünde
```

- FAIL sebebi YALNIZ "BAYAT INDEX" ise → **bir kez** türet (`agac.mjs`) + tekrar `--gate`
  (türetmek tek-yazar script'in kendi işi, ihlal değil).
- Hâlâ FAIL (governance: kategorisiz / kırık dal / tutarsız / yetim) → **DUR**: bulguları
  aynen bas, dispatch YOK, çözüm adresini söyle (`/plan-kur revize` ya da organizatör
  intake). *Kırmızı kapının üstünden iş fırlatan orkestra, kapıyı süs yapar.*

### Faz D — /goal satırını TÜKET + politika ekle (hazirla.mjs, varsayılan KURU)

```bash
node ~/.claude/skills/planla-kos/scripts/hazirla.mjs \
  --proje <kök> --slug <slug> \
  --kapsam 1|<N>|hepsi --otonomi sor|kapi|ates \
  --talimat "<ana talimatın ≤200ch özeti>" [--socket <ad>]
```

Script sözleşmesi (LLM bunları elle YAPMAZ):
- `agac.mjs --durum --json`'ı spawn eder, planın `goal` alanını **VERBATIM** alır — satır
  asla yeniden üretilmez; politika cümleleri `; ` ile yalnız SONA eklenir.
- Kapsam/otonomi/talimat → ek cümleler (tablo script içinde). Çok-aşama sürdürmede kritik
  özellik: sonraki aşamanın /goal satırı dispatch anında SENTEZLENMEZ — koşan session her
  aşama sonunda `agac.mjs --durum`a yeniden sorar (STATE güncellendiği için taze satır;
  tek kaynak korunur).
- **TAMAMLANMA KOŞULU açıkça ilan edilir (kapsam>1'de zorunlu — erken-teslim dersi,
  2026-07-17):** OEM /goal'un öz-hükmü satırın İLK cümlesine bakıp tek aşama sonrası
  "achieved" diyebiliyor (yaşandı: section-arsenali A0 kapandı, koşu 1/9'da kendini
  kapattı). hazirla.mjs kapsam=N/hepsi'de sona "TAMAMLANMA KOŞULU: … tek aşama kapatmak
  hedefi TAMAMLAMAZ" cümlesini ekler. Koşu yine de erken biterse kayıp yoktur — STATE tek
  gerçek kaynak; aynı dispatch komutu kaldığı yerden taze session açar.
- **eszamanli:** yapısal ihtiyaç yok — hedef projede açılan session proje CLAUDE.md'sini
  (claim protokolü dahil) otomatik yükler ve `claim-guard` hook'u mekanik reddeder.
  `hazirla.mjs` yalnız `<proje>/.claude/claims-resources.json` VARSA nezaket cümlesi ekler.
- **4000ch kapısı** (OEM /goal sınırı): kırpma sırası nezaket → talimat özeti;
  kapsam/otonomi cümleleri ASLA düşmez; yine taşarsa exit 5 + dur.
- Çıkış kodları: `0` hazır · `2` plan bulunamadı/kullanım · `3` tümü KAPALI ("koşacak iş
  yok" — revize öner, dispatch YOK) · `4` governance (aşama açık ama satır yok — dispatch
  YOK) · `5` 4000ch · `6` dispatch hatası.

KURU çıktıyı kullanıcıya GÖSTER (hangi plan, hangi aşama, eklenmiş satır, tam komut) —
dispatch öncesi somut eşleme her koşulda basılır ("planı görünce karar veririm" seçildiyse
karar burada alınır).

#### Rota bayrakları (TÜKETİCİ: `packages/rotaci/lib/eylem.mjs`, aşama 02 — İNSAN yolu KULLANMAZ)

Rotacı uygulayıcı/revize eylemini bugün `eylem.mjs` içinde ELLE monte ediyor (ikinci montaj
noktası: tırnak kaçışı, 4000ch, tier pin orada tekrar yaşıyor). Aşama 02 bunu bu chokepoint'e
devreder; hazirla o devir için aşağıdaki bayrakları taşır. **Bayraksız çağrıda zamanla'ya giden
argv BYTE-AYNIdır** (geriye uyum R-01 birinci sınıf; canlı diff + proof #10 golden).

| bayrak | ne yapar | akış |
|---|---|---|
| `--ek-metin "<m>"` | goal satırının MUTLAK SONUNA **verbatim + AYRAÇSIZ** (ayraç çağıranın malı: rota `\n\n<PROTOKOL>` ile başlatır). PROTOKOL taşıyıcısı; 4000ch'de **korumalı sınıf** (nezaket→talimat düşer, ek ASLA) | `--text` gövdesi |
| `--grup <ad> [--cap N]` | eşzamanlılık grubu + tavan. `--cap` YALNIZ `--grup` ile (grupsuz cap zamanla:199'da sessizce düşer → burada **exit 2**); N pozitif tamsayı | zamanla `--group/--cap` |
| `--muhur "<K1> <K2>…"` | done-kanıtı mührü (makine kurar). **≥2 kelime** (zamanla:118-121 aynası) — tek kelime **exit 2** | zamanla `--muhur` |
| `--on-fail park\|retry` | hata politikası (içerik yorumlanmaz — ince geçiş R-07) | zamanla `--on-fail` |
| `--manual` | `--at` çıkar → iş **tetiksiz** doğar (trigger.manual'i zamanla:177 yazar); run-now onay-valfi. `izle` → onay yolu | tetik zinciri |
| `--title-onek "<ön>"` | başlığın BAŞINA verbatim — rota **dedupe anahtarı** (`title.includes('rota:<fp>:')`) | `--title` |
| `--asama <no>` | goal'ü agac `plan.hazir[]`'den O aşamadan **VERBATIM** çeker (kapsam/otonomi cümleleri normal). Aşama hazir'da yoksa **exit 4** (bayat-karar koruması). Session `planla-kos-<slug>-a<NN>` | goal kaynağı |
| `--ham-metin "<m>"` | agac TÜKETİLMEZ; goal = bu metin (revize gibi /goal-dışı görevler). kapsam/otonomi/talimat/nezaket EKLENMEZ. `/goal ` önekli metin **exit 2** (goal tek-kaynak kilidi). Session `<slug>-ham` | goal kaynağı |

İçerik yorumlanmaz, yalnız taşınır (iki AYNA ön-kontrol hariç: cap-grupsuz · mühür-tek); tier pin
(`--new-cmd`) **tüm** yeni yollarda akar; `--json` alan adları değişmez — yeni bilgi yeni alanlarla
(`manual` her zaman; `rota:{grup,cap,muhur:!!,onFail,titleOnek,ekMetinChars,…}` bir rota bayrağı verildiyse).
02 devir sözleşmesi: eylem.mjs'in bugün ürettiği bayrak kümesi (`--group rota:<slug>` · `--cap N` ·
`--muhur ROTA-KANIT <fp>` · `--on-fail park` + title öneki + `--asama`/`--ham-metin`) hazirla ÜZERİNDEN
üretilebilir — 02 başlarken ek hazirla değişikliği gerekmez.

### Faz E — Dispatch (Maestro, yeni tmux session)

Ön kontroller:
- **Daemon:** `pgrep -f bin/metronom.mjs`. Kapalıysa dispatch ETME; üç seçenek bas:
  (a) daemon'u başlat (`bun /Users/ybg/dev/agent-ide/packages/maestro/bin/metronom.mjs
  start`) + sonra dispatch, (b) hazır /goal satırını elle yapıştır, (c) hazır `zamanla add`
  komutu — kuyruk kalıcı, daemon açılınca ateşler.
- **Soket:** canlı claude pane'lerinin soket çoğunluğu — `bun
  ~/.claude/skills/kaptan/scripts/durum.mjs --json` → `sessions[].tmux.socket` (mevcut
  cevap kaynağını çağır, kendi tespit yöntemini yazma). Hiç pane yoksa `--socket` verilmez.
- **Trust:** `~/.claude.json → projects[<kök>].hasTrustDialogAccepted` false ise uyar
  (daemon dialog'u meşgul sayar, enjeksiyon bekler; dialog'u asla kendin yanıtlama).

Ateşleme: `hazirla.mjs` aynı argümanlarla + `--dispatch` (komutu kendisi exec eder, job id
basar; `--new-cmd` verilmez — daemon varsayılanı `claude` açar).

**Bilinçli mimari karar:** çok-aşama kapsamında bile **TEK job** dispatch edilir;
`--after-ok` job zinciri KURULMAZ. Gerekçe: `--text` işinin terminali `dispatched`tır
(done-kanıtı yok), zincir mühür altyapısı ister VE sonraki aşama satırlarının erken
sentezini gerektirirdi (tek-kaynak ihlali). Sürdürme koşan session'ın İÇİNDE yaşar.

**Görünürlük (kullanıcı kararı 2026-07-16, varsayılan AÇIK):** metronom, spawn ettiği HER
oturum için macOS Terminal penceresini kendisi açar (`tmux.mjs makeVisible` — tek
chokepoint; bu skill İKİNCİ pencere açmaz). Kapatma Maestro tarafında:
`packages/maestro/config.json → "spawn_visible": false`. Attach yalnız izleyicidir;
enjeksiyon sözleşmesi değişmez.

Dispatch sonrası doğrulama + rapor:

```bash
aide zamanla list | grep <jobId>
```

Rapor içeriği: job id · tetik (+5s) · "Terminal penceresi ~5sn içinde kendiliğinden
açılacak" notu · yedek izleme yolu (hazirla çıktısındaki `izle` komutu / `aide` kokpiti) ·
**dispatched ≠ done** hatırlatması · akıbet adresi (`agac.mjs --durum` / kaptan brifingi).

**Rota-modu önerisi (gözetimsiz sürdürme):** kapsam **hepsi / çok-aşama** VE otonomi gözetimsiz
sürdürme ise, TEK-job dispatch'in yanında `aide rota kur --proje <kök>` **ÖNER** — böylece
`dispatched ≠ done` takibi (sıradaki aşamayı hazır olunca ateşleme, hüküm, revize) 30dk'lık
Rotacı tick'ine devrolur. Skill bu kurulumu **KENDİSİ KOŞMAZ** (öneri metnidir; kurulum insan/PM
kararı) — Maestro teması yalnız `hazirla.mjs --dispatch`'tir.

## `slot.mjs` — sıradaki işi bu oturum ÜSTLENİR (otonomi-merdiveni:04 · B1)

`hazirla.mjs` yeni bir tmux oturumu ateşler; `slot.mjs` ise **bu turda koşulacak** işi seçer.
Motor · deterministik · 0 token · **fan-out YOK** (çıktı bir komut metnidir, çalıştıran insandır).

- `node slot.mjs oner [--n 5]` — **K0**: hazır aday listesi + her biri için `/goal` komutu.
  Salt-okur (claim ALMAZ, yazmaz); aday yoksa **0 bayt**. Canlı session ve aktif claim taşıyan
  aşamalar elenir; sıra `agac.mjs`in künye türevidir (ikinci sıralayıcı YOK).
- `node slot.mjs al --slug <s> --asama <no> [--zorla]` — **K1**: YALNIZ kullanıcı komutuyla.
  Kapılar sırayla: `oturum.mjs bu` (exit 2 = ölçülemedi → K0'a düşer, sessiz başlatma YOK) →
  ardışık çekiş tavanı N=1 (oturum defterinden TÜREVDİR; `--zorla` aşar) → claim → `hazirla`
  exit 4 yutulmaz (claim BIRAKILIR). Çıkışlar: 0 alındı · 1 red · 2 ölçülemedi · 3 çakışma · 4 bayat.

Ayrıntı: `docs/otonomi-merdiveni.md` §1 (B1 satırı) ve §3 (öz-tetikleme sınırı).

## Kenar dalları

| durum | davranış |
|---|---|
| Aynı konuda mevcut açık plan | Faz A sorusuna taşınır; gri alan organizatör intake'ine |
| Tüm aşamalar KAPALI | hazirla exit 3 → "koşacak iş yok" + `revize` önerisi; dispatch YOK |
| `--gate` FAIL | 1× türet (yalnız bayat-damga); governance bulgusu → dur + bulgular + adres |
| Aşama açık ama goal satırı yok | hazirla exit 4 → governance raporu; dispatch YOK |
| Daemon kapalı | dispatch etme; başlat + elle-yapıştır + kuyruğa-yaz fallback'leri bas |
| 4000ch taşması | script kırpma sırasını uygular; kapsam/otonomi düşürülemiyorsa exit 5 + dur |
| `plans/` hiç yok | normal yol — plan-kur oluşturur (gate boş kapsamı PASS ilan eder) |
| cwd proje kökü değil | SOR — tahmin yok |

## Sert kurallar (bu skill ASLA)

1. `tmux send-keys` çağırmaz / Enter'a basmaz — Maestro teması yalnız `zamanla` CLI
   (`hazirla.mjs --dispatch` üzerinden).
2. /goal satırını kendisi YAZMAZ — `agac.mjs --durum --json`'daki `goal` alanı tüketilir;
   augmentasyon yalnız sona cümle ekler.
3. `plans/INDEX.*`'e ve plan içerik dosyalarına dokunmaz (yazarlar: agac.mjs · plan-kur ·
   /goal session'ları).
4. plan-kur / plan-organizatoru'yu fork'lamaz, şablonlarını kopyalamaz — Skill invocation
   ile çağırır.
5. Gate FAIL'in üstünden dispatch etmez.
6. `--after-ok` zinciri kurmaz; kırmızı iş onay valfine takılırsa `run-now` ile KENDİSİ
   onaylamaz (insan onayı — kaptan sert kuralı).
7. Elle isim listesi tutmaz — plan/aşama/komut `agac.mjs`'ten, soket `durum.mjs`'ten türer.

## Kanıt

`node ~/.claude/skills/planla-kos/proof/proof.mjs` — fixture `plans/` ağacıyla, gerçek koşu
yakmadan: verbatim-tüketim (hazirla çıktısı `goal` alanıyla prefix-birebir) · bitti-dalı
(exit 3) · governance-dalı (exit 4 + gate FAIL yakalanır, kapı KIRMIZI yanabilir) · 4000ch
kırpma sırası (kapsam/otonomi hayatta) · gerçek dispatch döngüsü (`--at +10m` job doğar →
list'te görünür → cancel; hiç ateşlenmez). Canlı smoke: gerçek projede `hazirla.mjs` KURU
çıktısı ↔ `plans/INDEX.md` "Hazır komut" karşılaştırması.

**Rota devri (aşama 02 tüketicisi):** byte-uyum golden-argv (bayraksız argv config-türetimli
kanonik dizi — sabitleme YOK) · rota pass-through (ek-metin AYRAÇSIZ mutlak son + hamGoal prefix +
argv çiftleri + title öneki + tier akışı) · ek-metin kırpılmazlığı (nezaket/talimat düşer, ek
biter-pozisyonda; sıkışınca exit 5) · manual/cap/mühür kapıları (exit 2) · gerçek manual→kuyruk
döngüsü (`zamanla list`'te trigger.manual:true + tetiksiz; benign manual onay[]'da değil; run-now
BASILMADAN cancel) · idempotens · `--asama` hazir-dışı exit 4 · `--ham-metin` `/goal` reddi exit 2.
