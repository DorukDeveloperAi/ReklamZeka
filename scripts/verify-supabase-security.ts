import { existsSync } from "node:fs";
import { Pool } from "pg";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const databaseUrl = process.env.DIRECT_DATABASE_URL?.trim()
  || process.env.DATABASE_URL?.trim();

if (!databaseUrl) throw new Error("Supabase PostgreSQL bağlantısı yapılandırılmadı");

const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  connectionTimeoutMillis: 10_000,
});

try {
  const tables = await pool.query<{
    total: number;
    rls_enabled: number;
  }>(`
    select
      count(*)::int as total,
      count(*) filter (where relation.relrowsecurity)::int as rls_enabled
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relkind = 'r'
      and relation.relname <> '__drizzle_migrations'
  `);
  const grants = await pool.query<{ grant_count: number }>(`
    select count(*)::int as grant_count
    from information_schema.role_table_grants
    where table_schema = 'public'
      and grantee in ('PUBLIC', 'anon', 'authenticated')
  `);
  const schemaCreate = await pool.query<{
    role_name: string;
    can_create: boolean;
  }>(`
    select role_name, has_schema_privilege(role_name, 'public', 'CREATE') as can_create
    from unnest(array['anon', 'authenticated']) as roles(role_name)
  `);
  const routineGrants = await pool.query<{ grant_count: number }>(`
    select count(*)::int as grant_count
    from information_schema.routine_privileges
    where routine_schema = 'public'
      and grantee in ('PUBLIC', 'anon', 'authenticated')
      and privilege_type = 'EXECUTE'
  `);

  const posture = {
    tables: tables.rows[0]?.total ?? 0,
    rlsEnabled: tables.rows[0]?.rls_enabled ?? 0,
    apiRoleTableGrants: grants.rows[0]?.grant_count ?? 0,
    apiRolesWithSchemaCreate: schemaCreate.rows.filter((row) => row.can_create).length,
    publicApiRoutineExecuteGrants: routineGrants.rows[0]?.grant_count ?? 0,
  };

  if (posture.tables === 0) throw new Error("Public uygulama tablosu bulunamadı");
  if (posture.rlsEnabled !== posture.tables) {
    throw new Error(`RLS güvenli değil: ${posture.rlsEnabled}/${posture.tables}`);
  }
  if (
    posture.apiRoleTableGrants !== 0
    || posture.apiRolesWithSchemaCreate !== 0
    || posture.publicApiRoutineExecuteGrants !== 0
  ) {
    throw new Error("Supabase Data API rolleri beklenmeyen doğrudan yetkiye sahip");
  }

  console.log(JSON.stringify({ status: "secure", ...posture }));
} finally {
  await pool.end();
}
