-- Custom SQL migration file, put your code below! --
-- ReklamZeka currently reaches PostgreSQL only through its trusted server-side
-- connection. Supabase Data API roles therefore have no direct table access
-- until workspace-aware Auth/RLS policies are deliberately introduced.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;
REVOKE CREATE ON SCHEMA public FROM anon, authenticated;

-- Keep future Drizzle-created objects closed by default as well. These defaults
-- apply to objects created by the migration role in the public schema.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL PRIVILEGES ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE ALL PRIVILEGES ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;

-- RLS is intentionally enabled without public policies. The server-side owner
-- connection keeps working; anon/authenticated requests fail closed. Tenant
-- policies will be added only together with a real end-user Auth boundary.
DO $reklamzeka_rls$
DECLARE
  relation record;
BEGIN
  FOR relation IN
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY',
      relation.schemaname,
      relation.tablename
    );
  END LOOP;
END
$reklamzeka_rls$;
