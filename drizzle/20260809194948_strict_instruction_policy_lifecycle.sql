CREATE TABLE "instruction_policy_raw_provenance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"workspace_ref" text NOT NULL,
	"provenance_ref" text NOT NULL,
	"raw_text" text NOT NULL,
	"raw_text_hash" text NOT NULL,
	"captured_by_actor_ref" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instruction_policy_raw_provenance_identity" CHECK (
    "instruction_policy_raw_provenance"."workspace_ref" ~ '^workspace_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and "instruction_policy_raw_provenance"."provenance_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and "instruction_policy_raw_provenance"."captured_by_actor_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and "instruction_policy_raw_provenance"."raw_text_hash" ~ '^[a-f0-9]{64}$'
    and length("instruction_policy_raw_provenance"."raw_text") between 1 and 16000 and btrim("instruction_policy_raw_provenance"."raw_text") <> ''
  )
);
--> statement-breakpoint
CREATE TABLE "strict_instruction_policy_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"raw_provenance_id" uuid NOT NULL,
	"workspace_ref" text NOT NULL,
	"policy_ref" text NOT NULL,
	"policy_version" integer NOT NULL,
	"previous_version_hash" text,
	"policy_type" text NOT NULL,
	"status" text NOT NULL,
	"raw_provenance_ref" text NOT NULL,
	"raw_text_hash" text NOT NULL,
	"actor_ref" text NOT NULL,
	"actor_role" text NOT NULL,
	"canonical_hash" text NOT NULL,
	"policy_payload" jsonb NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "strict_instruction_policy_revisions_identity" CHECK (
    "strict_instruction_policy_revisions"."workspace_ref" ~ '^workspace_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and "strict_instruction_policy_revisions"."policy_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and "strict_instruction_policy_revisions"."raw_provenance_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and "strict_instruction_policy_revisions"."actor_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and "strict_instruction_policy_revisions"."policy_version" between 1 and 1000000
    and (("strict_instruction_policy_revisions"."policy_version" = 1 and "strict_instruction_policy_revisions"."previous_version_hash" is null)
      or ("strict_instruction_policy_revisions"."policy_version" > 1 and "strict_instruction_policy_revisions"."previous_version_hash" ~ '^[a-f0-9]{64}$'))
    and "strict_instruction_policy_revisions"."raw_text_hash" ~ '^[a-f0-9]{64}$' and "strict_instruction_policy_revisions"."canonical_hash" ~ '^[a-f0-9]{64}$'
    and "strict_instruction_policy_revisions"."policy_type" in ('hard_constraint', 'target', 'preference', 'exception', 'prohibition', 'approval', 'schedule')
    and "strict_instruction_policy_revisions"."status" in ('draft', 'published', 'paused', 'archived')
    and "strict_instruction_policy_revisions"."actor_role" in ('owner', 'admin', 'analyst')
  ),
	CONSTRAINT "strict_instruction_policy_revisions_payload_exact" CHECK ((
    jsonb_typeof("strict_instruction_policy_revisions"."policy_payload") = 'object'
    and "strict_instruction_policy_revisions"."policy_payload" #>> '{dslVersion}' = 'strict-instruction-policy/1.0.0'
    and "strict_instruction_policy_revisions"."policy_payload" #>> '{workspaceRef}' = "strict_instruction_policy_revisions"."workspace_ref"
    and "strict_instruction_policy_revisions"."policy_payload" #>> '{policyRef}' = "strict_instruction_policy_revisions"."policy_ref"
    and ("strict_instruction_policy_revisions"."policy_payload" #>> '{policyVersion}')::integer = "strict_instruction_policy_revisions"."policy_version"
    and ("strict_instruction_policy_revisions"."policy_payload" #>> '{previousVersionHash}') is not distinct from "strict_instruction_policy_revisions"."previous_version_hash"
    and "strict_instruction_policy_revisions"."policy_payload" #>> '{policyType}' = "strict_instruction_policy_revisions"."policy_type"
    and "strict_instruction_policy_revisions"."policy_payload" #>> '{status}' = "strict_instruction_policy_revisions"."status"
    and "strict_instruction_policy_revisions"."policy_payload" #>> '{source,rawProvenanceRef}' = "strict_instruction_policy_revisions"."raw_provenance_ref"
    and "strict_instruction_policy_revisions"."policy_payload" #>> '{source,rawTextHash}' = "strict_instruction_policy_revisions"."raw_text_hash"
    and "strict_instruction_policy_revisions"."policy_payload" #>> '{canonicalHash}' = "strict_instruction_policy_revisions"."canonical_hash"
    and "strict_instruction_policy_revisions"."policy_payload" #> '{authority,canExecute}' = 'false'::jsonb
    and "strict_instruction_policy_revisions"."policy_payload" #> '{authority,canWriteMeta}' = 'false'::jsonb
    and "strict_instruction_policy_revisions"."policy_payload" #> '{authority,canApprove}' = 'false'::jsonb
    and "strict_instruction_policy_revisions"."policy_payload" #> '{authority,canSchedule}' = 'false'::jsonb
    and "strict_instruction_policy_revisions"."policy_payload" #> '{authority,canCallTool}' = 'false'::jsonb
    and "strict_instruction_policy_revisions"."policy_payload" #> '{authority,canAccessNetwork}' = 'false'::jsonb
    and "strict_instruction_policy_revisions"."policy_payload" #> '{authority,canQuerySql}' = 'false'::jsonb
  ) is true),
	CONSTRAINT "strict_instruction_policy_revisions_no_raw_text" CHECK (
    not ("strict_instruction_policy_revisions"."policy_payload" ? 'rawText')
    and not jsonb_path_exists("strict_instruction_policy_revisions"."policy_payload", '$.**.rawText')
    and "strict_instruction_policy_revisions"."policy_payload"::text !~* '"(token|secret|authorization|approvalgranted)"[[:space:]]*:'
  )
);
--> statement-breakpoint
ALTER TABLE "effective_campaign_context_components" DROP CONSTRAINT "effective_campaign_context_components_type";--> statement-breakpoint
ALTER TABLE "effective_campaign_context_invalidations" DROP CONSTRAINT "effective_campaign_context_invalidations_type";--> statement-breakpoint
ALTER TABLE "instruction_policy_raw_provenance" ADD CONSTRAINT "instruction_policy_raw_provenance_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "strict_instruction_policy_revisions" ADD CONSTRAINT "strict_instruction_policy_revisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "instruction_policy_raw_provenance_workspace_row_unique" ON "instruction_policy_raw_provenance" USING btree ("workspace_id","id");--> statement-breakpoint
ALTER TABLE "strict_instruction_policy_revisions" ADD CONSTRAINT "strict_instruction_policy_revisions_provenance_scope_fk" FOREIGN KEY ("workspace_id","raw_provenance_id") REFERENCES "public"."instruction_policy_raw_provenance"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "instruction_policy_raw_provenance_workspace_ref_unique" ON "instruction_policy_raw_provenance" USING btree ("workspace_id","provenance_ref");--> statement-breakpoint
CREATE INDEX "instruction_policy_raw_provenance_workspace_captured_idx" ON "instruction_policy_raw_provenance" USING btree ("workspace_id","captured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "strict_instruction_policy_revisions_workspace_row_unique" ON "strict_instruction_policy_revisions" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "strict_instruction_policy_revisions_workspace_version_unique" ON "strict_instruction_policy_revisions" USING btree ("workspace_id","policy_ref","policy_version");--> statement-breakpoint
CREATE UNIQUE INDEX "strict_instruction_policy_revisions_workspace_hash_unique" ON "strict_instruction_policy_revisions" USING btree ("workspace_id","canonical_hash");--> statement-breakpoint
CREATE INDEX "strict_instruction_policy_revisions_current_idx" ON "strict_instruction_policy_revisions" USING btree ("workspace_id","policy_ref","policy_version");--> statement-breakpoint
CREATE INDEX "strict_instruction_policy_revisions_provenance_idx" ON "strict_instruction_policy_revisions" USING btree ("raw_provenance_id");--> statement-breakpoint
ALTER TABLE "effective_campaign_context_components" ADD CONSTRAINT "effective_campaign_context_components_type" CHECK ("effective_campaign_context_components"."component_type" in (
    'source_snapshot', 'category_resolution', 'category_profile', 'guidance_pack', 'meta_catalog',
    'category_resolver', 'guidance_registry', 'metric_catalog', 'formula_catalog',
    'timeframe_resolver', 'instruction_policy'
  ));--> statement-breakpoint
ALTER TABLE "effective_campaign_context_invalidations" ADD CONSTRAINT "effective_campaign_context_invalidations_type" CHECK ("effective_campaign_context_invalidations"."component_type" in (
    'source_snapshot', 'category_resolution', 'category_profile', 'guidance_pack', 'meta_catalog',
    'category_resolver', 'guidance_registry', 'metric_catalog', 'formula_catalog',
    'timeframe_resolver', 'instruction_policy'
  ));--> statement-breakpoint
ALTER TABLE instruction_policy_raw_provenance ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE instruction_policy_raw_provenance FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE strict_instruction_policy_revisions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE strict_instruction_policy_revisions FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE instruction_policy_raw_provenance FROM PUBLIC, anon, authenticated, service_role;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE strict_instruction_policy_revisions FROM PUBLIC, anon, authenticated, service_role;--> statement-breakpoint
CREATE OR REPLACE FUNCTION strict_instruction_policy_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'strict instruction policy records are append-only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER instruction_policy_raw_provenance_append_only_trigger
BEFORE UPDATE ON instruction_policy_raw_provenance
FOR EACH ROW EXECUTE FUNCTION strict_instruction_policy_append_only();--> statement-breakpoint
CREATE TRIGGER strict_instruction_policy_revisions_append_only_trigger
BEFORE UPDATE ON strict_instruction_policy_revisions
FOR EACH ROW EXECUTE FUNCTION strict_instruction_policy_append_only();--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION strict_instruction_policy_append_only() FROM PUBLIC, anon, authenticated, service_role;
