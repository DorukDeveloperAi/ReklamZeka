-- Custom SQL migration file, put your code below! --
-- This table remains entirely closed to Data API roles.  The trusted
-- server-side Drizzle connection uses the database `postgres` role; FORCE RLS
-- otherwise prevents its own immutable sidecar writer from persisting rows.
CREATE POLICY frozen_diagnostic_evidence_server_private_all
ON public.frozen_diagnostic_evidence
FOR ALL
TO postgres
USING (true)
WITH CHECK (true);
