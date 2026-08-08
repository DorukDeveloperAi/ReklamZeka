---
kosum: tek-ajan
getirir:
  - dugum: modul:src/reklamzeka/creative_diag.py
  - dugum: modul:src/reklamzeka/copy_rules.py
  - dugum: modul:src/reklamzeka/copy_scan.py
  - dugum: arac:scripts/seed_copy_rules.py
---
# Aşama 09 — CREATIVE TANI VE METİN KURALLARI (v2)

> Roadmap: [MASTER.md](MASTER.md) · Bağımlı: 07
> Bu dosya KENDİ BAŞINA yeterlidir: taze bir /goal session'ı yalnız bunu okuyarak işi bitirebilmeli.

## Bağlam (bu aşamayı koşan session için)

Proje kökü: `/Users/ybg/dev/ReklamZeka`. v1 MASTER (`plans/reklamzeka-sistemi/v1/MASTER.md`)
§3 katman 10'un ve §7 uyumluluk modülünün v2 gerçekleştirimi; şartname karşılığı
`utopya/vizyon/4-uyum-guveni.md` → `uy:uyum-guveni/kural-motoru` (G4.1) ve
`uy:uyum-guveni/baslangic-paketi-pasif` (G4.2).

**Değişmezler (bu aşamada sessizce bozulması en olası şeyler):**
- Sistem hukuki hüküm VERMEZ: kural içeriğini ve aktivasyonu YALNIZ kullanıcı yapar.
  "Sistem izin verdi/yasakladı" durumu tanım gereği yoktur (G4.2).
- Metin önerisi ASLA otomatik yayınlanmaz: tek çıkış yolu kural süzgeci → onay kuyruğu
  (`change_proposal.status=pending`). Görsel/video ÜRETİMİ kapsam dışıdır.
- `severity=block` → metin önerisi kuyruğa hiç girmeden düşer + kural referanslı log;
  `severity=warn` → bulgu diff'e (`change_proposal.copy_rule_findings`) iliştirilir.
- Sheets insan-yazar alanlarda kanondur; sistem yalnız append/yeni satır yazar
  (`METIN_KURAL_SETLERI` sekmesi; insan hücresi EZİLMEZ).

**Mevcut kod envanteri (yeniden icat etme):**
- `src/reklamzeka/schema.py` — `copy_rule_set` tablosu HAZIR (`aktif INTEGER DEFAULT 0`,
  `kaynak_notu`, `pattern_type: regex|keyword|llm_check`, `severity: block|warn`,
  `scope: global|family|category` + `scope_ref`). `change_proposal` tablosunda
  `action_type='creative_refresh'` ve `copy_rule_findings` alanı HAZIR.
  `metric_snapshot` PK: `(snapshot_date, meta_level, meta_id, metric_key)`.
- `src/reklamzeka/taxonomy.py` — `resolve_effective_config` / `deep_merge`; `_merge_lists`
  öğe kimliği olarak `id` anahtarını zaten tanır (`_LIST_ITEM_KEYS`) → kural mirası için kullan.
- `config/settings.example.yaml` — ambar yolu `warehouse.db` (repo kökü).
- Testler: `tests/conftest.py` `src`'yi path'e ekler; koşum `python -m pytest -q`.

