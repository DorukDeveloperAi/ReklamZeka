CREATE TABLE "slice_rule_scenario_allocation_selections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"draft_hash" text NOT NULL,
	"proposal_hash" text NOT NULL,
	"proposal_ref" text NOT NULL,
	"scenario_ref" text NOT NULL,
	"allocation_ref" text NOT NULL,
	"before_amount_minor" bigint NOT NULL,
	"after_amount_minor" bigint NOT NULL,
	"selection_evidence_hash" text NOT NULL,
	"selection_evidence" jsonb NOT NULL,
	"idempotency_key" text NOT NULL,
	"selected_by_actor_id" uuid NOT NULL,
	"selection_payload" jsonb NOT NULL,
	"selected_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "slice_rule_scenario_allocation_selections_identity" CHECK (
    "slice_rule_scenario_allocation_selections"."draft_hash" ~ '^[a-f0-9]{64}$' and "slice_rule_scenario_allocation_selections"."proposal_hash" ~ '^[a-f0-9]{64}$'
    and "slice_rule_scenario_allocation_selections"."proposal_ref" ~ '^budget_proposal_[a-f0-9]{20}$'
    and "slice_rule_scenario_allocation_selections"."scenario_ref" ~ '^[a-z][a-z0-9_.:-]{0,127}$'
    and "slice_rule_scenario_allocation_selections"."allocation_ref" ~ '^[a-z][a-z0-9_.:-]{0,127}$'
    and "slice_rule_scenario_allocation_selections"."idempotency_key" ~ '^[a-z][a-z0-9_.:-]{0,127}$'
    and "slice_rule_scenario_allocation_selections"."before_amount_minor" >= 0 and "slice_rule_scenario_allocation_selections"."after_amount_minor" >= 0
    and "slice_rule_scenario_allocation_selections"."before_amount_minor" <> "slice_rule_scenario_allocation_selections"."after_amount_minor"
    and "slice_rule_scenario_allocation_selections"."selection_evidence_hash" ~ '^[a-f0-9]{64}$'
  ),
	CONSTRAINT "slice_rule_scenario_allocation_selections_evidence_exact" CHECK ((
    jsonb_typeof("slice_rule_scenario_allocation_selections"."selection_evidence") = 'object'
    and "slice_rule_scenario_allocation_selections"."selection_evidence" #>> '{evidenceHash}' = "slice_rule_scenario_allocation_selections"."selection_evidence_hash"
    and "slice_rule_scenario_allocation_selections"."selection_evidence" #>> '{proposalHash}' = "slice_rule_scenario_allocation_selections"."proposal_hash"
    and "slice_rule_scenario_allocation_selections"."selection_evidence" #>> '{scenarioRef}' = "slice_rule_scenario_allocation_selections"."scenario_ref"
    and "slice_rule_scenario_allocation_selections"."selection_evidence" #>> '{allocationRef}' = "slice_rule_scenario_allocation_selections"."allocation_ref"
  ) is true),
	CONSTRAINT "slice_rule_scenario_allocation_selections_payload_exact" CHECK ((
    jsonb_typeof("slice_rule_scenario_allocation_selections"."selection_payload") = 'object'
    and "slice_rule_scenario_allocation_selections"."selection_payload" #>> '{schemaVersion}' = 'slice-rule-scenario-allocation-selection/1.0.0'
    and "slice_rule_scenario_allocation_selections"."selection_payload" #>> '{draftHash}' = "slice_rule_scenario_allocation_selections"."draft_hash"
    and "slice_rule_scenario_allocation_selections"."selection_payload" #>> '{proposalHash}' = "slice_rule_scenario_allocation_selections"."proposal_hash"
    and "slice_rule_scenario_allocation_selections"."selection_payload" #>> '{proposalRef}' = "slice_rule_scenario_allocation_selections"."proposal_ref"
    and "slice_rule_scenario_allocation_selections"."selection_payload" #>> '{scenarioRef}' = "slice_rule_scenario_allocation_selections"."scenario_ref"
    and "slice_rule_scenario_allocation_selections"."selection_payload" #>> '{allocationRef}' = "slice_rule_scenario_allocation_selections"."allocation_ref"
    and ("slice_rule_scenario_allocation_selections"."selection_payload" #>> '{beforeAmountMinor}')::bigint = "slice_rule_scenario_allocation_selections"."before_amount_minor"
    and ("slice_rule_scenario_allocation_selections"."selection_payload" #>> '{afterAmountMinor}')::bigint = "slice_rule_scenario_allocation_selections"."after_amount_minor"
    and "slice_rule_scenario_allocation_selections"."selection_payload" #> '{selectionEvidence}' = "slice_rule_scenario_allocation_selections"."selection_evidence"
    and ("slice_rule_scenario_allocation_selections"."selection_payload" #>> '{selectedAt}')::timestamptz = "slice_rule_scenario_allocation_selections"."selected_at"
    and "slice_rule_scenario_allocation_selections"."selection_payload" #> '{authority}' = '{"recommendationOnly":true,"canPublish":false,"canApprove":false,"canExecute":false,"canWriteMeta":false,"canEnableAutomation":false}'::jsonb
  ) is true),
	CONSTRAINT "slice_rule_scenario_allocation_selections_no_forbidden_authority" CHECK (
    "slice_rule_scenario_allocation_selections"."selection_payload"::text !~* '"(approvalGranted|writeEnabled|policyPublished|actionAuthorized)"[[:space:]]*:[[:space:]]*true'
    and "slice_rule_scenario_allocation_selections"."selection_payload"::text !~* '"[^"[:space:]]*(token|secret|authorization|raw[_-]?(payload|request|response|json))"[[:space:]]*:'
  )
);
--> statement-breakpoint
ALTER TABLE "slice_rule_scenario_allocation_selections" ADD CONSTRAINT "slice_rule_scenario_allocation_selections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slice_rule_scenario_allocation_selections" ADD CONSTRAINT "slice_rule_scenario_allocation_selections_draft_scope_fk" FOREIGN KEY ("workspace_id","draft_hash") REFERENCES "public"."slice_rule_workspace_drafts"("workspace_id","draft_hash") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slice_rule_scenario_allocation_selections" ADD CONSTRAINT "slice_rule_scenario_allocation_selections_proposal_scope_fk" FOREIGN KEY ("workspace_id","proposal_hash") REFERENCES "public"."budget_proposal_versions"("workspace_id","proposal_hash") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slice_rule_scenario_allocation_selections" ADD CONSTRAINT "slice_rule_scenario_allocation_selections_allocation_binding_fk" FOREIGN KEY ("workspace_id","draft_hash","allocation_ref") REFERENCES "public"."slice_rule_allocation_entity_bindings"("workspace_id","draft_hash","allocation_ref") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slice_rule_scenario_allocation_selections" ADD CONSTRAINT "slice_rule_scenario_allocation_selections_membership_scope_fk" FOREIGN KEY ("workspace_id","selected_by_actor_id") REFERENCES "public"."memberships"("workspace_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "slice_rule_scenario_allocation_selections_workspace_row_unique" ON "slice_rule_scenario_allocation_selections" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "slice_rule_scenario_allocation_selections_exact_unique" ON "slice_rule_scenario_allocation_selections" USING btree ("workspace_id","draft_hash","proposal_hash","scenario_ref","allocation_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "slice_rule_scenario_allocation_selections_allocation_unique" ON "slice_rule_scenario_allocation_selections" USING btree ("workspace_id","draft_hash","allocation_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "slice_rule_scenario_allocation_selections_idempotency_unique" ON "slice_rule_scenario_allocation_selections" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "slice_rule_scenario_allocation_selections_lookup_idx" ON "slice_rule_scenario_allocation_selections" USING btree ("workspace_id","proposal_hash","selected_at" DESC NULLS LAST);
--> statement-breakpoint
ALTER TABLE "slice_rule_scenario_allocation_selections" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "slice_rule_scenario_allocation_selections" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "slice_rule_scenario_allocation_selections" FROM PUBLIC, anon, authenticated, service_role;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.slice_rule_scenario_allocation_selection_append_only_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'slice_rule_scenario_allocation_selections are append-only';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.workspaces
    WHERE id = OLD.workspace_id AND lifecycle_state = 'tombstoning'
  ) THEN
    RAISE EXCEPTION 'slice_rule_scenario_allocation_selections may only be deleted during workspace tombstone';
  END IF;
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER slice_rule_scenario_allocation_selections_append_only
BEFORE UPDATE OR DELETE ON "slice_rule_scenario_allocation_selections"
FOR EACH ROW EXECUTE FUNCTION public.slice_rule_scenario_allocation_selection_append_only_guard();
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION public.slice_rule_scenario_allocation_selection_append_only_guard() FROM PUBLIC, anon, authenticated, service_role;
