# plan-organizatoru — kanıt sonucu

> Koşu: 2026-07-29 · `node ~/.claude/skills/plan-organizatoru/proof/proof.mjs` → **52/52 PASS**
> (2026-07-27: 40/40 · seviye-0-otonomi v1 aşama-05 **devir notu** kümesiyle +12)
> Kural: yeşil yanan kapı değil, KIRMIZI YANABİLEN kapı kanıttır — her denetimin
> bilerek bozulup FAIL ürettiği senaryosu harness'ın içindedir.

## Kapsam

| küme | kanıt |
|---|---|
| türetme | INDEX.md+INDEX.json doğar · ikinci koşu **bayt-aynı** (idempotens) |
| tazelik (Ders 16) | içerik damgası: STATE değişince `--gate` FAIL + "BAYAT INDEX"; yeniden türet → PASS |
| governance | proje-planı-tektir · yetim dizin (legacy ilanı bulguyu düşürür) · kırık dal (Üst) · KAPALI+açık-checklist tutarsızlığı · kategorisiz plan · legacy kırık yol — hepsi kırmızı yanabildi |
| versiyonlama | v2 eklenince INDEX en yükseği gösterir, v1 **bayt-aynı** dokunulmaz |
| gerçek proje | dorukcom06: gate PASS, `kalite-turu` (diğer session'ın /plan-kur çıktısı) INDEX'te |
| oturum (çift dikiş) | hüküm üçe ayrılıyor (TAM·EKSİK·SÜRÜYOR) · kapalı hedef açılınca **TAM DÜŞER** · `bu` açık işte exit 1 / TAM'da 0 · beyansız plan ADVISORY ama **biçimsiz beyan gate FAIL** · çıpa uyuşmazlığı FAIL · `kunye.oturum` INDEX.json'a yayılıyor · EKSİK oturum TODO'ya **tek satır** (döküm değil) · SÜRÜYOR madde ÜRETMEZ · kılavuz SIRALI + TAM listelenmez · backfill kuru koşumda yazmaz, git'siz projede **uydurmaz** |
| oturum kapanış hook'u | eşik ALTINDA dosya AÇMAZ · eşik ÜSTÜNDE açar + nabızdan tohumlar + `Durum: KAPALI` damgalar + roll-up & global kılavuz türetir · `plans/` olmayan klasörde HİÇBİR ŞEY yapmaz (exit 0) · izole `CLAUDE_CONFIG_DIR`de koşar (gerçek profile dokunmaz) |
| devir notu (aşama-05) | not doğar + `devirDogrula` PASS + **TAM** session id · `siradakiAdim` deterministik zinciri (in_progress → ilk açık hedef → null) · **idempotens** (2. koşum bayt-özdeş, "aynı — yazılmadı") · transcript yokken **uydurmaz** (`olculemedi` ilanı), varken ilk/son ANLAMLI isteği çıkarır (`BOS_ISTEK` + `<system-reminder>` filtresi) · **sır eleği** (sahte `sk-ant-` token nota SIZMIYOR, `«sır elendi»` ilanı) · K9 devam önerisi yok→null / bozuk→null / geçerli→taşınır · **bozuk şema FAIL** (eksik alan · sürüm uyuşmazlığı · şema dışı çıpa · kısa-id-tek-başına), bilinmeyen alan SERBEST · defter yoksa **exit 2 + onar** ve `devir/` dizinini UYDURMAZ · **`release_all` yarışı**: kilit bırakıldıktan sonra da ARŞİVDEN `birakildi` olarak nota düşer · roll-up İLANI (`OTURUMLAR.md` + global `KILAVUZ.md`) · `devir/` dizini varken plan+oturum gate PASS, YETİM bulgusu yok · **SessionEnd zinciri** notu gerçekten yazar (`reason`→`--sebep`, `transcript_path`→`--transcript`, `kapat` önce koştuğu için `kapanis` dolu, `err.jsonl` boş) |
| regresyon (ölçülmüş bug) | hedef parse'ı `\Z` tuzağına düşmüyor: JS'te `\Z` ankor DEĞİL, literal "Z"ye düşüp bölümü yorumdaki "YALNIZ"da kesiyordu → maddeler görünmez oluyordu (satır tarayıcıya çevrildi) |
| kaptan köprüsü | `readPlans()` dolu · `buildModel()` projeye `plans` taşıyor · plans/ olmayan projede KIRILMAZ |

Ayrıca elle doğrulanan (bu dosyaya not):
- `model.mjs --write` → PM.json `projects[].plans` dolu, GORUNUM.md "🗺 PLANLAR" bölümü basılıyor.
- Dashboard `/api/state` her iki dalda (tümü + `?project=` kapsamlı) `plans` alanını taşıyor;
  PM sekmesinde `#pm-planlar` bölümü var. (Geçici port 4981'de curl ile ölçüldü.)
- Maestro günlük işi kuyruğa yazıldı: "plan ağacı: türet+gate (dev projeleri)" (24h, shell).
- İlk benimseme: dorukcom06 `plans/legacy.json` (3 girdi) + agent-ide `plans/legacy.json`
  (4 girdi, MASTER+SP-* yerinde) → iki projede de INDEX türetildi, gate PASS.
