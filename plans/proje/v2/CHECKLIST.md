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
  - [x] Sürümlü Graph v23 field/action/breakdown kataloğu, fail-closed compatibility planner,
    exact action-type extractor ve campaign/ad-set/ad + sekiz probe gerçek payload coverage.
  - [ ] Gerçek örnekte `action_values` container gözlemi; bounded kabul bunu sıfır gördü ve
    `partial_coverage` olarak açık bıraktı, sıfır değer veya doğrulanmış destek uydurulmadı.
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
  - [x] Workspace-scoped repository/application core ve gerçek CRUD/restart/rollback kabulü.
  - [ ] Rol/audit mutation API'si.
- [x] Kullanıcı tanımlı dimension, single/multi cardinality ve entity-level kataloğu.
- [ ] Meta/internal selector ve mapping preview motoru.
- [ ] Category profile: analysis/rule/budget/transfer/schedule/action/creative policy bundle bağları.
- [ ] Campaign→adset→ad→creative inheritance, child override ve effective-context snapshot.
  - [x] Kesintisiz hierarchy path, child add/override/deny, manual-lock precedence,
    `parked_conflict` ve frozen category context/hash çekirdeği.
  - [x] Tüm category/guidance/policy/data refs'lerini birleştiren saf EffectiveCampaignContext.
  - [x] Context persistence, selective invalidation ve public redaction projection'ı.
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
  - [x] Append-only PostgreSQL registry, version/hash guard, tenant isolation ve RLS.
  - [ ] Account-group/lifecycle/template scope, analysis-run binding ve rol/audit API'si.
- [ ] Owner statement + official Meta source + experiment/observation provenance ve freshness.
- [ ] G0→G4 progressive formalization, semantic diff, historical replay ve impact preview.
- [ ] AdvisedPractice candidate→trial→outcome→standardization lifecycle ve decomposition review.

## A10 — Zamansal analiz

- [x] Kampanya objective/funnel/event/classification temel sözleşmesi.
- [x] Altı objective için primary/diagnostic/guardrail/min-sample karar playbook temeli.
- [ ] Meta config + çoklu internal category + policy composition.
- [x] Mevcut AnalysisMetric sözlüğünü eksiksiz kapsayan sürümlü additive/non-additive/ratio-of-sums kataloğu.
- [x] Rolling/fixed/calendar/lifetime/learning/action-relative timeframe resolver.
- [ ] Trend/anomali/pacing/threshold/period/cohort/pre-post saf analiz ailesi.
  - [x] Deterministik analysis run/record, frozen window/context/snapshot refs ve
    insufficient-data reason sözleşmesi.
  - [x] Versioned metrik/formül kataloğu, provenance ve fail-closed aggregation motoru.
  - [x] Trend/anomaly/pacing/threshold/period/pre-post authentic calculator ailesi.
  - [x] Bounded, exact-scope/hash doğrulamalı ve replay-stable L2 observation plan/builder sözleşmesi.
  - [x] Gerçek PostgreSQL insight read adapteri; canonical hash replay, row cap, explicit
    attribution-settlement policy ve rollback kabulü.
  - [x] Manual/scheduled ortak deterministic analysis runtime; L2 materialization→calculator→
    finding→ledger bağlamı, exact frozen snapshot ve server-private entity identity sınırı.
  - [x] Persisted, versioned template/timeframe registry; schedule-revision hash binding,
    frozen run asset ve manual/scheduled ortak production loader/executor.
  - [ ] Cohort calculator.
- [ ] Hierarchical driver ve creative fatigue/config diagnostics.
- [ ] Analysis run ledger, dry-run API ve deterministic replay.
  - [x] Append-only authentic hash-chain decision ledger saf çekirdeği ve malformed/tamper matrisi.
  - [x] Workspace-scoped PostgreSQL ledger persistence, tenant/temporal guard ve rollback E2E.
  - [x] Model-agnostic read/draft Decision Room application servisi ve stable replay refs.
  - [x] Optimistic head/immutable prefix korumalı atomik Drizzle suffix staging adapterı.
  - [x] Model-agnostic dashboard/Codex/Claude read-tool ve HTTP kontratı; server-bound workspace
    dışında fail-closed, Meta/action authority taşımıyor.
  - [x] Gerçek Drizzle schedule/run/inbox read repository, public asset alias, keyset pagination
    ve yarış-güvenli server-clock read-state.
  - [x] HMAC capability'li loopback-only local-session principal/route assembly; dashboard cookie,
    CLI bearer, her istekte aktif workspace üyeliği ve read/mark-read scope'u.
  - [ ] Rol yönetimi/audit mutation API'si ve gerçek analysis dry-run endpoint'i.
