import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { DrizzleCurrentEffectiveAnalysisContextSourceReader } from "@/connectors/analyses/current-effective-analysis-context-source-drizzle-reader";
import { DrizzleCategoryAuthoringRepository } from "@/connectors/categories/category-authoring-drizzle-repository";
import { DrizzleCategoryProfileLifecycleRepository } from "@/connectors/categories/category-profile-lifecycle-drizzle-repository";
import { DrizzleDecisionCadenceProfileRepository } from "@/connectors/decisions/decision-cadence-profile-drizzle-repository";
import { DrizzleGuidanceCampaignSelectionRepository } from "@/connectors/guidance/guidance-campaign-selection-drizzle-repository";
import { DrizzleGuidanceRegistryRepository } from "@/connectors/guidance/guidance-drizzle-repository";
import { CurrentReviewedGuidanceReader } from "@/connectors/guidance/current-reviewed-guidance-reader";
import { DrizzlePolicyAuthorityCatalogMaterializerRepository } from "@/connectors/policies/policy-authority-catalog-materializer-drizzle-repository";
import { DrizzleEffectiveCampaignContextRepository } from "@/connectors/analyses/effective-campaign-context-drizzle-repository";
import { DrizzleWorkspaceTombstonePurgePort } from "@/connectors/meta/workspace-tombstone-purge-drizzle-adapter";
import { DrizzleWorkspaceTombstoneStore, WorkspaceTombstoneService } from "@/connectors/meta/workspace-tombstone-drizzle-service";
import { createDrizzleEffectiveAnalysisContextComposer } from "@/server/effective-analysis-context-composer-runtime";
import { EffectiveAnalysisContextComposerError } from "@/application/effective-analysis-context-composer";
import { projectMetaAnalysisConfig } from "@/domain/meta/analysis-config-projection";
import { createTrustedPolicyCatalog, createPolicyScopeSnapshot } from "@/application/trusted-policy-composition";
import { categoryDefinitionPublicRef, categoryDimensionPublicRef, categoryEntityPublicRef } from "@/domain/categories/public-reference";
import { createGuidanceRegistry } from "@/domain/guidance/registry";
import { normalizeMetaChangeSnapshot } from "@/domain/meta/snapshot-diff";
import { DECISION_CADENCE_VERSION, type DecisionCadenceProfile } from "@/domain/decisions/cadence";
import * as schema from "@/db/schema";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const connectionString = process.env.DIRECT_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!connectionString) {
  process.stderr.write(`${JSON.stringify({ ok: false, blocker: "postgres_connection_not_configured",
    requiredOneOf: ["DIRECT_DATABASE_URL", "DATABASE_URL"], continuation: "npm run verify:current-effective-analysis-context-source-db" })}\n`);
  process.exit(2);
}

const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 20_000 });
const database = drizzle(pool, { schema });
const fixtureResidue = rows(await database.execute(sql`
  select count(*)::int as count from workspaces
  where lifecycle_state = 'active' and name in ('Current source verifier', 'Current source foreign')
`))[0]?.count;
if (Number(fixtureResidue ?? -1) !== 0) {
  await pool.end();
  process.stderr.write(`${JSON.stringify({ ok: false, blocker: "ephemeral_current_source_fixture_residue_detected",
    activeFixtureCount: Number(fixtureResidue ?? -1), continuation: "ALLOW_EPHEMERAL_CURRENT_SOURCE_FIXTURE_RECOVERY=1 npm run recover:current-effective-analysis-context-source-fixtures-db" })}\n`);
  process.exit(2);
}
const cleanupPrerequisite = rows(await database.execute(sql`
  select to_regclass('public.action_execution_attempts')::text as action_execution_attempts
`))[0]?.action_execution_attempts;
if (cleanupPrerequisite !== "action_execution_attempts") {
  await pool.end();
  process.stderr.write(`${JSON.stringify({ ok: false, blocker: "workspace_tombstone_purge_schema_not_migrated",
    requiredTable: "action_execution_attempts", continuation: "apply pending forward migrations, then rerun npm run verify:current-effective-analysis-context-source-db" })}\n`);
  process.exit(2);
}
const workspaceId = randomUUID(); const foreignWorkspaceId = randomUUID(); const actorId = randomUUID();
const connectionId = randomUUID(); const sourceId = randomUUID(); const accountId = randomUUID(); const campaignId = randomUUID();
const suffix = workspaceId.replaceAll("-", "").slice(0, 12);
const workspaceRef = `workspace_current_${suffix}`; const actorRef = `actor_current_${suffix}`;
const accountRef = `account_current_${suffix}`; const campaignRef = `campaign_current_${suffix}`;
const request = Object.freeze({ workspaceId, accountRef, entityType: "campaign" as const, entityRef: campaignRef });
const occurredAt = new Date(Date.now() - 120_000).toISOString();
const snapshotAt = new Date(Date.parse(occurredAt) - 60_000).toISOString();
const expiresAt = new Date(Date.parse(occurredAt) + 86_400_000).toISOString();
const snapshotRef = `snapshot_${suffix}00000000`;
const cadence: DecisionCadenceProfile = Object.freeze({ version: DECISION_CADENCE_VERSION, settleHours: 0,
  minimumObservationHours: 0, minimumLearningHours: 0, cooldownHours: 0, repeatSuppressionHours: 0,
  frequencyWindowHours: 24, maxDecisionsPerWindow: 3, maxActionsPerWindow: 1, maximumHistoryEntries: 20,
  minimumEvidenceCount: 1, minimumEvidenceScore: 0.5 });

