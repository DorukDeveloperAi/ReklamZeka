import { existsSync } from "node:fs";
import { Pool } from "pg";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const databaseUrl = process.env.DIRECT_DATABASE_URL?.trim()
  || process.env.DATABASE_URL?.trim();

if (!databaseUrl) {
  console.error(JSON.stringify({ ok: false, blocker: "postgres_connection_not_configured",
    requiredOneOf: ["DIRECT_DATABASE_URL", "DATABASE_URL"], continuation: "npm run verify:supabase-security" }));
  process.exit(2);
}

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
  const instructionPolicyTables = await pool.query<{ total: number; force_rls: number }>(`
    select count(*)::int as total,
      count(*) filter (where relation.relrowsecurity and relation.relforcerowsecurity)::int as force_rls
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public' and relation.relkind = 'r'
      and relation.relname in ('instruction_policy_raw_provenance', 'strict_instruction_policy_revisions')
  `);
  const instructionPolicyGrants = await pool.query<{ grant_count: number }>(`
    select count(*)::int as grant_count from information_schema.role_table_grants
    where table_schema = 'public'
      and table_name in ('instruction_policy_raw_provenance', 'strict_instruction_policy_revisions')
      and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')
  `);
  const guidanceRunBinding = await pool.query<{ total: number; force_rls: number; grant_count: number;
    routine_grant_count: number }>(`
    select count(*)::int as total,
      count(*) filter (where relation.relrowsecurity and relation.relforcerowsecurity)::int as force_rls,
      (select count(*)::int from information_schema.role_table_grants
        where table_schema = 'public' and table_name in (
          'guidance_sources', 'guidance_cards', 'guidance_bindings', 'guidance_sets',
          'guidance_analysis_run_bindings'
        )
          and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')) as grant_count,
      (select count(*)::int from information_schema.routine_privileges
        where routine_schema = 'public' and routine_name in (
          'guidance_revision_refs_exact', 'guidance_analysis_run_binding_immutable',
          'guidance_registry_revision_immutable'
        ) and grantee in ('PUBLIC', 'anon', 'authenticated', 'service_role')) as routine_grant_count
    from pg_class relation join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public' and relation.relkind = 'r'
      and relation.relname in (
        'guidance_sources', 'guidance_cards', 'guidance_bindings', 'guidance_sets',
        'guidance_analysis_run_bindings'
      )
  `);

  const posture = {
    tables: tables.rows[0]?.total ?? 0,
    rlsEnabled: tables.rows[0]?.rls_enabled ?? 0,
    apiRoleTableGrants: grants.rows[0]?.grant_count ?? 0,
    apiRolesWithSchemaCreate: schemaCreate.rows.filter((row) => row.can_create).length,
    publicApiRoutineExecuteGrants: routineGrants.rows[0]?.grant_count ?? 0,
    strictPolicyTables: instructionPolicyTables.rows[0]?.total ?? 0,
    strictPolicyForceRls: instructionPolicyTables.rows[0]?.force_rls ?? 0,
    strictPolicyDirectGrants: instructionPolicyGrants.rows[0]?.grant_count ?? 0,
    guidanceRunBindingTables: guidanceRunBinding.rows[0]?.total ?? 0,
    guidanceRunBindingForceRls: guidanceRunBinding.rows[0]?.force_rls ?? 0,
    guidanceRunBindingDirectGrants: guidanceRunBinding.rows[0]?.grant_count ?? 0,
    guidanceRoutineDirectGrants: guidanceRunBinding.rows[0]?.routine_grant_count ?? 0,
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
  if (posture.strictPolicyTables !== 2 || posture.strictPolicyForceRls !== 2
    || posture.strictPolicyDirectGrants !== 0) {
    throw new Error("Strict instruction policy tabloları FORCE RLS/revoke sınırını karşılamıyor");
  }
  if (posture.guidanceRunBindingTables !== 5 || posture.guidanceRunBindingForceRls !== 5
    || posture.guidanceRunBindingDirectGrants !== 0 || posture.guidanceRoutineDirectGrants !== 0) {
    throw new Error("Guidance analysis-run binding FORCE RLS/revoke sınırını karşılamıyor");
  }

  console.log(JSON.stringify({ status: "secure", ...posture }));
} finally {
  await pool.end();
}
