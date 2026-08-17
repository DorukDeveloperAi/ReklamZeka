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
const names = ["p06_execution_runs", "p06_execution_events", "p06_execution_heads", "p06_execution_observations",
  "p06_execution_gate_snapshots", "p06_rollback_proposals"] as const;
const evidence = { mode: "pre_outer_rollback", migrationHash, migrationInstalled: false, rlsForced: false,
  publicRevoked: false, zeroPolicies: false, constraintsValidated: false, fkIndexes: false, triggersEnabled: false,
  preApplyUnjournaled: false, zeroResidue: false };

const client = await pool.connect();
try {
  const before = await client.query<{ objects: number; ledger: number }>(`select
    (select count(*)::int from pg_class where relnamespace='public'::regnamespace and relname=any($1::text[])) objects,
    (select count(*)::int from drizzle.__drizzle_migrations where hash=$2) ledger`, [names, migrationHash]);
  if (before.rows[0]?.objects !== 0 || before.rows[0]?.ledger !== 0) throw new Error("P06 execution PRE target fresh değil");
  evidence.preApplyUnjournaled = true;
  await client.query("begin");
  await client.query(migrationSql);
  evidence.migrationInstalled = (await client.query<{ count: number }>(`select count(*)::int from pg_class where relnamespace='public'::regnamespace and relkind='r' and relname=any($1::text[])`, [names])).rows[0]?.count === 6;
  evidence.rlsForced = (await client.query<{ count: number }>(`select count(*)::int from pg_class where relnamespace='public'::regnamespace and relname=any($1::text[]) and relrowsecurity and relforcerowsecurity`, [names])).rows[0]?.count === 6;
  evidence.publicRevoked = (await client.query<{ count: number }>(`select count(*)::int from information_schema.role_table_grants where table_schema='public' and table_name=any($1::text[]) and grantee in ('PUBLIC','anon','authenticated','service_role')`, [names])).rows[0]?.count === 0;
  evidence.zeroPolicies = (await client.query<{ count: number }>(`select count(*)::int from pg_policies where schemaname='public' and tablename=any($1::text[])`, [names])).rows[0]?.count === 0;
  evidence.constraintsValidated = (await client.query<{ invalid: number; total: number }>(`select count(*) filter(where not convalidated)::int invalid,count(*)::int total from pg_constraint where conrelid=any($1::regclass[])`, [names.map((name) => `public.${name}`)])).rows[0]?.invalid === 0;
  evidence.fkIndexes = (await client.query<{ count: number }>(`select count(*)::int from pg_indexes where schemaname='public' and indexname like 'p06_%_fk_idx'`)).rows[0]?.count === 10;
  evidence.triggersEnabled = (await client.query<{ count: number }>(`select count(*)::int from pg_trigger where tgrelid=any($1::regclass[]) and not tgisinternal and tgenabled='O'`, [names.map((name) => `public.${name}`)])).rows[0]?.count === 11;
  if (!Object.entries(evidence).filter(([key]) => !["mode", "migrationHash", "zeroResidue"].includes(key)).every(([, value]) => value === true)) throw new Error("P06 execution PRE katalog kapısı başarısız");
  await client.query("rollback");
  evidence.zeroResidue = (await client.query<{ count: number }>(`select count(*)::int from pg_class where relnamespace='public'::regnamespace and relname=any($1::text[])`, [names])).rows[0]?.count === 0;
  if (!evidence.zeroResidue) throw new Error("P06 execution PRE residue bıraktı");
  console.log(JSON.stringify(evidence));
} catch (error) {
  await client.query("rollback").catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
