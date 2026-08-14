CREATE TABLE "effective_campaign_policy_compositions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "context_id" uuid NOT NULL,
  "instruction_policy_registry_hash" text NOT NULL,
  "authority_component_version" text NOT NULL,
  "authority_snapshot_ref" text NOT NULL,
  "authority_snapshot_hash" text NOT NULL,
  "authority_catalog_hash" text NOT NULL,
  "authority_scope_hash" text NOT NULL,
  "composition_hash" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "effective_campaign_policy_compositions_context_scope_fk" FOREIGN KEY ("workspace_id","context_id") REFERENCES "effective_campaign_contexts"("workspace_id","id") ON DELETE cascade,
  CONSTRAINT "effective_campaign_policy_compositions_hashes" CHECK ("instruction_policy_registry_hash" ~ '^[a-f0-9]{64}$' and "authority_component_version" ~ '^[a-f0-9]{64}$' and "authority_snapshot_hash" ~ '^[a-f0-9]{64}$' and "authority_catalog_hash" ~ '^[a-f0-9]{64}$' and "authority_scope_hash" ~ '^[a-f0-9]{64}$' and "composition_hash" ~ '^[a-f0-9]{64}$')
);--> statement-breakpoint
CREATE UNIQUE INDEX "effective_campaign_policy_compositions_context_unique" ON "effective_campaign_policy_compositions" USING btree ("context_id");--> statement-breakpoint
CREATE UNIQUE INDEX "effective_campaign_policy_compositions_workspace_id_unique" ON "effective_campaign_policy_compositions" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE INDEX "effective_campaign_policy_compositions_workspace_lookup_idx" ON "effective_campaign_policy_compositions" USING btree ("workspace_id","instruction_policy_registry_hash","authority_component_version");--> statement-breakpoint
CREATE TABLE "effective_campaign_policy_composition_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "workspace_id" uuid NOT NULL REFERENCES "workspaces"("id") ON DELETE cascade,
  "composition_id" uuid NOT NULL,
  "policy_revision_id" uuid NOT NULL,
  "policy_ref" text NOT NULL,
  "policy_version" integer NOT NULL,
  "policy_hash" text NOT NULL,
  "state" text NOT NULL,
  "reason" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "effective_campaign_policy_composition_items_composition_scope_fk" FOREIGN KEY ("workspace_id","composition_id") REFERENCES "effective_campaign_policy_compositions"("workspace_id","id") ON DELETE cascade,
  CONSTRAINT "effective_campaign_policy_composition_items_revision_scope_fk" FOREIGN KEY ("workspace_id","policy_revision_id") REFERENCES "strict_instruction_policy_revisions"("workspace_id","id") ON DELETE restrict,
  CONSTRAINT "effective_campaign_policy_composition_items_shape" CHECK ("policy_version" >= 1 and "policy_hash" ~ '^[a-f0-9]{64}$' and "state" in ('applied','suppressed','parked_conflict') and btrim("reason") <> '')
);--> statement-breakpoint
CREATE UNIQUE INDEX "effective_campaign_policy_composition_items_exact_unique" ON "effective_campaign_policy_composition_items" USING btree ("composition_id","policy_ref");--> statement-breakpoint
CREATE INDEX "effective_campaign_policy_composition_items_revision_idx" ON "effective_campaign_policy_composition_items" USING btree ("workspace_id","policy_revision_id");--> statement-breakpoint
ALTER TABLE "effective_campaign_policy_compositions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "effective_campaign_policy_compositions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "effective_campaign_policy_composition_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "effective_campaign_policy_composition_items" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "effective_campaign_policy_compositions", "effective_campaign_policy_composition_items" FROM PUBLIC, anon, authenticated, service_role;--> statement-breakpoint
CREATE OR REPLACE FUNCTION effective_campaign_policy_composition_immutable() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' AND EXISTS (SELECT 1 FROM public.workspaces WHERE id = OLD.workspace_id AND lifecycle_state = 'tombstoning') THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'effective campaign policy composition is append-only';
END; $$;--> statement-breakpoint
CREATE TRIGGER effective_campaign_policy_compositions_immutable BEFORE UPDATE OR DELETE ON "effective_campaign_policy_compositions" FOR EACH ROW EXECUTE FUNCTION effective_campaign_policy_composition_immutable();--> statement-breakpoint
CREATE TRIGGER effective_campaign_policy_composition_items_immutable BEFORE UPDATE OR DELETE ON "effective_campaign_policy_composition_items" FOR EACH ROW EXECUTE FUNCTION effective_campaign_policy_composition_immutable();--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION effective_campaign_policy_composition_immutable() FROM PUBLIC, anon, authenticated, service_role;
