-- P06 execution-v2 durable evidence. PRE-ONLY until the outer-rollback
-- verifier and an independent critical review approve this exact file.

CREATE TABLE p06_execution_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  guide_run_action_binding_id uuid NOT NULL,
  proposal_bundle_id uuid NOT NULL,
  action_unit_id uuid NOT NULL,
  decision_event_id uuid NOT NULL,
  approval_grant_id uuid NOT NULL,
  execution_ref text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  action_unit_hash text NOT NULL,
  proposal_hash text NOT NULL,
  context_hash text NOT NULL,
  effective_guide_set_hash text NOT NULL,
  resolution_hash text NOT NULL,
  policy_hash text NOT NULL,
  gate_set_hash text NOT NULL,
  request_payload jsonb NOT NULL,
  route text NOT NULL DEFAULT 'human_approved',
  version text NOT NULL DEFAULT 'p06-execution-run/1.0.0',
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT p06_execution_runs_workspace_row_unique UNIQUE (workspace_id,id),
  CONSTRAINT p06_execution_runs_workspace_ref_unique UNIQUE (workspace_id,execution_ref),
  CONSTRAINT p06_execution_runs_workspace_binding_unique UNIQUE (workspace_id,guide_run_action_binding_id),
  CONSTRAINT p06_execution_runs_workspace_grant_unique UNIQUE (workspace_id,approval_grant_id),
  CONSTRAINT p06_execution_runs_workspace_idempotency_unique UNIQUE (workspace_id,idempotency_key),
  CONSTRAINT p06_execution_runs_binding_fk FOREIGN KEY (workspace_id,guide_run_action_binding_id)
    REFERENCES guide_run_action_bindings(workspace_id,id) ON DELETE RESTRICT,
  CONSTRAINT p06_execution_runs_bundle_fk FOREIGN KEY (workspace_id,proposal_bundle_id)
    REFERENCES action_proposal_bundles(workspace_id,id) ON DELETE RESTRICT,
  CONSTRAINT p06_execution_runs_unit_fk FOREIGN KEY (workspace_id,action_unit_id)
    REFERENCES action_proposal_units(workspace_id,id) ON DELETE RESTRICT,
  CONSTRAINT p06_execution_runs_decision_fk FOREIGN KEY (workspace_id,decision_event_id)
    REFERENCES action_approval_decision_events(workspace_id,id) ON DELETE RESTRICT,
  CONSTRAINT p06_execution_runs_grant_fk FOREIGN KEY (workspace_id,approval_grant_id)
    REFERENCES action_approval_evidence_grants(workspace_id,id) ON DELETE RESTRICT,
  CONSTRAINT p06_execution_runs_contract CHECK (
    execution_ref ~ '^p06_execution_[a-f0-9]{24}$'
    AND idempotency_key ~ '^p06_exec_idem_[a-f0-9]{64}$'
    AND request_hash ~ '^[a-f0-9]{64}$'
    AND action_unit_hash ~ '^[a-f0-9]{64}$'
    AND proposal_hash ~ '^[a-f0-9]{64}$'
    AND context_hash ~ '^[a-f0-9]{64}$'
    AND effective_guide_set_hash ~ '^[a-f0-9]{64}$'
    AND resolution_hash ~ '^[a-f0-9]{64}$'
    AND policy_hash ~ '^[a-f0-9]{64}$'
    AND gate_set_hash ~ '^[a-f0-9]{64}$'
    AND route='human_approved'
    AND version='p06-execution-run/1.0.0'
    AND jsonb_typeof(request_payload)='object'
    AND octet_length(request_payload::text)<=32768
    AND request_payload ?& ARRAY['version','workspaceRef','accountRef','entityRef','action','expectedBefore','desired','evaluatedAt','actionUnitHash','proposalHash','contextHash','effectiveGuideSetHash','resolutionHash','policyHash','gateSetHash','route','executionRef','idempotencyKey','requestHash']
    AND NOT request_payload ?| ARRAY['leaseTokenHash','fenceHash']
    AND request_payload->>'version'='p06-execution-request/1.0.0'
    AND request_payload->>'executionRef'=execution_ref
    AND request_payload->>'idempotencyKey'=idempotency_key
    AND request_payload->>'requestHash'=request_hash
    AND request_payload->>'route'=route
    AND request_payload->>'actionUnitHash'=action_unit_hash
    AND request_payload->>'proposalHash'=proposal_hash
    AND request_payload->>'contextHash'=context_hash
    AND request_payload->>'effectiveGuideSetHash'=effective_guide_set_hash
    AND request_payload->>'resolutionHash'=resolution_hash
    AND request_payload->>'policyHash'=policy_hash
    AND request_payload->>'gateSetHash'=gate_set_hash
    AND request_payload::text !~* '"(token|accessToken|secret|prompt|[^"[:space:]]*raw[_-]?(payload|request|response|json))"[[:space:]]*:'
  )
);

