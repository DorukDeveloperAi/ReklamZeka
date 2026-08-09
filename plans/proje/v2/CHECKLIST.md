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
  - [x] Owner/admin assignment create/revise/unlock/archive; server-owned source/evidence,
    registry+version concurrency, manual-lock guard, audit ve selective context invalidation.
  - [x] İlk kez assignment yapılacak entity için tenant-bound, aktif/non-disappeared salt-okur
    target catalog/chooser; opaque ref ve creative için exact `viaAdRef`, owner/admin UI ve
    raw Meta ID/UUID redaksiyonu.
  - [ ] Target catalog bağlı PostgreSQL ve gerçek oturumlu browser kabulü; yerel DB/session yok.
- [x] Kullanıcı tanımlı dimension, single/multi cardinality ve entity-level kataloğu.
- [x] Meta/internal selector ve mapping preview motoru.
- [x] Category profile: analysis/rule/budget/transfer/schedule/action/creative policy bundle bağları.
  - [x] Append-only profile revision/hash-chain, parent/identity bütünlüğü ve frozen-context
    `category_profile` component binding'i.
  - [x] Owner/admin create/revise/publish/pause/archive; workspace lock sonrası membership
    recheck, registry+version/hash OCC, reason-code audit ve prior-profile invalidation aynı transaction.
  - [ ] Bağlı PostgreSQL verifier ve gerçek oturumlu happy-path browser kabulü; yerel DB/session yok.
- [x] Campaign→adset→ad→creative inheritance, child override ve effective-context snapshot.
  - [x] Kesintisiz hierarchy path, child add/override/deny, manual-lock precedence,
    `parked_conflict` ve frozen category context/hash çekirdeği.
  - [x] Tüm category/guidance/policy/data refs'lerini birleştiren saf EffectiveCampaignContext.
  - [x] Context persistence, selective invalidation ve public redaction projection'ı.
- [x] Strict instruction/policy DSL ve negatif parser matrisi.
- [ ] Raw natural-language → normalized draft + assumption/question/impact preview.
  - [x] `owner_statement` ham metni ayrı provenance kaydı olarak koruyan, guidance-only
    card + tek scope binding üreten gerçek taslak authoring akışı.
  - [x] G0→G4 saf sözleşmede normalized draft, varsayım/soru, semantic diff, replay ve
    affected-scope/conflict/impact preview doğrulaması; ambiguity/partial sonuç fail-closed.
  - [ ] Gerçek normalization/application servisi; diff ve impact'in authoritative resolver/
    ledger/dependency reader'dan hesaplanması, persistence/API/UI ve insan onaylı kabul.
- [ ] Precedence/inheritance/suppression/PARKED_CONFLICT resolver.
  - [x] MASTER dokuz kademe sırası, scope specificity/newer publication, exception,
    lossless suppression trace ve eşitlikte `PARKED_CONFLICT` saf resolver matrisi.
  - [x] Exact policy lifecycle, frozen CategoryProfile ref/version/hash ve reviewed objective
    mapping kanıtını doğrulayan authority-free composition contract'ı; production binding'i
    olmadığını `productionAuthoritySourceBound=false` ile açık tutar.
  - [ ] Persisted tenant-bound authority-tier/decision/manual-lock loader ve frozen analysis composition.
- [ ] Versioned draft/publish/pause/archive ve rol/audit API'leri.
  - [x] Guidance için immutable draft/revise/publish/archive, optimistic registry hash,
    analyst draft + owner/admin publish/archive ve mutation+audit tek transaction.
  - [x] Publish/archive ile eski guidance registry version'lı frozen context'lere atomik,
    append-only workspace invalidation; draft/revise invalidation üretmez.
  - [x] Strict policy raw provenance + normalized append-only revision; analyst draft/revise,
    owner/admin publish/pause/archive, registry+version+hash OCC, history/diff, audit ve exact
    `instruction_policy` frozen-context invalidation binding'i.
  - [x] Strict policy Studio raw+normalized filtreleri, history/diff ve role-aware
    draft/revise/publish/pause/archive kontrolleri; impact reader yoksa fail-closed görünüm.
  - [x] Persisted exception/context/budget/analysis/schedule/ledger/action dependency reader;
    deterministic impact hash, transaction-içi OCC recheck, audit/invalidation atomikliği ve
    incomplete coverage'da publish/pause/archive fail-closed Studio akışı.
  - [ ] Trusted authority catalog, manual policy lock, account-group/topic ve opaque action-policy
    context ailelerinin authoritative binding'i; canlı PostgreSQL verifier ve gerçek oturum kabulü.
