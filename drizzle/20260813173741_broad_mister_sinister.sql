CREATE TABLE "slice_rule_budget_action_unit_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"selection_id" uuid NOT NULL,
	"action_proposal_unit_id" uuid NOT NULL,
	"binding_hash" text NOT NULL,
	"binding_payload" jsonb NOT NULL,
	"bound_by_actor_id" uuid NOT NULL,
	"bound_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "slice_rule_budget_action_unit_bindings_hash" CHECK ("slice_rule_budget_action_unit_bindings"."binding_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "slice_rule_budget_action_unit_bindings_payload_exact" CHECK ((
    jsonb_typeof("slice_rule_budget_action_unit_bindings"."binding_payload") = 'object'
    and "slice_rule_budget_action_unit_bindings"."binding_payload" #>> '{schemaVersion}' = 'slice-rule-budget-action-unit-binding/1.0.0'
    and "slice_rule_budget_action_unit_bindings"."binding_payload" #>> '{bindingHash}' = "slice_rule_budget_action_unit_bindings"."binding_hash"
    and "slice_rule_budget_action_unit_bindings"."binding_payload" #>> '{selectionId}' = "slice_rule_budget_action_unit_bindings"."selection_id"::text
    and "slice_rule_budget_action_unit_bindings"."binding_payload" #>> '{actionProposalUnitId}' = "slice_rule_budget_action_unit_bindings"."action_proposal_unit_id"::text
    and ("slice_rule_budget_action_unit_bindings"."binding_payload" #>> '{boundAt}')::timestamptz = "slice_rule_budget_action_unit_bindings"."bound_at"
    and "slice_rule_budget_action_unit_bindings"."binding_payload" #> '{authority}' = '{"canApprove":false,"canExecute":false,"canWriteMeta":false}'::jsonb
  ) is true),
	CONSTRAINT "slice_rule_budget_action_unit_bindings_no_forbidden_authority" CHECK (
    "slice_rule_budget_action_unit_bindings"."binding_payload"::text !~* '"(approvalGranted|writeEnabled|policyPublished|actionAuthorized)"[[:space:]]*:[[:space:]]*true'
    and "slice_rule_budget_action_unit_bindings"."binding_payload"::text !~* '"[^"[:space:]]*(token|secret|authorization|raw[_-]?(payload|request|response|json))"[[:space:]]*:'
  )
);
--> statement-breakpoint
ALTER TABLE "slice_rule_budget_action_unit_bindings" ADD CONSTRAINT "slice_rule_budget_action_unit_bindings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slice_rule_budget_action_unit_bindings" ADD CONSTRAINT "slice_rule_budget_action_unit_bindings_selection_scope_fk" FOREIGN KEY ("workspace_id","selection_id") REFERENCES "public"."slice_rule_scenario_allocation_selections"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slice_rule_budget_action_unit_bindings" ADD CONSTRAINT "slice_rule_budget_action_unit_bindings_unit_scope_fk" FOREIGN KEY ("workspace_id","action_proposal_unit_id") REFERENCES "public"."action_proposal_units"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slice_rule_budget_action_unit_bindings" ADD CONSTRAINT "slice_rule_budget_action_unit_bindings_membership_scope_fk" FOREIGN KEY ("workspace_id","bound_by_actor_id") REFERENCES "public"."memberships"("workspace_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "slice_rule_budget_action_unit_bindings_workspace_row_unique" ON "slice_rule_budget_action_unit_bindings" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "slice_rule_budget_action_unit_bindings_selection_unique" ON "slice_rule_budget_action_unit_bindings" USING btree ("selection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "slice_rule_budget_action_unit_bindings_unit_unique" ON "slice_rule_budget_action_unit_bindings" USING btree ("action_proposal_unit_id");
--> statement-breakpoint
ALTER TABLE "slice_rule_budget_action_unit_bindings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "slice_rule_budget_action_unit_bindings" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "slice_rule_budget_action_unit_bindings" FROM PUBLIC, anon, authenticated, service_role;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.slice_rule_budget_action_unit_binding_append_only_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'slice_rule_budget_action_unit_bindings are append-only'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workspaces WHERE id = OLD.workspace_id AND lifecycle_state = 'tombstoning') THEN
    RAISE EXCEPTION 'slice_rule_budget_action_unit_bindings may only be deleted during workspace tombstone';
  END IF;
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER slice_rule_budget_action_unit_bindings_append_only
BEFORE UPDATE OR DELETE ON "slice_rule_budget_action_unit_bindings"
FOR EACH ROW EXECUTE FUNCTION public.slice_rule_budget_action_unit_binding_append_only_guard();
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION public.slice_rule_budget_action_unit_binding_append_only_guard() FROM PUBLIC, anon, authenticated, service_role;
