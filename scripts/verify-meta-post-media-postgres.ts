import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { and, count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { DrizzleMetaAssetContentRepository } from "@/connectors/meta/sync/asset-content-drizzle-repository";
import { MetaAssetContentPersistenceRun } from "@/connectors/meta/sync/asset-content-persistence";
import * as schema from "@/db/schema";
import {
  contentHashFor,
  normalizeMetaPostMediaInventory,
} from "@/domain/meta/content/post-media-inventory";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL yapılandırılmadı");

const suffix = randomUUID().replaceAll("-", "");
const ids = {
  workspace: randomUUID(),
  connection: randomUUID(),
  dataSource: randomUUID(),
  account: randomUUID(),
  pageAsset: randomUUID(),
  instagramAsset: randomUUID(),
  stream: randomUUID(),
  run: randomUUID(),
  slice: randomUUID(),
};
const external = {
  connection: `post-media-e2e-${suffix}`,
  account: `act_post_media_e2e_${suffix}`,
  page: `page-post-media-e2e-${suffix}`,
  instagram: `ig-post-media-e2e-${suffix}`,
  post: `post-media-e2e-${suffix}`,
};
const sliceKey = `post-media:${external.account}`;
const initialFetchedAt = "2026-08-07T11:30:00.000Z";
const verifiedAt = new Date("2026-08-07T11:00:00.000Z");

function openDatabase() {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 2,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 15_000,
  });
  return { pool, db: drizzle(pool, { schema }) };
}

function inventory(message: string, fetchedAt: string, actorExternalId = external.page) {
  const contentInput = {
    externalContentId: external.post,
    contentKind: "page_post" as const,
    actorType: "facebook_page" as const,
    actorExternalId,
    messageOrCaption: message,
    mediaType: "image" as const,
    publishedAt: "2026-08-07T09:00:00.000Z",
    lifecycle: "published" as const,
  };
  return normalizeMetaPostMediaInventory({
    schemaVersion: 1,
    workspaceId: ids.workspace,
    connectionExternalKey: external.connection,
    fetchedAt,
    items: [{
      externalContentId: contentInput.externalContentId,
      contentKind: contentInput.contentKind,
      actor: { type: contentInput.actorType, externalId: contentInput.actorExternalId, displayName: "Temporary Page", username: null },
      messageOrCaption: contentInput.messageOrCaption,
      mediaType: contentInput.mediaType,
      publishedAt: contentInput.publishedAt,
      lifecycle: contentInput.lifecycle,
      contentHash: contentHashFor(contentInput),
      ownership: { kind: "accessible", evidence: "/me/accounts" },
      readCapability: { status: "verified", evidence: "edge_read_succeeded" },
      promotionEligibility: { status: "unknown", reason: "not_verified_by_inventory_read" },
      previewSource: { classification: "server_only_sensitive", permalink: "https://example.test/server-only-preview" },
      provenance: {
        sourceEdge: `/${actorExternalId}/posts`,
        sourceGraphVersion: "v24.0",
        fieldCatalogVersion: "post-media-e2e-v1",
        fetchedAt,
        rawPayloadHash: contentHashFor(contentInput),
      },
    }],
    discoveries: [{
      actorType: "facebook_page",
      actorExternalId,
      sourceEdge: `/${actorExternalId}/posts`,
      status: "partial",
      itemCount: 1,
      reason: "pagination_limit",
      promotionEligibility: "unknown",
    }, {
      actorType: "instagram_account",
      actorExternalId: external.instagram,
      sourceEdge: `/${external.instagram}/media`,
      status: "permission_missing",
      itemCount: 0,
      reason: "permission_missing",
      promotionEligibility: "permission_missing",
    }],
    writeOperations: 0,
  });
}