- [ ] Versioned AnalysisAgenda ve general→group→objective→category→entity→topic pass orkestrasyonu.
  - [x] Deterministik on-pass agenda, category/topic subset ve context/timeframe-bound finding çekirdeği.
  - [ ] Persistence, gerçek finding ailesi ve Decision Room application binding'i.
- [x] EffectiveGuidancePack scope filter/ranking/context-budget ve source/conflict trace.
- [ ] DecisionCadenceProfile, no-change/repeat suppression ve ExperimentRecord lifecycle.
  - [x] Settle/observation/learning/cooldown/evidence/repeat saf karar kapısı ve tek değişkenli experiment çekirdeği.
  - [x] Manual/scheduled ortak executor, idempotency/overlap/retry/lease ve in-app inbox çekirdeği.
  - [ ] Cadence/experiment PostgreSQL persistence, rol/audit API'si ve Decision Room adapter binding'i.
- [ ] L0–L5 Postgres pipeline, incremental materialization/invalidation ve context budget.
- [x] Frozen EffectiveCampaignContext resolver ve top-down/bounded bottom-up driver tools.
  - [x] Authentic category/guidance doğrulayan, raw/write authority taşımayan saf frozen context/hash.
  - [x] Append-only persistence, exact-scope invalidation, historical replay ve public-safe projection.
  - [x] Finding'e bağlı max-depth/max-driver sınırlı bottom-up driver çekirdeği.
- [ ] Optional manual/CSV BusinessOutcomeSignal ve Meta-proxy mapping guard.

## A11 — Bütçe planlama

- [x] Saf period/currency envelope ve planned/committed/actual/forecast şemaları; target
  persistence/application binding'i ileri incrementtir.
- [x] CBO/ABO budget owner ve exact parent-child reconciliation saf çekirdeği.
- [x] Protected floor/fixed allocation ve transfer allow/deny/within-group saf motoru.
- [x] Pacing/forecast, freshness/coverage/min sample/attribution/learning/cap/cooldown saf guard'ları.
- [x] Fixed/proportional/priority/ladder deterministic allocation ve exact integer-weight rounding.
- [x] Saf keep/conservative/target-seeking (en fazla üç explicit alternatif), frozen input,
  before/after, pacing+constraint trace ve suppression/no-change/unsatisfied preservation.
- [x] Versioned append-only proposal ledger/repository; frozen workspace/account/campaign/context,
  revision/hash/idempotency, alternatives ve public-safe projection.
- [x] Budget Lab tenant-bound keyset agent/GET/dashboard read API; unavailable/empty/error/
  list/detail, before-after, mapping ve trace özeti; fixture canlı sonuç olarak kullanılmaz.
- [x] Budget Lab explicit dry-run ve append-only draft proposal command; ayrı draft scope,
  owner/admin/analyst yetkisi, viewer denial, idempotency ve proposal+audit atomik transaction.
- [x] Saf business outcome target/Meta proxy ayrımı; provenance/scope/timeframe/evidence/review
  kapıları ve eksik/ambiguous/stale mapping suppression.
- [x] Target mapping→scenario application binding ve persisted proposal trace; mapping-ready
  olmayan target-seeking bastırılır, keep/conservative bağımsız kalır.

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
  - [x] Saf K0–K4 typed action sınıflandırması; workspace default `approval_only`, scoped
    en-dar resolver, expiry/conflict/child-widening/kill-switch ve budget/protection guard'ları.
