import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { buildEffectiveCampaignContext } from "@/analyses/effective-campaign-context";
import type { EffectiveAnalysisContextReadySource } from "@/application/effective-analysis-context-composer";
import { DrizzleCurrentEffectiveAnalysisContextSourceReader } from "@/connectors/analyses/current-effective-analysis-context-source-drizzle-reader";
import { DrizzleEffectiveCampaignContextRepository } from "@/connectors/analyses/effective-campaign-context-drizzle-repository";
import { sourceComponentsOf } from "@/connectors/analyses/effective-campaign-context-drizzle-repository";
import { bindCategoryProfiles, createCategoryProfile } from "@/domain/categories/category-profile";
import { categoryDefinitionPublicRef } from "@/domain/categories/public-reference";
import { resolveEffectiveCategory, type CategoryDefinition, type CategoryDimension } from "@/domain/categories/registry";
import { buildEffectiveGuidancePack, createGuidanceRegistry } from "@/domain/guidance/registry";
import { META_ANALYSIS_CONFIG_SNAPSHOT_VERSION, normalizeMetaAnalysisConfigSnapshotV2 } from "@/domain/meta/analysis-config-projection";
import { DECISION_CADENCE_VERSION, type DecisionCadenceProfile } from "@/domain/decisions/cadence";
import * as schema from "@/db/schema";
import { createDrizzleEffectiveAnalysisContextComposer } from "@/server/effective-analysis-context-composer-runtime";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const connectionString = process.env.DIRECT_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!connectionString) {
  process.stderr.write(`${JSON.stringify({ ok: false, blocker: "postgres_connection_not_configured",
    requiredOneOf: ["DIRECT_DATABASE_URL", "DATABASE_URL"], continuation: "npm run verify:ready-effective-analysis-context-root-db" })}\n`);
  process.exit(2);
}

const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 20_000 });
const database = drizzle(pool, { schema });
const rollback = Symbol("ready-root-outer-rollback");
const workspaceId = randomUUID();
const foreignWorkspaceId = randomUUID();
const connectionId = randomUUID();
const sourceId = randomUUID();
const accountId = randomUUID();
const campaignId = randomUUID();
const cadenceId = randomUUID();
const capturedAt = "2026-08-10T15:00:00.000Z";
const request = Object.freeze({ workspaceId, accountRef: "account_ready_root", entityType: "campaign" as const,
  entityRef: "campaign_ready_root" });
const snapshotRef = "snapshot_aaaaaaaaaaaaaaaaaaaa";
const cadence: DecisionCadenceProfile = Object.freeze({ version: DECISION_CADENCE_VERSION, settleHours: 24,
  minimumObservationHours: 12, minimumLearningHours: 24, cooldownHours: 24, repeatSuppressionHours: 24,
  frequencyWindowHours: 168, maxDecisionsPerWindow: 3, maxActionsPerWindow: 1, maximumHistoryEntries: 20,
  minimumEvidenceCount: 2, minimumEvidenceScore: 0.8 });
const cadenceHash = createHash("sha256").update(JSON.stringify(Object.fromEntries(
  Object.entries(cadence).sort(([left], [right]) => left.localeCompare(right)),
))).digest("hex");

