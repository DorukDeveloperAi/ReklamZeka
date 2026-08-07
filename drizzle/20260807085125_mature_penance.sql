CREATE TYPE "public"."meta_asset_type" AS ENUM('facebook_page', 'instagram_account', 'pixel', 'dataset', 'app', 'whatsapp_account', 'destination');--> statement-breakpoint
CREATE TYPE "public"."meta_connection_status" AS ENUM('active', 'disconnected', 'revoked', 'invalid');--> statement-breakpoint
CREATE TABLE "meta_ad_creative_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"ad_id" uuid NOT NULL,
	"creative_id" uuid NOT NULL,
	"post_id" uuid,
	"binding_payload_hash" text NOT NULL,
	"provenance" jsonb NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disappeared_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "meta_ad_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"external_ad_set_id" text NOT NULL,
	"name" text NOT NULL,
	"configured_status" text,
	"effective_status" text,
	"status_issues" jsonb,
	"unsupported_fields" jsonb,
	"optimization_goal" text,
	"billing_event" text,
	"bid_strategy" text,
	"bid_amount_minor" bigint,
	"cost_cap_minor" bigint,
	"daily_budget_minor" bigint,
	"lifetime_budget_minor" bigint,
	"attribution_spec" jsonb,
	"promoted_object" jsonb,
	"targeting_summary" jsonb,
	"targeting_signature" text,
	"start_at" timestamp with time zone,
	"end_at" timestamp with time zone,
	"source_updated_at" timestamp with time zone,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw_payload_hash" text NOT NULL,
	"source_graph_version" text NOT NULL,
	"field_catalog_version" text NOT NULL,
	"provenance" jsonb NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disappeared_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meta_ads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"ad_set_id" uuid NOT NULL,
	"creative_id" uuid,
	"external_ad_id" text NOT NULL,
	"name" text NOT NULL,
	"configured_status" text,
	"effective_status" text,
	"status_issues" jsonb,
	"unsupported_fields" jsonb,
	"review_feedback" jsonb,
	"tracking_specs" jsonb,
	"source_updated_at" timestamp with time zone,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw_payload_hash" text NOT NULL,
	"source_graph_version" text NOT NULL,
	"field_catalog_version" text NOT NULL,
	"provenance" jsonb NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disappeared_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meta_asset_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"meta_connection_id" uuid NOT NULL,
	"ad_account_id" uuid,
	"source_entity_type" text NOT NULL,
	"source_external_id" text NOT NULL,
	"target_asset_id" uuid NOT NULL,
	"relationship" text NOT NULL,
	"capability_snapshot" jsonb,
	"orphan_reason" text,
	"raw_payload_hash" text NOT NULL,
	"source_graph_version" text NOT NULL,
	"field_catalog_version" text NOT NULL,
	"provenance" jsonb NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disappeared_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "meta_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"meta_connection_id" uuid NOT NULL,
	"asset_type" "meta_asset_type" NOT NULL,
	"external_asset_id" text NOT NULL,
	"display_name" text,
	"permission_snapshot" jsonb,
	"capability_snapshot" jsonb,
	"unsupported_fields" jsonb,
	"configured_status" text,
	"effective_status" text,
	"orphan_reason" text,
	"source_updated_at" timestamp with time zone,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw_payload_hash" text NOT NULL,
	"source_graph_version" text NOT NULL,
	"field_catalog_version" text NOT NULL,
	"provenance" jsonb NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disappeared_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meta_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"external_connection_key" text NOT NULL,
	"display_name" text NOT NULL,
	"external_business_id" text,
	"graph_api_version" text NOT NULL,
	"field_catalog_version" text NOT NULL,
	"status" "meta_connection_status" DEFAULT 'active' NOT NULL,
	"granted_scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"enabled_capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"capability_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"capability_checked_at" timestamp with time zone,
	"token_expires_at" timestamp with time zone,
	"data_access_expires_at" timestamp with time zone,
	"disconnected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meta_creatives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"post_id" uuid,
	"actor_asset_id" uuid,
	"external_creative_id" text NOT NULL,
	"name" text,
	"source_type" text NOT NULL,
	"primary_text" text,
	"headline" text,
	"description" text,
	"caption" text,
	"call_to_action_type" text,
	"destination_url" text,
	"creative_format" text,
	"content_provenance" jsonb NOT NULL,
	"dynamic_variants" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"unsupported_fields" jsonb,
	"configured_status" text,
	"effective_status" text,
	"source_updated_at" timestamp with time zone,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw_payload_hash" text NOT NULL,
	"source_graph_version" text NOT NULL,
	"field_catalog_version" text NOT NULL,
	"provenance" jsonb NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disappeared_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "meta_posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"meta_connection_id" uuid NOT NULL,
	"actor_asset_id" uuid,
	"external_post_id" text NOT NULL,
	"external_media_id" text,
	"media_type" text,
	"permalink" text,
	"configured_status" text,
	"effective_status" text,
	"unsupported_fields" jsonb,
	"source_updated_at" timestamp with time zone,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw_payload_hash" text NOT NULL,
	"source_graph_version" text NOT NULL,
	"field_catalog_version" text NOT NULL,
	"provenance" jsonb NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"disappeared_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ad_accounts" ADD COLUMN "configured_status" text;--> statement-breakpoint
