CREATE TABLE "decision_room_inbox_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"notification_ref" text NOT NULL,
	"channel" text DEFAULT 'in_app_inbox' NOT NULL,
	"analysis_ref" text NOT NULL,
	"summary_code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decision_room_inbox_items_channel" CHECK ("decision_room_inbox_items"."channel" = 'in_app_inbox'),
	CONSTRAINT "decision_room_inbox_items_format" CHECK (
    "decision_room_inbox_items"."notification_ref" ~ '^inbox_[a-f0-9]{20}$'
    and "decision_room_inbox_items"."analysis_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_-]{0,94}$'
    and "decision_room_inbox_items"."summary_code" ~ '^[a-z0-9][a-z0-9_:-]{0,127}$'
  )
);
--> statement-breakpoint
CREATE TABLE "decision_room_inbox_reads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"inbox_item_id" uuid NOT NULL,
	"reader_ref" text NOT NULL,
	"read_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decision_room_inbox_reads_reader_required" CHECK (
    "decision_room_inbox_reads"."reader_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_-]{0,94}$'
    and "decision_room_inbox_reads"."reader_ref" !~* '(token|secret|prompt|raw[_-]?(payload|request|response|json))'
  )
);
--> statement-breakpoint
CREATE TABLE "decision_room_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"schedule_id" uuid,
	"ad_account_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"trigger_kind" text NOT NULL,
	"schedule_definition_hash" text,
	"idempotency_key" text NOT NULL,
	"scope_key" text NOT NULL,
	"run_ref" text NOT NULL,
	"state" text NOT NULL,
	"lease_token" uuid,
	"lease_until" timestamp with time zone,
	"attempt" integer DEFAULT 0 NOT NULL,
	"analysis_ref" text,
	"summary_code" text,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decision_room_runs_identity" CHECK (
    "decision_room_runs"."idempotency_key" ~ '^idempotency_[a-f0-9]{32}$'
    and "decision_room_runs"."scope_key" ~ '^[a-f0-9]{64}$'
    and "decision_room_runs"."run_ref" ~ '^run_[a-f0-9]{20}$'
  ),
	CONSTRAINT "decision_room_runs_state" CHECK ("decision_room_runs"."state" in ('running', 'completed', 'failed')),
	CONSTRAINT "decision_room_runs_trigger" CHECK (
    ("decision_room_runs"."trigger_kind" = 'manual' and "decision_room_runs"."schedule_id" is null and "decision_room_runs"."schedule_definition_hash" is null)
    or ("decision_room_runs"."trigger_kind" = 'scheduled' and "decision_room_runs"."schedule_id" is not null
      and "decision_room_runs"."schedule_definition_hash" ~ '^[a-f0-9]{64}$')
  ),
	CONSTRAINT "decision_room_runs_attempt_positive" CHECK ("decision_room_runs"."attempt" >= 1),
	CONSTRAINT "decision_room_runs_state_shape" CHECK ((
    ("decision_room_runs"."state" = 'running' and "decision_room_runs"."lease_token" is not null and "decision_room_runs"."lease_until" is not null
      and "decision_room_runs"."analysis_ref" is null and "decision_room_runs"."summary_code" is null and "decision_room_runs"."completed_at" is null)
    or ("decision_room_runs"."state" = 'completed' and "decision_room_runs"."lease_token" is null and "decision_room_runs"."lease_until" is null
      and "decision_room_runs"."analysis_ref" is not null and "decision_room_runs"."summary_code" is not null and "decision_room_runs"."completed_at" is not null)
    or ("decision_room_runs"."state" = 'failed' and "decision_room_runs"."lease_token" is null and "decision_room_runs"."lease_until" is null
      and "decision_room_runs"."analysis_ref" is null and "decision_room_runs"."summary_code" is null and "decision_room_runs"."failed_at" is not null)
  ) is true),
	CONSTRAINT "decision_room_runs_completion_format" CHECK (
    ("decision_room_runs"."analysis_ref" is null or "decision_room_runs"."analysis_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_-]{0,94}$')
    and ("decision_room_runs"."summary_code" is null or "decision_room_runs"."summary_code" ~ '^[a-z0-9][a-z0-9_:-]{0,127}$')
  )
);
--> statement-breakpoint
CREATE TABLE "decision_room_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"schedule_ref" text NOT NULL,
	"revision" integer NOT NULL,
	"definition_version" text NOT NULL,
	"definition_hash" text NOT NULL,
	"workspace_ref" text NOT NULL,
	"account_ref" text NOT NULL,
	"campaign_ref" text NOT NULL,
	"timeframe_ref" text NOT NULL,
	"template_ref" text NOT NULL,
	"timezone" text NOT NULL,
	"local_time" text NOT NULL,
	"frequency" text NOT NULL,
	"day_of_week" integer,
	"enabled" boolean NOT NULL,
	"catch_up_policy" text NOT NULL,
	"tick_grace_minutes" integer NOT NULL,
	"last_scheduled_for" timestamp with time zone,
	"next_run_at" timestamp with time zone,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decision_room_schedules_required" CHECK (
    btrim("decision_room_schedules"."schedule_ref") <> '' and btrim("decision_room_schedules"."workspace_ref") <> ''
    and btrim("decision_room_schedules"."account_ref") <> '' and btrim("decision_room_schedules"."campaign_ref") <> ''
    and btrim("decision_room_schedules"."timeframe_ref") <> '' and btrim("decision_room_schedules"."template_ref") <> ''
    and btrim("decision_room_schedules"."timezone") <> ''
  ),
	CONSTRAINT "decision_room_schedules_revision" CHECK (
    "decision_room_schedules"."revision" >= 1 and "decision_room_schedules"."definition_version" = 'decision-room-schedule/1.0.0'
    and "decision_room_schedules"."definition_hash" ~ '^[a-f0-9]{64}$'
  ),
	CONSTRAINT "decision_room_schedules_frequency" CHECK (
    ("decision_room_schedules"."frequency" = 'daily' and "decision_room_schedules"."day_of_week" is null)
    or ("decision_room_schedules"."frequency" = 'weekly' and "decision_room_schedules"."day_of_week" between 0 and 6)
  ),
	CONSTRAINT "decision_room_schedules_policy" CHECK (
    "decision_room_schedules"."local_time" ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'
    and "decision_room_schedules"."catch_up_policy" in ('skip', 'run_once')
    and "decision_room_schedules"."tick_grace_minutes" between 0 and 60
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "decision_room_inbox_items_workspace_row_unique" ON "decision_room_inbox_items" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "decision_room_runs_workspace_row_unique" ON "decision_room_runs" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "decision_room_schedules_workspace_row_unique" ON "decision_room_schedules" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "decision_room_schedules_run_binding_unique" ON "decision_room_schedules" USING btree ("workspace_id","id","ad_account_id","campaign_id","definition_hash");--> statement-breakpoint
ALTER TABLE "decision_room_inbox_items" ADD CONSTRAINT "decision_room_inbox_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_room_inbox_items" ADD CONSTRAINT "decision_room_inbox_items_run_scope_fk" FOREIGN KEY ("workspace_id","run_id") REFERENCES "public"."decision_room_runs"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_room_inbox_reads" ADD CONSTRAINT "decision_room_inbox_reads_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_room_inbox_reads" ADD CONSTRAINT "decision_room_inbox_reads_item_scope_fk" FOREIGN KEY ("workspace_id","inbox_item_id") REFERENCES "public"."decision_room_inbox_items"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_room_runs" ADD CONSTRAINT "decision_room_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_room_runs" ADD CONSTRAINT "decision_room_runs_schedule_binding_fk" FOREIGN KEY ("workspace_id","schedule_id","ad_account_id","campaign_id","schedule_definition_hash") REFERENCES "public"."decision_room_schedules"("workspace_id","id","ad_account_id","campaign_id","definition_hash") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_room_runs" ADD CONSTRAINT "decision_room_runs_account_scope_fk" FOREIGN KEY ("workspace_id","ad_account_id") REFERENCES "public"."ad_accounts"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_room_runs" ADD CONSTRAINT "decision_room_runs_campaign_scope_fk" FOREIGN KEY ("workspace_id","campaign_id") REFERENCES "public"."ad_campaigns"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_room_schedules" ADD CONSTRAINT "decision_room_schedules_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_room_schedules" ADD CONSTRAINT "decision_room_schedules_account_scope_fk" FOREIGN KEY ("workspace_id","ad_account_id") REFERENCES "public"."ad_accounts"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_room_schedules" ADD CONSTRAINT "decision_room_schedules_campaign_scope_fk" FOREIGN KEY ("workspace_id","campaign_id") REFERENCES "public"."ad_campaigns"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "decision_room_inbox_items_workspace_notification_unique" ON "decision_room_inbox_items" USING btree ("workspace_id","notification_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "decision_room_inbox_items_workspace_run_analysis_unique" ON "decision_room_inbox_items" USING btree ("workspace_id","run_id","analysis_ref");--> statement-breakpoint
CREATE INDEX "decision_room_inbox_items_run_idx" ON "decision_room_inbox_items" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "decision_room_inbox_items_created_idx" ON "decision_room_inbox_items" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "decision_room_inbox_reads_workspace_item_reader_unique" ON "decision_room_inbox_reads" USING btree ("workspace_id","inbox_item_id","reader_ref");--> statement-breakpoint
CREATE INDEX "decision_room_inbox_reads_item_idx" ON "decision_room_inbox_reads" USING btree ("inbox_item_id");--> statement-breakpoint
CREATE INDEX "decision_room_inbox_reads_reader_idx" ON "decision_room_inbox_reads" USING btree ("workspace_id","reader_ref","read_at");--> statement-breakpoint
CREATE UNIQUE INDEX "decision_room_runs_workspace_idempotency_unique" ON "decision_room_runs" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "decision_room_runs_workspace_ref_unique" ON "decision_room_runs" USING btree ("workspace_id","run_ref");--> statement-breakpoint
CREATE INDEX "decision_room_runs_active_scope_idx" ON "decision_room_runs" USING btree ("workspace_id","scope_key","lease_until");--> statement-breakpoint
CREATE INDEX "decision_room_runs_schedule_idx" ON "decision_room_runs" USING btree ("schedule_id");--> statement-breakpoint
CREATE INDEX "decision_room_runs_account_idx" ON "decision_room_runs" USING btree ("ad_account_id");--> statement-breakpoint
CREATE INDEX "decision_room_runs_campaign_idx" ON "decision_room_runs" USING btree ("campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "decision_room_schedules_workspace_ref_revision_unique" ON "decision_room_schedules" USING btree ("workspace_id","schedule_ref","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "decision_room_schedules_workspace_ref_hash_unique" ON "decision_room_schedules" USING btree ("workspace_id","schedule_ref","definition_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "decision_room_schedules_workspace_current_unique" ON "decision_room_schedules" USING btree ("workspace_id","schedule_ref") WHERE "decision_room_schedules"."superseded_at" is null;--> statement-breakpoint
CREATE INDEX "decision_room_schedules_due_idx" ON "decision_room_schedules" USING btree ("workspace_id","next_run_at") WHERE "decision_room_schedules"."superseded_at" is null and "decision_room_schedules"."enabled" is true;--> statement-breakpoint
CREATE INDEX "decision_room_schedules_account_idx" ON "decision_room_schedules" USING btree ("ad_account_id");--> statement-breakpoint
CREATE INDEX "decision_room_schedules_campaign_idx" ON "decision_room_schedules" USING btree ("campaign_id");--> statement-breakpoint
CREATE FUNCTION decision_room_schedule_definition_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.workspace_id, NEW.ad_account_id, NEW.campaign_id, NEW.schedule_ref, NEW.revision,
      NEW.definition_version, NEW.definition_hash, NEW.workspace_ref, NEW.account_ref, NEW.campaign_ref,
      NEW.timeframe_ref, NEW.template_ref, NEW.timezone, NEW.local_time, NEW.frequency, NEW.day_of_week,
      NEW.enabled, NEW.catch_up_policy, NEW.tick_grace_minutes)
    IS DISTINCT FROM
     (OLD.workspace_id, OLD.ad_account_id, OLD.campaign_id, OLD.schedule_ref, OLD.revision,
      OLD.definition_version, OLD.definition_hash, OLD.workspace_ref, OLD.account_ref, OLD.campaign_ref,
      OLD.timeframe_ref, OLD.template_ref, OLD.timezone, OLD.local_time, OLD.frequency, OLD.day_of_week,
      OLD.enabled, OLD.catch_up_policy, OLD.tick_grace_minutes)
  THEN
    RAISE EXCEPTION 'decision_room_schedule_definition_immutable';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER decision_room_schedule_definition_immutable_trigger
BEFORE UPDATE ON decision_room_schedules
FOR EACH ROW EXECUTE FUNCTION decision_room_schedule_definition_immutable();--> statement-breakpoint
ALTER TABLE "decision_room_schedules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "decision_room_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "decision_room_inbox_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "decision_room_inbox_reads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "decision_room_schedules" FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "decision_room_runs" FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "decision_room_inbox_items" FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "decision_room_inbox_reads" FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION decision_room_schedule_definition_immutable() FROM PUBLIC, anon, authenticated;
