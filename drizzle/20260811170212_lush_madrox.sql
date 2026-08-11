CREATE TABLE "creative_diagnostic_settlement_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"policy_ref" text NOT NULL,
	"current_revision" integer DEFAULT 0 NOT NULL,
	"current_policy_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creative_diagnostic_settlement_policies_identity" CHECK ("creative_diagnostic_settlement_policies"."policy_ref" ~ '^creative_settlement_[a-f0-9]{24}$' and "creative_diagnostic_settlement_policies"."current_revision" >= 0 and (("creative_diagnostic_settlement_policies"."current_revision" = 0 and "creative_diagnostic_settlement_policies"."current_policy_hash" is null) or ("creative_diagnostic_settlement_policies"."current_revision" > 0 and "creative_diagnostic_settlement_policies"."current_policy_hash" ~ '^[a-f0-9]{64}$')))
);
--> statement-breakpoint
CREATE TABLE "creative_diagnostic_settlement_policy_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"policy_id" uuid NOT NULL,
	"policy_ref" text NOT NULL,
	"revision" integer NOT NULL,
	"previous_hash" text,
	"policy_hash" text NOT NULL,
	"state" text NOT NULL,
	"settlement_lag_days" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creative_diagnostic_settlement_policy_revisions_shape" CHECK ("creative_diagnostic_settlement_policy_revisions"."policy_ref" ~ '^creative_settlement_[a-f0-9]{24}$' and "creative_diagnostic_settlement_policy_revisions"."revision" >= 1 and "creative_diagnostic_settlement_policy_revisions"."policy_hash" ~ '^[a-f0-9]{64}$' and ("creative_diagnostic_settlement_policy_revisions"."previous_hash" is null or "creative_diagnostic_settlement_policy_revisions"."previous_hash" ~ '^[a-f0-9]{64}$') and "creative_diagnostic_settlement_policy_revisions"."state" in ('draft', 'published', 'retired') and "creative_diagnostic_settlement_policy_revisions"."settlement_lag_days" between 0 and 90 and jsonb_typeof("creative_diagnostic_settlement_policy_revisions"."payload") = 'object')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "creative_diagnostic_settlement_policies_workspace_row_unique" ON "creative_diagnostic_settlement_policies" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "creative_diagnostic_settlement_policy_revisions_workspace_row_unique" ON "creative_diagnostic_settlement_policy_revisions" USING btree ("workspace_id","id");--> statement-breakpoint
