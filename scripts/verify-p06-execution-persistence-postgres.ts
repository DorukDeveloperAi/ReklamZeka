import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { Pool } from "pg";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL yapılandırılmadı");
const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 30_000 });
const migrationPath = "drizzle/20260818000300_p06_execution_persistence.sql";
const migrationSql = readFileSync(migrationPath, "utf8");
const migrationHash = createHash("sha256").update(migrationSql).digest("hex");
const postMode = process.env.P06_EXECUTION_POST_APPROVED === "true";
const names = ["p06_execution_runs", "p06_execution_events", "p06_execution_heads", "p06_execution_observations",
  "p06_execution_gate_snapshots", "p06_rollback_proposals"] as const;
// Later P06 route migrations add their own FK indexes and split the run-insert
// trigger by route.  POST must prove the original persistence boundary remains
// present, not mistake those forward-compatible additions for catalog drift.
const requiredFkIndexes = [
  "p06_execution_runs_binding_fk_idx", "p06_execution_runs_unit_fk_idx",
  "p06_execution_runs_decision_fk_idx", "p06_execution_runs_grant_fk_idx",
  "p06_execution_heads_event_fk_idx", "p06_execution_observations_event_fk_idx",
  "p06_rollback_proposals_terminal_fk_idx", "p06_rollback_proposals_before_fk_idx",
  "p06_rollback_proposals_after_fk_idx", "p06_rollback_proposals_write_fk_idx",
] as const;
const requiredTriggers = [
  "p06_execution_runs_append_only", "p06_execution_events_append_only", "p06_execution_events_exact_insert",
  "p06_execution_heads_exact_advance", "p06_execution_observations_append_only",
  "p06_execution_observations_exact_insert", "p06_execution_gate_snapshots_append_only",
  "p06_execution_gate_snapshots_exact_insert", "p06_rollback_proposals_append_only",
  "p06_rollback_proposals_exact_insert",
] as const;
const evidence = { mode: postMode ? "post_applied" : "pre_outer_rollback", migrationHash, migrationInstalled: false, exactMigrationLedger: !postMode, rlsForced: false,
  publicRevoked: false, zeroPolicies: false, constraintsValidated: false, fkIndexes: false, triggersEnabled: false,
  preApplyUnjournaled: false, zeroResidue: false };

const client = await pool.connect();
try {
  const before = await client.query<{ objects: number; ledger: number }>(`select
    (select count(*)::int from pg_class where relnamespace='public'::regnamespace and relname=any($1::text[])) objects,
    (select count(*)::int from drizzle.__drizzle_migrations where hash=$2) ledger`, [names, migrationHash]);
  if (postMode) {
    if (before.rows[0]?.objects !== 6 || before.rows[0]?.ledger !== 1) throw new Error("P06 execution POST ledger/schema exact değil");
    evidence.exactMigrationLedger = true;
  } else {
    if (before.rows[0]?.objects !== 0 || before.rows[0]?.ledger !== 0) throw new Error("P06 execution PRE target fresh değil");
    evidence.preApplyUnjournaled = true;
    await client.query("begin");
    await client.query(migrationSql);
  }
  evidence.migrationInstalled = (await client.query<{ count: number }>(`select count(*)::int from pg_class where relnamespace='public'::regnamespace and relkind='r' and relname=any($1::text[])`, [names])).rows[0]?.count === 6;
  evidence.rlsForced = (await client.query<{ count: number }>(`select count(*)::int from pg_class where relnamespace='public'::regnamespace and relname=any($1::text[]) and relrowsecurity and relforcerowsecurity`, [names])).rows[0]?.count === 6;
  evidence.publicRevoked = (await client.query<{ count: number }>(`select count(*)::int from information_schema.role_table_grants where table_schema='public' and table_name=any($1::text[]) and grantee in ('PUBLIC','anon','authenticated','service_role')`, [names])).rows[0]?.count === 0;
  evidence.zeroPolicies = (await client.query<{ count: number }>(`select count(*)::int from pg_policies where schemaname='public' and tablename=any($1::text[])`, [names])).rows[0]?.count === 0;
  evidence.constraintsValidated = (await client.query<{ invalid: number; total: number }>(`select count(*) filter(where not convalidated)::int invalid,count(*)::int total from pg_constraint where conrelid=any($1::regclass[])`, [names.map((name) => `public.${name}`)])).rows[0]?.invalid === 0;
  const indexes = await client.query<{ indexname: string }>(`select indexname from pg_indexes where schemaname='public' and indexname=any($1::text[])`, [requiredFkIndexes]);
  evidence.fkIndexes = indexes.rows.length === requiredFkIndexes.length
    && requiredFkIndexes.every((name) => indexes.rows.some((row) => row.indexname === name));
  const triggers = await client.query<{ tgname: string }>(`select tgname from pg_trigger where tgrelid=any($1::regclass[]) and not tgisinternal and tgenabled='O'`, [names.map((name) => `public.${name}`)]);
  evidence.triggersEnabled = requiredTriggers.every((name) => triggers.rows.some((row) => row.tgname === name));
  if (!Object.entries(evidence).filter(([key]) => !["mode", "migrationHash", "zeroResidue", "preApplyUnjournaled"].includes(key)).every(([, value]) => value === true)) throw new Error("P06 execution katalog kapısı başarısız");
  if (!postMode) await client.query("rollback");
  evidence.zeroResidue = (await client.query<{ count: number }>(`select count(*)::int from pg_class where relnamespace='public'::regnamespace and relname=any($1::text[])`, [names])).rows[0]?.count === 0;
  if (postMode) evidence.zeroResidue = (await client.query<{ count: number }>(`select count(*)::int from (${names.map((name) => `select id from public.${name}`).join(" union all ")}) residue`)).rows[0]?.count === 0;
  if (!evidence.zeroResidue) throw new Error("P06 execution residue bıraktı");
  console.log(JSON.stringify(evidence));
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