ALTER TABLE "ad_accounts" ADD COLUMN "effective_status" text;--> statement-breakpoint
ALTER TABLE "ad_accounts" ADD COLUMN "account_status" text;--> statement-breakpoint
ALTER TABLE "ad_accounts" ADD COLUMN "permission_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "ad_accounts" ADD COLUMN "capability_snapshot" jsonb;--> statement-breakpoint
ALTER TABLE "ad_accounts" ADD COLUMN "unsupported_fields" jsonb;--> statement-breakpoint
ALTER TABLE "ad_accounts" ADD COLUMN "spend_cap_minor" bigint;--> statement-breakpoint
ALTER TABLE "ad_accounts" ADD COLUMN "source_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ad_accounts" ADD COLUMN "fetched_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_accounts" ADD COLUMN "raw_payload_hash" text;--> statement-breakpoint
ALTER TABLE "ad_accounts" ADD COLUMN "source_graph_version" text;--> statement-breakpoint
ALTER TABLE "ad_accounts" ADD COLUMN "field_catalog_version" text;--> statement-breakpoint
ALTER TABLE "ad_accounts" ADD COLUMN "provenance" jsonb;--> statement-breakpoint
ALTER TABLE "ad_accounts" ADD COLUMN "first_seen_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_accounts" ADD COLUMN "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_accounts" ADD COLUMN "disappeared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD COLUMN "configured_status" text;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD COLUMN "effective_status" text;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD COLUMN "status_issues" jsonb;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD COLUMN "unsupported_fields" jsonb;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD COLUMN "objective_source" text;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD COLUMN "legacy_objective_source" text;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD COLUMN "canonical_objective" text;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD COLUMN "objective_mapping_version" text;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD COLUMN "buying_type" text;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD COLUMN "bid_strategy" text;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD COLUMN "special_ad_categories" jsonb;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD COLUMN "advantage_plus_enabled" boolean;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD COLUMN "campaign_budget_optimization" boolean;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD COLUMN "daily_budget_minor" bigint;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD COLUMN "lifetime_budget_minor" bigint;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD COLUMN "budget_remaining_minor" bigint;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD COLUMN "start_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD COLUMN "stop_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD COLUMN "source_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD COLUMN "fetched_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD COLUMN "raw_payload_hash" text;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD COLUMN "source_graph_version" text;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD COLUMN "field_catalog_version" text;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD COLUMN "provenance" jsonb;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD COLUMN "first_seen_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD COLUMN "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD COLUMN "disappeared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "data_sources" ADD COLUMN "meta_connection_id" uuid;--> statement-breakpoint
ALTER TABLE "meta_ad_creative_bindings" ADD CONSTRAINT "meta_ad_creative_bindings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_ad_creative_bindings" ADD CONSTRAINT "meta_ad_creative_bindings_ad_id_meta_ads_id_fk" FOREIGN KEY ("ad_id") REFERENCES "public"."meta_ads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_ad_creative_bindings" ADD CONSTRAINT "meta_ad_creative_bindings_creative_id_meta_creatives_id_fk" FOREIGN KEY ("creative_id") REFERENCES "public"."meta_creatives"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_ad_creative_bindings" ADD CONSTRAINT "meta_ad_creative_bindings_post_id_meta_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."meta_posts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_ad_sets" ADD CONSTRAINT "meta_ad_sets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_ad_sets" ADD CONSTRAINT "meta_ad_sets_ad_account_id_ad_accounts_id_fk" FOREIGN KEY ("ad_account_id") REFERENCES "public"."ad_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_ad_sets" ADD CONSTRAINT "meta_ad_sets_campaign_id_ad_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."ad_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_ads" ADD CONSTRAINT "meta_ads_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_ads" ADD CONSTRAINT "meta_ads_ad_account_id_ad_accounts_id_fk" FOREIGN KEY ("ad_account_id") REFERENCES "public"."ad_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_ads" ADD CONSTRAINT "meta_ads_campaign_id_ad_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."ad_campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_ads" ADD CONSTRAINT "meta_ads_ad_set_id_meta_ad_sets_id_fk" FOREIGN KEY ("ad_set_id") REFERENCES "public"."meta_ad_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_ads" ADD CONSTRAINT "meta_ads_creative_id_meta_creatives_id_fk" FOREIGN KEY ("creative_id") REFERENCES "public"."meta_creatives"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_asset_edges" ADD CONSTRAINT "meta_asset_edges_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_asset_edges" ADD CONSTRAINT "meta_asset_edges_meta_connection_id_meta_connections_id_fk" FOREIGN KEY ("meta_connection_id") REFERENCES "public"."meta_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_asset_edges" ADD CONSTRAINT "meta_asset_edges_ad_account_id_ad_accounts_id_fk" FOREIGN KEY ("ad_account_id") REFERENCES "public"."ad_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_asset_edges" ADD CONSTRAINT "meta_asset_edges_target_asset_id_meta_assets_id_fk" FOREIGN KEY ("target_asset_id") REFERENCES "public"."meta_assets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_assets" ADD CONSTRAINT "meta_assets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_assets" ADD CONSTRAINT "meta_assets_meta_connection_id_meta_connections_id_fk" FOREIGN KEY ("meta_connection_id") REFERENCES "public"."meta_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_connections" ADD CONSTRAINT "meta_connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_creatives" ADD CONSTRAINT "meta_creatives_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_creatives" ADD CONSTRAINT "meta_creatives_ad_account_id_ad_accounts_id_fk" FOREIGN KEY ("ad_account_id") REFERENCES "public"."ad_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_creatives" ADD CONSTRAINT "meta_creatives_post_id_meta_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."meta_posts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_creatives" ADD CONSTRAINT "meta_creatives_actor_asset_id_meta_assets_id_fk" FOREIGN KEY ("actor_asset_id") REFERENCES "public"."meta_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_posts" ADD CONSTRAINT "meta_posts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_posts" ADD CONSTRAINT "meta_posts_meta_connection_id_meta_connections_id_fk" FOREIGN KEY ("meta_connection_id") REFERENCES "public"."meta_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_posts" ADD CONSTRAINT "meta_posts_actor_asset_id_meta_assets_id_fk" FOREIGN KEY ("actor_asset_id") REFERENCES "public"."meta_assets"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "meta_ad_creative_bindings_ad_creative_unique" ON "meta_ad_creative_bindings" USING btree ("ad_id","creative_id");--> statement-breakpoint
CREATE INDEX "meta_ad_creative_bindings_workspace_idx" ON "meta_ad_creative_bindings" USING btree ("workspace_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meta_ad_sets_account_external_unique" ON "meta_ad_sets" USING btree ("ad_account_id","external_ad_set_id");--> statement-breakpoint
CREATE INDEX "meta_ad_sets_workspace_campaign_idx" ON "meta_ad_sets" USING btree ("workspace_id","campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meta_ads_account_external_unique" ON "meta_ads" USING btree ("ad_account_id","external_ad_id");--> statement-breakpoint
CREATE INDEX "meta_ads_workspace_ad_set_idx" ON "meta_ads" USING btree ("workspace_id","ad_set_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meta_asset_edges_source_target_relationship_unique" ON "meta_asset_edges" USING btree ("meta_connection_id","source_entity_type","source_external_id","target_asset_id","relationship");--> statement-breakpoint
CREATE INDEX "meta_asset_edges_workspace_account_idx" ON "meta_asset_edges" USING btree ("workspace_id","ad_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meta_assets_connection_type_external_unique" ON "meta_assets" USING btree ("meta_connection_id","asset_type","external_asset_id");--> statement-breakpoint
CREATE INDEX "meta_assets_workspace_type_idx" ON "meta_assets" USING btree ("workspace_id","asset_type");--> statement-breakpoint
CREATE UNIQUE INDEX "meta_connections_workspace_external_key_unique" ON "meta_connections" USING btree ("workspace_id","external_connection_key");--> statement-breakpoint
CREATE INDEX "meta_connections_workspace_status_idx" ON "meta_connections" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "meta_creatives_account_external_unique" ON "meta_creatives" USING btree ("ad_account_id","external_creative_id");--> statement-breakpoint
CREATE INDEX "meta_creatives_workspace_post_idx" ON "meta_creatives" USING btree ("workspace_id","post_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meta_posts_connection_external_unique" ON "meta_posts" USING btree ("meta_connection_id","external_post_id");--> statement-breakpoint
CREATE INDEX "meta_posts_workspace_actor_idx" ON "meta_posts" USING btree ("workspace_id","actor_asset_id");--> statement-breakpoint
ALTER TABLE "data_sources" ADD CONSTRAINT "data_sources_meta_connection_id_meta_connections_id_fk" FOREIGN KEY ("meta_connection_id") REFERENCES "public"."meta_connections"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "data_sources_meta_connection_external_unique" ON "data_sources" USING btree ("meta_connection_id","external_account_id");--> statement-breakpoint
CREATE INDEX "data_sources_meta_connection_idx" ON "data_sources" USING btree ("meta_connection_id");
