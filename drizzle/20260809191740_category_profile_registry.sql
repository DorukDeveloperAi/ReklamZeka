CREATE TABLE "category_profile_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"category_definition_id" uuid NOT NULL,
	"parent_category_definition_id" uuid,
	"workspace_ref" text NOT NULL,
	"profile_ref" text NOT NULL,
	"category_ref" text NOT NULL,
	"parent_category_ref" text,
	"schema_version" text NOT NULL,
	"version" integer NOT NULL,
	"previous_profile_hash" text,
	"label" text NOT NULL,
	"description" text NOT NULL,
	"color" text NOT NULL,
	"owner_ref" text NOT NULL,
	"status" text NOT NULL,
	"profile_hash" text NOT NULL,
	"profile_payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "category_profile_revisions_identity" CHECK (
    "category_profile_revisions"."schema_version" = 'category-profile/1.0.0'
    and "category_profile_revisions"."version" between 1 and 1000000
    and "category_profile_revisions"."workspace_ref" ~ '^workspace_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and "category_profile_revisions"."profile_ref" ~ '^category_profile_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and "category_profile_revisions"."category_ref" ~ '^category_[a-f0-9]{24}$'
    and ("category_profile_revisions"."parent_category_ref" is null or "category_profile_revisions"."parent_category_ref" ~ '^category_[a-f0-9]{24}$')
    and (("category_profile_revisions"."parent_category_definition_id" is null and "category_profile_revisions"."parent_category_ref" is null)
      or ("category_profile_revisions"."parent_category_definition_id" is not null and "category_profile_revisions"."parent_category_ref" is not null))
    and "category_profile_revisions"."category_definition_id" is distinct from "category_profile_revisions"."parent_category_definition_id"
    and "category_profile_revisions"."owner_ref" ~ '^actor_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and "category_profile_revisions"."color" ~ '^#[0-9A-F]{6}$'
    and "category_profile_revisions"."profile_hash" ~ '^[a-f0-9]{64}$'
    and (("category_profile_revisions"."version" = 1 and "category_profile_revisions"."previous_profile_hash" is null)
      or ("category_profile_revisions"."version" > 1 and "category_profile_revisions"."previous_profile_hash" ~ '^[a-f0-9]{64}$'))
    and "category_profile_revisions"."status" in ('draft', 'active', 'paused', 'archived')
  ),
	CONSTRAINT "category_profile_revisions_payload_exact" CHECK ((
    jsonb_typeof("category_profile_revisions"."profile_payload") = 'object'
    and "category_profile_revisions"."profile_payload" #>> '{schemaVersion}' = "category_profile_revisions"."schema_version"
    and "category_profile_revisions"."profile_payload" #>> '{workspaceRef}' = "category_profile_revisions"."workspace_ref"
    and "category_profile_revisions"."profile_payload" #>> '{profileRef}' = "category_profile_revisions"."profile_ref"
    and "category_profile_revisions"."profile_payload" #>> '{categoryRef}' = "category_profile_revisions"."category_ref"
    and ("category_profile_revisions"."profile_payload" #>> '{parentCategoryRef}') is not distinct from "category_profile_revisions"."parent_category_ref"
    and ("category_profile_revisions"."profile_payload" #>> '{version}')::integer = "category_profile_revisions"."version"
    and ("category_profile_revisions"."profile_payload" #>> '{previousProfileHash}') is not distinct from "category_profile_revisions"."previous_profile_hash"
    and "category_profile_revisions"."profile_payload" #>> '{label}' = "category_profile_revisions"."label"
    and "category_profile_revisions"."profile_payload" #>> '{description}' = "category_profile_revisions"."description"
    and "category_profile_revisions"."profile_payload" #>> '{color}' = "category_profile_revisions"."color"
    and "category_profile_revisions"."profile_payload" #>> '{ownerRef}' = "category_profile_revisions"."owner_ref"
    and "category_profile_revisions"."profile_payload" #>> '{status}' = "category_profile_revisions"."status"
    and "category_profile_revisions"."profile_payload" #>> '{profileHash}' = "category_profile_revisions"."profile_hash"
    and "category_profile_revisions"."profile_payload" #> '{authority,canAuthorizeAction}' = 'false'::jsonb
    and "category_profile_revisions"."profile_payload" #> '{authority,canExecuteWrite}' = 'false'::jsonb
    and "category_profile_revisions"."profile_payload" #> '{authority,canWriteMeta}' = 'false'::jsonb
    and "category_profile_revisions"."profile_payload" #> '{authority,canGrantApproval}' = 'false'::jsonb
  ) is true),
	CONSTRAINT "category_profile_revisions_bindings" CHECK ((
    jsonb_typeof("category_profile_revisions"."profile_payload" #> '{bindings}') = 'object'
    and jsonb_typeof("category_profile_revisions"."profile_payload" #> '{bindings,analysisPlaybookRefs}') = 'array'
    and jsonb_array_length("category_profile_revisions"."profile_payload" #> '{bindings,analysisPlaybookRefs}') between 1 and 64
    and jsonb_typeof("category_profile_revisions"."profile_payload" #> '{bindings,ruleInstructionBundleRefs}') = 'array'
    and jsonb_array_length("category_profile_revisions"."profile_payload" #> '{bindings,ruleInstructionBundleRefs}') <= 64
    and jsonb_typeof("category_profile_revisions"."profile_payload" #> '{bindings,budgetPolicyRefs}') = 'array'
    and jsonb_array_length("category_profile_revisions"."profile_payload" #> '{bindings,budgetPolicyRefs}') <= 64
    and jsonb_typeof("category_profile_revisions"."profile_payload" #> '{bindings,transferPolicyRefs}') = 'array'
    and jsonb_array_length("category_profile_revisions"."profile_payload" #> '{bindings,transferPolicyRefs}') <= 64
    and jsonb_typeof("category_profile_revisions"."profile_payload" #> '{bindings,schedulePolicyRefs}') = 'array'
    and jsonb_array_length("category_profile_revisions"."profile_payload" #> '{bindings,schedulePolicyRefs}') <= 64
    and jsonb_typeof("category_profile_revisions"."profile_payload" #> '{bindings,actionPolicyRefs}') = 'array'
    and jsonb_array_length("category_profile_revisions"."profile_payload" #> '{bindings,actionPolicyRefs}') <= 64
    and jsonb_typeof("category_profile_revisions"."profile_payload" #> '{bindings,creativePolicyRefs}') = 'array'
    and jsonb_array_length("category_profile_revisions"."profile_payload" #> '{bindings,creativePolicyRefs}') <= 64
    and not jsonb_path_exists("category_profile_revisions"."profile_payload", '$.bindings.analysisPlaybookRefs[*] ? (!(@ like_regex "^analysis_playbook_[a-z0-9][a-z0-9_.:-]{0,126}$"))')
    and not jsonb_path_exists("category_profile_revisions"."profile_payload", '$.bindings.ruleInstructionBundleRefs[*] ? (!(@ like_regex "^(instruction_bundle_|rule_bundle_)[a-z0-9][a-z0-9_.:-]{0,126}$"))')
    and not jsonb_path_exists("category_profile_revisions"."profile_payload", '$.bindings.budgetPolicyRefs[*] ? (!(@ like_regex "^(budget_policy_|budget_envelope_)[a-z0-9][a-z0-9_.:-]{0,126}$"))')
    and not jsonb_path_exists("category_profile_revisions"."profile_payload", '$.bindings.transferPolicyRefs[*] ? (!(@ like_regex "^transfer_policy_[a-z0-9][a-z0-9_.:-]{0,126}$"))')
    and not jsonb_path_exists("category_profile_revisions"."profile_payload", '$.bindings.schedulePolicyRefs[*] ? (!(@ like_regex "^(schedule_policy_|cadence_profile_)[a-z0-9][a-z0-9_.:-]{0,126}$"))')
    and not jsonb_path_exists("category_profile_revisions"."profile_payload", '$.bindings.actionPolicyRefs[*] ? (!(@ like_regex "^(action_policy_|approval_policy_|guardrail_|autonomy_rule_)[a-z0-9][a-z0-9_.:-]{0,126}$"))')
    and not jsonb_path_exists("category_profile_revisions"."profile_payload", '$.bindings.creativePolicyRefs[*] ? (!(@ like_regex "^creative_policy_[a-z0-9][a-z0-9_.:-]{0,126}$"))')
  ) is true),
	CONSTRAINT "category_profile_revisions_no_forbidden_material" CHECK (
    "category_profile_revisions"."profile_payload"::text !~* '"[^"[:space:]]*(token|secret|prompt|raw[_-]?(payload|request|response|json)|authorization|approvalgranted)"[[:space:]]*:'
    and "category_profile_revisions"."profile_payload"::text !~* '[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'
    and "category_profile_revisions"."profile_payload"::text !~* '"(canAuthorizeAction|canExecuteWrite|canWriteMeta|canGrantApproval)"[[:space:]]*:[[:space:]]*true'
  )
);
--> statement-breakpoint
ALTER TABLE "effective_campaign_context_components" DROP CONSTRAINT "effective_campaign_context_components_type";--> statement-breakpoint
ALTER TABLE "effective_campaign_context_invalidations" DROP CONSTRAINT "effective_campaign_context_invalidations_type";--> statement-breakpoint
ALTER TABLE "category_profile_revisions" ADD CONSTRAINT "category_profile_revisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_profile_revisions" ADD CONSTRAINT "category_profile_revisions_definition_scope_fk" FOREIGN KEY ("workspace_id","category_definition_id") REFERENCES "public"."category_definitions"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_profile_revisions" ADD CONSTRAINT "category_profile_revisions_parent_scope_fk" FOREIGN KEY ("workspace_id","parent_category_definition_id") REFERENCES "public"."category_definitions"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "category_profile_revisions_workspace_row_unique" ON "category_profile_revisions" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "category_profile_revisions_workspace_profile_version_unique" ON "category_profile_revisions" USING btree ("workspace_id","profile_ref","version");--> statement-breakpoint
CREATE UNIQUE INDEX "category_profile_revisions_workspace_definition_version_unique" ON "category_profile_revisions" USING btree ("workspace_id","category_definition_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "category_profile_revisions_workspace_hash_unique" ON "category_profile_revisions" USING btree ("workspace_id","profile_hash");--> statement-breakpoint
CREATE INDEX "category_profile_revisions_latest_idx" ON "category_profile_revisions" USING btree ("workspace_id","profile_ref","version");--> statement-breakpoint
CREATE INDEX "category_profile_revisions_definition_idx" ON "category_profile_revisions" USING btree ("workspace_id","category_definition_id","version");--> statement-breakpoint
ALTER TABLE "effective_campaign_context_components" ADD CONSTRAINT "effective_campaign_context_components_type" CHECK ("effective_campaign_context_components"."component_type" in (
    'source_snapshot', 'category_resolution', 'category_profile', 'guidance_pack', 'meta_catalog',
    'category_resolver', 'guidance_registry', 'metric_catalog', 'formula_catalog',
    'timeframe_resolver'
  ));--> statement-breakpoint
ALTER TABLE "effective_campaign_context_invalidations" ADD CONSTRAINT "effective_campaign_context_invalidations_type" CHECK ("effective_campaign_context_invalidations"."component_type" in (
    'source_snapshot', 'category_resolution', 'category_profile', 'guidance_pack', 'meta_catalog',
    'category_resolver', 'guidance_registry', 'metric_catalog', 'formula_catalog',
    'timeframe_resolver'
  ));--> statement-breakpoint

ALTER TABLE category_profile_revisions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE category_profile_revisions FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE category_profile_revisions FROM PUBLIC, anon, authenticated, service_role;--> statement-breakpoint

CREATE POLICY category_profile_revisions_tenant_select
ON category_profile_revisions FOR SELECT
TO authenticated
USING (
  (select auth.uid()) is not null
  and exists (
    select 1 from memberships membership
    where membership.workspace_id = category_profile_revisions.workspace_id
      and membership.user_id = (select auth.uid())
  )
);--> statement-breakpoint

CREATE OR REPLACE FUNCTION category_profile_revisions_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'category profile revisions are append-only';
END;
$$;--> statement-breakpoint

CREATE TRIGGER category_profile_revisions_append_only_trigger
BEFORE UPDATE ON category_profile_revisions
FOR EACH ROW EXECUTE FUNCTION category_profile_revisions_append_only();--> statement-breakpoint

REVOKE ALL PRIVILEGES ON FUNCTION category_profile_revisions_append_only() FROM PUBLIC, anon, authenticated, service_role;
