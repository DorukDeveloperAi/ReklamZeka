CREATE TABLE "policy_authority_catalogs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"catalog_ref" text NOT NULL,
	"current_revision" integer DEFAULT 0 NOT NULL,
	"current_revision_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policy_authority_catalogs_identity" CHECK ("policy_authority_catalogs"."catalog_ref" ~ '^authority_catalog_[a-z0-9][a-z0-9_.:-]{0,126}$' and "policy_authority_catalogs"."current_revision" >= 0 and (("policy_authority_catalogs"."current_revision" = 0 and "policy_authority_catalogs"."current_revision_hash" is null) or ("policy_authority_catalogs"."current_revision" > 0 and "policy_authority_catalogs"."current_revision_hash" ~ '^[a-f0-9]{64}$')))
);
--> statement-breakpoint
CREATE TABLE "tenant_authority_snapshot_heads" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"current_snapshot_id" uuid NOT NULL,
	"current_snapshot_hash" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_authority_snapshot_heads_hash" CHECK ("tenant_authority_snapshot_heads"."current_snapshot_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "policy_authority_catalogs" ADD CONSTRAINT "policy_authority_catalogs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_authority_snapshot_heads" ADD CONSTRAINT "tenant_authority_snapshot_heads_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_authority_snapshot_heads" ADD CONSTRAINT "tenant_authority_snapshot_heads_snapshot_scope_fk" FOREIGN KEY ("workspace_id","current_snapshot_id") REFERENCES "public"."tenant_authority_snapshots"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "policy_authority_catalogs_workspace_row_unique" ON "policy_authority_catalogs" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_authority_catalogs_workspace_ref_unique" ON "policy_authority_catalogs" USING btree ("workspace_id","catalog_ref");--> statement-breakpoint
CREATE INDEX "tenant_authority_snapshot_heads_current_idx" ON "tenant_authority_snapshot_heads" USING btree ("workspace_id","current_snapshot_id");
--> statement-breakpoint
ALTER TABLE policy_authority_catalogs ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_authority_catalogs FORCE ROW LEVEL SECURITY;
ALTER TABLE tenant_authority_snapshot_heads ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_authority_snapshot_heads FORCE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE policy_authority_catalogs, tenant_authority_snapshot_heads FROM PUBLIC, anon, authenticated, service_role;
--> statement-breakpoint
CREATE FUNCTION policy_authority_catalog_revision_chain_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE expected_previous text;
BEGIN
  IF TG_OP <> 'INSERT' THEN RETURN public.authority_substrate_append_only(); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.policy_authority_catalogs WHERE workspace_id = NEW.workspace_id AND catalog_ref = NEW.catalog_ref) THEN RAISE EXCEPTION 'policy_authority_catalog_missing_head'; END IF;
  IF NEW.revision = 1 THEN
    IF EXISTS (SELECT 1 FROM public.policy_authority_catalog_revisions WHERE workspace_id = NEW.workspace_id AND catalog_ref = NEW.catalog_ref) THEN RAISE EXCEPTION 'policy_authority_catalog_genesis_conflict'; END IF;
  ELSE
    SELECT revision_hash INTO expected_previous FROM public.policy_authority_catalog_revisions WHERE workspace_id = NEW.workspace_id AND catalog_ref = NEW.catalog_ref AND revision = NEW.revision - 1;
    IF expected_previous IS NULL OR expected_previous <> NEW.previous_revision_hash THEN RAISE EXCEPTION 'policy_authority_catalog_chain_conflict'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION policy_authority_catalog_head_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;
  IF TG_OP = 'DELETE' THEN RETURN public.authority_substrate_append_only(); END IF;
  IF NEW.workspace_id <> OLD.workspace_id OR NEW.id <> OLD.id OR NEW.catalog_ref <> OLD.catalog_ref OR NEW.current_revision <> OLD.current_revision + 1
    OR NOT EXISTS (SELECT 1 FROM public.policy_authority_catalog_revisions revision WHERE revision.workspace_id = NEW.workspace_id AND revision.catalog_ref = NEW.catalog_ref AND revision.revision = NEW.current_revision AND revision.revision_hash = NEW.current_revision_hash) THEN RAISE EXCEPTION 'policy_authority_catalog_head_occ_conflict'; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION tenant_authority_snapshot_head_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE new_verified_at timestamptz; old_verified_at timestamptz;
BEGIN
  IF TG_OP = 'DELETE' THEN RETURN public.authority_substrate_append_only(); END IF;
  SELECT verified_at INTO new_verified_at FROM public.tenant_authority_snapshots WHERE workspace_id = NEW.workspace_id AND id = NEW.current_snapshot_id AND snapshot_hash = NEW.current_snapshot_hash;
  IF new_verified_at IS NULL THEN RAISE EXCEPTION 'tenant_authority_snapshot_head_hash_mismatch'; END IF;
  IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;
  IF NEW.workspace_id <> OLD.workspace_id OR NEW.updated_at < OLD.updated_at THEN RAISE EXCEPTION 'tenant_authority_snapshot_head_occ_conflict'; END IF;
  SELECT verified_at INTO old_verified_at FROM public.tenant_authority_snapshots WHERE workspace_id = OLD.workspace_id AND id = OLD.current_snapshot_id;
  IF old_verified_at IS NULL OR new_verified_at <= old_verified_at THEN RAISE EXCEPTION 'tenant_authority_snapshot_head_occ_conflict'; END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER policy_authority_catalog_revisions_chain_trigger BEFORE INSERT OR UPDATE OR DELETE ON policy_authority_catalog_revisions FOR EACH ROW EXECUTE FUNCTION policy_authority_catalog_revision_chain_guard();
CREATE TRIGGER policy_authority_catalogs_head_trigger BEFORE INSERT OR UPDATE OR DELETE ON policy_authority_catalogs FOR EACH ROW EXECUTE FUNCTION policy_authority_catalog_head_guard();
CREATE TRIGGER tenant_authority_snapshot_heads_head_trigger BEFORE INSERT OR UPDATE OR DELETE ON tenant_authority_snapshot_heads FOR EACH ROW EXECUTE FUNCTION tenant_authority_snapshot_head_guard();
REVOKE ALL PRIVILEGES ON FUNCTION policy_authority_catalog_revision_chain_guard(), policy_authority_catalog_head_guard(), tenant_authority_snapshot_head_guard() FROM PUBLIC, anon, authenticated, service_role;
