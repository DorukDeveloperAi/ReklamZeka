-- P02-C PREONLY. Naming templates are immutable advisory evidence. Heads are
-- the sole OCC pointer; no template grants assignment, approval or Meta-write authority.
CREATE TABLE public.naming_template_revisions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  ad_account_id uuid NOT NULL, template_ref text NOT NULL, command_ref text NOT NULL, revision integer NOT NULL,
  previous_revision_hash text, revision_hash text NOT NULL, state text NOT NULL, naming_family text NOT NULL,
  entity_level text NOT NULL, template_payload jsonb NOT NULL, created_by_actor_id uuid NOT NULL, created_at timestamptz NOT NULL
);
CREATE TABLE public.naming_template_heads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  ad_account_id uuid NOT NULL, template_ref text NOT NULL, latest_revision_id uuid NOT NULL, version integer NOT NULL, updated_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX naming_template_revisions_workspace_row_unique ON public.naming_template_revisions(workspace_id,id);
CREATE UNIQUE INDEX naming_template_revisions_workspace_template_revision_unique ON public.naming_template_revisions(workspace_id,ad_account_id,template_ref,revision);
CREATE UNIQUE INDEX naming_template_revisions_workspace_command_unique ON public.naming_template_revisions(workspace_id,command_ref);
CREATE UNIQUE INDEX naming_template_revisions_workspace_hash_unique ON public.naming_template_revisions(workspace_id,revision_hash);
CREATE INDEX naming_template_revisions_workspace_account_fk_idx ON public.naming_template_revisions(workspace_id,ad_account_id);
CREATE INDEX naming_template_revisions_workspace_actor_fk_idx ON public.naming_template_revisions(workspace_id,created_by_actor_id);
CREATE UNIQUE INDEX naming_template_heads_workspace_row_unique ON public.naming_template_heads(workspace_id,id);
CREATE UNIQUE INDEX naming_template_heads_workspace_template_unique ON public.naming_template_heads(workspace_id,ad_account_id,template_ref);
CREATE INDEX naming_template_heads_workspace_latest_fk_idx ON public.naming_template_heads(workspace_id,latest_revision_id);
CREATE INDEX naming_template_heads_workspace_account_fk_idx ON public.naming_template_heads(workspace_id,ad_account_id);
ALTER TABLE public.naming_template_revisions ADD CONSTRAINT naming_template_revisions_account_scope_fk FOREIGN KEY(workspace_id,ad_account_id) REFERENCES public.ad_accounts(workspace_id,id) ON DELETE RESTRICT;
ALTER TABLE public.naming_template_revisions ADD CONSTRAINT naming_template_revisions_actor_scope_fk FOREIGN KEY(workspace_id,created_by_actor_id) REFERENCES public.memberships(workspace_id,user_id) ON DELETE RESTRICT;
ALTER TABLE public.naming_template_heads ADD CONSTRAINT naming_template_heads_account_scope_fk FOREIGN KEY(workspace_id,ad_account_id) REFERENCES public.ad_accounts(workspace_id,id) ON DELETE RESTRICT;
ALTER TABLE public.naming_template_heads ADD CONSTRAINT naming_template_heads_latest_scope_fk FOREIGN KEY(workspace_id,latest_revision_id) REFERENCES public.naming_template_revisions(workspace_id,id) ON DELETE RESTRICT;
ALTER TABLE public.naming_template_revisions ADD CONSTRAINT naming_template_revisions_identity CHECK (template_ref~'^naming_template_[a-z0-9][a-z0-9_.:-]{0,95}$' AND command_ref~'^naming_template_command_[a-f0-9]{64}$' AND revision BETWEEN 1 AND 1000000 AND (previous_revision_hash IS NULL OR previous_revision_hash~'^[a-f0-9]{64}$') AND revision_hash~'^[a-f0-9]{64}$' AND state IN('draft','published','disabled') AND naming_family~'^[a-z][a-z0-9_.:-]{0,63}$' AND entity_level IN('campaign','ad_set') AND jsonb_typeof(template_payload)='object' AND octet_length(template_payload::text)<=32768);
ALTER TABLE public.naming_template_heads ADD CONSTRAINT naming_template_heads_identity CHECK (template_ref~'^naming_template_[a-z0-9][a-z0-9_.:-]{0,95}$' AND version BETWEEN 1 AND 1000000);

