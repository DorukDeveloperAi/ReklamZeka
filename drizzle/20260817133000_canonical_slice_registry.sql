CREATE TABLE "slices" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "label" text NOT NULL,
  "market_definition_id" uuid NOT NULL,
  "created_by_actor_id" uuid NOT NULL,
  "current_published_revision_id" uuid,
  "tombstoned_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "slices_label_nonempty" CHECK (length(btrim("slices"."label")) between 1 and 160)
);
--> statement-breakpoint
CREATE TABLE "slice_revisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "slice_id" uuid NOT NULL,
  "revision_number" integer NOT NULL,
  "revision_ref" text NOT NULL,
  "definition_hash" text NOT NULL,
  "market_definition_id" uuid NOT NULL,
  "lifecycle" text NOT NULL,
  "source_revision_id" uuid,
  "created_by_actor_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "slice_revisions_identity" CHECK ("slice_revisions"."revision_number" >= 1 and "slice_revisions"."revision_ref" ~ '^slice_revision_[a-z0-9][a-z0-9_.:-]{0,190}$' and "slice_revisions"."definition_hash" ~ '^[a-f0-9]{64}$' and "slice_revisions"."lifecycle" in ('draft', 'published', 'archived'))
);
--> statement-breakpoint
CREATE TABLE "slice_revision_predicates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "slice_revision_id" uuid NOT NULL,
  "dimension_id" uuid NOT NULL,
  "position" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "slice_revision_predicates_position_positive" CHECK ("slice_revision_predicates"."position" >= 1)
);
--> statement-breakpoint
CREATE TABLE "slice_revision_predicate_values" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "predicate_id" uuid NOT NULL,
  "definition_id" uuid NOT NULL,
  "position" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "slice_revision_predicate_values_position_positive" CHECK ("slice_revision_predicate_values"."position" >= 1)
);
--> statement-breakpoint
CREATE TABLE "slice_revision_overrides" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "slice_revision_id" uuid NOT NULL,
  "operation" text NOT NULL,
  "entity_level" text NOT NULL,
  "organization_campaign_id" uuid,
  "campaign_id" uuid,
  "ad_set_id" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "slice_revision_overrides_target" CHECK ("slice_revision_overrides"."operation" in ('include', 'exclude') and ((("slice_revision_overrides"."entity_level" = 'organization_campaign') and "slice_revision_overrides"."organization_campaign_id" is not null and "slice_revision_overrides"."campaign_id" is null and "slice_revision_overrides"."ad_set_id" is null) or (("slice_revision_overrides"."entity_level" = 'campaign') and "slice_revision_overrides"."organization_campaign_id" is null and "slice_revision_overrides"."campaign_id" is not null and "slice_revision_overrides"."ad_set_id" is null) or (("slice_revision_overrides"."entity_level" = 'ad_set') and "slice_revision_overrides"."organization_campaign_id" is null and "slice_revision_overrides"."campaign_id" is null and "slice_revision_overrides"."ad_set_id" is not null)))
);
--> statement-breakpoint
CREATE TABLE "slice_resolution_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "slice_revision_id" uuid NOT NULL,
  "snapshot_hash" text NOT NULL,
  "resolved_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "slice_resolution_snapshots_hash" CHECK ("slice_resolution_snapshots"."snapshot_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "slice_resolution_snapshot_members" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL,
  "snapshot_id" uuid NOT NULL,
  "ordinal" integer NOT NULL,
  "entity_level" text NOT NULL,
  "organization_campaign_id" uuid,
  "campaign_id" uuid,
  "ad_set_id" uuid,
  "reason" text NOT NULL,
  "market_evidence_refs" jsonb NOT NULL,
  "matched_dimension_ids" jsonb NOT NULL,
  "matched_dimension_evidence_refs" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "slice_resolution_snapshot_members_target" CHECK ("slice_resolution_snapshot_members"."ordinal" >= 1 and "slice_resolution_snapshot_members"."reason" in ('dynamic_filter', 'explicit_include') and ((("slice_resolution_snapshot_members"."entity_level" = 'organization_campaign') and "slice_resolution_snapshot_members"."organization_campaign_id" is not null and "slice_resolution_snapshot_members"."campaign_id" is null and "slice_resolution_snapshot_members"."ad_set_id" is null) or (("slice_resolution_snapshot_members"."entity_level" = 'campaign') and "slice_resolution_snapshot_members"."organization_campaign_id" is null and "slice_resolution_snapshot_members"."campaign_id" is not null and "slice_resolution_snapshot_members"."ad_set_id" is null) or (("slice_resolution_snapshot_members"."entity_level" = 'ad_set') and "slice_resolution_snapshot_members"."organization_campaign_id" is null and "slice_resolution_snapshot_members"."campaign_id" is null and "slice_resolution_snapshot_members"."ad_set_id" is not null)))
);
--> statement-breakpoint
ALTER TABLE "slices" ADD CONSTRAINT "slices_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slices" ADD CONSTRAINT "slices_market_definition_scope_fk" FOREIGN KEY ("workspace_id","market_definition_id") REFERENCES "public"."category_definitions"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slices" ADD CONSTRAINT "slices_creator_scope_fk" FOREIGN KEY ("workspace_id","created_by_actor_id") REFERENCES "public"."memberships"("workspace_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slice_revisions" ADD CONSTRAINT "slice_revisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slice_revisions" ADD CONSTRAINT "slice_revisions_slice_market_scope_fk" FOREIGN KEY ("workspace_id","slice_id","market_definition_id") REFERENCES "public"."slices"("workspace_id","id","market_definition_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slice_revisions" ADD CONSTRAINT "slice_revisions_market_definition_scope_fk" FOREIGN KEY ("workspace_id","market_definition_id") REFERENCES "public"."category_definitions"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slice_revisions" ADD CONSTRAINT "slice_revisions_source_scope_fk" FOREIGN KEY ("workspace_id","source_revision_id") REFERENCES "public"."slice_revisions"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slice_revisions" ADD CONSTRAINT "slice_revisions_creator_scope_fk" FOREIGN KEY ("workspace_id","created_by_actor_id") REFERENCES "public"."memberships"("workspace_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slices" ADD CONSTRAINT "slices_current_published_revision_scope_fk" FOREIGN KEY ("workspace_id","current_published_revision_id") REFERENCES "public"."slice_revisions"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slice_revision_predicates" ADD CONSTRAINT "slice_revision_predicates_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slice_revision_predicates" ADD CONSTRAINT "slice_revision_predicates_revision_scope_fk" FOREIGN KEY ("workspace_id","slice_revision_id") REFERENCES "public"."slice_revisions"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slice_revision_predicates" ADD CONSTRAINT "slice_revision_predicates_dimension_scope_fk" FOREIGN KEY ("workspace_id","dimension_id") REFERENCES "public"."category_dimensions"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slice_revision_predicate_values" ADD CONSTRAINT "slice_revision_predicate_values_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slice_revision_predicate_values" ADD CONSTRAINT "slice_revision_predicate_values_predicate_scope_fk" FOREIGN KEY ("workspace_id","predicate_id") REFERENCES "public"."slice_revision_predicates"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slice_revision_predicate_values" ADD CONSTRAINT "slice_revision_predicate_values_definition_scope_fk" FOREIGN KEY ("workspace_id","definition_id") REFERENCES "public"."category_definitions"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slice_revision_overrides" ADD CONSTRAINT "slice_revision_overrides_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slice_revision_overrides" ADD CONSTRAINT "slice_revision_overrides_revision_scope_fk" FOREIGN KEY ("workspace_id","slice_revision_id") REFERENCES "public"."slice_revisions"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slice_revision_overrides" ADD CONSTRAINT "slice_revision_overrides_org_scope_fk" FOREIGN KEY ("workspace_id","organization_campaign_id") REFERENCES "public"."organization_campaigns"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slice_revision_overrides" ADD CONSTRAINT "slice_revision_overrides_campaign_scope_fk" FOREIGN KEY ("workspace_id","campaign_id") REFERENCES "public"."ad_campaigns"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slice_revision_overrides" ADD CONSTRAINT "slice_revision_overrides_ad_set_scope_fk" FOREIGN KEY ("workspace_id","ad_set_id") REFERENCES "public"."meta_ad_sets"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slice_resolution_snapshots" ADD CONSTRAINT "slice_resolution_snapshots_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slice_resolution_snapshots" ADD CONSTRAINT "slice_resolution_snapshots_revision_scope_fk" FOREIGN KEY ("workspace_id","slice_revision_id") REFERENCES "public"."slice_revisions"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slice_resolution_snapshot_members" ADD CONSTRAINT "slice_resolution_snapshot_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slice_resolution_snapshot_members" ADD CONSTRAINT "slice_resolution_snapshot_members_snapshot_scope_fk" FOREIGN KEY ("workspace_id","snapshot_id") REFERENCES "public"."slice_resolution_snapshots"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slice_resolution_snapshot_members" ADD CONSTRAINT "slice_resolution_snapshot_members_org_scope_fk" FOREIGN KEY ("workspace_id","organization_campaign_id") REFERENCES "public"."organization_campaigns"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slice_resolution_snapshot_members" ADD CONSTRAINT "slice_resolution_snapshot_members_campaign_scope_fk" FOREIGN KEY ("workspace_id","campaign_id") REFERENCES "public"."ad_campaigns"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slice_resolution_snapshot_members" ADD CONSTRAINT "slice_resolution_snapshot_members_ad_set_scope_fk" FOREIGN KEY ("workspace_id","ad_set_id") REFERENCES "public"."meta_ad_sets"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "slices_workspace_row_unique" ON "slices" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "slices_workspace_market_row_unique" ON "slices" USING btree ("workspace_id","id","market_definition_id");--> statement-breakpoint
CREATE INDEX "slices_workspace_current_idx" ON "slices" USING btree ("workspace_id","tombstoned_at","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "slice_revisions_workspace_row_unique" ON "slice_revisions" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "slice_revisions_workspace_slice_number_unique" ON "slice_revisions" USING btree ("workspace_id","slice_id","revision_number");--> statement-breakpoint
CREATE UNIQUE INDEX "slice_revisions_workspace_ref_unique" ON "slice_revisions" USING btree ("workspace_id","revision_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "slice_revisions_workspace_hash_unique" ON "slice_revisions" USING btree ("workspace_id","definition_hash");--> statement-breakpoint
CREATE INDEX "slice_revisions_workspace_slice_lifecycle_idx" ON "slice_revisions" USING btree ("workspace_id","slice_id","lifecycle","revision_number");--> statement-breakpoint
CREATE UNIQUE INDEX "slice_revision_predicates_workspace_row_unique" ON "slice_revision_predicates" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "slice_revision_predicates_dimension_unique" ON "slice_revision_predicates" USING btree ("workspace_id","slice_revision_id","dimension_id");--> statement-breakpoint
CREATE UNIQUE INDEX "slice_revision_predicates_position_unique" ON "slice_revision_predicates" USING btree ("workspace_id","slice_revision_id","position");--> statement-breakpoint
CREATE INDEX "slice_revision_predicates_workspace_revision_idx" ON "slice_revision_predicates" USING btree ("workspace_id","slice_revision_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "slice_revision_predicate_values_workspace_row_unique" ON "slice_revision_predicate_values" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "slice_revision_predicate_values_definition_unique" ON "slice_revision_predicate_values" USING btree ("workspace_id","predicate_id","definition_id");--> statement-breakpoint
CREATE UNIQUE INDEX "slice_revision_predicate_values_position_unique" ON "slice_revision_predicate_values" USING btree ("workspace_id","predicate_id","position");--> statement-breakpoint
CREATE INDEX "slice_revision_predicate_values_workspace_predicate_idx" ON "slice_revision_predicate_values" USING btree ("workspace_id","predicate_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "slice_revision_overrides_workspace_row_unique" ON "slice_revision_overrides" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "slice_revision_overrides_exact_target_unique" ON "slice_revision_overrides" USING btree ("workspace_id","slice_revision_id","operation","entity_level","organization_campaign_id","campaign_id","ad_set_id") NULLS NOT DISTINCT;--> statement-breakpoint
CREATE INDEX "slice_revision_overrides_workspace_revision_idx" ON "slice_revision_overrides" USING btree ("workspace_id","slice_revision_id","operation");--> statement-breakpoint
CREATE UNIQUE INDEX "slice_resolution_snapshots_workspace_row_unique" ON "slice_resolution_snapshots" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "slice_resolution_snapshots_workspace_hash_unique" ON "slice_resolution_snapshots" USING btree ("workspace_id","snapshot_hash");--> statement-breakpoint
CREATE INDEX "slice_resolution_snapshots_workspace_revision_idx" ON "slice_resolution_snapshots" USING btree ("workspace_id","slice_revision_id","resolved_at");--> statement-breakpoint
CREATE UNIQUE INDEX "slice_resolution_snapshot_members_workspace_row_unique" ON "slice_resolution_snapshot_members" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "slice_resolution_snapshot_members_ordinal_unique" ON "slice_resolution_snapshot_members" USING btree ("workspace_id","snapshot_id","ordinal");--> statement-breakpoint
CREATE INDEX "slice_resolution_snapshot_members_workspace_snapshot_idx" ON "slice_resolution_snapshot_members" USING btree ("workspace_id","snapshot_id","ordinal");--> statement-breakpoint

ALTER TABLE "slices" ENABLE ROW LEVEL SECURITY; ALTER TABLE "slices" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "slice_revisions" ENABLE ROW LEVEL SECURITY; ALTER TABLE "slice_revisions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "slice_revision_predicates" ENABLE ROW LEVEL SECURITY; ALTER TABLE "slice_revision_predicates" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "slice_revision_predicate_values" ENABLE ROW LEVEL SECURITY; ALTER TABLE "slice_revision_predicate_values" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "slice_revision_overrides" ENABLE ROW LEVEL SECURITY; ALTER TABLE "slice_revision_overrides" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "slice_resolution_snapshots" ENABLE ROW LEVEL SECURITY; ALTER TABLE "slice_resolution_snapshots" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "slice_resolution_snapshot_members" ENABLE ROW LEVEL SECURITY; ALTER TABLE "slice_resolution_snapshot_members" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "slices", "slice_revisions", "slice_revision_predicates", "slice_revision_predicate_values", "slice_revision_overrides", "slice_resolution_snapshots", "slice_resolution_snapshot_members" FROM PUBLIC, anon, authenticated, service_role;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.slice_canonical_market_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM category_definitions value JOIN category_dimensions dimension
    ON dimension.id = value.dimension_id AND dimension.workspace_id = value.workspace_id
    WHERE value.workspace_id = NEW.workspace_id AND value.id = NEW.market_definition_id
      AND value.archived_at IS NULL AND dimension.archived_at IS NULL
      AND dimension.key = 'market' AND value.key IN ('yerli', 'yabanci')) THEN
    RAISE EXCEPTION 'slice market must be an active canonical yerli/yabanci definition';
  END IF;
  IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;
  IF OLD.tombstoned_at IS NULL AND NEW.tombstoned_at IS NOT NULL
    AND NEW.id = OLD.id AND NEW.workspace_id = OLD.workspace_id AND NEW.label = OLD.label
    AND NEW.market_definition_id = OLD.market_definition_id AND NEW.created_by_actor_id = OLD.created_by_actor_id
    AND NEW.current_published_revision_id IS NOT DISTINCT FROM OLD.current_published_revision_id
    AND NEW.created_at = OLD.created_at THEN RETURN NEW; END IF;
  IF NEW.id = OLD.id AND NEW.workspace_id = OLD.workspace_id AND NEW.label = OLD.label
    AND NEW.market_definition_id = OLD.market_definition_id AND NEW.created_by_actor_id = OLD.created_by_actor_id
    AND NEW.tombstoned_at IS NOT DISTINCT FROM OLD.tombstoned_at AND NEW.created_at = OLD.created_at
    AND NEW.current_published_revision_id IS DISTINCT FROM OLD.current_published_revision_id
    AND NEW.current_published_revision_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM slice_revisions revision WHERE revision.id = NEW.current_published_revision_id
      AND revision.workspace_id = NEW.workspace_id AND revision.slice_id = NEW.id AND revision.lifecycle = 'published'
      AND revision.market_definition_id = NEW.market_definition_id) THEN RETURN NEW; END IF;
  IF TG_OP = 'DELETE' AND EXISTS (SELECT 1 FROM workspaces WHERE id = OLD.workspace_id AND lifecycle_state = 'tombstoning') THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'slices are append-only; only head advancement and tombstoning are allowed';
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.slice_append_only_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM slices slice WHERE slice.id = NEW.slice_id AND slice.workspace_id = NEW.workspace_id
      AND slice.tombstoned_at IS NULL AND slice.market_definition_id = NEW.market_definition_id) THEN
      RAISE EXCEPTION 'slice revision must belong to an active same-market slice';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' AND EXISTS (SELECT 1 FROM workspaces WHERE id = OLD.workspace_id AND lifecycle_state = 'tombstoning') THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'slice revision evidence is append-only';
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.slice_child_append_only_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;
  IF TG_OP = 'DELETE' AND EXISTS (SELECT 1 FROM workspaces WHERE id = OLD.workspace_id AND lifecycle_state = 'tombstoning') THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'slice evidence is append-only';
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.slice_predicate_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' AND EXISTS (SELECT 1 FROM slice_revisions revision JOIN category_definitions market ON market.id = revision.market_definition_id
    WHERE revision.id = NEW.slice_revision_id AND revision.workspace_id = NEW.workspace_id AND market.dimension_id = NEW.dimension_id) THEN
    RAISE EXCEPTION 'canonical market cannot be duplicated as a slice predicate';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.slice_predicate_value_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NOT EXISTS (SELECT 1 FROM slice_revision_predicates predicate JOIN category_definitions value
      ON value.id = NEW.definition_id AND value.workspace_id = NEW.workspace_id
    WHERE predicate.id = NEW.predicate_id AND predicate.workspace_id = NEW.workspace_id
      AND value.dimension_id = predicate.dimension_id AND value.archived_at IS NULL) THEN
    RAISE EXCEPTION 'slice predicate value must be an active value of the selected dimension';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER slices_append_only BEFORE INSERT OR UPDATE OR DELETE ON "slices" FOR EACH ROW EXECUTE FUNCTION public.slice_canonical_market_guard();--> statement-breakpoint
