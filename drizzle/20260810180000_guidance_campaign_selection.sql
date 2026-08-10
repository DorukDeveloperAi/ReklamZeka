-- Persisted, tenant-bound campaign GuidanceSet selection. Revision rows are
-- immutable evidence; the separate head is only an optimistic-concurrency pointer.
CREATE OR REPLACE FUNCTION guidance_selection_topic_array_valid(value jsonb, minimum_count integer) RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = ''
AS $$
  SELECT pg_catalog.jsonb_typeof(value) = 'array'
    AND pg_catalog.jsonb_array_length(value) BETWEEN minimum_count AND 50
    AND NOT EXISTS (
      SELECT 1 FROM pg_catalog.jsonb_array_elements_text(value) AS item(topic)
      WHERE item.topic !~ '^[a-z][a-z0-9_.:-]{0,63}$'
    )
    AND (SELECT count(*) FROM pg_catalog.jsonb_array_elements_text(value))
      = (SELECT count(DISTINCT item.topic) FROM pg_catalog.jsonb_array_elements_text(value) AS item(topic));
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION guidance_selection_budget_valid(value jsonb) RETURNS boolean
LANGUAGE sql
IMMUTABLE
STRICT
SET search_path = ''
AS $$
  SELECT pg_catalog.jsonb_typeof(value) = 'object'
    AND value ?& ARRAY['maxCards', 'maxSources', 'maxCharacters']
    AND (SELECT count(*) FROM pg_catalog.jsonb_object_keys(value)) = 3
    AND (value #>> '{maxCards}') ~ '^[0-9]+$' AND (value #>> '{maxCards}')::integer BETWEEN 1 AND 100
    AND (value #>> '{maxSources}') ~ '^[0-9]+$' AND (value #>> '{maxSources}')::integer BETWEEN 1 AND 500
    AND (value #>> '{maxCharacters}') ~ '^[0-9]+$' AND (value #>> '{maxCharacters}')::integer BETWEEN 256 AND 200000;
$$;--> statement-breakpoint
CREATE TABLE "guidance_campaign_selection_revisions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "ad_account_id" uuid NOT NULL,
  "campaign_id" uuid NOT NULL,
  "selection_ref" text NOT NULL,
  "revision" integer NOT NULL,
  "selection_version" text NOT NULL,
  "selected_set_ref" text NOT NULL,
  "selected_set_version" integer NOT NULL,
  "selected_set_hash" text NOT NULL,
  "topics" jsonb NOT NULL,
  "required_topics" jsonb NOT NULL,
  "budget" jsonb NOT NULL,
  "source_selection_hash" text NOT NULL,
  "effective_at" timestamp with time zone NOT NULL,
  "previous_selection_hash" text NOT NULL,
  "selection_hash" text NOT NULL,
  "actor_ref" text NOT NULL,
  "actor_role" text NOT NULL,
  "occurred_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "guidance_campaign_selection_revisions_workspace_row_unique" UNIQUE("workspace_id", "id"),
  CONSTRAINT "guidance_campaign_selection_revisions_workspace_ref_revision_unique" UNIQUE("workspace_id", "selection_ref", "revision"),
  CONSTRAINT "guidance_campaign_selection_revisions_workspace_ref_hash_unique" UNIQUE("workspace_id", "selection_ref", "selection_hash"),
  CONSTRAINT "guidance_campaign_selection_revisions_account_scope_fk"
    FOREIGN KEY ("workspace_id", "ad_account_id") REFERENCES "ad_accounts"("workspace_id", "id") ON DELETE cascade,
  CONSTRAINT "guidance_campaign_selection_revisions_campaign_scope_fk"
    FOREIGN KEY ("workspace_id", "campaign_id") REFERENCES "ad_campaigns"("workspace_id", "id") ON DELETE cascade,
  CONSTRAINT "guidance_campaign_selection_revisions_identity" CHECK (
    "selection_ref" ~ '^guidance_selection_[a-z0-9][a-z0-9_.:-]{0,126}$'
    AND "revision" >= 1 AND "selection_version" = 'guidance-campaign-selection/1.0.0'
    AND btrim("selected_set_ref") <> '' AND "selected_set_version" >= 1
    AND "selected_set_hash" ~ '^[a-f0-9]{64}$' AND "source_selection_hash" ~ '^[a-f0-9]{64}$'
    AND "selection_hash" ~ '^[a-f0-9]{64}$'
    AND (("revision" = 1 AND "previous_selection_hash" = 'GENESIS')
      OR ("revision" > 1 AND "previous_selection_hash" ~ '^[a-f0-9]{64}$'))
    AND "actor_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    AND "actor_role" IN ('owner', 'admin') AND "effective_at" <= "occurred_at"
  ),
  CONSTRAINT "guidance_campaign_selection_revisions_topics" CHECK (
    guidance_selection_topic_array_valid("topics", 1)
    AND guidance_selection_topic_array_valid("required_topics", 0)
    AND "required_topics" <@ "topics"
    AND guidance_selection_budget_valid("budget")
  )
);--> statement-breakpoint
CREATE INDEX "guidance_campaign_selection_revisions_campaign_idx"
  ON "guidance_campaign_selection_revisions" ("workspace_id", "ad_account_id", "campaign_id", "created_at");--> statement-breakpoint
CREATE TABLE "guidance_campaign_selection_heads" (
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "ad_account_id" uuid NOT NULL,
  "campaign_id" uuid NOT NULL,
  "revision_id" uuid NOT NULL,
  "selection_ref" text NOT NULL,
  "revision" integer NOT NULL,
  "selection_hash" text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "guidance_campaign_selection_heads_scope_unique" UNIQUE("workspace_id", "ad_account_id", "campaign_id"),
  CONSTRAINT "guidance_campaign_selection_heads_workspace_revision_unique" UNIQUE("workspace_id", "revision_id"),
  CONSTRAINT "guidance_campaign_selection_heads_account_scope_fk"
    FOREIGN KEY ("workspace_id", "ad_account_id") REFERENCES "ad_accounts"("workspace_id", "id") ON DELETE cascade,
  CONSTRAINT "guidance_campaign_selection_heads_campaign_scope_fk"
    FOREIGN KEY ("workspace_id", "campaign_id") REFERENCES "ad_campaigns"("workspace_id", "id") ON DELETE cascade,
  CONSTRAINT "guidance_campaign_selection_heads_revision_scope_fk"
    FOREIGN KEY ("workspace_id", "revision_id") REFERENCES "guidance_campaign_selection_revisions"("workspace_id", "id") ON DELETE cascade,
  CONSTRAINT "guidance_campaign_selection_heads_identity" CHECK (
    "selection_ref" ~ '^guidance_selection_[a-z0-9][a-z0-9_.:-]{0,126}$'
    AND "revision" >= 1 AND "selection_hash" ~ '^[a-f0-9]{64}$'
  )
);--> statement-breakpoint
CREATE OR REPLACE FUNCTION guidance_campaign_selection_scope_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.ad_campaigns campaign
    WHERE campaign.workspace_id = NEW.workspace_id AND campaign.id = NEW.campaign_id
      AND campaign.ad_account_id = NEW.ad_account_id
  ) THEN RAISE EXCEPTION 'guidance selection campaign/account scope mismatch'; END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION guidance_campaign_selection_revision_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$ BEGIN RAISE EXCEPTION 'guidance campaign selection revisions are append-only'; END; $$;--> statement-breakpoint
CREATE OR REPLACE FUNCTION guidance_campaign_selection_head_matches_revision() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.guidance_campaign_selection_revisions revision
    WHERE revision.workspace_id = NEW.workspace_id AND revision.id = NEW.revision_id
      AND revision.ad_account_id = NEW.ad_account_id AND revision.campaign_id = NEW.campaign_id
      AND revision.selection_ref = NEW.selection_ref AND revision.revision = NEW.revision
      AND revision.selection_hash = NEW.selection_hash
  ) THEN RAISE EXCEPTION 'guidance selection head does not match revision'; END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "guidance_campaign_selection_revisions_scope_guard"
  BEFORE INSERT OR UPDATE ON "guidance_campaign_selection_revisions"
  FOR EACH ROW EXECUTE FUNCTION guidance_campaign_selection_scope_guard();--> statement-breakpoint
