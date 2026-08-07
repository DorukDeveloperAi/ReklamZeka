ALTER TABLE "decision_room_runs" ADD COLUMN "trigger_ref" text;--> statement-breakpoint
ALTER TABLE "decision_room_runs" ADD COLUMN "account_ref" text;--> statement-breakpoint
ALTER TABLE "decision_room_runs" ADD COLUMN "campaign_ref" text;--> statement-breakpoint
ALTER TABLE "decision_room_runs" ADD COLUMN "timeframe_ref" text;--> statement-breakpoint
ALTER TABLE "decision_room_runs" ADD COLUMN "template_ref" text;--> statement-breakpoint
CREATE INDEX "decision_room_inbox_items_read_page_idx" ON "decision_room_inbox_items" USING btree ("workspace_id","created_at","notification_ref");--> statement-breakpoint
CREATE INDEX "decision_room_runs_read_page_idx" ON "decision_room_runs" USING btree ("workspace_id","started_at","run_ref");--> statement-breakpoint
ALTER TABLE "decision_room_runs" ADD CONSTRAINT "decision_room_runs_trace_refs" CHECK (
    ("decision_room_runs"."trigger_ref" is null and "decision_room_runs"."account_ref" is null and "decision_room_runs"."campaign_ref" is null
      and "decision_room_runs"."timeframe_ref" is null and "decision_room_runs"."template_ref" is null)
    or ("decision_room_runs"."trigger_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_-]{0,94}$'
      and btrim("decision_room_runs"."account_ref") <> '' and length("decision_room_runs"."account_ref") <= 256
      and btrim("decision_room_runs"."campaign_ref") <> '' and length("decision_room_runs"."campaign_ref") <= 256
      and "decision_room_runs"."timeframe_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_-]{0,94}$'
      and "decision_room_runs"."template_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_-]{0,94}$'
      and concat_ws('|', "decision_room_runs"."trigger_ref", "decision_room_runs"."account_ref", "decision_room_runs"."campaign_ref", "decision_room_runs"."timeframe_ref", "decision_room_runs"."template_ref")
        !~* '(token|secret|prompt|raw[_-]?(payload|request|response|json))')
  );