CREATE TABLE p06_execution_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  execution_run_id uuid NOT NULL,
  event_ref text NOT NULL,
  event_hash text NOT NULL,
  sequence integer NOT NULL,
  trace_sequence integer,
  event_kind text NOT NULL,
  step text,
  outcome text NOT NULL,
  previous_hash text NOT NULL,
  receipt_hash text NOT NULL,
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT p06_execution_events_workspace_row_unique UNIQUE (workspace_id,id),
  CONSTRAINT p06_execution_events_workspace_hash_unique UNIQUE (workspace_id,event_hash),
  CONSTRAINT p06_execution_events_run_sequence_unique UNIQUE (workspace_id,execution_run_id,sequence),
  CONSTRAINT p06_execution_events_run_fk FOREIGN KEY (workspace_id,execution_run_id)
    REFERENCES p06_execution_runs(workspace_id,id) ON DELETE CASCADE,
  CONSTRAINT p06_execution_events_contract CHECK (
    event_ref ~ '^p06_exec_event_[a-f0-9]{24}$'
    AND event_hash ~ '^[a-f0-9]{64}$'
    AND previous_hash ~ '^(GENESIS|[a-f0-9]{64})$'
    AND receipt_hash ~ '^[a-f0-9]{64}$'
    AND sequence BETWEEN 1 AND 1000000
    AND event_kind IN ('lease_claimed','lease_reclaimed','trace','lease_released')
    AND outcome IN ('ok','skipped','held','ambiguous','already_applied')
    AND ((event_kind='trace' AND trace_sequence BETWEEN 1 AND 10 AND step IN
      ('lease','idempotency','current_meta_read','expected_before','typed_mutation','raw','already_applied_no_second_write','ambiguous_read_before_retry','immutable_terminal','release'))
      OR (event_kind<>'trace' AND trace_sequence IS NULL AND step IS NULL))
    AND jsonb_typeof(payload)='object'
    AND octet_length(payload::text)<=16384
    AND payload::text !~* '"[^"[:space:]]*(token|secret|prompt|raw[_-]?(payload|request|response|json))"[[:space:]]*:'
  )
);
CREATE UNIQUE INDEX p06_execution_events_run_trace_unique ON p06_execution_events(workspace_id,execution_run_id,trace_sequence) WHERE trace_sequence IS NOT NULL;

CREATE TABLE p06_execution_heads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  execution_run_id uuid NOT NULL,
  state text NOT NULL,
  sequence integer NOT NULL DEFAULT 0,
  trace_sequence integer NOT NULL DEFAULT 0,
  head_event_hash text,
  lease_token_hash text,
  fence_hash text,
  lease_epoch integer NOT NULL DEFAULT 0,
  lease_expires_at timestamptz,
  terminal_hash text,
  updated_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT p06_execution_heads_workspace_row_unique UNIQUE (workspace_id,id),
  CONSTRAINT p06_execution_heads_workspace_run_unique UNIQUE (workspace_id,execution_run_id),
  CONSTRAINT p06_execution_heads_run_fk FOREIGN KEY (workspace_id,execution_run_id)
    REFERENCES p06_execution_runs(workspace_id,id) ON DELETE CASCADE,
  CONSTRAINT p06_execution_heads_event_fk FOREIGN KEY (workspace_id,head_event_hash)
    REFERENCES p06_execution_events(workspace_id,event_hash) ON DELETE RESTRICT,
  CONSTRAINT p06_execution_heads_contract CHECK (
    state IN ('pending','claimed','running','succeeded','verification_failed','held')
    AND sequence BETWEEN 0 AND 1000000
    AND trace_sequence BETWEEN 0 AND 10
    AND (head_event_hash IS NULL OR head_event_hash ~ '^[a-f0-9]{64}$')
    AND (terminal_hash IS NULL OR terminal_hash ~ '^[a-f0-9]{64}$')
    AND ((state='pending' AND sequence=0 AND trace_sequence=0 AND head_event_hash IS NULL
          AND lease_token_hash IS NULL AND fence_hash IS NULL AND lease_epoch=0 AND lease_expires_at IS NULL AND terminal_hash IS NULL)
      OR (state IN ('claimed','running') AND lease_token_hash ~ '^[a-f0-9]{64}$' AND fence_hash ~ '^[a-f0-9]{64}$'
          AND lease_epoch>=1 AND lease_expires_at IS NOT NULL AND terminal_hash IS NULL)
      OR (state IN ('succeeded','verification_failed','held') AND trace_sequence=10
          AND lease_token_hash IS NULL AND fence_hash IS NULL AND lease_expires_at IS NULL AND terminal_hash ~ '^[a-f0-9]{64}$'))
  )
);

CREATE TABLE p06_execution_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  execution_run_id uuid NOT NULL,
  event_id uuid NOT NULL,
  kind text NOT NULL,
  observation_ref text NOT NULL,
  observation_hash text NOT NULL,
  metadata_hash text NOT NULL,
  raw_hash text NOT NULL,
  observed_value jsonb NOT NULL,
  observed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT p06_execution_observations_workspace_row_unique UNIQUE (workspace_id,id),
  CONSTRAINT p06_execution_observations_workspace_ref_unique UNIQUE (workspace_id,observation_ref),
  CONSTRAINT p06_execution_observations_event_kind_unique UNIQUE (workspace_id,event_id,kind),
  CONSTRAINT p06_execution_observations_run_fk FOREIGN KEY (workspace_id,execution_run_id)
    REFERENCES p06_execution_runs(workspace_id,id) ON DELETE CASCADE,
  CONSTRAINT p06_execution_observations_event_fk FOREIGN KEY (workspace_id,event_id)
    REFERENCES p06_execution_events(workspace_id,id) ON DELETE CASCADE,
  CONSTRAINT p06_execution_observations_contract CHECK (
    kind IN ('read_before','write_receipt','read_after','ambiguous_retry_read')
    AND observation_ref ~ '^p06_observation_[a-f0-9]{24}$'
    AND observation_hash ~ '^[a-f0-9]{64}$'
    AND metadata_hash ~ '^[a-f0-9]{64}$'
    AND raw_hash ~ '^[a-f0-9]{64}$'
    AND jsonb_typeof(observed_value)='object'
    AND octet_length(observed_value::text)<=8192
    AND observed_value::text !~* '"[^"[:space:]]*(token|secret|prompt|raw[_-]?(payload|request|response|json))"[[:space:]]*:'
  )
);

