CREATE TYPE "public"."meta_insight_entity_level" AS ENUM('campaign', 'ad_set', 'ad');--> statement-breakpoint
CREATE TYPE "public"."meta_metric_aggregation" AS ENUM('additive', 'non_additive', 'derived');--> statement-breakpoint
CREATE TYPE "public"."meta_sync_error_classification" AS ENUM('authentication', 'permission_missing', 'unsupported', 'rate_limited', 'payload_too_large', 'timeout', 'upstream', 'validation', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."meta_sync_run_status" AS ENUM('pending', 'running', 'partial', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."meta_sync_stream_type" AS ENUM('inventory', 'creative', 'insights');--> statement-breakpoint
CREATE TABLE "meta_daily_insight_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"daily_insight_id" uuid NOT NULL,
	"metric_key" text NOT NULL,
	"action_type" text DEFAULT '' NOT NULL,
	"aggregation" "meta_metric_aggregation" NOT NULL,
	"value_decimal" numeric(30, 10),
	"value_minor" bigint,
	"value_json" jsonb,
	"currency" text,
	"provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"availability" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_revision" text NOT NULL,
	"source_payload_hash" text NOT NULL,
	"source_updated_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meta_daily_insights" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"meta_connection_id" uuid NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"sync_run_id" uuid,
	"sync_slice_id" uuid,
	"entity_level" "meta_insight_entity_level" NOT NULL,
	"external_entity_id" text NOT NULL,
	"date_start" date NOT NULL,
	"date_stop" date NOT NULL,
	"attribution_label" text NOT NULL,
	"attribution_window" jsonb,
	"currency" text,
	"timezone" text,
	"field_availability" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_revision" text NOT NULL,
	"source_payload_hash" text NOT NULL,
	"source_updated_at" timestamp with time zone,
	"metric_provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meta_portfolio_sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"meta_connection_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" "meta_sync_run_status" DEFAULT 'pending' NOT NULL,
	"request_context" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meta_sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"meta_connection_id" uuid NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"portfolio_run_id" uuid,
	"parent_run_id" uuid,
	"stream_id" uuid NOT NULL,
	"stream_type" "meta_sync_stream_type" NOT NULL,
	"idempotency_key" text NOT NULL,
	"status" "meta_sync_run_status" DEFAULT 'pending' NOT NULL,
	"cursor" text,
	"checkpoint" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"retry_at" timestamp with time zone,
	"error_classification" "meta_sync_error_classification",
	"error_detail" jsonb,
	"source_revision" text,
	"source_payload_hash" text,
	"inserted_count" integer DEFAULT 0 NOT NULL,
	"updated_count" integer DEFAULT 0 NOT NULL,
	"unchanged_count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meta_sync_slices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"meta_connection_id" uuid NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"stream_type" "meta_sync_stream_type" NOT NULL,
	"entity_level" "meta_insight_entity_level",
	"date_start" date,
	"date_stop" date,
	"slice_key" text NOT NULL,
	"status" "meta_sync_run_status" DEFAULT 'pending' NOT NULL,
	"cursor" text,
	"checkpoint" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"retry_at" timestamp with time zone,
	"error_classification" "meta_sync_error_classification",
	"error_detail" jsonb,
	"source_revision" text,
	"source_payload_hash" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meta_sync_streams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"meta_connection_id" uuid NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"stream_type" "meta_sync_stream_type" NOT NULL,
	"status" "meta_sync_run_status" DEFAULT 'pending' NOT NULL,
	"cursor" text,
	"checkpoint" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_revision" text,
	"last_error_classification" "meta_sync_error_classification",
	"last_error" jsonb,
	"retry_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meta_daily_insight_metrics" ADD CONSTRAINT "meta_daily_insight_metrics_daily_insight_id_meta_daily_insights_id_fk" FOREIGN KEY ("daily_insight_id") REFERENCES "public"."meta_daily_insights"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_daily_insights" ADD CONSTRAINT "meta_daily_insights_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_daily_insights" ADD CONSTRAINT "meta_daily_insights_meta_connection_id_meta_connections_id_fk" FOREIGN KEY ("meta_connection_id") REFERENCES "public"."meta_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_daily_insights" ADD CONSTRAINT "meta_daily_insights_ad_account_id_ad_accounts_id_fk" FOREIGN KEY ("ad_account_id") REFERENCES "public"."ad_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_daily_insights" ADD CONSTRAINT "meta_daily_insights_sync_run_id_meta_sync_runs_id_fk" FOREIGN KEY ("sync_run_id") REFERENCES "public"."meta_sync_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_daily_insights" ADD CONSTRAINT "meta_daily_insights_sync_slice_id_meta_sync_slices_id_fk" FOREIGN KEY ("sync_slice_id") REFERENCES "public"."meta_sync_slices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_portfolio_sync_runs" ADD CONSTRAINT "meta_portfolio_sync_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_portfolio_sync_runs" ADD CONSTRAINT "meta_portfolio_sync_runs_meta_connection_id_meta_connections_id_fk" FOREIGN KEY ("meta_connection_id") REFERENCES "public"."meta_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_sync_runs" ADD CONSTRAINT "meta_sync_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_sync_runs" ADD CONSTRAINT "meta_sync_runs_meta_connection_id_meta_connections_id_fk" FOREIGN KEY ("meta_connection_id") REFERENCES "public"."meta_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_sync_runs" ADD CONSTRAINT "meta_sync_runs_ad_account_id_ad_accounts_id_fk" FOREIGN KEY ("ad_account_id") REFERENCES "public"."ad_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_sync_runs" ADD CONSTRAINT "meta_sync_runs_portfolio_run_id_meta_portfolio_sync_runs_id_fk" FOREIGN KEY ("portfolio_run_id") REFERENCES "public"."meta_portfolio_sync_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_sync_runs" ADD CONSTRAINT "meta_sync_runs_parent_run_id_meta_sync_runs_id_fk" FOREIGN KEY ("parent_run_id") REFERENCES "public"."meta_sync_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_sync_runs" ADD CONSTRAINT "meta_sync_runs_stream_id_meta_sync_streams_id_fk" FOREIGN KEY ("stream_id") REFERENCES "public"."meta_sync_streams"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_sync_slices" ADD CONSTRAINT "meta_sync_slices_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_sync_slices" ADD CONSTRAINT "meta_sync_slices_meta_connection_id_meta_connections_id_fk" FOREIGN KEY ("meta_connection_id") REFERENCES "public"."meta_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_sync_slices" ADD CONSTRAINT "meta_sync_slices_ad_account_id_ad_accounts_id_fk" FOREIGN KEY ("ad_account_id") REFERENCES "public"."ad_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_sync_slices" ADD CONSTRAINT "meta_sync_slices_run_id_meta_sync_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."meta_sync_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_sync_streams" ADD CONSTRAINT "meta_sync_streams_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_sync_streams" ADD CONSTRAINT "meta_sync_streams_meta_connection_id_meta_connections_id_fk" FOREIGN KEY ("meta_connection_id") REFERENCES "public"."meta_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_sync_streams" ADD CONSTRAINT "meta_sync_streams_ad_account_id_ad_accounts_id_fk" FOREIGN KEY ("ad_account_id") REFERENCES "public"."ad_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "meta_daily_insight_metrics_snapshot_metric_action_unique" ON "meta_daily_insight_metrics" USING btree ("daily_insight_id","metric_key","action_type");--> statement-breakpoint
CREATE INDEX "meta_daily_insight_metrics_metric_idx" ON "meta_daily_insight_metrics" USING btree ("metric_key");--> statement-breakpoint
CREATE UNIQUE INDEX "meta_daily_insights_canonical_snapshot_unique" ON "meta_daily_insights" USING btree ("workspace_id","ad_account_id","entity_level","external_entity_id","date_start","date_stop","attribution_label");--> statement-breakpoint
CREATE INDEX "meta_daily_insights_workspace_account_date_idx" ON "meta_daily_insights" USING btree ("workspace_id","ad_account_id","date_start");--> statement-breakpoint
CREATE INDEX "meta_daily_insights_run_idx" ON "meta_daily_insights" USING btree ("sync_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meta_portfolio_sync_runs_workspace_connection_idempotency_unique" ON "meta_portfolio_sync_runs" USING btree ("workspace_id","meta_connection_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "meta_portfolio_sync_runs_workspace_connection_created_idx" ON "meta_portfolio_sync_runs" USING btree ("workspace_id","meta_connection_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "meta_sync_runs_workspace_connection_account_stream_idempotency_unique" ON "meta_sync_runs" USING btree ("workspace_id","meta_connection_id","ad_account_id","stream_type","idempotency_key");--> statement-breakpoint
CREATE INDEX "meta_sync_runs_workspace_account_stream_started_idx" ON "meta_sync_runs" USING btree ("workspace_id","ad_account_id","stream_type","started_at");--> statement-breakpoint
CREATE INDEX "meta_sync_runs_parent_run_idx" ON "meta_sync_runs" USING btree ("parent_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meta_sync_slices_run_slice_key_unique" ON "meta_sync_slices" USING btree ("run_id","slice_key");--> statement-breakpoint
CREATE INDEX "meta_sync_slices_workspace_account_stream_status_idx" ON "meta_sync_slices" USING btree ("workspace_id","ad_account_id","stream_type","status");--> statement-breakpoint
CREATE UNIQUE INDEX "meta_sync_streams_workspace_connection_account_type_unique" ON "meta_sync_streams" USING btree ("workspace_id","meta_connection_id","ad_account_id","stream_type");--> statement-breakpoint
CREATE INDEX "meta_sync_streams_workspace_account_status_idx" ON "meta_sync_streams" USING btree ("workspace_id","ad_account_id","status");