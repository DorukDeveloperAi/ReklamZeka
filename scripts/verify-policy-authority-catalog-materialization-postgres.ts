import { existsSync } from "node:fs";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const databaseUrl = process.env.DIRECT_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  process.stderr.write(`${JSON.stringify({ ok: false, blocker: "postgres_connection_not_configured",
    requiredOneOf: ["DIRECT_DATABASE_URL", "DATABASE_URL"], continuation: "npm run verify:policy-authority-catalog-db" })}\n`);
  process.exit(2);
}

const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 20_000 });
const database = drizzle(pool);
try {
  const rows = (await database.execute(sql`select
    to_regclass('public.policy_authority_catalogs') is not null as catalogs,
    to_regclass('public.tenant_authority_snapshot_heads') is not null as snapshot_heads,
    exists (select 1 from pg_trigger where tgname = 'policy_authority_catalogs_head_trigger' and not tgisinternal) as catalog_head_guard,
    exists (select 1 from pg_trigger where tgname = 'tenant_authority_snapshot_heads_head_trigger' and not tgisinternal) as snapshot_head_guard`)).rows[0] as Record<string, unknown> | undefined;
  if (!rows || Object.values(rows).some((value) => value !== true)) throw new Error("authority_catalog_materialization_schema_missing");
  console.log(JSON.stringify({ ok: true, capabilities: { canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false } }));
} finally { await pool.end(); }
