import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { and, count, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { MetaS14LiveAssetContentService, repositoryBackedMetaAssetContentRun } from "@/connectors/meta/sync/live-asset-content-service";
import { DrizzleMetaAssetContentRepository } from "@/connectors/meta/sync/asset-content-drizzle-repository";
import { sliceId } from "@/connectors/meta/sync/types";
import * as schema from "@/db/schema";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const databaseUrl = process.env.DIRECT_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
const token = process.env.META_ACCESS_TOKEN?.trim();
const workspaceId = process.env.META_S14_RECOVERY_WORKSPACE_ID?.trim();
const connectionId = process.env.META_S14_RECOVERY_CONNECTION_ID?.trim();
const maxAccounts = Number(process.env.META_S14_RECOVERY_MAX_ACCOUNTS ?? "2");

if (!databaseUrl || !token || !workspaceId || !connectionId) {
  throw new Error("DATABASE_URL, META_ACCESS_TOKEN, META_S14_RECOVERY_WORKSPACE_ID ve META_S14_RECOVERY_CONNECTION_ID yapılandırılmalı");
}
if (process.env.META_TOKEN_SECURITY_STATUS !== "rotated") throw new Error("Token rotasyonu doğrulanmadı");
if (!Number.isSafeInteger(maxAccounts) || maxAccounts < 1 || maxAccounts > 5) throw new Error("META_S14_RECOVERY_MAX_ACCOUNTS 1-5 aralığında olmalı");

const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 30_000 });
const database = drizzle(pool, { schema });
let writeNetworkCalls = 0;

const trackedFetch: typeof fetch = async (input, init) => {
  const method = (init?.method ?? "GET").toUpperCase();
  if (method !== "GET") {
    writeNetworkCalls += 1;
    throw new Error("S1.4 materialization GET dışı Meta çağrısını reddetti");
  }
  const timeout = AbortSignal.timeout(20_000);
  const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  return fetch(input, { ...init, signal });
};

