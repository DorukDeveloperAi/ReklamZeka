-- PREONLY: keep unjournaled until the outer-rollback verifier and independent review pass.
-- Rename is K3 / human-approval-only. This migration does not add rename to any
-- limited-autonomy allowlist and does not create execution or Meta-write authority.

ALTER TABLE public.action_proposal_units
  DROP CONSTRAINT IF EXISTS action_proposal_units_identity;
ALTER TABLE public.action_proposal_units
  ADD CONSTRAINT action_proposal_units_identity CHECK (
    unit_ref ~ '^action_unit_[a-f0-9]{20}$'
    AND account_ref ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    AND entity_ref ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    AND requester_ref ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    AND requester_role IN ('owner', 'admin', 'operator', 'analyst', 'agent')
    AND action_type IN (
      'internal_annotation', 'status_pause', 'status_activate', 'budget_decrease', 'budget_increase',
      'existing_post_promotion', 'campaign_rename', 'adset_rename', 'ad_rename'
    )
  );

ALTER TABLE public.approval_policy_definition_revisions
  DROP CONSTRAINT IF EXISTS approval_policy_definition_revisions_applicability;
ALTER TABLE public.approval_policy_definition_revisions
  ADD CONSTRAINT approval_policy_definition_revisions_applicability CHECK (
    (action_type = 'existing_post_promotion' AND risk = 'K4')
    OR (action_type = 'budget_decrease' AND risk = 'K2')
    OR (action_type = 'budget_increase' AND risk = 'K3')
    OR (action_type = 'status_pause' AND risk = 'K2')
    OR (action_type = 'status_activate' AND risk = 'K3')
    OR (action_type = 'campaign_rename' AND risk = 'K3')
    OR (action_type = 'adset_rename' AND risk = 'K3')
    OR (action_type = 'ad_rename' AND risk = 'K3')
  );

ALTER TABLE public.action_guardrail_policy_revisions
  DROP CONSTRAINT IF EXISTS action_guardrail_policy_revisions_selector_clauses;
ALTER TABLE public.action_guardrail_policy_revisions
  ADD CONSTRAINT action_guardrail_policy_revisions_selector_clauses CHECK (
    jsonb_typeof(action_types) = 'array'
    AND jsonb_array_length(action_types) BETWEEN 1 AND 8
    AND NOT jsonb_path_exists(
      action_types,
      '$[*] ? (@ != "status_pause" && @ != "status_activate" && @ != "budget_decrease" && @ != "budget_increase" && @ != "existing_post_promotion" && @ != "campaign_rename" && @ != "adset_rename" && @ != "ad_rename")'
    )
    AND jsonb_typeof(account_refs) = 'array' AND jsonb_array_length(account_refs) <= 500
    AND jsonb_typeof(campaign_refs) = 'array' AND jsonb_array_length(campaign_refs) <= 500
    AND jsonb_typeof(entities) = 'array' AND jsonb_array_length(entities) <= 500
    AND jsonb_typeof(internal_category_refs) = 'array' AND jsonb_array_length(internal_category_refs) <= 500
    AND jsonb_typeof(geo_refs) = 'array' AND jsonb_array_length(geo_refs) <= 500
    AND jsonb_typeof(clauses) = 'array' AND jsonb_array_length(clauses) <= 500
    AND jsonb_typeof(source_guidance_refs) = 'array' AND jsonb_array_length(source_guidance_refs) <= 500
  );
