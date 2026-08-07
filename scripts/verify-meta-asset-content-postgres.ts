import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { and, count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { DrizzleMetaAssetContentRepository } from "@/connectors/meta/sync/asset-content-drizzle-repository";
import {
  hashMetaContentPayload,
  MetaAssetContentPersistenceRun,
} from "@/connectors/meta/sync/asset-content-persistence";
import * as schema from "@/db/schema";
import { normalizeMetaAssetMirror } from "@/domain/meta/asset-mirror";
import { extractMetaAdContent } from "@/domain/meta/content/extract";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL yapılandırılmadı");

const ids = {
  workspace: randomUUID(),
  connection: randomUUID(),
  dataSource: randomUUID(),
  account: randomUUID(),
  campaign: randomUUID(),
  adSet: randomUUID(),
  ad: randomUUID(),
  ad2: randomUUID(),
  stream: randomUUID(),
  run: randomUUID(),
  slice: randomUUID(),
};
const suffix = randomUUID().replaceAll("-", "");
const external = {
  connection: `e2e-${suffix}`,
  account: `act_e2e_${suffix}`,
  campaign: `campaign-e2e-${suffix}`,
  adSet: `adset-e2e-${suffix}`,
  ad: `ad-e2e-${suffix}`,
  ad2: `ad-2-e2e-${suffix}`,
  creative: `creative-e2e-${suffix}`,
  page: `page-e2e-${suffix}`,
  post: `page-e2e-${suffix}_post-e2e-${suffix}`,
};
const sliceKey = `creative:${external.account}:ad:all:all`;
const fetchedAt = "2026-08-07T10:00:00.000Z";

function openDatabase() {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 2,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 15_000,
  });
  return { pool, db: drizzle(pool, { schema }) };
}

const setup = openDatabase();
try {
  await setup.db.transaction(async (tx) => {
    await tx.insert(schema.workspaces).values({ id: ids.workspace, name: "S1.4 temporary E2E" });
    await tx.insert(schema.metaConnections).values({
      id: ids.connection,
      workspaceId: ids.workspace,
      externalConnectionKey: external.connection,
      displayName: "S1.4 temporary E2E",
      graphApiVersion: "v24.0",
      fieldCatalogVersion: "s14-e2e-v1",
    });
    await tx.insert(schema.dataSources).values({
      id: ids.dataSource,
      workspaceId: ids.workspace,
      metaConnectionId: ids.connection,
      platform: "meta_ads",
      externalAccountId: external.account,
      displayName: "S1.4 temporary account",
    });
    await tx.insert(schema.adAccounts).values({
      id: ids.account,
      workspaceId: ids.workspace,
      dataSourceId: ids.dataSource,
      externalAccountId: external.account,
      name: "S1.4 temporary account",
      currency: "TRY",
      timezone: "Europe/Istanbul",
    });
    await tx.insert(schema.adCampaigns).values({
      id: ids.campaign,
      workspaceId: ids.workspace,
      adAccountId: ids.account,
      externalCampaignId: external.campaign,
      name: "S1.4 temporary campaign",
    });
    await tx.insert(schema.metaAdSets).values({
      id: ids.adSet,
      workspaceId: ids.workspace,
      adAccountId: ids.account,
      campaignId: ids.campaign,
      externalAdSetId: external.adSet,
      name: "S1.4 temporary ad set",
      rawPayloadHash: "1".repeat(64),
      sourceGraphVersion: "v24.0",
      fieldCatalogVersion: "s14-e2e-v1",
      provenance: {},
    });
    await tx.insert(schema.metaAds).values({
      id: ids.ad,
      workspaceId: ids.workspace,
      adAccountId: ids.account,
      campaignId: ids.campaign,
      adSetId: ids.adSet,
      externalAdId: external.ad,
      name: "S1.4 temporary ad",
      rawPayloadHash: "2".repeat(64),
      sourceGraphVersion: "v24.0",
      fieldCatalogVersion: "s14-e2e-v1",
      provenance: {},
    });
    await tx.insert(schema.metaAds).values({
      id: ids.ad2,
      workspaceId: ids.workspace,
      adAccountId: ids.account,
      campaignId: ids.campaign,
      adSetId: ids.adSet,
      externalAdId: external.ad2,
      name: "S1.4 temporary shared-creative ad",
      rawPayloadHash: "3".repeat(64),
      sourceGraphVersion: "v24.0",
      fieldCatalogVersion: "s14-e2e-v1",
      provenance: {},
    });
    await tx.insert(schema.metaSyncStreams).values({
      id: ids.stream,
      workspaceId: ids.workspace,
      metaConnectionId: ids.connection,
      adAccountId: ids.account,
      streamType: "creative",
      status: "running",
    });
    await tx.insert(schema.metaSyncRuns).values({
      id: ids.run,
      workspaceId: ids.workspace,
      metaConnectionId: ids.connection,
      adAccountId: ids.account,
      streamId: ids.stream,
      streamType: "creative",
      idempotencyKey: `e2e-${suffix}`,
      status: "running",
    });
    await tx.insert(schema.metaSyncSlices).values({
      id: ids.slice,
      workspaceId: ids.workspace,
      metaConnectionId: ids.connection,
      adAccountId: ids.account,
      runId: ids.run,
      streamType: "creative",
      entityLevel: "ad",
      sliceKey,
      status: "running",
    });
  });
} finally {
  await setup.pool.end();
}

