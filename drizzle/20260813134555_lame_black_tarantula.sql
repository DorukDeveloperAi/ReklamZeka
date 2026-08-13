CREATE TABLE "slice_rule_budget_pool_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"draft_hash" text NOT NULL,
	"hierarchy_hash" text NOT NULL,
	"pool_ref" text NOT NULL,
	"market" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"bound_by_actor_id" uuid NOT NULL,
	"binding_payload" jsonb NOT NULL,
	"bound_at" timestamp with time zone NOT NULL,
	CONSTRAINT "slice_rule_budget_pool_bindings_identity" CHECK ("slice_rule_budget_pool_bindings"."draft_hash" ~ '^[a-f0-9]{64}$' and "slice_rule_budget_pool_bindings"."hierarchy_hash" ~ '^[a-f0-9]{64}$' and "slice_rule_budget_pool_bindings"."pool_ref" ~ '^budget_pool_[a-z0-9][a-z0-9_.:-]{0,119}$' and "slice_rule_budget_pool_bindings"."market" in ('domestic', 'international') and "slice_rule_budget_pool_bindings"."idempotency_key" ~ '^[a-z][a-z0-9_.:-]{0,127}$'),
	CONSTRAINT "slice_rule_budget_pool_bindings_payload_exact" CHECK ((jsonb_typeof("slice_rule_budget_pool_bindings"."binding_payload") = 'object' and "slice_rule_budget_pool_bindings"."binding_payload" #>> '{draftHash}' = "slice_rule_budget_pool_bindings"."draft_hash" and "slice_rule_budget_pool_bindings"."binding_payload" #>> '{hierarchyHash}' = "slice_rule_budget_pool_bindings"."hierarchy_hash" and "slice_rule_budget_pool_bindings"."binding_payload" #>> '{poolRef}' = "slice_rule_budget_pool_bindings"."pool_ref" and "slice_rule_budget_pool_bindings"."binding_payload" #>> '{market}' = "slice_rule_budget_pool_bindings"."market" and ("slice_rule_budget_pool_bindings"."binding_payload" #>> '{boundAt}')::timestamptz = "slice_rule_budget_pool_bindings"."bound_at" and "slice_rule_budget_pool_bindings"."binding_payload" #> '{authority}' = '{"canPublish":false,"canApprove":false,"canExecute":false,"canWriteMeta":false,"canEnableAutomation":false}'::jsonb) is true)
);
--> statement-breakpoint
ALTER TABLE "slice_rule_budget_pool_bindings" ADD CONSTRAINT "slice_rule_budget_pool_bindings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slice_rule_budget_pool_bindings" ADD CONSTRAINT "slice_rule_budget_pool_bindings_draft_scope_fk" FOREIGN KEY ("workspace_id","draft_hash") REFERENCES "public"."slice_rule_workspace_drafts"("workspace_id","draft_hash") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slice_rule_budget_pool_bindings" ADD CONSTRAINT "slice_rule_budget_pool_bindings_hierarchy_scope_fk" FOREIGN KEY ("workspace_id","hierarchy_hash") REFERENCES "public"."budget_pool_hierarchy_revisions"("workspace_id","hierarchy_hash") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slice_rule_budget_pool_bindings" ADD CONSTRAINT "slice_rule_budget_pool_bindings_membership_scope_fk" FOREIGN KEY ("workspace_id","bound_by_actor_id") REFERENCES "public"."memberships"("workspace_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "slice_rule_budget_pool_bindings_workspace_row_unique" ON "slice_rule_budget_pool_bindings" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "slice_rule_budget_pool_bindings_draft_unique" ON "slice_rule_budget_pool_bindings" USING btree ("workspace_id","draft_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "slice_rule_budget_pool_bindings_idempotency_unique" ON "slice_rule_budget_pool_bindings" USING btree ("workspace_id","idempotency_key");
--> statement-breakpoint
ALTER TABLE "slice_rule_budget_pool_bindings" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "slice_rule_budget_pool_bindings" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "slice_rule_budget_pool_bindings" FROM PUBLIC, anon, authenticated, service_role;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.slice_rule_budget_pool_binding_append_only_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' AND EXISTS (SELECT 1 FROM public.workspaces WHERE id = OLD.workspace_id AND lifecycle_state = 'tombstoning') THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'slice rule budget pool bindings are append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER slice_rule_budget_pool_bindings_append_only BEFORE UPDATE OR DELETE ON "slice_rule_budget_pool_bindings" FOR EACH ROW EXECUTE FUNCTION public.slice_rule_budget_pool_binding_append_only_guard();
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION public.slice_rule_budget_pool_binding_append_only_guard() FROM PUBLIC, anon, authenticated, service_role;
