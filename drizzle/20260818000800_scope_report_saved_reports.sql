-- P03-G PREONLY. Saved report revisions are immutable user evidence; heads are
-- the sole OCC pointer. Do not journal/apply before independent PRE acceptance.
CREATE TABLE public.scope_report_saved_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  binding_id uuid NOT NULL, report_ref text NOT NULL, command_ref text NOT NULL, revision_number integer NOT NULL,
  previous_revision_hash text NOT NULL, revision_hash text NOT NULL, state text NOT NULL, label text NOT NULL,
  slice_ref text NOT NULL, query_payload jsonb NOT NULL, created_by_actor_id uuid NOT NULL, created_at timestamptz NOT NULL
);
CREATE TABLE public.scope_report_saved_heads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  binding_id uuid NOT NULL, report_ref text NOT NULL, latest_revision_id uuid NOT NULL, version integer NOT NULL, updated_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX scope_report_saved_revisions_workspace_row_unique ON public.scope_report_saved_revisions(workspace_id,id);
CREATE UNIQUE INDEX scope_report_saved_revisions_workspace_report_number_unique ON public.scope_report_saved_revisions(workspace_id,report_ref,revision_number);
CREATE UNIQUE INDEX scope_report_saved_revisions_workspace_command_unique ON public.scope_report_saved_revisions(workspace_id,command_ref);
CREATE UNIQUE INDEX scope_report_saved_revisions_workspace_hash_unique ON public.scope_report_saved_revisions(workspace_id,revision_hash);
CREATE INDEX scope_report_saved_revisions_workspace_binding_idx ON public.scope_report_saved_revisions(workspace_id,binding_id,revision_number);
CREATE INDEX scope_report_saved_revisions_workspace_slice_fk_idx ON public.scope_report_saved_revisions(workspace_id,slice_ref);
CREATE INDEX scope_report_saved_revisions_workspace_actor_fk_idx ON public.scope_report_saved_revisions(workspace_id,created_by_actor_id);
CREATE UNIQUE INDEX scope_report_saved_heads_workspace_row_unique ON public.scope_report_saved_heads(workspace_id,id);
CREATE UNIQUE INDEX scope_report_saved_heads_workspace_binding_unique ON public.scope_report_saved_heads(workspace_id,binding_id);
CREATE UNIQUE INDEX scope_report_saved_heads_workspace_report_unique ON public.scope_report_saved_heads(workspace_id,report_ref);
CREATE INDEX scope_report_saved_heads_workspace_latest_fk_idx ON public.scope_report_saved_heads(workspace_id,latest_revision_id);
ALTER TABLE public.scope_report_saved_revisions ADD CONSTRAINT scope_report_saved_revisions_slice_scope_fk FOREIGN KEY(workspace_id,slice_ref) REFERENCES public.slices(workspace_id,slice_ref) ON DELETE RESTRICT;
ALTER TABLE public.scope_report_saved_revisions ADD CONSTRAINT scope_report_saved_revisions_actor_scope_fk FOREIGN KEY(workspace_id,created_by_actor_id) REFERENCES public.memberships(workspace_id,user_id) ON DELETE RESTRICT;
ALTER TABLE public.scope_report_saved_heads ADD CONSTRAINT scope_report_saved_heads_latest_scope_fk FOREIGN KEY(workspace_id,latest_revision_id) REFERENCES public.scope_report_saved_revisions(workspace_id,id) ON DELETE RESTRICT;
ALTER TABLE public.scope_report_saved_revisions ADD CONSTRAINT scope_report_saved_revisions_identity CHECK (report_ref~'^scope_report_saved_[a-f0-9]{24}$' AND command_ref~'^scope_report_save_[a-f0-9]{64}$' AND revision_number>=1 AND previous_revision_hash~'^(GENESIS|[a-f0-9]{64})$' AND revision_hash~'^[a-f0-9]{64}$' AND state IN('active','archived') AND length(btrim(label)) BETWEEN 1 AND 160 AND label=btrim(label) AND slice_ref~'^slice_[a-z0-9][a-z0-9_.:-]{0,190}$' AND jsonb_typeof(query_payload)='object' AND octet_length(query_payload::text)<=4096);
ALTER TABLE public.scope_report_saved_heads ADD CONSTRAINT scope_report_saved_heads_identity CHECK (report_ref~'^scope_report_saved_[a-f0-9]{24}$' AND version>=1);

