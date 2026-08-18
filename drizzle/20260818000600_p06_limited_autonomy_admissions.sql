-- PRE-ONLY. Durable, non-executable limited-autonomy admission and atomic
-- per-Guide-run quota reservation. This migration grants no Meta authority.

CREATE TABLE public.p06_limited_autonomy_admissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  run_id uuid NOT NULL,
  guide_revision_id uuid NOT NULL,
  disposition_artifact_id uuid NOT NULL,
  member_ref text NOT NULL,
  membership_hash text NOT NULL,
  entity_ref text NOT NULL,
  account_ref text NOT NULL,
  campaign_ref text NOT NULL,
  action_type text NOT NULL,
  expected_status text NOT NULL,
  desired_status text NOT NULL,
  context_hash text NOT NULL,
  effective_guide_set_hash text NOT NULL,
  resolution_hash text NOT NULL,
  data_health_report_hash text NOT NULL,
  protection_hash text NOT NULL,
  autonomy_evidence_hash text NOT NULL,
  action_plan_hash text NOT NULL,
  maximum_actions_per_run integer NOT NULL,
  quota_ordinal integer NOT NULL,
  admitted_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  admission_hash text NOT NULL,
  admission_payload jsonb NOT NULL,
  version text NOT NULL DEFAULT 'p06-limited-autonomy-admission/1.0.0',
  created_at timestamptz NOT NULL DEFAULT transaction_timestamp(),
  CONSTRAINT p06_limited_autonomy_admissions_workspace_row_unique UNIQUE(workspace_id,id),
  CONSTRAINT p06_limited_autonomy_admissions_workspace_artifact_unique UNIQUE(workspace_id,disposition_artifact_id),
  CONSTRAINT p06_limited_autonomy_admissions_run_ordinal_unique UNIQUE(workspace_id,run_id,quota_ordinal),
  CONSTRAINT p06_limited_autonomy_admissions_run_revision_fk FOREIGN KEY(workspace_id,run_id,guide_revision_id)
    REFERENCES public.guide_runs(workspace_id,id,guide_revision_id) ON DELETE CASCADE,
  CONSTRAINT p06_limited_autonomy_admissions_artifact_fk FOREIGN KEY(workspace_id,disposition_artifact_id)
    REFERENCES public.guide_run_artifacts(workspace_id,id) ON DELETE RESTRICT,
  CONSTRAINT p06_limited_autonomy_admissions_contract CHECK (
    member_ref ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    AND membership_hash ~ '^[a-f0-9]{64}$'
    AND entity_ref ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    AND account_ref ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    AND campaign_ref ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    AND action_type='status_pause' AND expected_status='ACTIVE' AND desired_status='PAUSED'
    AND context_hash ~ '^[a-f0-9]{64}$' AND effective_guide_set_hash ~ '^[a-f0-9]{64}$'
    AND resolution_hash ~ '^[a-f0-9]{64}$' AND data_health_report_hash ~ '^[a-f0-9]{64}$'
    AND protection_hash ~ '^[a-f0-9]{64}$' AND autonomy_evidence_hash ~ '^[a-f0-9]{64}$'
    AND action_plan_hash ~ '^[a-f0-9]{64}$' AND admission_hash ~ '^[a-f0-9]{64}$'
    AND maximum_actions_per_run BETWEEN 1 AND 1000000
    AND quota_ordinal BETWEEN 1 AND maximum_actions_per_run
    AND expires_at>admitted_at AND expires_at<=admitted_at+interval '1 hour'
    AND version='p06-limited-autonomy-admission/1.0.0'
    AND jsonb_typeof(admission_payload)='object' AND octet_length(admission_payload::text)<=32768
    AND admission_payload::text !~* '"[^"[:space:]]*(token|secret|prompt|raw[_-]?(payload|request|response|json))"[[:space:]]*:'
    AND admission_payload->>'version'=version AND admission_payload->>'admissionHash'=admission_hash
    AND admission_payload->>'action'=action_type AND admission_payload->>'memberRef'=member_ref
    AND admission_payload->>'membershipHash'=membership_hash AND admission_payload->>'entityRef'=entity_ref
    AND admission_payload->>'accountRef'=account_ref AND admission_payload->>'campaignRef'=campaign_ref
    AND admission_payload->>'expectedStatus'=expected_status AND admission_payload->>'desiredStatus'=desired_status
    AND admission_payload->>'contextHash'=context_hash
    AND admission_payload->>'effectiveGuideSetHash'=effective_guide_set_hash
    AND admission_payload->>'resolutionHash'=resolution_hash
    AND admission_payload->>'dataHealthReportHash'=data_health_report_hash
    AND admission_payload->>'protectionHash'=protection_hash
    AND admission_payload->>'autonomyEvidenceHash'=autonomy_evidence_hash
    AND admission_payload->>'actionPlanHash'=action_plan_hash
    AND (admission_payload->>'maximumActionsPerRun')::integer=maximum_actions_per_run
    AND (admission_payload->>'quotaOrdinal')::integer=quota_ordinal
    AND (admission_payload->>'admittedAt')::timestamptz=admitted_at
    AND (admission_payload->>'expiresAt')::timestamptz=expires_at
    AND admission_payload#>>'{authority,canApprove}'='false'
    AND admission_payload#>>'{authority,canExecute}'='false'
    AND admission_payload#>>'{authority,canWriteMeta}'='false'
    AND admission_payload#>>'{authority,canDispatchNetwork}'='false'
  )
);