CREATE TABLE p06_execution_gate_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  execution_run_id uuid NOT NULL,
  phase text NOT NULL,
  sequence integer NOT NULL,
  lease_epoch integer NOT NULL,
  snapshot_hash text NOT NULL,
  receipt_hash text NOT NULL,
  allowlist_hash text NOT NULL,
  enabled boolean NOT NULL,
  captured_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT p06_execution_gate_snapshots_workspace_row_unique UNIQUE (workspace_id,id),
  CONSTRAINT p06_execution_gate_snapshots_run_phase_epoch_unique UNIQUE (workspace_id,execution_run_id,phase,lease_epoch),
  CONSTRAINT p06_execution_gate_snapshots_run_fk FOREIGN KEY (workspace_id,execution_run_id)
    REFERENCES p06_execution_runs(workspace_id,id) ON DELETE CASCADE,
  CONSTRAINT p06_execution_gate_snapshots_contract CHECK (
    phase IN ('staging','admission','post_claim','pre_dispatch','read_after_write')
    AND sequence BETWEEN 1 AND 5
    AND lease_epoch BETWEEN 0 AND 1000000
    AND snapshot_hash ~ '^[a-f0-9]{64}$'
    AND receipt_hash ~ '^[a-f0-9]{64}$'
    AND allowlist_hash ~ '^[a-f0-9]{64}$'
    AND captured_at<expires_at
    AND jsonb_typeof(payload)='object'
    AND octet_length(payload::text)<=8192
    AND payload::text !~* '"(token|accessToken|secret|prompt|[^"[:space:]]*raw[_-]?(payload|request|response|json))"[[:space:]]*:'
  )
);

CREATE TABLE p06_rollback_proposals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  execution_run_id uuid NOT NULL,
  terminal_event_id uuid NOT NULL,
  before_observation_id uuid NOT NULL,
  after_observation_id uuid NOT NULL,
  write_observation_id uuid NOT NULL,
  proposal_ref text NOT NULL,
  proposal_hash text NOT NULL,
  payload jsonb NOT NULL,
  requires_new_human_approval boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT p06_rollback_proposals_workspace_row_unique UNIQUE (workspace_id,id),
  CONSTRAINT p06_rollback_proposals_run_unique UNIQUE (workspace_id,execution_run_id),
  CONSTRAINT p06_rollback_proposals_workspace_ref_unique UNIQUE (workspace_id,proposal_ref),
  CONSTRAINT p06_rollback_proposals_run_fk FOREIGN KEY (workspace_id,execution_run_id)
    REFERENCES p06_execution_runs(workspace_id,id) ON DELETE CASCADE,
  CONSTRAINT p06_rollback_proposals_terminal_fk FOREIGN KEY (workspace_id,terminal_event_id)
    REFERENCES p06_execution_events(workspace_id,id) ON DELETE RESTRICT,
  CONSTRAINT p06_rollback_proposals_before_fk FOREIGN KEY (workspace_id,before_observation_id)
    REFERENCES p06_execution_observations(workspace_id,id) ON DELETE RESTRICT,
  CONSTRAINT p06_rollback_proposals_after_fk FOREIGN KEY (workspace_id,after_observation_id)
    REFERENCES p06_execution_observations(workspace_id,id) ON DELETE RESTRICT,
  CONSTRAINT p06_rollback_proposals_write_fk FOREIGN KEY (workspace_id,write_observation_id)
    REFERENCES p06_execution_observations(workspace_id,id) ON DELETE RESTRICT,
  CONSTRAINT p06_rollback_proposals_contract CHECK (
    proposal_ref ~ '^p06_rollback_[a-f0-9]{24}$'
    AND proposal_hash ~ '^[a-f0-9]{64}$'
    AND requires_new_human_approval=true
    AND jsonb_typeof(payload)='object'
    AND octet_length(payload::text)<=16384
    AND payload->>'version'='p06-rollback-proposal/1.0.0'
    AND payload->>'proposalRef'=proposal_ref
    AND payload->>'proposalHash'=proposal_hash
    AND payload->>'requiresNewHumanApproval'='true'
    AND payload::text !~* '"(token|accessToken|secret|prompt|[^"[:space:]]*raw[_-]?(payload|request|response|json))"[[:space:]]*:'
  )
);

CREATE INDEX p06_execution_runs_binding_fk_idx ON p06_execution_runs(workspace_id,guide_run_action_binding_id);
CREATE INDEX p06_execution_runs_unit_fk_idx ON p06_execution_runs(workspace_id,action_unit_id);
CREATE INDEX p06_execution_runs_decision_fk_idx ON p06_execution_runs(workspace_id,decision_event_id);
CREATE INDEX p06_execution_runs_grant_fk_idx ON p06_execution_runs(workspace_id,approval_grant_id);
CREATE INDEX p06_execution_events_run_idx ON p06_execution_events(workspace_id,execution_run_id,sequence);
CREATE INDEX p06_execution_heads_event_fk_idx ON p06_execution_heads(workspace_id,head_event_hash);
CREATE INDEX p06_execution_heads_lease_idx ON p06_execution_heads(workspace_id,lease_expires_at);
CREATE INDEX p06_execution_observations_run_idx ON p06_execution_observations(workspace_id,execution_run_id,observed_at);
CREATE INDEX p06_execution_observations_event_fk_idx ON p06_execution_observations(workspace_id,event_id);
CREATE INDEX p06_execution_gate_snapshots_run_idx ON p06_execution_gate_snapshots(workspace_id,execution_run_id,sequence);
CREATE INDEX p06_rollback_proposals_terminal_fk_idx ON p06_rollback_proposals(workspace_id,terminal_event_id);
CREATE INDEX p06_rollback_proposals_before_fk_idx ON p06_rollback_proposals(workspace_id,before_observation_id);
CREATE INDEX p06_rollback_proposals_after_fk_idx ON p06_rollback_proposals(workspace_id,after_observation_id);
CREATE INDEX p06_rollback_proposals_write_fk_idx ON p06_rollback_proposals(workspace_id,write_observation_id);