- [ ] Başlangıç objective/internal kategori playbook seti.
  - [x] Altı canonical objective playbook'una version/hash ile bağlı, review-required ve
    authority-free starter category/profile proposal kataloğu.
  - [x] MASTER'daki 14 canonical dimension için registry-hash bağlı deterministic tenant preview;
    owner/admin exact confirmation, strict browser parser ve atomik capability yoksa zero-write
    replay blocker'ı.
  - [ ] Atomik category+CategoryProfile batch persistence, authoritative profile inventory ve
    bağlı PostgreSQL/gerçek session adoption kabulü.
- [ ] Kategori coverage/unmatched/conflict/impact dashboard ve güvenli archive akışı.
  - [x] Rules fixture kaldırıldı; gerçek Guidance Studio loading/empty/conflict/error,
    create/revise/publish/archive ve aktif iç kategori selector yüzeyi.
  - [x] Ayrı `category_registry:read` yetkili, public-safe aktif dimension/definition kataloğu;
    campaign/ad set/ad/creative doğrudan assignment coverage, unmatched, manual-lock ve
    registry-health görünümü. Sıfır payda “veri yok”, kaybolmuş Meta hedefleri kapsam dışı;
    dashboard ve canlı PostgreSQL verifier aynı read model'i kullanır.
  - [x] Raw evidence ref göstermeyen evidence-kind/count/observed-at sağlık özeti; minimum/
    ortalama confidence ve sürümlü `%70` `review_signal_only` düşük güven görünümü.
  - [x] Resolver algoritmasını kopyalamayan structured `applied/unmatched/parked_conflict`
    inspector ve stable conflict reason kodları; dependency güven sınıflı, archive authority
    her zaman kapalı salt-okur dimension/definition archive-impact önizlemesi.
  - [x] Canlı hierarchy path'leri üzerinden bounded portföy çapında effective single-dimension
    conflict taraması; creative reuse path-bazlı, 20.000 yol/100 boyut hard cap ve fail-closed sonuç.
  - [ ] Archive preview dependency coverage'ini tamamlayıp güvenli mutation guard'ına bağlama.
    - [x] Sürümlü JSONB dependency manifest'i, `pg_catalog` drift kontrolü, canonical+legacy
      category ref lineage'ı, promotion/practice/budget geçmişi, conservative non-terminal
      action blocker'ı ve deterministic impact hash kod+contract testlerinde tamamlandı.
    - [ ] Bağlı PostgreSQL üzerinde tam coverage/integrity ve gerçek dependency fixture kabulü;
      yerel `.env.local`/DB bağlantısı bulunmadığı için verifier çalıştırılamıyor.
  - [ ] Rol/audit/optimistic concurrency/context invalidation bağlı category authoring/archive akışı.
    - [x] Dimension/definition create/revise/archive; owner/admin publish yetkisi, analyst/viewer
      negatifleri, registry+version+impact hash guard'ı, atomik audit ve append-only
      `category_resolution` invalidation kod+HTTP+UI testlerinde bağlı. Assignment/mapping
      mutation authority bu dilimde yapısal olarak kapalı.
    - [ ] Canlı PostgreSQL rollback/concurrency verifier ve oturumlu browser create→revise→
      preview→archive kabulü; yerel `.env.local`/DB/session binding'i bulunmadığı için açık.
