CREATE TABLE "action_execution_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"bundle_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"decision_event_id" uuid NOT NULL,
	"approval_grant_id" uuid NOT NULL,
	"execution_ref" text NOT NULL,
	"unit_ref" text NOT NULL,
	"approval_decision_ref" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"admission_hash" text NOT NULL,
	"write_spec_hash" text NOT NULL,
	"admission_payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "action_execution_attempts_identity" CHECK (
    "action_execution_attempts"."execution_ref" ~ '^action_execution_[a-f0-9]{20}$'
    and "action_execution_attempts"."unit_ref" ~ '^action_unit_[a-f0-9]{20}$'
    and "action_execution_attempts"."approval_decision_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and "action_execution_attempts"."idempotency_key" ~ '^[a-f0-9]{64}$'
    and "action_execution_attempts"."admission_hash" ~ '^[a-f0-9]{64}$'
    and "action_execution_attempts"."write_spec_hash" ~ '^[a-f0-9]{64}$'
  ),
	CONSTRAINT "action_execution_attempts_payload_exact" CHECK (
    jsonb_typeof("action_execution_attempts"."admission_payload") = 'object'
    and "action_execution_attempts"."admission_payload" #>> '{version}' = 'action-execution-admission/1.0.0'
    and "action_execution_attempts"."admission_payload" #>> '{unitRef}' = "action_execution_attempts"."unit_ref"
    and "action_execution_attempts"."admission_payload" #>> '{approvalDecisionRef}' = "action_execution_attempts"."approval_decision_ref"
    and "action_execution_attempts"."admission_payload" #>> '{admissionHash}' = "action_execution_attempts"."admission_hash"
    and "action_execution_attempts"."admission_payload" #>> '{writeSpec,specHash}' = "action_execution_attempts"."write_spec_hash"
    and "action_execution_attempts"."admission_payload" #>> '{disposition}' = 'admitted_for_disabled_executor'
    and "action_execution_attempts"."admission_payload" #>> '{capabilities,canExecute}' = 'false'
    and "action_execution_attempts"."admission_payload" #>> '{capabilities,canWriteMeta}' = 'false'
    and "action_execution_attempts"."admission_payload" #>> '{capabilities,canDispatchNetwork}' = 'false'
  ),
	CONSTRAINT "action_execution_attempts_no_forbidden_material" CHECK (
    "action_execution_attempts"."admission_payload"::text !~* '"[^"[:space:]]*(token|secret|prompt|raw[_-]?(payload|request|response|json))"[[:space:]]*:'
  )
);
--> statement-breakpoint
CREATE TABLE "action_execution_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"execution_attempt_id" uuid NOT NULL,
	"sequence" integer NOT NULL,
	"event_ref" text NOT NULL,
	"previous_hash" text NOT NULL,
	"event_hash" text NOT NULL,
	"event_type" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"event_payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "action_execution_events_identity" CHECK (
    "action_execution_events"."sequence" >= 1
    and "action_execution_events"."event_ref" ~ '^action_execution_event_[a-f0-9]{20}$'
    and "action_execution_events"."previous_hash" ~ '^[a-f0-9]{64}$'
    and "action_execution_events"."event_hash" ~ '^[a-f0-9]{64}$'
    and "action_execution_events"."event_type" in ('admitted', 'dispatch_claimed', 'write_accepted', 'verified', 'failed', 'parked')
  ),
	CONSTRAINT "action_execution_events_payload_shape" CHECK (
    jsonb_typeof("action_execution_events"."event_payload") = 'object'
    and "action_execution_events"."event_payload" #>> '{executionAuthority}' = 'none'
    and "action_execution_events"."event_payload" #>> '{networkDispatched}' = 'false'
  ),
	CONSTRAINT "action_execution_events_no_forbidden_material" CHECK (
    "action_execution_events"."event_payload"::text !~* '"[^"[:space:]]*(token|secret|prompt|raw[_-]?(payload|request|response|json))"[[:space:]]*:'
  )
);
--> statement-breakpoint
ALTER TABLE "action_execution_attempts" ADD CONSTRAINT "action_execution_attempts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_execution_attempts" ADD CONSTRAINT "action_execution_attempts_bundle_scope_fk" FOREIGN KEY ("workspace_id","bundle_id") REFERENCES "public"."action_proposal_bundles"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_execution_attempts" ADD CONSTRAINT "action_execution_attempts_unit_scope_fk" FOREIGN KEY ("workspace_id","bundle_id","unit_id","unit_ref") REFERENCES "public"."action_proposal_units"("workspace_id","bundle_id","id","unit_ref") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_execution_attempts" ADD CONSTRAINT "action_execution_attempts_decision_scope_fk" FOREIGN KEY ("workspace_id","decision_event_id") REFERENCES "public"."action_approval_decision_events"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_execution_attempts" ADD CONSTRAINT "action_execution_attempts_grant_scope_fk" FOREIGN KEY ("workspace_id","approval_grant_id") REFERENCES "public"."action_approval_evidence_grants"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_execution_events" ADD CONSTRAINT "action_execution_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_execution_events" ADD CONSTRAINT "action_execution_events_attempt_scope_fk" FOREIGN KEY ("workspace_id","execution_attempt_id") REFERENCES "public"."action_execution_attempts"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "action_execution_attempts_workspace_row_unique" ON "action_execution_attempts" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "action_execution_attempts_workspace_ref_unique" ON "action_execution_attempts" USING btree ("workspace_id","execution_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "action_execution_attempts_workspace_idempotency_unique" ON "action_execution_attempts" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "action_execution_attempts_decision_unique" ON "action_execution_attempts" USING btree ("workspace_id","decision_event_id");--> statement-breakpoint
CREATE INDEX "action_execution_attempts_unit_idx" ON "action_execution_attempts" USING btree ("workspace_id","unit_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "action_execution_events_workspace_row_unique" ON "action_execution_events" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "action_execution_events_attempt_sequence_unique" ON "action_execution_events" USING btree ("execution_attempt_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "action_execution_events_workspace_ref_unique" ON "action_execution_events" USING btree ("workspace_id","event_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "action_execution_events_workspace_hash_unique" ON "action_execution_events" USING btree ("workspace_id","event_hash");--> statement-breakpoint
CREATE INDEX "action_execution_events_attempt_idx" ON "action_execution_events" USING btree ("workspace_id","execution_attempt_id","sequence");
--> statement-breakpoint
ALTER TABLE "action_execution_attempts" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "action_execution_attempts" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "action_execution_events" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "action_execution_events" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "action_execution_attempts" FROM PUBLIC, anon, authenticated, service_role;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "action_execution_events" FROM PUBLIC, anon, authenticated, service_role;
--> statement-breakpoint
CREATE FUNCTION action_execution_ledger_append_only() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND EXISTS (
    SELECT 1 FROM public.workspaces w
    WHERE w.id = OLD.workspace_id AND w.lifecycle_state = 'tombstoning'
  ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'action_execution_ledger_append_only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER action_execution_attempts_append_only_trigger
BEFORE UPDATE OR DELETE ON public.action_execution_attempts
FOR EACH ROW EXECUTE FUNCTION action_execution_ledger_append_only();
--> statement-breakpoint
CREATE TRIGGER action_execution_events_append_only_trigger
BEFORE UPDATE OR DELETE ON public.action_execution_events
FOR EACH ROW EXECUTE FUNCTION action_execution_ledger_append_only();
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION action_execution_ledger_append_only() FROM PUBLIC, anon, authenticated, service_role;
