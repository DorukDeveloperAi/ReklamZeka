ALTER TYPE "public"."meta_asset_discovery_resource" ADD VALUE 'page_posts' BEFORE 'pixels';--> statement-breakpoint
ALTER TYPE "public"."meta_asset_discovery_resource" ADD VALUE 'instagram_media' BEFORE 'pixels';--> statement-breakpoint
ALTER TYPE "public"."meta_asset_discovery_source_type" ADD VALUE 'asset';--> statement-breakpoint
ALTER TYPE "public"."meta_asset_discovery_status" ADD VALUE 'partial' BEFORE 'permission_missing';