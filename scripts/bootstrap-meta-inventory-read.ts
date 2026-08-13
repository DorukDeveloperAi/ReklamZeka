import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { DrizzleMetaConnectionRepository } from "../src/connectors/meta/connection-drizzle-repository";
import { DrizzleEnvironmentMetaSecretRepository } from "../src/connectors/meta/environment-secret-drizzle-repository";
import { MetaGraphClient } from "../src/connectors/meta/graph-client";
import { MetaGraphSyncTransport } from "../src/connectors/meta/sync/graph-transport";
import { DrizzleMetaInventoryPagePersistence } from "../src/connectors/meta/sync/inventory-drizzle-repository";
import { planMetaReadSync } from "../src/connectors/meta/sync/planner";
import { MetaPartialReadSyncRuntime } from "../src/connectors/meta/sync/runtime";
import { DrizzleMetaSyncAccountScopeResolver } from "../src/server/meta-read-sync-runtime";
import * as schema from "../src/db/schema";

process.loadEnvFile(".env.local");

const workspaceId = process.env.REKLAMZEKA_LOCAL_WORKSPACE_ID;
const connectionId = "6d695103-4dc0-44ba-8a1b-67702449c4a1";
if (!workspaceId || process.env.META_TOKEN_SECURITY_STATUS !== "rotated") {
  throw new Error("read-only inventory bootstrap preflight rejected");
}

const pool = new Pool({ connectionString: process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL, max: 1 });
try {
  const database = drizzle(pool, { schema });
  const connections = new DrizzleMetaConnectionRepository(database);
  const connection = await connections.find(workspaceId, connectionId);
  if (connection.status !== "active" || connection.accessMode !== "read_only") throw new Error("read-only connection unavailable");
  const accountIds = await new DrizzleMetaSyncAccountScopeResolver(database).resolve({ workspaceId, connectionId });
  if (accountIds.length === 0) throw new Error("account scope unavailable");
  const token = await new DrizzleEnvironmentMetaSecretRepository(database, process.env)
    .resolve(connection.secretReference, { workspaceId, connectionId });
  const now = new Date();
  const runtime = new MetaPartialReadSyncRuntime({
    transport: new MetaGraphSyncTransport(new MetaGraphClient(token, undefined, {
      graphApiVersion: connection.graphApiVersion, requestTimeoutMs: 5_000, maxAttempts: 1,
    })),
    inventoryPagePersistence: new DrizzleMetaInventoryPagePersistence(database, undefined, {
      materializeAffectedGeo: false,
      transactionMode: "idempotent_page",
    }),
    maxAttempts: 1,
  });
  const plan = planMetaReadSync({
    accountIds,
    dateStart: now.toISOString().slice(0, 10),
    dateStop: now.toISOString().slice(0, 10),
    initialPageSize: 10,
  }).filter((slice) => slice.stream === "inventory");
  const result = await runtime.run({
    parentRunId: `meta.inventory.bootstrap.${now.toISOString().slice(0, 10).replaceAll("-", "")}`,
    workspaceId,
    connectionId,
    plan,
  });
  console.log(JSON.stringify({
    status: result.parentRun.status,
    streamCounts: { completed: result.streamRuns.filter((stream) => stream.status === "completed").length,
      partial: result.streamRuns.filter((stream) => stream.status === "partial").length },
    inventoryRecords: result.inserted + result.updated + result.unchanged,
    durableLedger: false,
    pageAtomicity: "idempotent_retry",
    affectedGeoMaterialization: "deferred",
    writeNetworkCalls: 0,
  }));
} finally {
  await pool.end();
}
