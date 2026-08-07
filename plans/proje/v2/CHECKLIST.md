# ReklamZeka Meta Reklam İşletim Sistemi — CHECKLIST (v2)

> Ana plan kümülatiftir. `[x]` yalnız kanıtlı teslimi, `[ ]` kalan işi gösterir.

- [x] Bütün ürün görüşmelerini vizyon, davranış sözleşmesi, yetki paylaşımı, kullanıcı
  yolculukları ve S0–S6 teslim kapılarıyla birleştiren kanonik ürün distilasyonu.

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
- [x] Secret reference/migration ve read/write scope ayrımı.
  - [x] Read-only connection lifecycle, capability doctor, environment secret reference,
    public redaction ve management-scope-disabled sözleşmesi.
  - [x] Kalıcı Postgres connection/secret adapter'ı, revoked timestamp persistence,
    restart-durable environment secret binding ve fail-closed lifecycle.
- [x] Account/campaign/adset/ad/creative/post çekirdek entity şeması, raw hash/provenance,
  first/last seen ve soft disappearance.
- [ ] Multi-business connection, account group ve account-level permission/capability modeli.
- [x] Facebook Page, Instagram, pixel/dataset, app/WhatsApp destination asset graph.
  - [x] Asset ve edge canonical şeması, capability/provenance/orphan alanları.
  - [x] Parçalı canlı sync, ownership/capability çözümlemesi ve iki hesap kanıtı.
- [x] Yayındaki ad copy/spec extraction: primary text/headline/description/caption/CTA/destination/dynamic variants.
- [x] Bağlı Instagram/Page post-media inventory, ownership/promotion capability ve güvenli preview.
- [ ] L0 raw retention/encryption/purge ile connection revoke/disconnect/export/delete lifecycle.
  - [x] Hash-only/0-gün raw retention, secret destroy/revoke/disconnect ve workspace
    tombstone purge; audit korunumu ve workspace izolasyonu PostgreSQL'de kanıtlı.
  - [ ] Kullanıcıya sunulan veri export akışı ve production secret rotation işletimi.
- [x] Meta config/targeting özeti, CBO/ABO budget-owner resolver ve versioned legacy
  objective mapping çekirdeği.
- [ ] Geniş metrik/action/action-value/breakdown kataloğu.
  - [x] Extensible metric contract; additive/non-additive/derived, action/action-value,
    attribution ve availability provenance çekirdeği.
  - [ ] Canlı field catalog, breakdown uyumluluk matrisi ve gerçek payload coverage.
- [x] Inventory/creative/insights parçalı sync, adaptive page/date slice ve resume.
  - [x] Deterministik planner, bağımsız stream/slice state, bounded retry, adaptive page,
    idempotency, partial success ve durable cursor restore.
  - [x] Portfolio/stream/run/slice/daily-insight persistence şeması, transaction adapter,
    somut Drizzle repository ve hash-only replay ledger.
  - [x] GET-only Graph transport; hierarchy/creative-post/insight edge, cursor ve usage
    headroom binding'i; canlı sınırlı smoke'ta 0 write.
  - [x] Supabase PostgreSQL üzerinde 8 migration/29 public table; yeni connection/runtime ile
    `partial`→cursor restore→`completed` E2E ve geçici workspace cascade temizliği.
- [x] Snapshot diff ve external/manual intervention timeline olayı.
- [ ] Capability/data-quality raporu ve Meta read-only E2E.
  - [x] Canlı inventory/capability smoke: 5 hesap, 22 Page, 8 Instagram, 422 campaign,
    1.108 ad set, 4.620 ad, 0 hata ve 0 write.
  - [x] Trust/readiness domain motoru ve PostgreSQL evidence adapter'ı; iki hesap canlı SQL
    raporu maskeli, eksik insights'i `not_ready` bırakan fail-closed kanıt.
  - [x] S1.5 lifecycle/diff sonrası kalıcı trust raporu, restart/replay ve iki hesap
    isolation PostgreSQL E2E; eksik insight coverage sebepli `not_ready` olarak korunuyor.

## A09 — İç kategori ve talimat

- [ ] Category definition, çoklu assignment, evidence/confidence/manual lock.
  - [x] Versioned Postgres şeması, RLS, manual-lock/source guard ve pure resolver çekirdeği.
  - [ ] Workspace-scoped repository/application API, rol/audit ve gerçek CRUD/restart kabulü.
- [ ] Kullanıcı tanımlı dimension, single/multi cardinality ve entity-level kataloğu.
- [ ] Meta/internal selector ve mapping preview motoru.
- [ ] Category profile: analysis/rule/budget/transfer/schedule/action/creative policy bundle bağları.
- [ ] Campaign→adset→ad→creative inheritance, child override ve effective-context snapshot.
  - [x] Kesintisiz hierarchy path, child add/override/deny, manual-lock precedence,
    `parked_conflict` ve frozen category context/hash çekirdeği.
  - [ ] Tüm category/guidance/policy/data refs'lerini birleştiren EffectiveCampaignContext.
