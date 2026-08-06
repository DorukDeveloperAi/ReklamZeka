---
kosum: workflow:uygula-dogrula
getirir:
  - dugum: modul:src/reklamzeka/delta.py
  - dugum: modul:src/reklamzeka/rubric.py
  - dugum: modul:src/reklamzeka/evaluate.py
  - dugum: modul:src/reklamzeka/digest.py
  - dugum: modul:src/reklamzeka/sinks.py
  - dugum: modul:src/reklamzeka/notify.py
---
# Aşama 06 — DEĞERLENDİRME VE DIGEST (v2)

> Roadmap: [MASTER.md](MASTER.md) · Bağımlı: 05
> Bu dosya KENDİ BAŞINA yeterlidir: taze bir /goal session'ı yalnız bunu okuyarak işi bitirebilmeli.

## Bağlam (bu aşamayı koşan session için)

Aşama 05 zemini kurdu: `metric_snapshot` zaman serileri (aşama 04), `meta_object_mapping`
eşlemeleri ve Sheets↔SQLite senkronu (aşama 03) çalışıyor. Bu aşama v1 MASTER'ın 6. katmanını
(`evaluate.py` + headless `claude -p`) ve Faz 1'in "biten" tanımındaki digest'i kurar. Bağlayıcı
şartnameler:

- `utopya/vizyon/2-brief-yargisi.md` — G2.1 (brief'siz değerlendirme YAZILAMAZ; şema kısıtı
  `evaluation.brief_id NOT NULL` zaten var), G2.2 (delta/trend deterministik SQL; LLM yalnız
  yorum katar, **sayı üretmez**; instance + agrega), G2.3 (rubrik = YAML varsayılan + Sheets
  override; benchmark boşsa ilk 4 hafta kendi tarihinden öneri), G2.4 (`ölçülemedi` dürüstlüğü;
  `derived` metriklere güven etiketi).