CREATE TRIGGER slice_revisions_append_only BEFORE INSERT OR UPDATE OR DELETE ON "slice_revisions" FOR EACH ROW EXECUTE FUNCTION public.slice_append_only_guard();--> statement-breakpoint
CREATE TRIGGER slice_revision_predicates_append_only BEFORE INSERT OR UPDATE OR DELETE ON "slice_revision_predicates" FOR EACH ROW EXECUTE FUNCTION public.slice_child_append_only_guard();--> statement-breakpoint
CREATE TRIGGER slice_revision_predicate_values_append_only BEFORE INSERT OR UPDATE OR DELETE ON "slice_revision_predicate_values" FOR EACH ROW EXECUTE FUNCTION public.slice_child_append_only_guard();--> statement-breakpoint
CREATE TRIGGER slice_revision_overrides_append_only BEFORE INSERT OR UPDATE OR DELETE ON "slice_revision_overrides" FOR EACH ROW EXECUTE FUNCTION public.slice_child_append_only_guard();--> statement-breakpoint
CREATE TRIGGER slice_resolution_snapshots_append_only BEFORE INSERT OR UPDATE OR DELETE ON "slice_resolution_snapshots" FOR EACH ROW EXECUTE FUNCTION public.slice_child_append_only_guard();--> statement-breakpoint
CREATE TRIGGER slice_resolution_snapshot_members_append_only BEFORE INSERT OR UPDATE OR DELETE ON "slice_resolution_snapshot_members" FOR EACH ROW EXECUTE FUNCTION public.slice_child_append_only_guard();--> statement-breakpoint
CREATE TRIGGER slice_revision_predicates_market_guard BEFORE INSERT ON "slice_revision_predicates" FOR EACH ROW EXECUTE FUNCTION public.slice_predicate_guard();--> statement-breakpoint
CREATE TRIGGER slice_revision_predicate_values_dimension_guard BEFORE INSERT ON "slice_revision_predicate_values" FOR EACH ROW EXECUTE FUNCTION public.slice_predicate_value_guard();--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION public.slice_canonical_market_guard(), public.slice_append_only_guard(), public.slice_child_append_only_guard(), public.slice_predicate_guard(), public.slice_predicate_value_guard() FROM PUBLIC, anon, authenticated, service_role;
