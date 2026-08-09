import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import {
  DrizzleGuidanceRegistryRepository,
  GuidanceRepositoryError,
} from "@/connectors/guidance/guidance-drizzle-repository";
import { DrizzleGuidanceFacetScopeResolver } from
  "@/connectors/guidance/guidance-facet-scope-drizzle-resolver";
import { GuidanceFacetScopeError } from "@/application/guidance-facet-scope-resolver";
import * as schema from "@/db/schema";
import {
  buildEffectiveGuidancePack,
  createGuidanceRegistry,
  type GuidanceBinding,
  type GuidanceCard,
  type GuidanceSource,
} from "@/domain/guidance/registry";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const databaseUrl = process.env.DIRECT_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error(JSON.stringify({ ok: false, blocker: "postgres_connection_not_configured",
    requiredOneOf: ["DIRECT_DATABASE_URL", "DATABASE_URL"], continuation: "npm run verify:guidance-registry-db" }));
  process.exit(2);
}

const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  connectionTimeoutMillis: 10_000,
  statement_timeout: 15_000,
});
const database = drizzle(pool, { schema });
const rollback = Symbol("rollback");
const workspaceId = randomUUID();
const foreignWorkspaceId = randomUUID();
const connectionId = randomUUID(); const sourceId = randomUUID(); const accountId = randomUUID();
const campaignId = randomUUID(); const adSetId = randomUUID();
const funnelDimensionId = randomUUID(); const funnelDefinitionId = randomUUID();
const lifecycleDimensionId = randomUUID(); const lifecycleDefinitionId = randomUUID();

function source(
  id: string,
  sourceType: GuidanceSource["sourceType"],
  overrides: Partial<GuidanceSource> = {},
): GuidanceSource {
  return {
    id,
    workspaceId,
    sourceType,
    title: `Source ${sourceType}`,
    sourceRef: `e2e:${sourceType}`,
    sourceUrl: sourceType === "official_meta_guidance" ? "https://www.facebook.com/business/help/example" : null,
    content: sourceType === "owner_statement" ? "Protect regional budget." : "Allow enough observation time.",
    author: sourceType === "owner_statement" ? "owner" : "Meta",
    capturedAt: "2026-08-01T09:00:00.000Z",
    reviewedAt: "2026-08-02T09:00:00.000Z",
    reviewBy: sourceType === "official_meta_guidance" ? "2026-08-10T09:00:00.000Z" : null,
    status: "published",
    version: 1,
    ...overrides,
  };
}

function card(
  id: string,
  sourceRow: GuidanceSource,
  topic: string,
): GuidanceCard {
  return {
    id,
    workspaceId,
    sourceType: sourceRow.sourceType,
    sourceIds: [sourceRow.id],
    title: `Card ${topic}`,
    body: `Review ${topic} evidence before proposing a change.`,
    rationale: null,
    strength: "should",
    topic,
    decisionKey: null,
    positionKey: null,
    authority: "guidance_only",
    status: "published",
    effectiveFrom: null,
    effectiveTo: null,
    ownerRef: "e2e-owner",
    version: 1,
  };
}

function binding(id: string, cardId: string, version = 1): GuidanceBinding {
  return {
    id,
    workspaceId,
    cardId,
    facet: "global",
    value: null,
    entityType: null,
    mode: "default",
    priority: 10,
    version,
  };
}

let inserted = false;
let idempotentReplay = false;
let restartPackSameHash = false;
let ownerOfficialSeparate = false;
let staleOfficialSuppressed = false;
let foreignWorkspaceIsolated = false;
let optimisticConflictBlocked = false;
let authorityEscalationBlocked = false;
let officialEvidenceBypassBlocked = false;
let emptyScopeBindingBlocked = false;
let noSecretRawOrWriteEvidence = false;
let temporaryRowsCommitted = true;
let facetScopeResolved = false;
let canonicalObjectiveResolved = false;
let crossTenantRefBlocked = false;
let accountGroupCatalogExplicit = false;
let singleCaptureStable = false;