const setup = openDatabase();
try {
  await setup.db.transaction(async (tx) => {
    await tx.insert(schema.workspaces).values({ id: ids.workspace, name: "Post/media temporary E2E" });
    await tx.insert(schema.metaConnections).values({
      id: ids.connection,
      workspaceId: ids.workspace,
      externalConnectionKey: external.connection,
      displayName: "Post/media temporary connection",
      graphApiVersion: "v24.0",
      fieldCatalogVersion: "post-media-e2e-v1",
    });
    await tx.insert(schema.dataSources).values({
      id: ids.dataSource,
      workspaceId: ids.workspace,
      metaConnectionId: ids.connection,
      platform: "meta_ads",
      externalAccountId: external.account,
      displayName: "Post/media temporary account",
    });
    await tx.insert(schema.adAccounts).values({
      id: ids.account,
      workspaceId: ids.workspace,
      dataSourceId: ids.dataSource,
      externalAccountId: external.account,
      name: "Post/media temporary account",
      currency: "TRY",
      timezone: "Europe/Istanbul",
    });
    const assetProvenance = {
      sourceRevision: initialFetchedAt,
      sourceEdge: "/me/accounts",
      sourceGraphVersion: "v24.0",
      fieldCatalogVersion: "post-media-e2e-v1",
    };
    await tx.insert(schema.metaAssets).values([{
      id: ids.pageAsset,
      workspaceId: ids.workspace,
      metaConnectionId: ids.connection,
      assetType: "facebook_page",
      externalAssetId: external.page,
      displayName: "Temporary Page",
      ownershipKind: "accessible",
      rawPayloadHash: "a".repeat(64),
      sourceGraphVersion: "v24.0",
      fieldCatalogVersion: "post-media-e2e-v1",
      provenance: assetProvenance,
    }, {
      id: ids.instagramAsset,
      workspaceId: ids.workspace,
      metaConnectionId: ids.connection,
      assetType: "instagram_account",
      externalAssetId: external.instagram,
      displayName: "Temporary Instagram",
      ownershipKind: "linked",
      rawPayloadHash: "b".repeat(64),
      sourceGraphVersion: "v24.0",
      fieldCatalogVersion: "post-media-e2e-v1",
      provenance: assetProvenance,
    }]);
    // Simulates the same canonical post first observed through active-ad extraction.
    await tx.insert(schema.metaPosts).values({
      workspaceId: ids.workspace,
      metaConnectionId: ids.connection,
      actorAssetId: ids.pageAsset,
      externalPostId: external.post,
      permalink: "https://example.test/active-ad-preview",
      promotionEligibilityStatus: "eligible",
      promotionEligibilityReason: "verified_existing_post",
      promotionEligibilityEvaluatedAt: verifiedAt,
      contentHash: "c".repeat(64),
      rawPayloadHash: "d".repeat(64),
      sourceGraphVersion: "v24.0",
      fieldCatalogVersion: "active-ad-e2e-v1",
      provenance: { sourceRevision: "10", sourceKind: "active_ad_extraction", sourcePriority: 10 },
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
      idempotencyKey: `post-media-e2e-${suffix}`,
      status: "running",
    });
    await tx.insert(schema.metaSyncSlices).values({
      id: ids.slice,
      workspaceId: ids.workspace,
      metaConnectionId: ids.connection,
      adAccountId: ids.account,
      runId: ids.run,
      streamType: "creative",
      sliceKey,
      status: "running",
    });
  });
} finally {
  await setup.pool.end();
}

let firstResult: { inserted: number; updated: number } | null = null;
let replayUnchanged = 0;
let inventoryWon = false;
let eligibilityPreserved = false;
let discoveriesPersisted = false;
let checkpointAtomic = false;
let actorRollback = false;
let temporaryWorkspaceRemoved = false;

