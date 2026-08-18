import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { Pool } from "pg";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL yapılandırılmadı");
const migrationSql = readFileSync("drizzle/20260818000500_p06_budget_execution_binding.sql", "utf8");
const migrationHash = createHash("sha256").update(migrationSql).digest("hex");
const postMode = process.env.P06_BUDGET_EXECUTION_POST_APPROVED === "true";
const names = ["p06_execution_runs", "p06_execution_events", "p06_execution_heads", "p06_execution_observations",
  "p06_execution_gate_snapshots", "p06_rollback_proposals"];
const evidence = { mode: postMode ? "post_applied" : "pre_outer_rollback", migrationHash, baseInstalledOuterRollback: false, migrationInstalledOuterRollback: false,
  sourceXor: false, requestContract: false, attemptFk: false, attemptUnique: false, attemptIndex: false, guardReplaced: false,
  rlsForced: false, publicRevoked: false, unjournaled: false, zeroResidue: false };
const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 30_000 });
const client = await pool.connect();
try {
  const before = await client.query<{ objects: number; ledger: number }>(`select
    (select count(*)::int from pg_class where relnamespace='public'::regnamespace and relname=any($1::text[])) objects,
    (select count(*)::int from drizzle.__drizzle_migrations where hash=$2 and created_at=1787011500000) ledger`, [names, migrationHash]);
  if (before.rows[0]?.objects !== 6 || before.rows[0]?.ledger !== (postMode ? 1 : 0)) throw new Error("P06 budget execution prerequisite/target exact değil");
  evidence.unjournaled = true;
  await client.query("begin");
  evidence.baseInstalledOuterRollback = true;
  if (!postMode) await client.query(migrationSql);
  evidence.migrationInstalledOuterRollback = true;
  const columns = await client.query<{ guide_nullable: boolean; effective_nullable: boolean; resolution_nullable: boolean; attempt: boolean; hashes: number }>(`select
    (select is_nullable='YES' from information_schema.columns where table_schema='public' and table_name='p06_execution_runs' and column_name='guide_run_action_binding_id') guide_nullable,
    (select is_nullable='YES' from information_schema.columns where table_schema='public' and table_name='p06_execution_runs' and column_name='effective_guide_set_hash') effective_nullable,
    (select is_nullable='YES' from information_schema.columns where table_schema='public' and table_name='p06_execution_runs' and column_name='resolution_hash') resolution_nullable,
    exists(select 1 from information_schema.columns where table_schema='public' and table_name='p06_execution_runs' and column_name='action_execution_attempt_id') attempt,
    (select count(*)::int from information_schema.columns where table_schema='public' and table_name='p06_execution_runs' and column_name=any(array['admission_hash','write_spec_hash','dry_run_hash','action_plan_hash','budget_kind','currency'])) hashes`);
  const c = columns.rows[0];
  evidence.sourceXor = c?.guide_nullable === true && c.effective_nullable === true && c.resolution_nullable === true && c.attempt === true && c.hashes === 6;
  const contracts = await client.query<{ definition: string }>("select pg_get_constraintdef(oid) definition from pg_constraint where conrelid='public.p06_execution_runs'::regclass and conname='p06_execution_runs_contract'");
  const definition = contracts.rows[0]?.definition ?? "";
  evidence.requestContract = definition.includes("guide_budget_human_approved") && definition.includes("action_execution_attempt_id")
    && definition.includes("dry_run_hash") && definition.includes("p06_jsonb_object_key_count") && definition.includes("human_approved");
  const catalog = await client.query<{ attempt_fk: boolean; attempt_unique: boolean; attempt_index: boolean; guard: boolean; rls: boolean; grants: number }>(`select
    exists(select 1 from pg_constraint where conrelid='public.p06_execution_runs'::regclass and conname='p06_execution_runs_attempt_fk' and contype='f' and convalidated) attempt_fk,
    exists(select 1 from pg_constraint where conrelid='public.p06_execution_runs'::regclass and conname='p06_execution_runs_workspace_attempt_unique' and contype='u' and convalidated) attempt_unique,
    exists(select 1 from pg_indexes where schemaname='public' and indexname='p06_execution_runs_attempt_fk_idx') attempt_index,
    exists(select 1 from pg_proc where oid='public.p06_execution_run_insert_guard()'::regprocedure and pg_get_functiondef(oid) like '%guide_budget_human_approved%' and pg_get_functiondef(oid) like '%action_execution_attempts%') guard,
    exists(select 1 from pg_class where oid='public.p06_execution_runs'::regclass and relrowsecurity and relforcerowsecurity) rls,
    (select count(*)::int from information_schema.role_table_grants where table_schema='public' and table_name='p06_execution_runs' and grantee in ('PUBLIC','anon','authenticated','service_role')) grants`);
  const k = catalog.rows[0];
  evidence.attemptFk = k?.attempt_fk === true; evidence.attemptUnique = k?.attempt_unique === true;
  evidence.attemptIndex = k?.attempt_index === true; evidence.guardReplaced = k?.guard === true;
  evidence.rlsForced = k?.rls === true; evidence.publicRevoked = k?.grants === 0;
  if (!Object.entries(evidence).filter(([key]) => !["mode", "migrationHash", "zeroResidue"].includes(key)).every(([, value]) => value === true)) {
    throw new Error(`P06 budget execution catalog PRE başarısız: ${JSON.stringify(evidence)}`);
  }
  await client.query("rollback");
  evidence.zeroResidue = (await client.query<{ count: number }>(`select
    (select count(*)::int from pg_class where relnamespace='public'::regnamespace and relname=any($1::text[]))
    + (select count(*)::int from pg_proc where oid=to_regprocedure('public.p06_jsonb_object_key_count(jsonb)')) count`, [names])).rows[0]?.count === 6;
  if (postMode) evidence.zeroResidue = (await client.query<{ rows:number }>("select count(*)::int rows from p06_execution_runs")).rows[0]?.rows===0;
  if (!evidence.zeroResidue) throw new Error("P06 budget execution PRE residue bıraktı");
  console.log(JSON.stringify(evidence));
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  throw error;
} finally {
  client.release(); await pool.end();
}