try {
  const [connection] = await database.select({
    id: schema.metaConnections.id,
    externalConnectionKey: schema.metaConnections.externalConnectionKey,
  }).from(schema.metaConnections).where(and(
    eq(schema.metaConnections.workspaceId, workspaceId),
    eq(schema.metaConnections.id, connectionId),
    eq(schema.metaConnections.status, "active"),
    eq(schema.metaConnections.accessMode, "read_only"),
  )).limit(1);
  if (!connection) throw new Error("Etkin salt-okunur Meta bağlantı kapsamı bulunamadı");

  // The bounded selection comes exclusively from the active server-side
  // connection scope; no account or actor is accepted from the command caller.
  const accounts = await database.select({ id: schema.adAccounts.id, externalId: schema.adAccounts.externalAccountId })
    .from(schema.adAccounts)
    .innerJoin(schema.dataSources, eq(schema.adAccounts.dataSourceId, schema.dataSources.id))
    .where(and(
      eq(schema.adAccounts.workspaceId, workspaceId),
      eq(schema.dataSources.workspaceId, workspaceId),
      eq(schema.dataSources.metaConnectionId, connectionId),
    ))
    .orderBy(schema.adAccounts.id)
    .limit(maxAccounts);
  if (accounts.length === 0) throw new Error("Etkin bağlantı kapsamında kalıcı reklam hesabı bulunamadı");

  // Setup writes are short local transactions and finish before any Graph GET.
  // Each run gets fresh slices, avoiding mutation of an unrelated cursor.
  const runByAccount = new Map<string, string>();
  for (const account of accounts) {
    const [existing] = await database.select({ id: schema.metaSyncStreams.id }).from(schema.metaSyncStreams).where(and(
      eq(schema.metaSyncStreams.workspaceId, workspaceId),
      eq(schema.metaSyncStreams.metaConnectionId, connectionId),
      eq(schema.metaSyncStreams.adAccountId, account.id),
      eq(schema.metaSyncStreams.streamType, "creative"),
    )).limit(1);
    const streamId = existing?.id ?? randomUUID();
    if (!existing) await database.insert(schema.metaSyncStreams).values({
      id: streamId, workspaceId, metaConnectionId: connectionId, adAccountId: account.id, streamType: "creative", status: "running",
    });
    const runId = randomUUID();
    await database.insert(schema.metaSyncRuns).values({
      id: runId, workspaceId, metaConnectionId: connectionId, adAccountId: account.id, streamId, streamType: "creative",
      idempotencyKey: `s14-recovery-${randomUUID()}`, status: "running",
    });
    await database.insert(schema.metaSyncSlices).values({
      workspaceId, metaConnectionId: connectionId, adAccountId: account.id, runId, streamType: "creative", entityLevel: "ad",
      sliceKey: sliceId("creative_post", account.externalId, "ad", null, null), status: "running",
    });
    runByAccount.set(account.externalId, runId);
  }
  const first = accounts[0]!;
  const firstRunId = runByAccount.get(first.externalId)!;
  const assetSliceKey = `s14-recovery-asset:${randomUUID()}`;
  const postMediaSliceKey = `s14-recovery-post-media:${randomUUID()}`;
  await database.insert(schema.metaSyncSlices).values([assetSliceKey, postMediaSliceKey].map((sliceKey) => ({
    workspaceId, metaConnectionId: connectionId, adAccountId: first.id, runId: firstRunId, streamType: "creative" as const, sliceKey, status: "running" as const,
  })));

  const externalIds = accounts.map((account) => account.externalId);
  const countRows = async () => {
    const [assets, posts, creatives, bindings] = await Promise.all([
      database.select({ value: count() }).from(schema.metaAssets).where(and(eq(schema.metaAssets.workspaceId, workspaceId), eq(schema.metaAssets.metaConnectionId, connectionId))),
      database.select({ value: count() }).from(schema.metaPosts).where(and(eq(schema.metaPosts.workspaceId, workspaceId), eq(schema.metaPosts.metaConnectionId, connectionId))),
      database.select({ value: count() }).from(schema.metaCreatives).where(and(eq(schema.metaCreatives.workspaceId, workspaceId), inArray(schema.metaCreatives.adAccountId, accounts.map((account) => account.id)))),
      database.select({ value: count() }).from(schema.metaAdCreativeBindings)
        .innerJoin(schema.metaCreatives, eq(schema.metaAdCreativeBindings.creativeId, schema.metaCreatives.id))
        .where(and(eq(schema.metaAdCreativeBindings.workspaceId, workspaceId), inArray(schema.metaCreatives.adAccountId, accounts.map((account) => account.id)))),
    ]);
    return { assets: assets[0]?.value ?? 0, posts: posts[0]?.value ?? 0, creatives: creatives[0]?.value ?? 0, bindings: bindings[0]?.value ?? 0 };
  };
  const before = await countRows();
  const repository = new DrizzleMetaAssetContentRepository(database);
  const service = new MetaS14LiveAssetContentService({
    secretResolver: { resolve: async () => token },
    beginPersistenceRun: repositoryBackedMetaAssetContentRun(repository),
    fetchImpl: trackedFetch,
    maxPagesPerAccount: 1,
    maxPagesPerActor: 1,
    accountConcurrency: 1,
    initialPageSize: 25,
    minPageSize: 25,
    maxAttempts: 1,
  });
  const result = await service.run({
    runId: firstRunId,
    workspaceId,
    connectionId,
    connectionExternalKey: connection.externalConnectionKey,
    secretReference: "env:META_ACCESS_TOKEN",
    selectedAdAccountExternalIds: externalIds,
    sliceKeys: {
      asset: assetSliceKey,
      postMedia: postMediaSliceKey,
      creativeByAdAccountExternalId: Object.fromEntries(externalIds.map((externalId) => [externalId, sliceId("creative_post", externalId, "ad", null, null)])),
    },
  });
  const after = await countRows();
  const delta = Object.fromEntries(Object.entries(after).map(([key, value]) => [key, value - before[key as keyof typeof before]]));
  const status = writeNetworkCalls === 0 && result.postInventoryEvidence.recoveredItems > 0 ? "completed" : "partial";
  console.log(JSON.stringify({
    schemaVersion: "meta-s14-recovery-materialization-v1",
    status,
    selectedAccounts: accounts.length,
    recovery: {
      targetActors: result.postInventoryEvidence.recoveryTargetActors,
      recoveredItems: result.postInventoryEvidence.recoveredItems,
      partialDiscoveries: result.postInventoryEvidence.partialDiscoveries,
    },
    canonicalWriteSummary: result.persistenceEvidence,
    databaseDelta: delta,
    metaNetwork: { writeCalls: writeNetworkCalls },
  }));
  if (writeNetworkCalls !== 0 || result.postInventoryEvidence.recoveredItems === 0) process.exitCode = 2;
} finally {
  await pool.end();
}
