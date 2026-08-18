-- PRE-ONLY. Durable, default-off rename execution identity. A row is created
-- only from the existing disabled admission attempt and its human approval
-- evidence; this migration does not grant a network or Meta capability.

ALTER TABLE public.p06_execution_runs DROP CONSTRAINT p06_execution_runs_contract;
ALTER TABLE public.p06_execution_runs ADD CONSTRAINT p06_execution_runs_contract CHECK ((
  execution_ref ~ '^p06_execution_[a-f0-9]{24}$'
  AND idempotency_key ~ '^p06_exec_idem_[a-f0-9]{64}$'
  AND request_hash ~ '^[a-f0-9]{64}$' AND context_hash ~ '^[a-f0-9]{64}$'
  AND policy_hash ~ '^[a-f0-9]{64}$' AND gate_set_hash ~ '^[a-f0-9]{64}$'
  AND version='p06-execution-run/1.0.0' AND jsonb_typeof(request_payload)='object'
  AND octet_length(request_payload::text)<=32768
  AND NOT request_payload ?| ARRAY['leaseTokenHash','fenceHash']
  AND request_payload->>'version'='p06-execution-request/1.0.0'
  AND request_payload->>'executionRef'=execution_ref
  AND request_payload->>'idempotencyKey'=idempotency_key
  AND request_payload->>'requestHash'=request_hash AND request_payload->>'route'=route
  AND request_payload->>'contextHash'=context_hash AND request_payload->>'policyHash'=policy_hash
  AND request_payload->>'gateSetHash'=gate_set_hash
  AND request_payload::text !~* '"(token|accessToken|secret|prompt|[^"[:space:]]*raw[_-]?(payload|request|response|json))"[[:space:]]*:'
  AND (
    (route='human_approved'
      AND guide_run_action_binding_id IS NOT NULL AND action_execution_attempt_id IS NULL AND limited_autonomy_admission_id IS NULL
      AND proposal_bundle_id IS NOT NULL AND action_unit_id IS NOT NULL AND decision_event_id IS NOT NULL AND approval_grant_id IS NOT NULL
      AND action_unit_hash ~ '^[a-f0-9]{64}$' AND proposal_hash ~ '^[a-f0-9]{64}$'
      AND admission_hash IS NULL AND write_spec_hash IS NULL AND dry_run_hash IS NULL AND action_plan_hash IS NULL
      AND budget_kind IS NULL AND currency IS NULL AND autonomy_evidence_hash IS NULL AND data_health_report_hash IS NULL AND protection_hash IS NULL
      AND effective_guide_set_hash ~ '^[a-f0-9]{64}$' AND resolution_hash ~ '^[a-f0-9]{64}$'
      AND public.p06_jsonb_object_key_count(request_payload)=19
      AND request_payload ?& ARRAY['version','workspaceRef','accountRef','entityRef','action','expectedBefore','desired','evaluatedAt','actionUnitHash','proposalHash','contextHash','effectiveGuideSetHash','resolutionHash','policyHash','gateSetHash','route','executionRef','idempotencyKey','requestHash']
      AND request_payload->>'actionUnitHash'=action_unit_hash AND request_payload->>'proposalHash'=proposal_hash
      AND request_payload->>'effectiveGuideSetHash'=effective_guide_set_hash AND request_payload->>'resolutionHash'=resolution_hash)
    OR (route='guide_budget_human_approved'
      AND guide_run_action_binding_id IS NULL AND action_execution_attempt_id IS NOT NULL AND limited_autonomy_admission_id IS NULL
      AND proposal_bundle_id IS NOT NULL AND action_unit_id IS NOT NULL AND decision_event_id IS NOT NULL AND approval_grant_id IS NOT NULL
      AND action_unit_hash ~ '^[a-f0-9]{64}$' AND proposal_hash ~ '^[a-f0-9]{64}$'
      AND effective_guide_set_hash IS NULL AND resolution_hash IS NULL
      AND admission_hash ~ '^[a-f0-9]{64}$' AND write_spec_hash ~ '^[a-f0-9]{64}$' AND dry_run_hash ~ '^[a-f0-9]{64}$' AND action_plan_hash ~ '^[a-f0-9]{64}$'
      AND budget_kind IN ('daily','lifetime') AND currency ~ '^[A-Z]{3}$'
      AND autonomy_evidence_hash IS NULL AND data_health_report_hash IS NULL AND protection_hash IS NULL
      AND public.p06_jsonb_object_key_count(request_payload)=25
      AND request_payload ?& ARRAY['version','workspaceRef','accountRef','entityRef','action','budgetKind','currency','expectedBefore','desired','evaluatedAt','actionUnitHash','proposalHash','contextHash','effectiveGuideSetHash','resolutionHash','policyHash','gateSetHash','admissionHash','writeSpecHash','dryRunHash','actionPlanHash','route','executionRef','idempotencyKey','requestHash']
      AND request_payload->>'actionUnitHash'=action_unit_hash AND request_payload->>'proposalHash'=proposal_hash
      AND request_payload->>'budgetKind'=budget_kind AND request_payload->>'currency'=currency
      AND request_payload->>'admissionHash'=admission_hash AND request_payload->>'writeSpecHash'=write_spec_hash
      AND request_payload->>'dryRunHash'=dry_run_hash AND request_payload->>'actionPlanHash'=action_plan_hash
      AND request_payload->'effectiveGuideSetHash'='null'::jsonb AND request_payload->'resolutionHash'='null'::jsonb)
    OR (route='human_rename_approved'
      AND guide_run_action_binding_id IS NULL AND action_execution_attempt_id IS NOT NULL AND limited_autonomy_admission_id IS NULL
      AND proposal_bundle_id IS NOT NULL AND action_unit_id IS NOT NULL AND decision_event_id IS NOT NULL AND approval_grant_id IS NOT NULL
      AND action_unit_hash ~ '^[a-f0-9]{64}$' AND proposal_hash ~ '^[a-f0-9]{64}$'
      AND effective_guide_set_hash IS NULL AND resolution_hash IS NULL
      AND admission_hash ~ '^[a-f0-9]{64}$' AND write_spec_hash ~ '^[a-f0-9]{64}$' AND action_plan_hash ~ '^[a-f0-9]{64}$'
      AND dry_run_hash IS NULL AND budget_kind IS NULL AND currency IS NULL
      AND autonomy_evidence_hash IS NULL AND data_health_report_hash IS NULL AND protection_hash IS NULL
      AND public.p06_jsonb_object_key_count(request_payload)=22
      AND request_payload ?& ARRAY['version','workspaceRef','accountRef','entityRef','action','expectedBefore','desired','evaluatedAt','actionUnitHash','proposalHash','contextHash','effectiveGuideSetHash','resolutionHash','policyHash','gateSetHash','admissionHash','writeSpecHash','actionPlanHash','route','executionRef','idempotencyKey','requestHash']
      AND request_payload->>'actionUnitHash'=action_unit_hash AND request_payload->>'proposalHash'=proposal_hash
      AND request_payload->>'admissionHash'=admission_hash AND request_payload->>'writeSpecHash'=write_spec_hash
      AND request_payload->>'actionPlanHash'=action_plan_hash
      AND request_payload->'effectiveGuideSetHash'='null'::jsonb AND request_payload->'resolutionHash'='null'::jsonb)
    OR (route='limited_autonomy_status'
      AND guide_run_action_binding_id IS NULL AND action_execution_attempt_id IS NULL AND limited_autonomy_admission_id IS NOT NULL
      AND proposal_bundle_id IS NULL AND action_unit_id IS NULL AND decision_event_id IS NULL AND approval_grant_id IS NULL
      AND action_unit_hash IS NULL AND proposal_hash IS NULL AND admission_hash ~ '^[a-f0-9]{64}$' AND action_plan_hash ~ '^[a-f0-9]{64}$'
      AND autonomy_evidence_hash ~ '^[a-f0-9]{64}$' AND data_health_report_hash ~ '^[a-f0-9]{64}$' AND protection_hash ~ '^[a-f0-9]{64}$'
      AND effective_guide_set_hash ~ '^[a-f0-9]{64}$' AND resolution_hash ~ '^[a-f0-9]{64}$'
      AND write_spec_hash IS NULL AND dry_run_hash IS NULL AND budget_kind IS NULL AND currency IS NULL
      AND public.p06_jsonb_object_key_count(request_payload)=22
      AND request_payload ?& ARRAY['version','workspaceRef','accountRef','entityRef','action','expectedBefore','desired','evaluatedAt','contextHash','effectiveGuideSetHash','resolutionHash','policyHash','gateSetHash','admissionHash','autonomyEvidenceHash','dataHealthReportHash','protectionHash','actionPlanHash','route','executionRef','idempotencyKey','requestHash']
      AND request_payload->>'effectiveGuideSetHash'=effective_guide_set_hash AND request_payload->>'resolutionHash'=resolution_hash
      AND request_payload->>'admissionHash'=admission_hash AND request_payload->>'autonomyEvidenceHash'=autonomy_evidence_hash
      AND request_payload->>'dataHealthReportHash'=data_health_report_hash AND request_payload->>'protectionHash'=protection_hash
      AND request_payload->>'actionPlanHash'=action_plan_hash)
  )
) IS TRUE);

