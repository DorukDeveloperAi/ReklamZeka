import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { and, count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/db/schema";
import { TransactionBackedMetaSyncPersistenceAdapter, DrizzleMetaSyncTransactionManager } from "@/connectors/meta/sync/persistence-adapter";
import { MetaPartialReadSyncRuntime } from "@/connectors/meta/sync/runtime";
import type { MetaReadRequest, MetaReadTransport, MetaSyncSlice } from "@/connectors/meta/sync/types";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL yapılandırılmadı");

const workspaceId = randomUUID();
const connectionId = randomUUID();
const dataSourceId = randomUUID();
const accountId = randomUUID();
const parentRunId = randomUUID();
const externalAccountId = `act_e2e_${randomUUID().replaceAll("-", "")}`;
const slice: MetaSyncSlice = {
  id: `insights:${externalAccountId}:campaign:2026-08-01:2026-08-01`,
  stream: "insights", accountId: externalAccountId, entityLevel: "campaign",
  dateStart: "2026-08-01", dateStop: "2026-08-01", pageSize: 2,
};

class Transport implements MetaReadTransport {
  readonly requests: MetaReadRequest[] = [];
  constructor(private readonly respond: (request: MetaReadRequest) => ReturnType<MetaReadTransport["get"]>) {}
  get(request: MetaReadRequest) { this.requests.push(request); return this.respond(request); }
}

function database() {
  const pool = new Pool({ connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 10_000 });
  return { pool, db: drizzle(pool, { schema }) };
}

const setup = database();
try {
  await setup.db.transaction(async (tx) => {
    await tx.insert(schema.workspaces).values({ id: workspaceId, name: "Meta sync E2E temporary workspace" });
    await tx.insert(schema.metaConnections).values({
      id: connectionId, workspaceId, externalConnectionKey: `e2e-${connectionId}`,
      displayName: "Meta sync E2E", graphApiVersion: "v23.0", fieldCatalogVersion: "e2e-v1",
    });
    await tx.insert(schema.dataSources).values({
      id: dataSourceId, workspaceId, metaConnectionId: connectionId,
      platform: "meta_ads", externalAccountId, displayName: "Meta sync E2E account",
    });
    await tx.insert(schema.adAccounts).values({
      id: accountId, workspaceId, dataSourceId, externalAccountId,
      name: "Meta sync E2E account", currency: "TRY", timezone: "Europe/Istanbul",
    });
  });
} finally {
  await setup.pool.end();
}

let firstStatus = "unknown";
let restoredStatus = "unknown";
let restoredCursor: string | null = null;
let persistedRuns = 0;
let persistedSlices = 0;
let ledgerRecords = 0;

try {
  const firstConnection = database();
  const firstTransport = new Transport(async (request) => {
    if (request.cursor === "page-2") throw new Error("fixture connection restart");
    return { records: [{ id: "campaign-page-1" }], nextCursor: "page-2", usageHeadroom: 0.5 };
  });
  try {
    const persistence = new TransactionBackedMetaSyncPersistenceAdapter(new DrizzleMetaSyncTransactionManager(firstConnection.db));
    const partial = await new MetaPartialReadSyncRuntime({ transport: firstTransport, persistence, maxAttempts: 1 }).run({ parentRunId, workspaceId, connectionId, plan: [slice] });
    firstStatus = partial.parentRun.status;
  } finally {
    await firstConnection.pool.end();
  }

  const restartedConnection = database();
  const restartedTransport = new Transport(async (request) => ({ records: [{ id: "campaign-page-2" }], nextCursor: null, usageHeadroom: 0.5 }));
  try {
    const persistence = new TransactionBackedMetaSyncPersistenceAdapter(new DrizzleMetaSyncTransactionManager(restartedConnection.db));
    const resumed = await new MetaPartialReadSyncRuntime({ transport: restartedTransport, persistence }).run({ parentRunId, workspaceId, connectionId, plan: [slice] });
    restoredStatus = resumed.parentRun.status;
    restoredCursor = restartedTransport.requests[0]?.cursor ?? null;
    persistedRuns = (await restartedConnection.db.select({ value: count() }).from(schema.metaSyncRuns).where(eq(schema.metaSyncRuns.workspaceId, workspaceId)))[0]?.value ?? 0;
    persistedSlices = (await restartedConnection.db.select({ value: count() }).from(schema.metaSyncSlices).where(eq(schema.metaSyncSlices.workspaceId, workspaceId)))[0]?.value ?? 0;
    ledgerRecords = (await restartedConnection.db.select({ value: count() }).from(schema.metaSyncRecordLedger).where(and(eq(schema.metaSyncRecordLedger.workspaceId, workspaceId), eq(schema.metaSyncRecordLedger.metaConnectionId, connectionId))))[0]?.value ?? 0;
  } finally {
    await restartedConnection.pool.end();
  }
} finally {
  const cleanup = database();
  try { await cleanup.db.delete(schema.workspaces).where(eq(schema.workspaces.id, workspaceId)); }
  finally { await cleanup.pool.end(); }
}

if (firstStatus !== "partial" || restoredStatus !== "completed" || restoredCursor !== "page-2" || persistedRuns !== 1 || persistedSlices !== 1 || ledgerRecords !== 2) {
  throw new Error("PostgreSQL Meta sync restart kabulü başarısız");
}

console.log(JSON.stringify({
  firstStatus, restoredStatus, restoredFromCursor: true,
  persistedRuns, persistedSlices, ledgerRecords,
  temporaryWorkspaceRemoved: true, writeNetworkCalls: 0,
}));
