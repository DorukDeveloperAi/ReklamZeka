CREATE TABLE "meta_read_sync_schedule_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"schedule_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"schedule_revision" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"scope_key" text NOT NULL,
	"trigger_kind" text NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"date_start" date NOT NULL,
	"date_stop" date NOT NULL,
	"state" text NOT NULL,
	"lease_token" text,
	"lease_until" timestamp with time zone,
	"attempt" integer NOT NULL,
	"failure_reason" text,
	"retryable" boolean,
	"started_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meta_read_sync_schedule_runs_identity" CHECK (
    "meta_read_sync_schedule_runs"."schedule_revision" between 1 and 1000000
    and "meta_read_sync_schedule_runs"."idempotency_key" ~ '^syncfire_[a-f0-9]{64}$'
    and "meta_read_sync_schedule_runs"."scope_key" ~ '^[a-f0-9]{64}$'
    and "meta_read_sync_schedule_runs"."trigger_kind" = 'daily'
    and "meta_read_sync_schedule_runs"."date_start" <= "meta_read_sync_schedule_runs"."date_stop"
    and "meta_read_sync_schedule_runs"."attempt" between 1 and 5
  ),
	CONSTRAINT "meta_read_sync_schedule_runs_lifecycle" CHECK (
    ("meta_read_sync_schedule_runs"."state" = 'running' and "meta_read_sync_schedule_runs"."lease_token" ~ '^lease_[a-f0-9]{32}$'
      and "meta_read_sync_schedule_runs"."lease_until" is not null and "meta_read_sync_schedule_runs"."lease_until" > "meta_read_sync_schedule_runs"."started_at"
      and "meta_read_sync_schedule_runs"."completed_at" is null and "meta_read_sync_schedule_runs"."failed_at" is null
      and "meta_read_sync_schedule_runs"."failure_reason" is null and "meta_read_sync_schedule_runs"."retryable" is null)
    or ("meta_read_sync_schedule_runs"."state" = 'completed' and "meta_read_sync_schedule_runs"."lease_token" is null and "meta_read_sync_schedule_runs"."lease_until" is null
      and "meta_read_sync_schedule_runs"."completed_at" is not null and "meta_read_sync_schedule_runs"."failed_at" is null
      and "meta_read_sync_schedule_runs"."completed_at" >= "meta_read_sync_schedule_runs"."started_at"
      and "meta_read_sync_schedule_runs"."failure_reason" is null and "meta_read_sync_schedule_runs"."retryable" is null)
    or ("meta_read_sync_schedule_runs"."state" = 'failed' and "meta_read_sync_schedule_runs"."lease_token" is null and "meta_read_sync_schedule_runs"."lease_until" is null
      and "meta_read_sync_schedule_runs"."completed_at" is null and "meta_read_sync_schedule_runs"."failed_at" is not null
      and "meta_read_sync_schedule_runs"."failed_at" >= "meta_read_sync_schedule_runs"."started_at"
      and "meta_read_sync_schedule_runs"."failure_reason" in ('scope_unavailable', 'connection_unavailable', 'account_scope_unavailable',
        'rate_limited', 'transient', 'partial_result', 'sync_failed') and "meta_read_sync_schedule_runs"."retryable" is not null)
  )
);
--> statement-breakpoint
CREATE TABLE "meta_read_sync_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"trigger_kind" text DEFAULT 'daily' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"workspace_lifecycle_generation" integer NOT NULL,
	"connection_lifecycle_generation" integer NOT NULL,
	"timeframe_days" integer DEFAULT 1 NOT NULL,
	"next_due_at" timestamp with time zone NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meta_read_sync_schedules_contract" CHECK (
    "meta_read_sync_schedules"."trigger_kind" = 'daily'
    and "meta_read_sync_schedules"."revision" between 1 and 1000000
    and "meta_read_sync_schedules"."workspace_lifecycle_generation" >= 1
    and "meta_read_sync_schedules"."connection_lifecycle_generation" >= 1
    and "meta_read_sync_schedules"."timeframe_days" between 1 and 90
  )
);
--> statement-breakpoint
ALTER TABLE "meta_connections" ADD COLUMN "access_mode" text DEFAULT 'read_only' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "meta_read_sync_schedules_workspace_binding_unique" ON "meta_read_sync_schedules" USING btree ("workspace_id","id","connection_id");--> statement-breakpoint
ALTER TABLE "meta_read_sync_schedule_runs" ADD CONSTRAINT "meta_read_sync_schedule_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_read_sync_schedule_runs" ADD CONSTRAINT "meta_read_sync_schedule_runs_workspace_schedule_fk" FOREIGN KEY ("workspace_id","schedule_id","connection_id") REFERENCES "public"."meta_read_sync_schedules"("workspace_id","id","connection_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_read_sync_schedules" ADD CONSTRAINT "meta_read_sync_schedules_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_read_sync_schedules" ADD CONSTRAINT "meta_read_sync_schedules_workspace_connection_fk" FOREIGN KEY ("workspace_id","connection_id") REFERENCES "public"."meta_connections"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "meta_read_sync_schedule_runs_idempotency_unique" ON "meta_read_sync_schedule_runs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "meta_read_sync_schedule_runs_workspace_id_unique" ON "meta_read_sync_schedule_runs" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE INDEX "meta_read_sync_schedule_runs_workspace_schedule_idx" ON "meta_read_sync_schedule_runs" USING btree ("workspace_id","schedule_id","schedule_revision","scheduled_for");--> statement-breakpoint
CREATE INDEX "meta_read_sync_schedule_runs_workspace_scope_state_idx" ON "meta_read_sync_schedule_runs" USING btree ("workspace_id","scope_key","state","lease_until");--> statement-breakpoint
CREATE UNIQUE INDEX "meta_read_sync_schedules_workspace_id_unique" ON "meta_read_sync_schedules" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "meta_read_sync_schedules_workspace_connection_unique" ON "meta_read_sync_schedules" USING btree ("workspace_id","connection_id");--> statement-breakpoint
CREATE INDEX "meta_read_sync_schedules_due_idx" ON "meta_read_sync_schedules" USING btree ("enabled","next_due_at","workspace_id");--> statement-breakpoint
ALTER TABLE "meta_connections" ADD CONSTRAINT "meta_connections_access_mode_read_only" CHECK ("meta_connections"."access_mode" = 'read_only');--> statement-breakpoint

ALTER TABLE meta_read_sync_schedules ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE meta_read_sync_schedules FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE meta_read_sync_schedule_runs ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE meta_read_sync_schedule_runs FORCE ROW LEVEL SECURITY;--> statement-breakpoint

REVOKE ALL PRIVILEGES ON TABLE meta_read_sync_schedules FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE meta_read_sync_schedule_runs FROM PUBLIC, anon, authenticated;
