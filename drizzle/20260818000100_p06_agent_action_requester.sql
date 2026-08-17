-- P06 PREONLY. Additive compatibility: existing queue rows and hashes are unchanged.
ALTER TABLE action_proposal_units DROP CONSTRAINT IF EXISTS action_proposal_units_identity;
ALTER TABLE action_proposal_units ADD CONSTRAINT action_proposal_units_identity CHECK (
  unit_ref ~ '^action_unit_[a-f0-9]{20}$'
  AND account_ref ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
  AND entity_ref ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
  AND requester_ref ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
  AND requester_role IN ('owner','admin','operator','analyst','agent')
  AND action_type IN ('internal_annotation','status_pause','status_activate','budget_decrease','budget_increase','existing_post_promotion')
);
ALTER TABLE approval_policy_definition_revisions DROP CONSTRAINT IF EXISTS approval_policy_definition_revisions_applicability;
ALTER TABLE approval_policy_definition_revisions ADD CONSTRAINT approval_policy_definition_revisions_applicability CHECK (
  (action_type='existing_post_promotion' AND risk='K4') OR (action_type='budget_decrease' AND risk='K2') OR (action_type='budget_increase' AND risk='K3')
  OR (action_type='status_pause' AND risk='K2') OR (action_type='status_activate' AND risk='K3')
);
