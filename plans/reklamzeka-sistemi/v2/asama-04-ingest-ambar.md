---
kosum: tek-ajan
getirir:
  - dugum: modul:src/reklamzeka/ingest.py
  - dugum: modul:src/reklamzeka/buc.py
  - dugum: modul:src/reklamzeka/metric_map.py
  - dugum: modul:src/reklamzeka/rederive.py
  - dugum: arac:scripts/run_daily.sh
  - dokunur: modul:src/reklamzeka/schema.py
---
# Aşama 04 — INGEST AMBARI (v2)

> Roadmap: [MASTER.md](MASTER.md) · Bağımlı: 02
> Bu dosya KENDİ BAŞINA yeterlidir: taze bir /goal session'ı yalnız bunu okuyarak işi bitirebilmeli.

## Bağlam (bu aşamayı koşan session için)

Meta veri saklama sınırlı (unique/saatlik 13 ay, frequency 6 ay — `docs/api-gercekleri.md`),
bu yüzden "Meta'dan tekrar sorarım" yok: her günün verisi kendi ambarımıza (warehouse.db)
inmek zorunda. Bu aşama v1 MASTER §3 katman 1'in (`ingest.py` + MCP client) uygulamasıdır:
**LLM'siz, deterministik Python** — token maliyeti sıfır; `claude -p` bu aşamada HİÇ çağrılmaz.

Mimari sabitler (ihlal edilmez):
- Tüm Meta erişimi `src/reklamzeka/meta_gateway.py` (`MetaGateway`) üzerinden geçer — tek geçiş
  noktası kanonu (v1 MASTER §9.1). `ingest.py` kendi MCP bağlantısını AÇMAZ.
- Ham insights JSON'u `raw_insights` tablosunda **append-only** saklanır; `metric_snapshot`
  ondan türetilir ve `raw_json_ref` ile ham kayda bağlanır (`src/reklamzeka/schema.py`).
  Alan adı değişse bile geçmiş, hamdan yeniden türetilebilir — bu aşama o provayı da içerir.
- Terminoloji: çıplak "kampanya"/"campaign" yasak (lint: `scripts/lint_terminology.py`).
  Dört çekim seviyesi bu dosyada ve kodda hep şöyle anılır: **account · meta_campaign ·
  meta_ad_set · meta_ad**. Meta'nın kendi uç/alan adları kaçınılmazsa satıra `term-ok` eklenir.

**Kapsam DIŞI (yapma):** değerlendirme (evaluate), Meta nesnesi ↔ İK eşlemesi (mapping),
Sheets yazımı/senkronu, Telegram, panel. Bunlar sonraki aşamaların işidir; ingest yalnız
SQLite ambarına yazar. İnsan adımı yok: `META_MCP_ACCESS_TOKEN` aşama 02'den hazırdır.

Bilinmezlerin tek kaynağı `docs/mcp-envanter.md` (aşama 02 doldurdu): insights araç ad(lar)ı,
parametre yüzeyi, async job desteği ve rate-limit başlıklarının MCP yanıtında görünüp
görünmediği ORADAN okunur — araç adı tahmin edilmez.

## SONUÇ

**Bu aşama bitince:** günlük cron çekimi 4 seviyede (account, meta_campaign, meta_ad_set,
meta_ad) ham JSON'u `raw_insights`'a ve `metric_key` eşlemesiyle `metric_snapshot`'ı ambara
yazıyor; BUC %80 eşikli backoff kararları yapılandırılmış log satırı olarak ölçülebiliyor;
eksik günler tablo+sorguyla alarm veriyor; ≥3 günlük kesintisiz koşu logu kanıt olarak duruyor.

## Önkoşullar

- Aşama 02 kapalı: `META_MCP_ACCESS_TOKEN` ile `MetaGateway.list_tools()` çalışıyor,
  `docs/mcp-envanter.md` insights araçlarıyla dolu.
- `.venv` kurulu (uv), mcp extra hazır; `.venv/bin/pytest tests/ -v` yeşil taban.
- `config/settings.yaml` mevcut (`config/settings.example.yaml`'dan kopya);
  `meta.ad_account_id` doluysa kullanılır, boşsa T04.3'teki otomatik keşif devreye girer.
- `warehouse.db` var ya da yok — ikisi de geçerli: T04.1 migration'ı idempotenttir.

## Task'lar

### T04.1 — Şema genişletmesi: account seviyesi + `ingest_run` tablosu + idempotent migration

**SONUÇ:** Ambar 4 seviyeyi kabul ediyor; her koşu `ingest_run`'a iz bırakıyor; mevcut
warehouse.db verisiz/verili fark etmeden tek komutla yeni şemaya geçiyor.

**Subtask'lar:**
- `src/reklamzeka/schema.py` — `META_LEVELS`'a `meta_account` ekle; modül docstring'ini
  ve `metric_snapshot` CHECK'ini 4 seviyeye genişlet.
  `meta_object_mapping` CHECK'i 3 seviyede KALIR (account bir İK'ya eşlenmez) — yorumla belirt.