function assetSnapshot() {
  const provenance = {
    sourceEdge: "/me/accounts",
    fetchedAt,
    sourceGraphVersion: "v24.0",
    fieldCatalogVersion: "s14-e2e-v1",
    rawPayloadHash: "a".repeat(64),
  };
  return normalizeMetaAssetMirror({
    schemaVersion: 1,
    workspaceId: ids.workspace,
    connectionExternalKey: external.connection,
    adAccountExternalIds: [external.account],
    assets: [{
      externalAssetId: external.page,
      assetType: "facebook_page",
      displayName: "S1.4 temporary page",
      username: null,
      ownership: { kind: "accessible", ownerBusinessExternalId: null, evidence: "/me/accounts" },
      capabilities: [{ operation: "read", status: "verified", reason: null }],
      orphanReason: null,
      provenance,
    }],
    edges: [{
      sourceType: "ad_account",
      sourceExternalId: external.account,
      targetExternalAssetId: external.page,
      relationship: "has_access_to_page",
      provenance,
    }],
    discoveries: [{
      resource: "pages",
      sourceType: "ad_account",
      sourceExternalId: external.account,
      status: "verified",
      reason: null,
      itemCount: 1,
      provenance,
    }],
    fetchedAt,
    writeOperations: 0,
  });
}

function content(primaryText: string, revision: string, externalAdId = external.ad) {
  const payload = {
    id: externalAdId,
    adset_id: external.adSet,
    campaign_id: external.campaign,
    effective_status: "ACTIVE",
    creative: {
      id: external.creative,
      body: primaryText,
      effective_object_story_id: external.post,
      object_story_spec: {
        page_id: external.page,
        link_data: { link: "https://example.test/s14" },
      },
    },
  };
  return {
    adAccountExternalId: external.account,
    extraction: extractMetaAdContent(payload),
    sourceRevision: revision,
    sourcePayloadHash: hashMetaContentPayload(payload),
    sourceGraphVersion: "v24.0",
    fieldCatalogVersion: "s14-e2e-v1",
    fetchedAt,
  };
}

let inserted = 0;
let unchanged = 0;
let stale = 0;
let updated = 0;
let checkpointAtomic = false;
let staleProtected = false;
let contentHashStableAcrossStatus = false;
let sharedCreativeBindings = false;
let temporaryWorkspaceRemoved = false;
let persistedCounts: Record<string, number> = {};

