CREATE TYPE "public"."meta_asset_discovery_resource" AS ENUM('ad_accounts', 'pages', 'pixels', 'datasets', 'apps', 'whatsapp_business_accounts');--> statement-breakpoint
CREATE TYPE "public"."meta_asset_discovery_source_type" AS ENUM('connection', 'ad_account', 'business');--> statement-breakpoint
CREATE TYPE "public"."meta_asset_discovery_status" AS ENUM('verified', 'empty', 'permission_missing', 'unsupported', 'unavailable');--> statement-breakpoint
CREATE TYPE "public"."meta_asset_ownership_kind" AS ENUM('owned', 'shared', 'linked', 'accessible', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."meta_promotion_eligibility_status" AS ENUM('not_evaluated', 'eligible', 'ineligible', 'unknown');--> statement-breakpoint
CREATE TABLE "meta_asset_discoveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"meta_connection_id" uuid NOT NULL,
	"ad_account_id" uuid,
	"discovery_key" text NOT NULL,
	"resource" "meta_asset_discovery_resource" NOT NULL,
	"source_type" "meta_asset_discovery_source_type" NOT NULL,
	"source_external_id" text,
	"status" "meta_asset_discovery_status" NOT NULL,
	"reason" text,
	"item_count" integer DEFAULT 0 NOT NULL,
	"source_edge" text NOT NULL,
	"raw_payload_hash" text NOT NULL,
	"source_graph_version" text NOT NULL,
	"field_catalog_version" text NOT NULL,
	"provenance" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meta_assets" ADD COLUMN "username" text;--> statement-breakpoint
ALTER TABLE "meta_assets" ADD COLUMN "ownership_kind" "meta_asset_ownership_kind" DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "meta_assets" ADD COLUMN "owner_business_external_id" text;--> statement-breakpoint
ALTER TABLE "meta_assets" ADD COLUMN "ownership_evidence" text;--> statement-breakpoint
ALTER TABLE "meta_posts" ADD COLUMN "source_message" text;--> statement-breakpoint
ALTER TABLE "meta_posts" ADD COLUMN "source_caption" text;--> statement-breakpoint
ALTER TABLE "meta_posts" ADD COLUMN "published_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "meta_posts" ADD COLUMN "promotion_eligibility_status" "meta_promotion_eligibility_status" DEFAULT 'not_evaluated' NOT NULL;--> statement-breakpoint
ALTER TABLE "meta_posts" ADD COLUMN "promotion_eligibility_reason" text;--> statement-breakpoint
ALTER TABLE "meta_posts" ADD COLUMN "promotion_eligibility_evaluated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "meta_posts" ADD COLUMN "content_hash" text;--> statement-breakpoint
ALTER TABLE "meta_asset_discoveries" ADD CONSTRAINT "meta_asset_discoveries_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_asset_discoveries" ADD CONSTRAINT "meta_asset_discoveries_meta_connection_id_meta_connections_id_fk" FOREIGN KEY ("meta_connection_id") REFERENCES "public"."meta_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_asset_discoveries" ADD CONSTRAINT "meta_asset_discoveries_ad_account_id_ad_accounts_id_fk" FOREIGN KEY ("ad_account_id") REFERENCES "public"."ad_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "meta_asset_discoveries_workspace_connection_key_unique" ON "meta_asset_discoveries" USING btree ("workspace_id","meta_connection_id","discovery_key");--> statement-breakpoint
CREATE INDEX "meta_asset_discoveries_connection_status_idx" ON "meta_asset_discoveries" USING btree ("meta_connection_id","status");--> statement-breakpoint
CREATE INDEX "meta_asset_discoveries_ad_account_idx" ON "meta_asset_discoveries" USING btree ("ad_account_id");--> statement-breakpoint
CREATE INDEX "meta_ad_creative_bindings_creative_idx" ON "meta_ad_creative_bindings" USING btree ("creative_id");--> statement-breakpoint
CREATE INDEX "meta_ad_creative_bindings_post_idx" ON "meta_ad_creative_bindings" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "meta_ads_creative_idx" ON "meta_ads" USING btree ("creative_id");--> statement-breakpoint
CREATE INDEX "meta_asset_edges_ad_account_idx" ON "meta_asset_edges" USING btree ("ad_account_id");--> statement-breakpoint
CREATE INDEX "meta_asset_edges_target_asset_idx" ON "meta_asset_edges" USING btree ("target_asset_id");--> statement-breakpoint
CREATE INDEX "meta_creatives_post_idx" ON "meta_creatives" USING btree ("post_id");--> statement-breakpoint
CREATE INDEX "meta_creatives_actor_asset_idx" ON "meta_creatives" USING btree ("actor_asset_id");--> statement-breakpoint
CREATE INDEX "meta_posts_actor_asset_idx" ON "meta_posts" USING btree ("actor_asset_id");--> statement-breakpoint

-- `public` is a Supabase Data API exposed schema. This server-only table is
-- deliberately fail-closed until workspace-aware Auth policies are introduced.
ALTER TABLE "meta_asset_discoveries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "meta_asset_discoveries" FROM PUBLIC, anon, authenticated;
