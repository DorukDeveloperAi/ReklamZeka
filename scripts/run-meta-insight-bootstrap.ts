import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "../src/db/schema";
import { createDrizzleProductionMetaReadSyncService } from "../src/server/meta-read-sync-runtime";

process.loadEnvFile(".env.local");

const workspaceId = process.env.REKLAMZEKA_LOCAL_WORKSPACE_ID?.trim();
const databaseUrl = process.env.DIRECT_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!workspaceId || !databaseUrl || process.env.META_TOKEN_SECURITY_STATUS !== "rotated") {
  throw new Error("read-only insight bootstrap preflight rejected");
}

const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 10_000,
  statement_timeout: 300_000 });

try {
  const database = drizzle(pool, { schema });
  // The connection is DB-derived, not a CLI argument. Ambiguity is unsafe:
  // this bootstrap intentionally operates on one active read-only binding.
  const scopeResolver = {
    resolve: async () => {
      const rows = await database.select({ connectionId: schema.metaConnections.id })
        .from(schema.metaConnections)
        .where(and(
          eq(schema.metaConnections.workspaceId, workspaceId),
          eq(schema.metaConnections.status, "active"),
          eq(schema.metaConnections.accessMode, "read_only"),
        )).limit(2);
      if (rows.length !== 1) throw new Error("server-derived read-only connection unavailable");
      return { workspaceId, connectionId: rows[0]!.connectionId };
    },
  };
  const service = createDrizzleProductionMetaReadSyncService({
    database,
    scopeResolver,
    deferAffectedGeoMaterialization: true,
    inventoryTransactionMode: "idempotent_page",
    durableTransactionMode: "idempotent_checkpoint",
  });
  // Only closed UTC dates are eligible. The 30-day window has a stable parent
  // ID per range, so a timeout resumes its exact durable cursor on rerun.
  const end = new Date(Date.now() - 86_400_000);
  const start = new Date(end.valueOf() - 29 * 86_400_000);
  const result = await service.runInsightBootstrap({
    dateStart: start.toISOString().slice(0, 10),
    dateStop: end.toISOString().slice(0, 10),
    dateSliceDays: 7,
    initialPageSize: 25,
    requestTimeoutMs: 60_000,
    maxAttempts: 1,
    maxRunDurationMs: 300_000,
  });
  console.log(JSON.stringify(result));
} catch (error) {
  console.log(JSON.stringify({
    status: "failed",
    errorCode: error instanceof Error && error.name === "ProductionMetaReadSyncError" ? "sync_failed" : "unexpected_failure",
    writeNetworkCalls: 0,
  }));
  process.exitCode = 1;
} finally {
  await pool.end();
}
