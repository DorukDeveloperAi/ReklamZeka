CREATE TABLE "organization_campaign_meta_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"organization_campaign_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"market_definition_id" uuid NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone,
	"assigned_by_actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_campaign_meta_memberships_effective_range" CHECK ("organization_campaign_meta_memberships"."effective_to" is null or "organization_campaign_meta_memberships"."effective_to" > "organization_campaign_meta_memberships"."effective_from")
);
--> statement-breakpoint
CREATE TABLE "organization_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"label" text NOT NULL,
	"market_definition_id" uuid NOT NULL,
	"created_by_actor_id" uuid NOT NULL,
	"tombstoned_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organization_campaigns_label_nonempty" CHECK (length(btrim("organization_campaigns"."label")) between 1 and 160)
);
--> statement-breakpoint
-- PostgreSQL requires the referenced composite uniqueness to exist before the
-- membership FK is added. Keep these indexes ahead of the ALTER TABLE block.
CREATE UNIQUE INDEX "organization_campaigns_workspace_row_unique" ON "organization_campaigns" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "organization_campaigns_workspace_market_row_unique" ON "organization_campaigns" USING btree ("workspace_id","id","market_definition_id");--> statement-breakpoint
ALTER TABLE "organization_campaign_meta_memberships" ADD CONSTRAINT "organization_campaign_meta_memberships_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_campaign_meta_memberships" ADD CONSTRAINT "organization_campaign_meta_memberships_org_market_scope_fk" FOREIGN KEY ("workspace_id","organization_campaign_id","market_definition_id") REFERENCES "public"."organization_campaigns"("workspace_id","id","market_definition_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_campaign_meta_memberships" ADD CONSTRAINT "organization_campaign_meta_memberships_market_definition_scope_fk" FOREIGN KEY ("workspace_id","market_definition_id") REFERENCES "public"."category_definitions"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_campaign_meta_memberships" ADD CONSTRAINT "organization_campaign_meta_memberships_campaign_scope_fk" FOREIGN KEY ("workspace_id","campaign_id") REFERENCES "public"."ad_campaigns"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_campaign_meta_memberships" ADD CONSTRAINT "organization_campaign_meta_memberships_actor_scope_fk" FOREIGN KEY ("workspace_id","assigned_by_actor_id") REFERENCES "public"."memberships"("workspace_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_campaigns" ADD CONSTRAINT "organization_campaigns_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_campaigns" ADD CONSTRAINT "organization_campaigns_creator_scope_fk" FOREIGN KEY ("workspace_id","created_by_actor_id") REFERENCES "public"."memberships"("workspace_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_campaigns" ADD CONSTRAINT "organization_campaigns_market_definition_scope_fk" FOREIGN KEY ("workspace_id","market_definition_id") REFERENCES "public"."category_definitions"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "organization_campaign_meta_memberships_workspace_row_unique" ON "organization_campaign_meta_memberships" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE INDEX "organization_campaign_meta_memberships_campaign_temporal_idx" ON "organization_campaign_meta_memberships" USING btree ("workspace_id","campaign_id","effective_from");--> statement-breakpoint
CREATE INDEX "organization_campaign_meta_memberships_org_temporal_idx" ON "organization_campaign_meta_memberships" USING btree ("workspace_id","organization_campaign_id","effective_from");--> statement-breakpoint
CREATE INDEX "organization_campaigns_workspace_active_idx" ON "organization_campaigns" USING btree ("workspace_id","tombstoned_at","created_at");--> statement-breakpoint

-- A Meta campaign may have at most one live Kurum Kampanyası at a time.
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
ALTER TABLE "organization_campaign_meta_memberships" ADD CONSTRAINT "organization_campaign_meta_memberships_no_overlap" EXCLUDE USING gist (
  "workspace_id" WITH =,
  "campaign_id" WITH =,
  tstzrange("effective_from", "effective_to", '[)') WITH &&
);--> statement-breakpoint

ALTER TABLE "organization_campaigns" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "organization_campaigns" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "organization_campaign_meta_memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "organization_campaign_meta_memberships" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "organization_campaigns" FROM PUBLIC, anon, authenticated, service_role;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "organization_campaign_meta_memberships" FROM PUBLIC, anon, authenticated, service_role;--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.organization_campaign_append_only_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM public.category_definitions definition JOIN public.category_dimensions dimension
      ON dimension.id = definition.dimension_id AND dimension.workspace_id = definition.workspace_id
      WHERE definition.workspace_id = NEW.workspace_id AND definition.id = NEW.market_definition_id
        AND definition.archived_at is null AND dimension.archived_at is null AND dimension.key = 'market'
        AND definition.key in ('yerli', 'yabanci')) THEN RAISE EXCEPTION 'market definition must be active canonical market evidence'; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.tombstoned_at is null AND NEW.tombstoned_at is not null
    AND NEW.id = OLD.id AND NEW.workspace_id = OLD.workspace_id AND NEW.label = OLD.label AND NEW.market_definition_id = OLD.market_definition_id
    AND NEW.created_by_actor_id = OLD.created_by_actor_id AND NEW.created_at = OLD.created_at THEN RETURN NEW; END IF;
  IF TG_OP = 'DELETE' AND EXISTS (SELECT 1 FROM public.workspaces WHERE id = OLD.workspace_id AND lifecycle_state = 'tombstoning') THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'organization campaigns are append-only; only tombstoning is allowed';
END;
$$;--> statement-breakpoint
CREATE TRIGGER organization_campaigns_append_only BEFORE INSERT OR UPDATE OR DELETE ON "organization_campaigns" FOR EACH ROW EXECUTE FUNCTION public.organization_campaign_append_only_guard();--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.organization_campaign_meta_membership_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM public.organization_campaigns campaign WHERE campaign.id = NEW.organization_campaign_id
      AND campaign.workspace_id = NEW.workspace_id AND campaign.market_definition_id = NEW.market_definition_id AND campaign.tombstoned_at is null) THEN
      RAISE EXCEPTION 'organization campaign must be active and market-aligned';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.category_definitions definition JOIN public.category_dimensions dimension
      ON dimension.id = definition.dimension_id AND dimension.workspace_id = definition.workspace_id
      WHERE definition.workspace_id = NEW.workspace_id AND definition.id = NEW.market_definition_id
        AND definition.archived_at is null AND dimension.archived_at is null AND dimension.key = 'market'
        AND definition.key in ('yerli', 'yabanci')) THEN RAISE EXCEPTION 'market definition must be active canonical market evidence'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.category_assignments assignment JOIN public.category_definitions definition ON definition.id = assignment.definition_id AND definition.workspace_id = assignment.workspace_id JOIN public.category_dimensions dimension ON dimension.id = definition.dimension_id AND dimension.workspace_id = definition.workspace_id WHERE assignment.workspace_id = NEW.workspace_id AND assignment.entity_level = 'campaign' AND assignment.campaign_id = NEW.campaign_id AND assignment.archived_at is null AND assignment.operation in ('add', 'override') AND dimension.key = 'market' AND definition.id = NEW.market_definition_id)
      OR EXISTS (SELECT 1 FROM public.category_assignments assignment JOIN public.category_definitions definition ON definition.id = assignment.definition_id AND definition.workspace_id = assignment.workspace_id JOIN public.category_dimensions dimension ON dimension.id = definition.dimension_id AND dimension.workspace_id = definition.workspace_id WHERE assignment.workspace_id = NEW.workspace_id AND assignment.entity_level = 'campaign' AND assignment.campaign_id = NEW.campaign_id AND assignment.archived_at is null AND assignment.operation in ('add', 'override') AND dimension.key = 'market' AND definition.id <> NEW.market_definition_id) THEN RAISE EXCEPTION 'campaign market evidence is missing or conflicts'; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.effective_to is null AND NEW.effective_to is not null AND NEW.effective_to > OLD.effective_from AND NEW.id = OLD.id AND NEW.workspace_id = OLD.workspace_id AND NEW.organization_campaign_id = OLD.organization_campaign_id AND NEW.campaign_id = OLD.campaign_id AND NEW.market_definition_id = OLD.market_definition_id AND NEW.effective_from = OLD.effective_from AND NEW.assigned_by_actor_id = OLD.assigned_by_actor_id AND NEW.created_at = OLD.created_at THEN RETURN NEW; END IF;
  IF TG_OP = 'DELETE' AND EXISTS (SELECT 1 FROM public.workspaces WHERE id = OLD.workspace_id AND lifecycle_state = 'tombstoning') THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'organization campaign Meta memberships are append-only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER organization_campaign_meta_memberships_append_only BEFORE INSERT OR UPDATE OR DELETE ON "organization_campaign_meta_memberships" FOR EACH ROW EXECUTE FUNCTION public.organization_campaign_meta_membership_guard();--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION public.organization_campaign_append_only_guard() FROM PUBLIC, anon, authenticated, service_role;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION public.organization_campaign_meta_membership_guard() FROM PUBLIC, anon, authenticated, service_role;