- [x] Approval state machine, expiry, stale-plan ve separation of duties.
- [ ] Idempotent execute, Meta error taxonomy, read-after-write ve rollback.
- [ ] Hourly/daily/weekly/monthly/after-sync scheduler; DST/misfire/idempotency.
  - [x] Decision Room daily/weekly timezone+DST, skip/run_once catch-up ve duplicate-slot çekirdeği.
  - [x] Immutable schedule revision, exact hierarchy binding ve kalıcı lease/run store.
  - [x] Bounded daily/weekly worker tick, partial isolation, concurrent suppression ve exact revision cursor guard'ı.
  - [x] Meta read-sync için DB-derived workspace+connection adayları, claim/lease sonrası exact revalidation,
    deterministik fire/parent-run kimliği, bounded concurrency/retry ve bağlantı-bazlı partial isolation saf
    worker çekirdeği.
  - [x] Server-derived sabit scope'lu production service factory ve redakte typed retry classifier; caller
    workspace/account/token enjeksiyonu, public route/cron ve Meta write yok.
  - [x] Meta read-sync DB schedule registry + atomik lease/run adapterı; active/read-only binding, exact revision,
    duplicate/expired retry/attempt cap ve rollback'li canlı cursor kabulü.
  - [x] Registry/lease/service/retry portlarını server içinde kuran private Drizzle tick composition'ı; caller
    scope/account/token/port enjeksiyonu yok, sonuç authority/write-network invariant'ı fail-closed.
  - [ ] Güvenilir local scheduler principal/runner aktivasyonu; cron/route hâlen kapalı.
  - [ ] Hourly/monthly/after-sync schedule türleri.
- [ ] Sync→analyze→plan→approval agentic routine; otomatik execute yok.
- [ ] External intervention reconcile ve sandbox/shadow rollout.
- [ ] Manual/assisted/automated-read/scheduled-plan + approval-only/policy-limited inheritance ve kill switch.
- [ ] Multi-account batch plan; account-bazlı approval/execute/partial recovery.
- [x] Varsayılan workspace `approval_only` autonomy lock; expiry/child scope fail-closed saf çekirdek.
- [x] Workspace/account-group/account/internal-category/campaign/entity/action-type scoped, sürümlü ve
  append-only AutonomyRule registry; analyst draft, yalnız owner/admin explicit publish/disable,
  guidance provenance-only, RLS/API-revoke/tombstone ve canonical hash doğrulaması.
- [x] ActionBundle→atomik ActionUnit dependency DAG, tek tek approve/reject/request-changes saf
  yaşam döngüsü; approval execute değildir ve grant exact/single-use'dur.
- [x] Typed action plan→approval-required staging; exact plan/action/context/policy hash'i,
  deterministic bundle/unit kimliği, public-safe özet ve idempotency doğrulaması.
- [x] Append-only action proposal queue persistence; policy snapshot, bundle, unit, dependency ve
  ilk lifecycle event'i tek transaction'da, tenant/RLS/immutability/tombstone güvenceleriyle saklanır.
- [x] Reviewed ApprovalPolicy'de grant ömründen ayrı zorunlu proposal lifetime; canonical hash/snapshot/queue
  doğrulaması, migration'da seed/backfill yasağı ve policy üst sınırını aşan proposal'a zero-write.
- [x] Approval queue salt-okunur list/detail ve model-agnostic agent contract; viewer dahil yetkili
  roller yalnız public-safe veri görür, approve/grant/execute/Meta-write capability'leri `false` kalır.
- [x] Mevcut Instagram/Page gönderisinden yayınlanmış template + immutable audience preset'li,
  yalnız doğrulanmış mevcut post kabul eden K4 approval-required preflight/bundle çekirdeği.
- [x] Yeni metin/görsel/video/creative üretmeme; raw targeting/ID/creative injection negatifleri.
- [x] Post content, creative binding ve template/preset revision hash değişiminde yeni preflight/action
  kimliği üreterek eski approval'ın yeni spesifikasyona taşınmaması.
- [ ] Meta request/write verify ile platform review/delivery effective state ayrımı.
- [x] Action type/risk + account/category/campaign/entity scoped effective-autonomy resolver ve trace saf çekirdeği.