- `schema.py` DDL'ine yeni tablo:
  `ingest_run(run_id INTEGER PK AUTOINCREMENT, run_date TEXT NOT NULL, meta_level TEXT NOT NULL,
  status TEXT CHECK(status IN ('ok','partial','fail')), fetched_count INTEGER,
  backoff_count INTEGER NOT NULL DEFAULT 0, started_at TEXT, finished_at TEXT, error_note TEXT)`.
- SQLite CHECK ALTER edilemez → `schema.py`'a `migrate(conn)` fonksiyonu: `sqlite_master.sql`
  içinde `metric_snapshot` tanımında `meta_account` yoksa tabloyu yeniden kur
  (CREATE yeni → INSERT SELECT → DROP → RENAME, tek transaction). `init_db()` sonunda çağır;
  iki kez koşmak zararsız olmalı.
- `tests/test_schema_migration.py` — eski DDL'le açılmış geçici db'ye satır yaz, `migrate` koş,
  satırların korunduğunu ve `meta_account` snapshot'ının artık INSERT edilebildiğini doğrula.

**Kabul kriteri (kanıt):** `.venv/bin/pytest tests/test_schema_migration.py -v` → tümü PASSED;
`.venv/bin/python -c "from reklamzeka.schema import META_LEVELS; print(META_LEVELS)"` →
`meta_account` dahil 4 seviye.

### T04.2 — BUC izleme + %80 eşikli backoff modülü (`buc.py`)

**SONUÇ:** Her Meta yanıtından kota kullanımı okunuyor; %80 üstünde bekleme kararı üretiliyor
ve her karar JSONL log satırı olarak ölçülebiliyor.