CREATE FUNCTION public.naming_template_revision_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE p jsonb; rule jsonb; selector jsonb; proposed jsonb; expected text; workspace_ref text; account_ref text; actor_role public.membership_role;
BEGIN
  IF TG_OP='DELETE' THEN IF EXISTS(SELECT 1 FROM public.workspaces WHERE id=OLD.workspace_id AND lifecycle_state='tombstoning') THEN RETURN OLD; END IF; RAISE EXCEPTION 'naming template revisions are append-only'; END IF;
  IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'naming template revisions are append-only'; END IF;
  SELECT m.role INTO actor_role FROM public.workspaces w JOIN public.memberships m ON m.workspace_id=w.id AND m.user_id=NEW.created_by_actor_id WHERE w.id=NEW.workspace_id AND w.lifecycle_state='active';
  IF actor_role IS NULL OR actor_role NOT IN('owner','admin','analyst') OR NEW.state IN('published','disabled') AND actor_role NOT IN('owner','admin') THEN RAISE EXCEPTION 'naming template actor unavailable'; END IF;
  IF NOT EXISTS(SELECT 1 FROM public.ad_accounts a WHERE a.workspace_id=NEW.workspace_id AND a.id=NEW.ad_account_id AND a.disappeared_at IS NULL) THEN RAISE EXCEPTION 'naming template account unavailable'; END IF;
  p:=NEW.template_payload;
  IF (SELECT count(*) FROM jsonb_object_keys(p))<>14 OR NOT(p ?& ARRAY['version','workspaceRef','accountRef','templateRef','revision','previousRevisionHash','state','namingFamily','entityLevel','nameRules','corroboration','proposedAssignments','authority','revisionHash'])
    OR jsonb_typeof(p->'version') IS DISTINCT FROM 'string' OR jsonb_typeof(p->'workspaceRef') IS DISTINCT FROM 'string' OR jsonb_typeof(p->'accountRef') IS DISTINCT FROM 'string'
    OR jsonb_typeof(p->'templateRef') IS DISTINCT FROM 'string' OR jsonb_typeof(p->'revision') IS DISTINCT FROM 'number' OR jsonb_typeof(p->'previousRevisionHash') NOT IN('string','null')
    OR jsonb_typeof(p->'state') IS DISTINCT FROM 'string' OR jsonb_typeof(p->'namingFamily') IS DISTINCT FROM 'string' OR jsonb_typeof(p->'entityLevel') IS DISTINCT FROM 'string' OR jsonb_typeof(p->'revisionHash') IS DISTINCT FROM 'string'
    OR p->>'version'<>'naming-template/1.0.0' OR p->>'templateRef' IS DISTINCT FROM NEW.template_ref OR (p->>'revision')::integer IS DISTINCT FROM NEW.revision OR p->>'previousRevisionHash' IS DISTINCT FROM NEW.previous_revision_hash
    OR p->>'revisionHash' IS DISTINCT FROM NEW.revision_hash OR p->>'state' IS DISTINCT FROM NEW.state OR p->>'namingFamily' IS DISTINCT FROM NEW.naming_family OR p->>'entityLevel' IS DISTINCT FROM NEW.entity_level
    OR jsonb_typeof(p->'nameRules') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'nameRules') NOT BETWEEN 1 AND 8
    OR jsonb_typeof(p->'corroboration') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'corroboration') NOT BETWEEN 1 AND 16
    OR jsonb_typeof(p->'proposedAssignments') IS DISTINCT FROM 'array' OR jsonb_array_length(p->'proposedAssignments') NOT BETWEEN 1 AND 16
    OR jsonb_typeof(p->'authority') IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(p->'authority'))<>6
    OR p#>'{authority,canPropose}' IS DISTINCT FROM 'true'::jsonb OR p#>'{authority,canAssign}' IS DISTINCT FROM 'false'::jsonb OR p#>'{authority,canPublish}' IS DISTINCT FROM 'false'::jsonb OR p#>'{authority,canApprove}' IS DISTINCT FROM 'false'::jsonb OR p#>'{authority,canExecute}' IS DISTINCT FROM 'false'::jsonb OR p#>'{authority,canWriteMeta}' IS DISTINCT FROM 'false'::jsonb
    OR NEW.created_at IS DISTINCT FROM date_trunc('milliseconds',transaction_timestamp()) THEN RAISE EXCEPTION 'naming template payload invalid'; END IF;
  workspace_ref:='workspace_'||substr(encode(extensions.digest(convert_to(NEW.workspace_id::text,'UTF8'),'sha256'),'hex'),1,24);
  account_ref:='account_'||substr(encode(extensions.digest(convert_to(NEW.workspace_id::text,'UTF8')||decode('00','hex')||convert_to('account','UTF8')||decode('00','hex')||convert_to(NEW.ad_account_id::text,'UTF8'),'sha256'),'hex'),1,24);
  IF p->>'workspaceRef' IS DISTINCT FROM workspace_ref OR p->>'accountRef' IS DISTINCT FROM account_ref THEN RAISE EXCEPTION 'naming template scope invalid'; END IF;
  IF NEW.revision=1 AND (NEW.previous_revision_hash IS NOT NULL OR NEW.state<>'draft') OR NEW.revision>1 AND NEW.previous_revision_hash IS NULL THEN RAISE EXCEPTION 'naming template chain invalid'; END IF;
  FOR rule IN SELECT value FROM jsonb_array_elements(p->'nameRules') LOOP
    IF jsonb_typeof(rule)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(rule))<>3 OR NOT(rule ?& ARRAY['source','match','tokens']) OR jsonb_typeof(rule->'source')<>'string' OR jsonb_typeof(rule->'match')<>'string' OR rule->>'source' NOT IN('campaign_name','ad_set_name') OR rule->>'match' NOT IN('all','any') OR NEW.entity_level='campaign' AND rule->>'source'='ad_set_name' OR jsonb_typeof(rule->'tokens')<>'array' OR jsonb_array_length(rule->'tokens') NOT BETWEEN 1 AND 12 OR EXISTS(SELECT 1 FROM jsonb_array_elements(rule->'tokens') token WHERE jsonb_typeof(token)<>'string' OR token#>>'{}'!~'^[[:alnum:]]{1,64}$' OR token#>>'{}' IS DISTINCT FROM lower(normalize(token#>>'{}',NFKD))) OR (SELECT count(*) FROM jsonb_array_elements_text(rule->'tokens'))<>(SELECT count(DISTINCT token) FROM jsonb_array_elements_text(rule->'tokens') token) OR rule->'tokens' IS DISTINCT FROM (SELECT jsonb_agg(to_jsonb(token) ORDER BY token COLLATE "C") FROM jsonb_array_elements_text(rule->'tokens') token) THEN RAISE EXCEPTION 'naming rule invalid'; END IF;
  END LOOP;
  IF p->'nameRules' IS DISTINCT FROM (SELECT jsonb_agg(value ORDER BY value->>'source' COLLATE "C",value->>'match' COLLATE "C",value->'tokens'::text COLLATE "C") FROM jsonb_array_elements(p->'nameRules')) OR (SELECT count(*) FROM jsonb_array_elements(p->'nameRules'))<>(SELECT count(DISTINCT concat_ws(':',value->>'source',value->>'match',value->'tokens'::text)) FROM jsonb_array_elements(p->'nameRules')) THEN RAISE EXCEPTION 'naming rule order invalid'; END IF;
  FOR selector IN SELECT value FROM jsonb_array_elements(p->'corroboration') LOOP
    IF jsonb_typeof(selector)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(selector))<>3 OR NOT(selector ?& ARRAY['kind','operator','expected']) OR jsonb_typeof(selector->'kind')<>'string' OR jsonb_typeof(selector->'operator')<>'string' OR selector->>'kind' NOT IN('objective','optimization','geo','targeting','platform','creative','cta','destination') OR selector->>'operator' NOT IN('equals','includes_all','includes_any','present') OR jsonb_typeof(selector->'expected')<>'array' OR selector->>'operator'='present' AND jsonb_array_length(selector->'expected')<>0 OR selector->>'operator'<>'present' AND jsonb_array_length(selector->'expected') NOT BETWEEN 1 AND 32 OR EXISTS(SELECT 1 FROM jsonb_array_elements(selector->'expected') value WHERE jsonb_typeof(value)<>'string' OR value#>>'{}'!~'^[a-z][a-z0-9_.:-]{0,63}$') OR (SELECT count(*) FROM jsonb_array_elements_text(selector->'expected'))<>(SELECT count(DISTINCT value) FROM jsonb_array_elements_text(selector->'expected') value) OR selector->'expected' IS DISTINCT FROM (SELECT coalesce(jsonb_agg(to_jsonb(value) ORDER BY value COLLATE "C"),'[]'::jsonb) FROM jsonb_array_elements_text(selector->'expected') value) THEN RAISE EXCEPTION 'naming corroboration invalid'; END IF;
  END LOOP;
  IF p->'corroboration' IS DISTINCT FROM (SELECT jsonb_agg(value ORDER BY value->>'kind' COLLATE "C",value->>'operator' COLLATE "C",value->'expected'::text COLLATE "C") FROM jsonb_array_elements(p->'corroboration')) OR (SELECT count(*) FROM jsonb_array_elements(p->'corroboration'))<>(SELECT count(DISTINCT concat_ws(':',value->>'kind',value->>'operator',value->'expected'::text)) FROM jsonb_array_elements(p->'corroboration')) THEN RAISE EXCEPTION 'naming corroboration order invalid'; END IF;
  FOR proposed IN SELECT value FROM jsonb_array_elements(p->'proposedAssignments') LOOP
    IF jsonb_typeof(proposed)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(proposed))<>2 OR NOT(proposed ?& ARRAY['dimensionRef','definitionRef']) OR jsonb_typeof(proposed->'dimensionRef')<>'string' OR jsonb_typeof(proposed->'definitionRef')<>'string' OR proposed->>'dimensionRef'!~'^dimension_[a-f0-9]{24}$' OR proposed->>'definitionRef'!~'^category_[a-f0-9]{24}$' THEN RAISE EXCEPTION 'naming proposal invalid'; END IF;
  END LOOP;
  IF (SELECT count(*) FROM jsonb_array_elements(p->'proposedAssignments'))<>(SELECT count(DISTINCT value->>'dimensionRef') FROM jsonb_array_elements(p->'proposedAssignments')) THEN RAISE EXCEPTION 'naming proposal duplicate'; END IF;
  IF p->'proposedAssignments' IS DISTINCT FROM (SELECT jsonb_agg(value ORDER BY value->>'dimensionRef' COLLATE "C",value->>'definitionRef' COLLATE "C") FROM jsonb_array_elements(p->'proposedAssignments')) THEN RAISE EXCEPTION 'naming proposal order invalid'; END IF;
  expected:=public.guide_run_sha256(jsonb_build_object('version',p->'version','workspaceRef',p->'workspaceRef','accountRef',p->'accountRef','templateRef',p->'templateRef','revision',p->'revision','previousRevisionHash',p->'previousRevisionHash','state',p->'state','namingFamily',p->'namingFamily','entityLevel',p->'entityLevel','nameRules',p->'nameRules','corroboration',p->'corroboration','proposedAssignments',p->'proposedAssignments','authority',p->'authority'));
  IF NEW.revision_hash IS DISTINCT FROM expected THEN RAISE EXCEPTION 'naming template hash invalid'; END IF;
  RETURN NEW;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'naming template payload invalid';
