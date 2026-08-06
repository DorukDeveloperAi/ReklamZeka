# ReklamZeka Meta Reklam İşletim Sistemi — CHECKLIST (v2)

> Ana plan kümülatiftir. `[x]` yalnız kanıtlı teslimi, `[ ]` kalan işi gösterir.

## v1 mirası

- [x] **A01 — ürün temeli:** ürün şartnamesi, roadmap ve kanıt zinciri.
- [x] **A02 — teknik temel:** Next/TypeScript/PostgreSQL/Drizzle/Vitest/CI iskeleti.
- [x] **A03 — veri platformu:** fixture/CSV ortak model, cursor/retry/idempotent ingest.
- [x] **A04 — kiracı güvenliği:** rol, tenant, secret, read-scope ve append-only audit.
- [x] **A05 — performans deneyimi:** tazelik, 7/30/90, kıyas, drill-down, responsive/a11y.
- [x] **A06 — içgörü motoru:** dört deterministik kural, kanıt/güven/sürüm, feedback.
- [ ] **A07 — rapor ve saha pilotu**
  - [x] İmzalı/süreli/iptal edilebilir read-only rapor ve CSV.
  - [x] Operasyon alarmı/runbook ve fixture pilot yolculuğu.
  - [ ] Gerçek 3 workspace/10 hesap `field_pilot` kanıtı.

## A08 — Meta dijital ikizi

- [x] Yan projedeki tokenın değeri ifşa/kopya edilmeden geçerlilik, scope ve Graph v23 read smoke'u.
- [x] Gerçek cache portföy entity/metric coverage ve payload/rate-limit keşfi.
- [ ] Secret reference/migration ve read/write scope ayrımı.
- [ ] Account/campaign/adset/ad/creative tam entity şeması ve raw provenance.
- [ ] Multi-business connection, account group ve account-level permission/capability modeli.
- [ ] Facebook Page, Instagram, pixel/dataset, app/WhatsApp destination asset graph.
- [ ] Yayındaki ad copy/spec extraction: primary text/headline/description/caption/CTA/destination/dynamic variants.
- [ ] Bağlı Instagram/Page post-media inventory, ownership/promotion capability ve güvenli preview.
- [ ] Meta config, targeting özeti, budget owner ve legacy objective mapping.
- [ ] Geniş metrik/action/action-value/breakdown kataloğu.
- [ ] Inventory/creative/insights parçalı sync, adaptive page/date slice ve resume.
- [ ] Snapshot diff ve external/manual intervention timeline olayı.
- [ ] Capability/data-quality raporu ve Meta read-only E2E.

## A09 — İç kategori ve talimat

- [ ] Category definition, çoklu assignment, evidence/confidence/manual lock.
- [ ] Kullanıcı tanımlı dimension, single/multi cardinality ve entity-level kataloğu.
- [ ] Meta/internal selector ve mapping preview motoru.
- [ ] Category profile: analysis/rule/budget/transfer/schedule/action/creative policy bundle bağları.
- [ ] Campaign→adset→ad→creative inheritance, child override ve effective-context snapshot.
- [ ] Strict instruction/policy DSL ve negatif parser matrisi.
- [ ] Raw natural-language → normalized draft + assumption/question/impact preview.
- [ ] Precedence/inheritance/suppression/PARKED_CONFLICT resolver.
- [ ] Versioned draft/publish/pause/archive ve rol/audit API'leri.
- [ ] Başlangıç objective/internal kategori playbook seti.
- [ ] Kategori coverage/unmatched/conflict/impact dashboard ve güvenli archive akışı.
- [ ] PromotionTemplate + immutable AudiencePresetVersion, selector/alias ve publish dry-run.

## A10 — Zamansal analiz

- [x] Kampanya objective/funnel/event/classification temel sözleşmesi.
- [x] Altı objective için primary/diagnostic/guardrail/min-sample karar playbook temeli.
- [ ] Meta config + çoklu internal category + policy composition.
- [ ] Tam metrik kataloğu; additive/non-additive/ratio formülleri.
- [ ] Rolling/fixed/calendar/lifetime/learning/action-relative timeframe resolver.
- [ ] Trend/anomali/pacing/threshold/period/cohort/pre-post saf analiz ailesi.
- [ ] Hierarchical driver ve creative fatigue/config diagnostics.
- [ ] Analysis run ledger, dry-run API ve deterministic replay.

## A11 — Bütçe planlama

- [ ] Envelope, allocation, target ve planned/committed/actual/forecast şemaları.
- [ ] CBO/ABO budget owner ve parent-child reconciliation.
- [ ] Protected floor/fixed allocation ve transfer allow/deny/within-group.
- [ ] Pacing/forecast, min sample, learning, cap ve cooldown guard'ları.
- [ ] Fixed/proportional/priority/ladder deterministic allocation.
- [ ] Keep/conservative/target-seeking simülasyon ve constraint trace.
- [ ] Versioned proposal ledger/API; artış approval zorunluluğu.

