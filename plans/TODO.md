# GENEL TODO — ReklamZeka

> **TÜREV — elle düzenlenmez.** Tek yazar `agac.mjs` (motor · deterministik · 0 token).
> Elle madde buraya değil **`TODO-ELLE.md`**'ye yazılır.
> Damga: `b627eb133bbd` · Kaynak: CHECKLIST(açık) · TODO-ELLE.md · HUKUM.md(EKSİK/STUCK) · künye-eksikleri · sarkık-oturum
> İLANLI MUAF (bu listeye GİRMEZ, her birinin kendi kanalı var): alerts.jsonl · parked işler · doctor fix: · teslim onar: · kaptan task'ları

**70 açık madde** · plansız: 0 · chk: 65 · elle: 5 · hüküm: 0 · künye: 0 · oturum: 0

## Plansız maddeler — plan-üretim adayları (0)

_yok_

## Plana bağlı elle maddeler (5)

- [ ] Meta Ads MCP OAuth'unu tamamla ve canlı sözleşme testini koştur (envanter + 8 teyitsiz API maddesi) `td:elle/meta-mcp-oauth` ⟵ kapatır: reklamzeka-sistemi
- [ ] Google Sheets service-account kimliği kur ve kanon Sheet'i sıfırdan oluştur `td:elle/sheets-kimlik` ⟵ kapatır: reklamzeka-sistemi
- [ ] uv + Python 3.12 kurulumu ve projenin 3.12'ye geçişi (kullanıcı onayı verildi 2026-08-06) `td:elle/python-uv` ⟵ kapatır: reklamzeka-sistemi
- [ ] `.claude/kanit.json` doğrulama sınıflarını kur (hizli/tam/surus) — REQUIREMENTS `kanit:` girişlerinin önkoşulu `td:elle/kanit-json` ⟵ kapatır: reklamzeka-sistemi
- [ ] v1 MASTER §10'un kalan açık sorularını yanıtla (isimlendirme düzeni · İKK envanteri · harcama tavanları · CRM arayüzü) `td:elle/master-acik-sorular` ⟵ kapatır: reklamzeka-sistemi

## Hükümler — EKSİK/STUCK (0)

_yok_

## Plan checklist maddeleri (65) — künye önceliği sırasında