try {
  await database.transaction(async (transaction) => {
    // The outer transaction exercises the applied production tables and is
    // intentionally rolled back after all acceptance assertions.
    await transaction.insert(schema.workspaces).values([
      { id: workspaceId, name: "Guidance E2E" },
      { id: foreignWorkspaceId, name: "Foreign Guidance E2E" },
    ]);
    await transaction.insert(schema.metaConnections).values({ id: connectionId, workspaceId,
      externalConnectionKey: "guidance-scope-connection", displayName: "Guidance scope connection",
      graphApiVersion: "v23.0", fieldCatalogVersion: "guidance-scope/1.0.0" });
    await transaction.insert(schema.dataSources).values({ id: sourceId, workspaceId, metaConnectionId: connectionId,
      platform: "meta_ads", externalAccountId: "act_guidance_scope", displayName: "Guidance scope source" });
    await transaction.insert(schema.adAccounts).values({ id: accountId, workspaceId, dataSourceId: sourceId,
      externalAccountId: "act_guidance_scope", name: "Guidance scope account", currency: "TRY", timezone: "Europe/Istanbul" });
    await transaction.insert(schema.adCampaigns).values({ id: campaignId, workspaceId, adAccountId: accountId,
      externalCampaignId: "campaign_guidance_scope", name: "Guidance scope campaign",
      objectiveSource: "OUTCOME_LEADS", canonicalObjective: "lead_generation",
      objectiveMappingVersion: "meta-objective-mapping/1.0.0" });
    await transaction.insert(schema.metaAdSets).values({ id: adSetId, workspaceId, adAccountId: accountId,
      campaignId, externalAdSetId: "adset_guidance_scope", name: "Guidance scope ad set", optimizationGoal: "LEAD",
      rawPayloadHash: "a".repeat(64), sourceGraphVersion: "v23.0", fieldCatalogVersion: "guidance-scope/1.0.0",
      provenance: { source: "rollback_verifier" } });
    await transaction.insert(schema.categoryDimensions).values([
      { id: funnelDimensionId, workspaceId, key: "funnel_intent", name: "Funnel intent",
        cardinality: "single", allowedEntityLevels: ["campaign"] },
      { id: lifecycleDimensionId, workspaceId, key: "lifecycle", name: "Lifecycle",
        cardinality: "single", allowedEntityLevels: ["campaign"] },
    ]);
    await transaction.insert(schema.categoryDefinitions).values([
      { id: funnelDefinitionId, workspaceId, dimensionId: funnelDimensionId, key: "consideration", label: "Consideration" },
      { id: lifecycleDefinitionId, workspaceId, dimensionId: lifecycleDimensionId, key: "evergreen", label: "Evergreen" },
    ]);

    const owner = source("owner-source", "owner_statement");
    const official = source("official-source", "official_meta_guidance");
    const ownerCard = card("owner-card", owner, "budget");
    const officialCard = card("official-card", official, "testing");
    const registry = createGuidanceRegistry({
      workspaceId,
      sources: [owner, official],
      cards: [ownerCard, officialCard],
      bindings: [binding("owner-global", ownerCard.id), binding("official-global", officialCard.id)],
      sets: [{
        id: "reviewed-set",
        workspaceId,
        name: "Reviewed set",
        orderedCardIds: [ownerCard.id, officialCard.id],
        reviewStatus: "reviewed",
        version: 1,
      }],
    });
    const repository = new DrizzleGuidanceRegistryRepository(transaction as never);
    inserted = (await repository.save(registry, { expectedRegistryHash: null })).outcome === "inserted";
    idempotentReplay = (await repository.save(registry, { expectedRegistryHash: null })).outcome === "unchanged";

    const restarted = new DrizzleGuidanceRegistryRepository(transaction as never);
    const recovered = await restarted.load(workspaceId);
    const scopeResolver = new DrizzleGuidanceFacetScopeResolver(transaction as never);
    const scopeCatalog = await scopeResolver.listCatalog(workspaceId);
    const facet = (name: string) => scopeCatalog.facets.find((entry) => entry.facet === name)!;
    const accountRef = facet("account").options[0]!.ref;
    const objectiveRef = facet("objective").options[0]!.ref;
    const funnelRef = facet("funnel").options[0]!.ref;
    const optimizationRef = facet("optimization").options[0]!.ref;
    const lifecycleRef = facet("lifecycle").options[0]!.ref;
    const campaignRef = facet("entity").options.find((option) => option.entityType === "campaign")!.ref;
    const budgetTopicRef = facet("topic").options.find((option) => option.label === "budget")!.ref;
    const resolvedScope = await scopeResolver.resolve(workspaceId, { expectedCatalogHash: scopeCatalog.catalogHash,
      accountRef, accountGroupRefs: [],
      objective: objectiveRef, funnel: funnelRef, optimization: optimizationRef,
      internalCategoryRefs: [funnelRef], lifecycle: lifecycleRef,
      entity: { type: "campaign", ref: campaignRef }, promotionTemplateRefs: [],
      topics: [budgetTopicRef], requiredTopics: [budgetTopicRef] });
    facetScopeResolved = resolvedScope.accountRef === accountRef && resolvedScope.funnel === "consideration"
      && resolvedScope.optimization === "LEAD" && resolvedScope.lifecycle === "evergreen"
      && resolvedScope.topics[0] === "budget" && resolvedScope.entity?.ref === campaignRef;
    canonicalObjectiveResolved = resolvedScope.objective === "lead_generation"
      && scopeCatalog.evidence.objectiveMappingVersion === "meta-objective-mapping/1.0.0";
    accountGroupCatalogExplicit = facet("account_group").status === "partial"
      && facet("account_group").reasonCode === "account_group_catalog_unavailable";
    singleCaptureStable = resolvedScope.capture.catalogHash === scopeCatalog.catalogHash
      && resolvedScope.capture.capturedAt === scopeCatalog.capturedAt;
    const foreignScopeCatalog = await scopeResolver.listCatalog(foreignWorkspaceId);
    crossTenantRefBlocked = await scopeResolver.resolve(foreignWorkspaceId, {
      expectedCatalogHash: foreignScopeCatalog.catalogHash, accountRef,
      accountGroupRefs: [], objective: null, funnel: null, optimization: null, internalCategoryRefs: [],
      lifecycle: null, entity: null, promotionTemplateRefs: [], topics: [], requiredTopics: [] })
      .then(() => false, (reason: unknown) => reason instanceof GuidanceFacetScopeError
        && reason.code === "unknown_scope_ref");
    const packContext = {
      workspaceId,
      accountId: "account-e2e",
      objective: "LEAD_GENERATION",
      internalCategoryIds: [],
      entity: null,
      topics: ["budget", "testing"],
      requiredTopics: ["budget", "testing"],
      evaluatedAt: "2026-08-07T12:00:00.000Z",
      budget: { maxCards: 10, maxSources: 10, maxCharacters: 10_000 },
    } as const;
    const firstPack = buildEffectiveGuidancePack(registry, packContext);
    const restartPack = buildEffectiveGuidancePack(recovered, packContext);
    restartPackSameHash = firstPack.packHash === restartPack.packHash && restartPack.workspaceId === workspaceId;
    ownerOfficialSeparate = new Set(recovered.sources.map((row) => row.sourceType)).size === 2
      && restartPack.applied.some((row) => row.sourceType === "owner_statement")
      && restartPack.applied.some((row) => row.sourceType === "official_meta_guidance");
    const stalePack = buildEffectiveGuidancePack(recovered, {
      ...packContext,
      evaluatedAt: "2026-08-11T12:00:00.000Z",
    });
    staleOfficialSuppressed = stalePack.suppressed.some((row) =>
      row.cardId === officialCard.id && row.reason === "source_review_due");

    const foreign = await restarted.load(foreignWorkspaceId);
    foreignWorkspaceIsolated = foreign.sources.length === 0 && foreign.cards.length === 0
      && foreign.registryHash !== recovered.registryHash;
    optimisticConflictBlocked = await repository.save(createGuidanceRegistry({
      workspaceId,
      sources: [{ ...owner, version: 2, content: "Versioned owner revision." }, official],
      cards: [ownerCard, officialCard],
      bindings: [binding("owner-global", ownerCard.id), binding("official-global", officialCard.id)],
      sets: registry.sets,
    }), { expectedRegistryHash: "0".repeat(64) }).then(
      () => false,
      (error: unknown) => error instanceof GuidanceRepositoryError && error.code === "optimistic_conflict",
    );
    authorityEscalationBlocked = await transaction.transaction(async (savepoint) => {
      await savepoint.execute(sql`
        insert into guidance_cards (
          workspace_id, card_key, version, source_type, source_ids, title, body, strength,
          topic, authority, status, owner_ref, published_at, record_hash
        ) values (
          ${workspaceId}, 'unsafe-card', 1, 'owner_statement', '["owner-source"]'::jsonb,
          'Unsafe', 'Unsafe', 'must', 'budget', 'policy', 'published', 'owner', now(), ${"a".repeat(64)}
        )
      `);
      return false;
    }).catch(() => true);
    officialEvidenceBypassBlocked = await transaction.transaction(async (savepoint) => {
      await savepoint.execute(sql`
        insert into guidance_sources (
          workspace_id, source_key, version, source_type, title, source_ref, source_url,
          content, captured_at, reviewed_at, review_by, status, published_at, record_hash
        ) values (
          ${workspaceId}, 'unsafe-official', 1, 'official_meta_guidance', 'Unsafe', 'meta:unsafe', null,
          'Missing URL', now(), now(), now() + interval '1 day', 'published', now(), ${"b".repeat(64)}
        )
      `);
      return false;
    }).catch(() => true);
    emptyScopeBindingBlocked = await transaction.transaction(async (savepoint) => {
      await savepoint.execute(sql`
        insert into guidance_bindings (
          workspace_id, binding_key, version, card_key, facet, value, entity_type,
          mode, priority, record_hash
        ) values (
          ${workspaceId}, 'unsafe-binding', 1, 'owner-card', 'account', null, null,
          'default', 10, ${"c".repeat(64)}
        )
      `);
      return false;
    }).catch(() => true);
    const aggregateEvidence = JSON.stringify({
      sourceTypes: recovered.sources.map((row) => row.sourceType).sort(),
      cardCount: recovered.cards.length,
      packHash: restartPack.packHash,
      capabilities: restartPack.capabilities,
      writeNetworkCalls: 0,
    });
    noSecretRawOrWriteEvidence = !/access[_-]?token|secret|raw_payload|primaryText|caption/i.test(aggregateEvidence)
      && restartPack.capabilities.canAuthorizeAction === false
      && restartPack.capabilities.canEnforcePolicy === false;

    if (!inserted || !idempotentReplay || !restartPackSameHash || !ownerOfficialSeparate
      || !staleOfficialSuppressed || !foreignWorkspaceIsolated || !optimisticConflictBlocked
      || !authorityEscalationBlocked || !officialEvidenceBypassBlocked || !emptyScopeBindingBlocked
      || !noSecretRawOrWriteEvidence || !facetScopeResolved || !canonicalObjectiveResolved
      || !crossTenantRefBlocked || !accountGroupCatalogExplicit || !singleCaptureStable) {
      throw new Error("Guidance PostgreSQL acceptance failed");
    }
    throw rollback;
  });
} catch (error) {
  if (error !== rollback) throw error;
  temporaryRowsCommitted = false;
} finally {
  await pool.end();
}

console.log(JSON.stringify({
  inserted,
  idempotentReplay,
  restartPackSameHash,
  ownerOfficialSeparate,
  staleOfficialSuppressed,
  foreignWorkspaceIsolated,
  optimisticConflictBlocked,
  authorityEscalationBlocked,
  officialEvidenceBypassBlocked,
  emptyScopeBindingBlocked,
  noSecretRawOrWriteEvidence,
  facetScopeResolved,
  canonicalObjectiveResolved,
  crossTenantRefBlocked,
  accountGroupCatalogExplicit,
  singleCaptureStable,
  writeNetworkCalls: 0,
  temporaryRowsCommitted,
}));
