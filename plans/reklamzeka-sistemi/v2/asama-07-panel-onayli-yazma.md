---
kosum: workflow:uygula-dogrula
getirir:
  - dugum: modul:src/reklamzeka/propose.py
  - dugum: modul:src/reklamzeka/apply.py
  - dugum: modul:src/reklamzeka/karar_gunlugu.py
  - dugum: modul:src/reklamzeka/panel.py
  - dokunur: modul:src/reklamzeka/guardrails.py
---
# Aşama 07 — PANEL VE ONAYLI YAZMA (v2)

> Roadmap: [MASTER.md](MASTER.md) · Bağımlı: 06
> Bu dosya KENDİ BAŞINA yeterlidir: taze bir /goal session'ı yalnız bunu okuyarak işi bitirebilmeli.

## Bağlam (bu aşamayı koşan session için)

Sistem bu aşamaya kadar SALT-OKUR: Aşama 06 `ingest`/`evaluate`/`digest` hattını kurdu,
ambar (`warehouse.db`) `evaluation` satırları üretiyor, digest artefaktı sink kayıt defterinden
dağıtılıyor. Bu aşama YAZMA yolunu açar — ama yalnız insan onayının arkasından. Şartname:
`utopya/vizyon/3-insan-hakimiyeti.md` (G3.1 diff-onay hattı · G3.2 PAUSED garantisi ·
G3.3 append-only karar günlüğü · G3.4 digest sink). Uygulama planı referansı:
`plans/reklamzeka-sistemi/v1/MASTER.md` §4.d ve §6.

**Bugün elde olan (bu aşamanın üstüne kurulduğu kod):**
- `src/reklamzeka/guardrails.py` — `assert_paused_create`: ACTIVE'li create/geçiş kod
  seviyesinde engelli; 5 birim testi yeşil (`tests/test_guardrails.py`). Harcama tavanları ve
  diff sınırı BOŞ — bu aşamada dolar (dosya başındaki docstring bunu zaten vaat ediyor).
- `src/reklamzeka/meta_gateway.py` — `call()`: `WRITE_TOOL_HINTS` eşleşen araçlarda
  guardrail + `dry_run` kontrolü; `dry_run=False` yazma şu an KOŞULSUZ reddediliyor —
  bu aşama o istisnayı onay bağlamına bağlar.
- `src/reklamzeka/schema.py` — `change_proposal` (status makinesi:
  `pending|approved|rejected|applied|rolled_back|expired`) ve `decision_log`
  tabloları tanımlı; YAZAN akış yok.
- `src/reklamzeka/sheets_schema.py` — `ONAY_KUYRUGU` ve `KARAR_GUNLUGU` sekmeleri tanımlı ve
  `APPEND_ONLY_TABS` içinde: sistem bu sekmelere yalnız append eder, insan hücresi ezilmez.
