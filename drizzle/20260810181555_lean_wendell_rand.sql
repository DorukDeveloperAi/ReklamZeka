-- L2 deterministic features. The Drizzle metadata snapshot was reconstructed
-- after earlier forward migrations, so this file intentionally contains only
-- the new L2 delta (never a replay of A09/A10 tables already migrated).
CREATE UNIQUE INDEX "meta_daily_insights_workspace_id_unique"
  ON "meta_daily_insights" USING btree ("workspace_id", "id");--> statement-breakpoint

CREATE TABLE "deterministic_feature_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "meta_connection_id" uuid NOT NULL,
  "ad_account_id" uuid NOT NULL,
  "entity_level" "meta_insight_entity_level" NOT NULL,
  "external_entity_id" text NOT NULL,
  "feature_ref" text NOT NULL,
  "feature_hash" text NOT NULL,
  "observation_ref" text NOT NULL,
  "role" text NOT NULL,
  "start_date" date NOT NULL,
  "end_date" date NOT NULL,
  "timezone" text NOT NULL,
  "sample_size" integer NOT NULL,
  "settled" boolean NOT NULL,
  "quality_status" text NOT NULL,
  "quality_reason_codes" jsonb NOT NULL,
  "source_manifest_hash" text NOT NULL,
  "formula_catalog_version" text NOT NULL,
  "metric_result" jsonb NOT NULL,
  "feature_payload" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "deterministic_feature_snapshots_shape" CHECK (
    "feature_ref" ~ '^feature_[a-f0-9]{24}$' and "feature_hash" ~ '^[a-f0-9]{64}$'
    and "source_manifest_hash" ~ '^[a-f0-9]{64}$' and "sample_size" >= 0
    and "role" in ('primary', 'comparison', 'series', 'pre', 'post')
    and "quality_status" in ('ready', 'degraded')
    and "feature_payload" #>> '{featureRef}' = "feature_ref"
    and "feature_payload" #>> '{featureHash}' = "feature_hash"
  ),
  CONSTRAINT "deterministic_feature_snapshots_payload_object" CHECK (
    jsonb_typeof("feature_payload") = 'object' and jsonb_typeof("metric_result") = 'object'
    and jsonb_typeof("quality_reason_codes") = 'array'
  ),
  CONSTRAINT "deterministic_feature_snapshots_no_authority" CHECK (
    "feature_payload" #> '{capabilities,containsRawL0}' = 'false'::jsonb
    and "feature_payload" #> '{capabilities,canAuthorizeAction}' = 'false'::jsonb
    and "feature_payload" #> '{capabilities,canExecuteWrite}' = 'false'::jsonb
  )
);--> statement-breakpoint

CREATE TABLE "deterministic_feature_snapshot_sources" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "feature_snapshot_id" uuid NOT NULL,
  "daily_insight_id" uuid NOT NULL,
  "snapshot_ref" text NOT NULL,
  "content_hash" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "deterministic_feature_snapshot_sources_shape" CHECK (
    "snapshot_ref" ~ '^snapshot_[a-f0-9]{32}$' and "content_hash" ~ '^[a-f0-9]{64}$'
  )
);--> statement-breakpoint

CREATE UNIQUE INDEX "deterministic_feature_snapshots_workspace_id_unique" ON "deterministic_feature_snapshots" USING btree ("workspace_id", "id");--> statement-breakpoint

ALTER TABLE "deterministic_feature_snapshots" ADD CONSTRAINT "deterministic_feature_snapshots_workspace_id_workspaces_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "deterministic_feature_snapshots" ADD CONSTRAINT "deterministic_feature_snapshots_connection_scope_fk"
  FOREIGN KEY ("workspace_id", "meta_connection_id") REFERENCES "public"."meta_connections"("workspace_id", "id") ON DELETE restrict;--> statement-breakpoint