function readySource(): EffectiveAnalysisContextReadySource {
  const dimension: CategoryDimension = { id: "dimension_ready", workspaceId, key: "service", version: 1,
    cardinality: "single", allowedEntityLevels: ["campaign"], archivedAt: null };
  const definition: CategoryDefinition = { id: "definition_ready", workspaceId, dimensionId: dimension.id,
    key: "lead", label: "Lead", version: 1, archivedAt: null };
  const frozen = bindCategoryProfiles(resolveEffectiveCategory({ dimension, definitions: [definition], path: { workspaceId,
    nodes: [{ level: "campaign", id: request.entityRef }] }, assignments: [{ id: "assignment_ready", workspaceId,
    dimensionId: dimension.id, definitionId: definition.id, entity: { level: "campaign", id: request.entityRef },
    operation: "add", source: "manual", manualLock: false, evidence: [{ kind: "owner", ref: "owner_ready" }],
    confidence: 1, version: 1, archivedAt: null }] }).frozenContext, [createCategoryProfile({
    workspaceRef: "workspace_ready_root", profileRef: "category_profile_ready", categoryRef: categoryDefinitionPublicRef("service", "lead"),
    parentCategoryRef: null, label: "Lead", description: "Ready root verifier", color: "#A31F34", ownerRef: "actor_ready",
    status: "active", bindings: { analysisPlaybookRefs: ["analysis_playbook_ready"], ruleInstructionBundleRefs: [],
      budgetPolicyRefs: [], transferPolicyRefs: [], schedulePolicyRefs: [], actionPolicyRefs: [], creativePolicyRefs: [] },
  })]);
  const guidance = buildEffectiveGuidancePack(createGuidanceRegistry({ workspaceId, sources: [{ id: "source_ready", workspaceId,
    sourceType: "owner_statement", title: "Owner", sourceRef: "owner:ready", sourceUrl: null, content: "Protect quality",
    author: "owner", capturedAt: "2026-08-01T00:00:00.000Z", reviewedAt: "2026-08-02T00:00:00.000Z", reviewBy: null,
    status: "published", version: 1 }], cards: [{ id: "card_ready", workspaceId, sourceType: "owner_statement",
    sourceIds: ["source_ready"], title: "Quality", body: "Protect lead quality", rationale: null, strength: "must", topic: "quality",
    decisionKey: null, positionKey: null, authority: "guidance_only", status: "published", effectiveFrom: null,
    effectiveTo: null, ownerRef: "owner_ready", version: 1 }], sets: [], bindings: [{ id: "binding_ready", workspaceId,
    cardId: "card_ready", facet: "global", value: null, entityType: null, mode: "default", priority: 1, version: 1 }],
  }), { workspaceId, accountId: request.accountRef, objective: "lead_generation", internalCategoryIds: ["definition_ready"],
    entity: { type: "campaign", id: request.entityRef }, topics: ["quality"], requiredTopics: ["quality"], evaluatedAt: capturedAt,
    budget: { maxCards: 10, maxSources: 10, maxCharacters: 10_000 } });
  const facts = Object.freeze({ identity: { connectionRef: "connection_ready", campaignRef: request.entityRef,
    hierarchyRefs: [request.entityRef] }, meta: { configuredStatus: { state: "unknown" as const, reason: "not_observed" },
    effectiveStatus: { state: "unknown" as const, reason: "not_observed" }, budgetOwnerRef: { state: "unknown" as const, reason: "not_observed" },
    targetingSignature: { state: "unknown" as const, reason: "not_observed" }, actorRef: { state: "unknown" as const, reason: "not_observed" },
    destinationRef: { state: "unknown" as const, reason: "not_observed" } }, metaAnalysisConfigSnapshot: normalizeMetaAnalysisConfigSnapshotV2({
    version: META_ANALYSIS_CONFIG_SNAPSHOT_VERSION, workspaceId, externalAccountId: request.accountRef, capturedAt,
    campaigns: [{ externalCampaignId: request.entityRef, objective: { state: "known", value: "OUTCOME_LEADS" } }], adSets: [] }), guidance,
    cadence: { profileRef: "cadence_ready", decision: "observe" as const, reason: "stable", cooldownUntil: null },
    cadenceEvidence: { profileRevision: 1, profileVersion: DECISION_CADENCE_VERSION, profileHash: cadenceHash },
    data: { trustStatus: "not_ready" as const, snapshotRefs: [snapshotRef], featureRefs: [], windowRefs: [], blockers: ["analysis_window_not_bound"] },
    history: { changeRefs: [], decisionRefs: [], experimentRefs: [], practiceRefs: [], outcomeRefs: [] },
    versions: { metaCatalog: META_ANALYSIS_CONFIG_SNAPSHOT_VERSION, categoryResolver: "category-profile/1.0.0",
      guidanceRegistry: guidance.registryHash, metricCatalog: "metric_catalog", formulaCatalog: "formula_catalog",
      timeframeResolver: "timeframe_resolver", promotionRegistry: "b".repeat(64) }, });
  const authority = { compose(base: Parameters<typeof buildEffectiveCampaignContext>[0]) {
    const context = buildEffectiveCampaignContext({ ...base, versions: { ...base.versions, instructionPolicyRegistry: "c".repeat(64),
      policyAuthority: "d".repeat(64) }, policyAuthorityEvidence: { snapshotRef: "authority_snapshot_ready", snapshotHash: "e".repeat(64),
      catalogHash: "f".repeat(64), scopeHash: "1".repeat(64), accountGroupBindingHashes: [], topicBindingHashes: [],
      manualLockBindingHashes: [], semanticBindingHashes: [] } });
    return { context, validationBoundary: { contractIntegrity: "self_hash_validated" as const, productionAuthoritySourceBound: true as const },
      authority: { canExecute: false as const, canWriteMeta: false as const, canApprove: false as const, canSchedule: false as const,
        canCallTool: false as const, canAccessNetwork: false as const, canQuerySql: false as const } };
  } };
  return Object.freeze({ status: "ready", capturedAt, facts, categories: { workspaceId, dimensions: [{ frozenContext: frozen }] },
    lifecycle: { registryHash: "c".repeat(64), current: [], history: [], diffs: [] }, authority });
}

