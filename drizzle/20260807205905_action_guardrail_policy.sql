CREATE TABLE "action_guardrail_policy_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"workspace_ref" text NOT NULL,
	"policy_ref" text NOT NULL,
	"revision" integer NOT NULL,
	"previous_hash" text,
	"schema_version" text NOT NULL,
	"state" text NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"default_disposition" text NOT NULL,
	"action_types" jsonb NOT NULL,
	"account_refs" jsonb NOT NULL,
	"campaign_refs" jsonb NOT NULL,
	"entities" jsonb NOT NULL,
	"internal_category_refs" jsonb NOT NULL,
	"geo_refs" jsonb NOT NULL,
	"clauses" jsonb NOT NULL,
	"normalized_by_actor_ref" text NOT NULL,
	"normalized_by_role" text NOT NULL,
	"source_guidance_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
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
	"canonical_hash" text NOT NULL,
	"artifact_payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "action_guardrail_policy_revisions_identity" CHECK (
    "action_guardrail_policy_revisions"."schema_version" = 'action-guardrail-policy/1.0.0'
    and "action_guardrail_policy_revisions"."revision" between 1 and 1000000
    and "action_guardrail_policy_revisions"."workspace_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and "action_guardrail_policy_revisions"."policy_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and "action_guardrail_policy_revisions"."normalized_by_actor_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and (("action_guardrail_policy_revisions"."revision" = 1 and "action_guardrail_policy_revisions"."previous_hash" is null)
      or ("action_guardrail_policy_revisions"."revision" > 1 and "action_guardrail_policy_revisions"."previous_hash" ~ '^[a-f0-9]{64}$'))
    and "action_guardrail_policy_revisions"."canonical_hash" ~ '^[a-f0-9]{64}$'
  ),
	CONSTRAINT "action_guardrail_policy_revisions_lifecycle" CHECK (
    "action_guardrail_policy_revisions"."state" in ('draft', 'published', 'disabled')
    and "action_guardrail_policy_revisions"."normalized_by_role" in ('owner', 'admin', 'analyst')
    and "action_guardrail_policy_revisions"."default_disposition" = 'allow_if_no_matching_deny'
    and ("action_guardrail_policy_revisions"."expires_at" is null or "action_guardrail_policy_revisions"."expires_at" > "action_guardrail_policy_revisions"."effective_from")
    and (("action_guardrail_policy_revisions"."state" = 'draft' and "action_guardrail_policy_revisions"."published_by_actor_ref" is null and "action_guardrail_policy_revisions"."published_by_role" is null
      and "action_guardrail_policy_revisions"."publication_decision_ref" is null and "action_guardrail_policy_revisions"."publication_reason_ref" is null and "action_guardrail_policy_revisions"."published_at" is null
      and "action_guardrail_policy_revisions"."disabled_by_actor_ref" is null and "action_guardrail_policy_revisions"."disabled_by_role" is null
      and "action_guardrail_policy_revisions"."disable_decision_ref" is null and "action_guardrail_policy_revisions"."disable_reason_ref" is null and "action_guardrail_policy_revisions"."disabled_at" is null)
      or ("action_guardrail_policy_revisions"."state" = 'published' and "action_guardrail_policy_revisions"."published_by_actor_ref" is not null
        and "action_guardrail_policy_revisions"."published_by_role" in ('owner', 'admin') and "action_guardrail_policy_revisions"."publication_decision_ref" is not null
        and "action_guardrail_policy_revisions"."publication_reason_ref" is not null and "action_guardrail_policy_revisions"."published_at" is not null
        and "action_guardrail_policy_revisions"."disabled_by_actor_ref" is null and "action_guardrail_policy_revisions"."disabled_by_role" is null
        and "action_guardrail_policy_revisions"."disable_decision_ref" is null and "action_guardrail_policy_revisions"."disable_reason_ref" is null and "action_guardrail_policy_revisions"."disabled_at" is null)
      or ("action_guardrail_policy_revisions"."state" = 'disabled' and "action_guardrail_policy_revisions"."published_by_actor_ref" is not null
        and "action_guardrail_policy_revisions"."published_by_role" in ('owner', 'admin') and "action_guardrail_policy_revisions"."publication_decision_ref" is not null
        and "action_guardrail_policy_revisions"."publication_reason_ref" is not null and "action_guardrail_policy_revisions"."published_at" is not null
        and "action_guardrail_policy_revisions"."disabled_by_actor_ref" is not null and "action_guardrail_policy_revisions"."disabled_by_role" in ('owner', 'admin')
        and "action_guardrail_policy_revisions"."disable_decision_ref" is not null and "action_guardrail_policy_revisions"."disable_reason_ref" is not null
        and "action_guardrail_policy_revisions"."disabled_at" is not null and "action_guardrail_policy_revisions"."disabled_at" >= "action_guardrail_policy_revisions"."published_at"))
  ),
	CONSTRAINT "action_guardrail_policy_revisions_selector_clauses" CHECK (
    jsonb_typeof("action_guardrail_policy_revisions"."action_types") = 'array' and jsonb_array_length("action_guardrail_policy_revisions"."action_types") between 1 and 5
    and not jsonb_path_exists("action_guardrail_policy_revisions"."action_types", '$[*] ? (@ != "status_pause" && @ != "status_activate" && @ != "budget_decrease" && @ != "budget_increase" && @ != "existing_post_promotion")')
    and jsonb_typeof("action_guardrail_policy_revisions"."account_refs") = 'array' and jsonb_array_length("action_guardrail_policy_revisions"."account_refs") <= 500
    and jsonb_typeof("action_guardrail_policy_revisions"."campaign_refs") = 'array' and jsonb_array_length("action_guardrail_policy_revisions"."campaign_refs") <= 500
    and jsonb_typeof("action_guardrail_policy_revisions"."entities") = 'array' and jsonb_array_length("action_guardrail_policy_revisions"."entities") <= 500
    and jsonb_typeof("action_guardrail_policy_revisions"."internal_category_refs") = 'array' and jsonb_array_length("action_guardrail_policy_revisions"."internal_category_refs") <= 500
    and jsonb_typeof("action_guardrail_policy_revisions"."geo_refs") = 'array' and jsonb_array_length("action_guardrail_policy_revisions"."geo_refs") <= 500
    and jsonb_typeof("action_guardrail_policy_revisions"."clauses") = 'array' and jsonb_array_length("action_guardrail_policy_revisions"."clauses") <= 500
    and jsonb_typeof("action_guardrail_policy_revisions"."source_guidance_refs") = 'array' and jsonb_array_length("action_guardrail_policy_revisions"."source_guidance_refs") <= 500
  ),
	CONSTRAINT "action_guardrail_policy_revisions_payload_exact" CHECK (
    jsonb_typeof("action_guardrail_policy_revisions"."artifact_payload") = 'object'
    and "action_guardrail_policy_revisions"."artifact_payload" #>> '{version}' = "action_guardrail_policy_revisions"."schema_version"
    and "action_guardrail_policy_revisions"."artifact_payload" #>> '{workspaceRef}' = "action_guardrail_policy_revisions"."workspace_ref"
    and "action_guardrail_policy_revisions"."artifact_payload" #>> '{policyRef}' = "action_guardrail_policy_revisions"."policy_ref"
    and ("action_guardrail_policy_revisions"."artifact_payload" #>> '{revision}')::integer = "action_guardrail_policy_revisions"."revision"
    and ("action_guardrail_policy_revisions"."artifact_payload" #>> '{previousHash}') is not distinct from "action_guardrail_policy_revisions"."previous_hash"
    and "action_guardrail_policy_revisions"."artifact_payload" #>> '{state}' = "action_guardrail_policy_revisions"."state"
    and ("action_guardrail_policy_revisions"."artifact_payload" #>> '{effectiveFrom}')::timestamptz = "action_guardrail_policy_revisions"."effective_from"
    and ("action_guardrail_policy_revisions"."artifact_payload" #>> '{expiresAt}')::timestamptz is not distinct from "action_guardrail_policy_revisions"."expires_at"
    and "action_guardrail_policy_revisions"."artifact_payload" #>> '{defaultDisposition}' = "action_guardrail_policy_revisions"."default_disposition"
    and "action_guardrail_policy_revisions"."artifact_payload" #> '{selector,actionTypes}' = "action_guardrail_policy_revisions"."action_types"
    and "action_guardrail_policy_revisions"."artifact_payload" #> '{selector,accountRefs}' = "action_guardrail_policy_revisions"."account_refs"
    and "action_guardrail_policy_revisions"."artifact_payload" #> '{selector,campaignRefs}' = "action_guardrail_policy_revisions"."campaign_refs"
    and "action_guardrail_policy_revisions"."artifact_payload" #> '{selector,entities}' = "action_guardrail_policy_revisions"."entities"
    and "action_guardrail_policy_revisions"."artifact_payload" #> '{selector,internalCategoryRefs}' = "action_guardrail_policy_revisions"."internal_category_refs"
    and "action_guardrail_policy_revisions"."artifact_payload" #> '{selector,geoRefs}' = "action_guardrail_policy_revisions"."geo_refs"
    and "action_guardrail_policy_revisions"."artifact_payload" #> '{clauses}' = "action_guardrail_policy_revisions"."clauses"
    and "action_guardrail_policy_revisions"."artifact_payload" #>> '{provenance,normalizedByActorRef}' = "action_guardrail_policy_revisions"."normalized_by_actor_ref"
    and "action_guardrail_policy_revisions"."artifact_payload" #>> '{provenance,normalizedByRole}' = "action_guardrail_policy_revisions"."normalized_by_role"
    and "action_guardrail_policy_revisions"."artifact_payload" #> '{provenance,sourceGuidanceRefs}' = "action_guardrail_policy_revisions"."source_guidance_refs"
    and ("action_guardrail_policy_revisions"."artifact_payload" #>> '{provenance,publishedByActorRef}') is not distinct from "action_guardrail_policy_revisions"."published_by_actor_ref"
    and ("action_guardrail_policy_revisions"."artifact_payload" #>> '{provenance,publishedByRole}') is not distinct from "action_guardrail_policy_revisions"."published_by_role"
    and ("action_guardrail_policy_revisions"."artifact_payload" #>> '{provenance,publicationDecisionRef}') is not distinct from "action_guardrail_policy_revisions"."publication_decision_ref"
    and ("action_guardrail_policy_revisions"."artifact_payload" #>> '{provenance,publicationReasonRef}') is not distinct from "action_guardrail_policy_revisions"."publication_reason_ref"
    and ("action_guardrail_policy_revisions"."artifact_payload" #>> '{provenance,publishedAt}')::timestamptz is not distinct from "action_guardrail_policy_revisions"."published_at"
    and ("action_guardrail_policy_revisions"."artifact_payload" #>> '{provenance,disabledByActorRef}') is not distinct from "action_guardrail_policy_revisions"."disabled_by_actor_ref"
    and ("action_guardrail_policy_revisions"."artifact_payload" #>> '{provenance,disabledByRole}') is not distinct from "action_guardrail_policy_revisions"."disabled_by_role"
    and ("action_guardrail_policy_revisions"."artifact_payload" #>> '{provenance,disableDecisionRef}') is not distinct from "action_guardrail_policy_revisions"."disable_decision_ref"
    and ("action_guardrail_policy_revisions"."artifact_payload" #>> '{provenance,disableReasonRef}') is not distinct from "action_guardrail_policy_revisions"."disable_reason_ref"
    and ("action_guardrail_policy_revisions"."artifact_payload" #>> '{provenance,disabledAt}')::timestamptz is not distinct from "action_guardrail_policy_revisions"."disabled_at"
    and "action_guardrail_policy_revisions"."artifact_payload" #>> '{authority,canApprove}' = 'false'
    and "action_guardrail_policy_revisions"."artifact_payload" #>> '{authority,canExecute}' = 'false'
    and "action_guardrail_policy_revisions"."artifact_payload" #>> '{authority,canWriteMeta}' = 'false'
    and "action_guardrail_policy_revisions"."artifact_payload" #>> '{authority,canGrantApproval}' = 'false'
    and "action_guardrail_policy_revisions"."artifact_payload" #>> '{authority,canPromoteGuidance}' = 'false'
    and "action_guardrail_policy_revisions"."artifact_payload" #>> '{canonicalHash}' = "action_guardrail_policy_revisions"."canonical_hash"
  ),
	CONSTRAINT "action_guardrail_policy_revisions_no_forbidden_material" CHECK (
    "action_guardrail_policy_revisions"."artifact_payload"::text
      !~* '"[^"[:space:]]*(token|secret|prompt|raw[_-]?(payload|request|response|json)|free[_-]?text|authorization|approvalgranted)"[[:space:]]*:'
  )
);
--> statement-breakpoint
ALTER TABLE "action_guardrail_policy_revisions" ADD CONSTRAINT "action_guardrail_policy_revisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "action_guardrail_policy_revisions_workspace_row_unique" ON "action_guardrail_policy_revisions" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "action_guardrail_policy_revisions_workspace_ref_revision_unique" ON "action_guardrail_policy_revisions" USING btree ("workspace_id","policy_ref","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "action_guardrail_policy_revisions_workspace_hash_unique" ON "action_guardrail_policy_revisions" USING btree ("workspace_id","canonical_hash");--> statement-breakpoint
CREATE INDEX "action_guardrail_policy_revisions_resolve_idx" ON "action_guardrail_policy_revisions" USING btree ("workspace_id","state","policy_ref","revision");--> statement-breakpoint

ALTER TABLE action_guardrail_policy_revisions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE action_guardrail_policy_revisions FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE action_guardrail_policy_revisions FROM PUBLIC, anon, authenticated;--> statement-breakpoint

CREATE OR REPLACE FUNCTION action_guardrail_policy_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'action guardrail policy revisions are append-only';
END;
$$;--> statement-breakpoint

CREATE TRIGGER action_guardrail_policy_revisions_append_only
BEFORE UPDATE ON action_guardrail_policy_revisions
FOR EACH ROW EXECUTE FUNCTION action_guardrail_policy_append_only();--> statement-breakpoint

REVOKE ALL PRIVILEGES ON FUNCTION action_guardrail_policy_append_only() FROM PUBLIC, anon, authenticated;
