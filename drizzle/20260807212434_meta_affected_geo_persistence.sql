CREATE TABLE "meta_affected_geo_snapshot_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"polarity" text NOT NULL,
	"geo_type" text NOT NULL,
	"geo_ref" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meta_affected_geo_snapshot_items_contract" CHECK (
    "meta_affected_geo_snapshot_items"."polarity" = 'included' and "meta_affected_geo_snapshot_items"."geo_type" = 'country'
    and "meta_affected_geo_snapshot_items"."geo_ref" ~ '^geo_[a-f0-9]{64}$'
  )
);
--> statement-breakpoint
CREATE TABLE "meta_affected_geo_snapshot_location_types" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"snapshot_id" uuid NOT NULL,
	"location_type" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meta_affected_geo_snapshot_location_types_contract" CHECK ("meta_affected_geo_snapshot_location_types"."location_type" in ('home', 'recent'))
);
--> statement-breakpoint
CREATE TABLE "meta_affected_geo_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"ad_set_id" uuid NOT NULL,
	"workspace_ref" text NOT NULL,
	"account_ref" text NOT NULL,
	"campaign_ref" text NOT NULL,
	"ad_set_ref" text NOT NULL,
	"schema_version" text NOT NULL,
	"source_kind" text NOT NULL,
	"status" text NOT NULL,
	"source_graph_version" text NOT NULL,
	"field_catalog_version" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"observation_run_ref" text NOT NULL,
	"slice_ref" text NOT NULL,
	"page_ref" text NOT NULL,
	"raw_payload_hash" text NOT NULL,
	"source_geo_subtree_hash" text NOT NULL,
	"snapshot_hash" text NOT NULL,
	"item_count" integer NOT NULL,
	"location_type_count" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meta_affected_geo_snapshots_contract" CHECK (
    "meta_affected_geo_snapshots"."schema_version" = 'meta-affected-geo-country-snapshot/1.0.0'
    and "meta_affected_geo_snapshots"."source_kind" = 'canonical_meta_affected_geo_snapshot'
    and "meta_affected_geo_snapshots"."status" = 'known'
    and "meta_affected_geo_snapshots"."source_graph_version" = 'v23.0'
    and "meta_affected_geo_snapshots"."field_catalog_version" ~ '^[A-Za-z0-9][A-Za-z0-9./_-]{0,127}$'
    and "meta_affected_geo_snapshots"."item_count" between 1 and 250
    and "meta_affected_geo_snapshots"."location_type_count" between 1 and 2
  ),
	CONSTRAINT "meta_affected_geo_snapshots_refs" CHECK (
    "meta_affected_geo_snapshots"."workspace_ref" ~ '^workspace_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and "meta_affected_geo_snapshots"."account_ref" ~ '^account_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and "meta_affected_geo_snapshots"."campaign_ref" ~ '^campaign_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and "meta_affected_geo_snapshots"."ad_set_ref" ~ '^adset_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and "meta_affected_geo_snapshots"."observation_run_ref" ~ '^observation_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and "meta_affected_geo_snapshots"."slice_ref" ~ '^slice_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and "meta_affected_geo_snapshots"."page_ref" ~ '^page_[a-z0-9][a-z0-9_.:-]{0,126}$'
  ),
	CONSTRAINT "meta_affected_geo_snapshots_hashes" CHECK (
    "meta_affected_geo_snapshots"."raw_payload_hash" ~ '^[a-f0-9]{64}$'
    and "meta_affected_geo_snapshots"."source_geo_subtree_hash" ~ '^[a-f0-9]{64}$'
    and "meta_affected_geo_snapshots"."snapshot_hash" ~ '^[a-f0-9]{64}$'
  )
);
--> statement-breakpoint
ALTER TABLE "meta_affected_geo_snapshot_items" ADD CONSTRAINT "meta_affected_geo_snapshot_items_workspace_snapshot_fk" FOREIGN KEY ("workspace_id","snapshot_id") REFERENCES "public"."meta_affected_geo_snapshots"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_affected_geo_snapshot_location_types" ADD CONSTRAINT "meta_affected_geo_snapshot_location_types_workspace_snapshot_fk" FOREIGN KEY ("workspace_id","snapshot_id") REFERENCES "public"."meta_affected_geo_snapshots"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_affected_geo_snapshots" ADD CONSTRAINT "meta_affected_geo_snapshots_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_affected_geo_snapshots" ADD CONSTRAINT "meta_affected_geo_snapshots_workspace_hierarchy_fk" FOREIGN KEY ("workspace_id","ad_set_id","campaign_id","ad_account_id") REFERENCES "public"."meta_ad_sets"("workspace_id","id","campaign_id","ad_account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "meta_affected_geo_snapshot_items_identity_unique" ON "meta_affected_geo_snapshot_items" USING btree ("workspace_id","snapshot_id","polarity","geo_type","geo_ref");--> statement-breakpoint
CREATE INDEX "meta_affected_geo_snapshot_items_workspace_snapshot_idx" ON "meta_affected_geo_snapshot_items" USING btree ("workspace_id","snapshot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meta_affected_geo_snapshot_location_types_identity_unique" ON "meta_affected_geo_snapshot_location_types" USING btree ("workspace_id","snapshot_id","location_type");--> statement-breakpoint
CREATE INDEX "meta_affected_geo_snapshot_location_types_workspace_snapshot_idx" ON "meta_affected_geo_snapshot_location_types" USING btree ("workspace_id","snapshot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meta_affected_geo_snapshots_workspace_id_unique" ON "meta_affected_geo_snapshots" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "meta_affected_geo_snapshots_workspace_hash_unique" ON "meta_affected_geo_snapshots" USING btree ("workspace_id","snapshot_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "meta_affected_geo_snapshots_exact_source_unique" ON "meta_affected_geo_snapshots" USING btree ("workspace_id","ad_set_id","captured_at","raw_payload_hash","source_geo_subtree_hash","source_graph_version","field_catalog_version");--> statement-breakpoint
CREATE INDEX "meta_affected_geo_snapshots_scope_time_idx" ON "meta_affected_geo_snapshots" USING btree ("workspace_id","ad_account_id","campaign_id","ad_set_id","captured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "meta_ad_sets_workspace_hierarchy_unique" ON "meta_ad_sets" USING btree ("workspace_id","id","campaign_id","ad_account_id");--> statement-breakpoint

ALTER TABLE meta_affected_geo_snapshots ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE meta_affected_geo_snapshots FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE meta_affected_geo_snapshot_items ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE meta_affected_geo_snapshot_items FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE meta_affected_geo_snapshot_location_types ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE meta_affected_geo_snapshot_location_types FORCE ROW LEVEL SECURITY;--> statement-breakpoint

REVOKE ALL PRIVILEGES ON TABLE meta_affected_geo_snapshots FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE meta_affected_geo_snapshot_items FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE meta_affected_geo_snapshot_location_types FROM PUBLIC, anon, authenticated;--> statement-breakpoint

CREATE OR REPLACE FUNCTION meta_affected_geo_append_only()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'Meta affected-geo evidence is append-only';
END;
$$;--> statement-breakpoint

CREATE TRIGGER meta_affected_geo_snapshots_append_only
BEFORE UPDATE ON meta_affected_geo_snapshots
FOR EACH ROW EXECUTE FUNCTION meta_affected_geo_append_only();--> statement-breakpoint
CREATE TRIGGER meta_affected_geo_snapshot_items_append_only
BEFORE UPDATE ON meta_affected_geo_snapshot_items
FOR EACH ROW EXECUTE FUNCTION meta_affected_geo_append_only();--> statement-breakpoint
CREATE TRIGGER meta_affected_geo_snapshot_location_types_append_only
BEFORE UPDATE ON meta_affected_geo_snapshot_location_types
FOR EACH ROW EXECUTE FUNCTION meta_affected_geo_append_only();--> statement-breakpoint

REVOKE ALL PRIVILEGES ON FUNCTION meta_affected_geo_append_only() FROM PUBLIC, anon, authenticated;
