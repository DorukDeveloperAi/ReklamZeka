CREATE TABLE "creative_diagnostic_definition_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"definition_ref" text NOT NULL,
	"revision" integer NOT NULL,
	"definition_hash" text NOT NULL,
	"previous_hash" text,
	"state" text NOT NULL,
	"definition_payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creative_diagnostic_definition_revisions_shape" CHECK ("creative_diagnostic_definition_revisions"."definition_ref" ~ '^creative_definition_[a-f0-9]{24}$' and "creative_diagnostic_definition_revisions"."revision" >= 1 and "creative_diagnostic_definition_revisions"."definition_hash" ~ '^[a-f0-9]{64}$' and ("creative_diagnostic_definition_revisions"."previous_hash" is null or "creative_diagnostic_definition_revisions"."previous_hash" ~ '^[a-f0-9]{64}$') and "creative_diagnostic_definition_revisions"."state" in ('draft', 'published', 'retired') and jsonb_typeof("creative_diagnostic_definition_revisions"."definition_payload") = 'object')
);
--> statement-breakpoint
CREATE TABLE "creative_fatigue_config_diagnostic_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"target_evidence_id" uuid NOT NULL,
	"definition_revision_id" uuid NOT NULL,
	"baseline_config_snapshot_id" uuid NOT NULL,
	"recent_config_snapshot_id" uuid NOT NULL,
	"baseline_window_id" uuid NOT NULL,
	"recent_window_id" uuid NOT NULL,
	"diagnostic_hash" text NOT NULL,
	"result_payload" jsonb NOT NULL,
	"capabilities" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creative_fatigue_config_diagnostic_assets_shape" CHECK ("creative_fatigue_config_diagnostic_assets"."diagnostic_hash" ~ '^[a-f0-9]{64}$' and jsonb_typeof("creative_fatigue_config_diagnostic_assets"."result_payload") = 'object' and "creative_fatigue_config_diagnostic_assets"."capabilities" = '{"canAuthorizeAction":false,"canExecuteWrite":false,"canWriteMeta":false,"canPublish":false,"canApprove":false,"canExecute":false,"canAccessNetwork":false}'::jsonb)
);
--> statement-breakpoint
CREATE TABLE "meta_creative_config_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"target_evidence_id" uuid NOT NULL,
	"ad_id" uuid NOT NULL,
	"creative_id" uuid NOT NULL,
	"binding_hash" text NOT NULL,
	"creative_content_hash" text NOT NULL,
	"config_payload" jsonb NOT NULL,
	"snapshot_hash" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meta_creative_config_snapshots_shape" CHECK ("meta_creative_config_snapshots"."binding_hash" ~ '^[a-f0-9]{64}$' and "meta_creative_config_snapshots"."creative_content_hash" ~ '^[a-f0-9]{64}$' and "meta_creative_config_snapshots"."snapshot_hash" ~ '^[a-f0-9]{64}$' and jsonb_typeof("meta_creative_config_snapshots"."config_payload") = 'object')
);
--> statement-breakpoint
CREATE TABLE "meta_creative_window_insight_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"config_snapshot_id" uuid NOT NULL,
	"window_kind" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"frequency" numeric(30, 12) NOT NULL,
	"clicks" bigint NOT NULL,
	"impressions" bigint NOT NULL,
	"attribution_label" text NOT NULL,
	"timezone" text NOT NULL,
	"daily_coverage" jsonb NOT NULL,
	"source_ref" text NOT NULL,
	"source_hash" text NOT NULL,
	"snapshot_hash" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meta_creative_window_insight_snapshots_shape" CHECK ("meta_creative_window_insight_snapshots"."window_kind" in ('baseline', 'recent') and "meta_creative_window_insight_snapshots"."start_date" <= "meta_creative_window_insight_snapshots"."end_date" and "meta_creative_window_insight_snapshots"."frequency" >= 0 and "meta_creative_window_insight_snapshots"."clicks" >= 0 and "meta_creative_window_insight_snapshots"."impressions" >= 0 and btrim("meta_creative_window_insight_snapshots"."attribution_label") <> '' and btrim("meta_creative_window_insight_snapshots"."timezone") <> '' and "meta_creative_window_insight_snapshots"."source_ref" ~ '^creative_window_[a-f0-9]{24}$' and "meta_creative_window_insight_snapshots"."source_hash" ~ '^[a-f0-9]{64}$' and "meta_creative_window_insight_snapshots"."snapshot_hash" ~ '^[a-f0-9]{64}$' and jsonb_typeof("meta_creative_window_insight_snapshots"."daily_coverage") = 'array')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "creative_diagnostic_definition_revisions_workspace_id_unique" ON "creative_diagnostic_definition_revisions" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "meta_creative_config_snapshots_workspace_id_unique" ON "meta_creative_config_snapshots" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "meta_creative_window_insight_snapshots_workspace_id_unique" ON "meta_creative_window_insight_snapshots" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "meta_ads_workspace_id_unique" ON "meta_ads" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "meta_creatives_workspace_id_unique" ON "meta_creatives" USING btree ("workspace_id","id");--> statement-breakpoint