**Subtask'lar:**
- `src/reklamzeka/buc.py` — `BucMonitor` sınıfı:
  - `observe(meta: dict) -> BackoffDecision` — `X-Business-Use-Case-Usage` ve
    `X-FB-Ads-Insights-Throttle` başlık gövdelerini (JSON) ayrıştırır; tüm girdilerdeki
    `call_count / total_cputime / total_time / acc_id_util_pct` yüzdelerinin MAKSİMUMU alınır.
  - Eşik `config/settings.yaml → ingest.buc_threshold_pct` (varsayılan 80). Eşik altı → devam;
    eşik üstü → `estimated_time_to_regain_access` varsa onu, yoksa üstel bekleme
    (30s·2^n, tavan 15 dk) döndürür.
  - **Fallback (kritik):** MCP tool yanıtı HTTP başlıklarını yüzeye ÇIKARMAYABİLİR
    (`docs/mcp-envanter.md`'den teyit et). O durumda hata-gövdesi yolu: Graph hata kodları
    4, 17, 613, 80000, 80004 → backoff; başlık yoksa `pct=ölçülemedi` loglanır, tahmin yazılmaz.
- Log: `logs/ingest/YYYY-MM-DD.jsonl` — her karar tek satır JSON:
  `{"ts","event":"buc_observe"|"backoff","meta_level","pct","wait_s","source":"header"|"error_code"}`.
  Ölçülebilirlik sözü budur: `grep -c '"event": "backoff"'` sayılabilir olmalı.
- `tests/test_buc.py` (mock, canlı çağrı YOK) — fixture başlıklarla: %79 → devam, %81 →
  backoff + doğru `wait_s`; hata kodu 17 gövdesiyle → backoff; başlıksız yanıt → `ölçülemedi`
  logu; log satırının şemaya uyduğu.

**Kabul kriteri (kanıt):** `.venv/bin/pytest tests/test_buc.py -v` → tümü PASSED (≥5 senaryo:
eşik altı, eşik üstü, header-yok fallback, hata-kodu yolu, log şeması).

### T04.3 — `ingest.py`: 4 seviyeli çekim, async job deseni, ambar yazımı

**SONUÇ:** Tek komut, bir günün insights verisini 4 seviyede çekip `raw_insights` +
`metric_snapshot`'a idempotent yazıyor; büyük sorgular async job üzerinden akıyor.

**Subtask'lar:**
- `src/reklamzeka/meta_gateway.py` — `MetaGateway.session()` async context manager'ı ekle:
  bir koşudaki onlarca çağrı tek MCP oturumunu yeniden kullansın (mevcut `call` her çağrıda
  bağlantı açıyor). `call` dıştan aynı kalır; gateway tek geçiş noktası olmayı sürdürür.
- `src/reklamzeka/ingest.py` — CLI: `python -m reklamzeka.ingest --date YYYY-MM-DD
  [--db warehouse.db] [--levels meta_ad,...]`. Varsayılan tarih: dün. Akış her seviye için:
  1. Insights araç adı/parametreleri `docs/mcp-envanter.md`'deki envantere göre modül üstü
     sabitlerden (`INSIGHTS_TOOLS`) gelir; `time_increment=1`, tek günlük aralık.
  2. Hesap kimliği: `config/settings.yaml → meta.ad_account_id`; boşsa envanterdeki
     hesap-listeleme aracıyla keşfet — tek hesap → kullan, birden çok → net hata (tahmin yok).
  3. **Async job deseni:** yanıt `report_run_id` içeriyorsa poll döngüsü
     (`job_completed` bekle, poll aralığı 10s, tavan 10 dk; zaman aşımı → o seviye `fail`,
     diğer seviyeler devam). Envanterde async yüzey YOKSA fallback zaten tasarımda:
     günlük kadans = 1 günlük dilim, sorgular küçük kalır.
  4. Her yanıt nesne başına `raw_insights`'a yazılır (`fetched_at, meta_level, meta_id,
     period_start=period_end=--date, payload=ham JSON`). Append-only: yeniden koşu yeni ham
     satır ekler, eskisi silinmez (denetim izi).
  5. `metric_snapshot` T04.4'teki eşleme katmanıyla türetilir; PK üzerinde
     `INSERT OR REPLACE` → aynı gün ikinci koşu idempotent (son ham kayıt kazanır).
  6. Her `MetaGateway.call` sonrası `BucMonitor.observe` (T04.2); backoff kararı uygulanır
     ve `ingest_run.backoff_count` artar. Seviye bitince `ingest_run` satırı yazılır.
- `config/settings.example.yaml` — `meta.ad_account_id: ""`, `ingest.buc_threshold_pct: 80`,
  `ingest.log_dir: "logs/ingest"` alanlarını ekle.
- `tests/test_ingest.py` (mock) — `MetaGateway.call` monkeypatch + `tests/fixtures/insights/`
  altında 4 seviyelik örnek JSON: (a) 4 seviyede raw+snapshot satırları oluşur, (b) aynı gün
  ikinci koşuda `metric_snapshot` satır sayısı değişmez / `raw_insights` artar, (c) bir seviye
  hata verirse diğerleri yazılır ve `ingest_run.status='partial'` olur.
- `tests/test_ingest_smoke.py` (canlı) — `pytest.mark.smoke` (marker'ı `pyproject.toml`'a
  kaydet) + token yoksa `skipif`: gerçek hesaptan 1 gün account seviyesi çek, `raw_insights`'ta
  ≥1 satır ve `ingest_run.status='ok'` doğrula. Birim testler ASLA canlıya çıkmaz; smoke
  ayrı dosyada ve açıkça işaretlidir.

**Kabul kriteri (kanıt):** `.venv/bin/pytest tests/test_ingest.py -v` → tümü PASSED;
`META_MCP_ACCESS_TOKEN=... .venv/bin/pytest tests/test_ingest_smoke.py -m smoke -v` →
PASSED (canlı, 1 gün, 1 seviye yeter);
`.venv/bin/python scripts/lint_terminology.py` → `terminoloji lint: temiz`.

### T04.4 — `metric_key` eşleme katmanı + hamdan yeniden-türetme aracı (dayanıklılık provası)

**SONUÇ:** Alan adları veri-dosyasında eşleniyor (kod değişmeden güncellenebilir) ve Meta bir
alan adını değiştirdiğinde geçmiş `metric_snapshot` hamdan tek komutla yeniden türetiliyor.

**Subtask'lar:**
- `config/metric_map.yaml` — bildirimsel eşleme: her satır
  `{metric_key, level_scope[], extractor: {path: "a.b"} | {action_type: "lead"}, cast}`.
  Başlangıç seti: spend, impressions, reach, frequency, cpm, ctr, clicks,
  actions→lead, `video_thruplay_watched_actions` (v26 teyidi `docs/api-gercekleri.md` #3 —
  canlıda yoksa satır yorumda bekletilir, tahmin yazılmaz). Follows alanı (#2) teyitsizse
  eşlenmez → sonraki katmanlar `ölçülemedi` görür.
- `src/reklamzeka/metric_map.py` — `load_map()` + `derive(payload: dict, meta_level) ->
  list[(metric_key, value)]`; eşleme bulunamayan alan sessizce atlanmaz, `unmapped` sayacı
  jsonl loguna yazılır (alan adı değişiminin ERKEN sinyali).
- `src/reklamzeka/rederive.py` — CLI: `python -m reklamzeka.rederive --since D --until D
  [--level meta_ad] [--db warehouse.db]`: aralıktaki `raw_insights` satırlarını okur
  (aynı `meta_level, meta_id, period` için EN SON `raw_id` kazanır), güncel `metric_map.yaml`
  ile `metric_snapshot`'ı `INSERT OR REPLACE` eder; sonunda `N snapshot yeniden türetildi` basar.
- `tests/test_rederive.py` — **dayanıklılık provası** (aşamanın ispat yükü): fixture ham
  payload'da bir alan adını "eski ad"la ambara yaz → eşlemede yeni ada güncelle → rederive koş
  → snapshot değerinin yeni eşlemeyle doğru türediğini ve eski snapshot'ın ezildiğini doğrula.
  Meta'ya dokunmadan alan-adı-göçü senaryosu kanıtlanmış olur.

**Kabul kriteri (kanıt):** `.venv/bin/pytest tests/test_metric_map.py tests/test_rederive.py -v`
→ tümü PASSED; ambarlı ortamda `.venv/bin/python -m reklamzeka.rederive --since <D> --until <D>`
→ `N snapshot yeniden türetildi` (N>0).

### T04.5 — Eksik-gün alarmı + `run_daily.sh` cron/tmux kadansı + sürüş

**SONUÇ:** Takvimdeki boş günler sorguyla görünüyor ve alarm exit-code'a bağlı; günlük koşu
cron'dan tetikleniyor; ≥3 günlük log aşamayı kapatıyor.

**Subtask'lar:**
- `src/reklamzeka/ingest.py` içine `--gaps --since D [--until D]` modu: recursive CTE takvimi
  × 4 seviye, `ingest_run(status='ok')` VE `metric_snapshot` varlığıyla LEFT JOIN → eksik
  `(gün, seviye)` çiftlerini listeler. Eksik yoksa `eksik gün yok` + exit 0; varsa liste +
  **exit 3** (koşu hatası exit 1'den ayrışır) + jsonl'e `{"event":"gap_alarm", ...}` satırı.
- `scripts/run_daily.sh` — `set -euo pipefail`; repo köküne cd; `.venv` aktive;
  `python -m reklamzeka.ingest --date ${1:-$(date -v-1d +%F)}` (macOS `date -v`); ardından
  `--gaps --since` son 7 gün; tüm çıktı `logs/ingest/`e. Çıplak terim script'e girmesin —
  lint `scripts/`i tarıyor.
- Cron kurulumu (dosyaya yorum olarak da yaz):
  `15 7 * * * cd /Users/ybg/dev/ReklamZeka && ./scripts/run_daily.sh >> logs/cron.out 2>&1`
  — `crontab -e` ile eklenir. Mac uykudaysa cron kaçar → alternatif olarak tmux içinde
  döngü deseni README notu; hangisi seçilirse `--gaps` güvenlik ağıdır (kaçan gün ertesi
  koşuda alarm verir; geriye dönük gün `--date` ile elle doldurulur).
- Sürüş: 3 ardışık takvim günü cron koşusu bekle; her günün jsonl'i ve `--gaps` çıktısı kanıttır.

**Kabul kriteri (kanıt):** `bash scripts/run_daily.sh` → exit 0 ve o günün
`logs/ingest/*.jsonl` dosyası oluşmuş; `crontab -l | grep run_daily.sh` → satır var;
3 gün sonra `ls logs/ingest/*.jsonl | wc -l` → ≥3 ve
`.venv/bin/python -m reklamzeka.ingest --gaps --since <ilk koşu günü>` → `eksik gün yok`, exit 0.

## Task checklist

- [ ] T04.1 — şema: 4 seviye + ingest_run + migration · kanıt: `pytest tests/test_schema_migration.py -v` → PASSED
- [ ] T04.2 — BUC %80 backoff modülü · kanıt: `pytest tests/test_buc.py -v` → PASSED (5 senaryo)
- [ ] T04.3 — ingest.py 4 seviye + async job · kanıt: `pytest tests/test_ingest.py -v` PASSED + smoke `-m smoke` PASSED
- [ ] T04.4 — metric_map + rederive provası · kanıt: `pytest tests/test_rederive.py -v` → alan-adı-göçü senaryosu PASSED
- [ ] T04.5 — eksik-gün alarmı + cron sürüşü · kanıt: `ls logs/ingest/*.jsonl | wc -l` ≥3 + `--gaps` → `eksik gün yok`

## Aşama requirements

| id | requirement | doğrulama | delege |
|---|---|---|---|
| R1 | 4 seviyede günlük ham JSON + snapshot ambara yazılır | `sqlite3 warehouse.db "SELECT meta_level, COUNT(*) FROM raw_insights GROUP BY 1"` → 4 seviye | — |
| R2 | BUC %80 backoff kararları ölçülebilir loglanır | `grep -h '"event"' logs/ingest/*.jsonl \| head` → şemaya uyan satırlar; backoff sayısı grep ile sayılır | — |
| R3 | Alan adı değişiminde hamdan yeniden türetim kanıtlı | `pytest tests/test_rederive.py -v` → göç senaryosu PASSED | — |
| R4 | Eksik gün alarm tablo+sorguyla görünür, exit-code'lu | `python -m reklamzeka.ingest --gaps --since <D>` → liste/`eksik gün yok`, exit 3/0 | — |
| R5 | ≥3 günlük kesintisiz cron koşusu (surus kanıtı) | `ls logs/ingest/*.jsonl \| wc -l` ≥3 + her günün `ingest_run` satırları | — |
| R6 | Terminoloji lint temiz; Meta erişimi yalnız MetaGateway'den | lint temiz; `rg "streamablehttp_client" src/ --files-with-matches` → yalnız `meta_gateway.py` | — |

## Doğrulama (aşama kapanışı)

Kanıtlar sınıf etiketiyle koşulur:

1. **kanit:hizli** — `.venv/bin/pytest tests/test_schema_migration.py tests/test_buc.py
   tests/test_ingest.py tests/test_metric_map.py tests/test_rederive.py -v` → tümü PASSED
   (mock, canlı çağrı yok); lint temiz.
2. **kanit:tam** — canlı smoke: `META_MCP_ACCESS_TOKEN=... .venv/bin/pytest
   tests/test_ingest_smoke.py -m smoke -v` → PASSED; ardından gerçek ambarda
   `python -m reklamzeka.rederive --since <dün> --until <dün>` → N>0.
3. **kanit:surus (aşama kapanış kanıtı — zorunlu):** doğrulama zamana yayılır. 3 ardışık
   takvim günü cron koşusu sonrası: (a) `ls logs/ingest/*.jsonl | wc -l` ≥ 3,
   (b) `--gaps --since <ilk gün>` → `eksik gün yok` exit 0, (c) backoff özeti:
   `grep -hc '"event": "backoff"' logs/ingest/*.jsonl || true` → sayı raporlanır (0 da geçerli
   sonuçtur — az reklamlı hesapta beklenen; sayı ölçülmüş olması yeterlidir).
   Sürüş tamamlanmadan aşama "bitti" İLAN EDİLMEZ; kod bitince aşama "sürüşte" durumuna geçer.

"Derleniyor/testler yeşil" tek başına kapanış değildir — kapanış kanıtı 3-c'deki ölçülmüş sürüştür.

## Efor/maliyet notu

- Kod+test: ~1 gün tek-ajan oturumu (5 task, hepsi deterministik Python; LLM prompt yok).
- Koşum maliyeti: sıfır LLM token'ı (ingest LLM'siz); Meta MCP beta'da ücretsiz; BUC kotası
  az-reklamlı doktor hesaplarında dardır ama günlük 1 koşu × 4 seviye eşiğe yaklaşmaz —
  backoff yine de kuruludur çünkü ileri fazlarda çağrı hacmi artacak.
- Takvim: kapanış ≥3 gün sürüş ister → kod bitiminden sonra aşama açık bekler; bu beklemede
  05+ aşamaları (bağımlılıkları uygunsa) paralel başlayabilir.

## Bitirirken (zorunlu)

1. `CHECKLIST.md`'de bu aşamanın maddelerini işaretle.
2. `STATE.md`'ye tur kaydı yaz: tarih · yapılan · kanıt yolları · açık kalan.