- [ ] PromotionTemplate + immutable AudiencePresetVersion, selector/alias ve publish dry-run.
  - [x] Objective/optimization, actor/destination, placement, naming/tracking, reuse policy,
    budget/timeframe ve immutable preset ref sözleşmesi ile fail-closed preflight çekirdeği.
  - [x] Account, Page/Instagram, internal category, post/media ve alias/talimat bağlı saf
    deterministic selector; belirsizlikte publish-ready değil, targeting/creative icat etmez.
  - [x] Tenant-bound published-catalog Drizzle adapterı, cookie-only same-origin read/dry-run
    API'si ve role-aware kullanıcı UI'si; hesap/actor/category yalnız sunucuda çözülür.
  - [x] Ayrı reusable AudiencePreset ve mutable PromotionTemplate draft/revise/publish/archive
    lifecycle'ı; analyst draft, owner/admin publish, workspace-lock membership recheck,
    registry/resource OCC, audit, immutable registry materialization ve multi-version context
    invalidation aynı transaction'da.
  - [x] Dedicated local lifecycle read/draft/publish capability+intent sınırı; archived template'i
    selector/existing-post catalog/preflight/canonical resolver'dan düşüren, draft sırasında son
    yayını koruyan effective-event filtresi ve bounded fail-closed UI.
  - [ ] Forward migration, lifecycle rollback verifier ve gerçek oturumlu browser happy-path kabulü;
    yerel PostgreSQL/session bağlantısı bulunmadığı için açık.
- [ ] GuidanceSource/Card/Set/Binding ve global/group/objective/category/entity/topic scope matrisi.
  - [x] Guidance-only pure registry/pack; provenance ayrımı, deterministic scope/conflict,
    freshness ve bounded context budget.
  - [x] Append-only PostgreSQL registry, version/hash guard, tenant isolation ve RLS.
  - [x] Global/account/objective/internal-category/entity/topic tek-binding authoring,
    public-safe kararlı category ref ve rol/audit API'si.
  - [x] Codex/Claude salt-okur guidance registry ve explicit account/category/entity/topic/
    timeframe bağlamlı deterministic effective-pack preview araçları.
  - [x] Tek guidance card için en fazla 12 çoklu facet binding authoring; farklı facet'ler
    AND, aynı facet alternatifleri OR çözülür ve Studio'da birlikte görünür.
  - [x] Guidance set draft/revise/review/archive authoring; ordered published-card refs,
    registry+version OCC, append-only history, audit+context invalidation ve role-aware UI.
  - [x] Account-group/funnel/optimization/lifecycle/promotion-template dahil 11-facet registry,
    agent contract 1.1 ve exact evaluated set/card/source revision-hash manifestli immutable
    analysis-run binding'i; bounded/no-truncation ve append-only DB guard'ları.
  - [ ] Yeni facet preview scope'larının tenant-bound authoritative kataloglardan sunucuda
    çözülmesi ile bağlı PostgreSQL/gerçek session acceptance.
- [ ] Owner statement + official Meta source + experiment/observation provenance ve freshness.
  - [x] Altı provenance türü, official source publish gate'i, review-by/freshness suppression ve
    frozen geçmiş bağlamı.
  - [x] Owner dışındaki beş source türü için bounded kullanıcı authoring, çoklu-source lossless
    Studio projection ve exact revision/hash analysis-run binding'i.
  - [ ] Bağlı PostgreSQL ve gerçek oturumlu source authoring/run-binding acceptance.
- [ ] G0→G4 progressive formalization, semantic diff, historical replay ve impact preview.
  - [x] Append-only hash-chainli saf maturity/transition contract; G2→G3 ve G3→G4 explicit
    owner/admin confirmation, fail-closed ambiguity ve A13 valve-ref-only G4 sınırı.
  - [ ] Gerçek artifact üretimi, persistence/API/UI, authoritative replay/impact ve browser kabulü.
