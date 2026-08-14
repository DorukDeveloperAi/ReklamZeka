CREATE TABLE "action_preparation_gate_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"selection_id" uuid,
	"action_proposal_unit_id" uuid,
	"stage" text NOT NULL,
	"evaluation_hash" text NOT NULL,
	"snapshot_payload" jsonb NOT NULL,
	"evaluated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "action_preparation_gate_snapshots_subject_exact" CHECK (num_nonnulls("action_preparation_gate_snapshots"."selection_id", "action_preparation_gate_snapshots"."action_proposal_unit_id") = 1),
	CONSTRAINT "action_preparation_gate_snapshots_identity" CHECK ("action_preparation_gate_snapshots"."stage" in ('selection', 'materialization', 'approval', 'admission') and "action_preparation_gate_snapshots"."evaluation_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "action_preparation_gate_snapshots_payload_exact" CHECK ((
    jsonb_typeof("action_preparation_gate_snapshots"."snapshot_payload") = 'object'
    and "action_preparation_gate_snapshots"."snapshot_payload" #>> '{version}' = 'action-preparation-gate-snapshot/1.0.0'
    and "action_preparation_gate_snapshots"."snapshot_payload" #>> '{stage}' = "action_preparation_gate_snapshots"."stage"
    and "action_preparation_gate_snapshots"."snapshot_payload" #>> '{evaluationHash}' = "action_preparation_gate_snapshots"."evaluation_hash"
    and "action_preparation_gate_snapshots"."snapshot_payload" #>> '{deliveryHold}' = 'false'
    and "action_preparation_gate_snapshots"."snapshot_payload" #>> '{actionPreparation,key}' = 'action_preparation'
    and "action_preparation_gate_snapshots"."snapshot_payload" #>> '{actionPreparation,enabled}' = 'false'
    and "action_preparation_gate_snapshots"."snapshot_payload" #>> '{authority,canExecute}' = 'false'
    and "action_preparation_gate_snapshots"."snapshot_payload" #>> '{authority,canDispatchNetwork}' = 'false'
    and "action_preparation_gate_snapshots"."snapshot_payload" #>> '{authority,canWriteMeta}' = 'false'
  ) is true),
	CONSTRAINT "action_preparation_gate_snapshots_no_forbidden_material" CHECK ("action_preparation_gate_snapshots"."snapshot_payload"::text !~* '"[^"[:space:]]*(token|secret|prompt|authorization|raw[_-]?(payload|request|response|json))"[[:space:]]*:')
);
--> statement-breakpoint
ALTER TABLE "action_preparation_gate_snapshots" ADD CONSTRAINT "action_preparation_gate_snapshots_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_preparation_gate_snapshots" ADD CONSTRAINT "action_preparation_gate_snapshots_selection_scope_fk" FOREIGN KEY ("workspace_id","selection_id") REFERENCES "public"."slice_rule_scenario_allocation_selections"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_preparation_gate_snapshots" ADD CONSTRAINT "action_preparation_gate_snapshots_unit_scope_fk" FOREIGN KEY ("workspace_id","action_proposal_unit_id") REFERENCES "public"."action_proposal_units"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "action_preparation_gate_snapshots_workspace_row_unique" ON "action_preparation_gate_snapshots" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "action_preparation_gate_snapshots_exact_unique" ON "action_preparation_gate_snapshots" USING btree ("workspace_id","stage","evaluation_hash");--> statement-breakpoint
CREATE INDEX "action_preparation_gate_snapshots_selection_idx" ON "action_preparation_gate_snapshots" USING btree ("workspace_id","selection_id","stage","evaluated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "action_preparation_gate_snapshots_unit_idx" ON "action_preparation_gate_snapshots" USING btree ("workspace_id","action_proposal_unit_id","stage","evaluated_at" DESC NULLS LAST);
--> statement-breakpoint
ALTER TABLE "action_preparation_gate_snapshots" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "action_preparation_gate_snapshots" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "action_preparation_gate_snapshots" FROM PUBLIC, anon, authenticated, service_role;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.action_preparation_gate_snapshot_append_only_guard()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'action_preparation_gate_snapshots are append-only'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.workspaces WHERE id = OLD.workspace_id AND lifecycle_state = 'tombstoning') THEN
    RAISE EXCEPTION 'action_preparation_gate_snapshots may only be deleted during workspace tombstone';
  END IF;
  RETURN OLD;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER action_preparation_gate_snapshots_append_only
BEFORE UPDATE OR DELETE ON "action_preparation_gate_snapshots"
FOR EACH ROW EXECUTE FUNCTION public.action_preparation_gate_snapshot_append_only_guard();
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION public.action_preparation_gate_snapshot_append_only_guard() FROM PUBLIC, anon, authenticated, service_role;
