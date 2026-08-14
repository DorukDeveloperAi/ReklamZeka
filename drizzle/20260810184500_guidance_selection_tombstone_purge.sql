-- Selection revisions remain immutable outside the locked workspace tombstone
-- transaction. The workspace lifecycle is the existing database-authorized
-- purge boundary used by other append-only tenant evidence.
CREATE OR REPLACE FUNCTION guidance_campaign_selection_revision_immutable() RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND EXISTS (
    SELECT 1
    FROM public.workspaces
    WHERE id = OLD.workspace_id
      AND lifecycle_state = 'tombstoning'
  ) THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'guidance campaign selection revisions are append-only';
END;
$$;--> statement-breakpoint

REVOKE ALL PRIVILEGES ON FUNCTION guidance_campaign_selection_revision_immutable()
  FROM PUBLIC, anon, authenticated, service_role;
