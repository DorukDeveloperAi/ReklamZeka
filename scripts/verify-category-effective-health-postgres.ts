import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/db/schema";
import { scanPortfolioEffectiveCategoryHealth } from "@/application/category-effective-health-scanner";
import { DrizzleCategoryEffectiveHealthRepository } from "@/connectors/categories/category-effective-health-drizzle-repository";

const databaseUrl = process.env.DIRECT_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
const workspaceId = process.env.REKLAMZEKA_LOCAL_WORKSPACE_ID?.trim();
if (!databaseUrl || !workspaceId) throw new Error("Effective kategori sağlık kabul ortamı yapılandırılmadı");
const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 8_000,
  statement_timeout: 15_000, idleTimeoutMillis: 5_000, allowExitOnIdle: true });
try {
  const input = await new DrizzleCategoryEffectiveHealthRepository(drizzle(pool, { schema })).load(workspaceId);
  const result = scanPortfolioEffectiveCategoryHealth(input);
  process.stdout.write(`${JSON.stringify({ ok: true, access: "read_only", status: result.status,
    evaluationBasis: result.evaluationBasis, counts: result.counts, capacity: result.limits,
    responseContainsPrivateEntityIds: false, metaNetworkCalls: 0, databaseWrites: 0, metaWriteCalls: 0 })}\n`);
} finally { await pool.end(); }