### reklamzeka-sistemi v2 · P2
- [ ] [01] **A01** SONUÇ: uv/3.12 + kanit.json + commit kapısı kurulu → detay: [asama-01-temel-kapanis.md](asama-01-temel-kapanis.md) `td:chk/reklamzeka-sistemi/a01`
- [ ] [01] T01.1 — uv geçişi · kanıt: `uv run pytest -q` → `14 passed, 2 skipped` (Python 3.12) `td:chk/reklamzeka-sistemi/t01.1`
- [ ] [01] T01.2 — kanıt defteri · kanıt: `python3 -m json.tool .claude/kanit.json` geçerli + hizli cmd exit 0 `td:chk/reklamzeka-sistemi/t01.2`
- [ ] [01] T01.3 — pre-commit kapısı · kanıt: probe commit DÜŞTÜ (`TERMINOLOJI IHLALI`), temizlik sonrası yeşil `td:chk/reklamzeka-sistemi/t01.3`
- [ ] [01] T01.4 — CI tanımı · kanıt: `yaml-ok` + `grep -c lint_terminology .github/workflows/ci.yml` → 1 `td:chk/reklamzeka-sistemi/t01.4`
- [ ] [01] T01.5 — repo kaydı · kanıt: `git status --short | grep -v utopya` → boş `td:chk/reklamzeka-sistemi/t01.5`
- [ ] [02] **A02** SONUÇ: envanter dolu + 7/8 teyitsiz madde kapalı → detay: [asama-02-meta-baglanti-dogrulama.md](asama-02-meta-baglanti-dogrulama.md) `td:chk/reklamzeka-sistemi/a02`
- [ ] [02] T02.1 — OAuth + headless token · kanıt: list_tools duman testi → `N araç` (N ≥ 1) `td:chk/reklamzeka-sistemi/t02.1`
- [ ] [02] T02.2 — envanter dökümü · kanıt: `rg 'doldurulacak' docs/mcp-envanter.md` → 0 + #1/#6 ✅ `td:chk/reklamzeka-sistemi/t02.2`
- [ ] [02] T02.3 — canlı insights ölçümleri · kanıt: #2/#3/#7/#8 ✅ (4 satır) `td:chk/reklamzeka-sistemi/t02.3`
- [ ] [02] T02.4 — boost yapısı dökümü · kanıt: `boost-yapisi.json` dolu + #5 ✅ `td:chk/reklamzeka-sistemi/t02.4`
- [ ] [02] T02.5 — kapanış süpürmesi · kanıt: `rg '⬜' docs/api-gercekleri.md` → 0 · MCP testleri 2 passed/0 skipped `td:chk/reklamzeka-sistemi/t02.5`
- [ ] [03] **A03** SONUÇ: Sheet 11 sekmeyle canlı + sync/append disiplini testli → detay: [asama-03-sheets-kanon.md](asama-03-sheets-kanon.md) `td:chk/reklamzeka-sistemi/a03`
- [ ] [03] T03.1 — SA + anahtar + paylaşım (✋) · kanıt: `open_by_key` → `ReklamZeka Kanon` `td:chk/reklamzeka-sistemi/t03.1`
- [ ] [03] T03.2 — bootstrap + check · kanıt: pytest `-k "bootstrap or check"` yeşil `td:chk/reklamzeka-sistemi/t03.2`
- [ ] [03] T03.3 — pull (Sheets→SQLite) · kanıt: pytest `-k pull` yeşil `td:chk/reklamzeka-sistemi/t03.3`
- [ ] [03] T03.4 — append-only disiplin · kanıt: pytest `-k append` yeşil `td:chk/reklamzeka-sistemi/t03.4`
- [ ] [03] T03.5 — canlı uçtan uca · kanıt: `--check` → `11/11 sekme OK` `td:chk/reklamzeka-sistemi/t03.5`
- [ ] [04] **A04** SONUÇ: günlük 4-seviye çekim + backoff + eksik-gün alarmı + ≥3 gün sürüş → detay: [asama-04-ingest-ambar.md](asama-04-ingest-ambar.md) `td:chk/reklamzeka-sistemi/a04`
- [ ] [04] T04.1 — şema: 4 seviye + ingest_run + migration · kanıt: `pytest tests/test_schema_migration.py` PASSED `td:chk/reklamzeka-sistemi/t04.1`
- [ ] [04] T04.2 — BUC %80 backoff · kanıt: `pytest tests/test_buc.py` PASSED (5 senaryo) `td:chk/reklamzeka-sistemi/t04.2`
- [ ] [04] T04.3 — ingest.py + async job · kanıt: `pytest tests/test_ingest.py` PASSED + smoke PASSED `td:chk/reklamzeka-sistemi/t04.3`
- [ ] [04] T04.4 — metric_map + rederive provası · kanıt: alan-adı-göçü senaryosu PASSED `td:chk/reklamzeka-sistemi/t04.4`
- [ ] [04] T04.5 — eksik-gün alarmı + cron sürüşü · kanıt: ≥3 günlük jsonl + `--gaps` → `eksik gün yok` `td:chk/reklamzeka-sistemi/t04.5`
- [ ] [05] **A05** SONUÇ: iki zıt İKA aktif + İK'lar brief'li/eşli + yetim raporu → detay: [asama-05-taksonomi-esleme.md](asama-05-taksonomi-esleme.md) `td:chk/reklamzeka-sistemi/a05`
- [ ] [05] T05.1 — ✋ İKA/İKK/İK + brief girişi · kanıt: aktif aile ≥2, brief'siz aktif İK = 0 `td:chk/reklamzeka-sistemi/t05.1`
- [ ] [05] T05.2 — taksonomi loader · kanıt: `pytest tests/test_taxonomy_loader.py` passed + CLI üç katmanlı JSON `td:chk/reklamzeka-sistemi/t05.2`
- [ ] [05] T05.3 — mapping üç yol · kanıt: `pytest tests/test_mapping.py` passed + `scan --dry-run` raporu `td:chk/reklamzeka-sistemi/t05.3`
- [ ] [05] T05.4 — boost sınıflandırıcısı · kanıt: `pytest tests/test_boost_classifier.py` passed (gerçek döküm fikstürü) `td:chk/reklamzeka-sistemi/t05.4`
- [ ] [05] T05.5 — yetim rapor + haftalık · kanıt: `orphans` → rapor + `yetim=<N>`; crontab satırı `td:chk/reklamzeka-sistemi/t05.5`
- [ ] [05] T05.6 — AI iskeleti v1 · kanıt: draft İKK ≥1 + `MOTOR-DEGISMEDI` `td:chk/reklamzeka-sistemi/t05.6`
- [ ] [06] **A06** SONUÇ: brief-gerekçeli skorlar + digest artefaktı + sink'ler + ≥7 gün sürüş → detay: [asama-06-degerlendirme-digest.md](asama-06-degerlendirme-digest.md) `td:chk/reklamzeka-sistemi/a06`
- [ ] [06] T06.1 — delta deterministik SQL · kanıt: `pytest tests/test_delta.py` yeşil + `cmp` → BAYT-ES `td:chk/reklamzeka-sistemi/t06.1`
- [ ] [06] T06.2 — rubrik bağlayıcı + benchmark · kanıt: `pytest tests/test_rubric.py` yeşil `td:chk/reklamzeka-sistemi/t06.2`
- [ ] [06] T06.3 — evaluate instance+agrega · kanıt: `pytest tests/test_evaluate.py` yeşil + dörtlü gerekçe sorguları `td:chk/reklamzeka-sistemi/t06.3`
- [ ] [06] T06.4 — digest üretici · kanıt: `pytest tests/test_digest.py` yeşil + sessiz-boşluk alanları `td:chk/reklamzeka-sistemi/t06.4`
- [ ] [06] T06.5 — sink kayıt defteri (✋ Telegram) · kanıt: `pytest tests/test_sinks.py` yeşil + `notify --test` `td:chk/reklamzeka-sistemi/t06.5`
- [ ] [06] T06.6 — cadence + ≥7 gün sürüş · kanıt: `digest_artifact` 7 ardışık gün + kesintisiz log `td:chk/reklamzeka-sistemi/t06.6`
- [ ] [07] **A07** SONUÇ: onaylı yazma zinciri canlıda kanıtlı + dry-run varsayılan + madde 4 kapalı → detay: [asama-07-panel-onayli-yazma.md](asama-07-panel-onayli-yazma.md) `td:chk/reklamzeka-sistemi/a07`
- [ ] [07] T07.1 — propose + expire · kanıt: `pytest tests/test_propose.py` passed; brief'siz öneri = 0 `td:chk/reklamzeka-sistemi/t07.1`
- [ ] [07] T07.2 — guardrails + apply · kanıt: `pytest tests/test_guardrails.py tests/test_apply.py` passed `td:chk/reklamzeka-sistemi/t07.2`
- [ ] [07] T07.3 — karar günlüğü + rollback · kanıt: `pytest tests/test_karar_gunlugu.py` passed `td:chk/reklamzeka-sistemi/t07.3`
- [ ] [07] T07.4 — FastAPI panel · kanıt: `curl /api/kuyruk` → diff'li pending JSON `td:chk/reklamzeka-sistemi/t07.4`
- [ ] [07] T07.5 — canlı prova (✋) + madde 4 · kanıt: `canli_prova.py --dokum` tam zincir `td:chk/reklamzeka-sistemi/t07.5`
- [ ] [08] **A08** SONUÇ: onaylı bütçe kaydırma döngüsü + digest etki raporu → detay: [asama-08-butce-danismani.md](asama-08-butce-danismani.md) `td:chk/reklamzeka-sistemi/a08`
- [ ] [08] T08.1 — portföy skoru + marjinal verim · kanıt: `pytest -k "portfoy or verim"` PASS `td:chk/reklamzeka-sistemi/t08.1`
- [ ] [08] T08.2 — Advantage+ uyum katmanı · kanıt: `pytest -k advantage` PASS (3 senaryo) `td:chk/reklamzeka-sistemi/t08.2`
- [ ] [08] T08.3 — kaydırma diff'i + guardrail'ler · kanıt: `pytest -k budget` + `-k rationale` PASS `td:chk/reklamzeka-sistemi/t08.3`
- [ ] [08] T08.4 — onay hattı + digest etkisi · kanıt: dry-run yazmıyor; gerçek koşu → pending ≥1 `td:chk/reklamzeka-sistemi/t08.4`
- [ ] [08] T08.5 — canlı döngü (✋) · kanıt: applied budget_shift ≥1 + digest bölümü dolu `td:chk/reklamzeka-sistemi/t08.5`
- [ ] [09] **A09** SONUÇ: yorgunluk tanısı digest'te + block/warn uçtan uca testli → detay: [asama-09-creative-tani-metin-kurallari.md](asama-09-creative-tani-metin-kurallari.md) `td:chk/reklamzeka-sistemi/a09`
- [ ] [09] T09.1 — yorgunluk tanısı · kanıt: `pytest tests/test_creative_diag.py` geçer `td:chk/reklamzeka-sistemi/t09.1`
- [ ] [09] T09.2 — copy_rules motoru + gate · kanıt: `pytest tests/test_copy_rules.py` geçer `td:chk/reklamzeka-sistemi/t09.2`
- [ ] [09] T09.3 — başlangıç paketi pasif seed (✋ aktivasyon) · kanıt: seed sonrası `aktif=1` = 0; idempotens `td:chk/reklamzeka-sistemi/t09.3`
- [ ] [09] T09.4 — digest bölümleri + 0-aktif uyarısı · kanıt: `pytest tests/test_digest_creative.py` geçer `td:chk/reklamzeka-sistemi/t09.4`
- [ ] [09] T09.5 — e2e block/warn + canlı prova · kanıt: e2e geçer + `copy_rule_log` canlı satır `td:chk/reklamzeka-sistemi/t09.5`
- [ ] [10] **A10** SONUÇ: CRM defteri + CAPI + rubrik kapanışı + genişleme provası → detay: [asama-10-crm-v2-kapisi.md](asama-10-crm-v2-kapisi.md) `td:chk/reklamzeka-sistemi/a10`
- [ ] [10] T10.1 — G4.3 revizyonu + ✋ kapı onayı · kanıt: `rg` tasarım satırları + STATE onay kaydı `td:chk/reklamzeka-sistemi/t10.1`
- [ ] [10] T10.2 — eşleme defteri · kanıt: `pytest tests/test_crm_ledger.py tests/test_schema_kvkk.py` geçer `td:chk/reklamzeka-sistemi/t10.2`
- [ ] [10] T10.3 — CAPI gönderimi · kanıt: `pytest tests/test_capi_feed.py` geçer + `events_received ≥ 1` `td:chk/reklamzeka-sistemi/t10.3`
- [ ] [10] T10.4 — rubrik + digest kapanışı · kanıt: `pytest tests/test_digest_satis_v2.py` geçer `td:chk/reklamzeka-sistemi/t10.4`
- [ ] [10] T10.5 — genişleme provası · kanıt: `git diff --stat prova-onu-10 -- src/ tests/` → boş `td:chk/reklamzeka-sistemi/t10.5`
- [ ] Tüm aşama maddeleri işaretli ve kanıt yolları STATE.md'de `td:chk/reklamzeka-sistemi/h1aedb4`
- [ ] MASTER.md'deki BAŞARI tanımı sağlanmış (doğrulama komutu: REQUIREMENTS.md Global tablosunun tüm doğrulama komutları sırayla → hepsi PASS) `td:chk/reklamzeka-sistemi/hfb81dd`
- [ ] İlanlı muafiyetler hâlâ geçerli (değişen varsa revizyon: `/plan-kur revize reklamzeka-sistemi`) `td:chk/reklamzeka-sistemi/ha5f918`

## Künye eksikleri — advisory (0)

_yok_

## Sarkık oturum işi — advisory (0)

_yok_

