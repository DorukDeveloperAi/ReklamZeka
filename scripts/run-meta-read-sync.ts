import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "../src/db/schema";
import { createDrizzleProductionMetaReadSyncService } from "../src/server/meta-read-sync-runtime";

process.loadEnvFile(".env.local");
const workspaceId = process.env.REKLAMZEKA_LOCAL_WORKSPACE_ID;
const recoveryInventoryAdSetAccountId = process.env.REKLAMZEKA_META_RECOVERY_ACCOUNT_ID;
if (!workspaceId || !recoveryInventoryAdSetAccountId || process.env.META_TOKEN_SECURITY_STATUS !== "rotated") {
  throw new Error("read-only sync preflight rejected");
}

// The runtime is intentionally sequential. A single session connection keeps
// each immutable page checkpoint on one deterministic PostgreSQL channel.
const pool = new Pool({ connectionString: process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL, max: 1 });

try {
  const database = drizzle(pool, { schema });
  const today = new Date();
  const start = new Date(today.valueOf() - 7 * 86_400_000);
  const service = createDrizzleProductionMetaReadSyncService({
    database,
    scopeResolver: { resolve: async () => ({ workspaceId, connectionId: "6d695103-4dc0-44ba-8a1b-67702449c4a1" }) },
    environment: process.env,
    deferAffectedGeoMaterialization: true,
    inventoryTransactionMode: "idempotent_page",
    durableTransactionMode: "idempotent_checkpoint",
    recoveryInventoryAdSetAccountId,
  });
  // This is exactly one server-owned account + inventory/ad-set lane. Its
  // stable parent id restores the previous durable cursor; it does not fan out
  // to the rest of the account scope or to any other Meta stream.
  const result = await service.runRecoveryLane({
    dateStart: start.toISOString().slice(0, 10),
    dateStop: today.toISOString().slice(0, 10),
    dateSliceDays: 7,
    initialPageSize: 100,
    requestTimeoutMs: 20_000,
    maxAttempts: 3,
    maxRunDurationMs: 90_000,
  });
  console.log(JSON.stringify(result));
} catch (error) {
  // Native fetch errors may carry URLs or request headers; keep CLI output
  // structured and redacted even when the sync fails before a checkpoint.
  console.log(JSON.stringify({
    status: "failed",
    errorCode: error instanceof Error && error.name === "ProductionMetaReadSyncError" ? "sync_failed" : "unexpected_failure",
    writeNetworkCalls: 0,
  }));
  process.exitCode = 1;
} finally {
  await pool.end();
}
