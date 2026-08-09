import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { buildEffectiveCampaignContext, type EffectiveCampaignContextInput } from "@/analyses/effective-campaign-context";
import {
  DrizzleEffectiveCampaignContextRepository,
  EffectiveCampaignContextRepositoryError,
  sourceComponentsOf,
} from "@/connectors/analyses/effective-campaign-context-drizzle-repository";
import * as schema from "@/db/schema";
import { resolveEffectiveCategory, type CategoryDefinition, type CategoryDimension } from "@/domain/categories/registry";
import {
  buildEffectiveGuidancePack,
  createGuidanceRegistry,
  type GuidanceCard,
  type GuidanceSource,
} from "@/domain/guidance/registry";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL yapılandırılmadı");

const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 20_000 });
const database = drizzle(pool, { schema });
const rollback = Symbol("rollback");
const workspaceId = randomUUID();
const foreignWorkspaceId = randomUUID();
const connectionId = randomUUID();
const foreignConnectionId = randomUUID();
const dataSourceId = randomUUID();
const foreignDataSourceId = randomUUID();
const accountId = randomUUID();
const foreignAccountId = randomUUID();
const campaignAId = randomUUID();
const campaignBId = randomUUID();
const foreignCampaignId = randomUUID();
const snapshotId = randomUUID();
const snapshotRef = "snapshot_aaaaaaaaaaaaaaaaaaaa";
const futureSnapshotRef = "snapshot_bbbbbbbbbbbbbbbbbbbb";

function guidance(entityRef: string) {
  const source: GuidanceSource = {
    id: "source-1", workspaceId, sourceType: "owner_statement", title: "Owner",
    sourceRef: "owner:1", sourceUrl: null, content: "Protect budget", author: "owner",
    capturedAt: "2026-08-01T00:00:00.000Z", reviewedAt: "2026-08-02T00:00:00.000Z",
    reviewBy: null, status: "published", version: 1,
  };
  const card: GuidanceCard = {
    id: "card-1", workspaceId, sourceType: "owner_statement", sourceIds: [source.id],
    title: "Protection", body: "Do not reallocate protected budget", rationale: null,
    strength: "must", topic: "budget", decisionKey: null, positionKey: null,
    authority: "guidance_only", status: "published", effectiveFrom: null, effectiveTo: null,
    ownerRef: "owner-1", version: 1,
  };
  const registry = createGuidanceRegistry({
    workspaceId, sources: [source], cards: [card], sets: [],
    bindings: [{
      id: "binding-1", workspaceId, cardId: card.id, facet: "global", value: null,
      entityType: null, mode: "default", priority: 10, version: 1,
    }],
  });
  return buildEffectiveGuidancePack(registry, {
    workspaceId, accountId: "account-main", objective: "lead_generation", internalCategoryIds: ["category-1"],
    entity: { type: "campaign", id: entityRef }, topics: ["budget"], requiredTopics: ["budget"],
    evaluatedAt: "2026-08-07T12:00:00.000Z",
    budget: { maxCards: 10, maxSources: 10, maxCharacters: 10_000 },
  });
}

function category(entityRef: string) {
  const dimension: CategoryDimension = {
    id: "dimension-1", workspaceId, key: "protection", version: 1,
    cardinality: "single", allowedEntityLevels: ["campaign"], archivedAt: null,
  };
  const definition: CategoryDefinition = {
    id: "category-1", workspaceId, dimensionId: dimension.id, key: "protected",
    label: "Protected", version: 1, archivedAt: null,
  };
  return resolveEffectiveCategory({
    dimension, definitions: [definition], path: { workspaceId, nodes: [{ level: "campaign", id: entityRef }] },
    assignments: [{
      id: `assignment-${entityRef}`, workspaceId, dimensionId: dimension.id, definitionId: definition.id,
      entity: { level: "campaign", id: entityRef }, operation: "add", source: "manual",
      manualLock: true, evidence: [{ kind: "owner", ref: "statement-1" }], confidence: 1,
      version: 1, archivedAt: null,
    }],
  }).frozenContext;
}

