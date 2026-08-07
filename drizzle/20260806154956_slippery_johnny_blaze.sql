CREATE TYPE "public"."sync_run_status" AS ENUM('running', 'completed', 'failed');--> statement-breakpoint
CREATE TABLE "ad_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"data_source_id" uuid NOT NULL,
	"external_account_id" text NOT NULL,
	"name" text NOT NULL,
	"currency" text NOT NULL,
	"timezone" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ad_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"external_campaign_id" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_ad_metrics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"data_source_id" uuid NOT NULL,
	"ad_campaign_id" uuid NOT NULL,
	"metric_date" date NOT NULL,
	"attribution_model" text NOT NULL,
	"attribution_click_days" integer NOT NULL,
	"attribution_view_days" integer NOT NULL,
	"schema_version" integer NOT NULL,
	"spend_minor" bigint NOT NULL,
	"impressions" bigint NOT NULL,
	"clicks" bigint NOT NULL,
	"conversions" double precision NOT NULL,
	"conversion_value_minor" bigint NOT NULL,
	"source_row_id" text NOT NULL,
	"source_updated_at" timestamp with time zone NOT NULL,
	"source_payload_hash" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"data_source_id" uuid NOT NULL,
	"status" "sync_run_status" NOT NULL,
	"resume_cursor" text,
	"inserted_count" integer DEFAULT 0 NOT NULL,
	"updated_count" integer DEFAULT 0 NOT NULL,
	"unchanged_count" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "ad_accounts" ADD CONSTRAINT "ad_accounts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_accounts" ADD CONSTRAINT "ad_accounts_data_source_id_data_sources_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "public"."data_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD CONSTRAINT "ad_campaigns_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD CONSTRAINT "ad_campaigns_ad_account_id_ad_accounts_id_fk" FOREIGN KEY ("ad_account_id") REFERENCES "public"."ad_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_ad_metrics" ADD CONSTRAINT "daily_ad_metrics_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_ad_metrics" ADD CONSTRAINT "daily_ad_metrics_data_source_id_data_sources_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "public"."data_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_ad_metrics" ADD CONSTRAINT "daily_ad_metrics_ad_campaign_id_ad_campaigns_id_fk" FOREIGN KEY ("ad_campaign_id") REFERENCES "public"."ad_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_data_source_id_data_sources_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "public"."data_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ad_accounts_source_external_unique" ON "ad_accounts" USING btree ("data_source_id","external_account_id");--> statement-breakpoint
CREATE INDEX "ad_accounts_workspace_idx" ON "ad_accounts" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "ad_campaigns_account_external_unique" ON "ad_campaigns" USING btree ("ad_account_id","external_campaign_id");--> statement-breakpoint
CREATE INDEX "ad_campaigns_workspace_idx" ON "ad_campaigns" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "daily_ad_metrics_canonical_unique" ON "daily_ad_metrics" USING btree ("workspace_id","data_source_id","ad_campaign_id","metric_date","attribution_model","attribution_click_days","attribution_view_days","schema_version");--> statement-breakpoint
CREATE INDEX "daily_ad_metrics_workspace_date_idx" ON "daily_ad_metrics" USING btree ("workspace_id","metric_date");--> statement-breakpoint
CREATE INDEX "sync_runs_workspace_source_started_idx" ON "sync_runs" USING btree ("workspace_id","data_source_id","started_at");