- `docs/api-gercekleri.md` TEYİTSİZ tablosu **madde 4**: "Resmî MCP'de create'in PAUSED garantisi"
  — bu aşamanın canlı provası bu maddeyi kapatır (aşama 02'den devirli).

**Kilit ilkeler (bu dosyada tekrar edilir ki MASTER'a bakmak gerekmesin):**
- Diff formatı: `{proposal_id, action_type, hedef (meta_id + İK adı), alan bazında
  current→proposed, gerekçe (brief_id · metric_key · eşik · ölçülen), risk_flags,
  copy_rule_findings, son geçerlilik}`.
- Onay işlem-bazlı ve tek seferlik; **toplu onay YOK**. 7 gün onaylanmayan öneri `expired` —
  bayat veriyle yazma yapılmaz, yeniden değerlendirme tetiklenir.
- Yeni Meta nesnesi HER ZAMAN açık `status=PAUSED` parametresiyle üretilir; yazım sonrası
  geri-okuma ile doğrulanır; sapma alarm üretir. **Aktivasyon sistem DIŞIDIR** — panelde
  ACTIVE üreten hiçbir düğme/endpoint yoktur.
- Karar günlüğü append-only ÇİFT yazım: SQLite `decision_log` + Sheets `KARAR_GUNLUGU`.
- Bu aşamada **bütçe danışmanı (aşama 08) ve metin önerisi (aşama 09) ÜRETİLMEZ**; `propose.py`
  yalnız `pause|scale` action_type'ları üretir (diğerleri şemada durur, üreticisi sonraki aşamalar).
- Terminoloji disiplini: çıplak "kampanya"/"campaign" kodda-log'da-sekmede yasak; Meta nesneleri
  `meta_campaign|meta_ad_set|meta_ad`, iç kavramlar İKA/İKK/İK. Lint: `tests/test_terminology_lint.py`.

**`kosum: workflow:uygula-dogrula` gerekçesi:** panel UI paketi (T07.4) ile apply/guardrail hattı
(T07.1–T07.3) paralel iki iş paketidir ve hüküm adversarial verify ister — onaysız-yazma=0,
ACTIVE-engeli, expired akışı yazan ajanın kendi testiyle değil bağımsız skeptik doğrulamayla sınanır.

## SONUÇ

**Bu aşama bitince:** Uçtan uca zincir (öneri diff → panel onayı → MCP'de PAUSED nesne →
geri-okuma → append-only karar günlüğü → rollback) canlıda bir kez kanıtlanmış, dry-run
varsayılan ve `docs/api-gercekleri.md` madde 4 (PAUSED provası) kapanmış durumda.

## Önkoşullar

- Aşama 06 kapalı; ambarında değerlendirme var — doğrula:
  `sqlite3 warehouse.db "SELECT COUNT(*) FROM evaluation"` → `> 0`.
- MCP OAuth canlı — doğrula: `META_MCP_ACCESS_TOKEN=… .venv/bin/pytest tests/test_mcp_contract.py -q` → passed.
- Sheets kanonu bağlı — doğrula:
  `.venv/bin/python -c "import yaml; print(bool(yaml.safe_load(open('config/settings.yaml'))['sheets']['spreadsheet_id']))"` → `True`.
- Panel bağımlılıkları kurulu — doğrula: `.venv/bin/python -c "import fastapi, uvicorn; print('ok')"` → `ok`
  (değilse `uv sync --extra panel`).
- `.claude/kanit.json`'da `hizli` + `tam` girişleri mevcut (Aşama 01 ürünü); `surus` girişini bu
  aşama günceller (T07.5).
- ✋ İNSAN: harcama tavanı başlangıç değerleri (global + İKK; MASTER v1 §10 soru 7). Dry-run hattı
  bunlarsız koşar; **canlı prova (T07.5) tavanlar girilmeden koşulmaz** (null tavan = canlı yazma reddi).

## Task'lar

### T07.1 — propose.py: değerlendirmeden onay kuyruğuna
**SONUÇ:** Her yazma niyeti, brief-gerekçeli bir `change_proposal` satırı olarak SQLite + Sheets
`ONAY_KUYRUGU`na düşer; brief'siz öneri şema gereği imkânsız; 7 gün onaysız öneri `expired` olur
ve yeniden değerlendirme tetiklenir.
**Subtask'lar:**
- `src/reklamzeka/propose.py`: `evaluation` satırlarından `change_proposal` üret. `rationale =
  {brief_id, metric_key, threshold, measured}` — `brief_id` evaluation'dan taşınır; boş/yoksa
  üretim `ValueError` ile düşer (brief'siz öneri İMKÂNSIZ). `diff` alan bazında
  `[{field, current, proposed}]`; bu aşamada action_type yalnız `pause|scale`.
- `expires_at = created_at + 7 gün`. `expire_sweep()`: her koşuda süresi geçmiş `pending`
  önerileri `expired` yapar, her biri için `decision_log`a `actor='sistem', decision='expire'`
  satırı ekler ve ilgili İK için `evaluate` koşusunu tetikler.
- Sheets yazımı: `ONAY_KUYRUGU`na append (kolonlar `sheets_schema.py`); append-only sözü korunur.
- `tests/test_propose.py`: brief'siz üretim imkânsız · diff formatı alan-bazlı · expire_sweep
  status geçişi + günlük satırı · her öneri ayrı satır (toplulaştırma yok).
**Kabul kriteri (kanıt):** `.venv/bin/pytest tests/test_propose.py -q` → tümü passed (≥4 test);
`sqlite3 warehouse.db "SELECT COUNT(*) FROM change_proposal WHERE json_extract(rationale,'$.brief_id') IS NULL"` → `0`.

### T07.2 — guardrails doldurma + apply.py yazma hattı
**SONUÇ:** Onaylı öneri MCP'ye guardrail zincirinden geçerek uygulanır; dry-run VARSAYILANDIR
(açık `--canli` bayrağı olmadan MCP'ye yazma isteği çıkmaz, yalnız loglanır); create açık PAUSED
parametresi taşır; yazım sonrası geri-okuma doğrulaması yapılır, sapma alarm üretir.
**Subtask'lar:**
- `src/reklamzeka/sheets_schema.py`: yeni sekme `HARCAMA_TAVANLARI`
  `[cap_id, scope, scope_ref, daily_cap_try, monthly_cap_try, updated_at]` (`scope: global|ikk`,
  `scope_ref` = category_id ya da boş). İnsan-yazar sekmedir — `APPEND_ONLY_TABS`e GİRMEZ, sistem yalnız okur.
- `src/reklamzeka/guardrails.py`: `assert_spend_caps(proposal, caps, harcama_bugune)` — global +
  İKK günlük/aylık tavan; tavan `None` iken canlı yazma REDDEDİLİR (✋ değer girilmeden canlı yol
  kapalı), dry-run serbest. `assert_budget_delta(diff, max_pct)` — tek diff'te bütçe alanı değişimi
  ±%50 (`config/settings.yaml → guardrails.max_budget_change_pct`, mevcut anahtar).
- `src/reklamzeka/meta_gateway.py`: `call()` yazma dalını onay bağlamına bağla —
  `call(tool, args, onay=None)`; `dry_run=False` yazma yalnız `onay` (approved `proposal_id` + actor)
  ile mümkün, aksi halde mevcut `MetaGatewayError` korunur. Zincir: `assert_paused_create`
  (mevcut) → `assert_budget_delta` → `assert_spend_caps`. `dry_run=True` (kurucu varsayılanı)
  iken MCP çağrısı YAPILMAZ, `{"dry_run": true, tool, arguments}` döner + loglanır.
- `src/reklamzeka/apply.py` (CLI: `python -m reklamzeka.apply --proposal <id> [--canli]`):
  `status='approved'` değilse (pending/rejected/expired/applied) ret + exit ≠ 0. Create'te
  `status='PAUSED'` AÇIKÇA gönderilir. Yazım sonrası GERİ-OKUMA: nesne okunur, create'te status
  `PAUSED` ve tüm alanlar `proposed` ile karşılaştırılır; sapma → `decision_log`a
  `decision='deviation_alarm'` + stderr + exit 2. Başarı → `change_proposal.status='applied'`.
  `--canli` yoksa gateway dry-run kurulur — MCP'ye istek çıkmaz.
- `tests/test_apply.py`: onaysız-yazma=0 (pending/rejected/expired ile ret) · tavan aşımı ret ·
  null-tavan canlı ret · ±%50 ret · dry-run'da MCP çağrısı yok (sahte gateway) · sapma alarmı yolu.
**Kabul kriteri (kanıt):** `.venv/bin/pytest tests/test_guardrails.py tests/test_apply.py -q` →
tümü passed; `.venv/bin/python -m reklamzeka.apply --proposal OLMAYAN-ID` → ret mesajı + exit ≠ 0.

### T07.3 — karar günlüğü çift yazım + rollback
**SONUÇ:** Her onay/red/uygulama/expire/rollback kaydı SQLite `decision_log` + Sheets
`KARAR_GUNLUGU`na append edilir; rastgele bir kayıttan tam zincir yeniden kurulabilir; rollback
ters diff olarak yine onaydan geçer.
**Subtask'lar:**
- `src/reklamzeka/karar_gunlugu.py`: `log_decision(proposal_id, actor, decision, …)` — SQLite
  insert + Sheets `KARAR_GUNLUGU` append tek çağrıda; Sheets erişilemezse SQLite yazılır +
  `sheets_pending` işareti, sonraki koşuda tamamlanır (sessiz kayıp yok). UPDATE/DELETE fonksiyonu
  YAZILMAZ (append-only sözü).
- Rollback: `propose_rollback(proposal_id)` — `applied` kayıttaki diff'ten ters diff
  (`proposed→current`) YENİ bir `change_proposal` üretir (rationale orijinal `proposal_id`'yi anar),
  `decision_log.rollback_ref` bağlanır; ters diff de guardrail + onay zincirinden geçer.
  **Create rollback'i** = nesne PAUSED'da bırakılır + `archived` geçişi önerilir (MASTER v1 §6).
- `tests/test_karar_gunlugu.py`: çift yazım çağrısı · append-only (güncelleme yolu yok) ·
  ters diff doğruluğu · rollback önerisinin de onaysız uygulanamaması.
**Kabul kriteri (kanıt):** `.venv/bin/pytest tests/test_karar_gunlugu.py -q` → tümü passed;
`sqlite3 warehouse.db "SELECT decision FROM decision_log ORDER BY log_id DESC LIMIT 5"` → zincir satırları listelenir.

### T07.4 — FastAPI yerel panel: kuyruk + dashboard v1 + tetikleyiciler + digest sink
**SONUÇ:** Panel `127.0.0.1`de çalışır; onay kuyruğu alan-bazlı `current→proposed` diff + gerekçe +
`risk_flags` gösterir; Onayla/Reddet işlem-bazlıdır (toplu onay YOK); dashboard v1 İK/İKK/aile ×
zaman trendi verir; ingest/evaluate/digest panelden tetiklenir; son digest panelde yapışıktır;
hiçbir öğe ACTIVE üretmez.
**Subtask'lar:**
- `src/reklamzeka/panel.py` (FastAPI, yalnız `127.0.0.1`e bind — MASTER v1 §10 soru 5 varsayılanı:
  localhost). Endpoint'ler: `GET /api/kuyruk` (pending listesi + tam diff) ·
  `POST /api/oneri/{proposal_id}/onayla` ve `POST /api/oneri/{proposal_id}/reddet` (TEKİL id;
  liste kabul etmez — toplu onay G3.1 gereği yok; expired öneriye 409) ·
  `GET /api/dashboard?boyut=ik|ikk|aile` (`metric_snapshot` × `meta_object_mapping` ×
  taksonomi → zaman serileri) · `POST /api/tetikle/{script}` (`script ∈ {ingest, evaluate, digest}`,
  subprocess; başka değer 404) · `GET /api/digest/son`.
- Onayla akışı: `status='approved'` + `log_decision(actor='panel-kullanici', decision='approve')` +
  `apply.py` **dry-run** koşusu (çıktı panelde). Canlı uygulama HER ZAMAN ayrı insan adımıdır:
  CLI'dan `--canli` (T07.5). Reddet: `status='rejected'` + log.
- `src/reklamzeka/static/index.html` (tek sayfa, vanilla JS, harici CDN yok): diff tablosu yan yana
  current→proposed, gerekçe satırı (brief_id · metric_key · eşik · ölçülen), `risk_flags` rozetleri,
  trend çizimi inline SVG. Aktivasyon/ACTIVE düğmesi HİÇBİR yerde yok.
- Digest sink: Aşama 06'nın sink kayıt defterine `panel` adaptörü — panel SON digest artefaktını
  yalnız OKUR ve yapışık gösterir; hiçbir sink'ten yazma/onay tetiklenemez (G3.4).
- `tests/test_panel.py` (FastAPI TestClient): kuyruk listesi · tekil onay status geçişi + günlük
  satırı · expired onayı 409 · endpoint şemasında liste-id yolu YOK · `/api/tetikle/bilinmeyen` 404.
- `config/settings.example.yaml`: `panel: {host: "127.0.0.1", port: 8765}` bloğu ekle.
**Kabul kriteri (kanıt):** `.venv/bin/pytest tests/test_panel.py -q` → tümü passed;
`.venv/bin/uvicorn reklamzeka.panel:app --host 127.0.0.1 --port 8765 &` sonrası
`curl -s http://127.0.0.1:8765/api/kuyruk | python3 -m json.tool` → pending önerilerin diff'li JSON listesi.

### T07.5 — canlı prova: TEK test nesnesiyle uçtan uca zincir + madde 4 kapanışı
**SONUÇ:** Create→geri-okuma-PAUSED→rollback zinciri canlı hesapta BİR test nesnesiyle
kanıtlanmış; `docs/api-gercekleri.md` madde 4 kapalı; `kanit:surus` girişi bu provayı koşuyor.
**Subtask'lar:**
- `scripts/canli_prova.py`: minimal test nesnesi için `change_proposal` üretir (isim kuralı
  önekiyle `[İK-TEST] prova`, mümkün olan en düşük günlük bütçe) ve kuyruğa düşürüp DURUR —
  onay insansız İLERLEMEZ. `--dokum <proposal_id>` alt komutu: `decision_log`dan tam zinciri
  (öneri → onay → MCP çağrısı → geri-okuma → rollback) salt-okur döker (G3.3 kabul ölçütü).
- ✋ İNSAN: tavan başlangıç değerlerinin `HARCAMA_TAVANLARI`nda dolu olduğunu doğrula (T07.2 ön
  şartı); panelden Onayla (işlem-bazlı); ardından terminalden
  `.venv/bin/python -m reklamzeka.apply --proposal <id> --canli` → MCP create (status=PAUSED açık)
  → geri-okuma PAUSED doğrulaması.
- Rollback provası: panelden "geri al" → ters öneri (create rollback'i: PAUSED bırak + `archived`
  geçişi) kuyruğa → ✋ İNSAN onayı → `apply --canli` → geri-okumada `archived` doğrulaması.
  Prova hiçbir adımda ACTIVE üretmez; nesne prova sonunda archived kalır.
- `docs/api-gercekleri.md` TEYİTSİZ tablosu madde 4 "Sonuç" hücresine geri-okuma çıktısı + tarih yaz.
- `.claude/kanit.json`'daki `surus` girişini güncelle:
  `.venv/bin/python scripts/canli_prova.py --dokum <son-prova-id>` (sınıf: surus — plan-kur kuralı:
  yeni kanıt komutu planın task'ıdır).
**Kabul kriteri (kanıt):**
`sqlite3 warehouse.db "SELECT decision FROM decision_log WHERE proposal_id IN (SELECT proposal_id FROM change_proposal WHERE target_meta_ids LIKE '%TEST%') ORDER BY log_id"`
→ `approve` → `apply` → (rollback zinciri) sıralı satırlar; `grep -n "^| 4 |" docs/api-gercekleri.md` → Sonuç hücresi dolu (⬜ değil).

## Task checklist

- [ ] T07.1 — propose.py + expire akışı · kanıt: `.venv/bin/pytest tests/test_propose.py -q` → passed; brief'siz öneri sayısı SQL'de 0
- [ ] T07.2 — guardrails doldurma + apply.py · kanıt: `.venv/bin/pytest tests/test_guardrails.py tests/test_apply.py -q` → passed; onaysız apply exit ≠ 0
- [ ] T07.3 — karar günlüğü çift yazım + rollback · kanıt: `.venv/bin/pytest tests/test_karar_gunlugu.py -q` → passed
- [ ] T07.4 — FastAPI panel (kuyruk+dashboard+tetikleyici+digest sink) · kanıt: `curl -s http://127.0.0.1:8765/api/kuyruk` → diff'li pending JSON
- [ ] T07.5 — canlı prova + madde 4 kapanışı · kanıt: `scripts/canli_prova.py --dokum <id>` → tam zincir; api-gercekleri madde 4 dolu

## Aşama requirements

| id | requirement | doğrulama | delege |
|---|---|---|---|
| R-07.1 | Onaysız hiçbir MCP yazma çağrısı çıkmaz; expired öneri uygulanmaya çalışılınca reddedilir | `kanit:hizli` (test_apply + test_panel) | uy:insan-hakimiyeti/diff-onay-hatti (G3.1) |
| R-07.2 | Create geri-okumada PAUSED; ACTIVE engeli yeşil; sapma alarm üretir | `kanit:tam` + `kanit:surus` | uy:insan-hakimiyeti/paused-garantisi (G3.2) |
| R-07.3 | Karar günlüğü append-only çift yazım; rastgele kayıttan tam zincir yeniden kurulur | `kanit:surus` (`--dokum`) | uy:insan-hakimiyeti/karar-gunlugu (G3.3) |
| R-07.4 | Dry-run varsayılan: `--canli` bayrağı olmadan MCP'ye yazma isteği çıkmaz, yalnız log | `kanit:hizli` (test_apply dry-run testi) | yeni |
| R-07.5 | Toplu onay yok; onay yalnız panel/CLI'da; digest sink'ten yazma/onay tetiklenemez | `kanit:hizli` (test_panel) | uy:insan-hakimiyeti/digest-urun (G3.4) |
| R-07.6 | Terminoloji lint'i yeni dosyalar dahil temiz | `kanit:hizli` (test_terminology_lint) | scripts/lint_terminology.py |
| R-07.7 | api-gercekleri madde 4 kapalı; `kanit:surus` girişi güncel | yeni — sınıf: surus (T07.5 günceller) | docs/api-gercekleri.md |

## Doğrulama (aşama kapanışı)

1. `.venv/bin/pytest -q` → TÜM testler passed (guardrails + propose + apply + karar_gunlugu + panel + terminoloji).
2. Panel ayakta: `curl -s http://127.0.0.1:8765/api/kuyruk` → JSON; `curl -s -X POST http://127.0.0.1:8765/api/tetikle/bilinmeyen` → 404.
3. Dry-run kanıtı: onaylı bir öneride `.venv/bin/python -m reklamzeka.apply --proposal <id>` (bayraksız) → çıktıda `"dry_run": true`, MCP'ye istek yok, nesne değişmemiş.
4. Canlı zincir dökümü: `.venv/bin/python scripts/canli_prova.py --dokum <prova-id>` → öneri → onay → create(PAUSED) → geri-okuma PAUSED → rollback → geri-okuma archived satırları eksiksiz.
5. `grep -n "^| 4 |" docs/api-gercekleri.md` → Sonuç hücresi dolu.
6. İdempotens: 4. ve 5. adımı ikinci kez koşmak hükmü değiştirmez (`--dokum` salt-okurdur, yeni yazma üretmez).

## Efor/maliyet notu

Token-orta (panel UI + iki test paketi en hacimli parça). MCP canlı çağrı azdır (~5: 1 create +
2 geri-okuma + 1 archived geçişi + okumalar) — bütçe riski yok (nesne PAUSED doğar, aktive edilmez).
İnsan-bağımlı iki bekleme anı var (✋ prova onayları + tavan değerleri) — aşama bu noktalarda
DURUR, tur-sonu DURUM bloğunda ilan edilir. Tahmin: 2-3 oturum.

## Bitirirken (zorunlu)

1. `CHECKLIST.md`'de bu aşamanın maddelerini işaretle.
2. `STATE.md`'ye tur kaydı yaz: tarih · yapılan · kanıt yolları · açık kalan.