**Terminoloji disiplini (KİLİTLİ, v1 MASTER §1):** çıplak "kampanya"/"campaign" kodda, Sheets
sekmelerinde, loglarda ve LLM prompt'larında YASAK — `İç Kampanya (İK)` / `İç Kampanya Ailesi
(İKA)` / `İç Kampanya Kategorisi (İKK)` / `meta_campaign|meta_ad_set|meta_ad` kullan.
Denetim: `python scripts/lint_terminology.py`.

## SONUÇ

**Bu aşama bitince:** Yorgunluk tanısı (frekans↑ + CTR↓ trendi) digest'te raporlanıyor ve
block/warn akışı en az bir kullanıcı-aktifleştirilmiş kural setiyle uçtan uca test edilmiş
durumda.

## Önkoşullar

- Aşama 07 kapalı: öneri üretim yolu (`change_proposal` yazan modül) ve digest üreticisi
  çalışıyor. Tespit: `grep -rln "change_proposal" src/reklamzeka scripts` ve
  `grep -rln "digest" src/reklamzeka scripts` boş dönmemeli; `python -m pytest -q` yeşil.
- Ambar şeması güncel: `sqlite3 warehouse.db ".schema copy_rule_set"` tabloyu basmalı
  (yoksa `python -c "from reklamzeka.schema import init_db; init_db('warehouse.db')"`).
- Canlı prova için `metric_snapshot`'ta `meta_ad` seviyesinde ≥14 günlük `frequency/ctr/cpm`
  serisi ve ingest'in çektiği creative metin alanları (`raw_insights.payload`; alan adları
  `docs/api-gercekleri.md`). Yoksa birim testler sentetik koşar, canlı prova kalemi digest'te
  `ölçülemedi` olarak işaretlenir — tahmin yazılmaz.
- `.claude/kanit.json`'da `hizli` ve `tam` girişleri mevcut olmalı; değilse T09.5 bu girişleri
  ekler (yeni kanıt komutu = planın task'ı kuralı).
- Sheets erişimi (`config/settings.yaml` → `sheets.*`) seed'in Sheets ayağı için; yoksa
  `--sqlite-only` ile koşulur ve Sheets ayağı STATE.md'ye açık kalem yazılır.

## Task'lar

### T09.1 — `creative_diag.py`: yorgunluk tanısı + creative_refresh önerisi

**SONUÇ:** Her eşlenmiş `meta_ad` için frekans/CTR/CPM trendi + reklam yaşından deterministik
(LLM'siz) yorgunluk bulgusu üretiliyor; yorgun bulgular `creative_refresh` önerisi olarak onay
kuyruğuna düşüyor.

**Subtask'lar:**
1. `src/reklamzeka/creative_diag.py` — `diagnose_fatigue(conn, window_days=14)`:
   `metric_snapshot`'tan `meta_level='meta_ad'` için son N gün `frequency/ctr/cpm` serileri;
   trend = basit doğrusal eğim (deterministik SQL/Python — v1 MASTER katman 6 deseni: trend
   deterministik, LLM bu modülde YOK). Reklam yaşı: nesne metadata/`raw_insights` içindeki
   oluşturulma tarihi; yoksa ilk snapshot tarihi proxy olarak kullanılır ve bulguda
   `yas_kaynagi='snapshot_proxy'` ile işaretlenir (tahmin gizlenmez).
2. Karar kuralı: `frekans_egim > 0` VE `frekans_son >= esik` VE `ctr_egim < 0` → `verdict='yorgun'`;
   `cpm_egim` destekleyici sinyaldir, bulguda taşınır ama tek başına tetiklemez. Eşikler efektif
   konfigten okunur: `resolve_effective_config(...)['rules']['creative_fatigue']` (İKA `rules` →
   İKK `rules_override`; motor hiçbir aile adını bilmez); yoksa modül varsayılanı tek sabit blokta
   (`frequency_esik=4.0`, `window_days=14`).
3. Bulgu şeması: `{meta_id, ik_id, period, frekans_son, frekans_egim, ctr_egim, cpm_egim,
   yas_gun, yas_kaynagi, verdict}`. Eşlenmemiş `meta_ad` tanıya girmez (yetim raporu zaten
   katman 4'ün işi).
4. Yorgun bulgu → `change_proposal` satırı: `action_type='creative_refresh'`,
   `rationale={brief_id, metric_key:'frequency', threshold, measured}`. Brief'e bağlanamayan İK
   için öneri ÜRETİLMEZ (katman 8 kuralı) — bulgu yalnız rapora düşer. Öneri yeni metin taslağı
   içeriyorsa kuyruğa yazılmadan ÖNCE T09.2 `gate()` süzgecinden geçer.

**Kabul kriteri (kanıt):** `python -m pytest tests/test_creative_diag.py -q` → tümü geçer
(`failed` yok); senaryolar: (a) sentetik yükselen frekans + düşen CTR → `verdict='yorgun'` +
`creative_refresh` satırı, (b) düz seri → bulgu yok, (c) brief'siz İK → öneri yok ama bulgu var.

### T09.2 — `copy_rules.py` motoru: miras çözümü, gate, kural referanslı log, üç uygulama noktası

**SONUÇ:** Aktif kurallar taksonomi mirasıyla çözülüyor; tek kapı `gate()` block'ta metni
kuyruğa sokmadan düşürüp `copy_rule_log`'a yazıyor, warn'da bulguyu diff'e iliştiriyor; üç
uygulama noktası bu kapıdan geçiyor.

**Subtask'lar:**
1. `src/reklamzeka/copy_rules.py` — `applicable_rules(conn, ik_id)`: `copy_rule_set`'ten
   `aktif=1` satırlar; kapsam çözümü İK'nın kategori→aile zinciriyle: `global` (scope_ref NULL)
   + `family` (scope_ref = İK'nın family_id) + `category` (scope_ref = category_id). Birleşim
   mevcut `taxonomy.deep_merge` ile: kural sözlükleri `id`=rule_id anahtarına normalize edilip
   `deep_merge({'rules': global}, {'rules': aile}, {'rules': kategori})` — `_LIST_ITEM_KEYS`
   `id`'yi zaten tanır; aynı `rule_id` alt kapsamda override eder (G4.1).
2. `evaluate_text(text, rules) -> findings[{rule_id, severity, pattern_type, eslesme, aciklama}]`:
   `regex` → `re.search(..., re.IGNORECASE)`; `keyword` → TR `casefold` normalizasyonuyla ifade
   eşleşmesi; `llm_check` → headless `claude -p` TEK toplu çağrı (metin + tüm aktif llm_check
   kuralları birlikte; kural başına çağrı YOK — maliyet). LLM çıktısı parse edilemezse bulgu
   `olculemedi` işaretli üretilir, sessiz geçilmez; `block` severity'li llm_check belirsizse
   metin kuyruğa GİRMEZ (fail-closed — kontrol-öncelikli sistemde şüpheli metni geçirmek,
   yanlışlıkla bekletmekten pahalıdır).
3. `gate(conn, text, ik_id, uygulama_noktasi) -> (dusuruldu: bool, findings)` tek kapı:
   block bulgusu → `(True, findings)` + `copy_rule_log` kaydı; warn bulguları çağırana döner,
   çağıran `change_proposal.copy_rule_findings`'e iliştirir.
4. `copy_rule_log` tablosu `src/reklamzeka/schema.py` DDL'ine eklenir (append-only):
   `log_id, rule_id, severity, uygulama_noktasi ('oneri'|'iskelet'|'tarama'), ik_id,
   meta_id (ops.), metin_hash (sha256), metin_ozet (ilk 200 kr), created_at`. Tam metin yerine
   özet+hash: log şişmez, KVKK yüzeyi dar kalır (reklam metni kişisel veri değil, yine de
   asgari tutulur).
5. Üç uygulama noktası (G4.1 md.3):
   - **(a) öneri üretimi:** metin içeren `change_proposal` üreten yol(lar)da — T09.1 çıktısı ve
     aşama 07'nin öneri modülü — kuyruk yazımından ÖNCE `gate(..., 'oneri')`.
   - **(b) AI şablon iskeleti:** motor `check_scaffold(conn, draft: dict, scope_ref) -> findings`
     sağlar (taslağın metin alanlarını gate'ten geçirir). Aşama 05'in `skeleton.py`'sindeki
     işaretli bağlantı noktasına bağlanır: Sheets'e `status=draft` yazımından önce koşar.
   - **(c) periyodik tarama:** `src/reklamzeka/copy_scan.py` — ingest'in çektiği mevcut reklam
     metinlerini (`raw_insights.payload` creative alanları) aktif kurallarla tarar; taramada
     block/warn ayrımı YALNIZ rapordur (yayındaki metin düşürülemez), bulgular
     `copy_rule_log`'a `uygulama_noktasi='tarama'` ile yazılır ve T09.4 digest özetine girer.

**Kabul kriteri (kanıt):** `python -m pytest tests/test_copy_rules.py -q` → tümü geçer;
senaryolar: block kuralı → `gate` `(True, …)` + `copy_rule_log`'da `rule_id`'li satır; warn →
kuyruğa giren öneride `copy_rule_findings` dolu; miras → kategori kuralı aynı `rule_id`'li
global kuralı eziyor; `aktif=0` kural HİÇBİR noktada uygulanmıyor.

### T09.3 — Başlangıç paketi: v1 §7 listesi pasif + kaynak notlu yüklenir (✋ İNSAN kapısı)

**SONUÇ:** Riskli-ifade/pratik listesi `copy_rule_set`'e `aktif=0` + `kaynak_notu` ile
yüklenmiş; kurulum sonrası hiçbir kural aktif değil; aktivasyon kullanıcıya devredilmiş.

**Subtask'lar:**
1. `config/copy_rules_baslangic.yaml` — v1 MASTER §7 listesinin mekanik dönüştürümü:
   fiyat-indirim, üstünlük iddiası, garanti/kesin sonuç, testimonial/hasta deneyimi,
   önce/sonra koşulları, yönlendirme kalıpları (pattern_type: `keyword`/`regex`) + yapısal
   bayraklar: yurt içi hedefli sponsorluk, hasta görselli boost (pattern_type: `llm_check`).
   Her kayıt: `rule_id` (`bp-` öneki), `scope='global'`, `pattern`, `severity` ÖNERİSİ,
   `aciklama` ("aday — kullanıcı gözden geçirir" dilinde; hukuki hüküm YAZILMAZ),
   `kaynak_notu` (v1 MASTER §7 · RG 12.11.2025 · KVKK 2023/787 referansı).
2. `scripts/seed_copy_rules.py` — YAML'ı SQLite `copy_rule_set`'e ve Sheets
   `METIN_KURAL_SETLERI` sekmesine (yeni satır append) `aktif=0` ile yükler. İdempotent:
   var olan `rule_id`'ye DOKUNMAZ (kullanıcının düzenlemesi/aktivasyonu ezilmez).
   Bayraklar: `--dry-run` (yüklenecekleri listeler, yazmaz), `--sqlite-only` (Sheets erişimi yoksa).
3. ✋ İNSAN: kurulumdan sonra kullanıcıdan en az bir kural setini gözden geçirip Sheets'te
   `aktif=1` yapması istenir (aşama SONUÇ'unun ve T09.5 canlı provasının önkoşulu). Sistem bu
   alanı ASLA yazmaz; istek digest/DURUM bloğunda açık komutla iletilir.

**Kabul kriteri (kanıt):** `python scripts/seed_copy_rules.py --dry-run` → "N kural yüklenecek ·
tümü aktif=0" listesi; seed sonrası
`sqlite3 warehouse.db "SELECT COUNT(*) FROM copy_rule_set WHERE aktif=1;"` → `0` (aktivasyon
öncesi); ikinci koşum → "0 yeni kural" (idempotens);
`python -m pytest tests/test_seed_copy_rules.py -q` → tümü geçer.

### T09.4 — Digest: yorgunluk bölümü · aktif kural sayısı · tarama özeti

**SONUÇ:** Digest'te üç yeni bölüm var; aktif kural sayısı 0 iken sessiz boşluk yerine açık
uyarı basılıyor.

**Subtask'lar:**
1. Aşama 06'nın digest üreticisine **"Creative Yorgunluk"** bölümü: yorgun `meta_ad` listesi
   (İK adıyla), trend özeti, açılan `creative_refresh` önerilerinin `proposal_id`'leri; veri
   yetersizse `ölçülemedi`.
2. **"Metin Kuralları"** bölümü: `SELECT COUNT(*) FROM copy_rule_set WHERE aktif=1` göstergesi;
   sayı 0 ise digest AÇIKÇA yazar: "0 aktif metin kuralı — süzgeç ve tarama etkisiz; başlangıç
   paketi gözden geçirilip aktive edilmeyi bekliyor" (sessiz boşluk YASAK).
3. **Tarama özeti:** son `copy_scan` koşusundan bulgu sayısı (block/warn kırılımı) + en çok
   tetiklenen ilk 3 kural (`copy_rule_log`'dan).

**Kabul kriteri (kanıt):** `python -m pytest tests/test_digest_creative.py -q` → tümü geçer;
sentetik ambarla üretilen digest metninde üç bölüm başlığı VE (aktif kural 0 fixture'ında)
açık uyarı cümlesi doğrulanır.

### T09.5 — Uçtan uca block/warn doğrulaması + kanıt kaydı

**SONUÇ:** Block/warn akışı testte VE kullanıcı-aktifleştirilmiş gerçek kural setiyle canlıda
uçtan uca kanıtlanmış; kanıt girişleri kanit.json'da.

**Subtask'lar:**
1. `tests/test_copy_rules_e2e.py` — sentetik ambar fixture'ı (aktif block + aktif warn kuralı):
   öneri akışı koşulur → block'lu metin `change_proposal`'a HİÇ yazılmıyor + `copy_rule_log`'da
   kural referanslı satır; warn'lı metin kuyruğa düşüyor + `copy_rule_findings` dolu; digest
   çıktısı bölümleri içeriyor.
2. Canlı prova (✋ T09.3 aktivasyonundan SONRA): kullanıcının aktive ettiği kural setiyle
   `copy_scan` + tanı/öneri akışı bir kez koşulur; digest çıktısı ve `copy_rule_log` satırı
   dosya/sorgu yoluyla STATE.md'ye kanıt olarak işlenir. Aktivasyon gelmediyse aşama KAPANMAZ —
   DURUM bloğunda ✋ ile beklemeye alınır.
3. `.claude/kanit.json` denetimi: yeni test dosyaları `hizli` girişinin kapsamına giriyor mu
   (`python -m pytest -q` tüm testleri koşuyorsa girer); e2e + canlı prova adımı `tam` girişine
   eklenir. Giriş yoksa/eksikse bu task ekler — çıplak serbest-metin doğrulama bırakılmaz.

**Kabul kriteri (kanıt):** `python -m pytest tests/test_copy_rules_e2e.py -q` → tümü geçer;
`sqlite3 warehouse.db "SELECT rule_id, uygulama_noktasi FROM copy_rule_log ORDER BY log_id DESC LIMIT 5;"`
→ canlı provadan en az 1 satır; STATE.md'de kanıt yolları.

## Task checklist

- [ ] T09.1 — yorgunluk tanısı · kanıt: `python -m pytest tests/test_creative_diag.py -q` → geçer
- [ ] T09.2 — copy_rules motoru + gate + log + 3 nokta · kanıt: `python -m pytest tests/test_copy_rules.py -q` → geçer
- [ ] T09.3 — başlangıç paketi pasif seed (✋ aktivasyon kullanıcıda) · kanıt: seed sonrası `aktif=1` sayısı `0`; dry-run/idempotens çıktısı
- [ ] T09.4 — digest bölümleri + 0-aktif-kural uyarısı · kanıt: `python -m pytest tests/test_digest_creative.py -q` → geçer
- [ ] T09.5 — uçtan uca block/warn + canlı prova + kanit.json · kanıt: e2e testi geçer; `copy_rule_log`'da canlı satır

## Aşama requirements

| id | requirement | doğrulama | delege |
|---|---|---|---|
| R09.1 | `meta_ad` yorgunluk tanısı (frekans↑ + CTR↓ + CPM trend + yaş) deterministik hesaplanır; digest'te bölüm olarak raporlanır | `kanit:hizli` | — |
| R09.2 | `severity=block` metin önerisi kuyruğa HİÇ düşmez; düşmeme `copy_rule_log`'da kural referansıyla durur (`uy:uyum-guveni/kural-motoru`) | `kanit:tam` | — |
| R09.3 | `severity=warn` bulgusu `change_proposal.copy_rule_findings`'e iliştirilir | `kanit:hizli` | — |
| R09.4 | Kural mirası global→İKA→İKK `deep_merge` ile çözülür; alt kapsam aynı `rule_id`'yi override eder; `aktif=0` kural hiçbir noktada uygulanmaz | `kanit:hizli` | — |
| R09.5 | Başlangıç paketi `aktif=0` + `kaynak_notu` ile yüklenir; kurulum sonrası aktif kural sayısı 0; aktivasyon yalnız kullanıcı eylemi (`uy:uyum-guveni/baslangic-paketi-pasif`) | `kanit:hizli` | — |
| R09.6 | Digest aktif kural sayısını gösterir; 0 aktifken açık uyarı basılır (sessiz boşluk yok) | `kanit:hizli` | — |
| R09.7 | Üç uygulama noktası (öneri üretimi · iskelet çıktısı · periyodik tarama) tek `gate` kapısından geçer; creative_refresh dahil hiçbir metin önerisi süzgeçsiz kuyruğa yazılmaz | `kanit:tam` | — |

## Doğrulama (aşama kapanışı)

1. `python -m pytest -q` → TÜM testler geçer (yeni 4+ test dosyası dahil; `failed` yok).
2. `python scripts/lint_terminology.py` → exit 0 (yeni modüllerde çıplak terim yok).
3. `sqlite3 warehouse.db "SELECT COUNT(*) FROM copy_rule_set;"` → ≥ başlangıç paketi kadar satır;
   aktivasyon ÖNCESİ `WHERE aktif=1` → `0`.
4. ✋ İNSAN: en az bir kural seti Sheets `METIN_KURAL_SETLERI`'nde kullanıcı tarafından `aktif=1`
   yapılmış (`sqlite3 warehouse.db "SELECT COUNT(*) FROM copy_rule_set WHERE aktif=1;"` → ≥ 1).
   Bu adım gelmeden aşama "bitti" İLAN EDİLMEZ.
5. Canlı prova: tanı + `copy_scan` + öneri akışı koşulmuş; digest çıktısında üç bölüm; block/warn
   kanıtı `copy_rule_log` sorgusu + STATE.md yollarıyla. `kanit:tam` koşusu yeşil.

## Efor/maliyet notu

- Koşum tek-ajan; tanı ve regex/keyword süzgeci tamamen deterministik → LLM token maliyeti SIFIR.
- LLM maliyeti yalnız `llm_check` kuralı aktifken ve metin başına TEK toplu `claude -p` çağrısı
  (kural başına çağrı yok).
- Takvim riski: aşama kapanışı ✋ kullanıcı aktivasyonuna kapılı — kod bitse de prova kullanıcıyı
  bekleyebilir; bekleme DURUM bloğunda ⏸ + ✋ olarak ilan edilir.
- Tahmini hacim: 3 yeni modül (`creative_diag.py`, `copy_rules.py`, `copy_scan.py`) + 1 script +
  1 YAML + 1 DDL ekleme (`copy_rule_log`) + 4-5 test dosyası.

## Bitirirken (zorunlu)

1. `CHECKLIST.md`'de bu aşamanın maddelerini işaretle.
2. `STATE.md`'ye tur kaydı yaz: tarih · yapılan · kanıt yolları · açık kalan.
