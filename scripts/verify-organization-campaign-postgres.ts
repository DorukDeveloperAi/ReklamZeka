import { existsSync } from "node:fs";
import { Pool } from "pg";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) { console.error(JSON.stringify({ ok: false, blocker: "postgres_connection_not_configured" })); process.exit(2); }

/**
 * Bounded preflight for the organization-campaign live verifier. It is safe
 * to rerun: no fixture is started until the migration ledger and tables are
 * present, and every query has connection/statement/query time limits.
 */
const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 5_000, statement_timeout: 5_000, query_timeout: 5_000 });
try {
  const client = await pool.connect();
  try {
    const tables = await client.query("select to_regclass('public.organization_campaigns') org, to_regclass('public.organization_campaign_meta_memberships') links");
    if (!tables.rows[0]?.org || !tables.rows[0]?.links) { console.error(JSON.stringify({ ok: false, blocker: "organization_campaign_migration_not_applied" })); process.exitCode = 2; }
    else console.log(JSON.stringify({ ok: true, ready: true, verifier: "preflight_only", next: "run fixture assertions after DNS/database access is available" }));
  } finally { client.release(); }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ ok: false, blocker: /ENOTFOUND|EAI_AGAIN/.test(message) ? "external_dns_unavailable" : "postgres_unavailable", detail: message }));
  process.exitCode = 2;
} finally { await pool.end(); }
