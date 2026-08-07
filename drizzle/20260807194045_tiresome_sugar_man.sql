CREATE TABLE "autonomy_rule_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"rule_ref" text NOT NULL,
	"revision" integer NOT NULL,
	"schema_version" text NOT NULL,
	"workspace_ref" text NOT NULL,
	"scope_level" text NOT NULL,
	"scope_ref" text,
	"entity_level" text,
	"action_type" text,
	"mode" text NOT NULL,
	"state" text NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"kill_switch" boolean DEFAULT false NOT NULL,
	"maximum_actions_per_run" integer,
	"normalized_by_actor_ref" text NOT NULL,
	"normalized_by_role" text NOT NULL,
	"source_guidance_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"published_by_actor_ref" text,
	"published_by_role" text,
	"publication_decision_ref" text,
	"publication_reason_ref" text,
	"published_at" timestamp with time zone,
	"canonical_hash" text NOT NULL,
	"artifact_payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "autonomy_rule_revisions_identity" CHECK (
    "autonomy_rule_revisions"."revision" >= 1 and "autonomy_rule_revisions"."revision" <= 1000000
    and "autonomy_rule_revisions"."schema_version" = 'autonomy-rule-artifact/1.0.0'
    and "autonomy_rule_revisions"."rule_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and "autonomy_rule_revisions"."workspace_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and "autonomy_rule_revisions"."normalized_by_actor_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and "autonomy_rule_revisions"."canonical_hash" ~ '^[a-f0-9]{64}$'
  ),
	CONSTRAINT "autonomy_rule_revisions_mode_state" CHECK (
    "autonomy_rule_revisions"."mode" in ('denied', 'approval_only', 'policy_limited')
    and "autonomy_rule_revisions"."state" in ('draft', 'published', 'disabled')
    and "autonomy_rule_revisions"."normalized_by_role" in ('owner', 'admin', 'analyst')
    and ("autonomy_rule_revisions"."maximum_actions_per_run" is null or "autonomy_rule_revisions"."maximum_actions_per_run" between 1 and 1000000)
    and (not "autonomy_rule_revisions"."kill_switch" or "autonomy_rule_revisions"."mode" = 'denied')
    and ("autonomy_rule_revisions"."expires_at" is null or "autonomy_rule_revisions"."expires_at" > "autonomy_rule_revisions"."effective_from")
  ),
	CONSTRAINT "autonomy_rule_revisions_scope" CHECK (
    ("autonomy_rule_revisions"."scope_level" = 'action_type' and "autonomy_rule_revisions"."scope_ref" is null and "autonomy_rule_revisions"."entity_level" is null
      and "autonomy_rule_revisions"."action_type" in ('no_change', 'internal_annotation', 'status_pause', 'status_activate',
        'budget_decrease', 'budget_increase', 'existing_post_promotion'))
    or ("autonomy_rule_revisions"."scope_level" = 'entity' and "autonomy_rule_revisions"."scope_ref" is not null
      and "autonomy_rule_revisions"."entity_level" in ('campaign', 'adset', 'ad') and "autonomy_rule_revisions"."action_type" is null)
    or ("autonomy_rule_revisions"."scope_level" in ('workspace', 'account_group', 'account', 'internal_category', 'campaign')
      and "autonomy_rule_revisions"."scope_ref" is not null and "autonomy_rule_revisions"."entity_level" is null and "autonomy_rule_revisions"."action_type" is null
      and ("autonomy_rule_revisions"."scope_level" <> 'workspace' or "autonomy_rule_revisions"."scope_ref" = "autonomy_rule_revisions"."workspace_ref"))
  ),
	CONSTRAINT "autonomy_rule_revisions_publication" CHECK (
    ("autonomy_rule_revisions"."state" = 'draft' and "autonomy_rule_revisions"."published_by_actor_ref" is null and "autonomy_rule_revisions"."published_by_role" is null
      and "autonomy_rule_revisions"."publication_decision_ref" is null and "autonomy_rule_revisions"."publication_reason_ref" is null and "autonomy_rule_revisions"."published_at" is null)
    or ("autonomy_rule_revisions"."state" in ('published', 'disabled') and "autonomy_rule_revisions"."published_by_actor_ref" is not null
      and "autonomy_rule_revisions"."published_by_role" in ('owner', 'admin') and "autonomy_rule_revisions"."publication_decision_ref" is not null
      and "autonomy_rule_revisions"."publication_reason_ref" is not null and "autonomy_rule_revisions"."published_at" is not null)
  ),
	CONSTRAINT "autonomy_rule_revisions_guidance_metadata" CHECK (
    jsonb_typeof("autonomy_rule_revisions"."source_guidance_refs") = 'array'
    and jsonb_array_length("autonomy_rule_revisions"."source_guidance_refs") <= 100
  ),
	CONSTRAINT "autonomy_rule_revisions_payload_exact" CHECK (
    jsonb_typeof("autonomy_rule_revisions"."artifact_payload") = 'object'
    and "autonomy_rule_revisions"."artifact_payload" #>> '{version}' = "autonomy_rule_revisions"."schema_version"
    and "autonomy_rule_revisions"."artifact_payload" #>> '{ruleRef}' = "autonomy_rule_revisions"."rule_ref"
    and ("autonomy_rule_revisions"."artifact_payload" #>> '{revision}')::integer = "autonomy_rule_revisions"."revision"
    and "autonomy_rule_revisions"."artifact_payload" #>> '{workspaceRef}' = "autonomy_rule_revisions"."workspace_ref"
    and "autonomy_rule_revisions"."artifact_payload" #>> '{scope,level}' = "autonomy_rule_revisions"."scope_level"
    and ("autonomy_rule_revisions"."artifact_payload" #>> '{scope,ref}') is not distinct from "autonomy_rule_revisions"."scope_ref"
    and ("autonomy_rule_revisions"."artifact_payload" #>> '{scope,entityLevel}') is not distinct from "autonomy_rule_revisions"."entity_level"
    and ("autonomy_rule_revisions"."artifact_payload" #>> '{scope,actionType}') is not distinct from "autonomy_rule_revisions"."action_type"
    and "autonomy_rule_revisions"."artifact_payload" #>> '{mode}' = "autonomy_rule_revisions"."mode"
    and "autonomy_rule_revisions"."artifact_payload" #>> '{state}' = "autonomy_rule_revisions"."state"
    and ("autonomy_rule_revisions"."artifact_payload" #>> '{effectiveFrom}')::timestamptz = "autonomy_rule_revisions"."effective_from"
    and ("autonomy_rule_revisions"."artifact_payload" #>> '{expiresAt}')::timestamptz is not distinct from "autonomy_rule_revisions"."expires_at"
    and ("autonomy_rule_revisions"."artifact_payload" #>> '{killSwitch}')::boolean = "autonomy_rule_revisions"."kill_switch"
    and ("autonomy_rule_revisions"."artifact_payload" #>> '{maximumActionsPerRun}')::integer is not distinct from "autonomy_rule_revisions"."maximum_actions_per_run"
    and "autonomy_rule_revisions"."artifact_payload" #>> '{provenance,normalizedByActorRef}' = "autonomy_rule_revisions"."normalized_by_actor_ref"
    and "autonomy_rule_revisions"."artifact_payload" #>> '{provenance,normalizedByRole}' = "autonomy_rule_revisions"."normalized_by_role"
    and "autonomy_rule_revisions"."artifact_payload" #> '{provenance,sourceGuidanceRefs}' = "autonomy_rule_revisions"."source_guidance_refs"
    and ("autonomy_rule_revisions"."artifact_payload" #>> '{provenance,publishedByActorRef}') is not distinct from "autonomy_rule_revisions"."published_by_actor_ref"
    and ("autonomy_rule_revisions"."artifact_payload" #>> '{provenance,publishedByRole}') is not distinct from "autonomy_rule_revisions"."published_by_role"
    and ("autonomy_rule_revisions"."artifact_payload" #>> '{provenance,publicationDecisionRef}') is not distinct from "autonomy_rule_revisions"."publication_decision_ref"
    and ("autonomy_rule_revisions"."artifact_payload" #>> '{provenance,publicationReasonRef}') is not distinct from "autonomy_rule_revisions"."publication_reason_ref"
    and ("autonomy_rule_revisions"."artifact_payload" #>> '{provenance,publishedAt}')::timestamptz is not distinct from "autonomy_rule_revisions"."published_at"
    and "autonomy_rule_revisions"."artifact_payload" #>> '{canonicalHash}' = "autonomy_rule_revisions"."canonical_hash"
    and "autonomy_rule_revisions"."artifact_payload" #>> '{authority,canExecute}' = 'false'
    and "autonomy_rule_revisions"."artifact_payload" #>> '{authority,canWriteMeta}' = 'false'
    and "autonomy_rule_revisions"."artifact_payload" #>> '{authority,canGrantApproval}' = 'false'
    and "autonomy_rule_revisions"."artifact_payload" #>> '{authority,canPromoteGuidance}' = 'false'
  ),
	CONSTRAINT "autonomy_rule_revisions_no_forbidden_material" CHECK (
    "autonomy_rule_revisions"."artifact_payload"::text
      !~* '"[^"[:space:]]*(token|secret|prompt|raw[_-]?(payload|request|response|json)|free[_-]?text)"[[:space:]]*:'
  )
);
--> statement-breakpoint
ALTER TABLE "autonomy_rule_revisions" ADD CONSTRAINT "autonomy_rule_revisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "autonomy_rule_revisions_workspace_row_unique" ON "autonomy_rule_revisions" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "autonomy_rule_revisions_workspace_ref_revision_unique" ON "autonomy_rule_revisions" USING btree ("workspace_id","rule_ref","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "autonomy_rule_revisions_workspace_hash_unique" ON "autonomy_rule_revisions" USING btree ("workspace_id","canonical_hash");--> statement-breakpoint
CREATE INDEX "autonomy_rule_revisions_workspace_state_ref_revision_idx" ON "autonomy_rule_revisions" USING btree ("workspace_id","state","rule_ref","revision");--> statement-breakpoint
ALTER TABLE autonomy_rule_revisions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE autonomy_rule_revisions FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE autonomy_rule_revisions FROM PUBLIC, anon, authenticated;--> statement-breakpoint
CREATE POLICY autonomy_rule_revisions_tenant_select ON autonomy_rule_revisions
FOR SELECT TO authenticated
USING (exists (
  select 1 from memberships membership
  where membership.workspace_id = autonomy_rule_revisions.workspace_id
    and membership.user_id = (select auth.uid())
));--> statement-breakpoint
CREATE FUNCTION autonomy_rule_registry_append_only() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'autonomy_rule_registry_append_only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER autonomy_rule_revisions_append_only_trigger
BEFORE UPDATE ON autonomy_rule_revisions
FOR EACH ROW EXECUTE FUNCTION autonomy_rule_registry_append_only();--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION autonomy_rule_registry_append_only() FROM PUBLIC, anon, authenticated;
