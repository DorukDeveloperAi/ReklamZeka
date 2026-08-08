CREATE TABLE "effective_campaign_context_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"context_id" uuid NOT NULL,
	"component_type" text NOT NULL,
	"component_ref" text NOT NULL,
	"component_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "effective_campaign_context_components_type" CHECK ("effective_campaign_context_components"."component_type" in (
    'source_snapshot', 'category_resolution', 'guidance_pack', 'meta_catalog',
    'category_resolver', 'guidance_registry', 'metric_catalog', 'formula_catalog',
    'timeframe_resolver'
  )),
	CONSTRAINT "effective_campaign_context_components_required" CHECK (
    btrim("effective_campaign_context_components"."component_ref") <> '' and btrim("effective_campaign_context_components"."component_version") <> ''
  )
);
--> statement-breakpoint
CREATE TABLE "effective_campaign_context_invalidations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"event_hash" text NOT NULL,
	"component_type" text NOT NULL,
	"component_ref" text NOT NULL,
	"component_version" text NOT NULL,
	"scope_kind" text NOT NULL,
	"entity_type" text,
	"entity_ref" text,
	"reason_code" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "effective_campaign_context_invalidations_hash_format" CHECK ("effective_campaign_context_invalidations"."event_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "effective_campaign_context_invalidations_type" CHECK ("effective_campaign_context_invalidations"."component_type" in (
    'source_snapshot', 'category_resolution', 'guidance_pack', 'meta_catalog',
    'category_resolver', 'guidance_registry', 'metric_catalog', 'formula_catalog',
    'timeframe_resolver'
  )),
	CONSTRAINT "effective_campaign_context_invalidations_required" CHECK (
    btrim("effective_campaign_context_invalidations"."component_ref") <> '' and btrim("effective_campaign_context_invalidations"."component_version") <> ''
  ),
	CONSTRAINT "effective_campaign_context_invalidations_entity_scope" CHECK (
    ("effective_campaign_context_invalidations"."scope_kind" = 'workspace_component' and "effective_campaign_context_invalidations"."entity_type" is null and "effective_campaign_context_invalidations"."entity_ref" is null)
    or ("effective_campaign_context_invalidations"."scope_kind" = 'exact_entity_component'
      and "effective_campaign_context_invalidations"."entity_type" in ('campaign', 'ad_set', 'ad', 'creative')
      and "effective_campaign_context_invalidations"."entity_ref" is not null and btrim("effective_campaign_context_invalidations"."entity_ref") <> '')
  ),
	CONSTRAINT "effective_campaign_context_invalidations_reason" CHECK (
    "effective_campaign_context_invalidations"."reason_code" in ('source_changed', 'source_removed', 'manual_rebuild')
  )
);
--> statement-breakpoint
CREATE TABLE "effective_campaign_contexts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"identity_hash" text NOT NULL,
	"context_hash" text NOT NULL,
	"schema_version" text NOT NULL,
	"meta_connection_id" uuid NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"connection_ref" text NOT NULL,
	"account_ref" text NOT NULL,
	"campaign_ref" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_ref" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"snapshot_refs" jsonb NOT NULL,
	"context_payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "effective_campaign_contexts_hashes_format" CHECK (
    "effective_campaign_contexts"."identity_hash" ~ '^[a-f0-9]{64}$' and "effective_campaign_contexts"."context_hash" ~ '^[a-f0-9]{64}$'
  ),
	CONSTRAINT "effective_campaign_contexts_schema_version" CHECK ("effective_campaign_contexts"."schema_version" = 'effective-campaign-context/1.0.0'),
	CONSTRAINT "effective_campaign_contexts_entity_type" CHECK ("effective_campaign_contexts"."entity_type" in ('campaign', 'ad_set', 'ad', 'creative')),
	CONSTRAINT "effective_campaign_contexts_required_refs" CHECK (
    btrim("effective_campaign_contexts"."connection_ref") <> '' and btrim("effective_campaign_contexts"."account_ref") <> ''
    and btrim("effective_campaign_contexts"."campaign_ref") <> '' and btrim("effective_campaign_contexts"."entity_ref") <> ''
  ),
	CONSTRAINT "effective_campaign_contexts_snapshots_nonempty" CHECK (
    jsonb_typeof("effective_campaign_contexts"."snapshot_refs") = 'array' and jsonb_array_length("effective_campaign_contexts"."snapshot_refs") >= 1
  ),
	CONSTRAINT "effective_campaign_contexts_payload_object" CHECK (jsonb_typeof("effective_campaign_contexts"."context_payload") = 'object'),
	CONSTRAINT "effective_campaign_contexts_payload_scope_exact" CHECK ((
    "effective_campaign_contexts"."context_payload" #>> '{workspaceId}' = "effective_campaign_contexts"."workspace_id"::text
    and "effective_campaign_contexts"."context_payload" #>> '{schemaVersion}' = "effective_campaign_contexts"."schema_version"
    and "effective_campaign_contexts"."context_payload" #>> '{contextHash}' = "effective_campaign_contexts"."context_hash"
    and ("effective_campaign_contexts"."context_payload" #>> '{capturedAt}')::timestamptz = "effective_campaign_contexts"."captured_at"
    and "effective_campaign_contexts"."context_payload" #>> '{identity,connectionRef}' = "effective_campaign_contexts"."connection_ref"
    and "effective_campaign_contexts"."context_payload" #>> '{identity,accountRef}' = "effective_campaign_contexts"."account_ref"
    and "effective_campaign_contexts"."context_payload" #>> '{identity,campaignRef}' = "effective_campaign_contexts"."campaign_ref"
    and "effective_campaign_contexts"."context_payload" #>> '{identity,entityType}' = "effective_campaign_contexts"."entity_type"
    and "effective_campaign_contexts"."context_payload" #>> '{identity,entityRef}' = "effective_campaign_contexts"."entity_ref"
    and "effective_campaign_contexts"."context_payload" #> '{data,snapshotRefs}' = "effective_campaign_contexts"."snapshot_refs"
  ) is true),
	CONSTRAINT "effective_campaign_contexts_no_forbidden_material" CHECK (
    "effective_campaign_contexts"."context_payload"::text !~* '"[^"[:space:]]*(token|secret)"[[:space:]]*:'
    and "effective_campaign_contexts"."context_payload"::text !~* '"authorization"[[:space:]]*:'
    and "effective_campaign_contexts"."context_payload"::text !~* '"[^"[:space:]]*raw[_-]?(payload|request|response|json)"[[:space:]]*:'
    and "effective_campaign_contexts"."context_payload"::text !~* '"([^"[:space:]]*agent[_-]?)?narration"[[:space:]]*:'
  ),
	CONSTRAINT "effective_campaign_contexts_no_authority" CHECK ((
    jsonb_typeof("effective_campaign_contexts"."context_payload" #> '{capabilities}') = 'object'
    and ("effective_campaign_contexts"."context_payload" #> '{capabilities}') ?& array[
      'containsRawL0', 'canAuthorizeAction', 'canExecuteWrite'
    ]
    and "effective_campaign_contexts"."context_payload" #> '{capabilities,containsRawL0}' = 'false'::jsonb
    and "effective_campaign_contexts"."context_payload" #> '{capabilities,canAuthorizeAction}' = 'false'::jsonb
    and "effective_campaign_contexts"."context_payload" #> '{capabilities,canExecuteWrite}' = 'false'::jsonb
    and "effective_campaign_contexts"."context_payload"::text !~* '"(canAuthorizeAction|canExecuteWrite|canEnforcePolicy|canAlterApproval)"[[:space:]]*:[[:space:]]*true'
  ) is true)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "effective_campaign_contexts_workspace_id_unique" ON "effective_campaign_contexts" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "ad_accounts_workspace_id_unique" ON "ad_accounts" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "ad_campaigns_workspace_id_unique" ON "ad_campaigns" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "meta_connections_workspace_id_unique" ON "meta_connections" USING btree ("workspace_id","id");--> statement-breakpoint
ALTER TABLE "effective_campaign_context_components" ADD CONSTRAINT "effective_campaign_context_components_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "effective_campaign_context_components" ADD CONSTRAINT "effective_campaign_context_components_context_scope_fk" FOREIGN KEY ("workspace_id","context_id") REFERENCES "public"."effective_campaign_contexts"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "effective_campaign_context_invalidations" ADD CONSTRAINT "effective_campaign_context_invalidations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "effective_campaign_contexts" ADD CONSTRAINT "effective_campaign_contexts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "effective_campaign_contexts" ADD CONSTRAINT "effective_campaign_contexts_connection_scope_fk" FOREIGN KEY ("workspace_id","meta_connection_id") REFERENCES "public"."meta_connections"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "effective_campaign_contexts" ADD CONSTRAINT "effective_campaign_contexts_account_scope_fk" FOREIGN KEY ("workspace_id","ad_account_id") REFERENCES "public"."ad_accounts"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "effective_campaign_contexts" ADD CONSTRAINT "effective_campaign_contexts_campaign_scope_fk" FOREIGN KEY ("workspace_id","campaign_id") REFERENCES "public"."ad_campaigns"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "effective_campaign_context_components_exact_unique" ON "effective_campaign_context_components" USING btree ("context_id","component_type","component_ref","component_version");--> statement-breakpoint
CREATE INDEX "effective_campaign_context_components_lookup_idx" ON "effective_campaign_context_components" USING btree ("workspace_id","component_type","component_ref","component_version");--> statement-breakpoint
CREATE INDEX "effective_campaign_context_components_context_idx" ON "effective_campaign_context_components" USING btree ("context_id");--> statement-breakpoint
CREATE UNIQUE INDEX "effective_campaign_context_invalidations_workspace_event_unique" ON "effective_campaign_context_invalidations" USING btree ("workspace_id","event_hash");--> statement-breakpoint
CREATE INDEX "effective_campaign_context_invalidations_component_idx" ON "effective_campaign_context_invalidations" USING btree ("workspace_id","component_type","component_ref","component_version");--> statement-breakpoint
CREATE INDEX "effective_campaign_context_invalidations_entity_idx" ON "effective_campaign_context_invalidations" USING btree ("workspace_id","entity_type","entity_ref","observed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "effective_campaign_contexts_workspace_identity_unique" ON "effective_campaign_contexts" USING btree ("workspace_id","identity_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "effective_campaign_contexts_workspace_hash_unique" ON "effective_campaign_contexts" USING btree ("workspace_id","context_hash");--> statement-breakpoint
CREATE INDEX "effective_campaign_contexts_workspace_entity_captured_idx" ON "effective_campaign_contexts" USING btree ("workspace_id","entity_type","entity_ref","captured_at");--> statement-breakpoint
CREATE INDEX "effective_campaign_contexts_workspace_campaign_idx" ON "effective_campaign_contexts" USING btree ("workspace_id","campaign_ref","captured_at");--> statement-breakpoint
CREATE INDEX "effective_campaign_contexts_connection_idx" ON "effective_campaign_contexts" USING btree ("meta_connection_id");--> statement-breakpoint
CREATE INDEX "effective_campaign_contexts_account_idx" ON "effective_campaign_contexts" USING btree ("ad_account_id");--> statement-breakpoint
CREATE INDEX "effective_campaign_contexts_campaign_idx" ON "effective_campaign_contexts" USING btree ("campaign_id");--> statement-breakpoint
ALTER TABLE "effective_campaign_contexts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "effective_campaign_context_components" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "effective_campaign_context_invalidations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "effective_campaign_contexts" FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "effective_campaign_context_components" FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "effective_campaign_context_invalidations" FROM PUBLIC, anon, authenticated;
