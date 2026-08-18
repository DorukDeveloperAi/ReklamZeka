-- PRE-ONLY. Binds a non-executable limited-autonomy admission to the shared
-- fenced execution-v2 ledger. No credential, network or Meta authority is
-- stored here; every runnable write remains behind all five central gates.

ALTER TABLE public.p06_execution_runs
  ALTER COLUMN proposal_bundle_id DROP NOT NULL,
  ALTER COLUMN action_unit_id DROP NOT NULL,
  ALTER COLUMN decision_event_id DROP NOT NULL,
  ALTER COLUMN approval_grant_id DROP NOT NULL,
  ALTER COLUMN action_unit_hash DROP NOT NULL,
  ALTER COLUMN proposal_hash DROP NOT NULL,
  ADD COLUMN limited_autonomy_admission_id uuid,
  ADD COLUMN autonomy_evidence_hash text,
  ADD COLUMN data_health_report_hash text,
  ADD COLUMN protection_hash text;

ALTER TABLE public.p06_execution_runs
  ADD CONSTRAINT p06_execution_runs_limited_admission_fk
    FOREIGN KEY(workspace_id,limited_autonomy_admission_id)
    REFERENCES public.p06_limited_autonomy_admissions(workspace_id,id) ON DELETE RESTRICT,
  ADD CONSTRAINT p06_execution_runs_workspace_limited_admission_unique
    UNIQUE(workspace_id,limited_autonomy_admission_id);

CREATE INDEX p06_execution_runs_limited_admission_fk_idx
  ON public.p06_execution_runs(workspace_id,limited_autonomy_admission_id);

