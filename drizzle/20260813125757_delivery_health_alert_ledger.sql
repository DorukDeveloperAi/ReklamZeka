CREATE TABLE "delivery_health_alert_ledger_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"alert_ref" text NOT NULL,
	"account_ref" text NOT NULL,
	"sequence" integer NOT NULL,
	"previous_record_hash" text NOT NULL,
	"record_hash" text NOT NULL,
	"alert_hash" text NOT NULL,
	"evidence_hash" text NOT NULL,
	"evidence_level" text NOT NULL,
	"official_state" text,
	"status" text NOT NULL,
	"recommendation_disposition" text NOT NULL,
	"assigned_actor_ref" text NOT NULL,
	"checklist_payload" jsonb NOT NULL,
	"event_type" text NOT NULL,
	"event_actor_ref" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_by_actor_id" uuid NOT NULL,
	"record_payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "delivery_health_alert_ledger_records_identity" CHECK (
    "delivery_health_alert_ledger_records"."alert_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and "delivery_health_alert_ledger_records"."account_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and "delivery_health_alert_ledger_records"."sequence" between 1 and 1000000
    and (("delivery_health_alert_ledger_records"."sequence" = 1 and "delivery_health_alert_ledger_records"."previous_record_hash" = 'GENESIS')
      or ("delivery_health_alert_ledger_records"."sequence" > 1 and "delivery_health_alert_ledger_records"."previous_record_hash" ~ '^[a-f0-9]{64}$'))
    and "delivery_health_alert_ledger_records"."record_hash" ~ '^[a-f0-9]{64}$'
    and "delivery_health_alert_ledger_records"."alert_hash" ~ '^[a-f0-9]{64}$'
    and "delivery_health_alert_ledger_records"."evidence_hash" ~ '^[a-f0-9]{64}$'
    and "delivery_health_alert_ledger_records"."evidence_level" in ('confirmed', 'suspected')
    and (("delivery_health_alert_ledger_records"."evidence_level" = 'confirmed' and "delivery_health_alert_ledger_records"."official_state" in
      ('payment_required', 'account_disabled', 'delivery_rejected', 'delivery_limited'))
      or ("delivery_health_alert_ledger_records"."evidence_level" = 'suspected' and "delivery_health_alert_ledger_records"."official_state" is null))
    and "delivery_health_alert_ledger_records"."status" in ('open', 'investigating', 'resolved')
    and "delivery_health_alert_ledger_records"."recommendation_disposition" in ('hold_recommendations', 'needs_human_review', 'released')
    and ("delivery_health_alert_ledger_records"."status" = 'resolved') = ("delivery_health_alert_ledger_records"."recommendation_disposition" = 'released')
    and ("delivery_health_alert_ledger_records"."evidence_level" <> 'confirmed' or "delivery_health_alert_ledger_records"."status" = 'resolved'
      or "delivery_health_alert_ledger_records"."recommendation_disposition" = 'hold_recommendations')
    and ("delivery_health_alert_ledger_records"."evidence_level" <> 'suspected' or "delivery_health_alert_ledger_records"."status" = 'resolved'
      or "delivery_health_alert_ledger_records"."recommendation_disposition" = 'needs_human_review')
    and "delivery_health_alert_ledger_records"."assigned_actor_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and "delivery_health_alert_ledger_records"."event_actor_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and "delivery_health_alert_ledger_records"."event_type" in ('detected', 'assign', 'start_investigation', 'set_checklist_item', 'resolve', 'reopen')
  ),
	CONSTRAINT "delivery_health_alert_ledger_records_checklist_exact" CHECK (
    jsonb_typeof("delivery_health_alert_ledger_records"."checklist_payload") = 'object'
    and "delivery_health_alert_ledger_records"."checklist_payload" ?& array['verify_evidence', 'inspect_account_and_delivery',
      'confirm_recovery_or_false_positive', 'notify_responsible']
    and "delivery_health_alert_ledger_records"."checklist_payload" - array['verify_evidence', 'inspect_account_and_delivery',
      'confirm_recovery_or_false_positive', 'notify_responsible'] = '{}'::jsonb
    and jsonb_typeof("delivery_health_alert_ledger_records"."checklist_payload" #> '{verify_evidence}') = 'boolean'
    and jsonb_typeof("delivery_health_alert_ledger_records"."checklist_payload" #> '{inspect_account_and_delivery}') = 'boolean'
    and jsonb_typeof("delivery_health_alert_ledger_records"."checklist_payload" #> '{confirm_recovery_or_false_positive}') = 'boolean'
    and jsonb_typeof("delivery_health_alert_ledger_records"."checklist_payload" #> '{notify_responsible}') = 'boolean'
  ),
	CONSTRAINT "delivery_health_alert_ledger_records_payload_exact" CHECK ((
    jsonb_typeof("delivery_health_alert_ledger_records"."record_payload") = 'object'
    and "delivery_health_alert_ledger_records"."record_payload" #>> '{version}' = 'delivery-health-alert-ledger/1.0.0'
    and "delivery_health_alert_ledger_records"."record_payload" #>> '{alert,workspaceRef}' is not null
    and "delivery_health_alert_ledger_records"."record_payload" #>> '{alert,alertRef}' = "delivery_health_alert_ledger_records"."alert_ref"
    and "delivery_health_alert_ledger_records"."record_payload" #>> '{alert,accountRef}' = "delivery_health_alert_ledger_records"."account_ref"
    and "delivery_health_alert_ledger_records"."record_payload" #>> '{alert,alertHash}' = "delivery_health_alert_ledger_records"."alert_hash"
    and "delivery_health_alert_ledger_records"."record_payload" #>> '{alert,evidenceHash}' = "delivery_health_alert_ledger_records"."evidence_hash"
    and "delivery_health_alert_ledger_records"."record_payload" #>> '{alert,evidence,level}' = "delivery_health_alert_ledger_records"."evidence_level"
    and ("delivery_health_alert_ledger_records"."record_payload" #>> '{alert,evidence,officialState}') is not distinct from "delivery_health_alert_ledger_records"."official_state"
    and ("delivery_health_alert_ledger_records"."record_payload" #>> '{sequence}')::integer = "delivery_health_alert_ledger_records"."sequence"
    and "delivery_health_alert_ledger_records"."record_payload" #>> '{previousRecordHash}' = "delivery_health_alert_ledger_records"."previous_record_hash"
    and "delivery_health_alert_ledger_records"."record_payload" #>> '{recordHash}' = "delivery_health_alert_ledger_records"."record_hash"
    and "delivery_health_alert_ledger_records"."record_payload" #>> '{current,status}' = "delivery_health_alert_ledger_records"."status"
    and "delivery_health_alert_ledger_records"."record_payload" #>> '{current,recommendationDisposition}' = "delivery_health_alert_ledger_records"."recommendation_disposition"
    and "delivery_health_alert_ledger_records"."record_payload" #>> '{current,assignedActorRef}' = "delivery_health_alert_ledger_records"."assigned_actor_ref"
    and "delivery_health_alert_ledger_records"."record_payload" #> '{current,checklist}' = "delivery_health_alert_ledger_records"."checklist_payload"
    and "delivery_health_alert_ledger_records"."record_payload" #>> '{event,kind}' = "delivery_health_alert_ledger_records"."event_type"
    and "delivery_health_alert_ledger_records"."record_payload" #>> '{event,actorRef}' = "delivery_health_alert_ledger_records"."event_actor_ref"
    and ("delivery_health_alert_ledger_records"."record_payload" #>> '{event,occurredAt}')::timestamptz = "delivery_health_alert_ledger_records"."occurred_at"
    and "delivery_health_alert_ledger_records"."record_payload" #> '{authority}' = '{
      "canApprove": false, "canExecute": false,
      "canWriteMeta": false, "canEnableAutomation": false
    }'::jsonb
  ) is true),
	CONSTRAINT "delivery_health_alert_ledger_records_no_forbidden_authority" CHECK (
    "delivery_health_alert_ledger_records"."record_payload"::text !~* '"(approvalGranted|writeEnabled|policyPublished|actionAuthorized)"[[:space:]]*:[[:space:]]*true'
    and "delivery_health_alert_ledger_records"."record_payload"::text !~* '"[^"[:space:]]*(token|secret|authorization|raw[_-]?(payload|request|response|json))"[[:space:]]*:'
  )
);
--> statement-breakpoint
ALTER TABLE "delivery_health_alert_ledger_records" ADD CONSTRAINT "delivery_health_alert_ledger_records_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delivery_health_alert_ledger_records" ADD CONSTRAINT "delivery_health_alert_ledger_records_membership_scope_fk" FOREIGN KEY ("workspace_id","created_by_actor_id") REFERENCES "public"."memberships"("workspace_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_health_alert_ledger_records_workspace_row_unique" ON "delivery_health_alert_ledger_records" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_health_alert_ledger_records_alert_sequence_unique" ON "delivery_health_alert_ledger_records" USING btree ("workspace_id","alert_ref","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "delivery_health_alert_ledger_records_workspace_hash_unique" ON "delivery_health_alert_ledger_records" USING btree ("workspace_id","record_hash");--> statement-breakpoint
CREATE INDEX "delivery_health_alert_ledger_records_current_idx" ON "delivery_health_alert_ledger_records" USING btree ("workspace_id","status","occurred_at","alert_ref","sequence");--> statement-breakpoint
ALTER TABLE "delivery_health_alert_ledger_records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "delivery_health_alert_ledger_records" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "delivery_health_alert_ledger_records" FROM PUBLIC, anon, authenticated, service_role;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.delivery_health_alert_ledger_records_append_only_guard()
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
  RAISE EXCEPTION 'delivery health alert ledger records are append-only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER delivery_health_alert_ledger_records_append_only
BEFORE UPDATE OR DELETE ON "delivery_health_alert_ledger_records"
FOR EACH ROW EXECUTE FUNCTION public.delivery_health_alert_ledger_records_append_only_guard();--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION public.delivery_health_alert_ledger_records_append_only_guard() FROM PUBLIC, anon, authenticated, service_role;