function context(options: Readonly<{
  campaignRef: string;
  connectionRef?: string;
  accountRef?: string;
  snapshotRefs?: readonly string[];
  cadenceReason?: string;
}>) {
  const input: EffectiveCampaignContextInput = {
    workspaceId, capturedAt: "2026-08-07T12:00:00.000Z",
    identity: {
      connectionRef: options.connectionRef ?? "connection-main",
      accountRef: options.accountRef ?? "account-main",
      campaignRef: options.campaignRef, entityRef: options.campaignRef,
      entityType: "campaign", hierarchyRefs: [options.campaignRef],
    },
    meta: {
      objective: { state: "known", value: "lead_generation" },
      optimizationEvent: { state: "known", value: "lead" },
      configuredStatus: { state: "known", value: "ACTIVE" }, effectiveStatus: { state: "known", value: "ACTIVE" },
      budgetOwnerRef: { state: "known", value: options.campaignRef },
      targetingSignature: { state: "unknown", reason: "not_observed" },
      actorRef: { state: "known", value: null }, destinationRef: { state: "known", value: null },
    },
    categories: [category(options.campaignRef)], guidance: guidance(options.campaignRef), policies: [],
    cadence: {
      profileRef: "cadence-1", decision: "observe", reason: options.cadenceReason ?? "stable_window", cooldownUntil: null,
    },
    data: {
      trustStatus: "ready", snapshotRefs: options.snapshotRefs ?? [snapshotRef],
      featureRefs: [], windowRefs: [], blockers: [],
    },
    history: { changeRefs: [], decisionRefs: [], experimentRefs: [], practiceRefs: [], outcomeRefs: [] },
    versions: {
      metaCatalog: "meta-v1", categoryResolver: "category-v1", guidanceRegistry: "guidance-v1",
      metricCatalog: "metric-v1", formulaCatalog: "formula-v1", timeframeResolver: "timeframe-v1",
      instructionPolicyRegistry: "9".repeat(64),
    },
  };
  return buildEffectiveCampaignContext(input);
}

let inserted = false;
let idempotentReplay = false;
let identityConflictBlocked = false;
let foreignWorkspaceBlocked = false;
let foreignAccountBlocked = false;
let brokenHierarchyBlocked = false;
let nonexistentSnapshotBlocked = false;
let futureSnapshotBlocked = false;
let exactEntityInvalidated = false;
let unrelatedEntityPreserved = false;
let instructionPolicyWorkspaceInvalidated = false;
let historicalReplayImmutable = false;
let invalidationReplayIdempotent = false;
let forbiddenPayloadBlocked = false;
let nullableAuthorityBypassBlocked = false;
let nestedAuthorityEscalationBlocked = false;
let crossTenantForeignKeyBlocked = false;
let noWriteAuthority = false;
let temporaryRowsCommitted = true;