- [ ] AdvisedPractice candidate→trial→outcome→standardization lifecycle.
  - [x] Candidate/review/trial/outcome ve ayrı StandardizationReview decomposition çekirdeği.
  - [x] `validated|conditional → standardization_reviewed → standardization_candidate →
    standardized|retired`; analyst proposal, yalnız owner/admin explicit human confirmation,
    additive DB migration, OCC/audit API ve Practice Lab UI.
  - [ ] Bağlı PostgreSQL outer-rollback/RLS verifier ve gerçek oturumlu browser acceptance;
    yerel DB/session bulunmadığı için açık.
- [x] StandardizationReview feature/agenda/playbook/cadence/guidance/policy/human-judgment decomposition.

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
- [x] LocalAgentClient/session contract ve modelsiz deterministic fixture client; 15 safe read/draft/preflight
  tool'u exact local-session scope'a bağlı, correlation replay/cross-session ve authority/raw/tool injection fail-closed.
- [x] No-model-API boundary: runtime source, package scripts ve direct/transitive dependency yüzeyinde
  OpenAI/Anthropic key, SDK veya doğrudan model endpoint'i fail-closed CI checker + negatif fixture matrisiyle yasak.
- [ ] Localhost Streamable HTTP + project STDIO MCP; auth ve read/proposal tool ayrımı.
  - [x] Project STDIO MCP v2 server; 3 coordination + exact 15 safe read/draft/preflight tool,
    OS-UID capability, whitelist env loader, strict Zod schema ve stdout-protocol sınırı.
  - [ ] Localhost Streamable HTTP MCP transport; mevcut localhost REST application API bunun yerine geçmez.
- [x] Codex CLI/VS Code + Claude Code MCP conformance; project config/server discovery,
  exact tool kataloğu ve canlı STDIO protokol kabulü; raw writer/human grant expose edilmez.
- [ ] Session register/heartbeat, dashboard context handoff ve proposal correlation.
  - [x] Verified local capability + exact descriptor bağlı application lifecycle çekirdeği; server-clock heartbeat,
    same-user/workspace + intent-tool bağlı 15–120 sn ref-only handoff ve atomik single-use consume.
  - [x] PostgreSQL durable repository + migration; active-workspace register kilidi, restart-durable session/handoff,
    atomik single-use consume, workspace tombstone purge ve rollback kabulü.
  - [x] Authenticated local HTTP coordination: cookie-only dashboard list/create, bearer-only CLI
    register/heartbeat/consume, canlı session seçimi ve dashboard handoff UI; PostgreSQL HTTP kabulü.
  - [x] Gerçek Codex/Claude MCP/STDIO adapter konfigürasyonu ve CLI içinden handoff consume E2E;
    dashboard discovery, single-use consume ve replay reddi canlı PostgreSQL/HTTP zincirinde doğrulandı.
- [ ] Local `reklamzeka` companion ile TTY/passkey HumanPresenceGrant ve ayrı approve/execute.
- [ ] MCP-capable CLI config ve güvenli allowlist LocalCliAdapter extension point.
  - [x] Codex `.codex/config.toml` ve Claude `.mcp.json`/project permission config; secret-free exact allowlist,
    yalnız koordinasyon/read otomatik, mark-read ve persisted draft kullanıcı etkileşimli.
  - [ ] MCP'siz istemciler için allowlist binary/arg/cwd lifecycle adapter'ı.
- [ ] Kritik guidance interview, owner+Meta best-practice+evidence karşılaştırması ve eval seti.
- [ ] Guidance retrieval/context tools ve source/freshness/best-practice claim guard.
  - [x] Preserved owner statement/source/scope/freshness içeren registry read ve deterministic
    effective-pack preview; agent authority bütünüyle kapalı.
  - [ ] Official Meta source claim guard, semantic retrieval/ranking ve analysis-run binding.
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
  - [x] Guidance Studio eksik/expired dashboard capability'yi DB arızasından ayırır; 401
    `local_session_required` ile Decision Room tek-kullanımlık bootstrap yüzeyine yönlendirir.
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