CREATE TRIGGER "guidance_campaign_selection_revisions_immutable"
  BEFORE UPDATE OR DELETE ON "guidance_campaign_selection_revisions"
  FOR EACH ROW EXECUTE FUNCTION guidance_campaign_selection_revision_immutable();--> statement-breakpoint
CREATE TRIGGER "guidance_campaign_selection_heads_scope_guard"
  BEFORE INSERT OR UPDATE ON "guidance_campaign_selection_heads"
  FOR EACH ROW EXECUTE FUNCTION guidance_campaign_selection_scope_guard();--> statement-breakpoint
CREATE TRIGGER "guidance_campaign_selection_heads_revision_guard"
  BEFORE INSERT OR UPDATE ON "guidance_campaign_selection_heads"
  FOR EACH ROW EXECUTE FUNCTION guidance_campaign_selection_head_matches_revision();--> statement-breakpoint
ALTER TABLE "guidance_campaign_selection_revisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "guidance_campaign_selection_revisions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "guidance_campaign_selection_heads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "guidance_campaign_selection_heads" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "guidance_campaign_selection_revisions", "guidance_campaign_selection_heads"
  FROM PUBLIC, anon, authenticated, service_role;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION guidance_selection_topic_array_valid(jsonb, integer), guidance_selection_budget_valid(jsonb),
  guidance_campaign_selection_scope_guard(), guidance_campaign_selection_revision_immutable(),
  guidance_campaign_selection_head_matches_revision() FROM PUBLIC, anon, authenticated, service_role;--> statement-breakpoint
