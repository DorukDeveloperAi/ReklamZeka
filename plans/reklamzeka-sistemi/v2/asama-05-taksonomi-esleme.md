---
kosum: tek-ajan
getirir:
  - dugum: modul:src/reklamzeka/taxonomy_loader.py
  - dugum: modul:src/reklamzeka/mapping.py
  - dugum: modul:src/reklamzeka/skeleton.py
  - dugum: arac:scripts/run_weekly.sh
---
# Aşama 05 — TAKSONOMİ VE EŞLEME (v2)

> Roadmap: [MASTER.md](MASTER.md) · Bağımlı: 03, 04
> Bu dosya KENDİ BAŞINA yeterlidir: taze bir /goal session'ı yalnız bunu okuyarak işi bitirebilmeli.

## Bağlam (bu aşamayı koşan session için)

Sistemin yargı zinciri "Meta nesnesi → İç Kampanya (İK) → brief → skor"dur; bu aşama zincirin
ilk iki halkasını canlıya bağlar. v1 temeli hazır ama **veriye değmemiş** durumda:

- `src/reklamzeka/taxonomy.py` — `resolve_effective_config(family, category, instance)` saf
  birleştirme olarak var (dict derin birleşir, instance kazanır, `None` anahtar siler,
  dict-listeler `metric_key|key|id|name` kimliğiyle birleşir). **Sheets'ten katman okuyan
  loader yok** — bu aşama onu ekler; `taxonomy.py`'ye DOKUNULMAZ (motor saf kalır).
- `src/reklamzeka/schema.py` — `meta_object_mapping` tablosu hazır: `meta_level
  (meta_campaign|meta_ad_set|meta_ad), meta_id, ik_id, match_method
  (name_rule|manual|ai_suggested), confidence, verified_by_user, UNIQUE(meta_level, meta_id)`.
- `src/reklamzeka/sheets_schema.py` — `ESLEME_TABLOSU` sekmesi aynı kolonlarla tanımlı;
  `IC_KAMPANYA_AILELERI / IC_KAMPANYA_KATEGORILERI / IC_KAMPANYALAR / BRIEFLER` sekmeleri insan-yazar kanon.
- Aşama 04 ambarı doldurdu (`warehouse.db`: `raw_insights`, `metric_snapshot`), aşama 03
  Sheets↔SQLite senkronunu kurdu (Sheets insan-yazar alanlarda kanon; sistem sekmelere yalnız
  **append** eder, insan hücresi asla ezilmez).
- Aşama 02'nin canlı doğrulaması `docs/api-gercekleri.md` teyitsiz-tablo **#5**'i doldurdu:
  uygulama-içi boost'un ad account'taki gerçek yapısı (ad kalıbı, objective, creative bağı).
  Boost sınıflandırıcısı BU bulguya kalibre edilir, varsayıma değil.

Hedeflenen değişmezler (utopya/vizyon/1-veri-gercegi.md **G1.3**): hesaptaki her canlı Meta
nesnesi ya bir İK'ya eşlidir ya yetim raporunda görünür — sessizce kapsam dışı nesne olamaz;
`ai_suggested` eşleme kullanıcı onayı (`verified_by_user=1`) olmadan değerlendirmeye girmez.

**Terminoloji serti (MASTER §1):** çıplak "kampanya" kelimesi kod/Sheets/log/prompt'ta yasak —
her zaman "Meta Campaign" ya da "İç Kampanya (İK/İKK/İKA)". `python scripts/lint_terminology.py`
her task kapanışında koşar. LLM prompt şablonlarının başına sözlük bloğu enjekte edilir.

**Bu aşamada skor/öneri ÜRETİLMEZ:** `evaluation` ve `change_proposal` sonraki aşamaların işidir.
Bu aşama biterken İK'lar eşli ve brief'li durur; değerlendirme motoru bu zemine oturacak.

## SONUÇ

**Bu aşama bitince:** İki zıt İç Kampanya Ailesi (Marka Doktor + Satış) Sheets'te `status=active`;
gerçek İç Kampanyalar brief'leriyle kayıtlı ve her aktif İK en az bir Meta nesnesine eşli
(`meta_object_mapping`); efektif konfig canlı Sheets verisinden `resolve_effective_config` ile
taze çözülüyor; yetim Meta nesnesi raporu haftalık kadansla üretiliyor ve satır sayısı ölçülüyor;
yeni İKK tanımı için AI şablon iskeleti akışının ilk sürümü `status=draft` satır yazabiliyor.