## A14 — Kontrol merkezi ve rollout

- [ ] Bugün/portfolio hiyerarşi ve internal/Meta filtreler.
- [ ] Account-group switcher, multi-account connection health ve Page/Instagram asset graph.
- [ ] Kategori/talimat stüdyosu ve raw/normalized/version/conflict görünümü.
  - [x] Autonomy revision feed + owner/admin/analyst normalized-draft yüzeyi; viewer read-only,
    workspace/principal/revision server-derived ve publish/disable/approve/execute/Meta-write kapalı.
- [ ] Analiz stüdyosu: template/dry-run/publish/schedule/history.
- [ ] Bütçe stüdyosu: envelope/lock/target/forecast/simulation.
  - [x] Gerçek proposal ledger salt-okunur list/detail, before-after, mapping/suppression ve
    trace summary; ayrı `budget_lab:read` local-session scope'u.
  - [ ] Kural/target edit akışı.
  - [x] Explicit dry-run compose ve append-only draft persistence; aynı transaction'da audit,
    public-safe çıktı ve approval/execute/Meta-write yetkisi `false`.
- [ ] Approval inbox, automation run, verify/rollback ve tek timeline.
  - [x] Restart-durable awaiting-approval veri modeli ve public-safe read contract.
  - [x] Tenant-bound Drizzle read adapter, ayrı `approval_queue:read` kapsamlı GET API ve
    fixture'sız dashboard list/detail inbox bağlantısı.
  - [x] İnsan-varlığı kanıtlı, tek-ActionUnit approve/reject/request-changes mutation katmanı;
    macOS sistem diyaloğu, kısa ömürlü tek-kullanımlık proof ve atomik append-only karar kaydı.