CREATE FUNCTION public.scope_report_saved_revision_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE q jsonb; expected text; expected_ref text;
BEGIN
  IF TG_OP='DELETE' THEN IF EXISTS(SELECT 1 FROM public.workspaces WHERE id=OLD.workspace_id AND lifecycle_state='tombstoning') THEN RETURN OLD; END IF; RAISE EXCEPTION 'saved report revisions are append-only'; END IF;
  IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'saved report revisions are append-only'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.workspaces WHERE id=NEW.workspace_id AND lifecycle_state='active') OR NOT EXISTS(SELECT 1 FROM public.memberships WHERE workspace_id=NEW.workspace_id AND user_id=NEW.created_by_actor_id AND role IN('owner','admin','analyst')) THEN RAISE EXCEPTION 'saved report actor unavailable'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.slices s JOIN public.slice_revisions r ON r.workspace_id=s.workspace_id AND r.id=s.current_published_revision_id AND r.lifecycle='published' WHERE s.workspace_id=NEW.workspace_id AND s.slice_ref=NEW.slice_ref AND s.tombstoned_at IS NULL) THEN RAISE EXCEPTION 'saved report slice unavailable'; END IF;
  q:=NEW.query_payload;
  IF NOT(q ?& ARRAY['slice','start','end','granularity','level','metric','action','sort','direction']) OR q-ARRAY['slice','start','end','granularity','level','metric','action','sort','direction']<>'{}'::jsonb
    OR jsonb_typeof(q->'slice') IS DISTINCT FROM 'string' OR jsonb_typeof(q->'start') IS DISTINCT FROM 'string' OR jsonb_typeof(q->'end') IS DISTINCT FROM 'string' OR jsonb_typeof(q->'granularity') IS DISTINCT FROM 'string' OR jsonb_typeof(q->'sort') IS DISTINCT FROM 'string' OR jsonb_typeof(q->'direction') IS DISTINCT FROM 'string'
    OR jsonb_typeof(q->'level') NOT IN('null','string') OR jsonb_typeof(q->'metric') NOT IN('null','string') OR jsonb_typeof(q->'action') NOT IN('null','string') OR q->>'slice' IS DISTINCT FROM NEW.slice_ref
    OR (q->>'start'~'^\d{4}-\d{2}-\d{2}$') IS DISTINCT FROM TRUE OR (q->>'end'~'^\d{4}-\d{2}-\d{2}$') IS DISTINCT FROM TRUE OR (q->>'start')::date>(q->>'end')::date OR (q->>'end')::date-(q->>'start')::date+1>366
    OR q->>'granularity' NOT IN('day','week','month') OR NOT(jsonb_typeof(q->'level')='null' OR q->>'level' IN('campaign','ad_set'))
    OR NOT(jsonb_typeof(q->'metric')='null' OR q->>'metric'~'^[a-z][a-z0-9_:-]{0,80}$') OR NOT(jsonb_typeof(q->'action')='null' OR q->>'action'~'^[a-z][a-z0-9_:-]{0,80}$')
    OR q->>'sort' NOT IN('bucket','entity','metric') OR q->>'direction' NOT IN('asc','desc') THEN RAISE EXCEPTION 'saved report query invalid'; END IF;
  IF NEW.revision_number=1 AND NEW.previous_revision_hash<>'GENESIS' OR NEW.revision_number>1 AND NEW.previous_revision_hash!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'saved report chain invalid'; END IF;
  expected_ref:='scope_report_saved_'||substr(public.guide_run_sha256(jsonb_build_object('workspaceId',NEW.workspace_id::text,'bindingId',NEW.binding_id::text)),1,24);
  IF NEW.report_ref IS DISTINCT FROM expected_ref OR NEW.created_at IS DISTINCT FROM date_trunc('milliseconds',transaction_timestamp()) THEN RAISE EXCEPTION 'saved report identity invalid'; END IF;
  expected:=public.guide_run_sha256(jsonb_build_object('version','saved-scope-report/1.0.0','workspaceId',NEW.workspace_id::text,'reportRef',NEW.report_ref,'commandRef',NEW.command_ref,'revisionNumber',NEW.revision_number,'previousRevisionHash',NEW.previous_revision_hash,'state',NEW.state,'label',NEW.label,'query',NEW.query_payload,'createdByActorId',NEW.created_by_actor_id::text));
  IF NEW.revision_hash IS DISTINCT FROM expected THEN RAISE EXCEPTION 'saved report hash invalid'; END IF;
  RETURN NEW;
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RAISE EXCEPTION 'saved report query invalid';
END; $$;
CREATE FUNCTION public.scope_report_saved_head_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE r public.scope_report_saved_revisions%ROWTYPE; old_r public.scope_report_saved_revisions%ROWTYPE;
BEGIN
  IF TG_OP='DELETE' THEN IF EXISTS(SELECT 1 FROM public.workspaces WHERE id=OLD.workspace_id AND lifecycle_state='tombstoning') THEN RETURN OLD; END IF; RAISE EXCEPTION 'saved report heads may only be purged by tombstone'; END IF;
  SELECT * INTO r FROM public.scope_report_saved_revisions WHERE workspace_id=NEW.workspace_id AND id=NEW.latest_revision_id FOR KEY SHARE;
  IF NOT FOUND OR (r.binding_id,r.report_ref) IS DISTINCT FROM (NEW.binding_id,NEW.report_ref) THEN RAISE EXCEPTION 'saved report head identity invalid'; END IF;
  IF TG_OP='INSERT' THEN IF NEW.version<>1 OR r.revision_number<>1 OR r.previous_revision_hash<>'GENESIS' THEN RAISE EXCEPTION 'saved report head genesis invalid'; END IF;
  ELSE
    IF (NEW.workspace_id,NEW.binding_id,NEW.report_ref) IS DISTINCT FROM (OLD.workspace_id,OLD.binding_id,OLD.report_ref) OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'saved report head OCC invalid'; END IF;
    SELECT * INTO old_r FROM public.scope_report_saved_revisions WHERE workspace_id=OLD.workspace_id AND id=OLD.latest_revision_id;
    IF NOT FOUND OR r.revision_number<>old_r.revision_number+1 OR r.previous_revision_hash<>old_r.revision_hash THEN RAISE EXCEPTION 'saved report head chain invalid'; END IF;
  END IF; RETURN NEW;