ALTER TABLE public.p06_execution_runs DROP CONSTRAINT p06_execution_runs_contract;
ALTER TABLE public.p06_execution_runs ADD CONSTRAINT p06_execution_runs_contract CHECK ((
  execution_ref ~ '^p06_execution_[a-f0-9]{24}$'
  AND idempotency_key ~ '^p06_exec_idem_[a-f0-9]{64}$'
  AND request_hash ~ '^[a-f0-9]{64}$'
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
  AND request_payload->>'contextHash'=context_hash
  AND request_payload->>'policyHash'=policy_hash
  AND request_payload->>'gateSetHash'=gate_set_hash
  AND request_payload::text !~* '"(token|accessToken|secret|prompt|[^"[:space:]]*raw[_-]?(payload|request|response|json))"[[:space:]]*:'
  AND (
    (route='human_approved'
      AND guide_run_action_binding_id IS NOT NULL AND action_execution_attempt_id IS NULL
      AND limited_autonomy_admission_id IS NULL
      AND proposal_bundle_id IS NOT NULL AND action_unit_id IS NOT NULL
      AND decision_event_id IS NOT NULL AND approval_grant_id IS NOT NULL
      AND action_unit_hash ~ '^[a-f0-9]{64}$' AND proposal_hash ~ '^[a-f0-9]{64}$'
      AND admission_hash IS NULL AND write_spec_hash IS NULL AND dry_run_hash IS NULL
      AND action_plan_hash IS NULL AND budget_kind IS NULL AND currency IS NULL
      AND autonomy_evidence_hash IS NULL AND data_health_report_hash IS NULL AND protection_hash IS NULL
      AND effective_guide_set_hash ~ '^[a-f0-9]{64}$' AND resolution_hash ~ '^[a-f0-9]{64}$'
      AND public.p06_jsonb_object_key_count(request_payload)=19
      AND request_payload ?& ARRAY['version','workspaceRef','accountRef','entityRef','action','expectedBefore','desired','evaluatedAt','actionUnitHash','proposalHash','contextHash','effectiveGuideSetHash','resolutionHash','policyHash','gateSetHash','route','executionRef','idempotencyKey','requestHash']
      AND request_payload->>'actionUnitHash'=action_unit_hash
      AND request_payload->>'proposalHash'=proposal_hash
      AND request_payload->>'effectiveGuideSetHash'=effective_guide_set_hash
      AND request_payload->>'resolutionHash'=resolution_hash)
    OR
    (route='guide_budget_human_approved'
      AND guide_run_action_binding_id IS NULL AND action_execution_attempt_id IS NOT NULL
      AND limited_autonomy_admission_id IS NULL
      AND proposal_bundle_id IS NOT NULL AND action_unit_id IS NOT NULL
      AND decision_event_id IS NOT NULL AND approval_grant_id IS NOT NULL
      AND action_unit_hash ~ '^[a-f0-9]{64}$' AND proposal_hash ~ '^[a-f0-9]{64}$'
      AND effective_guide_set_hash IS NULL AND resolution_hash IS NULL
      AND admission_hash ~ '^[a-f0-9]{64}$' AND write_spec_hash ~ '^[a-f0-9]{64}$'
      AND dry_run_hash ~ '^[a-f0-9]{64}$' AND action_plan_hash ~ '^[a-f0-9]{64}$'
      AND budget_kind IN ('daily','lifetime') AND currency ~ '^[A-Z]{3}$'
      AND autonomy_evidence_hash IS NULL AND data_health_report_hash IS NULL AND protection_hash IS NULL
      AND public.p06_jsonb_object_key_count(request_payload)=25
      AND request_payload ?& ARRAY['version','workspaceRef','accountRef','entityRef','action','budgetKind','currency','expectedBefore','desired','evaluatedAt','actionUnitHash','proposalHash','contextHash','effectiveGuideSetHash','resolutionHash','policyHash','gateSetHash','admissionHash','writeSpecHash','dryRunHash','actionPlanHash','route','executionRef','idempotencyKey','requestHash']
      AND request_payload->>'actionUnitHash'=action_unit_hash
      AND request_payload->>'proposalHash'=proposal_hash
      AND request_payload->>'budgetKind'=budget_kind AND request_payload->>'currency'=currency
      AND request_payload->>'admissionHash'=admission_hash
      AND request_payload->>'writeSpecHash'=write_spec_hash
      AND request_payload->>'dryRunHash'=dry_run_hash
      AND request_payload->>'actionPlanHash'=action_plan_hash
      AND request_payload->'effectiveGuideSetHash'='null'::jsonb
      AND request_payload->'resolutionHash'='null'::jsonb)
    OR
    (route='limited_autonomy_status'
      AND guide_run_action_binding_id IS NULL AND action_execution_attempt_id IS NULL
      AND limited_autonomy_admission_id IS NOT NULL
      AND proposal_bundle_id IS NULL AND action_unit_id IS NULL
      AND decision_event_id IS NULL AND approval_grant_id IS NULL
      AND action_unit_hash IS NULL AND proposal_hash IS NULL
      AND admission_hash ~ '^[a-f0-9]{64}$' AND action_plan_hash ~ '^[a-f0-9]{64}$'
      AND autonomy_evidence_hash ~ '^[a-f0-9]{64}$'
      AND data_health_report_hash ~ '^[a-f0-9]{64}$' AND protection_hash ~ '^[a-f0-9]{64}$'
      AND effective_guide_set_hash ~ '^[a-f0-9]{64}$' AND resolution_hash ~ '^[a-f0-9]{64}$'
      AND write_spec_hash IS NULL AND dry_run_hash IS NULL AND budget_kind IS NULL AND currency IS NULL
      AND public.p06_jsonb_object_key_count(request_payload)=22
      AND request_payload ?& ARRAY['version','workspaceRef','accountRef','entityRef','action','expectedBefore','desired','evaluatedAt','contextHash','effectiveGuideSetHash','resolutionHash','policyHash','gateSetHash','admissionHash','autonomyEvidenceHash','dataHealthReportHash','protectionHash','actionPlanHash','route','executionRef','idempotencyKey','requestHash']
      AND request_payload->>'effectiveGuideSetHash'=effective_guide_set_hash
      AND request_payload->>'resolutionHash'=resolution_hash
      AND request_payload->>'admissionHash'=admission_hash
      AND request_payload->>'autonomyEvidenceHash'=autonomy_evidence_hash
      AND request_payload->>'dataHealthReportHash'=data_health_report_hash
      AND request_payload->>'protectionHash'=protection_hash
      AND request_payload->>'actionPlanHash'=action_plan_hash)
  )
) IS TRUE);

CREATE OR REPLACE FUNCTION public.p06_limited_autonomy_execution_insert_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  admission public.p06_limited_autonomy_admissions%ROWTYPE;
  run_head public.guide_run_heads%ROWTYPE;
  current_status text;
  rule_count integer;
  rule_cap integer;
  rule_hash text;