## Önkoşullar

- Aşama 04 ambarı dolu: `sqlite3 warehouse.db "SELECT COUNT(*) FROM raw_insights"` → `> 0`.
- Meta nesne envanteri ambarda: `sqlite3 warehouse.db ".tables"` çıktısında aşama 04'ün nesne
  envanteri tablosu (adını `plans/reklamzeka-sistemi/v2/STATE.md` aşama-04 tur kaydından al).
  **Böyle bir tablo YOKSA** T05.3'ün ilk subtask'ı `meta_object_cache` tablosunu kurar (aşağıda).
- Aşama 03 senkronu çalışır: Sheets→SQLite çekiş komutu STATE.md aşama-03 tur kaydında yazar;
  bir koşusu hatasız biter ve `internal_campaign_family` cache tablosu okunabilir.
- Aşama 02 boost bulgusu kapalı: `rg -n "Uygulama-içi boost" docs/api-gercekleri.md` → satırın
  Sonuç hücresi dolu (⬜ DEĞİL). Boşsa bu aşama boost ayağında BLOKE — kullanıcıya bildir.
- Sheets erişimi: `config/settings.yaml` içinde `spreadsheet_id` + `credentials_path` dolu.
- Lint mevcut: `python scripts/lint_terminology.py` → exit 0 (mevcut ağaçta).

## Task'lar

### T05.1 — ✋ İNSAN ADIMI: İKA/İKK/İK tanımları + brief girişi (istek turun BAŞINDA gider)
**SONUÇ:** İki zıt aile ve gerçek İK'lar Sheets'te insan eliyle tanımlı, her aktif İK'nın brief'i var.
**Subtask'lar:**
1. Aşağıdaki bilgi istek listesini kullanıcıya İLET (v1 MASTER §10 soru 2-3 ile örtüşür), sonra
   BEKLEME — kod task'larına (T05.2+) devam et; kullanıcı Sheets'i paralel doldurur:
   - **İsimlendirme düzeni** (§10 s2): mevcut Meta nesnelerinde bir ad kalıbı var mı? Varsa örnek
     ver — isim kuralı ayağı (T05.3) buna kalibre edilir; yoksa `[İK-<id>]` öneki yalnız yeni
     nesnelere uygulanır.
   - **İKA envanteri** (§10 s3): Marka Doktor + Satış dışında bugün fiilen koşan aile var mı?
   - **İKK listesi** (§10 s3): Satış ailesinin iç türleri (ör. sağlık turizmi, check-up) ve her
     İKK'nın bütçe tanım seviyesi (`instance` | `category`); Marka Doktor tarafında doktor/sayfa
     yapısı (`page_ref` listesi) ve işin boost mu feed reklamı mı olduğu.
   - **Aktif İK kayıtları** (`IC_KAMPANYALAR` sekmesi): ik_id, ad, category_id, page_ref,
     bütçe (amount/period/level), start/end, varsa instance attribute'ları.
   - **Brief'ler** (`BRIEFLER` sekmesi): her aktif İK (ya da kategorisi) için hedef_cumlesi,
     `kpi_targets` = `[{metric_key, target, threshold_warn, threshold_fail}]`, kisitlar, tarih.
   - **Onay turu (T05.3 çıktısı hazır olunca ikinci ✋):** `ESLEME_TABLOSU`'ndaki `ai_suggested`
     satırlarında `verified_by_user` işareti — onay/red tamamen kullanıcıda.