- [ ] Strict instruction/policy DSL ve negatif parser matrisi.
- [ ] Raw natural-language → normalized draft + assumption/question/impact preview.
- [ ] Precedence/inheritance/suppression/PARKED_CONFLICT resolver.
- [ ] Versioned draft/publish/pause/archive ve rol/audit API'leri.
- [ ] Başlangıç objective/internal kategori playbook seti.
- [ ] Kategori coverage/unmatched/conflict/impact dashboard ve güvenli archive akışı.
- [ ] PromotionTemplate + immutable AudiencePresetVersion, selector/alias ve publish dry-run.
- [ ] GuidanceSource/Card/Set/Binding ve global/group/objective/category/entity/topic scope matrisi.
  - [x] Guidance-only pure registry/pack; provenance ayrımı, deterministic scope/conflict,
    freshness ve bounded context budget.
  - [ ] PostgreSQL registry/version binding, account-group/lifecycle/template scope ve API.
- [ ] Owner statement + official Meta source + experiment/observation provenance ve freshness.
- [ ] G0→G4 progressive formalization, semantic diff, historical replay ve impact preview.
- [ ] AdvisedPractice candidate→trial→outcome→standardization lifecycle ve decomposition review.

## A10 — Zamansal analiz

- [x] Kampanya objective/funnel/event/classification temel sözleşmesi.
- [x] Altı objective için primary/diagnostic/guardrail/min-sample karar playbook temeli.
- [ ] Meta config + çoklu internal category + policy composition.
- [ ] Tam metrik kataloğu; additive/non-additive/ratio formülleri.
- [x] Rolling/fixed/calendar/lifetime/learning/action-relative timeframe resolver.
- [ ] Trend/anomali/pacing/threshold/period/cohort/pre-post saf analiz ailesi.
  - [x] Deterministik analysis run/record, frozen window/context/snapshot refs ve
    insufficient-data reason sözleşmesi.
  - [ ] Versioned metrik/formül kataloğu ve gerçek finding fonksiyonları.
- [ ] Hierarchical driver ve creative fatigue/config diagnostics.
- [ ] Analysis run ledger, dry-run API ve deterministic replay.
- [ ] Versioned AnalysisAgenda ve general→group→objective→category→entity→topic pass orkestrasyonu.
- [ ] EffectiveGuidancePack scope filter/ranking/context-budget ve source/conflict trace.
- [ ] DecisionCadenceProfile, no-change/repeat suppression ve ExperimentRecord lifecycle.
- [ ] L0–L5 Postgres pipeline, incremental materialization/invalidation ve context budget.
- [ ] Frozen EffectiveCampaignContext resolver ve top-down/bounded bottom-up driver tools.
- [ ] Optional manual/CSV BusinessOutcomeSignal ve Meta-proxy mapping guard.

## A11 — Bütçe planlama

- [ ] Envelope, allocation, target ve planned/committed/actual/forecast şemaları.
- [ ] CBO/ABO budget owner ve parent-child reconciliation.
- [ ] Protected floor/fixed allocation ve transfer allow/deny/within-group.
- [ ] Pacing/forecast, min sample, learning, cap ve cooldown guard'ları.
- [ ] Fixed/proportional/priority/ladder deterministic allocation.
- [ ] Keep/conservative/target-seeking simülasyon ve constraint trace.
- [ ] Versioned proposal ledger/API; artış approval zorunluluğu.
- [ ] Business outcome target/proxy ayrımı ve yetersiz mapping suppression.

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
- [ ] Kritik guidance interview, owner+Meta best-practice+evidence karşılaştırması ve eval seti.
- [ ] Guidance retrieval/context tools ve source/freshness/best-practice claim guard.
- [ ] Act/test/observe/no-change + cadence ihlali proposal suppression eval'i.
- [ ] L4/L5 compact context, bounded drill-down ve raw L0 access negatifleri.
- [ ] draft_advised_practice authority boundary ve standardization bypass negatifleri.
- [ ] ReklamZeka OrchestratorProfile ve altı vendor-agnostic skill manifesti/conformance eval'i.
- [ ] RuleCoach owner+Meta source+evidence+conflict deliberation ve publish-bypass negatifleri.

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
- [ ] Meta request/write verify ile platform review/delivery effective state ayrımı.
- [ ] Action type/risk + account/category/campaign/entity scoped effective-autonomy resolver ve trace.

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
- [ ] Kritik sohbet + live guidance cards + scope/topic binding + promote-to-policy studio.
- [ ] AnalysisAgenda, applied guidance, cadence/experiment ve no-change UI yolculuğu.
- [ ] Practice Lab candidate/trial/outcome/decomposition/standardized artifact UI.
- [ ] Scheduled analysis in-app inbox ve duplicate-delivery/read-state E2E.
- [x] Operating Dashboard + Orchestrator çift-yüzey bilgi mimarisi ve etkileşimli demo kabuğu.
- [ ] Operating Dashboard gerçek backend state'iyle responsive/browser E2E.
- [ ] Orchestrator skill/context/autonomy/handoff çalışma alanı ve dashboard↔CLI E2E.

## Ana plan kapanışı

- [ ] A07 gerçek saha pilotu tamamlandı.
- [ ] A08–A14 kabul/kanıtları temiz.
- [ ] Production security/build/DB/browser ve Meta sandbox kapıları temiz.
- [ ] Production write ayrı kullanıcı onayı ve sınırlı cohort ile açıldı.