let verificationPhase = "bootstrap";
function phase(value: string): void {
  verificationPhase = value;
  if (process.env.VERIFIER_PHASE_OUTPUT === "1") {
    process.stderr.write(`${JSON.stringify({ verifier: "current_effective_analysis_context_source", phase: value })}\n`);
  }
}

function rows(value: unknown): readonly Record<string, unknown>[] {
  return value && typeof value === "object" && "rows" in value && Array.isArray(value.rows)
    ? value.rows as readonly Record<string, unknown>[] : [];
}

let fetchCalls = 0; let ready = false; let saved = false; let reloaded = false;
let crossTenantBlocked = false; let malformedBlocked = false; let fixtureCommitted = false;
let cleanupSucceeded = false; let activeSurvivorCount = -1; let purgeCandidateCount = -1;
let foreignActiveSurvivorCount = -1; let foreignPurgeCandidateCount = -1;
let cleanupError: string | null = null;
const originalFetch = globalThis.fetch;

try {
  phase("fixture_materialization");
  globalThis.fetch = (async () => { fetchCalls += 1; throw new Error("network_not_allowed"); }) as typeof fetch;
  {
    // These are platform identities and an immutable source snapshot, not authority facts.
    await database.insert(schema.workspaces).values([{ id: workspaceId, name: "Current source verifier" },
      { id: foreignWorkspaceId, name: "Current source foreign" }]);
    await database.insert(schema.users).values({ id: actorId, email: `current-source-${actorId}@example.invalid` });
    await database.insert(schema.memberships).values({ workspaceId, userId: actorId, role: "owner" });
    await database.insert(schema.metaConnections).values({ id: connectionId, workspaceId, externalConnectionKey: `connection_${suffix}`,
      displayName: "Current source", graphApiVersion: "v23.0", fieldCatalogVersion: "meta-change-fields-v1", accessMode: "read_only", status: "active" });
    await database.insert(schema.dataSources).values({ id: sourceId, workspaceId, metaConnectionId: connectionId, platform: "meta_ads",
      externalAccountId: accountRef, displayName: "Current source account" });
    await database.insert(schema.adAccounts).values({ id: accountId, workspaceId, dataSourceId: sourceId, externalAccountId: accountRef,
      name: "Current source account", currency: "TRY", timezone: "Europe/Istanbul" });
    await database.insert(schema.adCampaigns).values({ id: campaignId, workspaceId, adAccountId: accountId, externalCampaignId: campaignRef,
      name: "Current source campaign", objectiveSource: "OUTCOME_LEADS", configuredStatus: "ACTIVE", effectiveStatus: "ACTIVE",
      firstSeenAt: new Date(snapshotAt), sourceUpdatedAt: new Date(snapshotAt) });
    const sourceSnapshot = normalizeMetaChangeSnapshot({ schemaVersion: 1, workspaceId, externalAccountId: accountRef, capturedAt: snapshotAt,
      campaigns: [{ externalCampaignId: campaignRef, configuredStatus: { state: "known", value: "ACTIVE" },
        effectiveStatus: { state: "known", value: "ACTIVE" }, campaignBudgetOptimization: { state: "known", value: false },
        dailyBudgetMinor: { state: "known", value: null }, lifetimeBudgetMinor: { state: "known", value: null } }],
      adSets: [], ads: [] });
    await database.insert(schema.metaChangeSnapshots).values({ id: randomUUID(), workspaceId, metaConnectionId: connectionId, adAccountId: accountId,
      publicRef: snapshotRef, snapshotHash: sourceSnapshot.snapshotHash, schemaVersion: sourceSnapshot.schemaVersion,
      fieldCatalogVersion: sourceSnapshot.fieldCatalogVersion, capturedAt: new Date(snapshotAt), canonicalPayload: sourceSnapshot,
      safeAggregate: { entityCounts: { campaign: 1, adSet: 0, ad: 0 }, knownFieldCount: 1, unknownFieldCount: 0 } });
    fixtureCommitted = true;

    // Category definition, profile and assignment are all written by their lifecycle repositories.
    const authoring = new DrizzleCategoryAuthoringRepository(database as never);
    let authored = await authoring.inspect(workspaceId);
    authored = (await authoring.mutate({ workspaceId, actorId, actorRef, role: "owner", occurredAt,
      command: { operation: "create_dimension", key: "service", name: "Service", description: null, cardinality: "single",
        allowedEntityLevels: ["campaign"], expectedRegistryHash: authored.registryHash } })).state;
    const dimensionRef = categoryDimensionPublicRef("service");
    authored = (await authoring.mutate({ workspaceId, actorId, actorRef, role: "owner", occurredAt,
      command: { operation: "create_definition", dimensionRef, key: "lead", label: "Lead", description: null,
        expectedRegistryHash: authored.registryHash } })).state;
    const definitionRef = categoryDefinitionPublicRef("service", "lead");
    await authoring.mutate({ workspaceId, actorId, actorRef, role: "owner", occurredAt,
      command: { operation: "create_assignment", dimensionRef, definitionRef, entityLevel: "campaign",
        entityRef: categoryEntityPublicRef(workspaceId, "campaign", campaignId), viaAdRef: null, assignmentOperation: "override",
        manualLock: false, confidenceBasisPoints: 10_000, expectedRegistryHash: authored.registryHash } });
    const profiles = new DrizzleCategoryProfileLifecycleRepository(database as never);
    let profileState = await profiles.inspect(workspaceId, workspaceRef);
    const draft = await profiles.mutate({ workspaceId, workspaceRef, actorId, actorRef, role: "owner", occurredAt,
      command: { operation: "create_draft", definitionRef, expectedRegistryHash: profileState.registryHash, parentDefinitionRef: null,
        label: "Lead", description: "Current-source fixture", color: "#A31F34", bindings: { analysisPlaybookRefs: ["analysis_playbook_current"],
          ruleInstructionBundleRefs: [], budgetPolicyRefs: [], transferPolicyRefs: [], schedulePolicyRefs: [], actionPolicyRefs: [], creativePolicyRefs: [] } } });
    profileState = draft.state;
    await profiles.mutate({ workspaceId, workspaceRef, actorId, actorRef, role: "owner", occurredAt,
      command: { operation: "publish", profileRef: draft.profile.profileRef, expectedVersion: draft.profile.version,
        expectedProfileHash: draft.profile.profileHash, expectedRegistryHash: profileState.registryHash, reasonCode: "fixture_publish" } });

    // A reviewed set and its campaign selection are repository-authenticated, never injected into the reader.
    const guidanceRegistry = createGuidanceRegistry({ workspaceId, sources: [{ id: "source_current", workspaceId,
      sourceType: "owner_statement", title: "Current source", sourceRef: "owner:current", sourceUrl: null, content: "Protect quality",
      author: "owner", capturedAt: snapshotAt, reviewedAt: snapshotAt, reviewBy: null, status: "published", version: 1 }],
    cards: [{ id: "card_current", workspaceId, sourceType: "owner_statement", sourceIds: ["source_current"], title: "Quality",
      body: "Protect lead quality", rationale: null, strength: "must", topic: "quality", decisionKey: null, positionKey: null,
      authority: "guidance_only", status: "published", effectiveFrom: snapshotAt, effectiveTo: null, ownerRef: actorRef, version: 1 }],
    bindings: [{ id: "binding_current", workspaceId, cardId: "card_current", facet: "entity", value: campaignRef,
      entityType: "campaign", mode: "default", priority: 1, version: 1 }],
    sets: [{ id: "guidance_set_current", workspaceId, name: "Current set", orderedCardIds: ["card_current"], reviewStatus: "reviewed", version: 1 }] });
    const guidanceWrite = await new DrizzleGuidanceRegistryRepository(database as never).save(guidanceRegistry, { expectedRegistryHash: null });
    // The reader binds capturedAt to PostgreSQL's transaction clock. Keep the
    // clock query and read in the same caller-owned transaction; using two
    // implicit statement transactions is deliberately rejected as ambiguous.
    const manifest = await database.transaction(async (transaction) => {
      const manifestClock = rows(await transaction.execute(sql`
        select to_char(transaction_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as captured_at
      `));
      return new CurrentReviewedGuidanceReader().readCurrentInTransaction(transaction as never, workspaceId,
        String(manifestClock[0]?.captured_at));
    });
    const selected = manifest.reviewedSets[0];
    if (!selected) throw new Error("reviewed_guidance_fixture_not_found");
    await new DrizzleGuidanceCampaignSelectionRepository(database as never).publish({ workspaceId, workspaceRef, actorId, actorRef, role: "owner",
      accountRef, campaignRef, selectionRef: `guidance_selection_${suffix}`, revision: 1, expectedCurrentHash: "GENESIS",
      selectedSetRef: selected.setRef, selectedSetVersion: selected.setVersion, selectedSetHash: selected.setHash, topics: ["quality"],
      requiredTopics: ["quality"], budget: { maxCards: 10, maxSources: 10, maxCharacters: 10_000 }, effectiveAt: occurredAt, occurredAt });
    if (guidanceWrite.outcome !== "inserted") throw new Error("guidance_fixture_not_inserted");

    await new DrizzleDecisionCadenceProfileRepository(database as never).publish({ workspaceId, workspaceRef, actorId, actorRef, role: "owner",
      accountRef, campaignRef, profileRef: `cadence_${suffix}`, revision: 1, expectedCurrentHash: "GENESIS", profile: cadence, occurredAt });

    // Empty policy registry is an explicit, valid no-policy authority state. The catalog/snapshot/bindings are materialized only here.
    const emptyRegistryHash = createHash("sha256").update(JSON.stringify([])).digest("hex");
    // The repository authority scope must attest the same canonical Meta
    // objective as the immutable snapshot above; composition rejects a scope
    // that is current but describes a different campaign objective.
    const authorityScope = createPolicyScopeSnapshot({ workspaceRef, evaluatedAt: occurredAt, accountGroupRefs: [], objectiveRefs: [], topicRefs: [], canonicalObjective: "lead_generation" });
    const authorityCatalog = createTrustedPolicyCatalog({ workspaceRef, catalogRef: `authority_catalog_${suffix}`, catalogVersion: 1,
      instructionPolicyRegistryHash: emptyRegistryHash, bindings: [] });
    await new DrizzlePolicyAuthorityCatalogMaterializerRepository(database as never).materialize({ workspaceId, workspaceRef, actorId, actorRef, role: "owner",
      occurredAt, expiresAt, repositoryRef: `repository_${suffix}`, repositoryRevision: "current-source-fixture", expectedCatalogHeadHash: "GENESIS",
      expectedSnapshotHeadHash: "GENESIS", expectedPolicyRegistryHash: emptyRegistryHash, catalog: authorityCatalog, scope: authorityScope, manualLocks: [] });

    const reader = new DrizzleCurrentEffectiveAnalysisContextSourceReader(database as never);
    phase("closed_world_read_compose_reload");
    const source = await reader.loadCurrent(request);
    if (source.status !== "ready") throw new Error("closed_world_source_not_ready");
    const readySource = source;
    ready = true;
    if (process.env.VERIFIER_PHASE_OUTPUT === "1") {
      const authority = readySource.authority as unknown as { catalog?: { workspaceRef?: unknown }; scope?: {
        workspaceRef?: unknown; evaluatedAt?: unknown; objectiveEvidence?: { canonicalObjective?: unknown } } };
      const projectedObjective = projectMetaAnalysisConfig(readySource.facts.metaAnalysisConfigSnapshot, readySource.facts.identity.campaignRef).objective;
      process.stderr.write(`${JSON.stringify({ verifier: "current_effective_analysis_context_source", phase: verificationPhase,
        authorityScopeWorkspaceMatchesCatalog: authority.scope?.workspaceRef === authority.catalog?.workspaceRef,
        authorityScopeAtOrBeforeCapture: typeof authority.scope?.evaluatedAt === "string" && authority.scope.evaluatedAt <= readySource.capturedAt,
        authorityScopeObjectiveMatchesMeta: authority.scope?.objectiveEvidence?.canonicalObjective === (projectedObjective.state === "known" ? projectedObjective.value : null) })}\n`);
    }
    const composer = createDrizzleEffectiveAnalysisContextComposer({ database: database as never });
    const composed = await composer.composeAndSave(request).catch((error: unknown) => {
      if (error instanceof EffectiveAnalysisContextComposerError) {
        process.stderr.write(`${JSON.stringify({ verifier: "current_effective_analysis_context_source", phase: verificationPhase,
          composeRejection: error.code, diagnosticCode: error.diagnosticCode ?? null })}\n`);
      }
      throw error;
    }); saved = composed.outcome === "inserted";
    const stored = await new DrizzleEffectiveCampaignContextRepository(database as never).loadLatestValidCampaignPublic({ workspaceId,
      campaignRef: `ref_${composed.context.contextHash.slice(0, 12)}` });
    reloaded = stored !== null && stored.context.contextHash === composed.context.contextHash;
    crossTenantBlocked = await reader.loadCurrent({ ...request, workspaceId: foreignWorkspaceId }).then(() => false, () => true);
    malformedBlocked = await reader.loadCurrent({ ...request, entityRef: "bad ref" }).then(() => false, () => true);
    if (!saved || !reloaded || !crossTenantBlocked || !malformedBlocked || fetchCalls !== 0) throw new Error("closed_world_acceptance_failed");
  }
} finally {
  globalThis.fetch = originalFetch;
  if (fixtureCommitted) {
    try {
      phase("tombstone_cleanup");
      const purge = new DrizzleWorkspaceTombstonePurgePort();
      const service = new WorkspaceTombstoneService(new DrizzleWorkspaceTombstoneStore(database as never, purge),
        { authorize: async (input) => input.approvalRef === "ephemeral-fixture-approved" }, actorId, 60_000);
      for (const fixtureWorkspaceId of [workspaceId, foreignWorkspaceId]) {
        phase(fixtureWorkspaceId === workspaceId ? "tombstone_primary" : "tombstone_foreign");
        const plan = await service.dryRun(fixtureWorkspaceId, new Date().toISOString());
        await service.execute({ planRef: plan.planRef, approvalRef: "ephemeral-fixture-approved", now: new Date().toISOString() });
      }
      purgeCandidateCount = (await purge.inspect(database as never, workspaceId)).candidateCount;
      foreignPurgeCandidateCount = (await purge.inspect(database as never, foreignWorkspaceId)).candidateCount;
      const activeRows = rows(await database.execute(sql`select count(*) filter (where id = ${workspaceId}::uuid and lifecycle_state = 'active')::int as primary_count,
        count(*) filter (where id = ${foreignWorkspaceId}::uuid and lifecycle_state = 'active')::int as foreign_count from workspaces
        where id in (${workspaceId}::uuid, ${foreignWorkspaceId}::uuid)`));
      activeSurvivorCount = Number(activeRows[0]?.primary_count ?? -1);
      foreignActiveSurvivorCount = Number(activeRows[0]?.foreign_count ?? -1);
      cleanupSucceeded = purgeCandidateCount === 0 && foreignPurgeCandidateCount === 0 && activeSurvivorCount === 0 && foreignActiveSurvivorCount === 0;
    } catch (error) {
      cleanupError = error instanceof Error ? error.message : "unknown_cleanup_error";
      process.stderr.write(`${JSON.stringify({ ok: false, phase: verificationPhase, cleanupError })}\n`);
    }
  }
}
await pool.end();
if (cleanupError) throw new Error(`ephemeral_fixture_cleanup_failed:${cleanupError}`);
if (!cleanupSucceeded || fetchCalls !== 0) throw new Error("ephemeral_fixture_cleanup_failed");
phase("complete");
console.log(JSON.stringify({ ok: ready && saved && reloaded && crossTenantBlocked && malformedBlocked,
  scope: "closed_world_current_source_ready_compose_save_reload", ready, saved, reloaded, crossTenantBlocked, malformedBlocked,
  actionOrNetworkCalls: fetchCalls, fixtureCommitted, cleanup: "locked_workspace_tombstone", purgeCandidateCount, activeSurvivorCount,
  foreignPurgeCandidateCount, foreignActiveSurvivorCount, verificationPhase }));