CREATE OR REPLACE FUNCTION public.p06_execution_immutable_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$ BEGIN
  IF TG_OP='INSERT' THEN RETURN NEW; END IF;
  IF TG_OP='DELETE' AND EXISTS (SELECT 1 FROM public.workspaces WHERE id=OLD.workspace_id AND lifecycle_state='tombstoning') THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'p06 execution evidence is append-only';
END; $$;

CREATE OR REPLACE FUNCTION public.p06_execution_run_insert_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE b public.guide_run_action_bindings%ROWTYPE; u public.action_proposal_units%ROWTYPE; d public.action_approval_decision_events%ROWTYPE; g public.action_approval_evidence_grants%ROWTYPE; persisted_policy_hash text;
BEGIN
  IF jsonb_typeof(NEW.request_payload) IS DISTINCT FROM 'object'
    OR cardinality(ARRAY(SELECT jsonb_object_keys(NEW.request_payload)))<>19
    OR NOT (NEW.request_payload ?& ARRAY['version','workspaceRef','accountRef','entityRef','action','expectedBefore','desired','evaluatedAt','actionUnitHash','proposalHash','contextHash','effectiveGuideSetHash','resolutionHash','policyHash','gateSetHash','route','executionRef','idempotencyKey','requestHash'])
    OR NEW.request_payload ?| ARRAY['leaseTokenHash','fenceHash']
  THEN RAISE EXCEPTION 'p06 execution request JSON shape invalid'; END IF;
  SELECT * INTO b FROM public.guide_run_action_bindings WHERE workspace_id=NEW.workspace_id AND id=NEW.guide_run_action_binding_id FOR SHARE;
  SELECT * INTO u FROM public.action_proposal_units WHERE workspace_id=NEW.workspace_id AND id=NEW.action_unit_id FOR SHARE;
  SELECT * INTO d FROM public.action_approval_decision_events WHERE workspace_id=NEW.workspace_id AND id=NEW.decision_event_id FOR SHARE;
  SELECT * INTO g FROM public.action_approval_evidence_grants WHERE workspace_id=NEW.workspace_id AND id=NEW.approval_grant_id FOR SHARE;
  SELECT p.policy_hash INTO persisted_policy_hash FROM public.action_proposal_bundles bundle JOIN public.action_approval_policy_snapshots p ON p.workspace_id=bundle.workspace_id AND p.id=bundle.policy_snapshot_id WHERE bundle.workspace_id=NEW.workspace_id AND bundle.id=NEW.proposal_bundle_id FOR SHARE OF bundle,p;
  IF b.id IS NULL OR u.id IS NULL OR d.id IS NULL OR g.id IS NULL
    OR b.action_unit_id IS DISTINCT FROM u.id OR b.proposal_bundle_id IS DISTINCT FROM NEW.proposal_bundle_id
    OR u.bundle_id IS DISTINCT FROM NEW.proposal_bundle_id
    OR d.command_kind IS DISTINCT FROM 'approve' OR d.bundle_id IS DISTINCT FROM NEW.proposal_bundle_id OR d.unit_id IS DISTINCT FROM u.id
    OR g.bundle_id IS DISTINCT FROM NEW.proposal_bundle_id OR g.unit_id IS DISTINCT FROM u.id OR g.decision_event_id IS DISTINCT FROM d.id
    OR g.expires_at<=NEW.created_at OR g.capability IS DISTINCT FROM 'approval_evidence_only' OR g.can_execute IS DISTINCT FROM false
    OR NEW.action_unit_hash IS DISTINCT FROM u.unit_hash OR NEW.proposal_hash IS DISTINCT FROM b.proposal_hash
    OR NEW.context_hash IS DISTINCT FROM u.context_hash OR NEW.effective_guide_set_hash IS DISTINCT FROM b.effective_guide_set_hash
    OR NEW.resolution_hash IS DISTINCT FROM b.resolution_hash OR NEW.policy_hash IS DISTINCT FROM persisted_policy_hash
    OR NEW.request_hash IS DISTINCT FROM public.guide_run_sha256(NEW.request_payload-ARRAY['requestHash','executionRef','idempotencyKey'])
    OR NEW.execution_ref IS DISTINCT FROM 'p06_execution_'||substr(NEW.request_hash,1,24)
    OR NEW.idempotency_key IS DISTINCT FROM 'p06_exec_idem_'||public.guide_run_sha256(jsonb_build_object('bindingId',b.id::text,'grantHash',g.grant_hash,'requestHash',NEW.request_hash))
  THEN RAISE EXCEPTION 'p06 execution run must bind approved canonical evidence'; END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.p06_execution_event_insert_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE r public.p06_execution_runs%ROWTYPE; prior public.p06_execution_events%ROWTYPE; expected_hash text; expected_step text;