2. Girişi kolaylaştırmak için iki aile + kategorileri için `status=draft` ÖNERİ satırları append
   et (içerik önerisi serbest, aktivasyon YASAK — `active`'e geçiş yalnız insan eliyle).
3. Kullanıcı girişi bitince aşama-03 senkron komutuyla cache'i tazele.
**Kabul kriteri (kanıt):** `sqlite3 warehouse.db "SELECT COUNT(*) FROM internal_campaign_family WHERE status='active'"` → `>= 2` (Marka Doktor + Satış dahil) **ve** `sqlite3 warehouse.db "SELECT COUNT(*) FROM internal_campaign WHERE status='active' AND (brief_id IS NULL OR brief_id='')"` → `0`

### T05.2 — Taksonomi loader: efektif konfig canlı Sheets verisiyle
**SONUÇ:** `resolve_effective_config` gerçek bir ik_id için Sheets→SQLite cache'ten okunan üç katmanla çözülür.
**Subtask'lar:**
1. Yeni modül `src/reklamzeka/taxonomy_loader.py`: `load_layers(conn, ik_id) -> (family_cfg,
   category_cfg, instance_cfg)`. Kolon→konfig anahtarı eşlemesi modül sabitidir; aynı anahtar
   uzayına haritalanır ki override çalışsın: family `attribute_schema/default_kpi_targets→
   kpi_targets/rules/analysis_logic_ref→analysis_logic/default_goal_scopes→goal_scopes`;
   category `*_override` kolonları aynı çıplak anahtarlara + `medium/page_type/goal_scope/
   budget_definition`; instance `attributes` (yalnız override) + `page_ref/budget_*/start_date/
   end_date`. JSON kolonlar `json.loads` ile açılır; bozuk JSON = satır referanslı açık hata.
2. `resolve(conn, ik_id)` = `resolve_effective_config(*load_layers(...))` — her çağrıda taze,
   hiçbir katman kopyalanıp donmaz (MASTER §2.3). Statü filtrelemez; CLI `draft/paused` katman
   görürse stderr'e uyarı basar, exit 0.
3. CLI: `python -m reklamzeka.taxonomy_loader --ik <ik_id> [--db warehouse.db]` → efektif konfig
   JSON stdout'a.
4. Test `tests/test_taxonomy_loader.py`: geçici SQLite fikstürü (schema.py `init_db`) ile
   aile→kategori→instance override zinciri + `None`-siler kuralı + bozuk JSON hatası.
**Kabul kriteri (kanıt):** `.venv/bin/pytest tests/test_taxonomy_loader.py -q` → tümü `passed`; ardından gerçek veride `.venv/bin/python -m reklamzeka.taxonomy_loader --ik <T05.1'deki bir aktif ik_id>` → üç katmandan da anahtar içeren tek JSON

### T05.3 — mapping.py: üç eşleme yolu + Eşleme Kaydı yazımı
**SONUÇ:** İsim kuralı / AI önerisi / manuel satır yollarıyla Eşleme Kaydı üretilir; öncelik ve onay kuralları koddadır.
**Subtask'lar:**
1. Nesne envanteri kaynağını sabitle: aşama 04'ün envanter tablosu VARSA onu oku; YOKSA
   `schema.py` DDL'ine `meta_object_cache (meta_level, meta_id, name, effective_status,
   meta_objective, parent_level, parent_id, creative_ref, advantage_state_info, fetched_at,
   PRIMARY KEY (meta_level, meta_id))` ekle ve `mapping.py refresh` alt komutu `MetaGateway`
   (salt-okuma) ile doldursun. "Canlı" tanımı: `effective_status ∈ {ACTIVE, PAUSED}`
   (ARCHIVED/DELETED kapsam dışı).
2. `src/reklamzeka/mapping.py` — **isim kuralı:** ad başında `[İK-<id>]` (İ/I iki yazım da kabul,
   ik_id'ye normalize) → `match_method=name_rule, confidence=1.0, verified_by_user=1` (önek insan
   eliyle konulmuş sözleşmedir). Üst nesne eşliyse altındaki Meta Ad Set / Meta Ad'lere aynı İK'ya
   türetilmiş `name_rule` satırı yazılır (yetim seli önlenir). Kullanıcı T05.1'de mevcut bir ad
   kalıbı bildirdiyse kural ona da kalibre edilir.
3. **AI önerisi:** eşlenmemiş canlı nesneler + aktif İK listesi TEK toplu headless `claude -p`
   çağrısına gider (prompt şablonu `src/reklamzeka/prompts/esleme_onerisi.md`, başında MASTER §1
   sözlük bloğu); çıktı `[{meta_level, meta_id, ik_id, confidence, gerekce}]` JSON'u →
   `match_method=ai_suggested, verified_by_user=0` olarak yazılır. **Onay Sheets'te:** kullanıcı
   `ESLEME_TABLOSU`'nda `verified_by_user` işaretler (T05.1 ikinci ✋), senkron cache'e taşır.
   Otomatik onay YOK — eşiğe bakılmaksızın.
4. **Manuel:** kullanıcının `ESLEME_TABLOSU`'na elle yazdığı satır senkronla gelir,
   `match_method=manual, verified_by_user=1` sayılır.
5. Öncelik/çakışma: `manual > name_rule > ai_suggested`; `UNIQUE(meta_level, meta_id)` korunur;
   onaylı mevcut satırın ÜZERİNE hiçbir yol yazamaz; çelişki (önek ↔ manuel satır farklı İK)
   yetim raporuna `çelişki` bölümü olarak düşer — sistem karar VERMEZ. Sekmeye yalnız append;
   satır düzeltme/silme insanındır.
6. CLI: `python -m reklamzeka.mapping scan [--dry-run]` → yol başına eklenen/atlanan sayaç raporu;
   `suggest` alt komutu AI turunu ayrı koşar (token maliyeti görünür olsun).
7. Test `tests/test_mapping.py`: önek ayrıştırma + normalize, üstten türetme, öncelik/çakışma,
   onaysız `ai_suggested`'ın "eşli" SAYILMADIĞI filtre (`verified_by_user=1 OR
   match_method IN ('name_rule','manual')`).
**Kabul kriteri (kanıt):** `.venv/bin/pytest tests/test_mapping.py -q` → tümü `passed`; `.venv/bin/python -m reklamzeka.mapping scan --dry-run` → üç yolun sayaçlarını basan rapor, hata yok

### T05.4 — Boost sınıflandırıcısı (aşama 02 bulgusuna kalibre)
**SONUÇ:** Uygulama-içi boost'un ürettiği Meta nesneleri deterministik tanınır ve eşleme akışına girer.
**Subtask'lar:**
1. `docs/api-gercekleri.md` #5 Sonuç hücresindeki gerçek yapıyı (ad kalıbı, `meta_objective`,
   creative bağı / `source_instagram_media_id`) `mapping.py` içinde `classify_boost(nesne) ->
   {is_boost, source_instagram_media_id|None, page_ref_tahmini|None}` olarak kodla — kalıp
   varsayımdan değil bulgudan gelir; bulgu belirsiz bıraktığı alanda `is_boost=None` (bilinmiyor)
   döner, tahmin uydurmaz.
2. Aşama 02 dökümünden gerçek boost nesne örneklerini `tests/fixtures/boost_ornekleri.json`'a koy
   (meta_id'ler maskelenebilir); pozitif + negatif (normal feed reklamı) örnek şart.
3. Boost nesneleri isim kuralı taşımaz → sınıflandırıcı bulgusu yetim raporunda `boost` etiketiyle
   gruplanır ve AI öneri çağrısına `page_ref` ipucu olarak eklenir (Marka Doktor eşleşmesini
   kolaylaştırır); eşleme yine yalnız onayla kurulur.
4. Test `tests/test_boost_classifier.py`: fikstürdeki her örnek beklenen sınıfa düşer.
**Kabul kriteri (kanıt):** `.venv/bin/pytest tests/test_boost_classifier.py -q` → tümü `passed` (fikstür aşama 02'nin GERÇEK dökümünden türetilmiş olmalı; sentetik fikstürle geçen test kanıt DEĞİLDİR)

### T05.5 — Yetim Meta nesnesi raporu + haftalık kadans
**SONUÇ:** Eşlenmemiş canlı nesneler haftalık raporda görünür ve satır sayısı ölçülür; sessiz kapsam-dışı nesne kalmaz (G1.3).
**Subtask'lar:**
1. `python -m reklamzeka.mapping orphans [--db warehouse.db]`: canlı nesne envanteri LEFT JOIN
   `meta_object_mapping` → eşlenmemişler `reports/yetim/<YYYY-MM-DD>.md`'ye (başlıkta toplam sayı;
   bölümler: `boost` / `çelişki` / `diğer`; her satır meta_level · meta_id · name ·
   effective_status). stdout'a tek satır özet: `yetim=<N> çelişki=<M>`.
2. Onaysız `ai_suggested` satırı olan nesne raporda "öneri bekliyor" olarak İŞARETLİ kalır —
   onaysız öneri nesneyi yetimlikten ÇIKARMAZ (G1.3 onay şartı).
3. Haftalık kadans: `scripts/` altında önceki aşamalardan kalan haftalık koşu scripti VARSA yetim
   adımını ona ekle; YOKSA `scripts/run_weekly.sh` oluştur (şimdilik tek adım: senkron çekişi +
   `mapping scan` + `mapping orphans`) ve crontab'a haftalık satır ekle. Script idempotent:
   aynı gün ikinci koşu aynı rapor dosyasını yeniden üretir, hüküm değişmez.
**Kabul kriteri (kanıt):** `.venv/bin/python -m reklamzeka.mapping orphans` → `reports/yetim/<bugün>.md` doğar ve stdout `yetim=<N> çelişki=<M>` basar; `crontab -l | grep -c run_weekly` → `1`

### T05.6 — AI şablon iskeleti akışı v1 (yeni İKK → status=draft)
**SONUÇ:** Yeni İKK tanımı istendiğinde AI, aile mirasından attribute/KPI taslağı üretir ve Sheets'e `status=draft` yazar; motor kodu değişmez (MASTER §4.a).
**Subtask'lar:**
1. `src/reklamzeka/skeleton.py` + CLI `python -m reklamzeka.skeleton --family <family_id>
   --ad "<İKK adı>"`: aile efektif konfigi (T05.2 loader'ı) + boyut envanteri (mevcut
   `medium/page_type/goal_scope` değerleri Sheets cache'ten) bağlamıyla headless `claude -p`
   çağrısı (prompt şablonu `src/reklamzeka/prompts/iskelet_ikk.md`, başında sözlük bloğu).
2. Çıktı JSON: `attribute_schema_override, medium, page_type, goal_scope, kpi_targets_override`
   taslağı → `IC_KAMPANYA_KATEGORILERI`'ne `status=draft` satır APPEND. Aktivasyon insanda:
   kullanıcı düzenler, `active` yapar (bu aşamada aktivasyon istenmez).
3. Metin kural denetimi (MASTER §7 uygulama noktası b) aşama-09 motoru gelince bağlanacak —
   `skeleton.py`'de bağlantı noktasını tek yorum satırıyla işaretle, uygulama YAZMA.
4. Prova: gerçek bir aile üzerinde bir koşum (ör. Satış ailesinden "Sağlık Turizmi Hunisi").
**Kabul kriteri (kanıt):** `.venv/bin/python -m reklamzeka.skeleton --family <aktif family_id> --ad "Sağlık Turizmi Hunisi"` sonrası senkron çekişiyle `sqlite3 warehouse.db "SELECT COUNT(*) FROM internal_campaign_category WHERE status='draft'"` → `>= 1`; `git diff --quiet src/reklamzeka/taxonomy.py && echo MOTOR-DEGISMEDI` → `MOTOR-DEGISMEDI`

## Task checklist

- [ ] T05.1 — ✋ İKA/İKK/İK + brief girişi · kanıt: aktif aile sayısı `>= 2` ve brief'siz aktif İK → `0`
- [ ] T05.2 — taksonomi loader · kanıt: `.venv/bin/pytest tests/test_taxonomy_loader.py -q` → passed; CLI gerçek ik_id ile üç katmanlı JSON
- [ ] T05.3 — mapping üç yol · kanıt: `.venv/bin/pytest tests/test_mapping.py -q` → passed; `mapping scan --dry-run` → sayaç raporu
- [ ] T05.4 — boost sınıflandırıcısı · kanıt: `.venv/bin/pytest tests/test_boost_classifier.py -q` → passed (gerçek dökümden fikstür)
- [ ] T05.5 — yetim rapor + haftalık · kanıt: `mapping orphans` → rapor dosyası + `yetim=<N>`; `crontab -l | grep -c run_weekly` → `1`
- [ ] T05.6 — AI iskeleti v1 · kanıt: draft İKK satırı → `>= 1`; `git diff --quiet src/reklamzeka/taxonomy.py` → `MOTOR-DEGISMEDI`

## Aşama requirements

| id | requirement | doğrulama | delege |
|---|---|---|---|
| R-05.1 | Hesaptaki her canlı Meta nesnesi ya eşli ya yetim raporunda; sessiz kapsam-dışı yok | `kanit:tam` + `mapping orphans` → `yetim=<N>` ölçümü | G1.3 (utopya/vizyon/1-veri-gercegi.md) |
| R-05.2 | Üç eşleme yolu (name_rule / ai_suggested / manual) öncelik kurallarıyla çalışır | `kanit:hizli` (test_mapping.py) | MASTER §3 katman 4 |
| R-05.3 | Onaysız `ai_suggested` eşleme "eşli" sayılmaz; onay yalnız insan eliyle | `kanit:hizli` (test_mapping.py onay-filtre senaryosu) | G1.3 kabul ölçütü |
| R-05.4 | Boost nesneleri aşama-02 bulgusuna kalibre sınıflandırılır | `kanit:hizli` (test_boost_classifier.py, gerçek-döküm fikstürü) | api-gercekleri #5 |
| R-05.5 | Efektif konfig her koşuda Sheets cache'ten TAZE çözülür; hiçbir katman kopyalanıp donmaz | `kanit:hizli` (test_taxonomy_loader.py) | MASTER §2.3 |
| R-05.6 | AI iskeleti yalnız `status=draft` yazar; aktivasyon ve içerik onayı insanda; motor kodu diff'siz | `kanit:tam` + `git diff --quiet src/reklamzeka/taxonomy.py` | MASTER §4.a · karar 3 |
| R-05.7 | Terminoloji serti korunur (çıplak terim yok) | `kanit:hizli` (lint_terminology) | MASTER §1 lint |

## Doğrulama (aşama kapanışı)

Sıra önemli; tamamı SONUÇ cümlesinin üç yüklemini kanıtlar. İdempotens: 5-6'yı iki kez koşmak
hükmü değiştirmemeli.

1. `kanit:hizli` → yeşil (birim testler + terminoloji lint'i).
2. Aşama-03 senkron çekişi → hatasız; cache taze.
3. `sqlite3 warehouse.db "SELECT COUNT(*) FROM internal_campaign_family WHERE status='active'"` → `>= 2` (Marka Doktor + Satış dahil).
4. `sqlite3 warehouse.db "SELECT COUNT(*) FROM internal_campaign ic WHERE ic.status='active' AND NOT EXISTS (SELECT 1 FROM meta_object_mapping m WHERE m.ik_id=ic.ik_id AND (m.verified_by_user=1 OR m.match_method IN ('name_rule','manual')))"` → `0` (eşlemesiz aktif İK yok).
5. `.venv/bin/python -m reklamzeka.mapping orphans` → `reports/yetim/<bugün>.md` + `yetim=<N> çelişki=<M>`; N kayda geçer (0 olması ŞART değil — ölçülüyor olması şart).
6. `bash scripts/run_weekly.sh` → uçtan uca hatasız; ikinci koşu aynı hüküm. `crontab -l | grep -c run_weekly` → `1`.
7. `.venv/bin/python -m reklamzeka.taxonomy_loader --ik <gerçek aktif ik_id>` → üç katmanlı efektif konfig JSON.
8. `kanit:tam` → yeşil.

## Efor/maliyet notu

Token-ağır yalnız iki nokta: AI eşleme önerisi (koşu başına TEK toplu `claude -p` çağrısı) ve
İKK iskeleti (İKK başına bir çağrı) — geri kalanı deterministik Python + SQLite, tarayıcı yok.
Kod eforu ~4 yeni modül + 3 test dosyası (1-2 gün). Kritik yol İNSAN beklemesidir: T05.1 tanım
girişi + eşleme onay turu takvimi belirler — istek listesini turun İLK mesajında gönder, kod
task'larını beklerken yürüt.

## Bitirirken (zorunlu)

1. `CHECKLIST.md`'de bu aşamanın maddelerini işaretle.
2. `STATE.md`'ye tur kaydı yaz: tarih · yapılan · kanıt yolları · açık kalan.