- `utopya/vizyon/3-insan-hakimiyeti.md` — G3.4 (**digest bir üründür, kanal değil**: her koşu TEK
  artefakt üretir — markdown + JSON, ambara ve dosyaya kayıtlı; kanallar sink kayıt defterinden
  abone olur; hiçbir sink'ten yazma/onay tetiklenemez).
- Terminoloji: `docs/terminoloji.md` KİLİTLİ sözlük; her LLM prompt'unun başına bu sözlük bloğu
  enjekte edilir; çıplak "kampanya"/"campaign" yasak (`scripts/lint_terminology.py`).

Hazır olan ve YENİDEN YAZILMAYACAK parçalar: `config/rubrics/*.yaml` (5 rubrik varsayılanı;
`takipci.yaml` ve `satis.yaml` içinde `confidence: dusuk` ve `ölçülemedi` notları hazır),
`src/reklamzeka/taxonomy.py` (deep-merge; `metric_key` liste-kimliği `_LIST_ITEM_KEYS`'te tanımlı —
rubrik override birleşimi BU fonksiyonlarla yapılır), `src/reklamzeka/sheets_schema.py`
(`RUBRIK_OVERRIDE` ve append-only `DEGERLENDIRMELER` sekmeleri tanımlı).

Aşama SINIRLARI: yönetim paneli YOK (aşama 07). `change_proposal` üretimi/uygulaması YOK — yazma
önerisi bu aşamada ÜRETİLMEZ de UYGULANMAZ da. Onay eylemi hiçbir kanala konmaz.

## SONUÇ

**Bu aşama bitince:** Günlük digest artefaktı (md + JSON, ambara kayıtlı) brief-gerekçeli
instance+agrega skorlarla üretiliyor, dosya + Telegram sink'lerinden bayt-eş kaynaktan dağıtılıyor
ve ≥7 gün kesintisiz koşu logu ölçülür durumda.

## Önkoşullar

- Aşama 05 kapalı: ambarda gerçek `metric_snapshot` satırları, `verified_by_user` eşlemeler,
  Sheets→SQLite cache tazeleme çalışır durumda.
- `docs/api-gercekleri.md` teyit tablosu okunmuş: `follows` / `thruplay` alan durumları — teyitsiz
  kalan alan `ölçülemedi` yoluna girer, tahmin YAZILMAZ.
- `.venv` + pytest çalışıyor (`.venv/bin/pytest tests/ -q` yeşil başlanır), `claude` CLI PATH'te.
- Google Sheets kimliği hâlâ yoksa iş DURMAZ: Sheets append adımları atlanır, digest'te
  "Sheets append: yapılamadı (kimlik yok)" göstergesi basılır.
- ✋ İNSAN ADIMI (T06.5'i canlıya bağlar, diğer task'ları BLOKE ETMEZ): Telegram bot token +
  kanal id + kadans onayı (öneri: günlük kısa + haftalık derin). Gelene dek Telegram sink dry-run.

## Task'lar

### T06.1 — Delta/trend deterministik SQL katmanı (`src/reklamzeka/delta.py`)

**SONUÇ:** Tepki/etkileşim/dönüşüm değişimi (delta, 7g hareketli ortalama, 14g eğim) yalnız
`metric_snapshot` üzerinde SQL ile hesaplanır; aynı girdi → aynı sayı (bayt-eş JSON); LLM bu
katmana hiç dokunmaz.

**Subtask'lar:**
- `src/reklamzeka/delta.py`: `compute(conn, hedef, periyot)` — hedef bir İK (`ik_id`, eşleme
  tablosundan Meta nesneleri toplanır) ya da İKK (`category_id`, örneklerin birleşimi). Periyot
  sözleşmesi: günlük koşuda son 7 gün vs önceki 7 gün; haftalık derinde son 28 gün. Determinizm
  disiplini: her sorguda sabit `ORDER BY`, her sayı `ROUND(x, 4)`, JSON anahtarları sıralı yazılır.
- Verisi olmayan metrik için SAYI ÜRETME: `{"metric_key": ..., "durum": "veri_yok", "neden": ...}`
  işaretle (T06.3'ün `ölçülemedi` etiketi buna dayanır).
- CLI girişi: `python -m reklamzeka.delta --db <yol> --ik IK-007 --periyot 2026-08-01..2026-08-07 --json`.
- Deterministik fixture ambarı: `tests/fixtures/ambar_fixture.py` (sabit seed'li builder,
  `conftest.py`'ye fixture olarak eklenir; en az 2 İK × 14 gün × 4 metrik + 1 verisiz metrik).
- `tests/test_delta.py`: (a) determinizm — iki çağrı bayt-eş çıktı, (b) elle hesaplanmış bilinen
  delta/eğim değeriyle birebir karşılaştırma, (c) verisiz metrik `veri_yok`, (d) İKK birleşimi.

**Kabul kriteri (kanıt):** `.venv/bin/pytest tests/test_delta.py -v` → tümü yeşil; ardından
`.venv/bin/python -m reklamzeka.delta --db tests/fixtures/out/ambar_fixture.db --ik IK-007 --periyot 2026-08-01..2026-08-07 --json > /tmp/d1.json` (iki kez, ikincisi `/tmp/d2.json`) →
`cmp /tmp/d1.json /tmp/d2.json && echo BAYT-ES` → `BAYT-ES`.

### T06.2 — Rubrik bağlayıcı + benchmark önerici (`src/reklamzeka/rubric.py`)

**SONUÇ:** Efektif rubrik = `config/rubrics/*.yaml` varsayılanı üstüne Sheets `RUBRIK_OVERRIDE`
(SQLite cache'inden) binmiş hali; hibrit kapsamlar `composite_weights` ile çözülür; benchmark'ı boş
metrik için ilk 4 haftada kendi tarihinden öneri üretilir — öneri İNSANA sunulur, sistem
`RUBRIK_OVERRIDE`'a yazmaz (insan-yazar kanon).

**Subtask'lar:**
- `load_rubric(conn, goal_scope)`: YAML'ı oku, `rubric_override` tablosundaki metriklerle
  **`taxonomy.py`'nin mevcut deep-merge'üyle** birleştir (`metric_key` kimliği zaten tanımlı —
  yeni merge KODU YAZILMAZ). Elenen alternatif: rubric'e özel merge — reddedildi, tek merge
  fonksiyonu ilkesi (MASTER §2.3) bozulurdu.
- Hibrit çözümü: `composite_weights` içindeki her alt amaç kapsamının rubriği yüklenir, bileşik
  skor ağırlıkları taşınır (`config/rubrics/hibrit-ornek.yaml` deseninde).
- Benchmark önerici (deterministik SQL): `benchmark: null` ve ambarda o metrik için ≥28 gün veri
  varsa öneri = son 28 günün medyanı (ROUND 4); veri <28 günse "veri birikiyor (N/28 gün)" durumu.
  Çıktı bir öneri listesi nesnesidir; T06.4 bunu digest'in "benchmark önerileri" bölümüne basar.
- `tests/test_rubric.py`: override kazanır / override'da olmayan metrik YAML'dan gelir /
  `null` metrik siler (taxonomy kuralı) / hibrit ağırlıkları / öneri determinizmi / modülün Sheets'e
  hiçbir yazma çağrısı yapmadığı (API yüzeyinde yazma fonksiyonu yok).

**Kabul kriteri (kanıt):** `.venv/bin/pytest tests/test_rubric.py -v` → tümü yeşil; fixture'da
override'lı `cpm` ağırlığı efektif rubrikte override değeriyle, override'sız `reach` YAML değeriyle
doğrulanır (test adları çıktıda görünür: `test_override_kazanir`, `test_benchmark_onerisi_deterministik`).

### T06.3 — `evaluate.py`: instance + agrega değerlendirme, brief gerekçesi, `ölçülemedi`

**SONUÇ:** Her aktif İK için instance, `budget_definition='category'` olan her İKK için portföy
(agrega) `evaluation` kaydı üretilir; skorlar ve verdict DETERMİNİSTİK (delta katmanı + brief
eşikleri + rubrik), `rationale_text` headless `claude -p`'den; her skor `brief_id + metric_key +
eşik + ölçülen` dörtlüsünü taşır; verisi olmayan metrik `ölçülemedi` + neden, `derived` metrikler
güven etiketli; brief'siz İK değerlendirilMEZ ve boşluk göstergesine sayılır.

**Subtask'lar:**
- `config/prompts/degerlendirme.md` şablonu; render'da `docs/terminoloji.md` sözlük tablosu bloğu
  prompt başına enjekte edilir (MASTER §1 sert kuralı). Prompt LLM'den YALNIZ yorum ister; sayı,
  skor, verdict istemez.
- `src/reklamzeka/evaluate.py`: akış = `resolve_effective_config(ik_id)` → `rubric.load_rubric` →
  `delta.compute` → deterministik skorlama (brief `kpi_targets` hedef/warn/fail eşikleri +
  benchmark; `ölçülemedi` metrikler dışarıda bırakılıp kalan ağırlıklar renormalize edilir —
  renormalizasyon skoru şişirmesin diye `scores` JSON'ına `olculen_agirlik_orani` yazılır) →
  `claude -p` çağrısı → `evaluation` INSERT (SQLite) + `DEGERLENDIRMELER` append (03'ün
  sheets_sync deseni; kimlik yoksa atla ve logla).
- LLM sınırı SERT: `--llm-cmd` parametresiyle komut enjekte edilebilir (testte
  `tests/stubs/llm_stub.sh`); LLM çıktısından yalnız `rationale_text` alanı alınır, çıktıdaki
  HİÇBİR sayı `scores`/`delta`/`verdict`'e yazılmaz.
- Agrega: İKK'nın kategori brief'i (`brief.scope='category'`) gerekçe kaynağıdır; portföy skoru
  örneklerin harcama-ağırlıklı bileşimi (eşit ağırlık elendi: aşama 08 bütçe danışmanı harcama
  görünümüne ihtiyaç duyacak). Kategori brief'i yoksa kayıt ATLANIR (şema zaten yazdırmaz) ve
  "kategori brief'siz İKK" göstergesine sayılır.
- `tests/test_evaluate.py`: (a) brief_id'siz INSERT `IntegrityError` (G2.1), (b) ADVERSARIAL —
  sahte LLM stub'ı farklı sayılar döndürür, `scores`'a sızMAdığı doğrulanır, (c) `ölçülemedi` +
  renormalizasyon, (d) `derived` metrikte `confidence` etiketi taşınır, (e) hibrit bileşik skor,
  (f) agrega yalnız `budget_definition='category'` İKK'lar için, (g) rendered prompt'un başında
  sözlük bloğu var.

**Kabul kriteri (kanıt):** `.venv/bin/pytest tests/test_evaluate.py -v` → tümü yeşil; uçtan uca:
`.venv/bin/python -m reklamzeka.evaluate --db tests/fixtures/out/ambar_fixture.db --tarih 2026-08-07 --llm-cmd tests/stubs/llm_stub.sh` →
`sqlite3 tests/fixtures/out/ambar_fixture.db "SELECT COUNT(*) FROM evaluation WHERE scope='aggregate'"` → kategori-bütçeli İKK sayısına eşit; her `scores` girdisinde dörtlü gerekçe (denetim komutu test dosyasında).

### T06.4 — Digest üretici (`src/reklamzeka/digest.py`): TEK artefakt, ambar + dosya

**SONUÇ:** Her koşu tek digest artefaktı üretir: `docs/digest/YYYY-MM-DD-<kadans>.md` + `.json`
ve ambarda `digest_artifact` satırı (`content_hash` ile); içerik brief-gerekçeli skorlar +
delta/trend özetleri + `ölçülemedi` satırları + sessiz-boşluk göstergeleri + benchmark önerileri;
digest salt-okunurdur, içinden hiçbir eylem tetiklenemez.

**Subtask'lar:**
- `src/reklamzeka/schema.py` DDL'ine tablo ekle (mevcut ambarlar bozulmaz — `IF NOT EXISTS`):
  `digest_artifact(digest_id TEXT PRIMARY KEY, digest_date TEXT NOT NULL, kadans TEXT NOT NULL
  CHECK (kadans IN ('gunluk','haftalik')), md_path TEXT NOT NULL, json_payload TEXT NOT NULL,
  content_hash TEXT NOT NULL, created_at TEXT NOT NULL)`.
- `digest.py`: `--tarih` parametresi (determinizm ve test için saat DIŞARIDAN verilir); md ve JSON
  AYNI iç modelden render edilir; `content_hash = sha256(json_payload)`; ambar INSERT + dosya yazımı
  tek transaksiyonel akışta (dosya yazılamazsa ambar kaydı da atılmaz).
- Sessiz-boşluk göstergeleri bölümü (değer 0/boş olsa BİLE basılır — bu aşamanın ruhu):
  `aktif metin kuralı sayısı` (`copy_rule_set WHERE aktif=1` — beklenen: **0**, açıkça
  "0" yazılır), `yetim Meta nesnesi sayısı` (eşlenmemiş), `brief'siz İK sayısı`,
  `kategori brief'siz İKK sayısı`, `ölçülemedi metrik sayısı`, `benchmark'ı boş metrik sayısı`,
  `Sheets append durumu`.
- Kaynaksız sayı yasağı (G2.4): JSON'daki her sayısal alan ya `delta` çıktısına ya `metric_snapshot`
  referansına ya da `evaluation.eval_id`'ye bağlanır; serbest metin bölümüne LLM sayısı girmez
  (rationale_text olduğu gibi aktarılır, digest ona sayı eklemez).
- Bu aşamada `change_proposal` ÜRETİLMEZ; digest'te "onay kuyruğu" bölümü YOKTUR (aşama 07+).
- `tests/test_digest.py`: aynı fixture + aynı `--tarih` → iki koşu bayt-eş md ve JSON; göstergeler
  0-değerde görünür; `content_hash` doğru; ambar kaydı ↔ dosya içeriği eş.

**Kabul kriteri (kanıt):** `.venv/bin/pytest tests/test_digest.py -v` → tümü yeşil;
`.venv/bin/python -c "import json;d=json.load(open('docs/digest/2026-08-07-gunluk.json'));print(d['sessiz_bosluk']['aktif_metin_kurali_sayisi'])"` → `0` (fixture koşusunda değer değil ALANIN VARLIĞI kanıttır).

### T06.5 — Sink kayıt defteri: dosya + Telegram (`src/reklamzeka/sinks.py`, `notify.py`) ✋

**SONUÇ:** Sink'ler `config/sinks.yaml`'dan yüklenir; dosya sink (`docs/digest/SON.md` sabit yolu —
aşama 07 paneli bunu okuyacak) ve Telegram sink (`notify.py`) AYNI artefakt baytlarını teslim alır;
sink arayüzünde yazma/onay yüzeyi YOKTUR; yeni sink = konfig + ince adaptör.

**Subtask'lar:**
- `src/reklamzeka/sinks.py`: `Sink` protokolü TEK metot — `deliver(artifact_bytes, meta)`.
  Protokole ambar bağlantısı, Sheets istemcisi ya da MCP erişimi GİRMEZ (G3.4 yapısal garanti);
  kayıt defteri `config/sinks.yaml`'dan sink listesini kurar.
- Dosya sink: artefakt md baytlarını `docs/digest/SON.md`'ye aynen yazar (bayt-eş kopya).
- `src/reklamzeka/notify.py` (MASTER katman 13): Telegram Bot API; `TELEGRAM_BOT_TOKEN` +
  `TELEGRAM_CHAT_ID` ortam değişkenleri; 4096 karakter üstü içerik `sendDocument` ile md dosyası
  olarak gider (bölerek bozulmaz — bayt-eşlik korunur); `--dry-run` gönderilecek baytları
  `logs/telegram-dryrun/` altına yazar; Telegram'dan onay/komut OKUNMAZ (bot yalnız gönderir).
- Bayt-eşlik testi `tests/test_sinks.py`: iki sink'e teslim edilen payload'ların sha256'sı eş VE
  ambar `content_hash`'ine eş; ADVERSARIAL — `Sink` protokolünde `deliver` dışında public metot
  olmadığı, `notify.py`'nin hiçbir modülden `guardrails`/`meta_gateway`/Sheets yazımı import
  etmediği doğrulanır.
- ✋ İNSAN ADIMI: Telegram bot token + kanal id teslimi ve kadans ONAYI (öneri: günlük kısa digest
  + pazartesi haftalık derin). Token gelene dek Telegram sink `--dry-run`'da koşar — aşama bundan
  BLOKE OLMAZ, sürüş kanıtı dry-run logu ile de sayılır; canlı gönderim geldiğinde tek komutla açılır.

**Kabul kriteri (kanıt):** `.venv/bin/pytest tests/test_sinks.py -v` → tümü yeşil (bayt-eşlik +
adversarial import testi dahil); token sonrası canlı: `.venv/bin/python -m reklamzeka.notify --test` →
Telegram kanalında test mesajı görünür (message_id `STATE.md` tur kaydına).

### T06.6 — Cadence zinciri + ≥7 gün sürüş kanıtı (`scripts/run_daily.sh`)

**SONUÇ:** Günlük cron zinciri ingest→evaluate→digest→sink sırasıyla koşar, her koşum
`logs/cadence/YYYY-MM-DD.log` üretir; ambarda ≥7 ardışık günün digest artefaktı ölçülür durumda;
adım hatasında yarım digest YAZILMAZ.

**Subtask'lar:**
- `scripts/run_daily.sh`: aşama 04'ün ingest adımının ardına `sheets_sync` + `evaluate` + `digest`
  + sink dağıtımı eklenir (sıra: ingest → sheets_sync → evaluate → digest → sinks);
  herhangi bir adım FAIL ederse sonraki adımlar atlanır, log'a `FAIL:<adım>` düşer — eksik veriyle
  digest üretilmez (bayat/yarım rapor dürüstlük ihlalidir).
- `scripts/run_weekly.sh` güncellemesi: haftalık derin digest (`kadans=haftalik`, 28 günlük periyot);
  cron'a bağlanması kadans onayına (T06.5 insan adımı) tabidir — onaya kadar elle tetiklenir.
- cron/tmux kaydı (04'ün cadence deseniyle aynı mekanizma) + basit tarih-dosyalı log.
- Sürüş ölçüm sorgusu `scripts/` içinde tek satır olarak belgelenir (aşağıdaki kanıt komutu).

**Kabul kriteri (kanıt):**
`sqlite3 warehouse.db "SELECT COUNT(DISTINCT digest_date) FROM digest_artifact WHERE kadans='gunluk' AND digest_date >= date('now','-7 day')"` → `7`; ve
`ls logs/cadence/ | tail -8` → son 7 güne ait kesintisiz log dosyaları (boşluk yok; boşluk varsa
neden `STATE.md`'de — "kesintisiz" iddiası ÖLÇÜMDÜR, beyan değil).

## Task checklist

- [ ] T06.1 — delta/trend deterministik SQL · kanıt: `pytest tests/test_delta.py` yeşil + iki koşum `cmp` → BAYT-ES
- [ ] T06.2 — rubrik bağlayıcı + benchmark önerici · kanıt: `pytest tests/test_rubric.py` yeşil (override kazanır + öneri deterministik)
- [ ] T06.3 — evaluate.py instance+agrega, brief gerekçeli · kanıt: `pytest tests/test_evaluate.py` yeşil + sqlite sorguları (agrega sayısı, dörtlü gerekçe)
- [ ] T06.4 — digest üretici (md+JSON, ambar+dosya) · kanıt: `pytest tests/test_digest.py` yeşil + JSON'da sessiz-boşluk alanları
- [ ] T06.5 — sink kayıt defteri (dosya+Telegram) ✋ · kanıt: `pytest tests/test_sinks.py` yeşil + (token sonrası) `notify --test` mesajı
- [ ] T06.6 — cadence + ≥7 gün sürüş · kanıt: `digest_artifact` sorgusu → 7 ardışık gün + `logs/cadence/` kesintisiz

## Aşama requirements

| id | requirement | doğrulama | delege |
|---|---|---|---|
| R06.1 | Brief'siz değerlendirme yazılamaz; her skor `brief_id+metric_key+eşik+ölçülen` taşır (G2.1) | `test_evaluate.py` IntegrityError testi + scores JSON dörtlü kontrol | T06.3 |
| R06.2 | Delta/trend deterministik SQL; LLM sayı üretmez, sızamaz (G2.2) | `test_delta.py` determinizm + `test_evaluate.py` adversarial sahte-LLM testi | T06.1, T06.3 |
| R06.3 | `budget_definition='category'` her İKK için portföy (agrega) skoru üretilir (G2.2) | sqlite COUNT sorgusu = kategori-bütçeli İKK sayısı | T06.3 |
| R06.4 | Rubrik = YAML varsayılan + `RUBRIK_OVERRIDE`; benchmark boşsa ilk 4 hafta kendi tarihinden öneri, insan onaylar (G2.3) | `test_rubric.py`; önerinin Sheets'e YAZILMADIĞI API-yüzeyi testi | T06.2 |
| R06.5 | `ölçülemedi` etiketi + neden; `derived` güven etiketli; digest'te kaynaksız sayı yok (G2.4) | `test_evaluate.py` + `test_digest.py` kaynak-bağı testleri | T06.3, T06.4 |
| R06.6 | Digest TEK artefakt (md+JSON, ambar+dosya); sink'ler bayt-eş kaynaktan; hiçbir sink'ten yazma/onay çıkmaz (G3.4) | `test_digest.py` + `test_sinks.py` sha256 eşliği + adversarial import testi | T06.4, T06.5 |
| R06.7 | Terminoloji disiplini: sözlük bloğu her prompt'a enjekte; çıplak kullanım yok (MASTER §1) | `test_evaluate.py` prompt testi + lint | T06.3 + tüm task'lar |
| R06.8 | ≥7 gün kesintisiz koşu ölçülür durumda (Faz 1 "biten" tanımı) | `digest_artifact` ardışık-gün sorgusu + `logs/cadence/` | T06.6 |

## Doğrulama (aşama kapanışı)

Üç bağımsız test yüzeyi (delta-SQL · LLM değerlendirme · digest/sink) + adversarial doğrulama
(determinizm, brief bağı, sayı sızması, sink yazma-yüzeyi) — `kosum: workflow:uygula-dogrula`
gerekçesi budur. Kanıt seviyeleri:

1. **kanit:hizli** — `.venv/bin/pytest tests/ -q` → mevcut süit + yeni 5 test dosyası tümü yeşil;
   lint temiz (yeni prompt/modüller dahil).
2. **kanit:tam** — fixture uçtan uca, sıfır canlı bağımlılık:
   `evaluate --db <fixture> --tarih 2026-08-07 --llm-cmd tests/stubs/llm_stub.sh`
   → `digest --db <fixture> --tarih 2026-08-07 --kadans gunluk`
   → sink dağıtımı (Telegram dry-run) → `docs/digest/SON.md`, `logs/telegram-dryrun/` son payload ve
   ambar `content_hash` üçünün sha256'sı EŞ. Tek komut zinciri `scripts/` altında belgelenir.
3. **kanit:surus** — T06.6 sorgusu: `digest_artifact`'te ≥7 ardışık `gunluk` tarih +
   `logs/cadence/` kesintisiz. Bu kanıt takvim ister; sürüş koşarken aşama "sürüşte" damgasıyla
   bekler, kapanış 7. gün ölçümüyle mühürlenir.

## Efor/maliyet notu

- Kod eforu: 6 task ≈ 4-6 iş günü; en ağır parça T06.3 (LLM sınırı + iki düzey + gerekçe şeması).
- Takvim: kanit:surus tanımı gereği +7 gün duvar-saati — kod bittikten sonra sürüş koşarken
  aşama 07 (panel) başlayabilir; 07'nin girdisi `docs/digest/SON.md` T06.5'te hazır olur.
- LLM maliyeti: koşu başına `claude -p` çağrısı = aktif İK sayısı + kategori-bütçeli İKK sayısı;
  çağrı başına sözlük bloğu ~0.5-1K token ek yük. Testler sahte LLM stub'ıyla SIFIR token; canlı
  token yalnız sürüşte yanar. Telegram API ücretsiz.
- İnsan bağımlılığı: yalnız T06.5 (token + kanal + kadans onayı); dry-run yoluyla aşama insan
  beklemeden test-tamam duruma gelir.

## Bitirirken (zorunlu)

1. `CHECKLIST.md`'de bu aşamanın maddelerini işaretle.
2. `STATE.md`'ye tur kaydı yaz: tarih · yapılan · kanıt yolları · açık kalan.