END; $$;
CREATE FUNCTION public.scope_report_saved_revision_must_have_head() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN IF NOT EXISTS(SELECT 1 FROM public.scope_report_saved_heads WHERE workspace_id=NEW.workspace_id AND binding_id=NEW.binding_id AND report_ref=NEW.report_ref AND version>=NEW.revision_number) THEN RAISE EXCEPTION 'saved report revision orphaned'; END IF; RETURN NULL; END; $$;
CREATE TRIGGER scope_report_saved_revisions_guard BEFORE INSERT OR UPDATE OR DELETE ON public.scope_report_saved_revisions FOR EACH ROW EXECUTE FUNCTION public.scope_report_saved_revision_guard();
CREATE TRIGGER scope_report_saved_heads_guard BEFORE INSERT OR UPDATE OR DELETE ON public.scope_report_saved_heads FOR EACH ROW EXECUTE FUNCTION public.scope_report_saved_head_guard();
CREATE CONSTRAINT TRIGGER scope_report_saved_revisions_head_required AFTER INSERT ON public.scope_report_saved_revisions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.scope_report_saved_revision_must_have_head();
ALTER TABLE public.scope_report_saved_revisions ENABLE ROW LEVEL SECURITY; ALTER TABLE public.scope_report_saved_revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.scope_report_saved_heads ENABLE ROW LEVEL SECURITY; ALTER TABLE public.scope_report_saved_heads FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.scope_report_saved_revisions,public.scope_report_saved_heads FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.scope_report_saved_revision_guard(),public.scope_report_saved_head_guard(),public.scope_report_saved_revision_must_have_head() FROM PUBLIC,anon,authenticated,service_role;
