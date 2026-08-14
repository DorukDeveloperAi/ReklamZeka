import { existsSync } from "node:fs";
import { Pool } from "pg";
import { evaluateFieldPilotSourceCoverage } from "@/pilot/field-pilot-source-coverage";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const databaseUrl = process.env.DIRECT_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  process.stderr.write(`${JSON.stringify({ ok: false, blocker: "postgres_connection_not_configured", continuation: "npm run census:field-pilot-source-db" })}\n`);
  process.exit(2);
}

type AggregateRow = Readonly<{
  workspace_count: number | string;
  account_count: number | string;
  fresh_workspace_count: number | string;
  fresh_account_count: number | string;
  feedback_workspace_count: number | string;
}>;

function integer(value: number | string | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 20_000 });
try {
  const client = await pool.connect();
  try {
    await client.query("begin transaction isolation level repeatable read read only");
    const { rows } = await client.query<AggregateRow>(`
      with active_inventory as (
        select distinct a.workspace_id, a.id as account_id
        from ad_accounts a
        join data_sources ds on ds.id = a.data_source_id and ds.workspace_id = a.workspace_id
        join meta_connections mc on mc.id = ds.meta_connection_id and mc.workspace_id = a.workspace_id
        join workspaces w on w.id = a.workspace_id and w.lifecycle_state = 'active'
        where a.disappeared_at is null and mc.status = 'active'
      ),
      fresh_inventory as (
        select ai.workspace_id, ai.account_id
        from active_inventory ai
        where exists (
          select 1 from meta_sync_runs run
          where run.workspace_id = ai.workspace_id
            and run.ad_account_id = ai.account_id
            and run.status = 'completed'
            and run.finished_at >= statement_timestamp() - interval '60 minutes'
        )
      ),
      feedback_workspaces as (
        select distinct feedback.workspace_id
        from insight_feedback feedback
        join workspaces w on w.id = feedback.workspace_id and w.lifecycle_state = 'active'
        where feedback.workspace_id in (select distinct workspace_id from active_inventory)
      )
      select
        (select count(distinct workspace_id)::int from active_inventory) as workspace_count,
        (select count(*)::int from active_inventory) as account_count,
        (select count(distinct workspace_id)::int from fresh_inventory) as fresh_workspace_count,
        (select count(*)::int from fresh_inventory) as fresh_account_count,
        (select count(*)::int from feedback_workspaces) as feedback_workspace_count
    `);
    await client.query("rollback");
    const row = rows[0];
    const census = evaluateFieldPilotSourceCoverage({
      accountInventory: { workspaceCount: integer(row?.workspace_count), accountCount: integer(row?.account_count) },
      freshSync: { workspaceCount: integer(row?.fresh_workspace_count), accountCount: integer(row?.fresh_account_count) },
      feedback: { workspaceCount: integer(row?.feedback_workspace_count) },
    });
    const ok = census.workspaceCount >= 3 && census.accountCount >= 10 && census.sourceBackedCriteriaComplete;
    process.stdout.write(`${JSON.stringify({ ok, readOnly: true, isolation: "repeatable_read", ...census })}\n`);
    if (!ok) process.exitCode = 2;
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
