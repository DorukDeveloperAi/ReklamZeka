-- P03-Cb. Intentionally un-applied until the primary-result preflight has
-- passed its Postgres/RLS verifier. Revisions are historical evidence; heads
-- are the only mutable OCC pointers.
CREATE TABLE IF NOT EXISTS public.primary_result_binding_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  binding_id uuid NOT NULL,
  subject_kind text NOT NULL,
  organization_campaign_id uuid,
  slice_id uuid,
  market_definition_id uuid NOT NULL,
  revision_number integer NOT NULL,
  revision_hash text NOT NULL,
  previous_revision_hash text,
  state text NOT NULL,
  selector text,
  action_catalog_hash text,
  created_by_actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS public.primary_result_binding_heads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  binding_id uuid NOT NULL,
  subject_kind text NOT NULL,
  organization_campaign_id uuid,
  slice_id uuid,
  market_definition_id uuid NOT NULL,
  latest_revision_id uuid NOT NULL,
  version integer NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS primary_result_binding_revisions_workspace_row_unique ON public.primary_result_binding_revisions(workspace_id,id);
CREATE UNIQUE INDEX IF NOT EXISTS primary_result_binding_revisions_workspace_hash_unique ON public.primary_result_binding_revisions(workspace_id,revision_hash);
CREATE UNIQUE INDEX IF NOT EXISTS primary_result_binding_revisions_workspace_binding_number_unique ON public.primary_result_binding_revisions(workspace_id,binding_id,revision_number);
CREATE INDEX IF NOT EXISTS primary_result_binding_revisions_workspace_subject_idx ON public.primary_result_binding_revisions(workspace_id,subject_kind,organization_campaign_id,slice_id,revision_number);
CREATE INDEX IF NOT EXISTS primary_result_binding_revisions_workspace_actor_fk_idx ON public.primary_result_binding_revisions(workspace_id,created_by_actor_id);
CREATE INDEX IF NOT EXISTS primary_result_binding_revisions_workspace_org_market_fk_idx ON public.primary_result_binding_revisions(workspace_id,organization_campaign_id,market_definition_id);
CREATE INDEX IF NOT EXISTS primary_result_binding_revisions_workspace_slice_market_fk_idx ON public.primary_result_binding_revisions(workspace_id,slice_id,market_definition_id);
CREATE INDEX IF NOT EXISTS primary_result_binding_revisions_workspace_market_fk_idx ON public.primary_result_binding_revisions(workspace_id,market_definition_id);
CREATE UNIQUE INDEX IF NOT EXISTS primary_result_binding_heads_workspace_row_unique ON public.primary_result_binding_heads(workspace_id,id);
CREATE INDEX IF NOT EXISTS primary_result_binding_heads_workspace_latest_fk_idx ON public.primary_result_binding_heads(workspace_id,latest_revision_id);
CREATE INDEX IF NOT EXISTS primary_result_binding_heads_workspace_org_market_fk_idx ON public.primary_result_binding_heads(workspace_id,organization_campaign_id,market_definition_id);
CREATE INDEX IF NOT EXISTS primary_result_binding_heads_workspace_slice_market_fk_idx ON public.primary_result_binding_heads(workspace_id,slice_id,market_definition_id);
CREATE INDEX IF NOT EXISTS primary_result_binding_heads_workspace_market_fk_idx ON public.primary_result_binding_heads(workspace_id,market_definition_id);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='primary_result_binding_revisions_subject_number_uq') THEN ALTER TABLE public.primary_result_binding_revisions ADD CONSTRAINT primary_result_binding_revisions_subject_number_uq UNIQUE NULLS NOT DISTINCT (workspace_id,subject_kind,organization_campaign_id,slice_id,revision_number); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='primary_result_binding_revisions_workspace_subject_row_unique') THEN ALTER TABLE public.primary_result_binding_revisions ADD CONSTRAINT primary_result_binding_revisions_workspace_subject_row_unique UNIQUE NULLS NOT DISTINCT (workspace_id,id,subject_kind,organization_campaign_id,slice_id,binding_id); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='primary_result_binding_heads_workspace_subject_unique') THEN ALTER TABLE public.primary_result_binding_heads ADD CONSTRAINT primary_result_binding_heads_workspace_subject_unique UNIQUE NULLS NOT DISTINCT (workspace_id,subject_kind,organization_campaign_id,slice_id); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='primary_result_binding_revisions_org_market_scope_fk') THEN ALTER TABLE public.primary_result_binding_revisions ADD CONSTRAINT primary_result_binding_revisions_org_market_scope_fk FOREIGN KEY(workspace_id,organization_campaign_id,market_definition_id) REFERENCES public.organization_campaigns(workspace_id,id,market_definition_id) ON DELETE RESTRICT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='primary_result_binding_revisions_slice_market_scope_fk') THEN ALTER TABLE public.primary_result_binding_revisions ADD CONSTRAINT primary_result_binding_revisions_slice_market_scope_fk FOREIGN KEY(workspace_id,slice_id,market_definition_id) REFERENCES public.slices(workspace_id,id,market_definition_id) ON DELETE RESTRICT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='primary_result_binding_revisions_market_scope_fk') THEN ALTER TABLE public.primary_result_binding_revisions ADD CONSTRAINT primary_result_binding_revisions_market_scope_fk FOREIGN KEY(workspace_id,market_definition_id) REFERENCES public.category_definitions(workspace_id,id) ON DELETE RESTRICT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='primary_result_binding_revisions_actor_scope_fk') THEN ALTER TABLE public.primary_result_binding_revisions ADD CONSTRAINT primary_result_binding_revisions_actor_scope_fk FOREIGN KEY(workspace_id,created_by_actor_id) REFERENCES public.memberships(workspace_id,user_id) ON DELETE RESTRICT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='primary_result_binding_heads_org_market_scope_fk') THEN ALTER TABLE public.primary_result_binding_heads ADD CONSTRAINT primary_result_binding_heads_org_market_scope_fk FOREIGN KEY(workspace_id,organization_campaign_id,market_definition_id) REFERENCES public.organization_campaigns(workspace_id,id,market_definition_id) ON DELETE RESTRICT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='primary_result_binding_heads_slice_market_scope_fk') THEN ALTER TABLE public.primary_result_binding_heads ADD CONSTRAINT primary_result_binding_heads_slice_market_scope_fk FOREIGN KEY(workspace_id,slice_id,market_definition_id) REFERENCES public.slices(workspace_id,id,market_definition_id) ON DELETE RESTRICT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='primary_result_binding_heads_market_scope_fk') THEN ALTER TABLE public.primary_result_binding_heads ADD CONSTRAINT primary_result_binding_heads_market_scope_fk FOREIGN KEY(workspace_id,market_definition_id) REFERENCES public.category_definitions(workspace_id,id) ON DELETE RESTRICT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='primary_result_binding_heads_latest_revision_scope_fk') THEN ALTER TABLE public.primary_result_binding_heads ADD CONSTRAINT primary_result_binding_heads_latest_revision_scope_fk FOREIGN KEY(workspace_id,latest_revision_id) REFERENCES public.primary_result_binding_revisions(workspace_id,id) ON DELETE RESTRICT; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='primary_result_binding_revisions_contract') THEN ALTER TABLE public.primary_result_binding_revisions ADD CONSTRAINT primary_result_binding_revisions_contract CHECK (revision_number >= 1 AND revision_hash ~ '^[a-f0-9]{64}$' AND (previous_revision_hash IS NULL OR previous_revision_hash ~ '^[a-f0-9]{64}$') AND ((subject_kind='organization_campaign' AND organization_campaign_id IS NOT NULL AND slice_id IS NULL) OR (subject_kind='slice' AND slice_id IS NOT NULL AND organization_campaign_id IS NULL)) AND ((state='bound' AND selector ~ '^actions/[a-z][a-z0-9_.:-]{0,120}$' AND action_catalog_hash ~ '^[a-f0-9]{64}$') OR (state='unbound' AND selector IS NULL AND action_catalog_hash IS NULL))); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='primary_result_binding_heads_contract') THEN ALTER TABLE public.primary_result_binding_heads ADD CONSTRAINT primary_result_binding_heads_contract CHECK (version >= 1 AND ((subject_kind='organization_campaign' AND organization_campaign_id IS NOT NULL AND slice_id IS NULL) OR (subject_kind='slice' AND slice_id IS NOT NULL AND organization_campaign_id IS NULL))); END IF;
END $$;