/**
 * This is deliberately a component-live smoke verifier, not the closed-world
 * current-source acceptance test. The latter needs a much larger relational
 * fixture than the root persistence boundary: canonical Meta hierarchy/config,
 * category profile/assignment, reviewed guidance set/card/source plus campaign
 * selection, instruction-policy lifecycle, authority catalog/snapshot/bindings,
 * account-group/topic/manual-lock/semantic bindings, promotion registry, and
 * cadence. The current-source reader owns those exact reads and has focused
 * unit/component-live verifiers; this script proves the concrete server root's
 * writer path against PostgreSQL without pretending to seed that entire graph.
 */
let originalLoad: typeof DrizzleCurrentEffectiveAnalysisContextSourceReader.prototype.loadCurrent | undefined;
let fetchCalls = 0; let saved = false; let invalidatedReplayBlocked = false; let tenantMismatchBlocked = false; let rolledBack = false;
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = (async () => { fetchCalls += 1; throw new Error("network_not_allowed"); }) as typeof fetch;
  originalLoad = DrizzleCurrentEffectiveAnalysisContextSourceReader.prototype.loadCurrent;
  DrizzleCurrentEffectiveAnalysisContextSourceReader.prototype.loadCurrent = async (input) => {
    if (input.workspaceId !== workspaceId || input.accountRef !== request.accountRef || input.entityRef !== request.entityRef
      || input.entityType !== "campaign") throw new Error("scope_not_found");
    return readySource();
  };
  await database.transaction(async (transaction) => {
    await transaction.insert(schema.workspaces).values([{ id: workspaceId, name: "Ready root verifier" },
      { id: foreignWorkspaceId, name: "Ready root foreign" }]);
    await transaction.insert(schema.metaConnections).values({ id: connectionId, workspaceId, externalConnectionKey: "connection_ready",
      displayName: "Ready", graphApiVersion: "v1", fieldCatalogVersion: "fields-v1", status: "active" });
    await transaction.insert(schema.dataSources).values({ id: sourceId, workspaceId, metaConnectionId: connectionId, platform: "meta_ads",
      externalAccountId: request.accountRef, displayName: "Ready account" });
    await transaction.insert(schema.adAccounts).values({ id: accountId, workspaceId, dataSourceId: sourceId, externalAccountId: request.accountRef,
      name: "Ready", currency: "TRY", timezone: "Europe/Istanbul" });
    await transaction.insert(schema.adCampaigns).values({ id: campaignId, workspaceId, adAccountId: accountId,
      externalCampaignId: request.entityRef, name: "Ready campaign" });
    await transaction.insert(schema.metaChangeSnapshots).values({ id: randomUUID(), workspaceId, metaConnectionId: connectionId,
      adAccountId: accountId, publicRef: snapshotRef, snapshotHash: "a".repeat(64), schemaVersion: 1, fieldCatalogVersion: "fields-v1",
      capturedAt: new Date("2026-08-10T14:59:00.000Z"), canonicalPayload: {}, safeAggregate: { entityCounts: { campaign: 1, adSet: 0, ad: 0 }, knownFieldCount: 0, unknownFieldCount: 0 } });
    await transaction.insert(schema.decisionCadenceProfileRevisions).values({ id: cadenceId, workspaceId, adAccountId: accountId,
      campaignId, profileRef: "cadence_ready", revision: 1, profileVersion: DECISION_CADENCE_VERSION, profileHash: cadenceHash,
      profilePayload: cadence });

    const composer = createDrizzleEffectiveAnalysisContextComposer({ database: transaction as never });
    const result = await composer.composeAndSave(request);
    saved = result.outcome === "inserted" && result.context.data.trustStatus === "not_ready"
      && JSON.stringify(result.context.data.blockers) === JSON.stringify(["analysis_window_not_bound"])
      && result.context.policyAuthorityEvidence !== undefined
      && Object.values(result.context.capabilities).every((capability) => capability === false);
    const writer = new DrizzleEffectiveCampaignContextRepository(transaction as never);
    const sourceSnapshot = sourceComponentsOf(result.context).find((entry) => entry.componentType === "source_snapshot");
    if (!sourceSnapshot) throw new Error("source_snapshot_component_missing");
    await writer.invalidate({ workspaceId, ...sourceSnapshot, scope: { kind: "exact_entity_component", entityType: "campaign",
      entityRef: request.entityRef }, reasonCode: "source_changed", observedAt: "2026-08-10T15:01:00.000Z" });
    invalidatedReplayBlocked = await composer.composeAndSave(request).then(() => false, (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "invalidated_save");
    tenantMismatchBlocked = await composer.composeAndSave({ ...request, workspaceId: foreignWorkspaceId }).then(() => false,
      () => true);
    if (!saved || !invalidatedReplayBlocked || !tenantMismatchBlocked || fetchCalls !== 0) throw new Error("ready_root_assertion_failed");
    throw rollback;
  });
} catch (error) {
  if (error !== rollback) throw error;
  rolledBack = true;
} finally {
  if (originalLoad) DrizzleCurrentEffectiveAnalysisContextSourceReader.prototype.loadCurrent = originalLoad;
  globalThis.fetch = originalFetch;
}
const survivors = await database.execute(sql`select count(*)::int as count from workspaces where id = ${workspaceId}::uuid`);
await pool.end();
if (!rolledBack || Number(survivors.rows[0]?.count) !== 0 || fetchCalls !== 0) throw new Error("outer_rollback_failed");
console.log(JSON.stringify({ ok: true, scope: "component_live_smoke_not_closed_world_source_acceptance",
  rootComposerPersisted: saved, dataNotReadyExact: true, productionAuthoritySourceBound: true,
  allCapabilitiesFalse: true, invalidatedReplayBlocked, tenantMismatchBlocked, sourceReader: "scope_checked_test_bundle",
  closedWorldSourceFixtureNotSeeded: ["canonical_meta_hierarchy_config", "category_profile_assignment",
    "reviewed_guidance_set_card_source", "guidance_campaign_selection", "instruction_policy_lifecycle",
    "tenant_authority_catalog_snapshot_bindings", "account_group_topic_manual_lock_semantic_bindings",
    "promotion_registry", "decision_cadence_reader"], actionOrNetworkCalls: fetchCalls, temporaryRowsCommitted: false }));
