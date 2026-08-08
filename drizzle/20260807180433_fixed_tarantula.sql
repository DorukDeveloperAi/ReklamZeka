CREATE TABLE "action_approval_decision_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"bundle_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"command_ref" text NOT NULL,
	"command_kind" text NOT NULL,
	"unit_ref" text NOT NULL,
	"unit_hash" text NOT NULL,
	"actor_ref" text NOT NULL,
	"actor_role" text NOT NULL,
	"decided_at" timestamp with time zone NOT NULL,
	"reason_code" text NOT NULL,
	"command_hash" text NOT NULL,
	"freshness_hash" text NOT NULL,
	"lifecycle_before_hash" text NOT NULL,
	"lifecycle_after_hash" text NOT NULL,
	"trace_after_hash" text NOT NULL,
	"command_payload" jsonb NOT NULL,
	"event_payloads" jsonb NOT NULL,
	"execution_authority" text DEFAULT 'none' NOT NULL,
	"execution_performed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "action_approval_decision_events_ordinal_positive" CHECK ("action_approval_decision_events"."ordinal" >= 1),
	CONSTRAINT "action_approval_decision_events_identity" CHECK (
    "action_approval_decision_events"."command_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and "action_approval_decision_events"."unit_ref" ~ '^action_unit_[a-f0-9]{20}$'
    and "action_approval_decision_events"."actor_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and "action_approval_decision_events"."actor_role" in ('owner', 'admin', 'operator')
    and "action_approval_decision_events"."reason_code" ~ '^[a-z][a-z0-9_.:-]{0,127}$'
    and "action_approval_decision_events"."command_kind" in ('approve', 'reject', 'request_changes')
  ),
	CONSTRAINT "action_approval_decision_events_hash_formats" CHECK (
    "action_approval_decision_events"."unit_hash" ~ '^[a-f0-9]{64}$'
    and "action_approval_decision_events"."command_hash" ~ '^[a-f0-9]{64}$'
    and "action_approval_decision_events"."freshness_hash" ~ '^[a-f0-9]{64}$'
    and "action_approval_decision_events"."lifecycle_before_hash" ~ '^[a-f0-9]{64}$'
    and "action_approval_decision_events"."lifecycle_after_hash" ~ '^[a-f0-9]{64}$'
    and "action_approval_decision_events"."trace_after_hash" ~ '^[a-f0-9]{64}$'
  ),
	CONSTRAINT "action_approval_decision_events_exact" CHECK (
    jsonb_typeof("action_approval_decision_events"."command_payload") = 'object'
    and "action_approval_decision_events"."command_payload" #>> '{commandRef}' = "action_approval_decision_events"."command_ref"
    and "action_approval_decision_events"."command_payload" #>> '{kind}' = "action_approval_decision_events"."command_kind"
    and "action_approval_decision_events"."command_payload" #>> '{unitRef}' = "action_approval_decision_events"."unit_ref"
    and "action_approval_decision_events"."command_payload" #>> '{actor,actorRef}' = "action_approval_decision_events"."actor_ref"
    and "action_approval_decision_events"."command_payload" #>> '{actor,role}' = "action_approval_decision_events"."actor_role"
    and ("action_approval_decision_events"."command_payload" #>> '{decidedAt}')::timestamptz = "action_approval_decision_events"."decided_at"
    and "action_approval_decision_events"."command_payload" #>> '{reasonCode}' = "action_approval_decision_events"."reason_code"
    and jsonb_typeof("action_approval_decision_events"."command_payload" #> '{freshness}') = 'array'
    and jsonb_typeof("action_approval_decision_events"."event_payloads") = 'array'
    and jsonb_array_length("action_approval_decision_events"."event_payloads") >= 1
    and "action_approval_decision_events"."execution_authority" = 'none'
    and "action_approval_decision_events"."execution_performed" = false
  ),
	CONSTRAINT "action_approval_decision_events_approval_shape" CHECK (
    ("action_approval_decision_events"."command_kind" = 'approve'
      and "action_approval_decision_events"."command_payload" #>> '{authorization,humanPresence}' = 'true'
      and "action_approval_decision_events"."command_payload" #>> '{authorization,canExecute}' = 'false'
      and "action_approval_decision_events"."command_payload" ? 'grantRef')
    or ("action_approval_decision_events"."command_kind" in ('reject', 'request_changes')
      and not ("action_approval_decision_events"."command_payload" ? 'authorization')
      and not ("action_approval_decision_events"."command_payload" ? 'grantRef'))
  ),
	CONSTRAINT "action_approval_decision_events_no_authority" CHECK (
    not jsonb_path_exists("action_approval_decision_events"."command_payload" - 'authorization', '$.** ? (@.type() == "object").keyvalue() ? (@.key like_regex "^(actionauthority|executionauthority|writeauthority|writeenabled|canexecute|canwrite|approvalgranted|execute|write)$" flag "i")')
    and not jsonb_path_exists("action_approval_decision_events"."event_payloads", '$.** ? (@.type() == "object").keyvalue() ? (@.key like_regex "^(actionauthority|writeauthority|writeenabled|canexecute|canwrite|approvalgranted|grant|authorization|execute|write)$" flag "i")')
  ),
	CONSTRAINT "action_approval_decision_events_no_forbidden_material" CHECK (
    ("action_approval_decision_events"."command_payload"::text || "action_approval_decision_events"."event_payloads"::text)
      !~* '"[^"[:space:]]*(token|secret|prompt|raw[_-]?(payload|request|response|json))"[[:space:]]*:'
  )
);
--> statement-breakpoint
CREATE TABLE "action_approval_evidence_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"bundle_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"decision_event_id" uuid NOT NULL,
	"grant_ref" text NOT NULL,
	"unit_ref" text NOT NULL,
	"unit_hash" text NOT NULL,
	"scope_hash" text NOT NULL,
	"plan_ref" text NOT NULL,
	"plan_revision" integer NOT NULL,
	"plan_hash" text NOT NULL,
	"approver_ref" text NOT NULL,
	"approver_role" text NOT NULL,
	"approved_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"grant_hash" text NOT NULL,
	"grant_payload" jsonb NOT NULL,
	"capability" text DEFAULT 'approval_evidence_only' NOT NULL,
	"can_execute" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "action_approval_evidence_grants_identity" CHECK (
    "action_approval_evidence_grants"."grant_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and "action_approval_evidence_grants"."unit_ref" ~ '^action_unit_[a-f0-9]{20}$'
    and "action_approval_evidence_grants"."plan_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and "action_approval_evidence_grants"."approver_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and "action_approval_evidence_grants"."approver_role" in ('owner', 'admin', 'operator')
    and "action_approval_evidence_grants"."plan_revision" >= 1
  ),
	CONSTRAINT "action_approval_evidence_grants_hash_formats" CHECK (
    "action_approval_evidence_grants"."unit_hash" ~ '^[a-f0-9]{64}$'
    and "action_approval_evidence_grants"."scope_hash" ~ '^[a-f0-9]{64}$'
    and "action_approval_evidence_grants"."plan_hash" ~ '^[a-f0-9]{64}$'
    and "action_approval_evidence_grants"."grant_hash" ~ '^[a-f0-9]{64}$'
  ),
	CONSTRAINT "action_approval_evidence_grants_exact" CHECK (
    jsonb_typeof("action_approval_evidence_grants"."grant_payload") = 'object'
    and "action_approval_evidence_grants"."grant_payload" #>> '{version}' = 'action-approval-grant/1.0.0'
    and "action_approval_evidence_grants"."grant_payload" #>> '{grantRef}' = "action_approval_evidence_grants"."grant_ref"
    and "action_approval_evidence_grants"."grant_payload" #>> '{unitRef}' = "action_approval_evidence_grants"."unit_ref"
    and "action_approval_evidence_grants"."grant_payload" #>> '{unitHash}' = "action_approval_evidence_grants"."unit_hash"
    and "action_approval_evidence_grants"."grant_payload" #>> '{scopeHash}' = "action_approval_evidence_grants"."scope_hash"
    and "action_approval_evidence_grants"."grant_payload" #>> '{planRef}' = "action_approval_evidence_grants"."plan_ref"
    and ("action_approval_evidence_grants"."grant_payload" #>> '{planRevision}')::integer = "action_approval_evidence_grants"."plan_revision"
    and "action_approval_evidence_grants"."grant_payload" #>> '{planHash}' = "action_approval_evidence_grants"."plan_hash"
    and "action_approval_evidence_grants"."grant_payload" #>> '{approver,actorRef}' = "action_approval_evidence_grants"."approver_ref"
    and "action_approval_evidence_grants"."grant_payload" #>> '{approver,role}' = "action_approval_evidence_grants"."approver_role"
    and ("action_approval_evidence_grants"."grant_payload" #>> '{approvedAt}')::timestamptz = "action_approval_evidence_grants"."approved_at"
    and ("action_approval_evidence_grants"."grant_payload" #>> '{expiresAt}')::timestamptz = "action_approval_evidence_grants"."expires_at"
    and "action_approval_evidence_grants"."grant_payload" #>> '{grantHash}' = "action_approval_evidence_grants"."grant_hash"
    and "action_approval_evidence_grants"."grant_payload" #>> '{singleUse}' = 'true'
    and "action_approval_evidence_grants"."grant_payload" #> '{consumedAt}' = 'null'::jsonb
    and "action_approval_evidence_grants"."grant_payload" #> '{consumedBy}' = 'null'::jsonb
    and "action_approval_evidence_grants"."grant_payload" #>> '{capability}' = 'approval_evidence_only'
    and "action_approval_evidence_grants"."grant_payload" #>> '{canExecute}' = 'false'
    and "action_approval_evidence_grants"."capability" = 'approval_evidence_only'
    and "action_approval_evidence_grants"."can_execute" = false
    and "action_approval_evidence_grants"."expires_at" > "action_approval_evidence_grants"."approved_at"
  ),
	CONSTRAINT "action_approval_evidence_grants_no_forbidden_material" CHECK (
    "action_approval_evidence_grants"."grant_payload"::text
      !~* '"[^"[:space:]]*(token|secret|prompt|raw[_-]?(payload|request|response|json))"[[:space:]]*:'
  )
);
--> statement-breakpoint
ALTER TABLE "action_approval_decision_events" ADD CONSTRAINT "action_approval_decision_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_approval_decision_events" ADD CONSTRAINT "action_approval_decision_events_bundle_scope_fk" FOREIGN KEY ("workspace_id","bundle_id") REFERENCES "public"."action_proposal_bundles"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_approval_decision_events" ADD CONSTRAINT "action_approval_decision_events_unit_scope_fk" FOREIGN KEY ("workspace_id","bundle_id","unit_id","unit_ref") REFERENCES "public"."action_proposal_units"("workspace_id","bundle_id","id","unit_ref") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_approval_evidence_grants" ADD CONSTRAINT "action_approval_evidence_grants_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_approval_evidence_grants" ADD CONSTRAINT "action_approval_evidence_grants_bundle_scope_fk" FOREIGN KEY ("workspace_id","bundle_id") REFERENCES "public"."action_proposal_bundles"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_approval_evidence_grants" ADD CONSTRAINT "action_approval_evidence_grants_unit_scope_fk" FOREIGN KEY ("workspace_id","bundle_id","unit_id","unit_ref") REFERENCES "public"."action_proposal_units"("workspace_id","bundle_id","id","unit_ref") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "action_approval_decision_events_workspace_row_unique" ON "action_approval_decision_events" USING btree ("workspace_id","id");--> statement-breakpoint
ALTER TABLE "action_approval_evidence_grants" ADD CONSTRAINT "action_approval_evidence_grants_decision_scope_fk" FOREIGN KEY ("workspace_id","decision_event_id") REFERENCES "public"."action_approval_decision_events"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "action_approval_decision_events_bundle_ordinal_unique" ON "action_approval_decision_events" USING btree ("workspace_id","bundle_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "action_approval_decision_events_bundle_unit_unique" ON "action_approval_decision_events" USING btree ("workspace_id","bundle_id","unit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "action_approval_decision_events_workspace_command_unique" ON "action_approval_decision_events" USING btree ("workspace_id","command_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "action_approval_decision_events_workspace_hash_unique" ON "action_approval_decision_events" USING btree ("workspace_id","command_hash");--> statement-breakpoint
CREATE INDEX "action_approval_decision_events_bundle_idx" ON "action_approval_decision_events" USING btree ("workspace_id","bundle_id","ordinal");--> statement-breakpoint
CREATE INDEX "action_approval_decision_events_unit_idx" ON "action_approval_decision_events" USING btree ("unit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "action_approval_evidence_grants_workspace_row_unique" ON "action_approval_evidence_grants" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "action_approval_evidence_grants_decision_unique" ON "action_approval_evidence_grants" USING btree ("workspace_id","decision_event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "action_approval_evidence_grants_bundle_unit_unique" ON "action_approval_evidence_grants" USING btree ("workspace_id","bundle_id","unit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "action_approval_evidence_grants_workspace_ref_unique" ON "action_approval_evidence_grants" USING btree ("workspace_id","grant_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "action_approval_evidence_grants_workspace_hash_unique" ON "action_approval_evidence_grants" USING btree ("workspace_id","grant_hash");--> statement-breakpoint
CREATE INDEX "action_approval_evidence_grants_bundle_idx" ON "action_approval_evidence_grants" USING btree ("workspace_id","bundle_id");--> statement-breakpoint
CREATE INDEX "action_approval_evidence_grants_unit_idx" ON "action_approval_evidence_grants" USING btree ("unit_id");--> statement-breakpoint
ALTER TABLE "action_approval_decision_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "action_approval_evidence_grants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "action_approval_decision_events" FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "action_approval_evidence_grants" FROM PUBLIC, anon, authenticated;--> statement-breakpoint
CREATE FUNCTION action_approval_decision_append_only() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'action_approval_decision_append_only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER action_approval_decision_events_append_only_trigger
BEFORE UPDATE ON action_approval_decision_events
FOR EACH ROW EXECUTE FUNCTION action_approval_decision_append_only();--> statement-breakpoint
CREATE TRIGGER action_approval_evidence_grants_append_only_trigger
BEFORE UPDATE ON action_approval_evidence_grants
FOR EACH ROW EXECUTE FUNCTION action_approval_decision_append_only();--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION action_approval_decision_append_only() FROM PUBLIC, anon, authenticated;
