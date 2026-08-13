import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "../src/db/schema";
import { createDrizzleProductionMetaReadSyncService } from "../src/server/meta-read-sync-runtime";

process.loadEnvFile(".env.local");
const workspaceId = process.env.REKLAMZEKA_LOCAL_WORKSPACE_ID;
const recoveryAccountId = process.env.REKLAMZEKA_META_RECOVERY_ACCOUNT_ID;
const recoveryLane = process.env.REKLAMZEKA_META_RECOVERY_LANE ?? "inventory_ad_set_v1";
if (!workspaceId || !recoveryAccountId || !["inventory_ad_set_v1", "creative_ad_v1", "creative_ad_v2", "insights_ad_v1"].includes(recoveryLane)
  || process.env.META_TOKEN_SECURITY_STATUS !== "rotated") {
  throw new Error("read-only sync preflight rejected");
}

// The runtime is intentionally sequential. A single session connection keeps
// each immutable page checkpoint on one deterministic PostgreSQL channel.
const pool = new Pool({ connectionString: process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL, max: 1 });
// Nested creative payloads are materially wider than inventory rows. Keep the
// recovery page bounded without letting a caller choose the size.
const creativeLane = recoveryLane === "creative_ad_v1" || recoveryLane === "creative_ad_v2";
const initialPageSize = creativeLane ? 20 : 100;
const requestTimeoutMs = creativeLane ? 60_000 : 20_000;
const maxAttempts = creativeLane ? 1 : 3;

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
    recoveryAccountId,
    recoveryLaneId: recoveryLane as "inventory_ad_set_v1" | "creative_ad_v1" | "creative_ad_v2" | "insights_ad_v1",
  });
  // This is exactly one server-owned account + inventory/ad-set lane. Its
  // stable parent id restores the previous durable cursor; it does not fan out
  // to the rest of the account scope or to any other Meta stream.
  const result = await service.runRecoveryLane({
    dateStart: start.toISOString().slice(0, 10),
    dateStop: today.toISOString().slice(0, 10),
    dateSliceDays: 7,
    initialPageSize,
    requestTimeoutMs,
    maxAttempts,
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