try {
  const connection = openDatabase();
  try {
    const run = await MetaAssetContentPersistenceRun.begin({
      repository: new DrizzleMetaAssetContentRepository(connection.db),
      scope: { workspaceId: ids.workspace, connectionId: ids.connection, connectionExternalKey: external.connection },
      batchSize: 250,
    });
    const first = await run.writePage({
      sliceKey,
      cursor: "post-media-page-1",
      checkpoint: { edge: "posts", page: 1 },
      postMediaInventory: inventory("Inventory source message", initialFetchedAt),
      content: [],
    });
    firstResult = { inserted: first.inserted, updated: first.updated };
    const replay = await run.writePage({
      sliceKey,
      cursor: "post-media-page-1",
      checkpoint: { edge: "posts", page: 1 },
      postMediaInventory: inventory("Inventory source message", initialFetchedAt),
      content: [],
    });
    replayUnchanged = replay.unchanged;

    const post = await connection.db.select({
      sourceMessage: schema.metaPosts.sourceMessage,
      status: schema.metaPosts.promotionEligibilityStatus,
      reason: schema.metaPosts.promotionEligibilityReason,
      evaluatedAt: schema.metaPosts.promotionEligibilityEvaluatedAt,
      provenance: schema.metaPosts.provenance,
      permalink: schema.metaPosts.permalink,
    }).from(schema.metaPosts).where(and(
      eq(schema.metaPosts.workspaceId, ids.workspace),
      eq(schema.metaPosts.externalPostId, external.post),
    )).limit(1);
    inventoryWon = post[0]?.sourceMessage === "Inventory source message"
      && post[0]?.provenance.sourceKind === "post_media_inventory"
      && post[0]?.permalink === "https://example.test/server-only-preview";
    eligibilityPreserved = post[0]?.status === "eligible"
      && post[0]?.reason === "verified_existing_post"
      && post[0]?.evaluatedAt?.toISOString() === verifiedAt.toISOString();

    const discoveryRows = await connection.db.select({
      status: schema.metaAssetDiscoveries.status,
      provenance: schema.metaAssetDiscoveries.provenance,
    }).from(schema.metaAssetDiscoveries).where(eq(schema.metaAssetDiscoveries.workspaceId, ids.workspace));
    discoveriesPersisted = discoveryRows.length === 2
      && discoveryRows.some((row) => row.status === "partial" && row.provenance.promotionEligibility === "unknown")
      && discoveryRows.some((row) => row.status === "permission_missing" && row.provenance.promotionEligibility === "permission_missing");

    const beforeRollback = await connection.db.select({ cursor: schema.metaSyncSlices.cursor })
      .from(schema.metaSyncSlices).where(eq(schema.metaSyncSlices.id, ids.slice)).limit(1);
    try {
      await run.writePage({
        sliceKey,
        cursor: "must-not-commit",
        checkpoint: { edge: "posts", page: 2 },
        postMediaInventory: inventory("Wrong actor", "2026-08-07T11:31:00.000Z", `missing-${suffix}`),
        content: [],
      });
    } catch {
      const afterRollback = await connection.db.select({ cursor: schema.metaSyncSlices.cursor })
        .from(schema.metaSyncSlices).where(eq(schema.metaSyncSlices.id, ids.slice)).limit(1);
      actorRollback = afterRollback[0]?.cursor === beforeRollback[0]?.cursor;
    }
    const checkpoint = await connection.db.select({
      cursor: schema.metaSyncSlices.cursor,
      checkpoint: schema.metaSyncSlices.checkpoint,
    }).from(schema.metaSyncSlices).where(eq(schema.metaSyncSlices.id, ids.slice)).limit(1);
    checkpointAtomic = checkpoint[0]?.cursor === "post-media-page-1"
      && typeof checkpoint[0]?.checkpoint.assetContent === "object";
  } finally {
    await connection.pool.end();
  }
} finally {
  const cleanup = openDatabase();
  try {
    await cleanup.db.delete(schema.workspaces).where(eq(schema.workspaces.id, ids.workspace));
    const remaining = await cleanup.db.select({ value: count() })
      .from(schema.workspaces).where(eq(schema.workspaces.id, ids.workspace));
    temporaryWorkspaceRemoved = remaining[0]?.value === 0;
  } finally {
    await cleanup.pool.end();
  }
}

if (
  firstResult?.inserted !== 2
  || firstResult.updated !== 1
  || replayUnchanged !== 3
  || !inventoryWon
  || !eligibilityPreserved
  || !discoveriesPersisted
  || !checkpointAtomic
  || !actorRollback
  || !temporaryWorkspaceRemoved
) throw new Error("Post/media PostgreSQL kabulü başarısız");

console.log(JSON.stringify({
  firstResult,
  replayUnchanged,
  inventoryWon,
  eligibilityPreserved,
  discoveriesPersisted,
  checkpointAtomic,
  actorRollback,
  temporaryWorkspaceRemoved,
  writeNetworkCalls: 0,
}));
