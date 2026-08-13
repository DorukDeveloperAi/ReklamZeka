ALTER TABLE "approval_policy_definition_revisions" DROP CONSTRAINT "approval_policy_definition_revisions_applicability";--> statement-breakpoint
ALTER TABLE "approval_policy_definition_revisions" ADD CONSTRAINT "approval_policy_definition_revisions_applicability" CHECK (
    ("approval_policy_definition_revisions"."action_type" = 'existing_post_promotion' and "approval_policy_definition_revisions"."risk" = 'K4')
    or ("approval_policy_definition_revisions"."action_type" = 'budget_decrease' and "approval_policy_definition_revisions"."risk" = 'K2')
    or ("approval_policy_definition_revisions"."action_type" = 'budget_increase' and "approval_policy_definition_revisions"."risk" = 'K3')
  );