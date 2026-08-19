import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { Pool } from "pg";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL yapılandırılmadı");
const migrationSql = readFileSync("drizzle/20260818000600_p06_limited_autonomy_admissions.sql", "utf8");
const migrationHash = createHash("sha256").update(migrationSql).digest("hex");
const postMode = process.env.P06_LIMITED_AUTONOMY_POST_APPROVED === "true";
const evidence = { mode: postMode ? "post_applied" : "pre_outer_rollback", migrationHash, installedOuterRollback: false, exactSource: false,
  atomicQuota: false, appendOnly: false, rlsForced: false, publicRevoked: false, indexes: false, constraints: false,
  exactMigrationState: false, zeroResidue: false };
const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 30_000 });
const client = await pool.connect();
try {
  const before = await client.query<{ objects: number; ledger: number; helper: number }>(`select
    (select count(*)::int from pg_class where relnamespace='public'::regnamespace and relname='p06_limited_autonomy_admissions') objects,
    (select count(*)::int from drizzle.__drizzle_migrations where hash=$1 and created_at=1787011560000) ledger,
    (select count(*)::int from pg_proc where oid=to_regprocedure('public.p06_jsonb_object_key_count(jsonb)')) helper`, [migrationHash]);
  if (before.rows[0]?.objects !== (postMode ? 1 : 0) || before.rows[0]?.ledger !== (postMode ? 1 : 0)) throw new Error("P06 autonomy target exact değil");
  evidence.exactMigrationState = true;
  await client.query("begin");
  if (!postMode) await client.query(migrationSql);
  evidence.installedOuterRollback = true;
  const catalog = await client.query<{ rls: boolean; grants: number; indexes: number; constraints: number; trigger_count: number; guard: string }>(`select
    (select relrowsecurity and relforcerowsecurity from pg_class where oid='public.p06_limited_autonomy_admissions'::regclass) rls,
    (select count(*)::int from information_schema.role_table_grants where table_schema='public' and table_name='p06_limited_autonomy_admissions' and grantee in ('PUBLIC','anon','authenticated','service_role')) grants,
    (select count(*)::int from pg_indexes where schemaname='public' and tablename='p06_limited_autonomy_admissions') indexes,
    (select count(*)::int from pg_constraint where conrelid='public.p06_limited_autonomy_admissions'::regclass and convalidated) constraints,
    (select count(*)::int from pg_trigger where tgrelid='public.p06_limited_autonomy_admissions'::regclass and not tgisinternal and tgenabled='O') trigger_count,
    (select pg_get_functiondef('public.p06_limited_autonomy_admission_guard()'::regprocedure)) guard`);
  const row = catalog.rows[0]!;
  evidence.rlsForced = row.rls === true; evidence.publicRevoked = row.grants === 0;
  evidence.indexes = row.indexes === 7; evidence.constraints = row.constraints === 8;
  evidence.appendOnly = row.trigger_count === 1 && row.guard.includes("append only") && row.guard.includes("tombstoning");
  evidence.exactSource = row.guard.includes("limited_autonomy_review") && row.guard.includes("candidateHash")
    && row.guard.includes("guide_revision_actions") && row.guard.includes("scope_snapshot") && row.guard.includes("current_active_revision_id");
  evidence.atomicQuota = row.guard.includes("FOR UPDATE") && row.guard.includes("quota exhausted")
    && row.guard.includes("reserved+1") && row.guard.includes("maximum_actions_per_run");
  if (!Object.entries(evidence).filter(([key]) => !["mode","migrationHash","zeroResidue"].includes(key)).every(([,value]) => value === true))
    throw new Error(`P06 autonomy catalog PRE başarısız: ${JSON.stringify(evidence)}`);
  await client.query("rollback");
  const residue = await client.query<{ objects: number; guard: number; helper: number }>(`select
    (select count(*)::int from pg_class where relnamespace='public'::regnamespace and relname='p06_limited_autonomy_admissions') objects,
    (select count(*)::int from pg_proc where oid=to_regprocedure('public.p06_limited_autonomy_admission_guard()')) guard,
    (select count(*)::int from pg_proc where oid=to_regprocedure('public.p06_jsonb_object_key_count(jsonb)')) helper`);
  evidence.zeroResidue = postMode
    ? residue.rows[0]?.objects === 1 && residue.rows[0]?.guard === 1 && residue.rows[0]?.helper === before.rows[0]?.helper
      && (await client.query<{rows:number}>("select count(*)::int rows from p06_limited_autonomy_admissions")).rows[0]?.rows===0
    : residue.rows[0]?.objects === 0 && residue.rows[0]?.guard === 0 && residue.rows[0]?.helper === before.rows[0]?.helper;
  if (!evidence.zeroResidue) throw new Error("P06 autonomy PRE residue bıraktı");
  console.log(JSON.stringify(evidence));
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  throw error;
} finally { client.release(); await pool.end(); }