ALTER TABLE "deterministic_feature_snapshots" ADD CONSTRAINT "deterministic_feature_snapshots_account_scope_fk"
  FOREIGN KEY ("workspace_id", "ad_account_id") REFERENCES "public"."ad_accounts"("workspace_id", "id") ON DELETE restrict;--> statement-breakpoint
ALTER TABLE "deterministic_feature_snapshot_sources" ADD CONSTRAINT "deterministic_feature_snapshot_sources_workspace_id_workspaces_id_fk"
  FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "deterministic_feature_snapshot_sources" ADD CONSTRAINT "deterministic_feature_snapshot_sources_feature_scope_fk"
  FOREIGN KEY ("workspace_id", "feature_snapshot_id") REFERENCES "public"."deterministic_feature_snapshots"("workspace_id", "id") ON DELETE cascade;--> statement-breakpoint
ALTER TABLE "deterministic_feature_snapshot_sources" ADD CONSTRAINT "deterministic_feature_snapshot_sources_insight_scope_fk"
  FOREIGN KEY ("workspace_id", "daily_insight_id") REFERENCES "public"."meta_daily_insights"("workspace_id", "id") ON DELETE restrict;--> statement-breakpoint

CREATE UNIQUE INDEX "deterministic_feature_snapshots_workspace_ref_unique" ON "deterministic_feature_snapshots" USING btree ("workspace_id", "feature_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "deterministic_feature_snapshots_workspace_hash_unique" ON "deterministic_feature_snapshots" USING btree ("workspace_id", "feature_hash");--> statement-breakpoint
CREATE INDEX "deterministic_feature_snapshots_scope_window_idx" ON "deterministic_feature_snapshots" USING btree ("workspace_id", "ad_account_id", "entity_level", "external_entity_id", "start_date", "end_date");--> statement-breakpoint
CREATE UNIQUE INDEX "deterministic_feature_snapshot_sources_exact_unique" ON "deterministic_feature_snapshot_sources" USING btree ("feature_snapshot_id", "daily_insight_id");--> statement-breakpoint
CREATE UNIQUE INDEX "deterministic_feature_snapshot_sources_snapshot_unique" ON "deterministic_feature_snapshot_sources" USING btree ("feature_snapshot_id", "snapshot_ref");--> statement-breakpoint
CREATE INDEX "deterministic_feature_snapshot_sources_insight_idx" ON "deterministic_feature_snapshot_sources" USING btree ("workspace_id", "daily_insight_id");--> statement-breakpoint

ALTER TABLE "deterministic_feature_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deterministic_feature_snapshots" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deterministic_feature_snapshot_sources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deterministic_feature_snapshot_sources" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "deterministic_feature_snapshots", "deterministic_feature_snapshot_sources" FROM PUBLIC, anon, authenticated, service_role;--> statement-breakpoint

CREATE FUNCTION deterministic_feature_snapshot_immutable() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' AND EXISTS (
    SELECT 1 FROM public.workspaces WHERE id = OLD.workspace_id AND lifecycle_state = 'tombstoning'
  ) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'deterministic feature snapshots are append-only';
END;
$$;--> statement-breakpoint
CREATE FUNCTION deterministic_feature_snapshot_source_immutable() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' AND EXISTS (
    SELECT 1 FROM public.workspaces WHERE id = OLD.workspace_id AND lifecycle_state = 'tombstoning'
  ) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'deterministic feature snapshot sources are append-only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER deterministic_feature_snapshot_guard BEFORE UPDATE OR DELETE ON deterministic_feature_snapshots
  FOR EACH ROW EXECUTE FUNCTION deterministic_feature_snapshot_immutable();--> statement-breakpoint
CREATE TRIGGER deterministic_feature_snapshot_source_guard BEFORE UPDATE OR DELETE ON deterministic_feature_snapshot_sources
  FOR EACH ROW EXECUTE FUNCTION deterministic_feature_snapshot_source_immutable();--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION deterministic_feature_snapshot_immutable() FROM PUBLIC, anon, authenticated, service_role;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION deterministic_feature_snapshot_source_immutable() FROM PUBLIC, anon, authenticated, service_role;