try {
  const connection = openDatabase();
  try {
    const run = await MetaAssetContentPersistenceRun.begin({
      repository: new DrizzleMetaAssetContentRepository(connection.db),
      scope: {
        workspaceId: ids.workspace,
        connectionId: ids.connection,
        connectionExternalKey: external.connection,
      },
      batchSize: 250,
    });
    const first = await run.writePage({
      sliceKey,
      cursor: "page-1",
      checkpoint: { page: 1 },
      assetSnapshot: assetSnapshot(),
      content: [content("Original copy", "10")],
    });
    inserted = first.inserted;
    const replay = await run.writePage({
      sliceKey,
      cursor: "page-1",
      checkpoint: { page: 1 },
      assetSnapshot: assetSnapshot(),
      content: [content("Original copy", "10")],
    });
    unchanged = replay.unchanged;
    const beforeStale = await connection.db.select({
      primaryText: schema.metaCreatives.primaryText,
      contentHash: schema.metaPosts.contentHash,
      creativeId: schema.metaAds.creativeId,
    }).from(schema.metaCreatives)
      .innerJoin(schema.metaPosts, eq(schema.metaCreatives.postId, schema.metaPosts.id))
      .innerJoin(schema.metaAds, eq(schema.metaAds.creativeId, schema.metaCreatives.id))
      .where(eq(schema.metaCreatives.workspaceId, ids.workspace))
      .limit(1);
    const staleResult = await run.writePage({
      sliceKey,
      cursor: "stale-page",
      checkpoint: { page: 2 },
      content: [content("Must not replace", "9")],
    });
    stale = staleResult.stale;
    const afterStale = await connection.db.select({
      primaryText: schema.metaCreatives.primaryText,
      contentHash: schema.metaPosts.contentHash,
      creativeId: schema.metaAds.creativeId,
    }).from(schema.metaCreatives)
      .innerJoin(schema.metaPosts, eq(schema.metaCreatives.postId, schema.metaPosts.id))
      .innerJoin(schema.metaAds, eq(schema.metaAds.creativeId, schema.metaCreatives.id))
      .where(eq(schema.metaCreatives.workspaceId, ids.workspace))
      .limit(1);
    staleProtected = beforeStale[0]?.primaryText === afterStale[0]?.primaryText
      && beforeStale[0]?.creativeId === afterStale[0]?.creativeId;

    const statusOnlyPayload = content("Original copy", "11");
    const statusOnlyExtraction = {
      ...statusOnlyPayload,
      extraction: {
        ...statusOnlyPayload.extraction,
        adContext: { ...statusOnlyPayload.extraction.adContext, effectiveStatus: "PAUSED" },
      },
      sourcePayloadHash: "b".repeat(64),
    };
    await run.writePage({
      sliceKey,
      cursor: "status-page",
      checkpoint: { page: 3 },
      content: [statusOnlyExtraction],
    });
    const afterStatus = await connection.db.select({ contentHash: schema.metaPosts.contentHash })
      .from(schema.metaPosts)
      .where(eq(schema.metaPosts.workspaceId, ids.workspace))
      .limit(1);
    contentHashStableAcrossStatus = beforeStale[0]?.contentHash === afterStatus[0]?.contentHash;

    const updateResult = await run.writePage({
      sliceKey,
      cursor: "page-4",
      checkpoint: { page: 4 },
      content: [content("Updated copy", "12")],
    });
    updated = updateResult.updated;

    await run.writePage({
      sliceKey,
      cursor: "shared-creative-page",
      checkpoint: { page: 5 },
      content: [
        content("Shared creative copy", "13", external.ad),
        content("Shared creative copy", "13", external.ad2),
      ],
    });
    const bindingCount = await connection.db.select({ value: count() })
      .from(schema.metaAdCreativeBindings)
      .where(eq(schema.metaAdCreativeBindings.workspaceId, ids.workspace));
    const creativeCount = await connection.db.select({ value: count() })
      .from(schema.metaCreatives)
      .where(eq(schema.metaCreatives.workspaceId, ids.workspace));
    sharedCreativeBindings = bindingCount[0]?.value === 2 && creativeCount[0]?.value === 1;

    const slice = await connection.db.select({
      cursor: schema.metaSyncSlices.cursor,
      checkpoint: schema.metaSyncSlices.checkpoint,
    }).from(schema.metaSyncSlices).where(eq(schema.metaSyncSlices.id, ids.slice)).limit(1);
    const runRow = await connection.db.select({ cursor: schema.metaSyncRuns.cursor })
      .from(schema.metaSyncRuns).where(eq(schema.metaSyncRuns.id, ids.run)).limit(1);
    const stream = await connection.db.select({ cursor: schema.metaSyncStreams.cursor })
      .from(schema.metaSyncStreams).where(eq(schema.metaSyncStreams.id, ids.stream)).limit(1);
    checkpointAtomic = slice[0]?.cursor === "shared-creative-page"
      && runRow[0]?.cursor === "shared-creative-page"
      && stream[0]?.cursor === "shared-creative-page"
      && typeof slice[0]?.checkpoint.assetContent === "object";

    const tableCounts = await Promise.all([
      connection.db.select({ value: count() }).from(schema.metaAssets).where(eq(schema.metaAssets.workspaceId, ids.workspace)),
      connection.db.select({ value: count() }).from(schema.metaAssetDiscoveries).where(eq(schema.metaAssetDiscoveries.workspaceId, ids.workspace)),
      connection.db.select({ value: count() }).from(schema.metaAssetEdges).where(eq(schema.metaAssetEdges.workspaceId, ids.workspace)),
      connection.db.select({ value: count() }).from(schema.metaPosts).where(eq(schema.metaPosts.workspaceId, ids.workspace)),
      connection.db.select({ value: count() }).from(schema.metaCreatives).where(eq(schema.metaCreatives.workspaceId, ids.workspace)),
      connection.db.select({ value: count() }).from(schema.metaAdCreativeBindings).where(eq(schema.metaAdCreativeBindings.workspaceId, ids.workspace)),
    ]);
    persistedCounts = Object.fromEntries(
      ["assets", "discoveries", "edges", "posts", "creatives", "bindings"]
        .map((key, index) => [key, tableCounts[index]?.[0]?.value ?? 0]),
    );

    const checkpointBeforeRollback = slice[0]?.cursor;
    const invalid = content("Invalid actor", "14");
    const post = invalid.extraction.post;
    let rejected = false;
    try {
      await run.writePage({
        sliceKey,
        cursor: "must-rollback",
        checkpoint: { page: 5 },
        content: [{
          ...invalid,
          extraction: {
            ...invalid.extraction,
            post: post ? { ...post, actorPageExternalId: `missing-${suffix}` } : null,
          },
        }],
      });
    } catch (error) {
      rejected = error instanceof Error;
    }
    const afterRollback = await connection.db.select({ cursor: schema.metaSyncSlices.cursor })
      .from(schema.metaSyncSlices).where(eq(schema.metaSyncSlices.id, ids.slice)).limit(1);
    checkpointAtomic = checkpointAtomic && rejected && afterRollback[0]?.cursor === checkpointBeforeRollback;
  } finally {
    await connection.pool.end();
  }
} finally {
  const cleanup = openDatabase();
  try {
    await cleanup.db.delete(schema.workspaces).where(eq(schema.workspaces.id, ids.workspace));
    const remaining = await cleanup.db.select({ value: count() })
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, ids.workspace));
    temporaryWorkspaceRemoved = remaining[0]?.value === 0;
  } finally {
    await cleanup.pool.end();
  }
}

const countsValid = Object.entries(persistedCounts).every(([key, value]) =>
  value === (key === "bindings" ? 2 : 1));
if (
  inserted !== 4
  || unchanged !== 4
  || stale !== 1
  || updated !== 1
  || !checkpointAtomic
  || !staleProtected
  || !contentHashStableAcrossStatus
  || !sharedCreativeBindings
  || !temporaryWorkspaceRemoved
  || !countsValid
) {
  throw new Error("S1.4 PostgreSQL asset/content kabulü başarısız");
}

console.log(JSON.stringify({
  inserted,
  unchanged,
  stale,
  updated,
  persistedCounts,
  checkpointAtomic,
  staleProtected,
  contentHashStableAcrossStatus,
  sharedCreativeBindings,
  temporaryWorkspaceRemoved,
  writeNetworkCalls: 0,
}));
