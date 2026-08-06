# REKLAMZEKA SİSTEMİ — GENEL CHECKLIST (v2)

> Kural: her madde ya somut subtask'lara ya bir subtask-üreticiye bağlıdır (aşama dosyasında).
> İşaretleme ancak KANIT ile: maddenin kabul kriteri koşulmuş ve beklenen çıktı alınmış olmalı.

## Aşama 01 — temel-kapanis
- [ ] **A01** SONUÇ: uv/3.12 + kanit.json + commit kapısı kurulu → detay: [asama-01-temel-kapanis.md](asama-01-temel-kapanis.md)
  - [ ] T01.1 — uv geçişi · kanıt: `uv run pytest -q` → `14 passed, 2 skipped` (Python 3.12)
  - [ ] T01.2 — kanıt defteri · kanıt: `python3 -m json.tool .claude/kanit.json` geçerli + hizli cmd exit 0
  - [ ] T01.3 — pre-commit kapısı · kanıt: probe commit DÜŞTÜ (`TERMINOLOJI IHLALI`), temizlik sonrası yeşil
  - [ ] T01.4 — CI tanımı · kanıt: `yaml-ok` + `grep -c lint_terminology .github/workflows/ci.yml` → 1
  - [ ] T01.5 — repo kaydı · kanıt: `git status --short | grep -v utopya` → boş

## Aşama 02 — meta-baglanti-dogrulama
- [ ] **A02** SONUÇ: envanter dolu + 7/8 teyitsiz madde kapalı → detay: [asama-02-meta-baglanti-dogrulama.md](asama-02-meta-baglanti-dogrulama.md)
  - [ ] T02.1 — OAuth + headless token · kanıt: list_tools duman testi → `N araç` (N ≥ 1)
  - [ ] T02.2 — envanter dökümü · kanıt: `rg 'doldurulacak' docs/mcp-envanter.md` → 0 + #1/#6 ✅
  - [ ] T02.3 — canlı insights ölçümleri · kanıt: #2/#3/#7/#8 ✅ (4 satır)
  - [ ] T02.4 — boost yapısı dökümü · kanıt: `boost-yapisi.json` dolu + #5 ✅
  - [ ] T02.5 — kapanış süpürmesi · kanıt: `rg '⬜' docs/api-gercekleri.md` → 0 · MCP testleri 2 passed/0 skipped

## Aşama 03 — sheets-kanon
- [ ] **A03** SONUÇ: Sheet 11 sekmeyle canlı + sync/append disiplini testli → detay: [asama-03-sheets-kanon.md](asama-03-sheets-kanon.md)
  - [ ] T03.1 — SA + anahtar + paylaşım (✋) · kanıt: `open_by_key` → `ReklamZeka Kanon`
  - [ ] T03.2 — bootstrap + check · kanıt: pytest `-k "bootstrap or check"` yeşil
  - [ ] T03.3 — pull (Sheets→SQLite) · kanıt: pytest `-k pull` yeşil
  - [ ] T03.4 — append-only disiplin · kanıt: pytest `-k append` yeşil
  - [ ] T03.5 — canlı uçtan uca · kanıt: `--check` → `11/11 sekme OK`

## Aşama 04 — ingest-ambar
- [ ] **A04** SONUÇ: günlük 4-seviye çekim + backoff + eksik-gün alarmı + ≥3 gün sürüş → detay: [asama-04-ingest-ambar.md](asama-04-ingest-ambar.md)
  - [ ] T04.1 — şema: 4 seviye + ingest_run + migration · kanıt: `pytest tests/test_schema_migration.py` PASSED
  - [ ] T04.2 — BUC %80 backoff · kanıt: `pytest tests/test_buc.py` PASSED (5 senaryo)
  - [ ] T04.3 — ingest.py + async job · kanıt: `pytest tests/test_ingest.py` PASSED + smoke PASSED
  - [ ] T04.4 — metric_map + rederive provası · kanıt: alan-adı-göçü senaryosu PASSED
  - [ ] T04.5 — eksik-gün alarmı + cron sürüşü · kanıt: ≥3 günlük jsonl + `--gaps` → `eksik gün yok`

## Aşama 05 — taksonomi-esleme
- [ ] **A05** SONUÇ: iki zıt İKA aktif + İK'lar brief'li/eşli + yetim raporu → detay: [asama-05-taksonomi-esleme.md](asama-05-taksonomi-esleme.md)
  - [ ] T05.1 — ✋ İKA/İKK/İK + brief girişi · kanıt: aktif aile ≥2, brief'siz aktif İK = 0
  - [ ] T05.2 — taksonomi loader · kanıt: `pytest tests/test_taxonomy_loader.py` passed + CLI üç katmanlı JSON
  - [ ] T05.3 — mapping üç yol · kanıt: `pytest tests/test_mapping.py` passed + `scan --dry-run` raporu
  - [ ] T05.4 — boost sınıflandırıcısı · kanıt: `pytest tests/test_boost_classifier.py` passed (gerçek döküm fikstürü)
  - [ ] T05.5 — yetim rapor + haftalık · kanıt: `orphans` → rapor + `yetim=<N>`; crontab satırı
  - [ ] T05.6 — AI iskeleti v1 · kanıt: draft İKK ≥1 + `MOTOR-DEGISMEDI`

