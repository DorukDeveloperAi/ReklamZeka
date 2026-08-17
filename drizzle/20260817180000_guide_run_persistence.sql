-- P05 PREONLY. Do not apply or journal before independent critical approval.
-- The domain event/hash algorithms remain the only source of run semantics.
CREATE TABLE guide_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE cascade,
 guide_id uuid NOT NULL, guide_revision_id uuid NOT NULL, run_ref text NOT NULL, guide_revision_hash text NOT NULL,
 idempotency_key text NOT NULL, run_version text NOT NULL, trigger_payload jsonb NOT NULL, created_at timestamptz NOT NULL,
 CONSTRAINT guide_runs_contract CHECK (run_ref ~ '^guide_run_[a-f0-9]{24}$' AND guide_revision_hash ~ '^[a-f0-9]{64}$' AND idempotency_key ~ '^guide_(slot|manual)_[a-f0-9]{64}$' AND run_version='guide-run/1.2.0' AND jsonb_typeof(trigger_payload)='object' AND octet_length(trigger_payload::text)<=16878)
);
CREATE TABLE guide_run_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE cascade, run_id uuid NOT NULL,
 event_ref text NOT NULL, event_hash text NOT NULL, sequence integer NOT NULL, previous_event_hash text NOT NULL, payload jsonb NOT NULL, occurred_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT guide_run_events_contract CHECK (event_ref ~ '^guide_run_event_[a-f0-9]{24}$' AND event_hash ~ '^[a-f0-9]{64}$' AND previous_event_hash ~ '^(GENESIS|[a-f0-9]{64})$' AND sequence BETWEEN 1 AND 1000000 AND jsonb_typeof(payload)='object' AND octet_length(payload::text)<=16878)
);
CREATE TABLE guide_run_heads (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE cascade, run_id uuid NOT NULL,
 state text NOT NULL, sequence integer NOT NULL, head_event_hash text NOT NULL, lease_token uuid, lease_epoch integer, lease_expires_at timestamptz, run_payload jsonb NOT NULL, updated_at timestamptz NOT NULL,
 CONSTRAINT guide_run_heads_contract CHECK (state IN ('due','claimed','scope_frozen','analyzing','recorded','held','staged','no_action','completed','failed','missed') AND sequence BETWEEN 1 AND 1000000 AND head_event_hash ~ '^[a-f0-9]{64}$' AND ((lease_token IS NULL AND lease_epoch IS NULL AND lease_expires_at IS NULL) OR (lease_token IS NOT NULL AND lease_epoch>=1 AND lease_expires_at IS NOT NULL)) AND jsonb_typeof(run_payload)='object' AND octet_length(run_payload::text)<=1048576)
);
CREATE TABLE guide_run_artifacts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE cascade, run_id uuid NOT NULL,
 artifact_ref text NOT NULL, kind text NOT NULL, payload_hash text NOT NULL, payload jsonb NOT NULL, occurred_at timestamptz NOT NULL, authority jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT guide_run_artifacts_contract CHECK (artifact_ref ~ '^guide_run_artifact_[a-f0-9]{24}$' AND kind IN ('scope_snapshot','member_analysis','member_failure','holistic_analysis','disposition','finding_observation','development_log_intent') AND payload_hash ~ '^[a-f0-9]{64}$' AND jsonb_typeof(payload)='object' AND ((kind='scope_snapshot' AND octet_length(payload::text)<=4194304) OR (kind<>'scope_snapshot' AND octet_length(payload::text)<=16878)) AND authority='{"canMutateGuide":false,"canApprove":false,"canExecute":false,"canWriteMeta":false}'::jsonb)
);
CREATE TABLE guide_run_schedule_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE cascade, guide_revision_id uuid NOT NULL,
 fire_ref text NOT NULL, scheduled_for timestamptz NOT NULL, missed_from timestamptz, missed_to timestamptz, missed_count integer NOT NULL, run_id uuid, receipt_hash text NOT NULL, created_at timestamptz NOT NULL,
 CONSTRAINT guide_run_schedule_receipts_contract CHECK (fire_ref ~ '^guide_fire_[a-f0-9]{64}$' AND receipt_hash ~ '^[a-f0-9]{64}$' AND missed_count BETWEEN 0 AND 4000000 AND ((missed_from IS NULL AND missed_to IS NULL AND missed_count=0) OR (missed_from IS NOT NULL AND missed_to IS NOT NULL AND missed_count>=1 AND missed_from<=missed_to AND missed_to<=scheduled_for)))
);
CREATE UNIQUE INDEX guide_runs_workspace_row_unique ON guide_runs(workspace_id,id); CREATE UNIQUE INDEX guide_runs_workspace_revision_row_unique ON guide_runs(workspace_id,id,guide_revision_id); CREATE UNIQUE INDEX guide_runs_workspace_ref_unique ON guide_runs(workspace_id,run_ref); CREATE UNIQUE INDEX guide_runs_workspace_idempotency_unique ON guide_runs(workspace_id,idempotency_key); CREATE INDEX guide_runs_workspace_guide_fk_idx ON guide_runs(workspace_id,guide_id); CREATE INDEX guide_runs_workspace_revision_created_idx ON guide_runs(workspace_id,guide_revision_id,created_at);
CREATE UNIQUE INDEX guide_run_events_workspace_row_unique ON guide_run_events(workspace_id,id); CREATE UNIQUE INDEX guide_run_events_workspace_hash_unique ON guide_run_events(workspace_id,event_hash); CREATE UNIQUE INDEX guide_run_events_workspace_sequence_unique ON guide_run_events(workspace_id,run_id,sequence); CREATE INDEX guide_run_events_workspace_run_time_idx ON guide_run_events(workspace_id,run_id,occurred_at);
CREATE UNIQUE INDEX guide_run_heads_workspace_run_unique ON guide_run_heads(workspace_id,run_id); CREATE INDEX guide_run_heads_workspace_event_fk_idx ON guide_run_heads(workspace_id,head_event_hash); CREATE INDEX guide_run_heads_workspace_lease_idx ON guide_run_heads(workspace_id,lease_expires_at);
CREATE UNIQUE INDEX guide_run_artifacts_workspace_ref_unique ON guide_run_artifacts(workspace_id,artifact_ref); CREATE INDEX guide_run_artifacts_workspace_run_kind_idx ON guide_run_artifacts(workspace_id,run_id,kind);
CREATE UNIQUE INDEX guide_run_schedule_receipts_workspace_fire_unique ON guide_run_schedule_receipts(workspace_id,fire_ref); CREATE UNIQUE INDEX guide_run_schedule_receipts_workspace_revision_slot_unique ON guide_run_schedule_receipts(workspace_id,guide_revision_id,scheduled_for); CREATE INDEX guide_run_schedule_receipts_workspace_run_revision_fk_idx ON guide_run_schedule_receipts(workspace_id,run_id,guide_revision_id); CREATE INDEX guide_run_schedule_receipts_workspace_revision_time_idx ON guide_run_schedule_receipts(workspace_id,guide_revision_id,scheduled_for);
ALTER TABLE guide_runs ADD CONSTRAINT guide_runs_guide_scope_fk FOREIGN KEY(workspace_id,guide_id) REFERENCES guides(workspace_id,id) ON DELETE restrict; ALTER TABLE guide_runs ADD CONSTRAINT guide_runs_revision_scope_fk FOREIGN KEY(workspace_id,guide_revision_id,guide_id) REFERENCES guide_revisions(workspace_id,id,guide_id) ON DELETE restrict;
ALTER TABLE guide_run_events ADD CONSTRAINT guide_run_events_run_scope_fk FOREIGN KEY(workspace_id,run_id) REFERENCES guide_runs(workspace_id,id) ON DELETE cascade;
ALTER TABLE guide_run_heads ADD CONSTRAINT guide_run_heads_run_scope_fk FOREIGN KEY(workspace_id,run_id) REFERENCES guide_runs(workspace_id,id) ON DELETE cascade; ALTER TABLE guide_run_heads ADD CONSTRAINT guide_run_heads_event_scope_fk FOREIGN KEY(workspace_id,head_event_hash) REFERENCES guide_run_events(workspace_id,event_hash) ON DELETE restrict;
ALTER TABLE guide_run_artifacts ADD CONSTRAINT guide_run_artifacts_run_scope_fk FOREIGN KEY(workspace_id,run_id) REFERENCES guide_runs(workspace_id,id) ON DELETE cascade;
ALTER TABLE guide_run_schedule_receipts ADD CONSTRAINT guide_run_schedule_receipts_revision_scope_fk FOREIGN KEY(workspace_id,guide_revision_id) REFERENCES guide_revisions(workspace_id,id) ON DELETE restrict; ALTER TABLE guide_run_schedule_receipts ADD CONSTRAINT guide_run_schedule_receipts_run_revision_scope_fk FOREIGN KEY(workspace_id,run_id,guide_revision_id) REFERENCES guide_runs(workspace_id,id,guide_revision_id) ON DELETE restrict;