- [ ] Mevcut creative library + context/performance karşılaştırması.
- [ ] Yayındaki reklam metni/dynamic variant/CTA/destination/post kaynağı explorer'ı.
- [ ] Instagram/Page post seçici, PromotionTemplate/AudiencePreset ve existing-post guided flow.
  - [x] Ref-only, sahte katalog kullanmayan fail-closed preflight paneli; exact before→after,
    compatibility/guidance nedenleri ve bütün kapalı action capability'leri görünür.
  - [x] Immutable preset→template→binding→category registry atomik/idempotent repository'si;
    public-safe katalog sözleşmesi, strict validator ve cookie-only GET sınırı.
  - [x] Gerçek PostgreSQL registry + yalnız `eligible` existing-post kataloğu; template kaynaklı budget/timeframe,
    ayrı cookie-only `promotion_catalog:read` runtime'ı ve truncation/corruption fail-closed kontrolleri.
  - [x] Pure K4 preflight sonucunu mevcut append-only approval queue'ya atomik/idempotent kaydeden,
    creative binding + schedule/timeframe'i action hash'ine bağlayan proposal persistence köprüsü.
  - [x] Exact 10-ref dashboard seçimini tenant-bound PostgreSQL mirror/registry üzerinden yeniden çözen,
    ayrı cookie-only `promotion_preflight:read` POST runtime'ı; account→campaign→ad-set, actor→post,
    canonical hash/link ve schedule/budget doğrulaması, kanıtsız compatibility'de fail-closed sonuç.
  - [x] Ayrı `promotion_proposal:draft` capability ve `promotion:draft` workspace yetkili explicit
    draft intent'i; exact seçimi yeniden preflight eder, viewer/bearer/proxy/override'ı reddeder ve
    immutable server materializer yokken sıfır queue write ile `material_unavailable` kalır.
  - [x] Campaign/ad set/ad Graph sayfalarını tenant-bound PostgreSQL aynaya raw payload saklamadan yazan,
    source-priority/revision replay korumalı ve cursor öncesi fail-closed çalışan kanonik inventory
    materializer portu. Production sync factory/live wiring henüz yoktur; compatibility kanıtı sayılmaz.
  - [x] Beş compatibility boyutu için seed'siz, reviewed/published/expiry kontrollü generic typed artifact
    registry; empty/partial/stale/conflict protection `unknown`, action/policy/Meta authority yok.
  - [x] Organic post ile existing-ad kaynağını ayıran versioned `sourceBinding`; organik gönderide creative
    kimliği/üretimi yok, source/post/object-story kanıtı action hash'ine bağlı ve legacy ref sentezlenmiyor.
  - [x] Caller scope almayan production read-sync composition; canonical inventory + durable cursor aynı
    runtime'da, güvenilir scheduler principal'ı olmadığı için public GET ve canlı sync kapalı.
  - [x] Exact material/snapshot hash'lerinden evidence selection üreten private canonical submitter çekirdeği;
    compatibility/policy/protection/autonomy eksikliğinde zero queue ve live route bağlantısı kapalı.
  - [x] Exact K4 existing-post ApprovalPolicy payload'ı için append-only/hash-linked reviewed registry;
    revise/publish/disable, exact-one active resolver, forced RLS/API revoke ve seed yok.
  - [x] Queue policy snapshot'ını reviewed source policy revision FK/hash'ine bağlama; K4 existing-post için
    arbitrary/cross-tenant/ambiguous/draft/disabled/expired ve kaynaksız lifecycle policy girişini zero-write
    fail-closed reddetme. Tarihsel exact replay yalnız yeni kayıt üretmeyen `unchanged` yolunda korunur.
  - [x] Action/account/campaign/entity/internal-category/geo selector'ları ve deny/budget-limit/fixed/no-outflow
    clause'ları için hash-linked guardrail lifecycle + saf ProtectionResolver domain çekirdeği. Guidance yalnız
    provenance; authority yok.
  - [x] Guardrail lifecycle için tenant-bound append-only PostgreSQL revision registry, full-chain resolver,
    forced RLS/API revoke, canonical payload CHECK'leri ve workspace tombstone purge kapsamı.
  - [x] Exact scope/freshness/source-revision hash'li kategori+affected-geo evidence materializer sözleşmesi;
    authoritative kategori kaynağı mevcut, canonical affected-geo mirror fact'i gelene kadar geo `unknown`.
  - [x] Active-workspace effective context + frozen/current category replay'ini kullanan production-safe
    AuthenticCategoryEvidence adapterı; category ref'i label/free-text değil semantic key digest'idir.
  - [x] GET-only/redacted targeting shape canary; 3 bounded AdSet örneğinde explicit included country
    koleksiyonu ile `home/recent` location-type biçimi doğrulandı, targeting değerleri/logları ve Meta write yok.
  - [x] Versioned ve saf canonical affected-geo country normalizer; exact country + `home/recent` dışında,
    region/city/custom/exclusion/travel biçimlerinde tüm snapshot fail-closed `unknown`, hiçbir authority yok.
  - [x] Canonical affected-geo immutable snapshot/item persistence, hash-only ülke item'ları, ayrı `home/recent`
    vocabulary, private inventory extraction adapterı, forced RLS/API revoke ve rollback'li canlı DB kabulü.
  - [x] Graph AdSet inventory field catalog + transactional runtime persistence wiring ve gerçek Drizzle
    AuthenticAffectedGeoEvidence adapterı; iki GET/sıfır write canlı kabulünde 3 canonical AdSet/geo snapshot.
    Doğrulanmamış country dışı şekiller `unknown`.
  - [x] Preflight/protection ortak canonical existing-post action builder/hash; reviewed approval/autonomy/guardrail
    ve authentic category/geo evidence'i birleştiren fail-closed private policy adapterı. Requester membership,
    kill-switch, protection disposition ve bütün bilinen expiry kaynakları bağlı; freshness default'u yok.
  - [x] Evidence freshness'i reviewed ApprovalPolicy alanından türeten request-bound Drizzle submitter ve cookie-only
    proposal-draft route composition'ı; principal/membership exact binding, yalnız append-only queue, Meta writer yok.
  - [x] Autonomy Studio içinde draft-only K4 Policy Bundle sekmesi; ApprovalPolicy/Guardrail public-safe feed,
    active/effective/ambiguity-aware readiness, viewer read-only ve owner/admin/analyst immutable draft akışı.
    Guardrail account→campaign→ad-set kapsamı ile internal kategori yalnız server kataloğundan; business değer
    varsayımı, publish/disable/approve/grant/execute/Meta-write ve geo serbest metni yok.
  - [x] K4 policy bundle için owner/admin-only macOS insan-varlığı yayın töreni; immutable draft revision/content
    bağlı, kısa ömürlü tek-kullanımlık kanıt ve cookie-only exact intent. Dashboard töreni başlatabilir ancak
    publish/action-approve/grant/execute/Meta-write authority istemciye veya agenta verilmez.
  - [x] Dashboard ve model-agnostic agentın aynı Policy Bundle read/readiness servisini kullanması; agent contract'ı
    salt okunur ve draft/publish/approve/grant/execute/Meta-write capability'lerinin tamamı kapalı.
  - [x] Dashboard preflight ve proposal recheck için exact immutable material/selection hash'ine bağlı reviewed
    compatibility köprüsü; eksik, bozuk, foreign-workspace veya beş boyutu tam olmayan kanıt bütünüyle `unknown`.
  - [ ] Kullanıcı-reviewed gerçek ApprovalPolicy/AutonomyRule/Guardrail/compatibility bundle'ını yayınlama ve
    dashboard üzerinden proposal→satır-bazlı approval canlı E2E; hiçbir business policy seed edilmedi.
  - [ ] Dashboard seçimi→server-resolved POST context→proposal kaydı ve satır-bazlı approval uçtan uca bağlantısı.
