DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "approval_policy_definition_revisions")
    OR EXISTS (SELECT 1 FROM "action_approval_policy_snapshots") THEN
    RAISE EXCEPTION 'maximumProposalLifetimeSeconds requires an explicit reviewed policy revision; automatic backfill is forbidden';
  END IF;
END
$$;--> statement-breakpoint
ALTER TABLE "action_approval_policy_snapshots" DROP CONSTRAINT "action_approval_policy_snapshots_payload_exact";--> statement-breakpoint
ALTER TABLE "approval_policy_definition_revisions" DROP CONSTRAINT "approval_policy_definition_revisions_policy_exact";--> statement-breakpoint
ALTER TABLE "action_approval_policy_snapshots" ADD CONSTRAINT "action_approval_policy_snapshots_payload_exact" CHECK (
    jsonb_typeof("action_approval_policy_snapshots"."policy_payload") = 'object'
    and "action_approval_policy_snapshots"."policy_payload" #>> '{version}' = "action_approval_policy_snapshots"."schema_version"
    and "action_approval_policy_snapshots"."policy_payload" #>> '{policyRef}' = "action_approval_policy_snapshots"."policy_ref"
    and ("action_approval_policy_snapshots"."policy_payload" #>> '{revision}')::integer = "action_approval_policy_snapshots"."revision"
    and "action_approval_policy_snapshots"."policy_payload" #>> '{policyHash}' = "action_approval_policy_snapshots"."policy_hash"
    and "action_approval_policy_snapshots"."policy_payload" #>> '{autonomyMode}' = 'approval_only'
    and "action_approval_policy_snapshots"."policy_payload" ? 'maximumProposalLifetimeSeconds'
    and jsonb_typeof("action_approval_policy_snapshots"."policy_payload" #> '{maximumProposalLifetimeSeconds}') = 'number'
    and ("action_approval_policy_snapshots"."policy_payload" #>> '{maximumProposalLifetimeSeconds}')::integer between 1 and 604800
  );--> statement-breakpoint
ALTER TABLE "approval_policy_definition_revisions" ADD CONSTRAINT "approval_policy_definition_revisions_policy_exact" CHECK (
    jsonb_typeof("approval_policy_definition_revisions"."policy_payload") = 'object'
    and "approval_policy_definition_revisions"."policy_payload" #>> '{version}' = 'action-approval-policy/1.0.0'
    and "approval_policy_definition_revisions"."policy_payload" #>> '{policyRef}' = "approval_policy_definition_revisions"."policy_ref"
    and ("approval_policy_definition_revisions"."policy_payload" #>> '{revision}')::integer = "approval_policy_definition_revisions"."revision"
    and "approval_policy_definition_revisions"."policy_payload" #>> '{autonomyMode}' = 'approval_only'
    and jsonb_typeof("approval_policy_definition_revisions"."policy_payload" #> '{requesterRoles}') = 'array'
    and jsonb_typeof("approval_policy_definition_revisions"."policy_payload" #> '{approverRoles}') = 'array'
    and jsonb_typeof("approval_policy_definition_revisions"."policy_payload" #> '{grantConsumerRoles}') = 'array'
    and jsonb_typeof("approval_policy_definition_revisions"."policy_payload" #> '{separationOfDutiesRisks}') = 'array'
    and "approval_policy_definition_revisions"."policy_payload" ? 'maximumProposalLifetimeSeconds'
    and jsonb_typeof("approval_policy_definition_revisions"."policy_payload" #> '{maximumProposalLifetimeSeconds}') = 'number'
    and ("approval_policy_definition_revisions"."policy_payload" #>> '{maximumProposalLifetimeSeconds}')::integer between 1 and 604800
    and ("approval_policy_definition_revisions"."policy_payload" #>> '{maximumGrantLifetimeSeconds}')::integer between 1 and 86400
  );