## Aşama 06 — degerlendirme-digest
- [ ] **A06** SONUÇ: brief-gerekçeli skorlar + digest artefaktı + sink'ler + ≥7 gün sürüş → detay: [asama-06-degerlendirme-digest.md](asama-06-degerlendirme-digest.md)
  - [ ] T06.1 — delta deterministik SQL · kanıt: `pytest tests/test_delta.py` yeşil + `cmp` → BAYT-ES
  - [ ] T06.2 — rubrik bağlayıcı + benchmark · kanıt: `pytest tests/test_rubric.py` yeşil
  - [ ] T06.3 — evaluate instance+agrega · kanıt: `pytest tests/test_evaluate.py` yeşil + dörtlü gerekçe sorguları
  - [ ] T06.4 — digest üretici · kanıt: `pytest tests/test_digest.py` yeşil + sessiz-boşluk alanları
  - [ ] T06.5 — sink kayıt defteri (✋ Telegram) · kanıt: `pytest tests/test_sinks.py` yeşil + `notify --test`
  - [ ] T06.6 — cadence + ≥7 gün sürüş · kanıt: `digest_artifact` 7 ardışık gün + kesintisiz log

## Aşama 07 — panel-onayli-yazma
- [ ] **A07** SONUÇ: onaylı yazma zinciri canlıda kanıtlı + dry-run varsayılan + madde 4 kapalı → detay: [asama-07-panel-onayli-yazma.md](asama-07-panel-onayli-yazma.md)
  - [ ] T07.1 — propose + expire · kanıt: `pytest tests/test_propose.py` passed; brief'siz öneri = 0
  - [ ] T07.2 — guardrails + apply · kanıt: `pytest tests/test_guardrails.py tests/test_apply.py` passed
  - [ ] T07.3 — karar günlüğü + rollback · kanıt: `pytest tests/test_karar_gunlugu.py` passed
  - [ ] T07.4 — FastAPI panel · kanıt: `curl /api/kuyruk` → diff'li pending JSON
  - [ ] T07.5 — canlı prova (✋) + madde 4 · kanıt: `canli_prova.py --dokum` tam zincir

## Aşama 08 — butce-danismani
- [ ] **A08** SONUÇ: onaylı bütçe kaydırma döngüsü + digest etki raporu → detay: [asama-08-butce-danismani.md](asama-08-butce-danismani.md)
  - [ ] T08.1 — portföy skoru + marjinal verim · kanıt: `pytest -k "portfoy or verim"` PASS
  - [ ] T08.2 — Advantage+ uyum katmanı · kanıt: `pytest -k advantage` PASS (3 senaryo)
  - [ ] T08.3 — kaydırma diff'i + guardrail'ler · kanıt: `pytest -k budget` + `-k rationale` PASS
  - [ ] T08.4 — onay hattı + digest etkisi · kanıt: dry-run yazmıyor; gerçek koşu → pending ≥1
  - [ ] T08.5 — canlı döngü (✋) · kanıt: applied budget_shift ≥1 + digest bölümü dolu

## Aşama 09 — creative-tani-metin-kurallari
- [ ] **A09** SONUÇ: yorgunluk tanısı digest'te + block/warn uçtan uca testli → detay: [asama-09-creative-tani-metin-kurallari.md](asama-09-creative-tani-metin-kurallari.md)
  - [ ] T09.1 — yorgunluk tanısı · kanıt: `pytest tests/test_creative_diag.py` geçer
  - [ ] T09.2 — copy_rules motoru + gate · kanıt: `pytest tests/test_copy_rules.py` geçer
  - [ ] T09.3 — başlangıç paketi pasif seed (✋ aktivasyon) · kanıt: seed sonrası `aktif=1` = 0; idempotens
  - [ ] T09.4 — digest bölümleri + 0-aktif uyarısı · kanıt: `pytest tests/test_digest_creative.py` geçer
  - [ ] T09.5 — e2e block/warn + canlı prova · kanıt: e2e geçer + `copy_rule_log` canlı satır

## Aşama 10 — crm-v2-kapisi
- [ ] **A10** SONUÇ: CRM defteri + CAPI + rubrik kapanışı + genişleme provası → detay: [asama-10-crm-v2-kapisi.md](asama-10-crm-v2-kapisi.md)
  - [ ] T10.1 — G4.3 revizyonu + ✋ kapı onayı · kanıt: `rg` tasarım satırları + STATE onay kaydı
  - [ ] T10.2 — eşleme defteri · kanıt: `pytest tests/test_crm_ledger.py tests/test_schema_kvkk.py` geçer
  - [ ] T10.3 — CAPI gönderimi · kanıt: `pytest tests/test_capi_feed.py` geçer + `events_received ≥ 1`
  - [ ] T10.4 — rubrik + digest kapanışı · kanıt: `pytest tests/test_digest_satis_v2.py` geçer
  - [ ] T10.5 — genişleme provası · kanıt: `git diff --stat prova-onu-10 -- src/ tests/` → boş

## Roadmap kapanışı
- [ ] Tüm aşama maddeleri işaretli ve kanıt yolları STATE.md'de
- [ ] MASTER.md'deki BAŞARI tanımı sağlanmış (doğrulama komutu: REQUIREMENTS.md Global tablosunun tüm doğrulama komutları sırayla → hepsi PASS)
- [ ] İlanlı muafiyetler hâlâ geçerli (değişen varsa revizyon: `/plan-kur revize reklamzeka-sistemi`)