## A12 — Prompt ve advisor

- [x] Narrative-only sabit policy + untrusted user guidance envelope temeli.
- [x] FindingId allowlist ve bilinmeyen/tool alanı reddeden output validator temeli.
- [ ] PolicyId/simulationId bağlı genişletilmiş envelope ve claim validator.
- [ ] Natural-language instruction translator ve ambiguity eval seti.
- [ ] Salt-okur local-session/advisor ledger, import/DB saldırı testi ve redaksiyon.
- [ ] Karar defteri/context budget ve deterministic fallback.
- [ ] Injection/cross-tenant/secret/action-bypass tam negatif matrisi.
- [ ] LocalAgentClient/session contract ve modelsiz deterministic fixture client.
- [ ] No-model-API boundary: ReklamZeka'da OpenAI/Anthropic key, SDK veya model network call yok.
- [ ] Localhost Streamable HTTP + project STDIO MCP; auth ve read/proposal tool ayrımı.
- [ ] Codex CLI/VS Code + Claude Code MCP conformance; raw writer/human grant expose edilmez.
- [ ] Session register/heartbeat, dashboard context handoff ve proposal correlation.
- [ ] Local `reklamzeka` companion ile TTY/passkey HumanPresenceGrant ve ayrı approve/execute.
- [ ] MCP-capable CLI config ve güvenli allowlist LocalCliAdapter extension point.

## A13 — Eylem valfi, scheduler ve rutin

- [ ] Typed Meta writer allowlist; raw Graph write yok.
- [ ] Campaign/adset/ad pause/activate eligibility ve parent/effective-status matrisi.
- [ ] Campaign/adset budget owner write; ad-level budget negatif testi.
- [ ] K0–K4 valve, account allowlist, caps, kill switch ve çift anahtar.
- [ ] Approval state machine, expiry, stale-plan ve separation of duties.
- [ ] Idempotent execute, Meta error taxonomy, read-after-write ve rollback.
- [ ] Hourly/daily/weekly/monthly/after-sync scheduler; DST/misfire/idempotency.
- [ ] Sync→analyze→plan→approval agentic routine; otomatik execute yok.
- [ ] External intervention reconcile ve sandbox/shadow rollout.
- [ ] Manual/assisted/automated-read/scheduled-plan + approval-only/policy-limited inheritance ve kill switch.
- [ ] Multi-account batch plan; account-bazlı approval/execute/partial recovery.
- [ ] Varsayılan workspace `approval_only` autonomy lock; expiry/child scope fail-closed.
- [ ] ActionBundle→atomik ActionUnit dependency DAG, tek tek approve/reject/request-changes.
- [ ] Mevcut Instagram/Page gönderisinden template+audience preset'li promotion preflight ve K4 bundle.
- [ ] Yeni metin/görsel/video/creative üretmeme boundary ve negatif testleri.
- [ ] Creative/post spec hash değişiminde stale approval ve yeniden onay.

## A14 — Kontrol merkezi ve rollout

- [ ] Bugün/portfolio hiyerarşi ve internal/Meta filtreler.
- [ ] Account-group switcher, multi-account connection health ve Page/Instagram asset graph.
- [ ] Kategori/talimat stüdyosu ve raw/normalized/version/conflict görünümü.
- [ ] Analiz stüdyosu: template/dry-run/publish/schedule/history.
- [ ] Bütçe stüdyosu: envelope/lock/target/forecast/simulation.
- [ ] Approval inbox, automation run, verify/rollback ve tek timeline.
- [ ] Mevcut creative library + context/performance karşılaştırması.
- [ ] Yayındaki reklam metni/dynamic variant/CTA/destination/post kaynağı explorer'ı.
- [ ] Instagram/Page post seçici, PromotionTemplate/AudiencePreset ve existing-post guided flow.
- [ ] Owner/admin/analyst/operator/viewer rol E2E.
- [ ] 1280/820/390, keyboard/screen-reader ve hata/partial/conflict E2E.
- [ ] Kota/alert/deadman/kill-switch/runbook ve staged rollout KPI raporu.
- [ ] Codex CLI/VS Code/Claude Code local session hub, config/health/handoff ve action queue UI.
- [ ] Satır-bazlı partial approval inbox ve planlama modu/otonomi kilidi kontrol paneli.

## Ana plan kapanışı

- [ ] A07 gerçek saha pilotu tamamlandı.
- [ ] A08–A14 kabul/kanıtları temiz.
- [ ] Production security/build/DB/browser ve Meta sandbox kapıları temiz.
- [ ] Production write ayrı kullanıcı onayı ve sınırlı cohort ile açıldı.
