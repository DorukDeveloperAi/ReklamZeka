import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { and, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { DrizzleMetaConnectionRepository } from "@/connectors/meta/connection-drizzle-repository";
import { MetaConnectionService } from "@/connectors/meta/connection-service";
import { DrizzleEnvironmentMetaSecretRepository } from "@/connectors/meta/environment-secret-drizzle-repository";
import { DrizzleWorkspaceTombstonePurgePort } from "@/connectors/meta/workspace-tombstone-purge-drizzle-adapter";
import {
  DrizzleWorkspaceTombstoneStore,
  WorkspaceTombstoneService,
  hashWorkspaceLifecycleAuditEvent,
} from "@/connectors/meta/workspace-tombstone-drizzle-service";
import * as schema from "@/db/schema";
import { normalizeMetaChangeSnapshot } from "@/domain/meta/snapshot-diff";
import { AppendOnlyAuditLog } from "@/security/audit";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL yapılandırılmadı");

const rollback = Symbol("rollback");
const ids = {
  workspace: randomUUID(),
  foreignWorkspace: randomUUID(),
  actor: randomUUID(),
  foreignActor: randomUUID(),
  connection: randomUUID(),
  source: randomUUID(),
  account: randomUUID(),
  campaign: randomUUID(),
  adSet: randomUUID(),
  categoryDimension: randomUUID(),
  categoryDefinition: randomUUID(),
  categoryAssignment: randomUUID(),
  asset: randomUUID(),
  post: randomUUID(),
  previousSnapshot: randomUUID(),
  currentSnapshot: randomUUID(),
  creative: randomUUID(),
  ad: randomUUID(),
  portfolio: randomUUID(),
  stream: randomUUID(),
  run: randomUUID(),
  slice: randomUUID(),
  dailyInsight: randomUUID(),
  insight: randomUUID(),
  seedAudit: randomUUID(),
};
const occurredAt = "2026-08-07T13:00:00.000Z";
const changeSnapshot = (capturedAt: string, status: "PAUSED" | "ACTIVE") => normalizeMetaChangeSnapshot({
  schemaVersion: 1,
  workspaceId: ids.workspace,
  externalAccountId: "e2e-account",
  capturedAt,
  campaigns: [{
    externalCampaignId: "e2e-campaign",
    configuredStatus: { state: "known", value: status },
    effectiveStatus: { state: "known", value: status },
    campaignBudgetOptimization: { state: "known", value: true },
    dailyBudgetMinor: { state: "known", value: 100 },
    lifetimeBudgetMinor: { state: "known", value: null },
  }],
  adSets: [],
  ads: [],
});
const previousCanonical = changeSnapshot("2026-08-07T12:58:00.000Z", "PAUSED");
const currentCanonical = changeSnapshot("2026-08-07T12:59:00.000Z", "ACTIVE");
const environment = { META_ACCESS_TOKEN: `rollback-only-${randomUUID()}` };
const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  connectionTimeoutMillis: 10_000,
  statement_timeout: 30_000,
});
const database = drizzle(pool, { schema });

let targetRowsPurged = false;
let workspaceTombstoned = false;
let lifecycleAuditRetained = false;
let foreignWorkspaceUntouched = false;
let hardDeleteBlocked = false;
let publicOutputRedacted = false;
let rollbackClean = false;