-- SQL hashing supports precisely the JSON subset emitted by GuideRun v1.2:
-- strings, booleans, null, arrays, objects with ASCII keys, and safe integer
-- numbers.  Rejecting e.g. 1e21/1e-7 prevents silent JS/PG serializer drift.
CREATE OR REPLACE FUNCTION public.guide_run_canonical_json(value jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
DECLARE item record; result text; numeric_value numeric; BEGIN
 CASE jsonb_typeof(value)
 WHEN 'object' THEN
   IF EXISTS (SELECT 1 FROM jsonb_object_keys(value) AS keys(key_name) WHERE keys.key_name !~ '^[A-Za-z0-9_]+$') THEN RAISE EXCEPTION 'unsupported guide run JSON key'; END IF;
   SELECT '{'||coalesce(string_agg(to_jsonb(key)::text||':'||public.guide_run_canonical_json(val),',' ORDER BY key COLLATE "C"),'')||'}' INTO result FROM jsonb_each(value) AS entry(key,val);
 WHEN 'array' THEN SELECT '['||coalesce(string_agg(public.guide_run_canonical_json(val),',' ORDER BY ord),'')||']' INTO result FROM jsonb_array_elements(value) WITH ORDINALITY AS entry(val,ord);
 WHEN 'number' THEN
   numeric_value := value::text::numeric;
   IF trunc(numeric_value)<>numeric_value OR abs(numeric_value)>9007199254740991 THEN RAISE EXCEPTION 'unsupported guide run JSON number'; END IF;
   result:=numeric_value::text;
 ELSE result:=value::text; END CASE; RETURN result;
END; $$;
CREATE OR REPLACE FUNCTION public.guide_run_sha256(value jsonb) RETURNS text LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$ SELECT encode(extensions.digest(convert_to(public.guide_run_canonical_json(value),'UTF8'),'sha256'),'hex') $$;
CREATE OR REPLACE FUNCTION public.guide_run_transition_allowed(previous text, next text) RETURNS boolean LANGUAGE sql IMMUTABLE SECURITY INVOKER SET search_path='' AS $$
 SELECT CASE previous
 WHEN 'due' THEN next IN ('claimed','missed','failed')
 WHEN 'claimed' THEN next IN ('claimed','scope_frozen','failed')
 WHEN 'scope_frozen' THEN next IN ('scope_frozen','analyzing','failed')
 WHEN 'analyzing' THEN next IN ('analyzing','recorded','failed')
 WHEN 'recorded' THEN next IN ('recorded','held','staged','no_action','failed')
 WHEN 'held' THEN next IN ('held','completed','failed')
 WHEN 'staged' THEN next IN ('staged','completed','failed')
 WHEN 'no_action' THEN next IN ('no_action','completed','failed')
 ELSE false END $$;
CREATE OR REPLACE FUNCTION public.guide_run_immutable_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$ BEGIN
 IF TG_OP='INSERT' THEN RETURN NEW; END IF; IF TG_OP='DELETE' AND EXISTS(SELECT 1 FROM public.workspaces WHERE id=OLD.workspace_id AND lifecycle_state='tombstoning') THEN RETURN OLD; END IF; RAISE EXCEPTION 'guide run evidence is append-only';
END; $$;
CREATE OR REPLACE FUNCTION public.guide_run_artifact_insert_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$ DECLARE r public.guide_runs%ROWTYPE; expected_hash text; BEGIN
 SELECT * INTO r FROM public.guide_runs WHERE workspace_id=NEW.workspace_id AND id=NEW.run_id;
 expected_hash:=public.guide_run_sha256(NEW.payload);
 IF r.id IS NULL OR (NEW.kind='scope_snapshot' AND NEW.payload->>'runRef' IS DISTINCT FROM r.run_ref)
    OR NEW.authority<>'{"canMutateGuide":false,"canApprove":false,"canExecute":false,"canWriteMeta":false}'::jsonb
    OR NEW.payload_hash IS DISTINCT FROM expected_hash OR NEW.artifact_ref IS DISTINCT FROM 'guide_run_artifact_'||substr(public.guide_run_sha256(jsonb_build_object('runRef',r.run_ref,'kind',NEW.kind,'payload',NEW.payload)),1,24)
 THEN RAISE EXCEPTION 'guide run artifact must bind exact closed run'; END IF;
 RETURN NEW;
END; $$;
CREATE OR REPLACE FUNCTION public.guide_run_head_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$ DECLARE e public.guide_run_events%ROWTYPE; r public.guide_runs%ROWTYPE; persisted_event jsonb; canonical_workspace_ref text; canonical_run_ref text; canonical_idempotency text; guide_ref_value text; BEGIN
 IF TG_OP='DELETE' THEN IF EXISTS(SELECT 1 FROM public.workspaces WHERE id=OLD.workspace_id AND lifecycle_state='tombstoning') THEN RETURN OLD; END IF; RAISE EXCEPTION 'guide run head is append-only except exact advance'; END IF;
 SELECT * INTO e FROM public.guide_run_events WHERE workspace_id=NEW.workspace_id AND event_hash=NEW.head_event_hash; SELECT * INTO r FROM public.guide_runs WHERE workspace_id=NEW.workspace_id AND id=NEW.run_id; SELECT guide_ref INTO guide_ref_value FROM public.guides WHERE workspace_id=NEW.workspace_id AND id=r.guide_id;
 canonical_workspace_ref:='workspace_'||substr(encode(extensions.digest(convert_to(NEW.workspace_id::text,'UTF8'),'sha256'),'hex'),1,16);
 IF jsonb_typeof(r.trigger_payload)<>'object' OR cardinality(ARRAY(SELECT jsonb_object_keys(r.trigger_payload)))<>2 OR NOT (r.trigger_payload ? 'kind') THEN RAISE EXCEPTION 'guide run trigger malformed'; END IF;
 IF r.trigger_payload->>'kind'='scheduled' AND r.trigger_payload ?& ARRAY['kind','scheduledFor'] THEN canonical_idempotency:='guide_slot_'||public.guide_run_sha256(jsonb_build_object('guideRevisionHash',r.guide_revision_hash,'scheduledFor',r.trigger_payload->>'scheduledFor'));
 ELSIF r.trigger_payload->>'kind'='manual' AND r.trigger_payload ?& ARRAY['kind','requestRef'] THEN canonical_idempotency:='guide_manual_'||public.guide_run_sha256(jsonb_build_object('guideRevisionHash',r.guide_revision_hash,'requestRef',r.trigger_payload->>'requestRef'));
 ELSE RAISE EXCEPTION 'guide run trigger malformed'; END IF;
 canonical_run_ref:='guide_run_'||substr(public.guide_run_sha256(jsonb_build_object('workspaceRef',canonical_workspace_ref,'guideRef',guide_ref_value,'guideRevisionHash',r.guide_revision_hash,'trigger',r.trigger_payload,'idempotencyKey',canonical_idempotency)),1,24);
 IF e.id IS NULL OR e.run_id<>NEW.run_id OR e.sequence<>NEW.sequence OR e.occurred_at<>NEW.updated_at OR r.id IS NULL
    OR jsonb_typeof(e.payload)<>'object' OR cardinality(ARRAY(SELECT jsonb_object_keys(e.payload)))<>13 OR NOT (e.payload ?& ARRAY['version','eventRef','runRef','sequence','previousEventHash','fromState','toState','occurredAt','leaseToken','leaseUntil','leaseEpoch','reasonCode','eventHash'])
    OR e.payload->>'version'<>'guide-run-event/1.2.0' OR e.payload->>'eventRef'<>e.event_ref OR e.payload->>'eventHash'<>e.event_hash OR e.payload->>'runRef'<>r.run_ref
    OR e.event_hash IS DISTINCT FROM public.guide_run_sha256(e.payload - ARRAY['eventRef','eventHash']) OR e.event_ref IS DISTINCT FROM 'guide_run_event_'||substr(e.event_hash,1,24)
    OR (e.payload->>'sequence')::integer<>e.sequence OR e.payload->>'previousEventHash'<>e.previous_event_hash
    OR e.payload->>'toState'<>NEW.state OR e.payload->>'occurredAt'<>to_char(NEW.updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    OR (NEW.lease_token IS NULL AND NOT (
      (e.payload->'leaseToken'='null'::jsonb AND e.payload->'leaseUntil'='null'::jsonb AND e.payload->'leaseEpoch'='null'::jsonb)
      OR (TG_OP='UPDATE' AND NEW.state IN ('completed','failed','missed') AND OLD.lease_token IS NOT NULL
        AND e.payload->>'leaseToken'=OLD.lease_token::text AND (e.payload->>'leaseEpoch')::integer=OLD.lease_epoch
        AND e.payload->>'leaseUntil'=to_char(OLD.lease_expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))))
    OR (NEW.lease_token IS NOT NULL AND ((e.payload->>'leaseToken')<>NEW.lease_token::text OR (e.payload->>'leaseEpoch')::integer<>NEW.lease_epoch OR (e.payload->>'leaseUntil')<>to_char(NEW.lease_expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')))
    OR jsonb_typeof(NEW.run_payload)<>'object' OR cardinality(ARRAY(SELECT jsonb_object_keys(NEW.run_payload)))<>13 OR NOT (NEW.run_payload ?& ARRAY['version','runRef','workspaceRef','guideRef','guideRevisionHash','trigger','idempotencyKey','state','sequence','headEventHash','lease','events','authority'])
    OR r.run_ref<>canonical_run_ref OR r.idempotency_key<>canonical_idempotency OR NEW.run_payload->>'workspaceRef'<>canonical_workspace_ref OR NEW.run_payload->>'guideRef'<>guide_ref_value
    OR NEW.run_payload->>'runRef' IS DISTINCT FROM r.run_ref OR NEW.run_payload->>'guideRevisionHash' IS DISTINCT FROM r.guide_revision_hash
    OR NEW.run_payload->>'idempotencyKey'<>r.idempotency_key OR NEW.run_payload->>'version'<>r.run_version OR NEW.run_payload->'trigger'<>r.trigger_payload
    OR NEW.run_payload->>'state'<>NEW.state OR (NEW.run_payload->>'sequence')::integer<>NEW.sequence OR NEW.run_payload->>'headEventHash'<>NEW.head_event_hash
    OR jsonb_typeof(NEW.run_payload->'events')<>'array' OR jsonb_array_length(NEW.run_payload->'events')<>NEW.sequence OR NEW.run_payload->'events'->(NEW.sequence-1)->>'eventHash'<>NEW.head_event_hash
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(NEW.run_payload->'events') WITH ORDINALITY payload(event_value,ordinality) LEFT JOIN public.guide_run_events persisted ON persisted.workspace_id=NEW.workspace_id AND persisted.run_id=NEW.run_id AND persisted.sequence=payload.ordinality WHERE persisted.id IS NULL OR persisted.event_hash IS DISTINCT FROM payload.event_value->>'eventHash' OR persisted.payload IS DISTINCT FROM payload.event_value)
    OR NEW.run_payload->'authority'<>'{"canApprove":false,"canExecute":false,"canWriteMeta":false}'::jsonb
    OR (NEW.lease_token IS NULL AND NEW.run_payload->'lease' <> 'null'::jsonb) OR (NEW.lease_token IS NOT NULL AND (NEW.run_payload->'lease'->>'token')<>NEW.lease_token::text OR (NEW.run_payload->'lease'->>'epoch')::integer<>NEW.lease_epoch OR (NEW.run_payload->'lease'->>'expiresAt')<>to_char(NEW.lease_expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
 THEN RAISE EXCEPTION 'guide run head must bind exact event and run envelope'; END IF;
 IF TG_OP='INSERT' THEN
   IF NEW.sequence<>1 OR e.previous_event_hash<>'GENESIS' OR e.payload->'fromState'<>'null'::jsonb OR e.payload->'reasonCode'<>'null'::jsonb OR NEW.state<>'due' OR NEW.lease_token IS NOT NULL THEN RAISE EXCEPTION 'guide run head must begin at due genesis'; END IF;
 ELSE
   IF NEW.workspace_id<>OLD.workspace_id OR NEW.run_id<>OLD.run_id OR NEW.sequence<>OLD.sequence+1 OR e.previous_event_hash<>OLD.head_event_hash
      OR e.payload->>'fromState' IS DISTINCT FROM OLD.state OR NOT public.guide_run_transition_allowed(OLD.state,NEW.state) THEN RAISE EXCEPTION 'guide run head requires next event CAS'; END IF;
   IF NEW.state IN ('completed','failed','missed') AND (
     NEW.lease_token IS NOT NULL OR NEW.lease_epoch IS NOT NULL OR NEW.lease_expires_at IS NOT NULL
     OR (OLD.lease_token IS NULL AND (e.payload->'leaseToken'<>'null'::jsonb OR e.payload->'leaseUntil'<>'null'::jsonb OR e.payload->'leaseEpoch'<>'null'::jsonb))
     OR (OLD.lease_token IS NOT NULL AND (e.payload->>'leaseToken'<>OLD.lease_token::text OR (e.payload->>'leaseEpoch')::integer<>OLD.lease_epoch OR e.payload->>'leaseUntil'<>to_char(OLD.lease_expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
   )) THEN RAISE EXCEPTION 'terminal guide run lease mismatch'; END IF;
   IF NEW.state NOT IN ('completed','failed','missed') AND OLD.lease_token IS NULL
      AND (OLD.state<>'due' OR NEW.state<>'claimed' OR NEW.lease_epoch<>1 OR NEW.lease_token IS NULL OR NEW.lease_expires_at<=NEW.updated_at) THEN RAISE EXCEPTION 'initial guide run lease mismatch'; END IF;
   IF NEW.state NOT IN ('completed','failed','missed') AND OLD.lease_token IS NOT NULL AND NEW.state=OLD.state
      AND (NEW.lease_epoch<>OLD.lease_epoch+1 OR (NEW.updated_at<OLD.lease_expires_at AND (NEW.lease_token<>OLD.lease_token OR NEW.lease_expires_at<=OLD.lease_expires_at))
        OR (NEW.updated_at>=OLD.lease_expires_at AND (NEW.lease_token=OLD.lease_token OR NEW.lease_expires_at<=NEW.updated_at))) THEN RAISE EXCEPTION 'guide run renew or reclaim mismatch'; END IF;
   IF NEW.state NOT IN ('completed','failed','missed') AND OLD.lease_token IS NOT NULL AND NEW.state<>OLD.state
      AND (NEW.lease_token<>OLD.lease_token OR NEW.lease_epoch<>OLD.lease_epoch OR NEW.lease_expires_at<>OLD.lease_expires_at) THEN RAISE EXCEPTION 'guide run ordinary advance lease mismatch'; END IF;
 END IF;
 RETURN NEW; END; $$;
CREATE TRIGGER guide_runs_append_only BEFORE UPDATE OR DELETE ON guide_runs FOR EACH ROW EXECUTE FUNCTION public.guide_run_immutable_guard();
CREATE TRIGGER guide_run_events_append_only BEFORE UPDATE OR DELETE ON guide_run_events FOR EACH ROW EXECUTE FUNCTION public.guide_run_immutable_guard();
CREATE TRIGGER guide_run_artifacts_append_only BEFORE UPDATE OR DELETE ON guide_run_artifacts FOR EACH ROW EXECUTE FUNCTION public.guide_run_immutable_guard();
CREATE TRIGGER guide_run_artifacts_exact_insert BEFORE INSERT ON guide_run_artifacts FOR EACH ROW EXECUTE FUNCTION public.guide_run_artifact_insert_guard();
CREATE TRIGGER guide_run_schedule_receipts_append_only BEFORE UPDATE OR DELETE ON guide_run_schedule_receipts FOR EACH ROW EXECUTE FUNCTION public.guide_run_immutable_guard();
CREATE TRIGGER guide_run_heads_exact_advance BEFORE INSERT OR UPDATE OR DELETE ON guide_run_heads FOR EACH ROW EXECUTE FUNCTION public.guide_run_head_guard();
REVOKE ALL PRIVILEGES ON FUNCTION public.guide_run_canonical_json(jsonb),public.guide_run_sha256(jsonb),public.guide_run_transition_allowed(text,text),public.guide_run_immutable_guard(),public.guide_run_artifact_insert_guard(),public.guide_run_head_guard() FROM PUBLIC,anon,authenticated,service_role;
ALTER TABLE guide_runs ENABLE ROW LEVEL SECURITY; ALTER TABLE guide_runs FORCE ROW LEVEL SECURITY; ALTER TABLE guide_run_events ENABLE ROW LEVEL SECURITY; ALTER TABLE guide_run_events FORCE ROW LEVEL SECURITY; ALTER TABLE guide_run_heads ENABLE ROW LEVEL SECURITY; ALTER TABLE guide_run_heads FORCE ROW LEVEL SECURITY; ALTER TABLE guide_run_artifacts ENABLE ROW LEVEL SECURITY; ALTER TABLE guide_run_artifacts FORCE ROW LEVEL SECURITY; ALTER TABLE guide_run_schedule_receipts ENABLE ROW LEVEL SECURITY; ALTER TABLE guide_run_schedule_receipts FORCE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE guide_runs,guide_run_events,guide_run_heads,guide_run_artifacts,guide_run_schedule_receipts FROM PUBLIC,anon,authenticated,service_role;