END; $$;
CREATE FUNCTION public.naming_template_head_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE r public.naming_template_revisions%ROWTYPE; old_r public.naming_template_revisions%ROWTYPE;
BEGIN
  IF TG_OP='DELETE' THEN IF EXISTS(SELECT 1 FROM public.workspaces WHERE id=OLD.workspace_id AND lifecycle_state='tombstoning') THEN RETURN OLD; END IF; RAISE EXCEPTION 'naming template heads may only be purged by tombstone'; END IF;
  SELECT * INTO r FROM public.naming_template_revisions WHERE workspace_id=NEW.workspace_id AND id=NEW.latest_revision_id FOR KEY SHARE;
  IF NOT FOUND OR (r.ad_account_id,r.template_ref,r.revision,r.created_at) IS DISTINCT FROM (NEW.ad_account_id,NEW.template_ref,NEW.version,NEW.updated_at) THEN RAISE EXCEPTION 'naming template head identity invalid'; END IF;
  IF TG_OP='INSERT' THEN IF NEW.version<>1 OR r.previous_revision_hash IS NOT NULL THEN RAISE EXCEPTION 'naming template head genesis invalid'; END IF;
  ELSE
    IF (NEW.workspace_id,NEW.ad_account_id,NEW.template_ref) IS DISTINCT FROM (OLD.workspace_id,OLD.ad_account_id,OLD.template_ref) OR NEW.version<>OLD.version+1 THEN RAISE EXCEPTION 'naming template head OCC invalid'; END IF;
    SELECT * INTO old_r FROM public.naming_template_revisions WHERE workspace_id=OLD.workspace_id AND id=OLD.latest_revision_id;
    IF NOT FOUND OR r.previous_revision_hash IS DISTINCT FROM old_r.revision_hash THEN RAISE EXCEPTION 'naming template head chain invalid'; END IF;
    IF NOT ((old_r.state='draft' AND r.state IN('draft','published')) OR (old_r.state='published' AND r.state IN('draft','disabled'))) THEN RAISE EXCEPTION 'naming template state transition invalid'; END IF;
  END IF; RETURN NEW;