ALTER TABLE "meta_creative_window_insight_snapshots" DROP CONSTRAINT "meta_creative_window_insight_snapshots_shape";--> statement-breakpoint
DROP INDEX "meta_creative_window_insight_snapshots_exact_unique";--> statement-breakpoint
ALTER TABLE "meta_creative_window_insight_snapshots" ADD COLUMN "settlement_policy_ref" text;--> statement-breakpoint
ALTER TABLE "meta_creative_window_insight_snapshots" ADD COLUMN "settlement_policy_hash" text;--> statement-breakpoint
ALTER TABLE "creative_diagnostic_settlement_policies" ADD CONSTRAINT "creative_diagnostic_settlement_policies_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_diagnostic_settlement_policy_revisions" ADD CONSTRAINT "creative_diagnostic_settlement_policy_revisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creative_diagnostic_settlement_policy_revisions" ADD CONSTRAINT "creative_diagnostic_settlement_policy_revisions_policy_scope_fk" FOREIGN KEY ("workspace_id","policy_id") REFERENCES "public"."creative_diagnostic_settlement_policies"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "creative_diagnostic_settlement_policies_workspace_ref_unique" ON "creative_diagnostic_settlement_policies" USING btree ("workspace_id","policy_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "creative_diagnostic_settlement_policy_revisions_exact_unique" ON "creative_diagnostic_settlement_policy_revisions" USING btree ("workspace_id","policy_ref","revision");--> statement-breakpoint
CREATE INDEX "creative_diagnostic_settlement_policy_revisions_lookup_idx" ON "creative_diagnostic_settlement_policy_revisions" USING btree ("workspace_id","policy_ref","state","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "meta_creative_window_insight_snapshots_exact_unique" ON "meta_creative_window_insight_snapshots" USING btree ("config_snapshot_id","window_kind","start_date","end_date","attribution_label","settlement_policy_hash");--> statement-breakpoint
ALTER TABLE "meta_creative_window_insight_snapshots" ADD CONSTRAINT "meta_creative_window_insight_snapshots_shape" CHECK ("meta_creative_window_insight_snapshots"."window_kind" in ('baseline', 'recent') and "meta_creative_window_insight_snapshots"."start_date" <= "meta_creative_window_insight_snapshots"."end_date" and "meta_creative_window_insight_snapshots"."frequency" >= 0 and "meta_creative_window_insight_snapshots"."clicks" >= 0 and "meta_creative_window_insight_snapshots"."impressions" >= 0 and btrim("meta_creative_window_insight_snapshots"."attribution_label") <> '' and btrim("meta_creative_window_insight_snapshots"."timezone") <> '' and "meta_creative_window_insight_snapshots"."source_ref" ~ '^creative_window_[a-f0-9]{24}$' and "meta_creative_window_insight_snapshots"."source_hash" ~ '^[a-f0-9]{64}$' and (("meta_creative_window_insight_snapshots"."settlement_policy_ref" is null and "meta_creative_window_insight_snapshots"."settlement_policy_hash" is null) or ("meta_creative_window_insight_snapshots"."settlement_policy_ref" ~ '^creative_settlement_[a-f0-9]{24}$' and "meta_creative_window_insight_snapshots"."settlement_policy_hash" ~ '^[a-f0-9]{64}$')) and "meta_creative_window_insight_snapshots"."snapshot_hash" ~ '^[a-f0-9]{64}$' and jsonb_typeof("meta_creative_window_insight_snapshots"."daily_coverage") = 'array');
--> statement-breakpoint
ALTER TABLE "creative_diagnostic_settlement_policies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "creative_diagnostic_settlement_policies" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "creative_diagnostic_settlement_policy_revisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "creative_diagnostic_settlement_policy_revisions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "creative_diagnostic_settlement_policies", "creative_diagnostic_settlement_policy_revisions" FROM PUBLIC, anon, authenticated, service_role;--> statement-breakpoint
CREATE FUNCTION public.creative_diagnostic_settlement_policy_revision_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE expected_previous text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    IF TG_OP = 'DELETE' AND EXISTS (SELECT 1 FROM public.workspaces WHERE id = OLD.workspace_id AND lifecycle_state = 'tombstoning') THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'creative_diagnostic_settlement_policy_append_only';
  END IF;
  IF NEW.revision = 1 THEN
    IF NEW.previous_hash IS NOT NULL OR EXISTS (
      SELECT 1 FROM public.creative_diagnostic_settlement_policy_revisions existing
      WHERE existing.workspace_id = NEW.workspace_id AND existing.policy_id = NEW.policy_id
    ) THEN RAISE EXCEPTION 'creative_diagnostic_settlement_policy_genesis_conflict'; END IF;
  ELSE
    SELECT previous.policy_hash INTO expected_previous
    FROM public.creative_diagnostic_settlement_policy_revisions previous
    WHERE previous.workspace_id = NEW.workspace_id AND previous.policy_id = NEW.policy_id AND previous.revision = NEW.revision - 1;
    IF expected_previous IS NULL OR expected_previous <> NEW.previous_hash THEN
      RAISE EXCEPTION 'creative_diagnostic_settlement_policy_chain_conflict';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE FUNCTION public.creative_diagnostic_settlement_policy_head_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.workspaces WHERE id = OLD.workspace_id AND lifecycle_state = 'tombstoning') THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'creative_diagnostic_settlement_policy_append_only';
  END IF;
  IF NEW.workspace_id <> OLD.workspace_id OR NEW.id <> OLD.id OR NEW.policy_ref <> OLD.policy_ref
    OR NEW.current_revision <> OLD.current_revision + 1
    OR NOT EXISTS (
      SELECT 1 FROM public.creative_diagnostic_settlement_policy_revisions revision
      WHERE revision.workspace_id = NEW.workspace_id AND revision.policy_id = NEW.id
        AND revision.policy_ref = NEW.policy_ref AND revision.revision = NEW.current_revision
        AND revision.policy_hash = NEW.current_policy_hash
    ) THEN RAISE EXCEPTION 'creative_diagnostic_settlement_policy_head_occ_conflict'; END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER creative_diagnostic_settlement_policy_revisions_append_only BEFORE INSERT OR UPDATE OR DELETE ON "creative_diagnostic_settlement_policy_revisions" FOR EACH ROW EXECUTE FUNCTION public.creative_diagnostic_settlement_policy_revision_guard();--> statement-breakpoint
CREATE TRIGGER creative_diagnostic_settlement_policies_head_guard BEFORE INSERT OR UPDATE OR DELETE ON "creative_diagnostic_settlement_policies" FOR EACH ROW EXECUTE FUNCTION public.creative_diagnostic_settlement_policy_head_guard();--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION public.creative_diagnostic_settlement_policy_revision_guard(), public.creative_diagnostic_settlement_policy_head_guard() FROM PUBLIC, anon, authenticated, service_role;
