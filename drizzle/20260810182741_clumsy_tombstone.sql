CREATE TABLE "deterministic_feature_snapshot_invalidations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"event_hash" text NOT NULL,
	"feature_snapshot_id" uuid NOT NULL,
	"daily_insight_id" uuid NOT NULL,
	"previous_source_payload_hash" text NOT NULL,
	"current_source_payload_hash" text NOT NULL,
	"reason_code" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deterministic_feature_snapshot_invalidations_shape" CHECK ("deterministic_feature_snapshot_invalidations"."event_hash" ~ '^[a-f0-9]{64}$' and "deterministic_feature_snapshot_invalidations"."reason_code" = 'l1_source_changed' and "deterministic_feature_snapshot_invalidations"."previous_source_payload_hash" <> "deterministic_feature_snapshot_invalidations"."current_source_payload_hash")
);
--> statement-breakpoint
ALTER TABLE "deterministic_feature_snapshot_invalidations" ADD CONSTRAINT "deterministic_feature_snapshot_invalidations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deterministic_feature_snapshot_invalidations" ADD CONSTRAINT "deterministic_feature_snapshot_invalidations_feature_scope_fk" FOREIGN KEY ("workspace_id","feature_snapshot_id") REFERENCES "public"."deterministic_feature_snapshots"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deterministic_feature_snapshot_invalidations" ADD CONSTRAINT "deterministic_feature_snapshot_invalidations_insight_scope_fk" FOREIGN KEY ("workspace_id","daily_insight_id") REFERENCES "public"."meta_daily_insights"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deterministic_feature_snapshot_invalidations_workspace_id_unique" ON "deterministic_feature_snapshot_invalidations" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "deterministic_feature_snapshot_invalidations_workspace_event_unique" ON "deterministic_feature_snapshot_invalidations" USING btree ("workspace_id","event_hash");--> statement-breakpoint
CREATE INDEX "deterministic_feature_snapshot_invalidations_feature_idx" ON "deterministic_feature_snapshot_invalidations" USING btree ("workspace_id","feature_snapshot_id");--> statement-breakpoint
CREATE INDEX "deterministic_feature_snapshot_invalidations_insight_idx" ON "deterministic_feature_snapshot_invalidations" USING btree ("workspace_id","daily_insight_id");--> statement-breakpoint

ALTER TABLE "deterministic_feature_snapshot_invalidations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deterministic_feature_snapshot_invalidations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "deterministic_feature_snapshot_invalidations" FROM PUBLIC, anon, authenticated, service_role;--> statement-breakpoint

CREATE FUNCTION deterministic_feature_snapshot_invalidation_immutable() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' AND EXISTS (
    SELECT 1 FROM public.workspaces WHERE id = OLD.workspace_id AND lifecycle_state = 'tombstoning'
  ) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'deterministic feature snapshot invalidations are append-only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER deterministic_feature_snapshot_invalidation_guard
  BEFORE UPDATE OR DELETE ON deterministic_feature_snapshot_invalidations
  FOR EACH ROW EXECUTE FUNCTION deterministic_feature_snapshot_invalidation_immutable();--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION deterministic_feature_snapshot_invalidation_immutable() FROM PUBLIC, anon, authenticated, service_role;