BEGIN
  SELECT * INTO r FROM public.p06_execution_runs WHERE workspace_id=NEW.workspace_id AND id=NEW.execution_run_id FOR SHARE;
  IF NEW.sequence>1 THEN SELECT * INTO prior FROM public.p06_execution_events WHERE workspace_id=NEW.workspace_id AND execution_run_id=NEW.execution_run_id AND sequence=NEW.sequence-1 FOR SHARE; END IF;
  IF jsonb_typeof(NEW.payload) IS DISTINCT FROM 'object' OR cardinality(ARRAY(SELECT jsonb_object_keys(NEW.payload)))<>13
    OR NOT (NEW.payload ?& ARRAY['version','eventRef','eventHash','executionRef','sequence','traceSequence','eventKind','step','outcome','previousHash','receiptCore','receiptHash','occurredAt'])
    OR jsonb_typeof(NEW.payload->'version') IS DISTINCT FROM 'string' OR jsonb_typeof(NEW.payload->'eventRef') IS DISTINCT FROM 'string'
    OR jsonb_typeof(NEW.payload->'eventHash') IS DISTINCT FROM 'string' OR jsonb_typeof(NEW.payload->'executionRef') IS DISTINCT FROM 'string'
    OR jsonb_typeof(NEW.payload->'sequence') IS DISTINCT FROM 'number' OR jsonb_typeof(NEW.payload->'traceSequence') NOT IN ('null','number')
    OR jsonb_typeof(NEW.payload->'eventKind') IS DISTINCT FROM 'string' OR jsonb_typeof(NEW.payload->'step') NOT IN ('null','string')
    OR jsonb_typeof(NEW.payload->'outcome') IS DISTINCT FROM 'string' OR jsonb_typeof(NEW.payload->'previousHash') IS DISTINCT FROM 'string'
    OR jsonb_typeof(NEW.payload->'receiptCore') IS DISTINCT FROM 'object' OR jsonb_typeof(NEW.payload->'receiptHash') IS DISTINCT FROM 'string' OR jsonb_typeof(NEW.payload->'occurredAt') IS DISTINCT FROM 'string'
  THEN RAISE EXCEPTION 'p06 execution event JSON shape invalid'; END IF;
  expected_hash:=public.guide_run_sha256(NEW.payload-ARRAY['eventRef','eventHash']);
  IF NEW.event_kind='trace' THEN expected_step:=(ARRAY['lease','idempotency','current_meta_read','expected_before','typed_mutation','raw','already_applied_no_second_write','ambiguous_read_before_retry','immutable_terminal','release'])[NEW.trace_sequence]; END IF;
  IF r.id IS NULL OR (NEW.sequence=1 AND NEW.previous_hash IS DISTINCT FROM 'GENESIS')
    OR (NEW.sequence>1 AND (prior.id IS NULL OR NEW.previous_hash IS DISTINCT FROM prior.event_hash))
    OR NEW.event_hash IS DISTINCT FROM expected_hash OR NEW.event_ref IS DISTINCT FROM 'p06_exec_event_'||substr(expected_hash,1,24)
    OR NEW.payload->>'version' IS DISTINCT FROM 'p06-execution-event/1.0.0'
    OR NEW.payload->>'executionRef' IS DISTINCT FROM r.execution_ref
    OR (NEW.payload->>'sequence')::integer IS DISTINCT FROM NEW.sequence
    OR NEW.payload->>'previousHash' IS DISTINCT FROM NEW.previous_hash
    OR NEW.payload->>'eventKind' IS DISTINCT FROM NEW.event_kind
    OR NEW.payload->>'outcome' IS DISTINCT FROM NEW.outcome
    OR NEW.payload->>'receiptHash' IS DISTINCT FROM NEW.receipt_hash OR NEW.receipt_hash IS DISTINCT FROM public.guide_run_sha256(NEW.payload->'receiptCore')
    OR NEW.payload->>'occurredAt' IS DISTINCT FROM to_char(NEW.occurred_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    OR NEW.payload->>'eventHash' IS DISTINCT FROM NEW.event_hash OR NEW.payload->>'eventRef' IS DISTINCT FROM NEW.event_ref
    OR (NEW.event_kind='trace' AND (NEW.step IS DISTINCT FROM expected_step OR NEW.payload->>'step' IS DISTINCT FROM NEW.step OR (NEW.payload->>'traceSequence')::integer IS DISTINCT FROM NEW.trace_sequence))
  THEN RAISE EXCEPTION 'p06 execution event must bind canonical chain'; END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.p06_execution_head_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE e public.p06_execution_events%ROWTYPE; terminal_event public.p06_execution_events%ROWTYPE; r public.p06_execution_runs%ROWTYPE;
BEGIN
  IF TG_OP='DELETE' THEN IF EXISTS(SELECT 1 FROM public.workspaces WHERE id=OLD.workspace_id AND lifecycle_state='tombstoning') THEN RETURN OLD; END IF; RAISE EXCEPTION 'p06 execution head cannot be deleted'; END IF;
  IF TG_OP='INSERT' THEN
    IF NEW.state<>'pending' OR NEW.sequence<>0 OR NEW.trace_sequence<>0 OR NEW.head_event_hash IS NOT NULL THEN RAISE EXCEPTION 'p06 execution head must start pending'; END IF;
    RETURN NEW;
  END IF;
  SELECT * INTO e FROM public.p06_execution_events WHERE workspace_id=NEW.workspace_id AND execution_run_id=NEW.execution_run_id AND event_hash=NEW.head_event_hash;
  SELECT * INTO r FROM public.p06_execution_runs WHERE workspace_id=NEW.workspace_id AND id=NEW.execution_run_id;
  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.execution_run_id IS DISTINCT FROM OLD.execution_run_id
    OR NEW.sequence<>OLD.sequence+1 OR e.id IS NULL OR e.sequence IS DISTINCT FROM NEW.sequence OR e.previous_hash IS DISTINCT FROM coalesce(OLD.head_event_hash,'GENESIS')
    OR NEW.trace_sequence IS DISTINCT FROM (CASE WHEN e.event_kind='trace' THEN OLD.trace_sequence+1 ELSE OLD.trace_sequence END)
    OR (e.event_kind='trace' AND e.trace_sequence IS DISTINCT FROM NEW.trace_sequence)
  THEN RAISE EXCEPTION 'p06 execution head requires exact next event CAS'; END IF;
  IF e.event_kind='lease_claimed' AND (OLD.state<>'pending' OR NEW.state<>'claimed' OR NEW.lease_epoch<>1 OR NEW.lease_token_hash IS NULL OR NEW.fence_hash IS NULL OR NEW.lease_expires_at<=NEW.updated_at) THEN RAISE EXCEPTION 'p06 execution initial lease invalid'; END IF;
  IF e.event_kind='lease_reclaimed' AND (OLD.state NOT IN ('claimed','running') OR OLD.lease_expires_at>NEW.updated_at OR NEW.state<>'claimed' OR NEW.lease_epoch<>OLD.lease_epoch+1 OR NEW.lease_token_hash IS NULL OR NEW.fence_hash IS NULL OR NEW.lease_expires_at<=NEW.updated_at OR (NEW.lease_token_hash=OLD.lease_token_hash AND NEW.fence_hash=OLD.fence_hash)) THEN RAISE EXCEPTION 'p06 execution reclaim invalid'; END IF;
  IF e.event_kind IN ('lease_claimed','lease_reclaimed') AND (e.payload->'receiptCore' IS DISTINCT FROM jsonb_build_object('executionRef',r.execution_ref,'leaseTokenHash',NEW.lease_token_hash,'fenceHash',NEW.fence_hash,'owned',true)) THEN RAISE EXCEPTION 'p06 execution lease receipt invalid'; END IF;
  IF e.event_kind='trace' AND NEW.trace_sequence<10 AND (NEW.state NOT IN ('claimed','running') OR OLD.lease_expires_at<=NEW.updated_at OR NEW.lease_token_hash IS DISTINCT FROM OLD.lease_token_hash OR NEW.fence_hash IS DISTINCT FROM OLD.fence_hash OR NEW.lease_epoch IS DISTINCT FROM OLD.lease_epoch OR NEW.lease_expires_at IS DISTINCT FROM OLD.lease_expires_at) THEN RAISE EXCEPTION 'p06 execution fence drift'; END IF;
  IF e.event_kind='trace' AND NEW.trace_sequence=10 THEN
    SELECT * INTO terminal_event FROM public.p06_execution_events WHERE workspace_id=NEW.workspace_id AND execution_run_id=NEW.execution_run_id AND trace_sequence=9;
    IF e.step<>'release' OR NEW.state NOT IN ('succeeded','verification_failed','held') OR NEW.lease_token_hash IS NOT NULL OR NEW.fence_hash IS NOT NULL OR NEW.lease_expires_at IS NOT NULL OR NEW.terminal_hash IS NULL
      OR (SELECT count(*) FROM public.p06_execution_gate_snapshots WHERE workspace_id=NEW.workspace_id AND execution_run_id=NEW.execution_run_id AND lease_epoch=0 AND phase IN ('staging','admission'))<>2
      OR (SELECT count(*) FROM public.p06_execution_gate_snapshots WHERE workspace_id=NEW.workspace_id AND execution_run_id=NEW.execution_run_id AND lease_epoch=NEW.lease_epoch AND phase IN ('post_claim','pre_dispatch','read_after_write'))<>3
      OR terminal_event.step IS DISTINCT FROM 'immutable_terminal' OR NEW.terminal_hash IS DISTINCT FROM terminal_event.receipt_hash
      OR (terminal_event.payload->'receiptCore'->>'executionRef') IS DISTINCT FROM r.execution_ref
      OR (NEW.state='succeeded' AND terminal_event.payload->'receiptCore'->>'outcome' NOT IN ('already_applied_no_write','written_verified','ambiguous_resolved'))
      OR (NEW.state='verification_failed' AND terminal_event.payload->'receiptCore'->>'outcome' IS DISTINCT FROM 'verification_failed')
      OR (NEW.state='held' AND terminal_event.payload->'receiptCore'->>'outcome' IS DISTINCT FROM 'expected_before_mismatch')
    THEN RAISE EXCEPTION 'p06 execution trace release invalid'; END IF;
  END IF;
  IF e.event_kind='lease_released' AND (OLD.trace_sequence<>10 OR NEW.state NOT IN ('succeeded','verification_failed','held') OR NEW.lease_token_hash IS NOT NULL OR NEW.fence_hash IS NOT NULL OR NEW.lease_expires_at IS NOT NULL OR NEW.terminal_hash IS NULL) THEN RAISE EXCEPTION 'p06 execution release invalid'; END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.p06_execution_gate_insert_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE r public.p06_execution_runs%ROWTYPE; h public.p06_execution_heads%ROWTYPE; prior public.p06_execution_gate_snapshots%ROWTYPE; expected_snapshot text; expected_receipt text; expected_sequence integer;
BEGIN
  SELECT * INTO r FROM public.p06_execution_runs WHERE workspace_id=NEW.workspace_id AND id=NEW.execution_run_id FOR SHARE;
  SELECT * INTO h FROM public.p06_execution_heads WHERE workspace_id=NEW.workspace_id AND execution_run_id=NEW.execution_run_id FOR SHARE;
  expected_sequence:=array_position(ARRAY['staging','admission','post_claim','pre_dispatch','read_after_write'],NEW.phase);
  IF expected_sequence=2 THEN SELECT * INTO prior FROM public.p06_execution_gate_snapshots WHERE workspace_id=NEW.workspace_id AND execution_run_id=NEW.execution_run_id AND sequence=1 AND lease_epoch=0 FOR SHARE;
  ELSIF expected_sequence=3 THEN SELECT * INTO prior FROM public.p06_execution_gate_snapshots WHERE workspace_id=NEW.workspace_id AND execution_run_id=NEW.execution_run_id AND sequence=2 AND lease_epoch=0 FOR SHARE;
  ELSIF expected_sequence>3 THEN SELECT * INTO prior FROM public.p06_execution_gate_snapshots WHERE workspace_id=NEW.workspace_id AND execution_run_id=NEW.execution_run_id AND sequence=expected_sequence-1 AND lease_epoch=NEW.lease_epoch FOR SHARE; END IF;
  expected_snapshot:=public.guide_run_sha256(NEW.payload-ARRAY['snapshotHash','receiptHash']);
  expected_receipt:=public.guide_run_sha256(jsonb_build_object('executionRef',r.execution_ref,'phase',NEW.phase,'sequence',NEW.sequence,'leaseEpoch',NEW.lease_epoch,'snapshotHash',expected_snapshot));
  IF r.id IS NULL OR h.id IS NULL OR cardinality(ARRAY(SELECT jsonb_object_keys(NEW.payload)))<>10
    OR NOT (NEW.payload ?& ARRAY['version','phase','sequence','leaseEpoch','enabled','allowlistHash','capturedAt','expiresAt','snapshotHash','receiptHash'])
    OR NEW.sequence IS DISTINCT FROM expected_sequence OR NEW.snapshot_hash IS DISTINCT FROM expected_snapshot OR NEW.receipt_hash IS DISTINCT FROM expected_receipt
    OR (expected_sequence>1 AND (prior.id IS NULL OR NEW.captured_at<=prior.captured_at))
    OR (expected_sequence<=2 AND NEW.lease_epoch<>0)
    OR (expected_sequence>=3 AND (NEW.lease_epoch IS DISTINCT FROM h.lease_epoch OR h.state NOT IN ('claimed','running') OR h.lease_expires_at<=NEW.captured_at))
    OR NEW.payload->>'version' IS DISTINCT FROM 'p06-execution-gate/1.0.0' OR NEW.payload->>'phase' IS DISTINCT FROM NEW.phase
    OR (NEW.payload->>'sequence')::integer IS DISTINCT FROM NEW.sequence OR (NEW.payload->>'enabled')::boolean IS DISTINCT FROM NEW.enabled
    OR (NEW.payload->>'leaseEpoch')::integer IS DISTINCT FROM NEW.lease_epoch
    OR NEW.payload->>'allowlistHash' IS DISTINCT FROM NEW.allowlist_hash OR NEW.payload->>'capturedAt' IS DISTINCT FROM to_char(NEW.captured_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    OR NEW.payload->>'expiresAt' IS DISTINCT FROM to_char(NEW.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    OR NEW.payload->>'snapshotHash' IS DISTINCT FROM NEW.snapshot_hash OR NEW.payload->>'receiptHash' IS DISTINCT FROM NEW.receipt_hash
  THEN RAISE EXCEPTION 'p06 execution gate must bind canonical snapshot'; END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.p06_execution_observation_insert_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE r public.p06_execution_runs%ROWTYPE; e public.p06_execution_events%ROWTYPE; expected_hash text;
BEGIN
  SELECT * INTO r FROM public.p06_execution_runs WHERE workspace_id=NEW.workspace_id AND id=NEW.execution_run_id FOR SHARE;
  SELECT * INTO e FROM public.p06_execution_events WHERE workspace_id=NEW.workspace_id AND id=NEW.event_id AND execution_run_id=NEW.execution_run_id FOR SHARE;
  expected_hash:=public.guide_run_sha256(jsonb_build_object('version','p06-execution-observation/1.0.0','executionRef',r.execution_ref,'kind',NEW.kind,'metadataHash',NEW.metadata_hash,'rawHash',NEW.raw_hash,'observedValue',NEW.observed_value,'observedAt',to_char(NEW.observed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
  IF r.id IS NULL OR e.id IS NULL OR NEW.observation_hash IS DISTINCT FROM expected_hash OR NEW.observation_ref IS DISTINCT FROM 'p06_observation_'||substr(expected_hash,1,24)
    OR (NEW.kind='read_before' AND e.step IS DISTINCT FROM 'current_meta_read')
    OR (NEW.kind='write_receipt' AND e.step IS DISTINCT FROM 'typed_mutation')
    OR (NEW.kind='read_after' AND e.step IS DISTINCT FROM 'raw')
    OR (NEW.kind='ambiguous_retry_read' AND e.step IS DISTINCT FROM 'ambiguous_read_before_retry')
  THEN RAISE EXCEPTION 'p06 execution observation must bind canonical event'; END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.p06_rollback_proposal_insert_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE r public.p06_execution_runs%ROWTYPE; h public.p06_execution_heads%ROWTYPE; terminal public.p06_execution_events%ROWTYPE; before_row public.p06_execution_observations%ROWTYPE; after_row public.p06_execution_observations%ROWTYPE; write_row public.p06_execution_observations%ROWTYPE; expected_hash text;
BEGIN
  SELECT * INTO r FROM public.p06_execution_runs WHERE workspace_id=NEW.workspace_id AND id=NEW.execution_run_id FOR SHARE;
  SELECT * INTO h FROM public.p06_execution_heads WHERE workspace_id=NEW.workspace_id AND execution_run_id=NEW.execution_run_id FOR SHARE;
  SELECT * INTO terminal FROM public.p06_execution_events WHERE workspace_id=NEW.workspace_id AND id=NEW.terminal_event_id AND execution_run_id=NEW.execution_run_id FOR SHARE;
  SELECT * INTO before_row FROM public.p06_execution_observations WHERE workspace_id=NEW.workspace_id AND id=NEW.before_observation_id AND execution_run_id=NEW.execution_run_id FOR SHARE;
  SELECT * INTO after_row FROM public.p06_execution_observations WHERE workspace_id=NEW.workspace_id AND id=NEW.after_observation_id AND execution_run_id=NEW.execution_run_id FOR SHARE;
  SELECT * INTO write_row FROM public.p06_execution_observations WHERE workspace_id=NEW.workspace_id AND id=NEW.write_observation_id AND execution_run_id=NEW.execution_run_id FOR SHARE;
  expected_hash:=public.guide_run_sha256(NEW.payload-ARRAY['proposalRef','proposalHash']);
  IF r.id IS NULL OR cardinality(ARRAY(SELECT jsonb_object_keys(NEW.payload)))<>13
    OR NOT (NEW.payload ?& ARRAY['version','proposalHash','executionRef','terminalHash','writeReceiptHash','beforeReadReceiptHash','afterReadReceiptHash','previousObserved','postWriteObserved','restoreTo','failedDesired','requiresNewHumanApproval','proposalRef'])
    OR h.state IS DISTINCT FROM 'verification_failed' OR terminal.step IS DISTINCT FROM 'immutable_terminal'
    OR before_row.kind IS DISTINCT FROM 'read_before' OR after_row.kind IS DISTINCT FROM 'read_after' OR write_row.kind IS DISTINCT FROM 'write_receipt'
    OR NEW.proposal_hash IS DISTINCT FROM expected_hash OR NEW.proposal_ref IS DISTINCT FROM 'p06_rollback_'||substr(expected_hash,1,24)
    OR NEW.payload->>'executionRef' IS DISTINCT FROM r.execution_ref OR NEW.payload->>'terminalHash' IS DISTINCT FROM terminal.receipt_hash
    OR NEW.payload->>'beforeReadReceiptHash' IS DISTINCT FROM before_row.metadata_hash OR NEW.payload->>'afterReadReceiptHash' IS DISTINCT FROM after_row.metadata_hash
    OR NEW.payload->>'writeReceiptHash' IS DISTINCT FROM write_row.metadata_hash
    OR NEW.payload->'previousObserved' IS DISTINCT FROM before_row.observed_value OR NEW.payload->'restoreTo' IS DISTINCT FROM before_row.observed_value
    OR NEW.payload->'postWriteObserved' IS DISTINCT FROM after_row.observed_value
  THEN RAISE EXCEPTION 'p06 rollback must bind failed execution observations'; END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER p06_execution_runs_exact_insert BEFORE INSERT ON p06_execution_runs FOR EACH ROW EXECUTE FUNCTION public.p06_execution_run_insert_guard();
CREATE TRIGGER p06_execution_runs_append_only BEFORE UPDATE OR DELETE ON p06_execution_runs FOR EACH ROW EXECUTE FUNCTION public.p06_execution_immutable_guard();
CREATE TRIGGER p06_execution_events_exact_insert BEFORE INSERT ON p06_execution_events FOR EACH ROW EXECUTE FUNCTION public.p06_execution_event_insert_guard();
CREATE TRIGGER p06_execution_events_append_only BEFORE UPDATE OR DELETE ON p06_execution_events FOR EACH ROW EXECUTE FUNCTION public.p06_execution_immutable_guard();
CREATE TRIGGER p06_execution_heads_exact_advance BEFORE INSERT OR UPDATE OR DELETE ON p06_execution_heads FOR EACH ROW EXECUTE FUNCTION public.p06_execution_head_guard();
CREATE TRIGGER p06_execution_observations_exact_insert BEFORE INSERT ON p06_execution_observations FOR EACH ROW EXECUTE FUNCTION public.p06_execution_observation_insert_guard();
CREATE TRIGGER p06_execution_observations_append_only BEFORE UPDATE OR DELETE ON p06_execution_observations FOR EACH ROW EXECUTE FUNCTION public.p06_execution_immutable_guard();
CREATE TRIGGER p06_execution_gate_snapshots_exact_insert BEFORE INSERT ON p06_execution_gate_snapshots FOR EACH ROW EXECUTE FUNCTION public.p06_execution_gate_insert_guard();
CREATE TRIGGER p06_execution_gate_snapshots_append_only BEFORE UPDATE OR DELETE ON p06_execution_gate_snapshots FOR EACH ROW EXECUTE FUNCTION public.p06_execution_immutable_guard();
CREATE TRIGGER p06_rollback_proposals_exact_insert BEFORE INSERT ON p06_rollback_proposals FOR EACH ROW EXECUTE FUNCTION public.p06_rollback_proposal_insert_guard();
CREATE TRIGGER p06_rollback_proposals_append_only BEFORE UPDATE OR DELETE ON p06_rollback_proposals FOR EACH ROW EXECUTE FUNCTION public.p06_execution_immutable_guard();

ALTER TABLE p06_execution_runs ENABLE ROW LEVEL SECURITY; ALTER TABLE p06_execution_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE p06_execution_events ENABLE ROW LEVEL SECURITY; ALTER TABLE p06_execution_events FORCE ROW LEVEL SECURITY;
ALTER TABLE p06_execution_heads ENABLE ROW LEVEL SECURITY; ALTER TABLE p06_execution_heads FORCE ROW LEVEL SECURITY;
ALTER TABLE p06_execution_observations ENABLE ROW LEVEL SECURITY; ALTER TABLE p06_execution_observations FORCE ROW LEVEL SECURITY;
ALTER TABLE p06_execution_gate_snapshots ENABLE ROW LEVEL SECURITY; ALTER TABLE p06_execution_gate_snapshots FORCE ROW LEVEL SECURITY;
ALTER TABLE p06_rollback_proposals ENABLE ROW LEVEL SECURITY; ALTER TABLE p06_rollback_proposals FORCE ROW LEVEL SECURITY;

REVOKE ALL PRIVILEGES ON TABLE p06_execution_runs,p06_execution_events,p06_execution_heads,p06_execution_observations,p06_execution_gate_snapshots,p06_rollback_proposals FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL PRIVILEGES ON FUNCTION public.p06_execution_immutable_guard(),public.p06_execution_run_insert_guard(),public.p06_execution_event_insert_guard(),public.p06_execution_head_guard(),public.p06_execution_gate_insert_guard(),public.p06_execution_observation_insert_guard(),public.p06_rollback_proposal_insert_guard() FROM PUBLIC,anon,authenticated,service_role;
