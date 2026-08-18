-- PRE-ONLY. Extends the already-applied P06 execution ledger with an exact
-- P04 Guide-budget admission source. Historical disabled-admission rows stay
-- immutable and non-executable; this table only binds their evidence into the
-- newer fenced execution-v2 ledger.

ALTER TABLE public.p06_execution_runs
  ALTER COLUMN guide_run_action_binding_id DROP NOT NULL,
  ALTER COLUMN effective_guide_set_hash DROP NOT NULL,
  ALTER COLUMN resolution_hash DROP NOT NULL,
  ADD COLUMN action_execution_attempt_id uuid,
  ADD COLUMN admission_hash text,
  ADD COLUMN write_spec_hash text,
  ADD COLUMN dry_run_hash text,
  ADD COLUMN action_plan_hash text,
  ADD COLUMN budget_kind text,
  ADD COLUMN currency text;

ALTER TABLE public.p06_execution_runs
  ADD CONSTRAINT p06_execution_runs_attempt_fk
    FOREIGN KEY (workspace_id,action_execution_attempt_id)
    REFERENCES public.action_execution_attempts(workspace_id,id) ON DELETE RESTRICT,
  ADD CONSTRAINT p06_execution_runs_workspace_attempt_unique
    UNIQUE (workspace_id,action_execution_attempt_id);

CREATE INDEX p06_execution_runs_attempt_fk_idx
  ON public.p06_execution_runs(workspace_id,action_execution_attempt_id);

CREATE OR REPLACE FUNCTION public.p06_jsonb_object_key_count(value jsonb) RETURNS integer
LANGUAGE sql IMMUTABLE STRICT SECURITY INVOKER SET search_path=''
AS $$ SELECT count(*)::integer FROM jsonb_object_keys(value) $$;
REVOKE ALL ON FUNCTION public.p06_jsonb_object_key_count(jsonb) FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE public.p06_execution_runs DROP CONSTRAINT p06_execution_runs_contract;
ALTER TABLE public.p06_execution_runs ADD CONSTRAINT p06_execution_runs_contract CHECK (
  execution_ref ~ '^p06_execution_[a-f0-9]{24}$'
  AND idempotency_key ~ '^p06_exec_idem_[a-f0-9]{64}$'
  AND request_hash ~ '^[a-f0-9]{64}$'
  AND action_unit_hash ~ '^[a-f0-9]{64}$'
  AND proposal_hash ~ '^[a-f0-9]{64}$'
  AND context_hash ~ '^[a-f0-9]{64}$'
  AND policy_hash ~ '^[a-f0-9]{64}$'
  AND gate_set_hash ~ '^[a-f0-9]{64}$'
  AND version='p06-execution-run/1.0.0'
  AND jsonb_typeof(request_payload)='object'
  AND octet_length(request_payload::text)<=32768
  AND NOT request_payload ?| ARRAY['leaseTokenHash','fenceHash']
  AND request_payload->>'version'='p06-execution-request/1.0.0'
  AND request_payload->>'executionRef'=execution_ref
  AND request_payload->>'idempotencyKey'=idempotency_key
  AND request_payload->>'requestHash'=request_hash
  AND request_payload->>'route'=route
  AND request_payload->>'actionUnitHash'=action_unit_hash
  AND request_payload->>'proposalHash'=proposal_hash
  AND request_payload->>'contextHash'=context_hash
  AND request_payload->>'policyHash'=policy_hash
  AND request_payload->>'gateSetHash'=gate_set_hash
  AND request_payload::text !~* '"(token|accessToken|secret|prompt|[^"[:space:]]*raw[_-]?(payload|request|response|json))"[[:space:]]*:'
  AND (
    (route='human_approved'
      AND guide_run_action_binding_id IS NOT NULL
      AND action_execution_attempt_id IS NULL
      AND admission_hash IS NULL AND write_spec_hash IS NULL AND dry_run_hash IS NULL
      AND action_plan_hash IS NULL AND budget_kind IS NULL AND currency IS NULL
      AND effective_guide_set_hash ~ '^[a-f0-9]{64}$'
      AND resolution_hash ~ '^[a-f0-9]{64}$'
      AND public.p06_jsonb_object_key_count(request_payload)=19
      AND request_payload ?& ARRAY['version','workspaceRef','accountRef','entityRef','action','expectedBefore','desired','evaluatedAt','actionUnitHash','proposalHash','contextHash','effectiveGuideSetHash','resolutionHash','policyHash','gateSetHash','route','executionRef','idempotencyKey','requestHash']
      AND request_payload->>'effectiveGuideSetHash'=effective_guide_set_hash
      AND request_payload->>'resolutionHash'=resolution_hash)
    OR
    (route='guide_budget_human_approved'
      AND guide_run_action_binding_id IS NULL
      AND action_execution_attempt_id IS NOT NULL
      AND effective_guide_set_hash IS NULL AND resolution_hash IS NULL
      AND admission_hash ~ '^[a-f0-9]{64}$' AND write_spec_hash ~ '^[a-f0-9]{64}$'
      AND dry_run_hash ~ '^[a-f0-9]{64}$' AND action_plan_hash ~ '^[a-f0-9]{64}$'
      AND budget_kind IN ('daily','lifetime') AND currency ~ '^[A-Z]{3}$'
      AND public.p06_jsonb_object_key_count(request_payload)=25
      AND request_payload ?& ARRAY['version','workspaceRef','accountRef','entityRef','action','budgetKind','currency','expectedBefore','desired','evaluatedAt','actionUnitHash','proposalHash','contextHash','effectiveGuideSetHash','resolutionHash','policyHash','gateSetHash','admissionHash','writeSpecHash','dryRunHash','actionPlanHash','route','executionRef','idempotencyKey','requestHash']
      AND request_payload->>'budgetKind'=budget_kind
      AND request_payload->>'currency'=currency
      AND request_payload->>'admissionHash'=admission_hash
      AND request_payload->>'writeSpecHash'=write_spec_hash
      AND request_payload->>'dryRunHash'=dry_run_hash
      AND request_payload->>'actionPlanHash'=action_plan_hash
      AND request_payload->'effectiveGuideSetHash'='null'::jsonb
      AND request_payload->'resolutionHash'='null'::jsonb)
  )
);