- [ ] Owner/admin/analyst/operator/viewer rol E2E.
- [ ] 1280/820/390, keyboard/screen-reader ve hata/partial/conflict E2E.
- [ ] Kota/alert/deadman/kill-switch/runbook ve staged rollout KPI raporu.
- [ ] Codex CLI/VS Code/Claude Code local session hub, config/health/handoff ve action queue UI.
- [ ] Satır-bazlı partial approval inbox ve planlama modu/otonomi kilidi kontrol paneli.
- [ ] Kritik sohbet + live guidance cards + scope/topic binding + promote-to-policy studio.
- [ ] AnalysisAgenda, applied guidance, cadence/experiment ve no-change UI yolculuğu.
- [ ] Practice Lab candidate/trial/outcome/decomposition/standardized artifact UI.
  - [x] AdvisedPractice candidate→review→trial→outcome→standardization-review append-only domain,
    PostgreSQL persistence, tenant/RLS/tombstone ve policy/automation-promotion engeli.
  - [x] Public-safe list/detail/lifecycle/source özeti, ephemeral collaboration draft ve
    model-agnostic read tools; persistence/promotion/action authority yok.
- [ ] Scheduled analysis in-app inbox ve duplicate-delivery/read-state E2E.
  - [x] Saf executor üzerinde idempotent in-app teslim/recovery ve duplicate-run testi.
  - [x] Workspace-scoped PostgreSQL inbox/read-state ve duplicate-delivery rollback E2E.
  - [x] Applied-table worker partial/catch-up/concurrency/revision-race rollback E2E.
  - [x] Dashboard Decision Room read-only/unavailable/empty source ayrımı; fixture canlı sonuç
    yerine kullanılmıyor.
  - [x] Dashboard capability-cookie ve CLI bearer aynı public ref'leri üretir; replay/expiry/
    host-spoof/cross-site/proxy conformance negatifleri.
  - [ ] Güvenilir principal ile canlı dashboard E2E.
- [x] Operating Dashboard + Orchestrator çift-yüzey bilgi mimarisi ve etkileşimli demo kabuğu.
- [ ] Operating Dashboard gerçek backend state'iyle responsive/browser E2E.
- [ ] Orchestrator skill/context/autonomy/handoff çalışma alanı ve dashboard↔CLI E2E.

## Ana plan kapanışı

- [ ] A07 gerçek saha pilotu tamamlandı.
- [ ] A08–A14 kabul/kanıtları temiz.
- [ ] Production security/build/DB/browser ve Meta sandbox kapıları temiz.
- [ ] Production write ayrı kullanıcı onayı ve sınırlı cohort ile açıldı.