CREATE OR REPLACE FUNCTION public.primary_result_binding_revision_append_only_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN
  IF TG_OP='INSERT' THEN RETURN NEW; END IF;
  IF TG_OP='DELETE' AND EXISTS (SELECT 1 FROM public.workspaces WHERE id=OLD.workspace_id AND lifecycle_state='tombstoning') THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'primary result binding revisions are append-only';
END; $$;
CREATE OR REPLACE FUNCTION public.primary_result_binding_head_exact_advance_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE r public.primary_result_binding_revisions%ROWTYPE; old_r public.primary_result_binding_revisions%ROWTYPE;
BEGIN
  IF TG_OP='DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.workspaces WHERE id=OLD.workspace_id AND lifecycle_state='tombstoning') THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'primary result binding heads may only be deleted by workspace tombstone';
  END IF;
  SELECT * INTO r FROM public.primary_result_binding_revisions WHERE workspace_id=NEW.workspace_id AND id=NEW.latest_revision_id;
  IF NOT FOUND OR (r.binding_id,r.subject_kind,r.organization_campaign_id,r.slice_id,r.market_definition_id) IS DISTINCT FROM (NEW.binding_id,NEW.subject_kind,NEW.organization_campaign_id,NEW.slice_id,NEW.market_definition_id) THEN RAISE EXCEPTION 'primary result binding head must exactly reference subject revision'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.version<>1 OR r.revision_number<>1 OR r.previous_revision_hash IS NOT NULL THEN RAISE EXCEPTION 'primary result binding head must begin at revision one'; END IF;
  ELSE
    IF (NEW.workspace_id,NEW.binding_id,NEW.subject_kind,NEW.organization_campaign_id,NEW.slice_id,NEW.market_definition_id) IS DISTINCT FROM (OLD.workspace_id,OLD.binding_id,OLD.subject_kind,OLD.organization_campaign_id,OLD.slice_id,OLD.market_definition_id) OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'primary result binding head identity/version immutable'; END IF;
    SELECT * INTO old_r FROM public.primary_result_binding_revisions WHERE workspace_id=OLD.workspace_id AND id=OLD.latest_revision_id;
    IF NOT FOUND OR r.revision_number<>old_r.revision_number+1 OR r.previous_revision_hash<>old_r.revision_hash THEN RAISE EXCEPTION 'primary result binding head requires exact next revision'; END IF;
  END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER primary_result_binding_revisions_append_only BEFORE UPDATE OR DELETE ON public.primary_result_binding_revisions FOR EACH ROW EXECUTE FUNCTION public.primary_result_binding_revision_append_only_guard();
CREATE TRIGGER primary_result_binding_heads_exact_advance BEFORE INSERT OR UPDATE OR DELETE ON public.primary_result_binding_heads FOR EACH ROW EXECUTE FUNCTION public.primary_result_binding_head_exact_advance_guard();

ALTER TABLE public.primary_result_binding_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.primary_result_binding_revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.primary_result_binding_heads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.primary_result_binding_heads FORCE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.primary_result_binding_revisions,public.primary_result_binding_heads FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL PRIVILEGES ON FUNCTION public.primary_result_binding_revision_append_only_guard(),public.primary_result_binding_head_exact_advance_guard() FROM PUBLIC,anon,authenticated,service_role;