try {
  await database.transaction(async (transaction) => {
    await transaction.insert(schema.users).values([
      { id: ids.actor, email: `lifecycle-${ids.actor}@example.invalid` },
      { id: ids.foreignActor, email: `foreign-${ids.foreignActor}@example.invalid` },
    ]);
    await transaction.insert(schema.workspaces).values([
      { id: ids.workspace, name: "Tombstone target" },
      { id: ids.foreignWorkspace, name: "Tombstone foreign" },
    ]);
    await transaction.insert(schema.memberships).values([
      { workspaceId: ids.workspace, userId: ids.actor, role: "owner" },
      { workspaceId: ids.foreignWorkspace, userId: ids.foreignActor, role: "owner" },
    ]);

    const connectionRepository = new DrizzleMetaConnectionRepository(transaction);
    const secretRepository = new DrizzleEnvironmentMetaSecretRepository(transaction, environment);
    const connectionService = new MetaConnectionService({
      memberships: [{ workspaceId: ids.workspace, userId: ids.actor, role: "owner" }],
      connections: connectionRepository,
      secrets: secretRepository,
      audit: new AppendOnlyAuditLog(),
      fetchImpl: async () => { throw new Error("network call not allowed"); },
      now: () => new Date(occurredAt),
    });
    await connectionService.register({
      actor: { userId: ids.actor },
      workspaceId: ids.workspace,
      connectionId: ids.connection,
      displayName: "Managed rollback connection",
      secretReference: secretRepository.reference({ workspaceId: ids.workspace, connectionId: ids.connection }),
    });

    await transaction.insert(schema.dataSources).values({
      id: ids.source, workspaceId: ids.workspace, metaConnectionId: ids.connection,
      platform: "meta_ads", externalAccountId: "e2e-account", displayName: "E2E source",
    });
    await transaction.insert(schema.adAccounts).values({
      id: ids.account, workspaceId: ids.workspace, dataSourceId: ids.source,
      externalAccountId: "e2e-account", name: "E2E account", currency: "TRY", timezone: "Europe/Istanbul",
    });
    await transaction.insert(schema.adCampaigns).values({
      id: ids.campaign, workspaceId: ids.workspace, adAccountId: ids.account,
      externalCampaignId: "e2e-campaign", name: "E2E campaign",
    });
    await transaction.insert(schema.metaAdSets).values({
      id: ids.adSet, workspaceId: ids.workspace, adAccountId: ids.account, campaignId: ids.campaign,
      externalAdSetId: "e2e-adset", name: "E2E ad set", rawPayloadHash: "hash-adset",
      sourceGraphVersion: "v23.0", fieldCatalogVersion: "e2e", provenance: {},
    });
    await transaction.insert(schema.categoryDimensions).values({
      id: ids.categoryDimension, workspaceId: ids.workspace, key: "internal_campaign_type",
      name: "Internal campaign type", cardinality: "single", allowedEntityLevels: ["campaign", "ad_set"],
    });
    await transaction.insert(schema.categoryDefinitions).values({
      id: ids.categoryDefinition, workspaceId: ids.workspace, dimensionId: ids.categoryDimension,
      key: "brand_protection", label: "Marka koruma",
    });
    await transaction.insert(schema.categoryAssignments).values({
      id: ids.categoryAssignment, workspaceId: ids.workspace, dimensionId: ids.categoryDimension,
      definitionId: ids.categoryDefinition, entityLevel: "campaign", campaignId: ids.campaign,
      operation: "add", source: "manual", manualLock: true,
      evidence: [{ kind: "owner_instruction", ref: "e2e:category" }], confidence: 1,
    });
    await transaction.insert(schema.metaAssets).values({
      id: ids.asset, workspaceId: ids.workspace, metaConnectionId: ids.connection,
      assetType: "facebook_page", externalAssetId: "e2e-page", displayName: "E2E page",
      rawPayloadHash: "hash-asset", sourceGraphVersion: "v23.0", fieldCatalogVersion: "e2e", provenance: {},
    });
    await transaction.insert(schema.metaPosts).values({
      id: ids.post, workspaceId: ids.workspace, metaConnectionId: ids.connection, actorAssetId: ids.asset,
      externalPostId: "e2e-post", sourceMessage: "purge fixture", rawPayloadHash: "hash-post",
      sourceGraphVersion: "v23.0", fieldCatalogVersion: "e2e", provenance: {},
    });
    await transaction.insert(schema.metaChangeSnapshots).values([
      {
        id: ids.previousSnapshot, workspaceId: ids.workspace, metaConnectionId: ids.connection,
        adAccountId: ids.account, publicRef: `snapshot_${"1".repeat(20)}`,
        snapshotHash: previousCanonical.snapshotHash, schemaVersion: 1,
        fieldCatalogVersion: previousCanonical.fieldCatalogVersion,
        capturedAt: new Date("2026-08-07T12:58:00.000Z"),
        canonicalPayload: previousCanonical,
        safeAggregate: { entityCounts: { campaign: 1, adSet: 0, ad: 0 }, knownFieldCount: 6, unknownFieldCount: 0 },
      },
      {
        id: ids.currentSnapshot, workspaceId: ids.workspace, metaConnectionId: ids.connection,
        adAccountId: ids.account, publicRef: `snapshot_${"2".repeat(20)}`,
        snapshotHash: currentCanonical.snapshotHash, schemaVersion: 1,
        fieldCatalogVersion: currentCanonical.fieldCatalogVersion,
        capturedAt: new Date("2026-08-07T12:59:00.000Z"),
        canonicalPayload: currentCanonical,
        safeAggregate: { entityCounts: { campaign: 1, adSet: 0, ad: 0 }, knownFieldCount: 6, unknownFieldCount: 0 },
      },
    ]);
    await transaction.insert(schema.metaChangeEvents).values({
      workspaceId: ids.workspace, metaConnectionId: ids.connection, adAccountId: ids.account,
      previousSnapshotId: ids.previousSnapshot, currentSnapshotId: ids.currentSnapshot,
      changeRef: `ref_${"3".repeat(20)}`, entityRef: `ref_${"4".repeat(20)}`,
      entityType: "campaign", field: "configured_status", beforeValue: "PAUSED", afterValue: "ACTIVE",
      classification: "external_change", timelineHash: "c".repeat(64), fieldCatalogVersion: "e2e",
      occurredAt: new Date("2026-08-07T12:59:00.000Z"), detectedAt: new Date("2026-08-07T12:59:30.000Z"),
    });
    await transaction.insert(schema.metaCreatives).values({
      id: ids.creative, workspaceId: ids.workspace, adAccountId: ids.account, postId: ids.post,
      actorAssetId: ids.asset, externalCreativeId: "e2e-creative", sourceType: "existing_post",
      contentProvenance: {}, rawPayloadHash: "hash-creative", sourceGraphVersion: "v23.0",
      fieldCatalogVersion: "e2e", provenance: {},
    });
    await transaction.insert(schema.metaAds).values({
      id: ids.ad, workspaceId: ids.workspace, adAccountId: ids.account, campaignId: ids.campaign,
      adSetId: ids.adSet, creativeId: ids.creative, externalAdId: "e2e-ad", name: "E2E ad",
      rawPayloadHash: "hash-ad", sourceGraphVersion: "v23.0", fieldCatalogVersion: "e2e", provenance: {},
    });
    await transaction.insert(schema.metaAdCreativeBindings).values({
      workspaceId: ids.workspace, adId: ids.ad, creativeId: ids.creative, postId: ids.post,
      bindingPayloadHash: "hash-binding", provenance: {},
    });
    await transaction.insert(schema.metaAssetEdges).values({
      workspaceId: ids.workspace, metaConnectionId: ids.connection, adAccountId: ids.account,
      sourceEntityType: "ad_account", sourceExternalId: "e2e-account", targetAssetId: ids.asset,
      relationship: "owns", rawPayloadHash: "hash-edge", sourceGraphVersion: "v23.0",
      fieldCatalogVersion: "e2e", provenance: {},
    });
    await transaction.insert(schema.metaAssetDiscoveries).values({
      workspaceId: ids.workspace, metaConnectionId: ids.connection, adAccountId: ids.account,
      discoveryKey: "e2e-discovery", resource: "pages", sourceType: "ad_account", status: "verified",
      itemCount: 1, sourceEdge: "owned_pages", rawPayloadHash: "hash-discovery",
      sourceGraphVersion: "v23.0", fieldCatalogVersion: "e2e", provenance: {},
    });

    await transaction.insert(schema.metaPortfolioSyncRuns).values({
      id: ids.portfolio, workspaceId: ids.workspace, metaConnectionId: ids.connection,
      idempotencyKey: "e2e-portfolio", status: "completed",
    });
    await transaction.insert(schema.metaSyncStreams).values({
      id: ids.stream, workspaceId: ids.workspace, metaConnectionId: ids.connection,
      adAccountId: ids.account, streamType: "insights", status: "completed",
    });
    await transaction.insert(schema.metaSyncRuns).values({
      id: ids.run, workspaceId: ids.workspace, metaConnectionId: ids.connection, adAccountId: ids.account,
      portfolioRunId: ids.portfolio, streamId: ids.stream, streamType: "insights",
      idempotencyKey: "e2e-run", status: "completed",
    });
    await transaction.insert(schema.metaSyncSlices).values({
      id: ids.slice, workspaceId: ids.workspace, metaConnectionId: ids.connection, adAccountId: ids.account,
      runId: ids.run, streamType: "insights", entityLevel: "campaign", sliceKey: "e2e-slice",
      status: "completed",
    });
    await transaction.insert(schema.metaSyncRecordLedger).values({
      workspaceId: ids.workspace, metaConnectionId: ids.connection, adAccountId: ids.account,
      streamType: "insights", entityLevel: "campaign", recordIdentity: "e2e-record",
      snapshotHash: "hash-record", firstSeenAt: new Date(occurredAt), lastSeenAt: new Date(occurredAt),
    });
    await transaction.insert(schema.metaDailyInsights).values({
      id: ids.dailyInsight, workspaceId: ids.workspace, metaConnectionId: ids.connection,
      adAccountId: ids.account, syncRunId: ids.run, syncSliceId: ids.slice, entityLevel: "campaign",
      externalEntityId: "e2e-campaign", dateStart: "2026-08-06", dateStop: "2026-08-06",
      attributionLabel: "default", sourceRevision: "revision", sourcePayloadHash: "hash-insight",
    });
    await transaction.insert(schema.metaDailyInsightMetrics).values({
      dailyInsightId: ids.dailyInsight, metricKey: "spend", aggregation: "additive",
      valueMinor: 100, sourceRevision: "revision", sourcePayloadHash: "hash-metric",
    });
    await transaction.insert(schema.dailyAdMetrics).values({
      workspaceId: ids.workspace, dataSourceId: ids.source, adCampaignId: ids.campaign,
      metricDate: "2026-08-06", attributionModel: "default", attributionClickDays: 7,
      attributionViewDays: 1, schemaVersion: 1, spendMinor: 100, impressions: 10,
      clicks: 1, conversions: 0, conversionValueMinor: 0, sourceRowId: "e2e-row",
      sourceUpdatedAt: new Date(occurredAt), sourcePayloadHash: "hash-daily",
    });
    await transaction.insert(schema.syncRuns).values({
      workspaceId: ids.workspace, dataSourceId: ids.source, status: "completed",
    });
    await transaction.insert(schema.connectionSecrets).values({
      workspaceId: ids.workspace, dataSourceId: ids.source, algorithm: "fixture", keyVersion: 1,
      iv: "fixture", authTag: "fixture", ciphertext: "rollback-only",
    });
    await transaction.insert(schema.insights).values({
      id: ids.insight, workspaceId: ids.workspace, snapshotId: "e2e-snapshot", ruleId: "e2e-rule",
      calculationVersion: "1", severity: "info", confidenceScore: 1, title: "Fixture",
      explanation: "Fixture", evidence: {}, recommendedAction: "none",
    });
    await transaction.insert(schema.insightFeedback).values({
      workspaceId: ids.workspace, insightId: ids.insight, userId: ids.actor,
      insightVersion: "1", value: "helpful", recordedAt: new Date(occurredAt),
    });
    await transaction.insert(schema.reportShares).values({
      workspaceId: ids.workspace, snapshotId: "e2e-snapshot", tokenHash: `e2e-${randomUUID()}`,
      createdBy: ids.actor, expiresAt: new Date("2026-08-08T13:00:00.000Z"),
    });
    await transaction.insert(schema.operationalEvents).values({
      workspaceId: ids.workspace, metric: "e2e", value: 1, observedAt: new Date(occurredAt),
    });
    await transaction.insert(schema.operationalEvents).values({
      workspaceId: ids.foreignWorkspace, metric: "foreign-e2e", value: 1, observedAt: new Date(occurredAt),
    });
    await transaction.insert(schema.auditEvents).values({
      id: ids.seedAudit, workspaceId: ids.workspace, actorId: ids.actor, action: "fixture.created",
      resourceType: "fixture", resourceId: "seed", metadata: {}, previousHash: "GENESIS",
      eventHash: `seed-${randomUUID()}`, occurredAt: new Date("2026-08-07T12:59:00.000Z"),
    });

    const purgePort = new DrizzleWorkspaceTombstonePurgePort();
    const targetBefore = await purgePort.inspect(transaction as never, ids.workspace);
    const foreignBefore = await purgePort.inspect(transaction as never, ids.foreignWorkspace);
    if (targetBefore.candidateCount < 20 || foreignBefore.candidateCount !== 2) {
      throw new Error("Tombstone E2E fixture incomplete");
    }

    const store = new DrizzleWorkspaceTombstoneStore(transaction as never, purgePort);
    const service = new WorkspaceTombstoneService(
      store,
      { authorize: async (input) => input.approvalRef === "application-approved" },
      ids.actor,
      60_000,
    );
    const preview = await service.dryRun(ids.workspace, occurredAt);
    const result = await service.execute({
      planRef: preview.planRef,
      approvalRef: "application-approved",
      now: "2026-08-07T13:00:30.000Z",
    });

    targetRowsPurged = (await purgePort.inspect(transaction as never, ids.workspace)).candidateCount === 0;
    foreignWorkspaceUntouched = (await purgePort.inspect(transaction as never, ids.foreignWorkspace)).revision
      === foreignBefore.revision;
    const [workspace] = await transaction.select({
      lifecycleState: schema.workspaces.lifecycleState,
      tombstonedAt: schema.workspaces.tombstonedAt,
      name: schema.workspaces.name,
    }).from(schema.workspaces).where(eq(schema.workspaces.id, ids.workspace));
    const [connection] = await transaction.select({
      status: schema.metaConnections.status,
      secretReferenceId: schema.metaConnections.secretReferenceId,
    }).from(schema.metaConnections).where(eq(schema.metaConnections.id, ids.connection));
    workspaceTombstoned = workspace?.lifecycleState === "tombstoned"
      && workspace.tombstonedAt !== null
      && workspace.name === "Tombstoned workspace"
      && connection?.status === "revoked"
      && connection.secretReferenceId === null;

    const lifecycleAudit = await transaction.select().from(schema.auditEvents).where(and(
      eq(schema.auditEvents.workspaceId, ids.workspace),
      inArray(schema.auditEvents.action, ["workspace.tombstone_requested", "workspace.tombstoned"]),
    ));
    const request = lifecycleAudit.find((event) => event.action === "workspace.tombstone_requested");
    const completion = lifecycleAudit.find((event) => event.action === "workspace.tombstoned");
    const seed = await transaction.select({ eventHash: schema.auditEvents.eventHash })
      .from(schema.auditEvents).where(eq(schema.auditEvents.id, ids.seedAudit));
    const hashMatches = (event: typeof lifecycleAudit[number]) => hashWorkspaceLifecycleAuditEvent({
      workspaceId: event.workspaceId,
      actorId: event.actorId,
      action: event.action as "workspace.tombstone_requested" | "workspace.tombstoned",
      resourceType: "workspace",
      resourceId: event.resourceId,
      occurredAt: event.occurredAt.toISOString(),
      metadata: event.metadata ?? {},
      id: event.id,
      previousHash: event.previousHash,
    }) === event.eventHash;
    lifecycleAuditRetained = lifecycleAudit.length === 2
      && seed.length === 1
      && request?.previousHash === seed[0]?.eventHash
      && completion?.previousHash === request?.eventHash
      && hashMatches(request!)
      && hashMatches(completion!);

    try {
      await transaction.transaction(async (savepoint) => {
        await savepoint.delete(schema.workspaces).where(eq(schema.workspaces.id, ids.workspace));
      });
    } catch (error) {
      const outer = error as { code?: string; cause?: { code?: string } };
      hardDeleteBlocked = outer.code === "23503" || outer.cause?.code === "23503";
    }

    publicOutputRedacted = !JSON.stringify({ preview, result }).includes(ids.workspace)
      && !JSON.stringify({ preview, result }).includes(ids.connection)
      && result.auditEventsAppended === 2;
    if (!targetRowsPurged || !workspaceTombstoned || !lifecycleAuditRetained
      || !foreignWorkspaceUntouched || !hardDeleteBlocked || !publicOutputRedacted) {
      throw new Error("Workspace tombstone PostgreSQL acceptance failed");
    }
    throw rollback;
  });
} catch (error) {
  if (error !== rollback) throw error;
}

try {
  const remaining = await database.select({ count: sql<number>`count(*)::int` })
    .from(schema.workspaces).where(inArray(schema.workspaces.id, [ids.workspace, ids.foreignWorkspace]));
  rollbackClean = remaining[0]?.count === 0;
  if (!rollbackClean) throw new Error("Workspace tombstone rollback cleanup failed");
} finally {
  await pool.end();
}

console.log(JSON.stringify({
  targetRowsPurged,
  workspaceTombstoned,
  lifecycleAuditEventsRetained: lifecycleAuditRetained ? 2 : 0,
  foreignWorkspaceUntouched,
  hardDeleteBlocked,
  publicOutputRedacted,
  rollbackClean,
  temporaryRowsCommitted: false,
}));
