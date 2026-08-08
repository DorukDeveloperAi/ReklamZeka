CREATE TABLE "audience_preset_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"preset_ref" text NOT NULL,
	"revision" integer NOT NULL,
	"schema_version" text NOT NULL,
	"state" text NOT NULL,
	"audience_kind" text NOT NULL,
	"source_ref" text NOT NULL,
	"targeting_hash" text NOT NULL,
	"provenance_hash" text NOT NULL,
	"preset_hash" text NOT NULL,
	"payload" jsonb NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audience_preset_revisions_shape" CHECK (
    "audience_preset_revisions"."revision" >= 1 and "audience_preset_revisions"."schema_version" = 'audience-preset/1.0.0' and "audience_preset_revisions"."state" = 'published'
    and "audience_preset_revisions"."audience_kind" in ('meta_saved_audience', 'meta_custom_audience', 'frozen_targeting_spec')
    and "audience_preset_revisions"."preset_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and "audience_preset_revisions"."source_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and "audience_preset_revisions"."targeting_hash" ~ '^[a-f0-9]{64}$' and "audience_preset_revisions"."provenance_hash" ~ '^[a-f0-9]{64}$'
    and "audience_preset_revisions"."preset_hash" ~ '^[a-f0-9]{64}$'
    and jsonb_typeof("audience_preset_revisions"."payload") = 'object'
    and "audience_preset_revisions"."payload" #>> '{version}' = "audience_preset_revisions"."schema_version"
    and "audience_preset_revisions"."payload" #>> '{presetRef}' = "audience_preset_revisions"."preset_ref"
    and ("audience_preset_revisions"."payload" #>> '{revision}')::integer = "audience_preset_revisions"."revision"
    and "audience_preset_revisions"."payload" #>> '{state}' = 'published'
    and "audience_preset_revisions"."payload" #>> '{source,kind}' = "audience_preset_revisions"."audience_kind"
    and "audience_preset_revisions"."payload" #>> '{source,sourceRef}' = "audience_preset_revisions"."source_ref"
    and "audience_preset_revisions"."payload" #>> '{source,targetingHash}' = "audience_preset_revisions"."targeting_hash"
    and "audience_preset_revisions"."payload" #>> '{source,provenanceHash}' = "audience_preset_revisions"."provenance_hash"
    and "audience_preset_revisions"."payload" #>> '{presetHash}' = "audience_preset_revisions"."preset_hash"
  ),
	CONSTRAINT "audience_preset_revisions_no_authority" CHECK (
    not jsonb_path_exists("audience_preset_revisions"."payload", '$.** ? (@.type() == "object").keyvalue() ? (@.key like_regex "^(actionauthority|executionauthority|writeauthority|writeenabled|canexecute|canwrite|approvalgranted|authorization|grant|creative|copy|headline)$" flag "i")')
    and "audience_preset_revisions"."payload"::text !~* '"[^"[:space:]]*(token|secret|prompt|raw[_-]?(payload|request|response|json))"[[:space:]]*:'
  )
);
--> statement-breakpoint
CREATE TABLE "promotion_template_binding_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"binding_id" uuid NOT NULL,
	"category_definition_id" uuid NOT NULL,
	"category_ref" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promotion_template_binding_categories_identity" CHECK (
    "promotion_template_binding_categories"."category_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
  )
);
--> statement-breakpoint
CREATE TABLE "promotion_template_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"template_revision_id" uuid NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"actor_asset_id" uuid NOT NULL,
	"campaign_id" uuid,
	"binding_ref" text NOT NULL,
	"binding_hash" text NOT NULL,
	"actor_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promotion_template_bindings_shape" CHECK (
    "promotion_template_bindings"."binding_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and "promotion_template_bindings"."binding_hash" ~ '^[a-f0-9]{64}$' and "promotion_template_bindings"."actor_type" in ('page', 'instagram')
    and ("promotion_template_bindings"."expires_at" is null or "promotion_template_bindings"."expires_at" > "promotion_template_bindings"."effective_from")
    and jsonb_typeof("promotion_template_bindings"."payload") = 'object'
    and "promotion_template_bindings"."payload" #>> '{version}' = 'promotion-template-binding/1.0.0'
    and "promotion_template_bindings"."payload" #>> '{bindingRef}' = "promotion_template_bindings"."binding_ref"
    and "promotion_template_bindings"."payload" #>> '{bindingHash}' = "promotion_template_bindings"."binding_hash"
    and "promotion_template_bindings"."payload" #>> '{actor,type}' = "promotion_template_bindings"."actor_type"
  ),
	CONSTRAINT "promotion_template_bindings_no_authority" CHECK (
    not jsonb_path_exists("promotion_template_bindings"."payload", '$.** ? (@.type() == "object").keyvalue() ? (@.key like_regex "^(actionauthority|executionauthority|writeauthority|writeenabled|canexecute|canwrite|approvalgranted|authorization|grant|creative|copy|headline)$" flag "i")')
    and "promotion_template_bindings"."payload"::text !~* '"[^"[:space:]]*(token|secret|prompt|raw[_-]?(payload|request|response|json))"[[:space:]]*:'
  )
);
--> statement-breakpoint
CREATE TABLE "promotion_template_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"audience_preset_revision_id" uuid NOT NULL,
	"template_ref" text NOT NULL,
	"revision" integer NOT NULL,
	"schema_version" text NOT NULL,
	"state" text NOT NULL,
	"template_hash" text NOT NULL,
	"audience_preset_hash" text NOT NULL,
	"actor_type_scope" jsonb NOT NULL,
	"objective_ref" text NOT NULL,
	"optimization_goal_ref" text NOT NULL,
	"destination_ref" text NOT NULL,
	"ad_set_policy" text NOT NULL,
	"budget_owner_level" text NOT NULL,
	"budget_kind" text NOT NULL,
	"currency" text NOT NULL,
	"budget_default" numeric(30, 12) NOT NULL,
	"budget_minimum" numeric(30, 12),
	"budget_maximum" numeric(30, 12),
	"budget_plan_version_ref" text NOT NULL,
	"timeframe_ref" text NOT NULL,
	"schedule_mode" text NOT NULL,
	"duration_days" integer,
	"payload" jsonb NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "promotion_template_revisions_shape" CHECK (
    "promotion_template_revisions"."revision" >= 1 and "promotion_template_revisions"."schema_version" = 'promotion-template/1.0.0' and "promotion_template_revisions"."state" = 'published'
    and "promotion_template_revisions"."template_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and "promotion_template_revisions"."template_hash" ~ '^[a-f0-9]{64}$' and "promotion_template_revisions"."audience_preset_hash" ~ '^[a-f0-9]{64}$'
    and jsonb_typeof("promotion_template_revisions"."actor_type_scope") = 'array' and jsonb_array_length("promotion_template_revisions"."actor_type_scope") >= 1
    and not jsonb_path_exists("promotion_template_revisions"."actor_type_scope", '$[*] ? (@ != "page" && @ != "instagram")')
    and "promotion_template_revisions"."ad_set_policy" in ('existing_only', 'existing_or_new_draft')
    and "promotion_template_revisions"."budget_owner_level" in ('campaign', 'adset') and "promotion_template_revisions"."budget_kind" in ('daily', 'lifetime')
    and "promotion_template_revisions"."currency" ~ '^[A-Z]{3}$' and "promotion_template_revisions"."budget_default" >= 0
    and ("promotion_template_revisions"."budget_minimum" is null or "promotion_template_revisions"."budget_minimum" <= "promotion_template_revisions"."budget_default")
    and ("promotion_template_revisions"."budget_maximum" is null or "promotion_template_revisions"."budget_maximum" >= "promotion_template_revisions"."budget_default")
    and (("promotion_template_revisions"."schedule_mode" = 'continuous' and "promotion_template_revisions"."duration_days" is null)
      or ("promotion_template_revisions"."schedule_mode" = 'fixed_duration' and "promotion_template_revisions"."duration_days" between 1 and 365))
    and jsonb_typeof("promotion_template_revisions"."payload") = 'object'
    and "promotion_template_revisions"."payload" #>> '{version}' = "promotion_template_revisions"."schema_version"
    and "promotion_template_revisions"."payload" #>> '{templateRef}' = "promotion_template_revisions"."template_ref"
    and ("promotion_template_revisions"."payload" #>> '{revision}')::integer = "promotion_template_revisions"."revision"
    and "promotion_template_revisions"."payload" #>> '{templateHash}' = "promotion_template_revisions"."template_hash"
    and "promotion_template_revisions"."payload" #>> '{audiencePreset,presetHash}' = "promotion_template_revisions"."audience_preset_hash"
    and "promotion_template_revisions"."payload" #>> '{budget,ownerLevel}' = "promotion_template_revisions"."budget_owner_level"
    and "promotion_template_revisions"."payload" #>> '{budget,currency}' = "promotion_template_revisions"."currency"
    and "promotion_template_revisions"."payload" #>> '{budget,kind}' = "promotion_template_revisions"."budget_kind"
    and "promotion_template_revisions"."payload" #>> '{timeframe,timeframeRef}' = "promotion_template_revisions"."timeframe_ref"
  ),
	CONSTRAINT "promotion_template_revisions_no_authority" CHECK (
    not jsonb_path_exists("promotion_template_revisions"."payload", '$.** ? (@.type() == "object").keyvalue() ? (@.key like_regex "^(actionauthority|executionauthority|writeauthority|writeenabled|canexecute|canwrite|approvalgranted|authorization|grant|creative|copy|headline)$" flag "i")')
    and "promotion_template_revisions"."payload"::text !~* '"[^"[:space:]]*(token|secret|prompt|raw[_-]?(payload|request|response|json))"[[:space:]]*:'
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "audience_preset_revisions_workspace_row_unique" ON "audience_preset_revisions" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "promotion_template_bindings_workspace_row_unique" ON "promotion_template_bindings" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "promotion_template_revisions_workspace_row_unique" ON "promotion_template_revisions" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "category_definitions_workspace_id_unique" ON "category_definitions" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "meta_assets_id_workspace_unique" ON "meta_assets" USING btree ("id","workspace_id");--> statement-breakpoint
ALTER TABLE "audience_preset_revisions" ADD CONSTRAINT "audience_preset_revisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_template_binding_categories" ADD CONSTRAINT "promotion_template_binding_categories_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_template_binding_categories" ADD CONSTRAINT "promotion_template_binding_categories_binding_scope_fk" FOREIGN KEY ("workspace_id","binding_id") REFERENCES "public"."promotion_template_bindings"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_template_binding_categories" ADD CONSTRAINT "promotion_template_binding_categories_category_scope_fk" FOREIGN KEY ("workspace_id","category_definition_id") REFERENCES "public"."category_definitions"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_template_bindings" ADD CONSTRAINT "promotion_template_bindings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_template_bindings" ADD CONSTRAINT "promotion_template_bindings_template_scope_fk" FOREIGN KEY ("workspace_id","template_revision_id") REFERENCES "public"."promotion_template_revisions"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_template_bindings" ADD CONSTRAINT "promotion_template_bindings_account_scope_fk" FOREIGN KEY ("workspace_id","ad_account_id") REFERENCES "public"."ad_accounts"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_template_bindings" ADD CONSTRAINT "promotion_template_bindings_campaign_scope_fk" FOREIGN KEY ("workspace_id","campaign_id") REFERENCES "public"."ad_campaigns"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_template_bindings" ADD CONSTRAINT "promotion_template_bindings_actor_scope_fk" FOREIGN KEY ("actor_asset_id","workspace_id") REFERENCES "public"."meta_assets"("id","workspace_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_template_revisions" ADD CONSTRAINT "promotion_template_revisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "promotion_template_revisions" ADD CONSTRAINT "promotion_template_revisions_audience_scope_fk" FOREIGN KEY ("workspace_id","audience_preset_revision_id") REFERENCES "public"."audience_preset_revisions"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "audience_preset_revisions_identity_unique" ON "audience_preset_revisions" USING btree ("workspace_id","preset_ref","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "audience_preset_revisions_hash_unique" ON "audience_preset_revisions" USING btree ("workspace_id","preset_hash");--> statement-breakpoint
CREATE INDEX "audience_preset_revisions_workspace_published_idx" ON "audience_preset_revisions" USING btree ("workspace_id","published_at");--> statement-breakpoint
CREATE UNIQUE INDEX "promotion_template_binding_categories_edge_unique" ON "promotion_template_binding_categories" USING btree ("workspace_id","binding_id","category_definition_id");--> statement-breakpoint
CREATE INDEX "promotion_template_binding_categories_binding_idx" ON "promotion_template_binding_categories" USING btree ("binding_id");--> statement-breakpoint
CREATE INDEX "promotion_template_binding_categories_category_idx" ON "promotion_template_binding_categories" USING btree ("category_definition_id");--> statement-breakpoint
CREATE UNIQUE INDEX "promotion_template_bindings_identity_unique" ON "promotion_template_bindings" USING btree ("workspace_id","binding_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "promotion_template_bindings_hash_unique" ON "promotion_template_bindings" USING btree ("workspace_id","binding_hash");--> statement-breakpoint
CREATE INDEX "promotion_template_bindings_template_idx" ON "promotion_template_bindings" USING btree ("template_revision_id");--> statement-breakpoint
CREATE INDEX "promotion_template_bindings_account_idx" ON "promotion_template_bindings" USING btree ("ad_account_id");--> statement-breakpoint
CREATE INDEX "promotion_template_bindings_actor_idx" ON "promotion_template_bindings" USING btree ("actor_asset_id");--> statement-breakpoint
CREATE INDEX "promotion_template_bindings_campaign_idx" ON "promotion_template_bindings" USING btree ("campaign_id");--> statement-breakpoint
CREATE UNIQUE INDEX "promotion_template_revisions_identity_unique" ON "promotion_template_revisions" USING btree ("workspace_id","template_ref","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "promotion_template_revisions_hash_unique" ON "promotion_template_revisions" USING btree ("workspace_id","template_hash");--> statement-breakpoint
CREATE INDEX "promotion_template_revisions_audience_idx" ON "promotion_template_revisions" USING btree ("audience_preset_revision_id");--> statement-breakpoint
ALTER TABLE "audience_preset_revisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "promotion_template_revisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "promotion_template_bindings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "promotion_template_binding_categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "audience_preset_revisions" FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "promotion_template_revisions" FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "promotion_template_bindings" FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "promotion_template_binding_categories" FROM PUBLIC, anon, authenticated;--> statement-breakpoint
CREATE FUNCTION promotion_registry_append_only() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  RAISE EXCEPTION 'promotion_registry_append_only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER audience_preset_revisions_append_only_trigger BEFORE UPDATE ON audience_preset_revisions
FOR EACH ROW EXECUTE FUNCTION promotion_registry_append_only();--> statement-breakpoint
CREATE TRIGGER promotion_template_revisions_append_only_trigger BEFORE UPDATE ON promotion_template_revisions
FOR EACH ROW EXECUTE FUNCTION promotion_registry_append_only();--> statement-breakpoint
CREATE TRIGGER promotion_template_bindings_append_only_trigger BEFORE UPDATE ON promotion_template_bindings
FOR EACH ROW EXECUTE FUNCTION promotion_registry_append_only();--> statement-breakpoint
CREATE TRIGGER promotion_template_binding_categories_append_only_trigger BEFORE UPDATE ON promotion_template_binding_categories
FOR EACH ROW EXECUTE FUNCTION promotion_registry_append_only();--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION promotion_registry_append_only() FROM PUBLIC, anon, authenticated;