ALTER TABLE "effective_campaign_context_components" DROP CONSTRAINT "effective_campaign_context_components_type";--> statement-breakpoint
ALTER TABLE "effective_campaign_context_invalidations" DROP CONSTRAINT "effective_campaign_context_invalidations_type";--> statement-breakpoint
ALTER TABLE "effective_campaign_context_components" ADD CONSTRAINT "effective_campaign_context_components_type" CHECK ("effective_campaign_context_components"."component_type" in (
  'source_snapshot', 'category_resolution', 'category_profile', 'guidance_pack', 'meta_catalog',
  'category_resolver', 'guidance_registry', 'metric_catalog', 'formula_catalog',
  'timeframe_resolver', 'instruction_policy', 'promotion_registry', 'policy_authority',
  'business_outcome_evidence', 'cadence_profile', 'guidance_selection'
));--> statement-breakpoint
ALTER TABLE "effective_campaign_context_invalidations" ADD CONSTRAINT "effective_campaign_context_invalidations_type" CHECK ("effective_campaign_context_invalidations"."component_type" in (
  'source_snapshot', 'category_resolution', 'category_profile', 'guidance_pack', 'meta_catalog',
  'category_resolver', 'guidance_registry', 'metric_catalog', 'formula_catalog',
  'timeframe_resolver', 'instruction_policy', 'promotion_registry', 'policy_authority',
  'business_outcome_evidence', 'cadence_profile', 'guidance_selection'
));--> statement-breakpoint
ALTER TABLE "effective_campaign_context_components" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "effective_campaign_context_components" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "effective_campaign_context_invalidations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "effective_campaign_context_invalidations" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "effective_campaign_context_components", "effective_campaign_context_invalidations"
  FROM PUBLIC, anon, authenticated, service_role;
