CREATE TABLE "slice_rule_budget_proposal_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"draft_hash" text NOT NULL,
	"proposal_hash" text NOT NULL,
	"proposal_ref" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"bound_by_actor_id" uuid NOT NULL,
	"binding_payload" jsonb NOT NULL,
	"bound_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "slice_rule_budget_proposal_bindings_identity" CHECK (
    "slice_rule_budget_proposal_bindings"."draft_hash" ~ '^[a-f0-9]{64}$'
    and "slice_rule_budget_proposal_bindings"."proposal_hash" ~ '^[a-f0-9]{64}$'
    and "slice_rule_budget_proposal_bindings"."proposal_ref" ~ '^budget_proposal_[a-f0-9]{20}$'
    and "slice_rule_budget_proposal_bindings"."idempotency_key" ~ '^[a-z][a-z0-9_.:-]{0,127}$'
  ),
	CONSTRAINT "slice_rule_budget_proposal_bindings_payload_exact" CHECK ((
    jsonb_typeof("slice_rule_budget_proposal_bindings"."binding_payload") = 'object'
    and "slice_rule_budget_proposal_bindings"."binding_payload" #>> '{draftHash}' = "slice_rule_budget_proposal_bindings"."draft_hash"
    and "slice_rule_budget_proposal_bindings"."binding_payload" #>> '{proposalHash}' = "slice_rule_budget_proposal_bindings"."proposal_hash"
    and "slice_rule_budget_proposal_bindings"."binding_payload" #>> '{proposalRef}' = "slice_rule_budget_proposal_bindings"."proposal_ref"
    and ("slice_rule_budget_proposal_bindings"."binding_payload" #>> '{boundAt}')::timestamptz = "slice_rule_budget_proposal_bindings"."bound_at"
    and "slice_rule_budget_proposal_bindings"."binding_payload" #> '{authority}' = '{
      "recommendationOnly": true, "canPublish": false, "canApprove": false,
      "canExecute": false, "canWriteMeta": false, "canEnableAutomation": false
    }'::jsonb
  ) is true)
);
--> statement-breakpoint
ALTER TABLE "slice_rule_budget_proposal_bindings" ADD CONSTRAINT "slice_rule_budget_proposal_bindings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slice_rule_budget_proposal_bindings" ADD CONSTRAINT "slice_rule_budget_proposal_bindings_draft_scope_fk" FOREIGN KEY ("workspace_id","draft_hash") REFERENCES "public"."slice_rule_workspace_drafts"("workspace_id","draft_hash") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slice_rule_budget_proposal_bindings" ADD CONSTRAINT "slice_rule_budget_proposal_bindings_proposal_scope_fk" FOREIGN KEY ("workspace_id","proposal_hash") REFERENCES "public"."budget_proposal_versions"("workspace_id","proposal_hash") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slice_rule_budget_proposal_bindings" ADD CONSTRAINT "slice_rule_budget_proposal_bindings_membership_scope_fk" FOREIGN KEY ("workspace_id","bound_by_actor_id") REFERENCES "public"."memberships"("workspace_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "slice_rule_budget_proposal_bindings_workspace_row_unique" ON "slice_rule_budget_proposal_bindings" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "slice_rule_budget_proposal_bindings_exact_unique" ON "slice_rule_budget_proposal_bindings" USING btree ("workspace_id","draft_hash","proposal_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "slice_rule_budget_proposal_bindings_idempotency_unique" ON "slice_rule_budget_proposal_bindings" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "slice_rule_budget_proposal_bindings_proposal_idx" ON "slice_rule_budget_proposal_bindings" USING btree ("workspace_id","proposal_hash","bound_at" DESC NULLS LAST);
--> statement-breakpoint
ALTER TABLE "slice_rule_budget_proposal_bindings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "slice_rule_budget_proposal_bindings" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "slice_rule_budget_proposal_bindings" FROM PUBLIC, anon, authenticated, service_role;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.slice_rule_budget_proposal_binding_append_only_guard()
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
  RAISE EXCEPTION 'slice rule budget proposal bindings are append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER slice_rule_budget_proposal_bindings_append_only
BEFORE UPDATE OR DELETE ON "slice_rule_budget_proposal_bindings"
FOR EACH ROW EXECUTE FUNCTION public.slice_rule_budget_proposal_binding_append_only_guard();
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION public.slice_rule_budget_proposal_binding_append_only_guard() FROM PUBLIC, anon, authenticated, service_role;
