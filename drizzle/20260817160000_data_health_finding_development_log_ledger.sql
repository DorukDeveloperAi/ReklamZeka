-- P01-E preflight only; intentionally unjournalled and unapplied.
-- Server-private, append-only generic Finding + Development Log ledgers.
-- Legacy producer invariant: category='data' and state='proposed' and event_type='proposed';
-- producer actor_kind in ('system','agent'). User transitions are separately typed below.
CREATE TABLE finding_lifecycle_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE cascade,
 namespace text NOT NULL, resolution_scope text NOT NULL, fingerprint text NOT NULL, sequence integer NOT NULL,
 event_type text NOT NULL, state text NOT NULL, evidence_hash text NOT NULL, previous_event_hash text NOT NULL,
 event_hash text NOT NULL, source_occurrence_hash text NOT NULL, report_hash text NOT NULL, occurred_at timestamptz NOT NULL,
 observation_payload jsonb, created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT finding_lifecycle_events_contract CHECK (
  namespace ~ '^[a-z][a-z0-9_.:-]{0,63}$' AND octet_length(resolution_scope) BETWEEN 1 AND 256 AND fingerprint ~ '^[a-z][a-z0-9_.:-]{0,127}$'
  AND sequence BETWEEN 1 AND 1000000 AND event_type IN ('opened','observed','resolved','reopened') AND state IN ('open','resolved')
  AND evidence_hash ~ '^[a-f0-9]{64}$' AND previous_event_hash ~ '^(0{64}|[a-f0-9]{64})$' AND event_hash ~ '^[a-f0-9]{64}$' AND source_occurrence_hash ~ '^[a-f0-9]{64}$' AND report_hash ~ '^[a-f0-9]{64}$'
  AND (observation_payload IS NULL OR (jsonb_typeof(observation_payload)='object' AND octet_length(observation_payload::text)<=16878))
  )
);
CREATE TABLE finding_heads (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE cascade,
 namespace text NOT NULL, resolution_scope text NOT NULL, fingerprint text NOT NULL, sequence integer NOT NULL, state text NOT NULL,
 evidence_hash text NOT NULL, event_hash text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT finding_heads_contract CHECK (namespace ~ '^[a-z][a-z0-9_.:-]{0,63}$' AND octet_length(resolution_scope) BETWEEN 1 AND 256 AND fingerprint ~ '^[a-z][a-z0-9_.:-]{0,127}$' AND sequence BETWEEN 1 AND 1000000 AND state IN ('open','resolved') AND evidence_hash ~ '^[a-f0-9]{64}$' AND event_hash ~ '^[a-f0-9]{64}$')
);
CREATE TABLE development_log_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE cascade,
 namespace text NOT NULL, resolution_scope text NOT NULL, fingerprint text NOT NULL, sequence integer NOT NULL, finding_event_hash text NOT NULL,
 source_occurrence_hash text NOT NULL, category text NOT NULL, state text NOT NULL, event_type text NOT NULL, actor_kind text NOT NULL,
 actor_user_id uuid REFERENCES users(id) ON DELETE restrict, previous_event_hash text NOT NULL, event_hash text NOT NULL,
 occurred_at timestamptz NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT development_log_events_contract CHECK (
  namespace ~ '^[a-z][a-z0-9_.:-]{0,63}$' AND octet_length(resolution_scope) BETWEEN 1 AND 256 AND fingerprint ~ '^[a-z][a-z0-9_.:-]{0,127}$' AND sequence BETWEEN 1 AND 1000000
  AND finding_event_hash ~ '^[a-f0-9]{64}$' AND source_occurrence_hash ~ '^[a-f0-9]{64}$'
  AND category IN ('data','meta_integration','guide','agent','analysis','action','ui_product')
  AND state IN ('proposed','triaged','tasked','deferred','rejected','closed') AND event_type IN ('proposed','observed','reproposed','triaged','tasked','deferred','rejected','closed')
  AND actor_kind IN ('system','agent','tenant_member') AND ((actor_kind='tenant_member' AND actor_user_id IS NOT NULL) OR (actor_kind IN ('system','agent') AND actor_user_id IS NULL))
  AND previous_event_hash ~ '^(0{64}|[a-f0-9]{64})$' AND event_hash ~ '^[a-f0-9]{64}$' AND jsonb_typeof(payload)='object' AND octet_length(payload::text)<=16878
  )
);
CREATE TABLE development_log_heads (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE cascade,
 namespace text NOT NULL, resolution_scope text NOT NULL, fingerprint text NOT NULL, sequence integer NOT NULL, state text NOT NULL,
 event_hash text NOT NULL, latest_event_id uuid NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
 CONSTRAINT development_log_heads_contract CHECK (namespace ~ '^[a-z][a-z0-9_.:-]{0,63}$' AND octet_length(resolution_scope) BETWEEN 1 AND 256 AND fingerprint ~ '^[a-z][a-z0-9_.:-]{0,127}$' AND sequence BETWEEN 1 AND 1000000 AND state IN ('proposed','triaged','tasked','deferred','rejected','closed') AND event_hash ~ '^[a-f0-9]{64}$')
);
CREATE UNIQUE INDEX finding_lifecycle_events_workspace_row_unique ON finding_lifecycle_events(workspace_id,id);
CREATE UNIQUE INDEX finding_lifecycle_events_workspace_event_hash_unique ON finding_lifecycle_events(workspace_id,event_hash);
CREATE UNIQUE INDEX finding_lifecycle_events_workspace_source_occurrence_unique ON finding_lifecycle_events(workspace_id,source_occurrence_hash);
CREATE UNIQUE INDEX finding_lifecycle_events_workspace_fingerprint_sequence_unique ON finding_lifecycle_events(workspace_id,namespace,resolution_scope,fingerprint,sequence);
CREATE INDEX finding_lifecycle_events_workspace_scope_time_idx ON finding_lifecycle_events(workspace_id,namespace,resolution_scope,occurred_at DESC);
CREATE UNIQUE INDEX finding_heads_workspace_row_unique ON finding_heads(workspace_id,id);
CREATE UNIQUE INDEX finding_heads_workspace_fingerprint_unique ON finding_heads(workspace_id,namespace,resolution_scope,fingerprint);
CREATE INDEX finding_heads_workspace_scope_state_idx ON finding_heads(workspace_id,namespace,resolution_scope,state);
CREATE INDEX finding_heads_workspace_event_fk_idx ON finding_heads(workspace_id,event_hash);
CREATE UNIQUE INDEX development_log_events_workspace_row_unique ON development_log_events(workspace_id,id);
CREATE UNIQUE INDEX development_log_events_workspace_event_hash_unique ON development_log_events(workspace_id,event_hash);
CREATE UNIQUE INDEX development_log_events_workspace_source_occurrence_unique ON development_log_events(workspace_id,source_occurrence_hash);
CREATE UNIQUE INDEX development_log_events_workspace_fingerprint_sequence_unique ON development_log_events(workspace_id,namespace,resolution_scope,fingerprint,sequence);
CREATE INDEX development_log_events_workspace_scope_time_idx ON development_log_events(workspace_id,namespace,resolution_scope,occurred_at DESC);
CREATE INDEX development_log_events_workspace_finding_event_fk_idx ON development_log_events(workspace_id,finding_event_hash);
CREATE INDEX development_log_events_workspace_actor_fk_idx ON development_log_events(workspace_id,actor_user_id) WHERE actor_user_id IS NOT NULL;
CREATE UNIQUE INDEX development_log_heads_workspace_row_unique ON development_log_heads(workspace_id,id);
CREATE UNIQUE INDEX development_log_heads_workspace_fingerprint_unique ON development_log_heads(workspace_id,namespace,resolution_scope,fingerprint);
CREATE INDEX development_log_heads_workspace_scope_state_idx ON development_log_heads(workspace_id,namespace,resolution_scope,state);
CREATE INDEX development_log_heads_workspace_event_fk_idx ON development_log_heads(workspace_id,latest_event_id);
ALTER TABLE finding_heads ADD CONSTRAINT finding_heads_event_scope_fk FOREIGN KEY(workspace_id,event_hash) REFERENCES finding_lifecycle_events(workspace_id,event_hash) ON DELETE restrict;
ALTER TABLE development_log_events ADD CONSTRAINT development_log_events_finding_event_scope_fk FOREIGN KEY(workspace_id,finding_event_hash) REFERENCES finding_lifecycle_events(workspace_id,event_hash) ON DELETE restrict;
ALTER TABLE development_log_events ADD CONSTRAINT development_log_events_membership_scope_fk FOREIGN KEY(workspace_id,actor_user_id) REFERENCES memberships(workspace_id,user_id) ON DELETE restrict;
ALTER TABLE development_log_heads ADD CONSTRAINT development_log_heads_event_scope_fk FOREIGN KEY(workspace_id,latest_event_id) REFERENCES development_log_events(workspace_id,id) ON DELETE restrict;
ALTER TABLE finding_lifecycle_events ENABLE ROW LEVEL SECURITY; ALTER TABLE finding_lifecycle_events FORCE ROW LEVEL SECURITY;
ALTER TABLE finding_heads ENABLE ROW LEVEL SECURITY; ALTER TABLE finding_heads FORCE ROW LEVEL SECURITY;
ALTER TABLE development_log_events ENABLE ROW LEVEL SECURITY; ALTER TABLE development_log_events FORCE ROW LEVEL SECURITY;
ALTER TABLE development_log_heads ENABLE ROW LEVEL SECURITY; ALTER TABLE development_log_heads FORCE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE finding_lifecycle_events,finding_heads,development_log_events,development_log_heads FROM PUBLIC, anon, authenticated, service_role;
CREATE OR REPLACE FUNCTION public.finding_lifecycle_event_append_only_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$ BEGIN IF TG_OP='INSERT' THEN RETURN NEW; END IF; IF TG_OP='DELETE' AND EXISTS(SELECT 1 FROM public.workspaces WHERE id=OLD.workspace_id AND lifecycle_state='tombstoning') THEN RETURN OLD; END IF; RAISE EXCEPTION 'finding lifecycle events are append-only'; END; $$;
CREATE OR REPLACE FUNCTION public.finding_head_exact_advance_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$ DECLARE e public.finding_lifecycle_events%ROWTYPE; BEGIN IF TG_OP='DELETE' THEN IF EXISTS(SELECT 1 FROM public.workspaces WHERE id=OLD.workspace_id AND lifecycle_state='tombstoning') THEN RETURN OLD; END IF; RAISE EXCEPTION 'finding heads may only be deleted by workspace tombstone'; END IF; SELECT * INTO e FROM public.finding_lifecycle_events WHERE workspace_id=NEW.workspace_id AND event_hash=NEW.event_hash; IF NOT FOUND OR (e.namespace,e.resolution_scope,e.fingerprint,e.sequence,e.state,e.evidence_hash)<>(NEW.namespace,NEW.resolution_scope,NEW.fingerprint,NEW.sequence,NEW.state,NEW.evidence_hash) THEN RAISE EXCEPTION 'finding head must exactly reference event'; END IF; IF TG_OP='INSERT' THEN IF NEW.sequence<>1 OR e.previous_event_hash<>repeat('0',64) OR e.event_type<>'opened' OR e.state<>'open' THEN RAISE EXCEPTION 'finding head must begin opened at genesis'; END IF; ELSE IF (NEW.workspace_id,NEW.namespace,NEW.resolution_scope,NEW.fingerprint)<>(OLD.workspace_id,OLD.namespace,OLD.resolution_scope,OLD.fingerprint) OR NEW.sequence<>OLD.sequence+1 OR e.previous_event_hash<>OLD.event_hash OR NOT ((OLD.state='open' AND e.event_type='observed' AND e.state='open') OR (OLD.state='open' AND e.event_type='resolved' AND e.state='resolved') OR (OLD.state='resolved' AND e.event_type='reopened' AND e.state='open')) THEN RAISE EXCEPTION 'finding head requires exact next lifecycle transition'; END IF; END IF; RETURN NEW; END; $$;
CREATE OR REPLACE FUNCTION public.development_log_event_append_only_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$ BEGIN IF TG_OP='INSERT' THEN IF NEW.actor_kind='system' AND ((NEW.event_type='proposed' AND NEW.state='proposed' AND NEW.actor_user_id IS NULL) OR (NEW.event_type='observed' AND NEW.state IN ('proposed','triaged','tasked','deferred','rejected','closed') AND NEW.actor_user_id IS NULL) OR (NEW.event_type='reproposed' AND NEW.state='proposed' AND NEW.actor_user_id IS NULL)) THEN RETURN NEW; END IF; IF NEW.actor_kind='agent' AND NEW.event_type='proposed' AND NEW.state='proposed' AND NEW.actor_user_id IS NULL THEN RETURN NEW; END IF; IF NEW.actor_kind='tenant_member' AND NEW.event_type IN ('triaged','tasked','deferred','rejected','closed') AND NEW.state=NEW.event_type AND NEW.actor_user_id IS NOT NULL THEN RETURN NEW; END IF; RAISE EXCEPTION 'invalid development log producer transition'; END IF; IF TG_OP='DELETE' AND EXISTS(SELECT 1 FROM public.workspaces WHERE id=OLD.workspace_id AND lifecycle_state='tombstoning') THEN RETURN OLD; END IF; RAISE EXCEPTION 'development log events are append-only'; END; $$;
CREATE OR REPLACE FUNCTION public.development_log_head_exact_advance_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$ DECLARE e public.development_log_events%ROWTYPE; BEGIN IF TG_OP='DELETE' THEN IF EXISTS(SELECT 1 FROM public.workspaces WHERE id=OLD.workspace_id AND lifecycle_state='tombstoning') THEN RETURN OLD; END IF; RAISE EXCEPTION 'development log heads may only be deleted by workspace tombstone'; END IF; SELECT * INTO e FROM public.development_log_events WHERE workspace_id=NEW.workspace_id AND id=NEW.latest_event_id; IF NOT FOUND OR (e.namespace,e.resolution_scope,e.fingerprint,e.sequence,e.state,e.event_hash)<>(NEW.namespace,NEW.resolution_scope,NEW.fingerprint,NEW.sequence,NEW.state,NEW.event_hash) THEN RAISE EXCEPTION 'development log head must exactly reference event'; END IF; IF TG_OP='INSERT' THEN IF NEW.sequence<>1 OR e.previous_event_hash<>repeat('0',64) OR NEW.state<>'proposed' OR e.event_type<>'proposed' THEN RAISE EXCEPTION 'development log head must begin proposed at genesis'; END IF; ELSE IF (NEW.workspace_id,NEW.namespace,NEW.resolution_scope,NEW.fingerprint)<>(OLD.workspace_id,OLD.namespace,OLD.resolution_scope,OLD.fingerprint) OR NEW.sequence<>OLD.sequence+1 OR e.previous_event_hash<>OLD.event_hash OR NOT ((e.event_type='observed' AND NEW.state=OLD.state) OR (e.event_type='reproposed' AND OLD.state IN ('rejected','closed') AND NEW.state='proposed') OR (e.actor_kind='tenant_member' AND ((OLD.state='proposed' AND NEW.state IN ('triaged','tasked','deferred','rejected','closed')) OR (OLD.state='triaged' AND NEW.state IN ('tasked','deferred','rejected','closed')) OR (OLD.state='tasked' AND NEW.state IN ('deferred','rejected','closed')) OR (OLD.state IN ('deferred','rejected','closed') AND NEW.state='triaged')))) THEN RAISE EXCEPTION 'development log head has invalid transition'; END IF; END IF; RETURN NEW; END; $$;
CREATE TRIGGER finding_lifecycle_events_append_only BEFORE UPDATE OR DELETE ON finding_lifecycle_events FOR EACH ROW EXECUTE FUNCTION public.finding_lifecycle_event_append_only_guard();
CREATE TRIGGER finding_heads_exact_advance BEFORE INSERT OR UPDATE OR DELETE ON finding_heads FOR EACH ROW EXECUTE FUNCTION public.finding_head_exact_advance_guard();
CREATE TRIGGER development_log_events_append_only BEFORE INSERT OR UPDATE OR DELETE ON development_log_events FOR EACH ROW EXECUTE FUNCTION public.development_log_event_append_only_guard();
CREATE TRIGGER development_log_heads_exact_advance BEFORE INSERT OR UPDATE OR DELETE ON development_log_heads FOR EACH ROW EXECUTE FUNCTION public.development_log_head_exact_advance_guard();
REVOKE ALL PRIVILEGES ON FUNCTION public.finding_lifecycle_event_append_only_guard(),public.finding_head_exact_advance_guard(),public.development_log_event_append_only_guard(),public.development_log_head_exact_advance_guard() FROM PUBLIC, anon, authenticated, service_role;
