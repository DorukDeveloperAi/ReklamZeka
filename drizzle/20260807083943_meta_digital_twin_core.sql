CREATE TYPE "public"."meta_asset_edge_type" AS ENUM('campaign_promotes', 'ad_set_promotes', 'ad_uses_creative', 'creative_uses_actor', 'creative_promotes_object', 'creative_uses_asset', 'post_has_media');--> statement-breakpoint
CREATE TYPE "public"."meta_asset_type" AS ENUM('facebook_page', 'instagram_account', 'pixel', 'dataset', 'app', 'whatsapp_account', 'destination', 'post', 'media');--> statement-breakpoint
CREATE TYPE "public"."meta_budget_owner_level" AS ENUM('campaign', 'ad_set', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."meta_entity_status" AS ENUM('active', 'paused', 'archived', 'deleted', 'unknown');--> statement-breakpoint
CREATE TABLE "meta_ad_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"ad_campaign_id" uuid NOT NULL,
	"external_ad_set_id" text NOT NULL,
	"name" text NOT NULL,
	"configured_status" text,
	"effective_status" text,
	"optimization_goal" text,
	"billing_event" text,
	"bid_strategy" text,
	"bid_amount_minor" bigint,
	"cost_cap_minor" bigint,
	"daily_budget_minor" bigint,
	"lifetime_budget_minor" bigint,
	"budget_currency" text,
	"attribution_setting" text,
	"promoted_object" jsonb,
	"targeting_summary" jsonb,
	"source_updated_at" timestamp with time zone,
	"fetched_at" timestamp with time zone NOT NULL,
	"raw_payload_hash" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disappeared_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "meta_ads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"ad_campaign_id" uuid NOT NULL,
	"ad_set_id" uuid NOT NULL,
	"external_ad_id" text NOT NULL,
	"name" text NOT NULL,
	"configured_status" text,
	"effective_status" text,
	"creative_external_id" text,
	"source_updated_at" timestamp with time zone,
	"fetched_at" timestamp with time zone NOT NULL,
	"raw_payload_hash" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disappeared_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "meta_asset_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"connection_data_source_id" uuid NOT NULL,
	"from_asset_id" uuid NOT NULL,
	"to_asset_id" uuid NOT NULL,
	"edge_type" "meta_asset_edge_type" NOT NULL,
	"metadata" jsonb,
	"source_updated_at" timestamp with time zone,
	"fetched_at" timestamp with time zone NOT NULL,
	"raw_payload_hash" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disappeared_at" timestamp with time zone,
	"disappearance_reason" text
);
--> statement-breakpoint
CREATE TABLE "meta_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"connection_data_source_id" uuid NOT NULL,
	"asset_type" "meta_asset_type" NOT NULL,
	"external_asset_id" text NOT NULL,
	"display_name" text,
	"capability" jsonb,
	"source_updated_at" timestamp with time zone,
	"fetched_at" timestamp with time zone NOT NULL,
	"raw_payload_hash" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disappeared_at" timestamp with time zone,
	"disappearance_reason" text
);
--> statement-breakpoint
CREATE TABLE "meta_creatives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"external_creative_id" text NOT NULL,
	"source_type" text,
	"effective_primary_text" text,
	"effective_headline" text,
	"effective_description" text,
	"effective_caption" text,
	"call_to_action" text,
	"destination_url" text,
	"post_external_id" text,
	"actor_external_id" text,
	"dynamic_variants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"field_provenance" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_updated_at" timestamp with time zone,
	"fetched_at" timestamp with time zone NOT NULL,
	"raw_payload_hash" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disappeared_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "ad_accounts" ADD COLUMN "configured_status" text;--> statement-breakpoint