CREATE INDEX p06_limited_autonomy_admissions_run_fk_idx ON public.p06_limited_autonomy_admissions(workspace_id,run_id,guide_revision_id);
CREATE INDEX p06_limited_autonomy_admissions_artifact_fk_idx ON public.p06_limited_autonomy_admissions(workspace_id,disposition_artifact_id);
CREATE INDEX p06_limited_autonomy_admissions_runnable_idx ON public.p06_limited_autonomy_admissions(workspace_id,admitted_at) WHERE quota_ordinal<=maximum_actions_per_run;

CREATE OR REPLACE FUNCTION public.p06_limited_autonomy_admission_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  r public.guide_runs%ROWTYPE; h public.guide_run_heads%ROWTYPE; a public.guide_run_artifacts%ROWTYPE;
  gr public.guide_revisions%ROWTYPE; candidate jsonb; ctx public.effective_campaign_contexts%ROWTYPE;
  current_status text; rule_count integer; rule_cap integer; rule_hash text; reserved integer;
BEGIN
  IF TG_OP='DELETE' AND EXISTS(SELECT 1 FROM public.workspaces WHERE id=OLD.workspace_id AND lifecycle_state='tombstoning') THEN RETURN OLD; END IF;
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'p06 limited autonomy admissions are append only'; END IF;
  SELECT * INTO r FROM public.guide_runs WHERE workspace_id=NEW.workspace_id AND id=NEW.run_id AND guide_revision_id=NEW.guide_revision_id FOR UPDATE;
  SELECT * INTO h FROM public.guide_run_heads WHERE workspace_id=NEW.workspace_id AND run_id=NEW.run_id FOR SHARE;
  SELECT * INTO a FROM public.guide_run_artifacts WHERE workspace_id=NEW.workspace_id AND id=NEW.disposition_artifact_id AND run_id=NEW.run_id FOR SHARE;
  SELECT * INTO gr FROM public.guide_revisions WHERE workspace_id=NEW.workspace_id AND id=NEW.guide_revision_id FOR SHARE;
  candidate:=a.payload->'disposition'->'candidate';
  IF r.id IS NULL OR h.run_id IS NULL OR a.id IS NULL OR gr.id IS NULL OR h.state IS DISTINCT FROM 'completed'
    OR gr.mode IS DISTINCT FROM 'limited_autonomy' OR a.kind IS DISTINCT FROM 'disposition'
    OR a.payload->'disposition'->>'state' IS DISTINCT FROM 'staged'
    OR candidate->>'routing' IS DISTINCT FROM 'limited_autonomy_review'
    OR candidate->>'action' IS DISTINCT FROM NEW.action_type
    OR candidate->'stageable'->>'entityRef' IS DISTINCT FROM NEW.member_ref
    OR candidate->'stageable'->>'membershipHash' IS DISTINCT FROM NEW.membership_hash
    OR candidate->'stageable'->>'entityLevel' IS DISTINCT FROM 'adset'
    OR candidate->'stageable'->'typedAction'->>'kind' IS DISTINCT FROM 'status_change'
    OR candidate->'stageable'->'typedAction'->'entity'->>'ref' IS DISTINCT FROM NEW.member_ref
    OR candidate->'stageable'->'typedAction'->>'fromStatus' IS DISTINCT FROM NEW.expected_status
    OR candidate->'stageable'->'typedAction'->>'toStatus' IS DISTINCT FROM NEW.desired_status
    OR candidate->>'candidateHash' IS DISTINCT FROM public.guide_run_sha256(jsonb_build_object(
      'candidateRef',candidate->>'candidateRef','action',candidate->>'action','version',candidate->'stageable'->>'version',
      'entityRef',candidate->'stageable'->>'entityRef','entityLevel',candidate->'stageable'->>'entityLevel',
      'membershipHash',candidate->'stageable'->>'membershipHash','sliceRef',candidate->'stageable'->>'sliceRef',
      'market',candidate->'stageable'->>'market','typedAction',candidate->'stageable'->'typedAction'))
    OR NOT EXISTS(SELECT 1 FROM public.guide_revision_actions x WHERE x.workspace_id=NEW.workspace_id AND x.guide_revision_id=NEW.guide_revision_id AND x.action=NEW.action_type AND x.authority='limited_autonomy')
    OR NOT EXISTS(SELECT 1 FROM public.guide_run_artifacts ss CROSS JOIN LATERAL jsonb_array_elements(ss.payload->'members') m
      WHERE ss.workspace_id=NEW.workspace_id AND ss.run_id=NEW.run_id AND ss.kind='scope_snapshot'
        AND m->>'memberRef'=NEW.member_ref AND m->>'membershipHash'=NEW.membership_hash)
    OR NOT EXISTS(SELECT 1 FROM public.guide_heads gh JOIN public.guides g ON g.workspace_id=gh.workspace_id AND g.id=gh.guide_id AND g.tombstoned_at IS NULL
      JOIN public.workspaces w ON w.id=gh.workspace_id AND w.lifecycle_state='active'
      WHERE gh.workspace_id=NEW.workspace_id AND gh.guide_id=r.guide_id AND gh.current_active_revision_id=NEW.guide_revision_id)
  THEN RAISE EXCEPTION 'limited autonomy source invalid'; END IF;

  SELECT c.* INTO ctx FROM public.effective_campaign_contexts c
    WHERE c.workspace_id=NEW.workspace_id AND c.entity_type='ad_set' AND c.entity_ref=NEW.entity_ref
      AND c.context_hash=NEW.context_hash AND c.account_ref=NEW.account_ref AND c.captured_at<=NEW.admitted_at
      AND NOT EXISTS(SELECT 1 FROM public.effective_campaign_context_components cc JOIN public.effective_campaign_context_invalidations i
        ON i.workspace_id=cc.workspace_id AND i.component_type=cc.component_type AND i.component_ref=cc.component_ref AND i.component_version=cc.component_version
        WHERE cc.workspace_id=c.workspace_id AND cc.context_id=c.id AND (i.entity_type IS NULL OR (i.entity_type=c.entity_type AND i.entity_ref=c.entity_ref)))
    ORDER BY c.captured_at DESC,c.created_at DESC,c.id DESC LIMIT 1 FOR SHARE;
  SELECT coalesce(ad.effective_status,ad.configured_status) INTO current_status FROM public.meta_ad_sets ad
    WHERE ad.workspace_id=NEW.workspace_id AND ad.ad_account_id=ctx.ad_account_id AND ad.external_ad_set_id=NEW.entity_ref AND ad.disappeared_at IS NULL FOR SHARE;
  IF ctx.id IS NULL OR current_status IS DISTINCT FROM NEW.expected_status
    OR NOT EXISTS(SELECT 1 FROM public.ad_campaigns cam WHERE cam.workspace_id=NEW.workspace_id AND cam.id=ctx.campaign_id
      AND cam.external_campaign_id=NEW.campaign_ref AND cam.disappeared_at IS NULL)
  THEN RAISE EXCEPTION 'limited autonomy current context invalid'; END IF;

  WITH latest AS (
    SELECT DISTINCT ON (rule_ref) rule_ref,scope_level,scope_ref,action_type,mode,state,effective_from,expires_at,kill_switch,maximum_actions_per_run,canonical_hash
    FROM public.autonomy_rule_revisions WHERE workspace_id=NEW.workspace_id AND state IN ('published','disabled')
    ORDER BY rule_ref,revision DESC
  ), exact_rules AS (
    SELECT * FROM latest WHERE state='published' AND mode='policy_limited' AND NOT kill_switch
      AND effective_from<=NEW.admitted_at AND (expires_at IS NULL OR expires_at>NEW.admitted_at)
      AND ((scope_level='workspace' AND scope_ref=r.run_payload->>'workspaceRef' AND action_type IS NULL)
        OR (scope_level='action_type' AND scope_ref IS NULL AND action_type=NEW.action_type))
  ) SELECT count(*),min(maximum_actions_per_run),public.guide_run_sha256(jsonb_build_object('ruleHashes',jsonb_agg(canonical_hash ORDER BY canonical_hash)))
    INTO rule_count,rule_cap,rule_hash FROM exact_rules;
  IF rule_count<>2 OR rule_cap IS NULL OR rule_cap IS DISTINCT FROM NEW.maximum_actions_per_run OR rule_hash IS DISTINCT FROM NEW.autonomy_evidence_hash
    OR (SELECT count(*) FROM (SELECT DISTINCT ON (rule_ref) * FROM public.autonomy_rule_revisions WHERE workspace_id=NEW.workspace_id AND state IN ('published','disabled') ORDER BY rule_ref,revision DESC) q)<>2
  THEN RAISE EXCEPTION 'limited autonomy rule set invalid'; END IF;

  SELECT count(*) INTO reserved FROM public.p06_limited_autonomy_admissions WHERE workspace_id=NEW.workspace_id AND run_id=NEW.run_id;
  IF NEW.quota_ordinal IS DISTINCT FROM reserved+1 OR reserved>=rule_cap THEN RAISE EXCEPTION 'limited autonomy quota exhausted'; END IF;
  IF NEW.admission_hash IS DISTINCT FROM public.guide_run_sha256(NEW.admission_payload-'admissionHash') THEN RAISE EXCEPTION 'limited autonomy admission hash invalid'; END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER p06_limited_autonomy_admissions_guard BEFORE INSERT OR UPDATE OR DELETE ON public.p06_limited_autonomy_admissions
FOR EACH ROW EXECUTE FUNCTION public.p06_limited_autonomy_admission_guard();
ALTER TABLE public.p06_limited_autonomy_admissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.p06_limited_autonomy_admissions FORCE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE public.p06_limited_autonomy_admissions FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL PRIVILEGES ON FUNCTION public.p06_limited_autonomy_admission_guard() FROM PUBLIC,anon,authenticated,service_role;