ALTER TABLE "creative_diagnostic_definition_revisions" ADD CONSTRAINT "creative_diagnostic_definition_revisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_fatigue_config_diagnostic_assets" ADD CONSTRAINT "creative_fatigue_config_diagnostic_assets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_fatigue_config_diagnostic_assets" ADD CONSTRAINT "creative_fatigue_config_diagnostic_assets_evidence_scope_fk" FOREIGN KEY ("workspace_id","target_evidence_id") REFERENCES "public"."frozen_diagnostic_evidence"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_fatigue_config_diagnostic_assets" ADD CONSTRAINT "creative_fatigue_config_diagnostic_assets_definition_scope_fk" FOREIGN KEY ("workspace_id","definition_revision_id") REFERENCES "public"."creative_diagnostic_definition_revisions"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_fatigue_config_diagnostic_assets" ADD CONSTRAINT "creative_fatigue_config_diagnostic_assets_baseline_config_scope_fk" FOREIGN KEY ("workspace_id","baseline_config_snapshot_id") REFERENCES "public"."meta_creative_config_snapshots"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_fatigue_config_diagnostic_assets" ADD CONSTRAINT "creative_fatigue_config_diagnostic_assets_recent_config_scope_fk" FOREIGN KEY ("workspace_id","recent_config_snapshot_id") REFERENCES "public"."meta_creative_config_snapshots"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_fatigue_config_diagnostic_assets" ADD CONSTRAINT "creative_fatigue_config_diagnostic_assets_baseline_window_scope_fk" FOREIGN KEY ("workspace_id","baseline_window_id") REFERENCES "public"."meta_creative_window_insight_snapshots"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_fatigue_config_diagnostic_assets" ADD CONSTRAINT "creative_fatigue_config_diagnostic_assets_recent_window_scope_fk" FOREIGN KEY ("workspace_id","recent_window_id") REFERENCES "public"."meta_creative_window_insight_snapshots"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_creative_config_snapshots" ADD CONSTRAINT "meta_creative_config_snapshots_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_creative_config_snapshots" ADD CONSTRAINT "meta_creative_config_snapshots_evidence_scope_fk" FOREIGN KEY ("workspace_id","target_evidence_id") REFERENCES "public"."frozen_diagnostic_evidence"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_creative_config_snapshots" ADD CONSTRAINT "meta_creative_config_snapshots_ad_scope_fk" FOREIGN KEY ("workspace_id","ad_id") REFERENCES "public"."meta_ads"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_creative_config_snapshots" ADD CONSTRAINT "meta_creative_config_snapshots_creative_scope_fk" FOREIGN KEY ("workspace_id","creative_id") REFERENCES "public"."meta_creatives"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_creative_window_insight_snapshots" ADD CONSTRAINT "meta_creative_window_insight_snapshots_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_creative_window_insight_snapshots" ADD CONSTRAINT "meta_creative_window_insight_snapshots_config_scope_fk" FOREIGN KEY ("workspace_id","config_snapshot_id") REFERENCES "public"."meta_creative_config_snapshots"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "creative_diagnostic_definition_revisions_exact_unique" ON "creative_diagnostic_definition_revisions" USING btree ("workspace_id","definition_ref","revision");--> statement-breakpoint
CREATE INDEX "creative_diagnostic_definition_revisions_lookup_idx" ON "creative_diagnostic_definition_revisions" USING btree ("workspace_id","definition_ref","state","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "creative_fatigue_config_diagnostic_assets_hash_unique" ON "creative_fatigue_config_diagnostic_assets" USING btree ("workspace_id","diagnostic_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "creative_fatigue_config_diagnostic_assets_workspace_id_unique" ON "creative_fatigue_config_diagnostic_assets" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE INDEX "creative_fatigue_config_diagnostic_assets_target_idx" ON "creative_fatigue_config_diagnostic_assets" USING btree ("workspace_id","target_evidence_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "meta_creative_config_snapshots_hash_unique" ON "meta_creative_config_snapshots" USING btree ("workspace_id","snapshot_hash");--> statement-breakpoint
CREATE INDEX "meta_creative_config_snapshots_evidence_idx" ON "meta_creative_config_snapshots" USING btree ("workspace_id","target_evidence_id","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "meta_creative_window_insight_snapshots_hash_unique" ON "meta_creative_window_insight_snapshots" USING btree ("workspace_id","snapshot_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "meta_creative_window_insight_snapshots_exact_unique" ON "meta_creative_window_insight_snapshots" USING btree ("config_snapshot_id","window_kind","start_date","end_date","attribution_label");--> statement-breakpoint
CREATE INDEX "meta_creative_window_insight_snapshots_config_idx" ON "meta_creative_window_insight_snapshots" USING btree ("workspace_id","config_snapshot_id","observed_at");
--> statement-breakpoint
ALTER TABLE "creative_diagnostic_definition_revisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "creative_diagnostic_definition_revisions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "meta_creative_config_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "meta_creative_config_snapshots" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "meta_creative_window_insight_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "meta_creative_window_insight_snapshots" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "creative_fatigue_config_diagnostic_assets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "creative_fatigue_config_diagnostic_assets" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "creative_diagnostic_definition_revisions", "meta_creative_config_snapshots", "meta_creative_window_insight_snapshots", "creative_fatigue_config_diagnostic_assets" FROM PUBLIC, anon, authenticated, service_role;--> statement-breakpoint
CREATE FUNCTION public.creative_diagnostic_append_only_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' AND EXISTS (SELECT 1 FROM public.workspaces WHERE id = OLD.workspace_id AND lifecycle_state = 'tombstoning') THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'creative_diagnostic_append_only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER creative_diagnostic_definition_revisions_append_only BEFORE UPDATE OR DELETE ON "creative_diagnostic_definition_revisions" FOR EACH ROW EXECUTE FUNCTION public.creative_diagnostic_append_only_guard();--> statement-breakpoint
CREATE TRIGGER meta_creative_config_snapshots_append_only BEFORE UPDATE OR DELETE ON "meta_creative_config_snapshots" FOR EACH ROW EXECUTE FUNCTION public.creative_diagnostic_append_only_guard();--> statement-breakpoint
CREATE TRIGGER meta_creative_window_insight_snapshots_append_only BEFORE UPDATE OR DELETE ON "meta_creative_window_insight_snapshots" FOR EACH ROW EXECUTE FUNCTION public.creative_diagnostic_append_only_guard();--> statement-breakpoint
CREATE TRIGGER creative_fatigue_config_diagnostic_assets_append_only BEFORE UPDATE OR DELETE ON "creative_fatigue_config_diagnostic_assets" FOR EACH ROW EXECUTE FUNCTION public.creative_diagnostic_append_only_guard();--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION public.creative_diagnostic_append_only_guard() FROM PUBLIC, anon, authenticated, service_role;
