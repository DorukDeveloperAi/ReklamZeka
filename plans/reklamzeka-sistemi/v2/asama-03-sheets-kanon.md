---
kosum: tek-ajan
getirir:
  - dugum: modul:src/reklamzeka/settings.py
  - dugum: modul:src/reklamzeka/sheets_sync.py
---
# Aşama 03 — SHEETS KANON (v2)

> Roadmap: [MASTER.md](MASTER.md) · Bağımlı: 01
> Bu dosya KENDİ BAŞINA yeterlidir: taze bir /goal session'ı yalnız bunu okuyarak işi bitirebilmeli.

## Bağlam (bu aşamayı koşan session için)

Depolama ayrımı (v1 MASTER §2.1): **Google Sheets insan-okur kanondur** (İKA/İKK tanımları,
İç Kampanya kayıt defteri, brief'ler, eşleme tablosu, onay/karar görünümleri); **SQLite
(`warehouse.db`) makine ambarıdır** (zaman serileri + Sheets'in okuma cache'i). Senkron yönü tek:
script her koşuda **Sheets→SQLite cache tazeler**; sistem Sheets'e yalnız **append/yeni satır**
yazar, insan hücresi ASLA ezilmez. Bu aşama o boruyu kurar.

Mevcut zemin (aşama 01'den devralınan, hepsi repo'da hazır):
- `src/reklamzeka/sheets_schema.py` — 11 sekmenin adı+kolonları (`TABS`) ve
  `APPEND_ONLY_TABS = ("ONAY_KUYRUGU", "KARAR_GUNLUGU", "DEGERLENDIRMELER")`. Şema BURADAN
  uygulanır; bu aşamada yeni sekme/kolon İCAT EDİLMEZ.
- `src/reklamzeka/schema.py` — SQLite DDL + `init_db()`. Sekme kolon adları SQLite tablo
  kolonlarıyla birebir aynı (bilinçli tasarım); cache dolumu bu yüzden mekaniktir.
- `config/settings.example.yaml` — `sheets.spreadsheet_id` ve `sheets.credentials_path` alanları
  boş bekliyor; gerçek dosya `config/settings.yaml` gitignore'da.
- `pyproject.toml` — `sheets` extra'sı: `gspread>=6.0`, `google-auth>=2.0`.
- `scripts/lint_terminology.py` — çıplak terim yasağı; yeni kod da taranır.

Yön ayrımı (karıştırma): 8 sekme **insan-kanon**dur → yalnız OKUNUR (pull). 3 append-only sekme
**sistem görünümüdür** → yalnız YAZILIR (append); SQLite karşılıkları (`change_proposal`,
`decision_log`, `evaluation`) makine-kanondur ve pull'a GİRMEZ (döngüsel senkron yasak).

Kullanıcı kararı (2026-08-06): **Sheet SIFIRDAN kurulur** — mevcut bir tablo taşınmaz.
Kapsam dışı: içerik girişi (İKA/İKK/brief satırları) **aşama 05'in işi**; Meta verisi bu aşamada
AKMAZ (ingest ayrı aşama). Bağımlılık notu: bu aşama 02'ye bağımlı DEĞİLDİR — 01 sonrası 02 ile
paralel koşabilir.

Bilinen tuzaklar (task'larda tek tek karşılanır): gspread boş hücreyi `""` döndürür (SQLite CHECK
kısıtları `""`'i reddeder → `None`'a çevir); service account kendi Drive'ında dosya SAHİBİ olamaz
(depolama kotası yok → Sheet'i KULLANICI oluşturur, SA'ya paylaşır); `USER_ENTERED` yazımı `=` ile
başlayan hücreyi formül yapar (→ her zaman `RAW`); yarım kalan pull bozuk cache bırakır (→ tek
transaction, atomik).

## SONUÇ

**Bu aşama bitince:** Google Sheet tüm sekme şemalarıyla canlı ve `sheets_sync` her koşuda
Sheets→SQLite cache'ini tazeler durumda (append-only yazım disiplini testli). Ölçülebilir:
`--check` canlıda `11/11 sekme OK` der; `--pull` 8 insan-kanon sekmeyi SQLite'a atomik yazar;
sistem yazımı yalnız 3 append-only sekmeye, yalnız batch append ile mümkündür ve ihlal
testle kanıtlanmış biçimde `SheetsWriteViolation` fırlatır.

## Önkoşullar

- Aşama 01 tamam: `uv run pytest -q` → mevcut testler yeşil (ortam + `kanit:hizli`/`kanit:tam`
  girişleri `.claude/kanit.json`'da kurulu).
- Sheets bağımlılıkları kurulu: `uv run --extra sheets python -c "import gspread, google.auth; print(gspread.__version__)"`
  → sürüm basar.
- Google hesabına tarayıcı erişimi olan bir İNSAN (T03.1 — session bu adımda bloke olur).

## Task'lar

### T03.1 — ✋ İNSAN ADIMI: service account + JSON anahtar + Sheet paylaşımı (BLOKE NOKTASI)
**SONUÇ:** `config/settings.yaml`'da geçerli `spreadsheet_id` + `credentials_path` var; service
account Sheet'e Düzenleyici (Editor) olarak erişiyor.
**Subtask'lar:** Bu tarifi oturumun İLK turunda kullanıcıya ver (insan paralelde ilerlesin) ve
tur-sonu DURUM bloğunda `✋ SENDEN` olarak ilan et; T03.2–T03.4 bu adımı BEKLEMEZ (mock'lu koşar),
yalnız T03.5 canlı doğrulama bekler. İnsana verilecek adım adım tarif:
1. https://console.cloud.google.com → üstten proje seç/oluştur → "New Project" → ad: `reklamzeka`.
2. Menü → "APIs & Services → Library" → **"Google Sheets API"** ara → **Enable**.
   (Drive API GEREKMEZ — kod `open_by_key` kullanır, dosya listelemez.)
3. Menü → "IAM & Admin → Service Accounts" → **"Create service account"** → ad:
   `reklamzeka-sheets` → rol ekleme adımını BOŞ geç (erişim IAM'le değil, Sheet paylaşımıyla
   verilecek) → Done.
4. Oluşan hesaba tıkla → **"Keys → Add key → Create new key → JSON"** → dosya iner.
5. Anahtarı repo DIŞINA taşı:
   `mkdir -p ~/.secrets && mv ~/Downloads/reklamzeka-*.json ~/.secrets/reklamzeka-sa.json && chmod 600 ~/.secrets/reklamzeka-sa.json`
6. https://sheets.google.com → **boş tablo oluştur** → adını **"ReklamZeka Kanon"** yap.
   (Neden sen oluşturuyorsun: service account'un Drive depolama kotası yok, dosya sahibi
   olamıyor; ayrıca kanonun sahibi insan olmalı.)
7. Sağ üst **"Paylaş"** → JSON dosyasındaki `client_email` değerini
   (`reklamzeka-sheets@….iam.gserviceaccount.com`) **Düzenleyici** yetkisiyle ekle.
8. Tarayıcı URL'sinden `spreadsheet_id`'yi kopyala: `/d/` ile `/edit` arasındaki uzun dizi.
9. Repo'da: `cp -n config/settings.example.yaml config/settings.yaml` → `sheets.spreadsheet_id`
   ve `sheets.credentials_path: ~/.secrets/reklamzeka-sa.json` alanlarını doldur.
**Kabul kriteri (kanıt):**
`uv run --extra sheets python -c "import gspread, yaml, pathlib; s=yaml.safe_load(open('config/settings.yaml'))['sheets']; print(gspread.service_account(filename=pathlib.Path(s['credentials_path']).expanduser()).open_by_key(s['spreadsheet_id']).title)"`
→ `ReklamZeka Kanon` basılır (yetki + kimlik zinciri uçtan uca çalışıyor).

### T03.2 — `sheets_sync.py` iskeleti: ayar yükleyici + `--bootstrap` + `--check`
**SONUÇ:** 11 sekme şeması canlı Sheet'e idempotent uygulanabilir; `--check` şema uyumunu ölçer.
**Subtask'lar:**
- `src/reklamzeka/settings.py` (yeni, küçük): `load_settings(path="config/settings.yaml") -> dict`
  — pyyaml ile okur; dosya yoksa `config/settings.example.yaml`'ı kopyalamayı tarif eden net hata;
  `credentials_path`'te `~` genişletilir. (İleride `ingest.py` de bunu kullanacak — tek yükleyici.)
- `src/reklamzeka/sheets_sync.py` (yeni): çekirdek fonksiyonlar `spreadsheet` nesnesini PARAMETRE
  alır (duck-typing) — testler sahte nesneyle koşar, gspread yalnız CLI girişinde örneklenir:
  `gspread.service_account(filename=…, scopes=["https://www.googleapis.com/auth/spreadsheets"])`
  → `open_by_key(spreadsheet_id)` (asgari scope; Drive scope'u İSTENMEZ).
- `bootstrap(spreadsheet)`: `sheets_schema.TABS`'taki her sekme için — sekme YOKSA
  `add_worksheet` + 1. satıra kolon başlıkları + başlık satırını dondur; sekme VARSA ve başlık
  satırı kolon listesiyle birebir aynıysa DOKUNMA; başlık FARKLIYSA hata (rapor: sekme adı +
  beklenen/bulunan) — kolon silme/ezme ASLA. Şemada olmayan fazla sekme (ör. varsayılan "Sayfa1")
  SİLİNMEZ, yalnız raporlanır.
- `check(spreadsheet)`: sekme başına `OK | EKSIK | KOLON-FARKI` satırı basar, sonda `N/11 sekme OK`;
  tam uyumda exit 0, aksi halde exit 1.
- CLI (`python -m reklamzeka.sheets_sync`): argparse, tek seferde tek mod:
  `--bootstrap | --check | --pull | --smoke-append`.
**Kabul kriteri (kanıt):** `uv run pytest tests/test_sheets_sync.py -q -k "bootstrap or check"`
→ yeşil (eksik sekme oluşturma · uyumlu sekmeye dokunmama · başlık farkında hata · fazla sekme
toleransı, hepsi sahte spreadsheet ile). Canlı kanıt T03.5'te.

### T03.3 — `--pull`: Sheets→SQLite cache tazeleme (8 insan-kanon sekme)
**SONUÇ:** İnsan-kanon sekmeler her koşuda SQLite'a atomik snapshot olarak iner.
**Subtask'lar:**
- `PULL_TABS` eşlemesi (sekme → SQLite tablosu; kolon adları zaten birebir):
  `IC_KAMPANYA_AILELERI→internal_campaign_family`, `IC_KAMPANYA_KATEGORILERI→internal_campaign_category`,
  `IC_KAMPANYALAR→internal_campaign`, `BRIEFLER→brief`, `AMAC_KAPSAMLARI→goal_scope`,
  `RUBRIK_OVERRIDE→rubric_override`, `ESLEME_TABLOSU→meta_object_mapping`,
  `METIN_KURAL_SETLERI→copy_rule_set`. Üç append-only sekme pull'a GİRMEZ (SQLite'ları makine-kanon).
- `pull(spreadsheet, conn)`: her sekme `get_all_records()` ile okunur; dönüşümler: `""` → `None`
  (SQLite CHECK kısıtları `""` kabul etmez); `verified_by_user`/`aktif` → küçük-harfle
  `{"1","true","evet","x"}` ise 1, aksi 0; sayısal alanlar (`budget_amount`, `confidence`,
  `revizyon_no`) çevrilir, çevrilemeyen değer hatadır.
- Atomiklik: TEK transaction içinde yalnız 8 cache tablosuna `DELETE` + `INSERT`; herhangi bir
  satır CHECK'e takılırsa ROLLBACK + hata mesajı `sekme · satır no · kolon` söyler — yarım cache
  YASAK. `metric_snapshot`/`raw_insights`/`evaluation`/`change_proposal`/`decision_log`'a
  DOKUNULMAZ. DB `schema.init_db(settings["warehouse"]["db_path"])` ile açılır — yeni DDL yazılmaz.
- Çıktı raporu: sekme başına indirilen satır sayısı (boş sekme = 0 satır, geçerli durum).
**Kabul kriteri (kanıt):** `uv run pytest tests/test_sheets_sync.py -q -k pull` → yeşil
(in-memory SQLite'a dolum · `""`→`None` · truthy normalizasyonu · bozuk satırda tam rollback).

### T03.4 — Append-only yazım disiplini (insan hücresi koruması)
**SONUÇ:** Sistemin Sheets'e yazma yolu kod seviyesinde yalnız 3 append-only sekmeye ve yalnız
batch append'e izin verir; ihlal `SheetsWriteViolation` ile ölür.
**Subtask'lar:**
- `SheetsWriteViolation(RuntimeError)` tanımla (desen: `guardrails.GuardrailViolation` ile aynı).
- `append_rows(spreadsheet, tab, rows: list[dict]) -> int`:
  `tab not in sheets_schema.APPEND_ONLY_TABS` → `SheetsWriteViolation` (mesaj insan-kanon
  sekmelerin yazılamayacağını söyler). Satır anahtarları `TABS[tab]` alt kümesi olmalı —
  bilinmeyen anahtar → hata (sessiz veri kaybı yasak); eksik anahtar → `""` (opsiyonel alanlar).
  Değerler kolon SIRASINA dizilir; list/dict değerler `json.dumps` ile serileştirilir. Tek batch
  çağrı: `worksheet.append_rows(values, value_input_option="RAW", table_range="A1")` — `RAW`:
  `=` ile başlayan içerik formül olarak yorumlanamaz (formül enjeksiyonu kapalı); `table_range`:
  append hedef aralığı kaymaz.
- Değişmez (invariant, teste bağlanır): `sheets_sync` VAR OLAN hiçbir worksheet'te
  `update`/`update_cell`/`clear` çağırmaz; tek istisna, bootstrap'ın O KOŞUDA oluşturduğu boş
  worksheet'in 1. satır başlığıdır.
- `--smoke-append` CLI modu: ONAY_KUYRUGU'na `proposal_id=SMOKE-<ISO-zaman>` · `status=expired` ·
  `gerekce="sheets_sync smoke"` satırı basar (`expired`: kimse bekleyen öneri sanmaz; satır canlı
  kanıt/denetim izidir, insan isterse siler).
**Kabul kriteri (kanıt):** `uv run pytest tests/test_sheets_sync.py -q -k append` → yeşil
(insan-kanon sekmeye yazım reddi · kolon sırası · JSON serileştirme · `RAW` parametresi ·
bilinmeyen anahtar hatası · sahte worksheet'te "append dışı yazma metodu hiç çağrılmadı" kanıtı).

### T03.5 — Canlı uçtan uca doğrulama (T03.1'i bekler)
**SONUÇ:** Canlı Sheet'te 11 sekme kurulu, cache dolumu ve append disiplini gerçek servisle
kanıtlı; kimlik dosyaları git dışında.
**Subtask'lar:** Sırayla koş ve çıktıları STATE.md tur kaydına yapıştır:
1. `uv run --extra sheets python -m reklamzeka.sheets_sync --bootstrap` → 11 sekme oluşturuldu raporu.
2. Aynı komut (İKİNCİ koşu) → "oluşturulacak yok" (idempotens kanıtı).
3. `uv run --extra sheets python -m reklamzeka.sheets_sync --check` → `11/11 sekme OK`, exit 0.
4. `--pull` → sekme başına satır sayısı (sıfırdan kurulumda hepsi 0 — geçerli); İKİNCİ `--pull` aynı sayıları verir.
5. `--smoke-append` → 1 satır eklendi; ardından `--check` HÂLÂ `11/11 sekme OK` (append başlıkları bozmadı).
6. `uv run python scripts/lint_terminology.py` → `terminoloji lint: temiz`.
7. `git status --porcelain` → çıktıda `config/settings.yaml` ve hiçbir `*.json` anahtar dosyası
   YOK (gitignore çalışıyor; anahtar `~/.secrets/` altında).
**Kabul kriteri (kanıt):** `uv run --extra sheets python -m reklamzeka.sheets_sync --check` → `11/11 sekme OK`
(canlı) **ve** `uv run pytest tests/test_sheets_sync.py -q` → tüm testler yeşil.

## Task checklist

- [ ] T03.1 — İnsan adımı: SA + anahtar + paylaşım · kanıt: gspread `open_by_key` one-liner → `ReklamZeka Kanon`
- [ ] T03.2 — bootstrap + check · kanıt: `uv run pytest tests/test_sheets_sync.py -q -k "bootstrap or check"` → yeşil
- [ ] T03.3 — pull (Sheets→SQLite) · kanıt: `uv run pytest tests/test_sheets_sync.py -q -k pull` → yeşil
- [ ] T03.4 — append-only disiplin · kanıt: `uv run pytest tests/test_sheets_sync.py -q -k append` → yeşil
- [ ] T03.5 — canlı uçtan uca · kanıt: `--check` → `11/11 sekme OK`

## Aşama requirements

| id | requirement | doğrulama | delege |
|---|---|---|---|
| R-03.1 | Canlı Sheet'te 11 sekme, `sheets_schema.TABS` başlıklarıyla birebir mevcut | `sheets_sync --check` → `11/11 sekme OK`, exit 0 | yeni — bu aşamada yazılan `--check` kapısı |
| R-03.2 | Sheets→SQLite cache tazeleme atomik ve tekrarlanabilir (yarım cache imkânsız) | `uv run pytest tests/test_sheets_sync.py -q` → yeşil (rollback testi dahil) | `kanit:hizli` |
| R-03.3 | Sistem yazımı yalnız APPEND_ONLY_TABS'a, yalnız batch append + `RAW` ile; insan-kanon sekmeye yazım `SheetsWriteViolation` | `uv run pytest tests/test_sheets_sync.py -q -k append` → yeşil | `kanit:hizli` |
| R-03.4 | Yeni kod terminoloji sözlüğüne uyar (çıplak terim yok) | `uv run python scripts/lint_terminology.py` → temiz, exit 0 | `kanit:hizli` (lint mevcut kapı) |
| R-03.5 | Kimlik bilgisi git'e girmez (anahtar JSON repo dışında, settings.yaml ignore'da) | `git status --porcelain` çıktısında `config/settings.yaml` ve anahtar JSON yok | yeni — T03.5 adım 7 |

## Doğrulama (aşama kapanışı)

Uçtan uca dizi (idempotens: aynı diziyi iki kez koşmak hükmü DEĞİŞTİRMEZ — ikinci `--bootstrap`
hiçbir şey oluşturmaz, ikinci `--pull` aynı sayıları basar; yalnız `--smoke-append` her koşuda
bilinçli olarak +1 satır ekler, o yüzden kapanış dizisinde EN SON ve tek kez koşulur):

1. `uv run pytest tests/test_sheets_sync.py -q` → tüm testler yeşil (offline, mock).
2. `uv run python scripts/lint_terminology.py` → `terminoloji lint: temiz`.
3. `sheets_sync --check` → `11/11 sekme OK`, exit 0 (canlı).
4. `--pull` → sekme başına satır raporu, exit 0; hemen ikinci koşu aynı raporu verir.
5. `--smoke-append` → 1 satır; Sheet'te ONAY_KUYRUGU'nda `SMOKE-` satırı gözle görülür, `--check` hâlâ `11/11 sekme OK`.
6. `git status --porcelain` → kimlik dosyası yok.
7. `kanit:hizli` yeşil (aşama 01'de kurulan giriş; bu aşamanın testleri ona otomatik dahil olur çünkü `tests/` altındadır).

Kapsam sınırı teyidi: Sheet'te içerik satırı YOK (İKA/İKK/brief boş — aşama 05'in işi) ve
`warehouse.db`'de `metric_snapshot`/`raw_insights` boş (Meta verisi akmadı).

## Efor/maliyet notu

Token-hafif, tarayıcı-hafif. Kod+test ~yarım gün tek ajan; asıl bekleme T03.1 insan adımı
(~15 dk Google Cloud + paylaşım — session burada bloke olur, DURUM bloğuyla ilan edilir).
Canlı Sheets çağrıları birkaç API isteği; batch append + `open_by_key` sayesinde kota riski düşük.

## Bitirirken (zorunlu)

1. `CHECKLIST.md`'de bu aşamanın maddelerini işaretle.
2. `STATE.md`'ye tur kaydı yaz: tarih · yapılan · kanıt yolları · açık kalan.
