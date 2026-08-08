import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/db/schema";
import { DrizzleCategoryInventoryRepository } from "@/connectors/categories/category-inventory-drizzle-repository";

const databaseUrl = process.env.DIRECT_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
const workspaceId = process.env.REKLAMZEKA_LOCAL_WORKSPACE_ID?.trim();
if (!databaseUrl || !workspaceId) throw new Error("Kategori envanteri kabul ortamı yapılandırılmadı");
const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 8_000,
  statement_timeout: 15_000, idleTimeoutMillis: 5_000, allowExitOnIdle: true });
try {
  const snapshot = await new DrizzleCategoryInventoryRepository(drizzle(pool, { schema })).list(workspaceId);
  const definitions = snapshot.dimensions.reduce((total, dimension) => total + dimension.definitions.length, 0);
  const directCoverageRows = snapshot.dimensions.reduce((total, dimension) => total + dimension.coverage.length, 0);
  const manualLocks = snapshot.dimensions.reduce((total, dimension) => total + dimension.definitions.reduce(
    (sum, definition) => sum + definition.assignments.manualLocked, 0), 0);
  process.stdout.write(`${JSON.stringify({ ok: true, access: "read_only", dimensions: snapshot.dimensions.length,
    definitions, directCoverageRows, manualLocks, health: snapshot.health, metaNetworkCalls: 0,
    databaseWrites: 0, metaWriteCalls: 0 })}\n`);
} finally { await pool.end(); }
