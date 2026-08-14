CREATE TABLE "slice_rule_allocation_entity_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"draft_hash" text NOT NULL,
	"allocation_ref" text NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"ad_set_id" uuid NOT NULL,
	"budget_owner_level" text NOT NULL,
	"budget_owner_entity_id" uuid NOT NULL,
	"budget_kind" text NOT NULL,
	"currency" text NOT NULL,
	"current_amount_minor" bigint NOT NULL,
	"source_evidence_hash" text NOT NULL,
	"source_observed_at" timestamp with time zone NOT NULL,
	"source_evidence" jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"bound_by_actor_id" uuid NOT NULL,
	"binding_payload" jsonb NOT NULL,
	"bound_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "slice_rule_allocation_entity_bindings_identity" CHECK (
    "slice_rule_allocation_entity_bindings"."draft_hash" ~ '^[a-f0-9]{64}$'
    and "slice_rule_allocation_entity_bindings"."allocation_ref" ~ '^[a-z][a-z0-9_.:-]{0,127}$'
    and "slice_rule_allocation_entity_bindings"."idempotency_key" ~ '^[a-z][a-z0-9_.:-]{0,127}$'
    and "slice_rule_allocation_entity_bindings"."budget_owner_level" in ('campaign', 'ad_set')
    and (("slice_rule_allocation_entity_bindings"."budget_owner_level" = 'campaign' and "slice_rule_allocation_entity_bindings"."budget_owner_entity_id" = "slice_rule_allocation_entity_bindings"."campaign_id")
      or ("slice_rule_allocation_entity_bindings"."budget_owner_level" = 'ad_set' and "slice_rule_allocation_entity_bindings"."budget_owner_entity_id" = "slice_rule_allocation_entity_bindings"."ad_set_id"))
    and "slice_rule_allocation_entity_bindings"."budget_kind" in ('daily', 'lifetime')
    and "slice_rule_allocation_entity_bindings"."currency" ~ '^[A-Z]{3}$'
    and "slice_rule_allocation_entity_bindings"."current_amount_minor" >= 0
    and "slice_rule_allocation_entity_bindings"."source_evidence_hash" ~ '^[a-f0-9]{64}$'
  ),
	CONSTRAINT "slice_rule_allocation_entity_bindings_source_evidence_exact" CHECK ((
    jsonb_typeof("slice_rule_allocation_entity_bindings"."source_evidence") = 'object'
    and "slice_rule_allocation_entity_bindings"."source_evidence" #>> '{evidenceHash}' = "slice_rule_allocation_entity_bindings"."source_evidence_hash"
    and ("slice_rule_allocation_entity_bindings"."source_evidence" #>> '{observedAt}')::timestamptz = "slice_rule_allocation_entity_bindings"."source_observed_at"
    and "slice_rule_allocation_entity_bindings"."source_evidence" #>> '{sourceKind}' = 'canonical_meta_inventory'
    and "slice_rule_allocation_entity_bindings"."source_evidence" #>> '{rawPayloadHash}' ~ '^[a-f0-9]{64}$'
    and "slice_rule_allocation_entity_bindings"."source_evidence" #>> '{sourceGraphVersion}' ~ '^[A-Za-z0-9][A-Za-z0-9./_-]{0,127}$'
    and "slice_rule_allocation_entity_bindings"."source_evidence" #>> '{fieldCatalogVersion}' ~ '^[A-Za-z0-9][A-Za-z0-9./_-]{0,127}$'
  ) is true),
	CONSTRAINT "slice_rule_allocation_entity_bindings_payload_exact" CHECK ((
    jsonb_typeof("slice_rule_allocation_entity_bindings"."binding_payload") = 'object'
    and "slice_rule_allocation_entity_bindings"."binding_payload" #>> '{schemaVersion}' = 'slice-rule-allocation-entity-binding/1.0.0'
    and "slice_rule_allocation_entity_bindings"."binding_payload" #>> '{draftHash}' = "slice_rule_allocation_entity_bindings"."draft_hash"
    and "slice_rule_allocation_entity_bindings"."binding_payload" #>> '{allocationRef}' = "slice_rule_allocation_entity_bindings"."allocation_ref"
    and "slice_rule_allocation_entity_bindings"."binding_payload" #>> '{hierarchy,adAccountId}' = "slice_rule_allocation_entity_bindings"."ad_account_id"::text
    and "slice_rule_allocation_entity_bindings"."binding_payload" #>> '{hierarchy,campaignId}' = "slice_rule_allocation_entity_bindings"."campaign_id"::text
    and "slice_rule_allocation_entity_bindings"."binding_payload" #>> '{hierarchy,adSetId}' = "slice_rule_allocation_entity_bindings"."ad_set_id"::text
    and "slice_rule_allocation_entity_bindings"."binding_payload" #>> '{budgetOwner,level}' = "slice_rule_allocation_entity_bindings"."budget_owner_level"
    and "slice_rule_allocation_entity_bindings"."binding_payload" #>> '{budgetOwner,entityId}' = "slice_rule_allocation_entity_bindings"."budget_owner_entity_id"::text
    and "slice_rule_allocation_entity_bindings"."binding_payload" #>> '{budget,kind}' = "slice_rule_allocation_entity_bindings"."budget_kind"
    and "slice_rule_allocation_entity_bindings"."binding_payload" #>> '{budget,currency}' = "slice_rule_allocation_entity_bindings"."currency"
    and ("slice_rule_allocation_entity_bindings"."binding_payload" #>> '{budget,currentAmountMinor}')::bigint = "slice_rule_allocation_entity_bindings"."current_amount_minor"
    and "slice_rule_allocation_entity_bindings"."binding_payload" #> '{sourceEvidence}' = "slice_rule_allocation_entity_bindings"."source_evidence"
    and ("slice_rule_allocation_entity_bindings"."binding_payload" #>> '{boundAt}')::timestamptz = "slice_rule_allocation_entity_bindings"."bound_at"
    and "slice_rule_allocation_entity_bindings"."binding_payload" #> '{authority}' = '{"recommendationOnly":true,"canPublish":false,"canApprove":false,"canExecute":false,"canWriteMeta":false,"canEnableAutomation":false}'::jsonb
  ) is true),
	CONSTRAINT "slice_rule_allocation_entity_bindings_no_forbidden_authority" CHECK (
    "slice_rule_allocation_entity_bindings"."binding_payload"::text !~* '"(approvalGranted|writeEnabled|policyPublished|actionAuthorized)"[[:space:]]*:[[:space:]]*true'
    and "slice_rule_allocation_entity_bindings"."binding_payload"::text !~* '"[^"[:space:]]*(token|secret|authorization|raw[_-]?(payload|request|response|json))"[[:space:]]*:'
  )
);
--> statement-breakpoint
ALTER TABLE "slice_rule_allocation_entity_bindings" ADD CONSTRAINT "slice_rule_allocation_entity_bindings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slice_rule_allocation_entity_bindings" ADD CONSTRAINT "slice_rule_allocation_entity_bindings_draft_scope_fk" FOREIGN KEY ("workspace_id","draft_hash") REFERENCES "public"."slice_rule_workspace_drafts"("workspace_id","draft_hash") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slice_rule_allocation_entity_bindings" ADD CONSTRAINT "slice_rule_allocation_entity_bindings_canonical_hierarchy_fk" FOREIGN KEY ("workspace_id","ad_set_id","campaign_id","ad_account_id") REFERENCES "public"."meta_ad_sets"("workspace_id","id","campaign_id","ad_account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slice_rule_allocation_entity_bindings" ADD CONSTRAINT "slice_rule_allocation_entity_bindings_membership_scope_fk" FOREIGN KEY ("workspace_id","bound_by_actor_id") REFERENCES "public"."memberships"("workspace_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "slice_rule_allocation_entity_bindings_workspace_row_unique" ON "slice_rule_allocation_entity_bindings" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "slice_rule_allocation_entity_bindings_exact_unique" ON "slice_rule_allocation_entity_bindings" USING btree ("workspace_id","draft_hash","allocation_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "slice_rule_allocation_entity_bindings_idempotency_unique" ON "slice_rule_allocation_entity_bindings" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "slice_rule_allocation_entity_bindings_target_idx" ON "slice_rule_allocation_entity_bindings" USING btree ("workspace_id","ad_account_id","campaign_id","ad_set_id","bound_at" DESC NULLS LAST);
--> statement-breakpoint
ALTER TABLE "slice_rule_allocation_entity_bindings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "slice_rule_allocation_entity_bindings" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "slice_rule_allocation_entity_bindings" FROM PUBLIC, anon, authenticated, service_role;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.slice_rule_allocation_entity_binding_append_only_guard()
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
  RAISE EXCEPTION 'slice rule allocation entity bindings are append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER slice_rule_allocation_entity_bindings_append_only
BEFORE UPDATE OR DELETE ON "slice_rule_allocation_entity_bindings"
FOR EACH ROW EXECUTE FUNCTION public.slice_rule_allocation_entity_binding_append_only_guard();
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION public.slice_rule_allocation_entity_binding_append_only_guard() FROM PUBLIC, anon, authenticated, service_role;
