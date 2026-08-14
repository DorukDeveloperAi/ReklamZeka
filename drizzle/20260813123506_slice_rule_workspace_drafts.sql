CREATE TABLE "slice_rule_workspace_drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"series_ref" text NOT NULL,
	"revision" integer NOT NULL,
	"previous_draft_hash" text NOT NULL,
	"draft_ref" text NOT NULL,
	"draft_hash" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"market" text NOT NULL,
	"service_ref" text NOT NULL,
	"campaign_family_ref" text NOT NULL,
	"country_or_region" text,
	"audience_strategy" text,
	"platform" text,
	"operating_mode" text NOT NULL,
	"lifecycle_state" text NOT NULL,
	"created_by_actor_id" uuid NOT NULL,
	"draft_payload" jsonb NOT NULL,
	"drafted_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "slice_rule_workspace_drafts_identity" CHECK (
    "slice_rule_workspace_drafts"."series_ref" ~ '^[a-z][a-z0-9_.:-]{0,127}$'
    and "slice_rule_workspace_drafts"."idempotency_key" ~ '^[a-z][a-z0-9_.:-]{0,127}$'
    and "slice_rule_workspace_drafts"."draft_ref" ~ '^slice_rule_draft_[a-f0-9]{20}$'
    and "slice_rule_workspace_drafts"."draft_hash" ~ '^[a-f0-9]{64}$'
    and "slice_rule_workspace_drafts"."revision" >= 1
    and (("slice_rule_workspace_drafts"."revision" = 1 and "slice_rule_workspace_drafts"."previous_draft_hash" = 'GENESIS')
      or ("slice_rule_workspace_drafts"."revision" > 1 and "slice_rule_workspace_drafts"."previous_draft_hash" ~ '^[a-f0-9]{64}$'))
    and "slice_rule_workspace_drafts"."market" in ('domestic', 'international')
    and "slice_rule_workspace_drafts"."service_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and "slice_rule_workspace_drafts"."campaign_family_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and ("slice_rule_workspace_drafts"."country_or_region" is null or (length("slice_rule_workspace_drafts"."country_or_region") between 1 and 120 and btrim("slice_rule_workspace_drafts"."country_or_region") = "slice_rule_workspace_drafts"."country_or_region"))
    and ("slice_rule_workspace_drafts"."audience_strategy" is null or (length("slice_rule_workspace_drafts"."audience_strategy") between 1 and 120 and btrim("slice_rule_workspace_drafts"."audience_strategy") = "slice_rule_workspace_drafts"."audience_strategy"))
    and ("slice_rule_workspace_drafts"."platform" is null or "slice_rule_workspace_drafts"."platform" in ('facebook', 'instagram', 'mixed'))
    and "slice_rule_workspace_drafts"."operating_mode" = 'recommendation_only'
    and "slice_rule_workspace_drafts"."lifecycle_state" = 'draft'
  ),
	CONSTRAINT "slice_rule_workspace_drafts_payload_exact" CHECK ((
    jsonb_typeof("slice_rule_workspace_drafts"."draft_payload") = 'object'
    and "slice_rule_workspace_drafts"."draft_payload" #>> '{schemaVersion}' = 'slice-rule-workspace-draft/1.0.0'
    and "slice_rule_workspace_drafts"."draft_payload" #>> '{workspaceId}' = "slice_rule_workspace_drafts"."workspace_id"::text
    and "slice_rule_workspace_drafts"."draft_payload" #>> '{seriesRef}' = "slice_rule_workspace_drafts"."series_ref"
    and ("slice_rule_workspace_drafts"."draft_payload" #>> '{revision}')::integer = "slice_rule_workspace_drafts"."revision"
    and "slice_rule_workspace_drafts"."draft_payload" #>> '{previousDraftHash}' = "slice_rule_workspace_drafts"."previous_draft_hash"
    and "slice_rule_workspace_drafts"."draft_payload" #>> '{draftRef}' = "slice_rule_workspace_drafts"."draft_ref"
    and "slice_rule_workspace_drafts"."draft_payload" #>> '{draftHash}' = "slice_rule_workspace_drafts"."draft_hash"
    and "slice_rule_workspace_drafts"."draft_payload" #>> '{idempotencyKey}' = "slice_rule_workspace_drafts"."idempotency_key"
    and "slice_rule_workspace_drafts"."draft_payload" #>> '{status}' = "slice_rule_workspace_drafts"."lifecycle_state"
    and "slice_rule_workspace_drafts"."draft_payload" #>> '{operatingMode}' = "slice_rule_workspace_drafts"."operating_mode"
    and "slice_rule_workspace_drafts"."draft_payload" #>> '{scope,market}' = "slice_rule_workspace_drafts"."market"
    and "slice_rule_workspace_drafts"."draft_payload" #>> '{scope,serviceRef}' = "slice_rule_workspace_drafts"."service_ref"
    and "slice_rule_workspace_drafts"."draft_payload" #>> '{scope,campaignFamilyRef}' = "slice_rule_workspace_drafts"."campaign_family_ref"
    and ("slice_rule_workspace_drafts"."draft_payload" #>> '{scope,countryOrRegion}') is not distinct from "slice_rule_workspace_drafts"."country_or_region"
    and ("slice_rule_workspace_drafts"."draft_payload" #>> '{scope,audienceStrategy}') is not distinct from "slice_rule_workspace_drafts"."audience_strategy"
    and ("slice_rule_workspace_drafts"."draft_payload" #>> '{scope,platform}') is not distinct from "slice_rule_workspace_drafts"."platform"
    and "slice_rule_workspace_drafts"."draft_payload" #>> '{operatingRule,automationMode}' = 'recommendation_only'
    and ("slice_rule_workspace_drafts"."draft_payload" #>> '{createdAt}')::timestamptz = "slice_rule_workspace_drafts"."drafted_at"
    and "slice_rule_workspace_drafts"."draft_payload" #> '{authority}' = '{
      "canPublish": false, "canApprove": false, "canExecute": false,
      "canWriteMeta": false, "canEnableAutomation": false
    }'::jsonb
    and "slice_rule_workspace_drafts"."draft_payload" #> '{operatingRule,authority}' = '{
      "canPublish": false, "canApprove": false, "canExecute": false,
      "canWriteMeta": false, "canEnableAutomation": false
    }'::jsonb
  ) is true),
	CONSTRAINT "slice_rule_workspace_drafts_no_forbidden_authority" CHECK (
    "slice_rule_workspace_drafts"."draft_payload"::text !~* '"(approvalGranted|writeEnabled|policyPublished|actionAuthorized)"[[:space:]]*:[[:space:]]*true'
    and "slice_rule_workspace_drafts"."draft_payload"::text !~* '"[^"[:space:]]*(token|secret|authorization|raw[_-]?(payload|request|response|json))"[[:space:]]*:'
  )
);
--> statement-breakpoint
ALTER TABLE "slice_rule_workspace_drafts" ADD CONSTRAINT "slice_rule_workspace_drafts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slice_rule_workspace_drafts" ADD CONSTRAINT "slice_rule_workspace_drafts_membership_scope_fk" FOREIGN KEY ("workspace_id","created_by_actor_id") REFERENCES "public"."memberships"("workspace_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "slice_rule_workspace_drafts_workspace_row_unique" ON "slice_rule_workspace_drafts" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "slice_rule_workspace_drafts_series_revision_unique" ON "slice_rule_workspace_drafts" USING btree ("workspace_id","series_ref","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "slice_rule_workspace_drafts_workspace_hash_unique" ON "slice_rule_workspace_drafts" USING btree ("workspace_id","draft_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "slice_rule_workspace_drafts_workspace_idempotency_unique" ON "slice_rule_workspace_drafts" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "slice_rule_workspace_drafts_scope_idx" ON "slice_rule_workspace_drafts" USING btree ("workspace_id","market","service_ref","campaign_family_ref","drafted_at");--> statement-breakpoint
ALTER TABLE "slice_rule_workspace_drafts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "slice_rule_workspace_drafts" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "slice_rule_workspace_drafts" FROM PUBLIC, anon, authenticated, service_role;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.slice_rule_workspace_draft_append_only_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND EXISTS (
    SELECT 1 FROM public.workspaces
    WHERE id = OLD.workspace_id AND lifecycle_state = 'tombstoning'
  ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'slice rule workspace drafts are append-only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER slice_rule_workspace_drafts_append_only
BEFORE UPDATE OR DELETE ON "slice_rule_workspace_drafts"
FOR EACH ROW EXECUTE FUNCTION public.slice_rule_workspace_draft_append_only_guard();--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION public.slice_rule_workspace_draft_append_only_guard() FROM PUBLIC, anon, authenticated, service_role;