-- Keep the already accepted status/budget guard byte-for-byte in force, and
-- dispatch only the new route to its narrower human-rename guard.
ALTER FUNCTION public.p06_execution_run_insert_guard() RENAME TO p06_execution_run_insert_guard_existing;
DROP TRIGGER p06_execution_runs_exact_insert ON public.p06_execution_runs;
CREATE TRIGGER p06_execution_runs_existing_exact_insert BEFORE INSERT ON public.p06_execution_runs
  FOR EACH ROW WHEN (NEW.route IN ('human_approved','guide_budget_human_approved'))
  EXECUTE FUNCTION public.p06_execution_run_insert_guard_existing();

CREATE OR REPLACE FUNCTION public.p06_human_rename_execution_insert_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  a public.action_execution_attempts%ROWTYPE;
  u public.action_proposal_units%ROWTYPE;
  d public.action_approval_decision_events%ROWTYPE;
  g public.action_approval_evidence_grants%ROWTYPE;
  bundle public.action_proposal_bundles%ROWTYPE;
  persisted_policy_hash text;
  current_status text;
  current_name text;
  expected_level text;
BEGIN
  SELECT * INTO a FROM public.action_execution_attempts WHERE workspace_id=NEW.workspace_id AND id=NEW.action_execution_attempt_id FOR SHARE;
  SELECT * INTO u FROM public.action_proposal_units WHERE workspace_id=NEW.workspace_id AND id=NEW.action_unit_id FOR SHARE;
  SELECT * INTO d FROM public.action_approval_decision_events WHERE workspace_id=NEW.workspace_id AND id=NEW.decision_event_id FOR SHARE;
  SELECT * INTO g FROM public.action_approval_evidence_grants WHERE workspace_id=NEW.workspace_id AND id=NEW.approval_grant_id FOR SHARE;
  SELECT * INTO bundle FROM public.action_proposal_bundles WHERE workspace_id=NEW.workspace_id AND id=NEW.proposal_bundle_id FOR SHARE;
  SELECT p.policy_hash INTO persisted_policy_hash FROM public.action_approval_policy_snapshots p
    WHERE p.workspace_id=NEW.workspace_id AND p.id=bundle.policy_snapshot_id FOR SHARE;
  IF a.id IS NULL OR u.id IS NULL OR d.id IS NULL OR g.id IS NULL OR bundle.id IS NULL
    OR a.bundle_id IS DISTINCT FROM bundle.id OR a.unit_id IS DISTINCT FROM u.id
    OR a.decision_event_id IS DISTINCT FROM d.id OR a.approval_grant_id IS DISTINCT FROM g.id
    OR u.bundle_id IS DISTINCT FROM bundle.id
    OR d.command_kind IS DISTINCT FROM 'approve' OR d.bundle_id IS DISTINCT FROM bundle.id OR d.unit_id IS DISTINCT FROM u.id
    OR g.bundle_id IS DISTINCT FROM bundle.id OR g.unit_id IS DISTINCT FROM u.id OR g.decision_event_id IS DISTINCT FROM d.id
    OR g.expires_at<=statement_timestamp() OR g.capability IS DISTINCT FROM 'approval_evidence_only' OR g.can_execute IS DISTINCT FROM false
    OR NEW.action_unit_hash IS DISTINCT FROM u.unit_hash OR NEW.proposal_hash IS DISTINCT FROM bundle.plan_hash
    OR NEW.context_hash IS DISTINCT FROM u.context_hash OR NEW.policy_hash IS DISTINCT FROM persisted_policy_hash
    OR NEW.admission_hash IS DISTINCT FROM a.admission_hash OR NEW.write_spec_hash IS DISTINCT FROM a.write_spec_hash
    OR NEW.action_plan_hash IS DISTINCT FROM u.action_plan_hash
    OR a.admission_payload->>'admissionHash' IS DISTINCT FROM NEW.admission_hash
    OR a.admission_payload#>>'{writeSpec,specHash}' IS DISTINCT FROM NEW.write_spec_hash
    OR a.admission_payload#>>'{writeSpec,actionPlanHash}' IS DISTINCT FROM NEW.action_plan_hash
    OR a.admission_payload#>>'{writeSpec,target,entityRef}' IS DISTINCT FROM u.entity_ref
    OR a.admission_payload#>>'{capabilities,canExecute}' IS DISTINCT FROM 'false'
    OR a.admission_payload#>>'{capabilities,canWriteMeta}' IS DISTINCT FROM 'false'
    OR a.admission_payload#>>'{capabilities,canDispatchNetwork}' IS DISTINCT FROM 'false'
    OR NEW.request_payload->>'workspaceRef' IS DISTINCT FROM bundle.workspace_ref
    OR NEW.request_payload->>'accountRef' IS DISTINCT FROM u.account_ref
    OR NEW.request_payload->>'entityRef' IS DISTINCT FROM u.entity_ref
    OR NEW.request_payload->>'action' IS DISTINCT FROM u.action_type
    OR jsonb_typeof(NEW.request_payload->'evaluatedAt') IS DISTINCT FROM 'string'
    OR NEW.request_payload->>'evaluatedAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$'
    OR (NEW.request_payload->>'evaluatedAt')::timestamptz IS DISTINCT FROM NEW.created_at
    OR NEW.request_hash IS DISTINCT FROM public.guide_run_sha256(NEW.request_payload-ARRAY['requestHash','executionRef','idempotencyKey'])
    OR NEW.execution_ref IS DISTINCT FROM 'p06_execution_'||substr(NEW.request_hash,1,24)
    OR u.action_type NOT IN ('campaign_rename','adset_rename','ad_rename')
    OR u.action_plan_payload#>>'{action,kind}' IS DISTINCT FROM 'rename'
    OR u.action_plan_payload#>>'{action,entity,ref}' IS DISTINCT FROM u.entity_ref
    OR u.action_plan_payload#>>'{action,beforeName}' IS DISTINCT FROM a.admission_payload#>>'{writeSpec,mutation,previousName}'
    OR u.action_plan_payload#>>'{action,afterName}' IS DISTINCT FROM a.admission_payload#>>'{writeSpec,mutation,desiredName}'
    OR u.action_plan_payload#>>'{action,beforeName}' IS NULL OR u.action_plan_payload#>>'{action,afterName}' IS NULL
    OR u.action_plan_payload#>>'{action,beforeName}'=u.action_plan_payload#>>'{action,afterName}'
    OR (u.action_type='campaign_rename' AND (u.campaign_id IS NULL OR u.ad_set_id IS NOT NULL OR u.ad_id IS NOT NULL))
    OR (u.action_type='adset_rename' AND (u.campaign_id IS NOT NULL OR u.ad_set_id IS NULL OR u.ad_id IS NOT NULL))
    OR (u.action_type='ad_rename' AND (u.campaign_id IS NOT NULL OR u.ad_set_id IS NOT NULL OR u.ad_id IS NULL))
    OR NEW.idempotency_key IS DISTINCT FROM 'p06_exec_idem_'||public.guide_run_sha256(jsonb_build_object('attemptId',a.id::text,'grantHash',g.grant_hash,'requestHash',NEW.request_hash))
  THEN RAISE EXCEPTION 'p06 human rename execution source invalid'; END IF;
  expected_level := CASE u.action_type WHEN 'campaign_rename' THEN 'campaign' WHEN 'adset_rename' THEN 'adset' ELSE 'ad' END;
  IF u.action_plan_payload#>>'{action,entity,level}' IS DISTINCT FROM expected_level THEN
    RAISE EXCEPTION 'p06 human rename target level invalid';
  END IF;
  IF u.campaign_id IS NOT NULL THEN
    SELECT configured_status,name INTO current_status,current_name FROM public.ad_campaigns
      WHERE workspace_id=NEW.workspace_id AND id=u.campaign_id AND disappeared_at IS NULL FOR SHARE;
  ELSIF u.ad_set_id IS NOT NULL THEN
    SELECT configured_status,name INTO current_status,current_name FROM public.meta_ad_sets
      WHERE workspace_id=NEW.workspace_id AND id=u.ad_set_id AND disappeared_at IS NULL FOR SHARE;
  ELSE
    SELECT configured_status,name INTO current_status,current_name FROM public.meta_ads
      WHERE workspace_id=NEW.workspace_id AND id=u.ad_id AND disappeared_at IS NULL FOR SHARE;
  END IF;
  IF current_status NOT IN ('ACTIVE','PAUSED') OR current_name IS DISTINCT FROM u.action_plan_payload#>>'{action,beforeName}'
    OR NEW.request_payload#>>'{expectedBefore,status}' IS DISTINCT FROM current_status
    OR NEW.request_payload#>>'{desired,status}' IS DISTINCT FROM current_status
    OR NEW.request_payload#>'{expectedBefore,budgetMinor}' IS DISTINCT FROM 'null'::jsonb
    OR NEW.request_payload#>'{desired,budgetMinor}' IS DISTINCT FROM 'null'::jsonb
    OR NEW.request_payload#>>'{expectedBefore,name}' IS DISTINCT FROM current_name
    OR NEW.request_payload#>>'{desired,name}' IS DISTINCT FROM u.action_plan_payload#>>'{action,afterName}'
  THEN RAISE EXCEPTION 'p06 human rename execution values invalid'; END IF;
  RETURN NEW;
END; $$;

CREATE TRIGGER p06_execution_runs_human_rename_exact_insert BEFORE INSERT ON public.p06_execution_runs
  FOR EACH ROW WHEN (NEW.route='human_rename_approved')
  EXECUTE FUNCTION public.p06_human_rename_execution_insert_guard();

REVOKE ALL ON FUNCTION public.p06_execution_run_insert_guard_existing(), public.p06_human_rename_execution_insert_guard()
  FROM PUBLIC, anon, authenticated, service_role;
