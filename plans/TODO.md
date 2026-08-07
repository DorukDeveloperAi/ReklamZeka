# GENEL TODO — ReklamZeka

> **TÜREV — elle düzenlenmez.** Tek yazar `agac.mjs` (motor · deterministik · 0 token).
> Elle madde buraya değil **`TODO-ELLE.md`**'ye yazılır.
> Damga: `e090c0916e20` · Kaynak: CHECKLIST(açık) · TODO-ELLE.md · HUKUM.md(EKSİK/STUCK) · künye-eksikleri · sarkık-oturum
> İLANLI MUAF (bu listeye GİRMEZ, her birinin kendi kanalı var): alerts.jsonl · parked işler · doctor fix: · teslim onar: · kaptan task'ları

**181 açık madde** · plansız: 0 · chk: 176 · elle: 5 · hüküm: 0 · künye: 0 · oturum: 0

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

## Plan checklist maddeleri (176) — künye önceliği sırasında


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

### proje v2 · P2
- [ ] **A07 — rapor ve saha pilotu** `td:chk/proje/a07`
- [ ] Gerçek 3 workspace/10 hesap `field_pilot` kanıtı. `td:chk/proje/h20b84a`
- [ ] [08] Secret reference/migration ve read/write scope ayrımı. `td:chk/proje/h16c55a`
- [ ] [08] Account/campaign/adset/ad/creative tam entity şeması ve raw provenance. `td:chk/proje/h871fea`
- [ ] [08] Multi-business connection, account group ve account-level permission/capability modeli. `td:chk/proje/h142d75`
- [ ] [08] Facebook Page, Instagram, pixel/dataset, app/WhatsApp destination asset graph. `td:chk/proje/hf4f8bc`
- [ ] [08] Yayındaki ad copy/spec extraction: primary text/headline/description/caption/CTA/destination/dynamic variants. `td:chk/proje/hcad3c6`
- [ ] [08] Bağlı Instagram/Page post-media inventory, ownership/promotion capability ve güvenli preview. `td:chk/proje/h53917f`
- [ ] [08] L0 raw retention/encryption/purge ile connection revoke/disconnect/export/delete lifecycle. `td:chk/proje/l0`
- [ ] [08] Meta config, targeting özeti, budget owner ve legacy objective mapping. `td:chk/proje/h1dd69c`
- [ ] [08] Geniş metrik/action/action-value/breakdown kataloğu. `td:chk/proje/h0abde7`
- [ ] [08] Inventory/creative/insights parçalı sync, adaptive page/date slice ve resume. `td:chk/proje/hb95318`
- [ ] [08] Snapshot diff ve external/manual intervention timeline olayı. `td:chk/proje/hd9b688`
- [ ] [08] Capability/data-quality raporu ve Meta read-only E2E. `td:chk/proje/h1b5b8d`
- [ ] [09] Category definition, çoklu assignment, evidence/confidence/manual lock. `td:chk/proje/h6f6a7e`
- [ ] [09] Kullanıcı tanımlı dimension, single/multi cardinality ve entity-level kataloğu. `td:chk/proje/h4b2cdd`
- [ ] [09] Meta/internal selector ve mapping preview motoru. `td:chk/proje/hf87f05`
- [ ] [09] Category profile: analysis/rule/budget/transfer/schedule/action/creative policy bundle bağları. `td:chk/proje/hc6456c`
- [ ] [09] Campaign→adset→ad→creative inheritance, child override ve effective-context snapshot. `td:chk/proje/haf478f`
- [ ] [09] Strict instruction/policy DSL ve negatif parser matrisi. `td:chk/proje/h2ff773`
- [ ] [09] Raw natural-language → normalized draft + assumption/question/impact preview. `td:chk/proje/h668d7c`
- [ ] [09] Precedence/inheritance/suppression/PARKED_CONFLICT resolver. `td:chk/proje/h9fb5fd`
- [ ] [09] Versioned draft/publish/pause/archive ve rol/audit API'leri. `td:chk/proje/h346e65`
- [ ] [09] Başlangıç objective/internal kategori playbook seti. `td:chk/proje/h763206`
- [ ] [09] Kategori coverage/unmatched/conflict/impact dashboard ve güvenli archive akışı. `td:chk/proje/h8ca7a8`
- [ ] [09] PromotionTemplate + immutable AudiencePresetVersion, selector/alias ve publish dry-run. `td:chk/proje/h36429c`
- [ ] [09] GuidanceSource/Card/Set/Binding ve global/group/objective/category/entity/topic scope matrisi. `td:chk/proje/h7b6132`
- [ ] [09] Owner statement + official Meta source + experiment/observation provenance ve freshness. `td:chk/proje/h095098`
- [ ] [09] G0→G4 progressive formalization, semantic diff, historical replay ve impact preview. `td:chk/proje/g0`
- [ ] [09] AdvisedPractice candidate→trial→outcome→standardization lifecycle ve decomposition review. `td:chk/proje/hd13a94`
- [ ] [10] Meta config + çoklu internal category + policy composition. `td:chk/proje/h837c80`
- [ ] [10] Tam metrik kataloğu; additive/non-additive/ratio formülleri. `td:chk/proje/h43db1a`
- [ ] [10] Rolling/fixed/calendar/lifetime/learning/action-relative timeframe resolver. `td:chk/proje/hcc55fe`
- [ ] [10] Trend/anomali/pacing/threshold/period/cohort/pre-post saf analiz ailesi. `td:chk/proje/h6d598c`
- [ ] [10] Hierarchical driver ve creative fatigue/config diagnostics. `td:chk/proje/ha5e060`
- [ ] [10] Analysis run ledger, dry-run API ve deterministic replay. `td:chk/proje/hf0c5b9`
- [ ] [10] Versioned AnalysisAgenda ve general→group→objective→category→entity→topic pass orkestrasyonu. `td:chk/proje/h458649`
- [ ] [10] EffectiveGuidancePack scope filter/ranking/context-budget ve source/conflict trace. `td:chk/proje/h01f46d`
- [ ] [10] DecisionCadenceProfile, no-change/repeat suppression ve ExperimentRecord lifecycle. `td:chk/proje/h8b2551`
- [ ] [10] L0–L5 Postgres pipeline, incremental materialization/invalidation ve context budget. `td:chk/proje/l0-l5`
- [ ] [10] Frozen EffectiveCampaignContext resolver ve top-down/bounded bottom-up driver tools. `td:chk/proje/h2c48df`
- [ ] [10] Optional manual/CSV BusinessOutcomeSignal ve Meta-proxy mapping guard. `td:chk/proje/hd3b659`
- [ ] [11] Envelope, allocation, target ve planned/committed/actual/forecast şemaları. `td:chk/proje/h39f892`
- [ ] [11] CBO/ABO budget owner ve parent-child reconciliation. `td:chk/proje/h0cb8c1`
- [ ] [11] Protected floor/fixed allocation ve transfer allow/deny/within-group. `td:chk/proje/h14ff56`
- [ ] [11] Pacing/forecast, min sample, learning, cap ve cooldown guard'ları. `td:chk/proje/h2de05b`
- [ ] [11] Fixed/proportional/priority/ladder deterministic allocation. `td:chk/proje/h6b0943`
- [ ] [11] Keep/conservative/target-seeking simülasyon ve constraint trace. `td:chk/proje/hc63432`
- [ ] [11] Versioned proposal ledger/API; artış approval zorunluluğu. `td:chk/proje/hd8dcc6`
- [ ] [11] Business outcome target/proxy ayrımı ve yetersiz mapping suppression. `td:chk/proje/h580e41`
- [ ] [12] PolicyId/simulationId bağlı genişletilmiş envelope ve claim validator. `td:chk/proje/he961f5`
- [ ] [12] Natural-language instruction translator ve ambiguity eval seti. `td:chk/proje/h22cbf5`
- [ ] [12] Salt-okur local-session/advisor ledger, import/DB saldırı testi ve redaksiyon. `td:chk/proje/h149c30`
- [ ] [12] Karar defteri/context budget ve deterministic fallback. `td:chk/proje/h76c76a`
- [ ] [12] Injection/cross-tenant/secret/action-bypass tam negatif matrisi. `td:chk/proje/haa9d1e`
- [ ] [12] LocalAgentClient/session contract ve modelsiz deterministic fixture client. `td:chk/proje/hff54c2`
- [ ] [12] No-model-API boundary: ReklamZeka'da OpenAI/Anthropic key, SDK veya model network call yok. `td:chk/proje/h76738f`
- [ ] [12] Localhost Streamable HTTP + project STDIO MCP; auth ve read/proposal tool ayrımı. `td:chk/proje/hd44902`
- [ ] [12] Codex CLI/VS Code + Claude Code MCP conformance; raw writer/human grant expose edilmez. `td:chk/proje/h5d9115`
- [ ] [12] Session register/heartbeat, dashboard context handoff ve proposal correlation. `td:chk/proje/h0200e6`
- [ ] [12] Local `reklamzeka` companion ile TTY/passkey HumanPresenceGrant ve ayrı approve/execute. `td:chk/proje/h937c5b`
- [ ] [12] MCP-capable CLI config ve güvenli allowlist LocalCliAdapter extension point. `td:chk/proje/ha7e250`
- [ ] [12] Kritik guidance interview, owner+Meta best-practice+evidence karşılaştırması ve eval seti. `td:chk/proje/ha40175`
- [ ] [12] Guidance retrieval/context tools ve source/freshness/best-practice claim guard. `td:chk/proje/h74010b`
- [ ] [12] Act/test/observe/no-change + cadence ihlali proposal suppression eval'i. `td:chk/proje/hf8fe34`
- [ ] [12] L4/L5 compact context, bounded drill-down ve raw L0 access negatifleri. `td:chk/proje/l4`
- [ ] [12] draft_advised_practice authority boundary ve standardization bypass negatifleri. `td:chk/proje/hae87bb`
- [ ] [12] ReklamZeka OrchestratorProfile ve altı vendor-agnostic skill manifesti/conformance eval'i. `td:chk/proje/h5f4daf`
- [ ] [12] RuleCoach owner+Meta source+evidence+conflict deliberation ve publish-bypass negatifleri. `td:chk/proje/h93deb4`
- [ ] [13] Typed Meta writer allowlist; raw Graph write yok. `td:chk/proje/h9be15e`
- [ ] [13] Campaign/adset/ad pause/activate eligibility ve parent/effective-status matrisi. `td:chk/proje/hd515f4`
- [ ] [13] Campaign/adset budget owner write; ad-level budget negatif testi. `td:chk/proje/hd8c3cb`
- [ ] [13] K0–K4 valve, account allowlist, caps, kill switch ve çift anahtar. `td:chk/proje/k0-k4`
- [ ] [13] Approval state machine, expiry, stale-plan ve separation of duties. `td:chk/proje/h925a45`
- [ ] [13] Idempotent execute, Meta error taxonomy, read-after-write ve rollback. `td:chk/proje/h9b0b2d`
- [ ] [13] Hourly/daily/weekly/monthly/after-sync scheduler; DST/misfire/idempotency. `td:chk/proje/h000c67`
- [ ] [13] Sync→analyze→plan→approval agentic routine; otomatik execute yok. `td:chk/proje/h17c1bc`
- [ ] [13] External intervention reconcile ve sandbox/shadow rollout. `td:chk/proje/h67739b`
- [ ] [13] Manual/assisted/automated-read/scheduled-plan + approval-only/policy-limited inheritance ve kill switch. `td:chk/proje/h7cd99e`
- [ ] [13] Multi-account batch plan; account-bazlı approval/execute/partial recovery. `td:chk/proje/h908106`
- [ ] [13] Varsayılan workspace `approval_only` autonomy lock; expiry/child scope fail-closed. `td:chk/proje/hd8a307`
- [ ] [13] ActionBundle→atomik ActionUnit dependency DAG, tek tek approve/reject/request-changes. `td:chk/proje/hdd1197`
- [ ] [13] Mevcut Instagram/Page gönderisinden template+audience preset'li promotion preflight ve K4 bundle. `td:chk/proje/ha9ca7f`
- [ ] [13] Yeni metin/görsel/video/creative üretmeme boundary ve negatif testleri. `td:chk/proje/hf0b1da`
- [ ] [13] Creative/post spec hash değişiminde stale approval ve yeniden onay. `td:chk/proje/hba96e9`
- [ ] [13] Meta request/write verify ile platform review/delivery effective state ayrımı. `td:chk/proje/ha8b583`
- [ ] [13] Action type/risk + account/category/campaign/entity scoped effective-autonomy resolver ve trace. `td:chk/proje/h0d94d6`
- [ ] [14] Bugün/portfolio hiyerarşi ve internal/Meta filtreler. `td:chk/proje/hb8d4e8`
- [ ] [14] Account-group switcher, multi-account connection health ve Page/Instagram asset graph. `td:chk/proje/hd7b228`
- [ ] [14] Kategori/talimat stüdyosu ve raw/normalized/version/conflict görünümü. `td:chk/proje/he405ed`
- [ ] [14] Analiz stüdyosu: template/dry-run/publish/schedule/history. `td:chk/proje/he6f118`
- [ ] [14] Bütçe stüdyosu: envelope/lock/target/forecast/simulation. `td:chk/proje/hb498ac`
- [ ] [14] Approval inbox, automation run, verify/rollback ve tek timeline. `td:chk/proje/h86fc64`
- [ ] [14] Mevcut creative library + context/performance karşılaştırması. `td:chk/proje/h7a9216`
- [ ] [14] Yayındaki reklam metni/dynamic variant/CTA/destination/post kaynağı explorer'ı. `td:chk/proje/he5cdef`
- [ ] [14] Instagram/Page post seçici, PromotionTemplate/AudiencePreset ve existing-post guided flow. `td:chk/proje/h748424`
- [ ] [14] Owner/admin/analyst/operator/viewer rol E2E. `td:chk/proje/h3aff1a`
- [ ] [14] 1280/820/390, keyboard/screen-reader ve hata/partial/conflict E2E. `td:chk/proje/h13fad8`
- [ ] [14] Kota/alert/deadman/kill-switch/runbook ve staged rollout KPI raporu. `td:chk/proje/h3d7380`
- [ ] [14] Codex CLI/VS Code/Claude Code local session hub, config/health/handoff ve action queue UI. `td:chk/proje/h4b0ecb`
- [ ] [14] Satır-bazlı partial approval inbox ve planlama modu/otonomi kilidi kontrol paneli. `td:chk/proje/hd6d304`
- [ ] [14] Kritik sohbet + live guidance cards + scope/topic binding + promote-to-policy studio. `td:chk/proje/h9781dc`
- [ ] [14] AnalysisAgenda, applied guidance, cadence/experiment ve no-change UI yolculuğu. `td:chk/proje/h15ef9e`
- [ ] [14] Practice Lab candidate/trial/outcome/decomposition/standardized artifact UI. `td:chk/proje/h0c8a74`
- [ ] [14] Scheduled analysis in-app inbox ve duplicate-delivery/read-state E2E. `td:chk/proje/h2c9b81`
- [ ] [14] Operating Dashboard gerçek backend state'iyle responsive/browser E2E. `td:chk/proje/h52d78e`
- [ ] [14] Orchestrator skill/context/autonomy/handoff çalışma alanı ve dashboard↔CLI E2E. `td:chk/proje/h30d52a`
- [ ] A07 gerçek saha pilotu tamamlandı. `td:chk/proje/a07-2`
- [ ] A08–A14 kabul/kanıtları temiz. `td:chk/proje/a08-a14`
- [ ] Production security/build/DB/browser ve Meta sandbox kapıları temiz. `td:chk/proje/hd72c59`
- [ ] Production write ayrı kullanıcı onayı ve sınırlı cohort ile açıldı. `td:chk/proje/hcbb68b`

## Künye eksikleri — advisory (0)

_yok_

## Sarkık oturum işi — advisory (0)

_yok_

