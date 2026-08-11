CREATE TABLE "candidate_preview_binding_heads" (
	"workspace_id" uuid NOT NULL,
	"formalization_ref" text NOT NULL,
	"current_revision_id" uuid NOT NULL,
	"current_revision" integer NOT NULL,
	"current_revision_hash" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "candidate_preview_binding_heads_identity" CHECK ("candidate_preview_binding_heads"."formalization_ref" ~ '^formalization_[a-z0-9][a-z0-9_.:-]{0,126}$' and "candidate_preview_binding_heads"."current_revision" >= 1 and "candidate_preview_binding_heads"."current_revision_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "candidate_preview_binding_invalidations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"binding_revision_id" uuid NOT NULL,
	"binding_revision_hash" text NOT NULL,
	"invalidated_by_revision_id" uuid NOT NULL,
	"invalidation_hash" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "candidate_preview_binding_invalidations_identity" CHECK ("candidate_preview_binding_invalidations"."binding_revision_hash" ~ '^[a-f0-9]{64}$' and "candidate_preview_binding_invalidations"."invalidation_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "candidate_preview_binding_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"formalization_ref" text NOT NULL,
	"revision" integer NOT NULL,
	"previous_revision_hash" text NOT NULL,
	"revision_hash" text NOT NULL,
	"g2_revision_hash" text NOT NULL,
	"guidance_set_id" uuid NOT NULL,
	"guidance_set_ref" text NOT NULL,
	"guidance_set_version" integer NOT NULL,
	"guidance_set_hash" text NOT NULL,
	"policy_revision_id" uuid NOT NULL,
	"policy_ref" text NOT NULL,
	"policy_version" integer NOT NULL,
	"policy_hash" text NOT NULL,
	"target_account_id" uuid NOT NULL,
	"target_account_ref" text NOT NULL,
	"authority_snapshot_id" uuid NOT NULL,
	"authority_snapshot_ref" text NOT NULL,
	"authority_snapshot_hash" text NOT NULL,
	"authority_tier" text NOT NULL,
	"decision" jsonb NOT NULL,
	"actor_ref" text NOT NULL,
	"actor_role" text NOT NULL,
	"payload" jsonb NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "candidate_preview_binding_revisions_identity" CHECK ("candidate_preview_binding_revisions"."formalization_ref" ~ '^formalization_[a-z0-9][a-z0-9_.:-]{0,126}$' and "candidate_preview_binding_revisions"."revision" between 1 and 1000000 and (("candidate_preview_binding_revisions"."revision" = 1 and "candidate_preview_binding_revisions"."previous_revision_hash" = 'GENESIS') or ("candidate_preview_binding_revisions"."revision" > 1 and "candidate_preview_binding_revisions"."previous_revision_hash" ~ '^[a-f0-9]{64}$')) and "candidate_preview_binding_revisions"."revision_hash" ~ '^[a-f0-9]{64}$' and "candidate_preview_binding_revisions"."g2_revision_hash" ~ '^[a-f0-9]{64}$' and "candidate_preview_binding_revisions"."guidance_set_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$' and "candidate_preview_binding_revisions"."guidance_set_version" >= 1 and "candidate_preview_binding_revisions"."guidance_set_hash" ~ '^[a-f0-9]{64}$' and "candidate_preview_binding_revisions"."policy_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$' and "candidate_preview_binding_revisions"."policy_version" between 1 and 1000000 and "candidate_preview_binding_revisions"."policy_hash" ~ '^[a-f0-9]{64}$' and "candidate_preview_binding_revisions"."target_account_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$' and "candidate_preview_binding_revisions"."authority_snapshot_ref" ~ '^authority_snapshot_[a-z0-9][a-z0-9_.:-]{0,126}$' and "candidate_preview_binding_revisions"."authority_snapshot_hash" ~ '^[a-f0-9]{64}$' and "candidate_preview_binding_revisions"."authority_tier" in ('legal_compliance', 'platform_policy', 'brand_safety', 'user_locked_instruction', 'internal_category_playbook', 'operator_preference') and "candidate_preview_binding_revisions"."actor_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$' and "candidate_preview_binding_revisions"."actor_role" in ('owner', 'admin')),
	CONSTRAINT "candidate_preview_binding_revisions_exact" CHECK (("candidate_preview_binding_revisions"."payload" #>> '{formalizationRef}' = "candidate_preview_binding_revisions"."formalization_ref" and ("candidate_preview_binding_revisions"."payload" #>> '{revision}')::integer = "candidate_preview_binding_revisions"."revision" and "candidate_preview_binding_revisions"."payload" #>> '{previousRevisionHash}' = "candidate_preview_binding_revisions"."previous_revision_hash" and "candidate_preview_binding_revisions"."payload" #>> '{revisionHash}' = "candidate_preview_binding_revisions"."revision_hash" and "candidate_preview_binding_revisions"."payload" #>> '{g2RevisionHash}' = "candidate_preview_binding_revisions"."g2_revision_hash" and "candidate_preview_binding_revisions"."payload" #>> '{guidanceSet,ref}' = "candidate_preview_binding_revisions"."guidance_set_ref" and ("candidate_preview_binding_revisions"."payload" #>> '{guidanceSet,version}')::integer = "candidate_preview_binding_revisions"."guidance_set_version" and "candidate_preview_binding_revisions"."payload" #>> '{guidanceSet,hash}' = "candidate_preview_binding_revisions"."guidance_set_hash" and "candidate_preview_binding_revisions"."payload" #>> '{policy,ref}' = "candidate_preview_binding_revisions"."policy_ref" and ("candidate_preview_binding_revisions"."payload" #>> '{policy,version}')::integer = "candidate_preview_binding_revisions"."policy_version" and "candidate_preview_binding_revisions"."payload" #>> '{policy,hash}' = "candidate_preview_binding_revisions"."policy_hash" and "candidate_preview_binding_revisions"."payload" #>> '{targetAccount,ref}' = "candidate_preview_binding_revisions"."target_account_ref" and "candidate_preview_binding_revisions"."payload" #>> '{authoritySnapshot,ref}' = "candidate_preview_binding_revisions"."authority_snapshot_ref" and "candidate_preview_binding_revisions"."payload" #>> '{authoritySnapshot,hash}' = "candidate_preview_binding_revisions"."authority_snapshot_hash" and "candidate_preview_binding_revisions"."payload" #>> '{authorityTier}' = "candidate_preview_binding_revisions"."authority_tier" and "candidate_preview_binding_revisions"."payload" #>> '{decision,decisionKey}' = "candidate_preview_binding_revisions"."decision" #>> '{decisionKey}' and "candidate_preview_binding_revisions"."payload" #>> '{decision,positionKey}' = "candidate_preview_binding_revisions"."decision" #>> '{positionKey}' and "candidate_preview_binding_revisions"."payload" #> '{authority,canPublish}' = 'false'::jsonb and "candidate_preview_binding_revisions"."payload" #> '{authority,canApprove}' = 'false'::jsonb and "candidate_preview_binding_revisions"."payload" #> '{authority,canExecute}' = 'false'::jsonb and "candidate_preview_binding_revisions"."payload" #> '{authority,canWriteMeta}' = 'false'::jsonb) is true)
);
--> statement-breakpoint
ALTER TABLE "candidate_preview_binding_heads" ADD CONSTRAINT "candidate_preview_binding_heads_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_preview_binding_heads" ADD CONSTRAINT "candidate_preview_binding_heads_revision_scope_fk" FOREIGN KEY ("workspace_id","current_revision_id") REFERENCES "public"."candidate_preview_binding_revisions"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_preview_binding_invalidations" ADD CONSTRAINT "candidate_preview_binding_invalidations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_preview_binding_invalidations" ADD CONSTRAINT "candidate_preview_binding_invalidations_binding_scope_fk" FOREIGN KEY ("workspace_id","binding_revision_id") REFERENCES "public"."candidate_preview_binding_revisions"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_preview_binding_invalidations" ADD CONSTRAINT "candidate_preview_binding_invalidations_successor_scope_fk" FOREIGN KEY ("workspace_id","invalidated_by_revision_id") REFERENCES "public"."candidate_preview_binding_revisions"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_preview_binding_revisions" ADD CONSTRAINT "candidate_preview_binding_revisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_preview_binding_revisions" ADD CONSTRAINT "candidate_preview_binding_revisions_policy_scope_fk" FOREIGN KEY ("workspace_id","policy_revision_id") REFERENCES "public"."strict_instruction_policy_revisions"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_preview_binding_revisions" ADD CONSTRAINT "candidate_preview_binding_revisions_account_scope_fk" FOREIGN KEY ("workspace_id","target_account_id") REFERENCES "public"."ad_accounts"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "candidate_preview_binding_revisions" ADD CONSTRAINT "candidate_preview_binding_revisions_snapshot_scope_fk" FOREIGN KEY ("workspace_id","authority_snapshot_id") REFERENCES "public"."tenant_authority_snapshots"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_preview_binding_heads_workspace_formalization_unique" ON "candidate_preview_binding_heads" USING btree ("workspace_id","formalization_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_preview_binding_heads_workspace_row_unique" ON "candidate_preview_binding_heads" USING btree ("workspace_id","current_revision_id");--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_preview_binding_invalidations_workspace_row_unique" ON "candidate_preview_binding_invalidations" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_preview_binding_invalidations_binding_unique" ON "candidate_preview_binding_invalidations" USING btree ("binding_revision_id");--> statement-breakpoint
CREATE INDEX "candidate_preview_binding_invalidations_lookup_idx" ON "candidate_preview_binding_invalidations" USING btree ("workspace_id","binding_revision_id");--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_preview_binding_revisions_workspace_row_unique" ON "candidate_preview_binding_revisions" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_preview_binding_revisions_workspace_version_unique" ON "candidate_preview_binding_revisions" USING btree ("workspace_id","formalization_ref","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "candidate_preview_binding_revisions_workspace_hash_unique" ON "candidate_preview_binding_revisions" USING btree ("workspace_id","revision_hash");--> statement-breakpoint
CREATE INDEX "candidate_preview_binding_revisions_lookup_idx" ON "candidate_preview_binding_revisions" USING btree ("workspace_id","formalization_ref","policy_ref","target_account_ref");
--> statement-breakpoint
ALTER TABLE "candidate_preview_binding_revisions" ADD CONSTRAINT "candidate_preview_binding_revisions_guidance_scope_fk" FOREIGN KEY ("workspace_id","guidance_set_id") REFERENCES "public"."guidance_sets"("workspace_id","id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "candidate_preview_binding_revisions" ADD CONSTRAINT "candidate_preview_binding_revisions_decision_exact" CHECK (jsonb_typeof("decision") = 'object' and ("decision" - 'decisionKey' - 'positionKey') = '{}'::jsonb and "decision" #>> '{decisionKey}' ~ '^[a-z][a-z0-9_.:-]{1,127}$' and "decision" #>> '{positionKey}' ~ '^[a-z][a-z0-9_.:-]{1,127}$');
--> statement-breakpoint
ALTER TABLE "candidate_preview_binding_revisions" ADD CONSTRAINT "candidate_preview_binding_revisions_authority_closed" CHECK (("payload" #> '{authority,canPublish}' = 'false'::jsonb and "payload" #> '{authority,canApprove}' = 'false'::jsonb and "payload" #> '{authority,canExecute}' = 'false'::jsonb and "payload" #> '{authority,canWriteMeta}' = 'false'::jsonb and "payload" #> '{authority,canSchedule}' = 'false'::jsonb and "payload" #> '{authority,canCallTool}' = 'false'::jsonb and "payload" #> '{authority,canAccessNetwork}' = 'false'::jsonb and "payload" #> '{authority,canQuerySql}' = 'false'::jsonb and ("payload" #> '{authority,productionAuthoritySourceBound}') is distinct from 'true'::jsonb) is true);
--> statement-breakpoint
ALTER TABLE "candidate_preview_binding_revisions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "candidate_preview_binding_revisions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "candidate_preview_binding_heads" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "candidate_preview_binding_heads" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "candidate_preview_binding_invalidations" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "candidate_preview_binding_invalidations" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "candidate_preview_binding_revisions", "candidate_preview_binding_heads", "candidate_preview_binding_invalidations" FROM PUBLIC, anon, authenticated, service_role;
--> statement-breakpoint
CREATE FUNCTION public.candidate_preview_binding_tombstone_delete_allowed(target_workspace_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  SELECT EXISTS (SELECT 1 FROM public.workspaces WHERE id = target_workspace_id AND lifecycle_state = 'tombstoning');
$$;
--> statement-breakpoint
CREATE FUNCTION public.candidate_preview_binding_revision_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE expected_previous text;
BEGIN
  IF TG_OP <> 'INSERT' THEN
    IF TG_OP = 'DELETE' AND public.candidate_preview_binding_tombstone_delete_allowed(OLD.workspace_id) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'candidate_preview_binding_append_only';
  END IF;
  IF NEW.revision = 1 THEN
    IF EXISTS (SELECT 1 FROM public.candidate_preview_binding_revisions WHERE workspace_id = NEW.workspace_id AND formalization_ref = NEW.formalization_ref) THEN RAISE EXCEPTION 'candidate_preview_binding_genesis_conflict'; END IF;
  ELSE
    SELECT revision_hash INTO expected_previous FROM public.candidate_preview_binding_revisions WHERE workspace_id = NEW.workspace_id AND formalization_ref = NEW.formalization_ref AND revision = NEW.revision - 1;
    IF expected_previous IS NULL OR expected_previous <> NEW.previous_revision_hash THEN RAISE EXCEPTION 'candidate_preview_binding_chain_conflict'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.candidate_preview_binding_head_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM public.candidate_preview_binding_revisions revision WHERE revision.workspace_id = NEW.workspace_id AND revision.id = NEW.current_revision_id AND revision.formalization_ref = NEW.formalization_ref AND revision.revision = NEW.current_revision AND revision.revision_hash = NEW.current_revision_hash) THEN RAISE EXCEPTION 'candidate_preview_binding_head_hash_mismatch'; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF public.candidate_preview_binding_tombstone_delete_allowed(OLD.workspace_id) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'candidate_preview_binding_append_only';
  END IF;
  IF NEW.workspace_id <> OLD.workspace_id OR NEW.formalization_ref <> OLD.formalization_ref OR NEW.current_revision <> OLD.current_revision + 1 OR NOT EXISTS (SELECT 1 FROM public.candidate_preview_binding_revisions revision WHERE revision.workspace_id = NEW.workspace_id AND revision.id = NEW.current_revision_id AND revision.formalization_ref = NEW.formalization_ref AND revision.revision = NEW.current_revision AND revision.revision_hash = NEW.current_revision_hash) THEN RAISE EXCEPTION 'candidate_preview_binding_head_occ_conflict'; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION public.candidate_preview_binding_invalidation_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    IF TG_OP = 'DELETE' AND public.candidate_preview_binding_tombstone_delete_allowed(OLD.workspace_id) THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'candidate_preview_binding_append_only';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.candidate_preview_binding_revisions prior JOIN public.candidate_preview_binding_revisions successor ON successor.workspace_id = prior.workspace_id WHERE prior.workspace_id = NEW.workspace_id AND prior.id = NEW.binding_revision_id AND prior.revision_hash = NEW.binding_revision_hash AND successor.id = NEW.invalidated_by_revision_id AND successor.formalization_ref = prior.formalization_ref AND successor.revision = prior.revision + 1) THEN RAISE EXCEPTION 'candidate_preview_binding_invalidation_mismatch'; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER candidate_preview_binding_revisions_chain_guard BEFORE INSERT OR UPDATE OR DELETE ON "candidate_preview_binding_revisions" FOR EACH ROW EXECUTE FUNCTION public.candidate_preview_binding_revision_guard();
--> statement-breakpoint
CREATE TRIGGER candidate_preview_binding_heads_occ_guard BEFORE INSERT OR UPDATE OR DELETE ON "candidate_preview_binding_heads" FOR EACH ROW EXECUTE FUNCTION public.candidate_preview_binding_head_guard();
--> statement-breakpoint
CREATE TRIGGER candidate_preview_binding_invalidations_append_only BEFORE INSERT OR UPDATE OR DELETE ON "candidate_preview_binding_invalidations" FOR EACH ROW EXECUTE FUNCTION public.candidate_preview_binding_invalidation_guard();
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION public.candidate_preview_binding_tombstone_delete_allowed(uuid), public.candidate_preview_binding_revision_guard(), public.candidate_preview_binding_head_guard(), public.candidate_preview_binding_invalidation_guard() FROM PUBLIC, anon, authenticated, service_role;
