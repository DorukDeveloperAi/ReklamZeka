CREATE TABLE "approval_policy_definition_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"workspace_ref" text NOT NULL,
	"policy_ref" text NOT NULL,
	"revision" integer NOT NULL,
	"previous_hash" text,
	"schema_version" text NOT NULL,
	"action_type" text NOT NULL,
	"risk" text NOT NULL,
	"state" text NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"normalized_by_actor_ref" text NOT NULL,
	"normalized_by_role" text NOT NULL,
	"published_by_actor_ref" text,
	"published_by_role" text,
	"publication_decision_ref" text,
	"publication_reason_ref" text,
	"published_at" timestamp with time zone,
	"disabled_by_actor_ref" text,
	"disabled_by_role" text,
	"disable_decision_ref" text,
	"disable_reason_ref" text,
	"disabled_at" timestamp with time zone,
	"policy_hash" text NOT NULL,
	"canonical_hash" text NOT NULL,
	"policy_payload" jsonb NOT NULL,
	"artifact_payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "approval_policy_definition_revisions_identity" CHECK (
    "approval_policy_definition_revisions"."schema_version" = 'approval-policy-definition/1.0.0'
    and "approval_policy_definition_revisions"."revision" between 1 and 1000000
    and "approval_policy_definition_revisions"."workspace_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and "approval_policy_definition_revisions"."policy_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and "approval_policy_definition_revisions"."normalized_by_actor_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and (("approval_policy_definition_revisions"."revision" = 1 and "approval_policy_definition_revisions"."previous_hash" is null)
      or ("approval_policy_definition_revisions"."revision" > 1 and "approval_policy_definition_revisions"."previous_hash" ~ '^[a-f0-9]{64}$'))
    and "approval_policy_definition_revisions"."policy_hash" ~ '^[a-f0-9]{64}$' and "approval_policy_definition_revisions"."canonical_hash" ~ '^[a-f0-9]{64}$'
  ),
	CONSTRAINT "approval_policy_definition_revisions_applicability" CHECK (
    "approval_policy_definition_revisions"."action_type" = 'existing_post_promotion' and "approval_policy_definition_revisions"."risk" = 'K4'
  ),
	CONSTRAINT "approval_policy_definition_revisions_lifecycle" CHECK (
    "approval_policy_definition_revisions"."state" in ('draft', 'published', 'disabled')
    and "approval_policy_definition_revisions"."normalized_by_role" in ('owner', 'admin', 'analyst')
    and ("approval_policy_definition_revisions"."expires_at" is null or "approval_policy_definition_revisions"."expires_at" > "approval_policy_definition_revisions"."effective_from")
    and (("approval_policy_definition_revisions"."state" = 'draft' and "approval_policy_definition_revisions"."published_by_actor_ref" is null and "approval_policy_definition_revisions"."published_by_role" is null
      and "approval_policy_definition_revisions"."publication_decision_ref" is null and "approval_policy_definition_revisions"."publication_reason_ref" is null and "approval_policy_definition_revisions"."published_at" is null
      and "approval_policy_definition_revisions"."disabled_by_actor_ref" is null and "approval_policy_definition_revisions"."disabled_by_role" is null
      and "approval_policy_definition_revisions"."disable_decision_ref" is null and "approval_policy_definition_revisions"."disable_reason_ref" is null and "approval_policy_definition_revisions"."disabled_at" is null)
      or ("approval_policy_definition_revisions"."state" = 'published' and "approval_policy_definition_revisions"."published_by_actor_ref" is not null
        and "approval_policy_definition_revisions"."published_by_role" in ('owner', 'admin') and "approval_policy_definition_revisions"."publication_decision_ref" is not null
        and "approval_policy_definition_revisions"."publication_reason_ref" is not null and "approval_policy_definition_revisions"."published_at" is not null
        and "approval_policy_definition_revisions"."disabled_by_actor_ref" is null and "approval_policy_definition_revisions"."disabled_by_role" is null
        and "approval_policy_definition_revisions"."disable_decision_ref" is null and "approval_policy_definition_revisions"."disable_reason_ref" is null and "approval_policy_definition_revisions"."disabled_at" is null)
      or ("approval_policy_definition_revisions"."state" = 'disabled' and "approval_policy_definition_revisions"."published_by_actor_ref" is not null
        and "approval_policy_definition_revisions"."published_by_role" in ('owner', 'admin') and "approval_policy_definition_revisions"."publication_decision_ref" is not null
        and "approval_policy_definition_revisions"."publication_reason_ref" is not null and "approval_policy_definition_revisions"."published_at" is not null
        and "approval_policy_definition_revisions"."disabled_by_actor_ref" is not null and "approval_policy_definition_revisions"."disabled_by_role" in ('owner', 'admin')
        and "approval_policy_definition_revisions"."disable_decision_ref" is not null and "approval_policy_definition_revisions"."disable_reason_ref" is not null
        and "approval_policy_definition_revisions"."disabled_at" is not null and "approval_policy_definition_revisions"."disabled_at" >= "approval_policy_definition_revisions"."published_at"))
  ),
	CONSTRAINT "approval_policy_definition_revisions_policy_exact" CHECK (
    jsonb_typeof("approval_policy_definition_revisions"."policy_payload") = 'object'
    and "approval_policy_definition_revisions"."policy_payload" #>> '{version}' = 'action-approval-policy/1.0.0'
    and "approval_policy_definition_revisions"."policy_payload" #>> '{policyRef}' = "approval_policy_definition_revisions"."policy_ref"
    and ("approval_policy_definition_revisions"."policy_payload" #>> '{revision}')::integer = "approval_policy_definition_revisions"."revision"
    and "approval_policy_definition_revisions"."policy_payload" #>> '{autonomyMode}' = 'approval_only'
    and jsonb_typeof("approval_policy_definition_revisions"."policy_payload" #> '{requesterRoles}') = 'array'
    and jsonb_typeof("approval_policy_definition_revisions"."policy_payload" #> '{approverRoles}') = 'array'
    and jsonb_typeof("approval_policy_definition_revisions"."policy_payload" #> '{grantConsumerRoles}') = 'array'
    and jsonb_typeof("approval_policy_definition_revisions"."policy_payload" #> '{separationOfDutiesRisks}') = 'array'
    and ("approval_policy_definition_revisions"."policy_payload" #>> '{maximumGrantLifetimeSeconds}')::integer between 1 and 86400
  ),
	CONSTRAINT "approval_policy_definition_revisions_artifact_exact" CHECK (
    jsonb_typeof("approval_policy_definition_revisions"."artifact_payload") = 'object'
    and "approval_policy_definition_revisions"."artifact_payload" #>> '{version}' = "approval_policy_definition_revisions"."schema_version"
    and "approval_policy_definition_revisions"."artifact_payload" #>> '{workspaceRef}' = "approval_policy_definition_revisions"."workspace_ref"
    and "approval_policy_definition_revisions"."artifact_payload" #>> '{policyRef}' = "approval_policy_definition_revisions"."policy_ref"
    and ("approval_policy_definition_revisions"."artifact_payload" #>> '{revision}')::integer = "approval_policy_definition_revisions"."revision"
    and ("approval_policy_definition_revisions"."artifact_payload" #>> '{previousHash}') is not distinct from "approval_policy_definition_revisions"."previous_hash"
    and "approval_policy_definition_revisions"."artifact_payload" #>> '{applicability,actionType}' = "approval_policy_definition_revisions"."action_type"
    and "approval_policy_definition_revisions"."artifact_payload" #>> '{applicability,risk}' = "approval_policy_definition_revisions"."risk"
    and "approval_policy_definition_revisions"."artifact_payload" #>> '{state}' = "approval_policy_definition_revisions"."state"
    and ("approval_policy_definition_revisions"."artifact_payload" #>> '{effectiveFrom}')::timestamptz = "approval_policy_definition_revisions"."effective_from"
    and ("approval_policy_definition_revisions"."artifact_payload" #>> '{expiresAt}')::timestamptz is not distinct from "approval_policy_definition_revisions"."expires_at"
    and "approval_policy_definition_revisions"."artifact_payload" #> '{policy}' = "approval_policy_definition_revisions"."policy_payload"
    and "approval_policy_definition_revisions"."artifact_payload" #>> '{policyHash}' = "approval_policy_definition_revisions"."policy_hash"
    and "approval_policy_definition_revisions"."artifact_payload" #>> '{canonicalHash}' = "approval_policy_definition_revisions"."canonical_hash"
    and "approval_policy_definition_revisions"."artifact_payload" #>> '{provenance,normalizedByActorRef}' = "approval_policy_definition_revisions"."normalized_by_actor_ref"
    and "approval_policy_definition_revisions"."artifact_payload" #>> '{provenance,normalizedByRole}' = "approval_policy_definition_revisions"."normalized_by_role"
    and ("approval_policy_definition_revisions"."artifact_payload" #>> '{provenance,publishedByActorRef}') is not distinct from "approval_policy_definition_revisions"."published_by_actor_ref"
    and ("approval_policy_definition_revisions"."artifact_payload" #>> '{provenance,publishedByRole}') is not distinct from "approval_policy_definition_revisions"."published_by_role"
    and ("approval_policy_definition_revisions"."artifact_payload" #>> '{provenance,publicationDecisionRef}') is not distinct from "approval_policy_definition_revisions"."publication_decision_ref"
    and ("approval_policy_definition_revisions"."artifact_payload" #>> '{provenance,publicationReasonRef}') is not distinct from "approval_policy_definition_revisions"."publication_reason_ref"
    and ("approval_policy_definition_revisions"."artifact_payload" #>> '{provenance,publishedAt}')::timestamptz is not distinct from "approval_policy_definition_revisions"."published_at"
    and ("approval_policy_definition_revisions"."artifact_payload" #>> '{provenance,disabledByActorRef}') is not distinct from "approval_policy_definition_revisions"."disabled_by_actor_ref"
    and ("approval_policy_definition_revisions"."artifact_payload" #>> '{provenance,disabledByRole}') is not distinct from "approval_policy_definition_revisions"."disabled_by_role"
    and ("approval_policy_definition_revisions"."artifact_payload" #>> '{provenance,disableDecisionRef}') is not distinct from "approval_policy_definition_revisions"."disable_decision_ref"
    and ("approval_policy_definition_revisions"."artifact_payload" #>> '{provenance,disableReasonRef}') is not distinct from "approval_policy_definition_revisions"."disable_reason_ref"
    and ("approval_policy_definition_revisions"."artifact_payload" #>> '{provenance,disabledAt}')::timestamptz is not distinct from "approval_policy_definition_revisions"."disabled_at"
    and "approval_policy_definition_revisions"."artifact_payload" #>> '{authority,canApprove}' = 'false'
    and "approval_policy_definition_revisions"."artifact_payload" #>> '{authority,canGrant}' = 'false'
    and "approval_policy_definition_revisions"."artifact_payload" #>> '{authority,canExecute}' = 'false'
    and "approval_policy_definition_revisions"."artifact_payload" #>> '{authority,canWriteMeta}' = 'false'
    and "approval_policy_definition_revisions"."artifact_payload" #>> '{authority,canPromoteGuidance}' = 'false'
  ),
	CONSTRAINT "approval_policy_definition_revisions_no_forbidden_material" CHECK (
    ("approval_policy_definition_revisions"."policy_payload"::text || "approval_policy_definition_revisions"."artifact_payload"::text)
      !~* '"[^"[:space:]]*(token|secret|prompt|raw[_-]?(payload|request|response|json)|free[_-]?text|authorization|approvalgranted)"[[:space:]]*:'
  )
);
--> statement-breakpoint
ALTER TABLE "approval_policy_definition_revisions" ADD CONSTRAINT "approval_policy_definition_revisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "approval_policy_definition_revisions_workspace_row_unique" ON "approval_policy_definition_revisions" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_policy_definition_revisions_workspace_ref_revision_unique" ON "approval_policy_definition_revisions" USING btree ("workspace_id","policy_ref","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "approval_policy_definition_revisions_workspace_hash_unique" ON "approval_policy_definition_revisions" USING btree ("workspace_id","canonical_hash");--> statement-breakpoint
CREATE INDEX "approval_policy_definition_revisions_resolve_idx" ON "approval_policy_definition_revisions" USING btree ("workspace_id","action_type","risk","state","policy_ref","revision");--> statement-breakpoint
ALTER TABLE approval_policy_definition_revisions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE approval_policy_definition_revisions FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE approval_policy_definition_revisions FROM PUBLIC, anon, authenticated;--> statement-breakpoint
CREATE POLICY approval_policy_definition_revisions_tenant_select ON approval_policy_definition_revisions
FOR SELECT TO authenticated
USING (exists (
  select 1 from memberships membership
  where membership.workspace_id = approval_policy_definition_revisions.workspace_id
    and membership.user_id = (select auth.uid())
));--> statement-breakpoint
CREATE FUNCTION approval_policy_definition_append_only() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'approval_policy_definition_append_only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER approval_policy_definition_revisions_append_only_trigger
BEFORE UPDATE ON approval_policy_definition_revisions
FOR EACH ROW EXECUTE FUNCTION approval_policy_definition_append_only();--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION approval_policy_definition_append_only() FROM PUBLIC, anon, authenticated;