try {
  await database.transaction(async (transaction) => {
    // Exercise the applied production schema; the outer transaction rolls all fixtures back.
    await transaction.insert(schema.workspaces).values([
      { id: workspaceId, name: "Context E2E" }, { id: foreignWorkspaceId, name: "Foreign Context E2E" },
    ]);
    await transaction.insert(schema.metaConnections).values([
      {
        id: connectionId, workspaceId, externalConnectionKey: "connection-main", displayName: "Main",
        graphApiVersion: "v1", fieldCatalogVersion: "fields-v1", status: "active",
      },
      {
        id: foreignConnectionId, workspaceId: foreignWorkspaceId, externalConnectionKey: "connection-foreign",
        displayName: "Foreign", graphApiVersion: "v1", fieldCatalogVersion: "fields-v1", status: "active",
      },
    ]);
    await transaction.insert(schema.dataSources).values([
      {
        id: dataSourceId, workspaceId, metaConnectionId: connectionId, platform: "meta_ads",
        externalAccountId: "account-main", displayName: "Main account",
      },
      {
        id: foreignDataSourceId, workspaceId: foreignWorkspaceId, metaConnectionId: foreignConnectionId,
        platform: "meta_ads", externalAccountId: "account-foreign", displayName: "Foreign account",
      },
    ]);
    await transaction.insert(schema.adAccounts).values([
      {
        id: accountId, workspaceId, dataSourceId, externalAccountId: "account-main",
        name: "Main", currency: "TRY", timezone: "Europe/Istanbul",
      },
      {
        id: foreignAccountId, workspaceId: foreignWorkspaceId, dataSourceId: foreignDataSourceId,
        externalAccountId: "account-foreign", name: "Foreign", currency: "TRY", timezone: "Europe/Istanbul",
      },
    ]);
    await transaction.insert(schema.adCampaigns).values([
      { id: campaignAId, workspaceId, adAccountId: accountId, externalCampaignId: "campaign-a", name: "A" },
      { id: campaignBId, workspaceId, adAccountId: accountId, externalCampaignId: "campaign-b", name: "B" },
      {
        id: foreignCampaignId, workspaceId: foreignWorkspaceId, adAccountId: foreignAccountId,
        externalCampaignId: "campaign-foreign", name: "Foreign",
      },
    ]);
    await transaction.insert(schema.metaChangeSnapshots).values({
      id: snapshotId, workspaceId, metaConnectionId: connectionId, adAccountId: accountId,
      publicRef: snapshotRef, snapshotHash: "a".repeat(64), schemaVersion: 1,
      fieldCatalogVersion: "fields-v1", capturedAt: new Date("2026-08-07T11:00:00.000Z"),
      canonicalPayload: {}, safeAggregate: { entityCounts: { campaign: 2, adSet: 0, ad: 0 }, knownFieldCount: 1, unknownFieldCount: 0 },
    });
    await transaction.insert(schema.metaChangeSnapshots).values({
      id: randomUUID(), workspaceId, metaConnectionId: connectionId, adAccountId: accountId,
      publicRef: futureSnapshotRef, snapshotHash: "b".repeat(64), schemaVersion: 1,
      fieldCatalogVersion: "fields-v1", capturedAt: new Date("2026-08-08T11:00:00.000Z"),
      canonicalPayload: {}, safeAggregate: { entityCounts: { campaign: 2, adSet: 0, ad: 0 }, knownFieldCount: 1, unknownFieldCount: 0 },
    });

    const repository = new DrizzleEffectiveCampaignContextRepository(transaction as never);
    const contextA = context({ campaignRef: "campaign-a" });
    const contextB = context({ campaignRef: "campaign-b" });
    inserted = (await repository.save(contextA)).outcome === "inserted"
      && (await repository.save(contextB)).outcome === "inserted";
    idempotentReplay = (await repository.save(contextA)).outcome === "unchanged";
    identityConflictBlocked = await repository.save(context({ campaignRef: "campaign-a", cadenceReason: "changed_reason" })).then(
      () => false,
      (error: unknown) => error instanceof EffectiveCampaignContextRepositoryError && error.code === "identity_conflict",
    );
    foreignWorkspaceBlocked = await repository.save(context({
      campaignRef: "campaign-foreign", connectionRef: "connection-foreign", accountRef: "account-foreign",
    })).then(
      () => false,
      (error: unknown) => error instanceof EffectiveCampaignContextRepositoryError && error.code === "workspace_scope_mismatch",
    );
    foreignAccountBlocked = await repository.save(context({
      campaignRef: "campaign-foreign", connectionRef: "connection-main", accountRef: "account-foreign",
    })).then(
      () => false,
      (error: unknown) => error instanceof EffectiveCampaignContextRepositoryError && error.code === "workspace_scope_mismatch",
    );
    brokenHierarchyBlocked = await repository.save(context({ campaignRef: "campaign-missing" })).then(
      () => false,
      (error: unknown) => error instanceof EffectiveCampaignContextRepositoryError && error.code === "workspace_scope_mismatch",
    );
    nonexistentSnapshotBlocked = await repository.save(context({
      campaignRef: "campaign-a", snapshotRefs: ["snapshot_cccccccccccccccccccc"],
    })).then(
      () => false,
      (error: unknown) => error instanceof EffectiveCampaignContextRepositoryError && error.code === "workspace_scope_mismatch",
    );
    futureSnapshotBlocked = await repository.save(context({
      campaignRef: "campaign-a", snapshotRefs: [futureSnapshotRef],
    })).then(
      () => false,
      (error: unknown) => error instanceof EffectiveCampaignContextRepositoryError && error.code === "workspace_scope_mismatch",
    );

    const metricComponent = sourceComponentsOf(contextA).find((entry) => entry.componentType === "metric_catalog")!;
    const invalidation = {
      workspaceId, ...metricComponent,
      scope: { kind: "exact_entity_component" as const, entityType: "campaign" as const, entityRef: "campaign-a" },
      reasonCode: "source_changed" as const, observedAt: "2026-08-07T13:00:00.000Z",
    };
    const firstInvalidation = await repository.invalidate(invalidation);
    exactEntityInvalidated = firstInvalidation.outcome === "inserted"
      && firstInvalidation.affectedContextCount === 1
      && await repository.loadLatestValid({ workspaceId, entityType: "campaign", entityRef: "campaign-a" }) === null;
    unrelatedEntityPreserved = (await repository.loadLatestValid({
      workspaceId, entityType: "campaign", entityRef: "campaign-b",
    }))?.context.contextHash === contextB.contextHash;
    const policyComponent = sourceComponentsOf(contextA).find((entry) => entry.componentType === "instruction_policy")!;
    const policyInvalidation = await repository.invalidate({ workspaceId, ...policyComponent,
      scope: { kind: "workspace_component" }, reasonCode: "source_changed",
      observedAt: "2026-08-07T13:01:00.000Z" });
    instructionPolicyWorkspaceInvalidated = policyInvalidation.outcome === "inserted"
      && policyInvalidation.affectedContextCount === 2
      && await repository.loadLatestValid({ workspaceId, entityType: "campaign", entityRef: "campaign-a" }) === null
      && await repository.loadLatestValid({ workspaceId, entityType: "campaign", entityRef: "campaign-b" }) === null;
    const historical = await repository.loadHistorical(workspaceId, contextA.contextHash);
    historicalReplayImmutable = historical.context.contextHash === contextA.contextHash && historical.invalidated;
    invalidationReplayIdempotent = (await repository.invalidate(invalidation)).outcome === "unchanged";

    forbiddenPayloadBlocked = await transaction.transaction(async (savepoint) => {
      await savepoint.execute(sql`
        insert into effective_campaign_contexts (
          workspace_id, identity_hash, context_hash, schema_version, meta_connection_id, ad_account_id,
          campaign_id, connection_ref, account_ref, campaign_ref, entity_type, entity_ref,
          captured_at, snapshot_refs, context_payload
        ) select workspace_id, ${"b".repeat(64)}, ${"c".repeat(64)}, schema_version, meta_connection_id,
          ad_account_id, campaign_id, connection_ref, account_ref, campaign_ref, entity_type, entity_ref,
          captured_at + interval '1 second', snapshot_refs, context_payload || '{"metaAccessToken":"unsafe"}'::jsonb
        from effective_campaign_contexts limit 1
      `);
      return false;
    }).catch(() => true);
    nullableAuthorityBypassBlocked = await transaction.transaction(async (savepoint) => {
      await savepoint.execute(sql`
        insert into effective_campaign_contexts (
          workspace_id, identity_hash, context_hash, schema_version, meta_connection_id, ad_account_id,
          campaign_id, connection_ref, account_ref, campaign_ref, entity_type, entity_ref,
          captured_at, snapshot_refs, context_payload
        ) select workspace_id, ${"d".repeat(64)}, ${"e".repeat(64)}, schema_version, meta_connection_id,
          ad_account_id, campaign_id, connection_ref, account_ref, campaign_ref, entity_type, entity_ref,
          captured_at + interval '2 seconds', snapshot_refs, context_payload - 'capabilities'
        from effective_campaign_contexts limit 1
      `);
      return false;
    }).catch(() => true);
    nestedAuthorityEscalationBlocked = await transaction.transaction(async (savepoint) => {
      await savepoint.execute(sql`
        insert into effective_campaign_contexts (
          workspace_id, identity_hash, context_hash, schema_version, meta_connection_id, ad_account_id,
          campaign_id, connection_ref, account_ref, campaign_ref, entity_type, entity_ref,
          captured_at, snapshot_refs, context_payload
        ) select workspace_id, ${"f".repeat(64)}, ${"1".repeat(64)}, schema_version, meta_connection_id,
          ad_account_id, campaign_id, connection_ref, account_ref, campaign_ref, entity_type, entity_ref,
          captured_at + interval '3 seconds', snapshot_refs,
          context_payload || '{"nested":{"canEnforcePolicy":true}}'::jsonb
        from effective_campaign_contexts limit 1
      `);
      return false;
    }).catch(() => true);
    crossTenantForeignKeyBlocked = await transaction.transaction(async (savepoint) => {
      await savepoint.execute(sql`
        insert into effective_campaign_contexts (
          workspace_id, identity_hash, context_hash, schema_version, meta_connection_id, ad_account_id,
          campaign_id, connection_ref, account_ref, campaign_ref, entity_type, entity_ref,
          captured_at, snapshot_refs, context_payload
        ) select ${foreignWorkspaceId}::uuid, ${"2".repeat(64)}, ${"3".repeat(64)}, schema_version,
          meta_connection_id, ad_account_id, campaign_id, connection_ref, account_ref, campaign_ref,
          entity_type, entity_ref, captured_at + interval '4 seconds', snapshot_refs,
          jsonb_set(jsonb_set(context_payload, '{workspaceId}', to_jsonb(${foreignWorkspaceId}::text)),
            '{contextHash}', to_jsonb(${'3'.repeat(64)}::text))
        from effective_campaign_contexts limit 1
      `);
      return false;
    }).catch(() => true);
    noWriteAuthority = contextA.capabilities.canAuthorizeAction === false
      && contextA.capabilities.canExecuteWrite === false
      && JSON.stringify(historical).match(/access[_-]?token|rawPayload|agentNarration/i) === null;

    if (!inserted || !idempotentReplay || !identityConflictBlocked || !foreignWorkspaceBlocked
      || !foreignAccountBlocked || !brokenHierarchyBlocked || !nonexistentSnapshotBlocked || !futureSnapshotBlocked
      || !exactEntityInvalidated || !unrelatedEntityPreserved || !historicalReplayImmutable
      || !invalidationReplayIdempotent || !forbiddenPayloadBlocked || !nullableAuthorityBypassBlocked
      || !nestedAuthorityEscalationBlocked || !crossTenantForeignKeyBlocked || !noWriteAuthority) {
      throw new Error("Effective campaign context PostgreSQL acceptance failed");
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
  inserted, idempotentReplay, identityConflictBlocked, foreignWorkspaceBlocked,
  foreignAccountBlocked, brokenHierarchyBlocked, nonexistentSnapshotBlocked,
  futureSnapshotBlocked,
  exactEntityInvalidated, unrelatedEntityPreserved, instructionPolicyWorkspaceInvalidated, historicalReplayImmutable,
  invalidationReplayIdempotent, forbiddenPayloadBlocked, nullableAuthorityBypassBlocked,
  nestedAuthorityEscalationBlocked, crossTenantForeignKeyBlocked, noWriteAuthority,
  writeNetworkCalls: 0, temporaryRowsCommitted,
}));