ALTER TABLE "ad_accounts" ADD COLUMN "effective_status" text;--> statement-breakpoint
ALTER TABLE "ad_accounts" ADD COLUMN "source_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ad_accounts" ADD COLUMN "fetched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ad_accounts" ADD COLUMN "raw_payload_hash" text;--> statement-breakpoint
ALTER TABLE "ad_accounts" ADD COLUMN "first_seen_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_accounts" ADD COLUMN "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_accounts" ADD COLUMN "disappeared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD COLUMN "configured_status" text;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD COLUMN "effective_status" text;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD COLUMN "objective" text;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD COLUMN "legacy_objective" text;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD COLUMN "buying_type" text;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD COLUMN "special_ad_categories" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD COLUMN "budget_optimization_enabled" integer;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD COLUMN "daily_budget_minor" bigint;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD COLUMN "lifetime_budget_minor" bigint;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD COLUMN "budget_currency" text;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD COLUMN "source_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD COLUMN "fetched_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD COLUMN "raw_payload_hash" text;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD COLUMN "first_seen_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD COLUMN "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD COLUMN "disappeared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "meta_ad_sets" ADD CONSTRAINT "meta_ad_sets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_ad_sets" ADD CONSTRAINT "meta_ad_sets_ad_account_id_ad_accounts_id_fk" FOREIGN KEY ("ad_account_id") REFERENCES "public"."ad_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_ad_sets" ADD CONSTRAINT "meta_ad_sets_ad_campaign_id_ad_campaigns_id_fk" FOREIGN KEY ("ad_campaign_id") REFERENCES "public"."ad_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_ads" ADD CONSTRAINT "meta_ads_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_ads" ADD CONSTRAINT "meta_ads_ad_account_id_ad_accounts_id_fk" FOREIGN KEY ("ad_account_id") REFERENCES "public"."ad_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_ads" ADD CONSTRAINT "meta_ads_ad_campaign_id_ad_campaigns_id_fk" FOREIGN KEY ("ad_campaign_id") REFERENCES "public"."ad_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_ads" ADD CONSTRAINT "meta_ads_ad_set_id_meta_ad_sets_id_fk" FOREIGN KEY ("ad_set_id") REFERENCES "public"."meta_ad_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_asset_edges" ADD CONSTRAINT "meta_asset_edges_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_asset_edges" ADD CONSTRAINT "meta_asset_edges_connection_data_source_id_data_sources_id_fk" FOREIGN KEY ("connection_data_source_id") REFERENCES "public"."data_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_asset_edges" ADD CONSTRAINT "meta_asset_edges_from_asset_id_meta_assets_id_fk" FOREIGN KEY ("from_asset_id") REFERENCES "public"."meta_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_asset_edges" ADD CONSTRAINT "meta_asset_edges_to_asset_id_meta_assets_id_fk" FOREIGN KEY ("to_asset_id") REFERENCES "public"."meta_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_assets" ADD CONSTRAINT "meta_assets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_assets" ADD CONSTRAINT "meta_assets_connection_data_source_id_data_sources_id_fk" FOREIGN KEY ("connection_data_source_id") REFERENCES "public"."data_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_creatives" ADD CONSTRAINT "meta_creatives_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_creatives" ADD CONSTRAINT "meta_creatives_ad_account_id_ad_accounts_id_fk" FOREIGN KEY ("ad_account_id") REFERENCES "public"."ad_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "meta_ad_sets_account_external_unique" ON "meta_ad_sets" USING btree ("ad_account_id","external_ad_set_id");--> statement-breakpoint
CREATE INDEX "meta_ad_sets_campaign_idx" ON "meta_ad_sets" USING btree ("ad_campaign_id");--> statement-breakpoint
CREATE INDEX "meta_ad_sets_workspace_idx" ON "meta_ad_sets" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meta_ads_account_external_unique" ON "meta_ads" USING btree ("ad_account_id","external_ad_id");--> statement-breakpoint
CREATE INDEX "meta_ads_ad_set_idx" ON "meta_ads" USING btree ("ad_set_id");--> statement-breakpoint
CREATE INDEX "meta_ads_workspace_idx" ON "meta_ads" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meta_asset_edges_unique" ON "meta_asset_edges" USING btree ("connection_data_source_id","from_asset_id","to_asset_id","edge_type");--> statement-breakpoint
CREATE INDEX "meta_asset_edges_workspace_from_idx" ON "meta_asset_edges" USING btree ("workspace_id","from_asset_id");--> statement-breakpoint
CREATE INDEX "meta_asset_edges_workspace_to_idx" ON "meta_asset_edges" USING btree ("workspace_id","to_asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meta_assets_connection_type_external_unique" ON "meta_assets" USING btree ("connection_data_source_id","asset_type","external_asset_id");--> statement-breakpoint
CREATE INDEX "meta_assets_workspace_type_idx" ON "meta_assets" USING btree ("workspace_id","asset_type");--> statement-breakpoint
CREATE UNIQUE INDEX "meta_creatives_account_external_unique" ON "meta_creatives" USING btree ("ad_account_id","external_creative_id");--> statement-breakpoint
CREATE INDEX "meta_creatives_workspace_idx" ON "meta_creatives" USING btree ("workspace_id");