CREATE OR REPLACE FUNCTION public.p06_execution_run_insert_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  b public.guide_run_action_bindings%ROWTYPE;
  a public.action_execution_attempts%ROWTYPE;
  u public.action_proposal_units%ROWTYPE;
  d public.action_approval_decision_events%ROWTYPE;
  g public.action_approval_evidence_grants%ROWTYPE;
  bundle public.action_proposal_bundles%ROWTYPE;
  persisted_policy_hash text;
  before_minor bigint;
  after_minor bigint;
  before_decimal text;
  after_decimal text;
  mirror_status text;
BEGIN
  SELECT * INTO u FROM public.action_proposal_units
    WHERE workspace_id=NEW.workspace_id AND id=NEW.action_unit_id FOR SHARE;
  SELECT * INTO d FROM public.action_approval_decision_events
    WHERE workspace_id=NEW.workspace_id AND id=NEW.decision_event_id FOR SHARE;
  SELECT * INTO g FROM public.action_approval_evidence_grants
    WHERE workspace_id=NEW.workspace_id AND id=NEW.approval_grant_id FOR SHARE;
  SELECT * INTO bundle FROM public.action_proposal_bundles
    WHERE workspace_id=NEW.workspace_id AND id=NEW.proposal_bundle_id FOR SHARE;
  SELECT p.policy_hash INTO persisted_policy_hash
    FROM public.action_approval_policy_snapshots p
    WHERE p.workspace_id=NEW.workspace_id AND p.id=bundle.policy_snapshot_id FOR SHARE;
  IF u.id IS NULL OR d.id IS NULL OR g.id IS NULL OR bundle.id IS NULL
    OR u.bundle_id IS DISTINCT FROM bundle.id
    OR d.command_kind IS DISTINCT FROM 'approve' OR d.bundle_id IS DISTINCT FROM bundle.id OR d.unit_id IS DISTINCT FROM u.id
    OR g.bundle_id IS DISTINCT FROM bundle.id OR g.unit_id IS DISTINCT FROM u.id OR g.decision_event_id IS DISTINCT FROM d.id
    OR g.expires_at<=statement_timestamp() OR g.capability IS DISTINCT FROM 'approval_evidence_only' OR g.can_execute IS DISTINCT FROM false
    OR NEW.action_unit_hash IS DISTINCT FROM u.unit_hash OR NEW.context_hash IS DISTINCT FROM u.context_hash
    OR NEW.policy_hash IS DISTINCT FROM persisted_policy_hash
    OR NEW.request_payload->>'workspaceRef' IS DISTINCT FROM bundle.workspace_ref
    OR NEW.request_payload->>'accountRef' IS DISTINCT FROM u.account_ref
    OR NEW.request_payload->>'entityRef' IS DISTINCT FROM u.entity_ref
    OR NEW.request_payload->>'action' IS DISTINCT FROM u.action_type
    OR jsonb_typeof(NEW.request_payload->'evaluatedAt') IS DISTINCT FROM 'string'
    OR NEW.request_payload->>'evaluatedAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
    OR (NEW.request_payload->>'evaluatedAt')::timestamptz IS DISTINCT FROM NEW.created_at
    OR NEW.request_hash IS DISTINCT FROM public.guide_run_sha256(NEW.request_payload-ARRAY['requestHash','executionRef','idempotencyKey'])
    OR NEW.execution_ref IS DISTINCT FROM 'p06_execution_'||substr(NEW.request_hash,1,24)
  THEN RAISE EXCEPTION 'p06 execution run must bind approved canonical evidence'; END IF;

  IF NEW.route='human_approved' THEN
    IF cardinality(ARRAY(SELECT jsonb_object_keys(NEW.request_payload)))<>19 THEN
      RAISE EXCEPTION 'p06 status execution request JSON shape invalid';
    END IF;
    SELECT * INTO b FROM public.guide_run_action_bindings
      WHERE workspace_id=NEW.workspace_id AND id=NEW.guide_run_action_binding_id FOR SHARE;
    IF b.id IS NULL OR b.action_unit_id IS DISTINCT FROM u.id OR b.proposal_bundle_id IS DISTINCT FROM bundle.id
      OR NEW.proposal_hash IS DISTINCT FROM b.proposal_hash
      OR NEW.effective_guide_set_hash IS DISTINCT FROM b.effective_guide_set_hash
      OR NEW.resolution_hash IS DISTINCT FROM b.resolution_hash
      OR u.action_type NOT IN ('status_pause','status_activate')
      OR u.action_plan_payload#>>'{action,kind}' IS DISTINCT FROM 'status_change'
      OR (u.action_type='status_pause' AND (NEW.request_payload#>>'{expectedBefore,status}' IS DISTINCT FROM 'ACTIVE'
        OR NEW.request_payload#>>'{desired,status}' IS DISTINCT FROM 'PAUSED'))
      OR (u.action_type='status_activate' AND (NEW.request_payload#>>'{expectedBefore,status}' IS DISTINCT FROM 'PAUSED'
        OR NEW.request_payload#>>'{desired,status}' IS DISTINCT FROM 'ACTIVE'))
      OR NEW.request_payload#>'{expectedBefore,budgetMinor}' IS DISTINCT FROM 'null'::jsonb
      OR NEW.request_payload#>'{desired,budgetMinor}' IS DISTINCT FROM 'null'::jsonb
      OR NEW.idempotency_key IS DISTINCT FROM 'p06_exec_idem_'||public.guide_run_sha256(jsonb_build_object('bindingId',b.id::text,'grantHash',g.grant_hash,'requestHash',NEW.request_hash))
    THEN RAISE EXCEPTION 'p06 status execution source invalid'; END IF;
  ELSIF NEW.route='guide_budget_human_approved' THEN
    IF cardinality(ARRAY(SELECT jsonb_object_keys(NEW.request_payload)))<>25 THEN
      RAISE EXCEPTION 'p06 budget execution request JSON shape invalid';
    END IF;
    SELECT * INTO a FROM public.action_execution_attempts
      WHERE workspace_id=NEW.workspace_id AND id=NEW.action_execution_attempt_id FOR SHARE;
    IF a.id IS NULL OR a.bundle_id IS DISTINCT FROM bundle.id OR a.unit_id IS DISTINCT FROM u.id
      OR a.decision_event_id IS DISTINCT FROM d.id OR a.approval_grant_id IS DISTINCT FROM g.id
      OR a.admission_hash IS DISTINCT FROM NEW.admission_hash OR a.write_spec_hash IS DISTINCT FROM NEW.write_spec_hash
      OR a.admission_payload->>'admissionHash' IS DISTINCT FROM NEW.admission_hash
      OR a.admission_payload#>>'{writeSpec,specHash}' IS DISTINCT FROM NEW.write_spec_hash
      OR a.admission_payload#>>'{writeSpec,actionPlanHash}' IS DISTINCT FROM u.action_plan_hash
      OR a.admission_payload#>>'{writeSpec,target,entityRef}' IS DISTINCT FROM u.entity_ref
      OR a.admission_payload#>>'{capabilities,canExecute}' IS DISTINCT FROM 'false'
      OR a.admission_payload#>>'{capabilities,canWriteMeta}' IS DISTINCT FROM 'false'
      OR a.admission_payload#>>'{capabilities,canDispatchNetwork}' IS DISTINCT FROM 'false'
      OR u.action_type NOT IN ('budget_decrease','budget_increase')
      OR u.action_plan_payload#>>'{action,kind}' IS DISTINCT FROM 'budget_change'
      OR u.action_plan_payload#>>'{action,entity,ref}' IS DISTINCT FROM u.entity_ref
      OR u.action_plan_payload#>>'{action,budgetOwnerRef}' IS DISTINCT FROM u.entity_ref
      OR u.action_plan_payload#>>'{action,budgetKind}' IS DISTINCT FROM NEW.budget_kind
      OR u.action_plan_payload#>>'{action,currency}' IS DISTINCT FROM NEW.currency
      OR NEW.action_plan_hash IS DISTINCT FROM u.action_plan_hash
      OR NEW.proposal_hash IS DISTINCT FROM bundle.plan_hash
      OR bundle.plan_ref !~ '^guide_budget_[a-f0-9]{32}_[a-f0-9]{64}$'
      OR NEW.dry_run_hash IS DISTINCT FROM substring(bundle.plan_ref from '([a-f0-9]{64})$')
      OR NEW.idempotency_key IS DISTINCT FROM 'p06_exec_idem_'||public.guide_run_sha256(jsonb_build_object('attemptId',a.id::text,'grantHash',g.grant_hash,'requestHash',NEW.request_hash))
    THEN RAISE EXCEPTION 'p06 budget execution source invalid'; END IF;

    before_decimal := u.action_plan_payload#>>'{action,beforeDecimal}';
    after_decimal := u.action_plan_payload#>>'{action,afterDecimal}';
    IF u.ad_set_id IS NOT NULL THEN
      SELECT configured_status INTO mirror_status FROM public.meta_ad_sets
        WHERE workspace_id=NEW.workspace_id AND id=u.ad_set_id AND disappeared_at IS NULL FOR SHARE;
    ELSE
      SELECT configured_status INTO mirror_status FROM public.ad_campaigns
        WHERE workspace_id=NEW.workspace_id AND id=u.campaign_id AND disappeared_at IS NULL FOR SHARE;
    END IF;
    IF before_decimal IS NULL OR after_decimal IS NULL
      OR before_decimal !~ '^(0|[1-9][0-9]{0,13})(\.[0-9]{1,2})?$'
      OR after_decimal !~ '^(0|[1-9][0-9]{0,13})(\.[0-9]{1,2})?$'
    THEN RAISE EXCEPTION 'p06 budget decimals invalid'; END IF;
    before_minor := split_part(before_decimal,'.',1)::bigint*100
      + rpad(split_part(before_decimal,'.',2),2,'0')::integer;
    after_minor := split_part(after_decimal,'.',1)::bigint*100
      + rpad(split_part(after_decimal,'.',2),2,'0')::integer;
    IF jsonb_typeof(NEW.request_payload#>'{expectedBefore,budgetMinor}') IS DISTINCT FROM 'number'
      OR jsonb_typeof(NEW.request_payload#>'{desired,budgetMinor}') IS DISTINCT FROM 'number'
      OR (NEW.request_payload#>>'{expectedBefore,budgetMinor}')::bigint IS DISTINCT FROM before_minor
      OR (NEW.request_payload#>>'{desired,budgetMinor}')::bigint IS DISTINCT FROM after_minor
      OR mirror_status NOT IN ('ACTIVE','PAUSED')
      OR NEW.request_payload#>>'{expectedBefore,status}' IS DISTINCT FROM mirror_status
      OR NEW.request_payload#>>'{expectedBefore,status}' IS DISTINCT FROM NEW.request_payload#>>'{desired,status}'
      OR (u.action_type='budget_decrease' AND after_minor>=before_minor)
      OR (u.action_type='budget_increase' AND after_minor<=before_minor)
    THEN RAISE EXCEPTION 'p06 budget execution values invalid'; END IF;
  ELSE
    RAISE EXCEPTION 'p06 execution route invalid';
  END IF;
  RETURN NEW;
END; $$;

REVOKE ALL ON FUNCTION public.p06_execution_run_insert_guard() FROM PUBLIC, anon, authenticated, service_role;
