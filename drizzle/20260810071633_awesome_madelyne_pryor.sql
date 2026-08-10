CREATE TABLE "account_group_account_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"account_group_revision_id" uuid NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"binding_ref" text NOT NULL,
	"binding_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_group_account_bindings_identity" CHECK ("account_group_account_bindings"."binding_ref" ~ '^account_group_binding_[a-z0-9][a-z0-9_.:-]{0,126}$' and "account_group_account_bindings"."binding_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "account_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"group_ref" text NOT NULL,
	"current_revision" integer DEFAULT 0 NOT NULL,
	"current_revision_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_groups_identity" CHECK ("account_groups"."group_ref" ~ '^account_group_[a-z0-9][a-z0-9_.:-]{0,126}$' and "account_groups"."current_revision" >= 0 and (("account_groups"."current_revision" = 0 and "account_groups"."current_revision_hash" is null) or ("account_groups"."current_revision" > 0 and "account_groups"."current_revision_hash" ~ '^[a-f0-9]{64}$')))
);
--> statement-breakpoint
CREATE TABLE "account_group_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"account_group_id" uuid NOT NULL,
	"group_ref" text NOT NULL,
	"revision" integer NOT NULL,
	"previous_revision_hash" text,
	"revision_hash" text NOT NULL,
	"status" text NOT NULL,
	"payload" jsonb NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_group_revisions_identity" CHECK ("account_group_revisions"."group_ref" ~ '^account_group_[a-z0-9][a-z0-9_.:-]{0,126}$' and "account_group_revisions"."revision" between 1 and 1000000 and (("account_group_revisions"."revision" = 1 and "account_group_revisions"."previous_revision_hash" is null) or ("account_group_revisions"."revision" > 1 and "account_group_revisions"."previous_revision_hash" ~ '^[a-f0-9]{64}$')) and "account_group_revisions"."revision_hash" ~ '^[a-f0-9]{64}$' and "account_group_revisions"."status" in ('draft', 'active', 'archived')),
	CONSTRAINT "account_group_revisions_no_authority" CHECK ("account_group_revisions"."payload" #> '{authority,canPublish}' = 'false'::jsonb and "account_group_revisions"."payload" #> '{authority,canApprove}' = 'false'::jsonb and "account_group_revisions"."payload" #> '{authority,canExecute}' = 'false'::jsonb and "account_group_revisions"."payload" #> '{authority,canWriteMeta}' = 'false'::jsonb)
);
--> statement-breakpoint
CREATE TABLE "action_proposal_unit_frozen_contexts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"action_proposal_unit_id" uuid NOT NULL,
	"context_id" uuid NOT NULL,
	"context_hash" text NOT NULL,
	"binding_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "action_proposal_unit_frozen_contexts_hashes" CHECK ("action_proposal_unit_frozen_contexts"."context_hash" ~ '^[a-f0-9]{64}$' and "action_proposal_unit_frozen_contexts"."binding_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "policy_authority_catalog_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"catalog_ref" text NOT NULL,
	"revision" integer NOT NULL,
	"previous_revision_hash" text,
	"revision_hash" text NOT NULL,
	"payload" jsonb NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policy_authority_catalog_revisions_identity" CHECK ("policy_authority_catalog_revisions"."catalog_ref" ~ '^authority_catalog_[a-z0-9][a-z0-9_.:-]{0,126}$' and "policy_authority_catalog_revisions"."revision" >= 1 and (("policy_authority_catalog_revisions"."revision" = 1 and "policy_authority_catalog_revisions"."previous_revision_hash" is null) or ("policy_authority_catalog_revisions"."revision" > 1 and "policy_authority_catalog_revisions"."previous_revision_hash" ~ '^[a-f0-9]{64}$')) and "policy_authority_catalog_revisions"."revision_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "policy_authority_catalog_revisions_no_authority" CHECK ("policy_authority_catalog_revisions"."payload" #> '{authority,canPublish}' = 'false'::jsonb and "policy_authority_catalog_revisions"."payload" #> '{authority,canApprove}' = 'false'::jsonb and "policy_authority_catalog_revisions"."payload" #> '{authority,canExecute}' = 'false'::jsonb and "policy_authority_catalog_revisions"."payload" #> '{authority,canWriteMeta}' = 'false'::jsonb)
);
--> statement-breakpoint
CREATE TABLE "policy_authority_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"policy_revision_id" uuid NOT NULL,
	"authority_snapshot_id" uuid NOT NULL,
	"authority_catalog_revision_id" uuid NOT NULL,
	"authority_tier_ref" text NOT NULL,
	"decision_ref" text NOT NULL,
	"binding_kind" text NOT NULL,
	"binding_ref" text NOT NULL,
	"binding_version" text NOT NULL,
	"binding_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policy_authority_bindings_kind" CHECK ("policy_authority_bindings"."binding_kind" in ('account_group', 'topic', 'semantic')),
	CONSTRAINT "policy_authority_bindings_identity" CHECK ("policy_authority_bindings"."authority_tier_ref" ~ '^authority_tier_[a-z0-9][a-z0-9_.:-]{0,126}$' and "policy_authority_bindings"."decision_ref" ~ '^decision_[a-z0-9][a-z0-9_.:-]{0,126}$' and "policy_authority_bindings"."binding_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$' and btrim("policy_authority_bindings"."binding_version") <> '' and "policy_authority_bindings"."binding_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "policy_manual_lock_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"policy_revision_id" uuid NOT NULL,
	"lock_ref" text NOT NULL,
	"actor_ref" text NOT NULL,
	"actor_role" text NOT NULL,
	"sequence" integer NOT NULL,
	"previous_revision_hash" text,
	"revision_hash" text NOT NULL,
	"operation" text NOT NULL,
	"reason_code" text NOT NULL,
	"payload" jsonb NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policy_manual_lock_revisions_identity" CHECK ("policy_manual_lock_revisions"."lock_ref" ~ '^manual_lock_[a-z0-9][a-z0-9_.:-]{0,126}$' and "policy_manual_lock_revisions"."actor_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$' and "policy_manual_lock_revisions"."actor_role" in ('owner', 'admin') and "policy_manual_lock_revisions"."sequence" >= 1 and (("policy_manual_lock_revisions"."sequence" = 1 and "policy_manual_lock_revisions"."previous_revision_hash" is null) or ("policy_manual_lock_revisions"."sequence" > 1 and "policy_manual_lock_revisions"."previous_revision_hash" ~ '^[a-f0-9]{64}$')) and "policy_manual_lock_revisions"."revision_hash" ~ '^[a-f0-9]{64}$' and "policy_manual_lock_revisions"."operation" in ('lock', 'unlock') and "policy_manual_lock_revisions"."reason_code" ~ '^[a-z][a-z0-9_]{2,63}$'),
	CONSTRAINT "policy_manual_lock_revisions_exact" CHECK (("policy_manual_lock_revisions"."payload" #>> '{lockRef}' = "policy_manual_lock_revisions"."lock_ref" and "policy_manual_lock_revisions"."payload" #>> '{actor,ref}' = "policy_manual_lock_revisions"."actor_ref" and "policy_manual_lock_revisions"."payload" #>> '{actor,role}' = "policy_manual_lock_revisions"."actor_role" and "policy_manual_lock_revisions"."payload" #>> '{operation}' = "policy_manual_lock_revisions"."operation" and "policy_manual_lock_revisions"."payload" #>> '{revisionHash}' = "policy_manual_lock_revisions"."revision_hash") is true),
	CONSTRAINT "policy_manual_lock_revisions_no_authority" CHECK ("policy_manual_lock_revisions"."payload" #> '{authority,canPublish}' = 'false'::jsonb and "policy_manual_lock_revisions"."payload" #> '{authority,canApprove}' = 'false'::jsonb and "policy_manual_lock_revisions"."payload" #> '{authority,canExecute}' = 'false'::jsonb and "policy_manual_lock_revisions"."payload" #> '{authority,canWriteMeta}' = 'false'::jsonb)
);
--> statement-breakpoint
CREATE TABLE "tenant_authority_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"snapshot_ref" text NOT NULL,
	"snapshot_hash" text NOT NULL,
	"repository_ref" text NOT NULL,
	"repository_revision" text NOT NULL,
	"verified_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"snapshot_payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_authority_snapshots_identity" CHECK ("tenant_authority_snapshots"."snapshot_ref" ~ '^authority_snapshot_[a-z0-9][a-z0-9_.:-]{0,126}$' and "tenant_authority_snapshots"."snapshot_hash" ~ '^[a-f0-9]{64}$' and "tenant_authority_snapshots"."repository_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$' and btrim("tenant_authority_snapshots"."repository_revision") <> '' and "tenant_authority_snapshots"."expires_at" > "tenant_authority_snapshots"."verified_at"),
	CONSTRAINT "tenant_authority_snapshots_exact" CHECK (("tenant_authority_snapshots"."snapshot_payload" #>> '{schemaVersion}' = 'tenant-authority-snapshot/1.0.0' and "tenant_authority_snapshots"."snapshot_payload" #>> '{snapshotRef}' = "tenant_authority_snapshots"."snapshot_ref" and "tenant_authority_snapshots"."snapshot_payload" #>> '{snapshotHash}' = "tenant_authority_snapshots"."snapshot_hash" and "tenant_authority_snapshots"."snapshot_payload" #>> '{repository,ref}' = "tenant_authority_snapshots"."repository_ref" and "tenant_authority_snapshots"."snapshot_payload" #>> '{repository,revision}' = "tenant_authority_snapshots"."repository_revision" and "tenant_authority_snapshots"."snapshot_payload" #> '{repository,verified}' = 'true'::jsonb and "tenant_authority_snapshots"."snapshot_payload" #> '{authority,productionAuthoritySourceBound}' = 'false'::jsonb and "tenant_authority_snapshots"."snapshot_payload" #> '{authority,canPublish}' = 'false'::jsonb and "tenant_authority_snapshots"."snapshot_payload" #> '{authority,canApprove}' = 'false'::jsonb and "tenant_authority_snapshots"."snapshot_payload" #> '{authority,canExecute}' = 'false'::jsonb and "tenant_authority_snapshots"."snapshot_payload" #> '{authority,canWriteMeta}' = 'false'::jsonb) is true)
);
--> statement-breakpoint
ALTER TABLE "effective_campaign_context_components" DROP CONSTRAINT "effective_campaign_context_components_type";--> statement-breakpoint
ALTER TABLE "effective_campaign_context_invalidations" DROP CONSTRAINT "effective_campaign_context_invalidations_type";--> statement-breakpoint
ALTER TABLE "account_group_account_bindings" ADD CONSTRAINT "account_group_account_bindings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_group_account_bindings" ADD CONSTRAINT "account_group_account_bindings_account_scope_fk" FOREIGN KEY ("workspace_id","ad_account_id") REFERENCES "public"."ad_accounts"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_group_revisions" ADD CONSTRAINT "account_group_revisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_groups" ADD CONSTRAINT "account_groups_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_proposal_unit_frozen_contexts" ADD CONSTRAINT "action_proposal_unit_frozen_contexts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_proposal_unit_frozen_contexts" ADD CONSTRAINT "action_proposal_unit_frozen_contexts_unit_scope_fk" FOREIGN KEY ("workspace_id","action_proposal_unit_id") REFERENCES "public"."action_proposal_units"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_proposal_unit_frozen_contexts" ADD CONSTRAINT "action_proposal_unit_frozen_contexts_context_scope_fk" FOREIGN KEY ("workspace_id","context_id") REFERENCES "public"."effective_campaign_contexts"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_authority_bindings" ADD CONSTRAINT "policy_authority_bindings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_authority_bindings" ADD CONSTRAINT "policy_authority_bindings_policy_scope_fk" FOREIGN KEY ("workspace_id","policy_revision_id") REFERENCES "public"."strict_instruction_policy_revisions"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_authority_catalog_revisions" ADD CONSTRAINT "policy_authority_catalog_revisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_manual_lock_revisions" ADD CONSTRAINT "policy_manual_lock_revisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_manual_lock_revisions" ADD CONSTRAINT "policy_manual_lock_revisions_policy_scope_fk" FOREIGN KEY ("workspace_id","policy_revision_id") REFERENCES "public"."strict_instruction_policy_revisions"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_authority_snapshots" ADD CONSTRAINT "tenant_authority_snapshots_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "account_group_account_bindings_workspace_row_unique" ON "account_group_account_bindings" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_group_account_bindings_exact_unique" ON "account_group_account_bindings" USING btree ("account_group_revision_id","ad_account_id");--> statement-breakpoint
CREATE INDEX "account_group_account_bindings_account_idx" ON "account_group_account_bindings" USING btree ("workspace_id","ad_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_group_revisions_workspace_row_unique" ON "account_group_revisions" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_groups_workspace_row_unique" ON "account_groups" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "account_groups_workspace_ref_unique" ON "account_groups" USING btree ("workspace_id","group_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "account_group_revisions_workspace_version_unique" ON "account_group_revisions" USING btree ("workspace_id","group_ref","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "account_group_revisions_workspace_hash_unique" ON "account_group_revisions" USING btree ("workspace_id","revision_hash");--> statement-breakpoint
CREATE INDEX "account_group_revisions_head_idx" ON "account_group_revisions" USING btree ("workspace_id","group_ref","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "action_proposal_unit_frozen_contexts_workspace_row_unique" ON "action_proposal_unit_frozen_contexts" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "action_proposal_unit_frozen_contexts_unit_unique" ON "action_proposal_unit_frozen_contexts" USING btree ("action_proposal_unit_id");--> statement-breakpoint
CREATE INDEX "action_proposal_unit_frozen_contexts_context_idx" ON "action_proposal_unit_frozen_contexts" USING btree ("workspace_id","context_id");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_authority_bindings_workspace_row_unique" ON "policy_authority_bindings" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_authority_bindings_exact_unique" ON "policy_authority_bindings" USING btree ("policy_revision_id","binding_kind","binding_ref","binding_version");--> statement-breakpoint
CREATE INDEX "policy_authority_bindings_lookup_idx" ON "policy_authority_bindings" USING btree ("workspace_id","binding_kind","binding_ref","binding_version");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_authority_catalog_revisions_workspace_row_unique" ON "policy_authority_catalog_revisions" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_authority_catalog_revisions_version_unique" ON "policy_authority_catalog_revisions" USING btree ("workspace_id","catalog_ref","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_authority_catalog_revisions_hash_unique" ON "policy_authority_catalog_revisions" USING btree ("workspace_id","revision_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_manual_lock_revisions_workspace_row_unique" ON "policy_manual_lock_revisions" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_manual_lock_revisions_sequence_unique" ON "policy_manual_lock_revisions" USING btree ("policy_revision_id","lock_ref","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_manual_lock_revisions_workspace_hash_unique" ON "policy_manual_lock_revisions" USING btree ("workspace_id","revision_hash");--> statement-breakpoint
CREATE INDEX "policy_manual_lock_revisions_head_idx" ON "policy_manual_lock_revisions" USING btree ("workspace_id","policy_revision_id","lock_ref","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_authority_snapshots_workspace_row_unique" ON "tenant_authority_snapshots" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_authority_snapshots_workspace_ref_unique" ON "tenant_authority_snapshots" USING btree ("workspace_id","snapshot_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_authority_snapshots_workspace_hash_unique" ON "tenant_authority_snapshots" USING btree ("workspace_id","snapshot_hash");--> statement-breakpoint
CREATE INDEX "tenant_authority_snapshots_verified_idx" ON "tenant_authority_snapshots" USING btree ("workspace_id","verified_at");--> statement-breakpoint
ALTER TABLE "account_group_account_bindings" ADD CONSTRAINT "account_group_account_bindings_revision_scope_fk" FOREIGN KEY ("workspace_id","account_group_revision_id") REFERENCES "public"."account_group_revisions"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_group_revisions" ADD CONSTRAINT "account_group_revisions_group_scope_fk" FOREIGN KEY ("workspace_id","account_group_id") REFERENCES "public"."account_groups"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_authority_bindings" ADD CONSTRAINT "policy_authority_bindings_snapshot_scope_fk" FOREIGN KEY ("workspace_id","authority_snapshot_id") REFERENCES "public"."tenant_authority_snapshots"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_authority_bindings" ADD CONSTRAINT "policy_authority_bindings_catalog_scope_fk" FOREIGN KEY ("workspace_id","authority_catalog_revision_id") REFERENCES "public"."policy_authority_catalog_revisions"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "effective_campaign_context_components" ADD CONSTRAINT "effective_campaign_context_components_type" CHECK ("effective_campaign_context_components"."component_type" in (
    'source_snapshot', 'category_resolution', 'category_profile', 'guidance_pack', 'meta_catalog',
    'category_resolver', 'guidance_registry', 'metric_catalog', 'formula_catalog',
    'timeframe_resolver', 'instruction_policy', 'promotion_registry', 'policy_authority'
  ));--> statement-breakpoint
ALTER TABLE "effective_campaign_context_invalidations" ADD CONSTRAINT "effective_campaign_context_invalidations_type" CHECK ("effective_campaign_context_invalidations"."component_type" in (
    'source_snapshot', 'category_resolution', 'category_profile', 'guidance_pack', 'meta_catalog',
    'category_resolver', 'guidance_registry', 'metric_catalog', 'formula_catalog',
    'timeframe_resolver', 'instruction_policy', 'promotion_registry', 'policy_authority'
  ));
--> statement-breakpoint
-- Every new public relation is server-private even for service_role; repositories are the only writers.
ALTER TABLE account_group_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_group_revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE account_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_groups FORCE ROW LEVEL SECURITY;
ALTER TABLE account_group_account_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE account_group_account_bindings FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant_authority_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_authority_snapshots FORCE ROW LEVEL SECURITY;
ALTER TABLE policy_authority_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_authority_bindings FORCE ROW LEVEL SECURITY;
ALTER TABLE policy_authority_catalog_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_authority_catalog_revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE policy_manual_lock_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_manual_lock_revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE action_proposal_unit_frozen_contexts ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_proposal_unit_frozen_contexts FORCE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE account_groups, account_group_revisions, account_group_account_bindings,
  tenant_authority_snapshots, policy_authority_bindings, policy_authority_catalog_revisions, policy_manual_lock_revisions,
  action_proposal_unit_frozen_contexts FROM PUBLIC, anon, authenticated, service_role;
--> statement-breakpoint
CREATE FUNCTION authority_substrate_append_only() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;
  IF TG_OP = 'DELETE' AND EXISTS (
    SELECT 1 FROM public.workspaces WHERE id = OLD.workspace_id AND lifecycle_state = 'tombstoning'
  ) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'authority_substrate_append_only';
END;
$$;
CREATE FUNCTION account_group_revision_chain_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE expected_previous text;
BEGIN
  IF TG_OP <> 'INSERT' THEN RETURN authority_substrate_append_only(); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.account_groups WHERE workspace_id = NEW.workspace_id AND id = NEW.account_group_id AND group_ref = NEW.group_ref) THEN
    RAISE EXCEPTION 'account_group_revision_identity_mismatch';
  END IF;
  IF NEW.revision = 1 THEN
    IF EXISTS (SELECT 1 FROM public.account_group_revisions WHERE workspace_id = NEW.workspace_id AND group_ref = NEW.group_ref) THEN
      RAISE EXCEPTION 'account_group_revision_genesis_conflict';
    END IF;
  ELSE
    SELECT revision_hash INTO expected_previous FROM public.account_group_revisions
      WHERE workspace_id = NEW.workspace_id AND group_ref = NEW.group_ref AND revision = NEW.revision - 1;
    IF expected_previous IS NULL OR expected_previous <> NEW.previous_revision_hash THEN
      RAISE EXCEPTION 'account_group_revision_chain_conflict';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION account_group_head_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;
  IF TG_OP = 'DELETE' THEN RETURN authority_substrate_append_only(); END IF;
  IF NEW.workspace_id <> OLD.workspace_id OR NEW.id <> OLD.id OR NEW.group_ref <> OLD.group_ref
    OR NEW.current_revision <> OLD.current_revision + 1
    OR NOT EXISTS (SELECT 1 FROM public.account_group_revisions revision WHERE revision.workspace_id = NEW.workspace_id
      AND revision.account_group_id = NEW.id AND revision.group_ref = NEW.group_ref AND revision.revision = NEW.current_revision
      AND revision.revision_hash = NEW.current_revision_hash) THEN
    RAISE EXCEPTION 'account_group_head_occ_conflict';
  END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION policy_manual_lock_chain_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE expected_previous text;
BEGIN
  IF TG_OP <> 'INSERT' THEN RETURN authority_substrate_append_only(); END IF;
  IF NEW.sequence = 1 THEN
    IF EXISTS (SELECT 1 FROM public.policy_manual_lock_revisions WHERE policy_revision_id = NEW.policy_revision_id AND lock_ref = NEW.lock_ref) THEN
      RAISE EXCEPTION 'policy_manual_lock_genesis_conflict';
    END IF;
  ELSE
    SELECT revision_hash INTO expected_previous FROM public.policy_manual_lock_revisions
      WHERE policy_revision_id = NEW.policy_revision_id AND lock_ref = NEW.lock_ref AND sequence = NEW.sequence - 1;
    IF expected_previous IS NULL OR expected_previous <> NEW.previous_revision_hash THEN
      RAISE EXCEPTION 'policy_manual_lock_chain_conflict';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION action_unit_frozen_context_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE stored_context_hash text; unit_context_hash text;
BEGIN
  IF TG_OP <> 'INSERT' THEN RETURN authority_substrate_append_only(); END IF;
  SELECT context_hash INTO stored_context_hash FROM public.effective_campaign_contexts
    WHERE workspace_id = NEW.workspace_id AND id = NEW.context_id;
  SELECT context_hash INTO unit_context_hash FROM public.action_proposal_units
    WHERE workspace_id = NEW.workspace_id AND id = NEW.action_proposal_unit_id;
  IF stored_context_hash IS NULL OR unit_context_hash IS NULL
    OR stored_context_hash <> NEW.context_hash OR unit_context_hash <> NEW.context_hash THEN
    RAISE EXCEPTION 'action_unit_frozen_context_hash_mismatch';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER account_group_revisions_append_only_trigger BEFORE INSERT OR UPDATE OR DELETE ON account_group_revisions FOR EACH ROW EXECUTE FUNCTION account_group_revision_chain_guard();
CREATE TRIGGER account_groups_append_only_trigger BEFORE INSERT OR UPDATE OR DELETE ON account_groups FOR EACH ROW EXECUTE FUNCTION account_group_head_guard();
CREATE TRIGGER account_group_account_bindings_append_only_trigger BEFORE INSERT OR UPDATE OR DELETE ON account_group_account_bindings FOR EACH ROW EXECUTE FUNCTION authority_substrate_append_only();
CREATE TRIGGER tenant_authority_snapshots_append_only_trigger BEFORE INSERT OR UPDATE OR DELETE ON tenant_authority_snapshots FOR EACH ROW EXECUTE FUNCTION authority_substrate_append_only();
CREATE TRIGGER policy_authority_bindings_append_only_trigger BEFORE INSERT OR UPDATE OR DELETE ON policy_authority_bindings FOR EACH ROW EXECUTE FUNCTION authority_substrate_append_only();
CREATE TRIGGER policy_authority_catalog_revisions_append_only_trigger BEFORE INSERT OR UPDATE OR DELETE ON policy_authority_catalog_revisions FOR EACH ROW EXECUTE FUNCTION authority_substrate_append_only();
CREATE TRIGGER policy_manual_lock_revisions_append_only_trigger BEFORE INSERT OR UPDATE OR DELETE ON policy_manual_lock_revisions FOR EACH ROW EXECUTE FUNCTION policy_manual_lock_chain_guard();
CREATE TRIGGER action_proposal_unit_frozen_contexts_append_only_trigger BEFORE INSERT OR UPDATE OR DELETE ON action_proposal_unit_frozen_contexts FOR EACH ROW EXECUTE FUNCTION action_unit_frozen_context_guard();
REVOKE ALL PRIVILEGES ON FUNCTION authority_substrate_append_only(), account_group_revision_chain_guard(), account_group_head_guard(), policy_manual_lock_chain_guard(), action_unit_frozen_context_guard() FROM PUBLIC, anon, authenticated, service_role;
