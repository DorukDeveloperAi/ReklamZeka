CREATE TABLE "audience_preset_authoring_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"workspace_ref" text NOT NULL,
	"preset_ref" text NOT NULL,
	"lifecycle_version" integer NOT NULL,
	"previous_record_hash" text,
	"status" text NOT NULL,
	"preset_revision" integer NOT NULL,
	"preset_hash" text NOT NULL,
	"preset_payload" jsonb NOT NULL,
	"published_preset_hash" text,
	"published_preset_payload" jsonb,
	"actor_ref" text NOT NULL,
	"actor_role" text NOT NULL,
	"reason_code" text NOT NULL,
	"record_hash" text NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audience_preset_authoring_identity" CHECK (
    "audience_preset_authoring_revisions"."workspace_ref" ~ '^workspace_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and "audience_preset_authoring_revisions"."preset_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and "audience_preset_authoring_revisions"."lifecycle_version" between 1 and 1000000 and "audience_preset_authoring_revisions"."preset_revision" between 1 and 1000000
    and (("audience_preset_authoring_revisions"."lifecycle_version" = 1 and "audience_preset_authoring_revisions"."previous_record_hash" is null)
      or ("audience_preset_authoring_revisions"."lifecycle_version" > 1 and "audience_preset_authoring_revisions"."previous_record_hash" ~ '^[a-f0-9]{64}$'))
    and "audience_preset_authoring_revisions"."preset_hash" ~ '^[a-f0-9]{64}$' and "audience_preset_authoring_revisions"."record_hash" ~ '^[a-f0-9]{64}$'
    and "audience_preset_authoring_revisions"."status" in ('draft', 'published', 'archived')
    and "audience_preset_authoring_revisions"."actor_role" in ('owner', 'admin', 'analyst')
    and ("audience_preset_authoring_revisions"."status" = 'draft' or "audience_preset_authoring_revisions"."actor_role" in ('owner', 'admin'))
    and "audience_preset_authoring_revisions"."actor_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and "audience_preset_authoring_revisions"."reason_code" ~ '^[a-z][a-z0-9_]{1,63}$'
  ),
	CONSTRAINT "audience_preset_authoring_payload_exact" CHECK ((
    jsonb_typeof("audience_preset_authoring_revisions"."preset_payload") = 'object'
    and "audience_preset_authoring_revisions"."preset_payload" #>> '{version}' = 'audience-preset-draft-material/1.0.0'
    and "audience_preset_authoring_revisions"."preset_payload" #>> '{workspaceRef}' = "audience_preset_authoring_revisions"."workspace_ref"
    and "audience_preset_authoring_revisions"."preset_payload" #>> '{presetRef}' = "audience_preset_authoring_revisions"."preset_ref"
    and ("audience_preset_authoring_revisions"."preset_payload" #>> '{revision}')::integer = "audience_preset_authoring_revisions"."preset_revision"
    and "audience_preset_authoring_revisions"."preset_payload" #>> '{materialHash}' = "audience_preset_authoring_revisions"."preset_hash"
    and "audience_preset_authoring_revisions"."preset_payload" #> '{authority,canAuthorizeAction}' = 'false'::jsonb
    and "audience_preset_authoring_revisions"."preset_payload" #> '{authority,canExecuteWrite}' = 'false'::jsonb
    and "audience_preset_authoring_revisions"."preset_payload" #> '{authority,canWriteMeta}' = 'false'::jsonb
    and "audience_preset_authoring_revisions"."preset_payload" #> '{authority,canGrantApproval}' = 'false'::jsonb
    and not ("audience_preset_authoring_revisions"."preset_payload" ? 'state') and not ("audience_preset_authoring_revisions"."preset_payload" ? 'publishedAt')
    and (("audience_preset_authoring_revisions"."status" = 'draft' and "audience_preset_authoring_revisions"."published_preset_hash" is null and "audience_preset_authoring_revisions"."published_preset_payload" is null)
      or ("audience_preset_authoring_revisions"."status" = 'published' and "audience_preset_authoring_revisions"."published_preset_hash" ~ '^[a-f0-9]{64}$'
          and "audience_preset_authoring_revisions"."published_preset_payload" #>> '{presetHash}' = "audience_preset_authoring_revisions"."published_preset_hash"
          and "audience_preset_authoring_revisions"."published_preset_payload" #>> '{state}' = 'published')
      or ("audience_preset_authoring_revisions"."status" = 'archived' and (
        ("audience_preset_authoring_revisions"."published_preset_hash" is null and "audience_preset_authoring_revisions"."published_preset_payload" is null)
        or ("audience_preset_authoring_revisions"."published_preset_hash" ~ '^[a-f0-9]{64}$'
          and "audience_preset_authoring_revisions"."published_preset_payload" #>> '{presetHash}' = "audience_preset_authoring_revisions"."published_preset_hash"
          and "audience_preset_authoring_revisions"."published_preset_payload" #>> '{state}' = 'published'))))
  ) is true),
	CONSTRAINT "audience_preset_authoring_no_authority" CHECK (
    "audience_preset_authoring_revisions"."preset_payload"::text !~* '"[^"[:space:]]*(token|secret|prompt|raw[_-]?(payload|request|response|json)|authorization|approvalgranted)"[[:space:]]*:'
    and "audience_preset_authoring_revisions"."preset_payload"::text !~* '"(canAuthorizeAction|canExecuteWrite|canWriteMeta|canGrantApproval)"[[:space:]]*:[[:space:]]*true'
  )
);
--> statement-breakpoint
CREATE TABLE "promotion_template_authoring_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"workspace_ref" text NOT NULL,
	"template_ref" text NOT NULL,
	"lifecycle_version" integer NOT NULL,
	"previous_record_hash" text,
	"status" text NOT NULL,
	"preset_ref" text NOT NULL,
	"preset_revision" integer NOT NULL,
	"preset_hash" text NOT NULL,
	"preset_payload" jsonb NOT NULL,
	"template_revision" integer NOT NULL,
	"template_hash" text NOT NULL,
	"template_payload" jsonb NOT NULL,
	"binding_ref" text NOT NULL,
	"binding_hash" text NOT NULL,
	"binding_payload" jsonb NOT NULL,
	"published_template_hash" text,
	"published_template_payload" jsonb,
	"published_binding_hash" text,
	"published_binding_payload" jsonb,
	"actor_ref" text NOT NULL,
	"actor_role" text NOT NULL,
	"reason_code" text NOT NULL,
	"record_hash" text NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promotion_template_authoring_identity" CHECK (
    "promotion_template_authoring_revisions"."workspace_ref" ~ '^workspace_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and "promotion_template_authoring_revisions"."template_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and "promotion_template_authoring_revisions"."preset_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and "promotion_template_authoring_revisions"."binding_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and "promotion_template_authoring_revisions"."lifecycle_version" between 1 and 1000000
    and "promotion_template_authoring_revisions"."preset_revision" between 1 and 1000000 and "promotion_template_authoring_revisions"."template_revision" between 1 and 1000000
    and (("promotion_template_authoring_revisions"."lifecycle_version" = 1 and "promotion_template_authoring_revisions"."previous_record_hash" is null)
      or ("promotion_template_authoring_revisions"."lifecycle_version" > 1 and "promotion_template_authoring_revisions"."previous_record_hash" ~ '^[a-f0-9]{64}$'))
    and "promotion_template_authoring_revisions"."preset_hash" ~ '^[a-f0-9]{64}$' and "promotion_template_authoring_revisions"."template_hash" ~ '^[a-f0-9]{64}$'
    and "promotion_template_authoring_revisions"."binding_hash" ~ '^[a-f0-9]{64}$' and "promotion_template_authoring_revisions"."record_hash" ~ '^[a-f0-9]{64}$'
    and "promotion_template_authoring_revisions"."status" in ('draft', 'published', 'archived')
    and "promotion_template_authoring_revisions"."actor_role" in ('owner', 'admin', 'analyst')
    and ("promotion_template_authoring_revisions"."status" = 'draft' or "promotion_template_authoring_revisions"."actor_role" in ('owner', 'admin'))
    and "promotion_template_authoring_revisions"."actor_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and "promotion_template_authoring_revisions"."reason_code" ~ '^[a-z][a-z0-9_]{1,63}$'
  ),
	CONSTRAINT "promotion_template_authoring_payload_exact" CHECK ((
    jsonb_typeof("promotion_template_authoring_revisions"."preset_payload") = 'object'
    and jsonb_typeof("promotion_template_authoring_revisions"."template_payload") = 'object' and jsonb_typeof("promotion_template_authoring_revisions"."binding_payload") = 'object'
    and "promotion_template_authoring_revisions"."preset_payload" #>> '{workspaceRef}' = "promotion_template_authoring_revisions"."workspace_ref"
    and "promotion_template_authoring_revisions"."preset_payload" #>> '{presetRef}' = "promotion_template_authoring_revisions"."preset_ref"
    and ("promotion_template_authoring_revisions"."preset_payload" #>> '{revision}')::integer = "promotion_template_authoring_revisions"."preset_revision"
    and "promotion_template_authoring_revisions"."preset_payload" #>> '{presetHash}' = "promotion_template_authoring_revisions"."preset_hash"
    and "promotion_template_authoring_revisions"."template_payload" #>> '{workspaceRef}' = "promotion_template_authoring_revisions"."workspace_ref"
    and "promotion_template_authoring_revisions"."template_payload" #>> '{templateRef}' = "promotion_template_authoring_revisions"."template_ref"
    and ("promotion_template_authoring_revisions"."template_payload" #>> '{revision}')::integer = "promotion_template_authoring_revisions"."template_revision"
    and "promotion_template_authoring_revisions"."template_payload" #>> '{materialHash}' = "promotion_template_authoring_revisions"."template_hash"
    and "promotion_template_authoring_revisions"."template_payload" #>> '{audiencePreset,presetRef}' = "promotion_template_authoring_revisions"."preset_ref"
    and ("promotion_template_authoring_revisions"."template_payload" #>> '{audiencePreset,revision}')::integer = "promotion_template_authoring_revisions"."preset_revision"
    and "promotion_template_authoring_revisions"."template_payload" #>> '{audiencePreset,presetHash}' = "promotion_template_authoring_revisions"."preset_hash"
    and "promotion_template_authoring_revisions"."binding_payload" #>> '{bindingRef}' = "promotion_template_authoring_revisions"."binding_ref"
    and "promotion_template_authoring_revisions"."binding_payload" #>> '{materialHash}' = "promotion_template_authoring_revisions"."binding_hash"
    and "promotion_template_authoring_revisions"."binding_payload" #>> '{template,templateRef}' = "promotion_template_authoring_revisions"."template_ref"
    and ("promotion_template_authoring_revisions"."binding_payload" #>> '{template,revision}')::integer = "promotion_template_authoring_revisions"."template_revision"
    and "promotion_template_authoring_revisions"."binding_payload" #>> '{template,materialHash}' = "promotion_template_authoring_revisions"."template_hash"
    and not ("promotion_template_authoring_revisions"."template_payload" ? 'state') and not ("promotion_template_authoring_revisions"."template_payload" ? 'publishedAt')
    and not ("promotion_template_authoring_revisions"."binding_payload" ? 'effectiveFrom')
    and (("promotion_template_authoring_revisions"."status" = 'draft' and "promotion_template_authoring_revisions"."published_template_hash" is null
      and "promotion_template_authoring_revisions"."published_template_payload" is null and "promotion_template_authoring_revisions"."published_binding_hash" is null
      and "promotion_template_authoring_revisions"."published_binding_payload" is null)
      or ("promotion_template_authoring_revisions"."status" = 'published' and "promotion_template_authoring_revisions"."published_template_hash" ~ '^[a-f0-9]{64}$'
          and "promotion_template_authoring_revisions"."published_binding_hash" ~ '^[a-f0-9]{64}$'
          and "promotion_template_authoring_revisions"."published_template_payload" #>> '{templateHash}' = "promotion_template_authoring_revisions"."published_template_hash"
          and "promotion_template_authoring_revisions"."published_binding_payload" #>> '{bindingHash}' = "promotion_template_authoring_revisions"."published_binding_hash")
      or ("promotion_template_authoring_revisions"."status" = 'archived' and (
        ("promotion_template_authoring_revisions"."published_template_hash" is null and "promotion_template_authoring_revisions"."published_template_payload" is null
          and "promotion_template_authoring_revisions"."published_binding_hash" is null and "promotion_template_authoring_revisions"."published_binding_payload" is null)
        or ("promotion_template_authoring_revisions"."published_template_hash" ~ '^[a-f0-9]{64}$'
          and "promotion_template_authoring_revisions"."published_binding_hash" ~ '^[a-f0-9]{64}$'
          and "promotion_template_authoring_revisions"."published_template_payload" #>> '{templateHash}' = "promotion_template_authoring_revisions"."published_template_hash"
          and "promotion_template_authoring_revisions"."published_binding_payload" #>> '{bindingHash}' = "promotion_template_authoring_revisions"."published_binding_hash"))))
  ) is true),
	CONSTRAINT "promotion_template_authoring_no_authority" CHECK (
    ("promotion_template_authoring_revisions"."preset_payload"::text || "promotion_template_authoring_revisions"."template_payload"::text || "promotion_template_authoring_revisions"."binding_payload"::text
      || coalesce("promotion_template_authoring_revisions"."published_template_payload"::text, '') || coalesce("promotion_template_authoring_revisions"."published_binding_payload"::text, ''))
      !~* '"[^"[:space:]]*(token|secret|prompt|raw[_-]?(payload|request|response|json)|authorization|approvalgranted)"[[:space:]]*:'
    and ("promotion_template_authoring_revisions"."preset_payload"::text || "promotion_template_authoring_revisions"."template_payload"::text || "promotion_template_authoring_revisions"."binding_payload"::text
      || coalesce("promotion_template_authoring_revisions"."published_template_payload"::text, '') || coalesce("promotion_template_authoring_revisions"."published_binding_payload"::text, ''))
      !~* '"(canAuthorizeAction|canExecuteWrite|canWriteMeta|canGrantApproval)"[[:space:]]*:[[:space:]]*true'
  )
);
--> statement-breakpoint
ALTER TABLE "effective_campaign_context_components" DROP CONSTRAINT "effective_campaign_context_components_type";--> statement-breakpoint
ALTER TABLE "effective_campaign_context_invalidations" DROP CONSTRAINT "effective_campaign_context_invalidations_type";--> statement-breakpoint
ALTER TABLE "audience_preset_authoring_revisions" ADD CONSTRAINT "audience_preset_authoring_revisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_template_authoring_revisions" ADD CONSTRAINT "promotion_template_authoring_revisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "audience_preset_authoring_workspace_row_unique" ON "audience_preset_authoring_revisions" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "audience_preset_authoring_version_unique" ON "audience_preset_authoring_revisions" USING btree ("workspace_id","preset_ref","lifecycle_version");--> statement-breakpoint
CREATE UNIQUE INDEX "audience_preset_authoring_hash_unique" ON "audience_preset_authoring_revisions" USING btree ("workspace_id","record_hash");--> statement-breakpoint
CREATE INDEX "audience_preset_authoring_current_idx" ON "audience_preset_authoring_revisions" USING btree ("workspace_id","preset_ref","lifecycle_version");--> statement-breakpoint
CREATE UNIQUE INDEX "promotion_template_authoring_workspace_row_unique" ON "promotion_template_authoring_revisions" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "promotion_template_authoring_version_unique" ON "promotion_template_authoring_revisions" USING btree ("workspace_id","template_ref","lifecycle_version");--> statement-breakpoint
CREATE UNIQUE INDEX "promotion_template_authoring_hash_unique" ON "promotion_template_authoring_revisions" USING btree ("workspace_id","record_hash");--> statement-breakpoint
CREATE INDEX "promotion_template_authoring_current_idx" ON "promotion_template_authoring_revisions" USING btree ("workspace_id","template_ref","lifecycle_version");--> statement-breakpoint
CREATE INDEX "promotion_template_authoring_preset_idx" ON "promotion_template_authoring_revisions" USING btree ("workspace_id","preset_ref","preset_revision","preset_hash");--> statement-breakpoint
ALTER TABLE "effective_campaign_context_components" ADD CONSTRAINT "effective_campaign_context_components_type" CHECK ("effective_campaign_context_components"."component_type" in (
    'source_snapshot', 'category_resolution', 'category_profile', 'guidance_pack', 'meta_catalog',
    'category_resolver', 'guidance_registry', 'metric_catalog', 'formula_catalog',
    'timeframe_resolver', 'instruction_policy', 'promotion_registry'
  ));--> statement-breakpoint
ALTER TABLE "effective_campaign_context_invalidations" ADD CONSTRAINT "effective_campaign_context_invalidations_type" CHECK ("effective_campaign_context_invalidations"."component_type" in (
    'source_snapshot', 'category_resolution', 'category_profile', 'guidance_pack', 'meta_catalog',
    'category_resolver', 'guidance_registry', 'metric_catalog', 'formula_catalog',
    'timeframe_resolver', 'instruction_policy', 'promotion_registry'
  ));--> statement-breakpoint
ALTER TABLE "audience_preset_authoring_revisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "audience_preset_authoring_revisions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "promotion_template_authoring_revisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "promotion_template_authoring_revisions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "audience_preset_authoring_revisions"
  FROM PUBLIC, anon, authenticated, service_role;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "promotion_template_authoring_revisions"
  FROM PUBLIC, anon, authenticated, service_role;--> statement-breakpoint
CREATE FUNCTION promotion_authoring_revision_guard() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  prior_version integer;
  prior_hash text;
  archived_preset boolean;
BEGIN
  IF TG_TABLE_NAME = 'audience_preset_authoring_revisions' THEN
    SELECT lifecycle_version, record_hash INTO prior_version, prior_hash
    FROM public.audience_preset_authoring_revisions
    WHERE workspace_id = NEW.workspace_id AND preset_ref = NEW.preset_ref
    ORDER BY lifecycle_version DESC LIMIT 1 FOR UPDATE;
  ELSIF TG_TABLE_NAME = 'promotion_template_authoring_revisions' THEN
    SELECT lifecycle_version, record_hash INTO prior_version, prior_hash
    FROM public.promotion_template_authoring_revisions
    WHERE workspace_id = NEW.workspace_id AND template_ref = NEW.template_ref
    ORDER BY lifecycle_version DESC LIMIT 1 FOR UPDATE;
    IF NOT EXISTS (
      SELECT 1 FROM public.audience_preset_revisions preset
      WHERE preset.workspace_id = NEW.workspace_id AND preset.preset_ref = NEW.preset_ref
        AND preset.revision = NEW.preset_revision AND preset.preset_hash = NEW.preset_hash
    ) THEN
      RAISE EXCEPTION 'promotion_authoring_preset_not_published';
    END IF;
    SELECT latest.status = 'archived' INTO archived_preset
    FROM public.audience_preset_authoring_revisions latest
    WHERE latest.workspace_id = NEW.workspace_id AND latest.preset_ref = NEW.preset_ref
    ORDER BY latest.lifecycle_version DESC LIMIT 1;
    IF coalesce(archived_preset, false) THEN
      RAISE EXCEPTION 'promotion_authoring_preset_archived';
    END IF;
  ELSE
    RAISE EXCEPTION 'promotion_authoring_unknown_table';
  END IF;
  IF prior_version IS NULL THEN
    IF NEW.lifecycle_version <> 1 OR NEW.previous_record_hash IS NOT NULL THEN
      RAISE EXCEPTION 'promotion_authoring_invalid_genesis';
    END IF;
  ELSIF NEW.lifecycle_version <> prior_version + 1 OR NEW.previous_record_hash <> prior_hash THEN
    RAISE EXCEPTION 'promotion_authoring_invalid_lineage';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER audience_preset_authoring_lineage_trigger
BEFORE INSERT ON audience_preset_authoring_revisions
FOR EACH ROW EXECUTE FUNCTION promotion_authoring_revision_guard();--> statement-breakpoint
CREATE TRIGGER promotion_template_authoring_lineage_trigger
BEFORE INSERT ON promotion_template_authoring_revisions
FOR EACH ROW EXECUTE FUNCTION promotion_authoring_revision_guard();--> statement-breakpoint
CREATE TRIGGER audience_preset_authoring_append_only_trigger
BEFORE UPDATE ON audience_preset_authoring_revisions
FOR EACH ROW EXECUTE FUNCTION promotion_registry_append_only();--> statement-breakpoint
CREATE TRIGGER promotion_template_authoring_append_only_trigger
BEFORE UPDATE ON promotion_template_authoring_revisions
FOR EACH ROW EXECUTE FUNCTION promotion_registry_append_only();--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION promotion_authoring_revision_guard()
  FROM PUBLIC, anon, authenticated, service_role;