END; $$;
CREATE FUNCTION public.naming_template_revision_must_have_head() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
BEGIN IF NOT EXISTS(SELECT 1 FROM public.naming_template_heads WHERE workspace_id=NEW.workspace_id AND ad_account_id=NEW.ad_account_id AND template_ref=NEW.template_ref AND version>=NEW.revision) THEN RAISE EXCEPTION 'naming template revision orphaned'; END IF; RETURN NULL; END; $$;
CREATE TRIGGER naming_template_revisions_guard BEFORE INSERT OR UPDATE OR DELETE ON public.naming_template_revisions FOR EACH ROW EXECUTE FUNCTION public.naming_template_revision_guard();
CREATE TRIGGER naming_template_heads_guard BEFORE INSERT OR UPDATE OR DELETE ON public.naming_template_heads FOR EACH ROW EXECUTE FUNCTION public.naming_template_head_guard();
CREATE CONSTRAINT TRIGGER naming_template_revisions_head_required AFTER INSERT ON public.naming_template_revisions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION public.naming_template_revision_must_have_head();
ALTER TABLE public.naming_template_revisions ENABLE ROW LEVEL SECURITY; ALTER TABLE public.naming_template_revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE public.naming_template_heads ENABLE ROW LEVEL SECURITY; ALTER TABLE public.naming_template_heads FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.naming_template_revisions,public.naming_template_heads FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.naming_template_revision_guard(),public.naming_template_head_guard(),public.naming_template_revision_must_have_head() FROM PUBLIC,anon,authenticated,service_role;