BEGIN
  SELECT * INTO admission FROM public.p06_limited_autonomy_admissions
    WHERE workspace_id=NEW.workspace_id AND id=NEW.limited_autonomy_admission_id FOR SHARE;
  SELECT h.* INTO run_head FROM public.guide_run_heads h
    JOIN public.guide_runs r ON r.workspace_id=h.workspace_id AND r.id=h.run_id
    WHERE h.workspace_id=NEW.workspace_id AND r.id=admission.run_id FOR SHARE OF h;

  WITH latest AS (
    SELECT DISTINCT ON(rule_ref) rule_ref,scope_level,scope_ref,action_type,mode,state,effective_from,expires_at,
      kill_switch,maximum_actions_per_run,canonical_hash
    FROM public.autonomy_rule_revisions WHERE workspace_id=NEW.workspace_id AND state IN ('published','disabled')
    ORDER BY rule_ref,revision DESC
  ), exact_rules AS (
    SELECT * FROM latest WHERE state='published' AND mode='policy_limited' AND NOT kill_switch
      AND effective_from<=statement_timestamp() AND (expires_at IS NULL OR expires_at>statement_timestamp())
      AND ((scope_level='workspace' AND scope_ref=run_head.run_payload->>'workspaceRef' AND action_type IS NULL)
        OR (scope_level='action_type' AND scope_ref IS NULL AND action_type='status_pause'))
  ) SELECT (SELECT count(*) FROM exact_rules),
      (SELECT min(maximum_actions_per_run) FROM exact_rules),
      (SELECT public.guide_run_sha256(jsonb_build_object('ruleHashes',jsonb_agg(canonical_hash ORDER BY canonical_hash))) FROM exact_rules)
    INTO rule_count,rule_cap,rule_hash;

  SELECT coalesce(ad.effective_status,ad.configured_status) INTO current_status
    FROM public.meta_ad_sets ad
    JOIN public.effective_campaign_contexts context ON context.workspace_id=ad.workspace_id
      AND context.ad_account_id=ad.ad_account_id AND context.entity_type='ad_set'
      AND context.entity_ref=ad.external_ad_set_id
    WHERE ad.workspace_id=NEW.workspace_id AND ad.external_ad_set_id=admission.entity_ref
      AND ad.disappeared_at IS NULL AND context.context_hash=admission.context_hash
      AND context.account_ref=admission.account_ref AND context.captured_at<=statement_timestamp()
      AND NOT EXISTS(SELECT 1 FROM public.effective_campaign_context_components component
        JOIN public.effective_campaign_context_invalidations invalidation
          ON invalidation.workspace_id=component.workspace_id
          AND invalidation.component_type=component.component_type
          AND invalidation.component_ref=component.component_ref
          AND invalidation.component_version=component.component_version
        WHERE component.workspace_id=context.workspace_id AND component.context_id=context.id
          AND (invalidation.entity_type IS NULL OR (invalidation.entity_type=context.entity_type AND invalidation.entity_ref=context.entity_ref)))
    ORDER BY context.captured_at DESC,context.created_at DESC,context.id DESC LIMIT 1 FOR SHARE OF ad,context;

  IF admission.id IS NULL OR run_head.id IS NULL
    OR admission.action_type IS DISTINCT FROM 'status_pause'
    OR admission.expected_status IS DISTINCT FROM 'ACTIVE' OR admission.desired_status IS DISTINCT FROM 'PAUSED'
    OR admission.expires_at<=statement_timestamp() OR admission.admitted_at>statement_timestamp()
    OR NEW.created_at<statement_timestamp()-interval '5 seconds'
    OR NEW.created_at>statement_timestamp()+interval '1 second'
    OR current_status IS DISTINCT FROM admission.expected_status
    OR rule_count IS DISTINCT FROM 2
    OR rule_cap IS DISTINCT FROM admission.maximum_actions_per_run
    OR rule_hash IS DISTINCT FROM admission.autonomy_evidence_hash
    OR NOT EXISTS(SELECT 1 FROM public.guide_runs r
      JOIN public.guides guide ON guide.workspace_id=r.workspace_id AND guide.id=r.guide_id AND guide.tombstoned_at IS NULL
      JOIN public.guide_heads head ON head.workspace_id=guide.workspace_id AND head.guide_id=guide.id
        AND head.current_active_revision_id=admission.guide_revision_id
      JOIN public.guide_revisions revision ON revision.workspace_id=r.workspace_id
        AND revision.id=admission.guide_revision_id AND revision.guide_id=guide.id AND revision.mode='limited_autonomy'
      JOIN public.workspaces workspace ON workspace.id=r.workspace_id AND workspace.lifecycle_state='active' AND workspace.tombstoned_at IS NULL
      WHERE r.workspace_id=NEW.workspace_id AND r.id=admission.run_id AND r.guide_revision_id=admission.guide_revision_id
        AND EXISTS(SELECT 1 FROM public.guide_revision_actions action WHERE action.workspace_id=revision.workspace_id
          AND action.guide_revision_id=revision.id AND action.action='status_pause' AND action.authority='limited_autonomy'))
    OR NOT EXISTS(SELECT 1 FROM public.approval_policy_definition_revisions policy
      WHERE policy.workspace_id=NEW.workspace_id AND policy.policy_hash=admission.approval_policy_hash
        AND policy.action_type='status_pause' AND policy.risk='K2' AND policy.state='published'
        AND policy.effective_from<=statement_timestamp() AND (policy.expires_at IS NULL OR policy.expires_at>statement_timestamp())
        AND NOT EXISTS(SELECT 1 FROM public.approval_policy_definition_revisions newer
          WHERE newer.workspace_id=policy.workspace_id AND newer.policy_ref=policy.policy_ref
            AND newer.revision>policy.revision AND newer.state IN ('published','disabled')
            AND newer.effective_from<=statement_timestamp()))
    OR NEW.proposal_bundle_id IS NOT NULL OR NEW.action_unit_id IS NOT NULL
    OR NEW.decision_event_id IS NOT NULL OR NEW.approval_grant_id IS NOT NULL
    OR NEW.action_unit_hash IS NOT NULL OR NEW.proposal_hash IS NOT NULL
    OR NEW.context_hash IS DISTINCT FROM admission.context_hash
    OR NEW.effective_guide_set_hash IS DISTINCT FROM admission.effective_guide_set_hash
    OR NEW.resolution_hash IS DISTINCT FROM admission.resolution_hash
    OR NEW.policy_hash IS DISTINCT FROM admission.approval_policy_hash
    OR NEW.admission_hash IS DISTINCT FROM admission.admission_hash
    OR NEW.autonomy_evidence_hash IS DISTINCT FROM admission.autonomy_evidence_hash
    OR NEW.data_health_report_hash IS DISTINCT FROM admission.data_health_report_hash
    OR NEW.protection_hash IS DISTINCT FROM admission.protection_hash
    OR NEW.action_plan_hash IS DISTINCT FROM admission.action_plan_hash
    OR cardinality(ARRAY(SELECT jsonb_object_keys(NEW.request_payload))) IS DISTINCT FROM 22
    OR NEW.request_payload->>'workspaceRef' IS DISTINCT FROM run_head.run_payload->>'workspaceRef'
    OR NEW.request_payload->>'accountRef' IS DISTINCT FROM admission.account_ref
    OR NEW.request_payload->>'entityRef' IS DISTINCT FROM admission.entity_ref
    OR NEW.request_payload->>'action' IS DISTINCT FROM 'status_pause'
    OR NEW.request_payload#>>'{expectedBefore,status}' IS DISTINCT FROM 'ACTIVE'
    OR NEW.request_payload#>'{expectedBefore,budgetMinor}' IS DISTINCT FROM 'null'::jsonb
    OR NEW.request_payload#>>'{desired,status}' IS DISTINCT FROM 'PAUSED'
    OR NEW.request_payload#>'{desired,budgetMinor}' IS DISTINCT FROM 'null'::jsonb
    OR jsonb_typeof(NEW.request_payload->'evaluatedAt') IS DISTINCT FROM 'string'
    OR (NEW.request_payload->>'evaluatedAt')::timestamptz IS DISTINCT FROM NEW.created_at
    OR NEW.request_hash IS DISTINCT FROM public.guide_run_sha256(NEW.request_payload-ARRAY['requestHash','executionRef','idempotencyKey'])
    OR NEW.execution_ref IS DISTINCT FROM 'p06_execution_'||substr(NEW.request_hash,1,24)
    OR NEW.idempotency_key IS DISTINCT FROM 'p06_exec_idem_'||public.guide_run_sha256(jsonb_build_object(
      'limitedAutonomyAdmissionId',admission.id::text,'requestHash',NEW.request_hash))
  THEN RAISE EXCEPTION 'p06 limited autonomy execution source invalid'; END IF;
  RETURN NEW;
END; $$;

DROP TRIGGER p06_execution_runs_exact_insert ON public.p06_execution_runs;
CREATE TRIGGER p06_execution_runs_exact_insert BEFORE INSERT ON public.p06_execution_runs
FOR EACH ROW WHEN (NEW.route<>'limited_autonomy_status') EXECUTE FUNCTION public.p06_execution_run_insert_guard();
CREATE TRIGGER p06_execution_runs_limited_exact_insert BEFORE INSERT ON public.p06_execution_runs
FOR EACH ROW WHEN (NEW.route='limited_autonomy_status') EXECUTE FUNCTION public.p06_limited_autonomy_execution_insert_guard();

REVOKE ALL ON FUNCTION public.p06_limited_autonomy_execution_insert_guard() FROM PUBLIC,anon,authenticated,service_role;
