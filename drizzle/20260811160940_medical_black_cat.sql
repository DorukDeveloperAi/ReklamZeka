CREATE TABLE "frozen_diagnostic_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"context_id" uuid NOT NULL,
	"context_ref" text NOT NULL,
	"context_hash" text NOT NULL,
	"evidence_hash" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"entity_type" text NOT NULL,
	"entity_ref" text NOT NULL,
	"hierarchy_refs" jsonb NOT NULL,
	"feature_manifest" jsonb NOT NULL,
	"window_manifest" jsonb NOT NULL,
	"objective" text,
	"funnel" text,
	"optimization_event" text,
	"category_composition_hash" text NOT NULL,
	"policy_set_hash" text NOT NULL,
	"creative_binding_hash" text,
	"canonical_config_evidence" jsonb NOT NULL,
	"source_refs" jsonb NOT NULL,
	"capabilities" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "frozen_diagnostic_evidence_hashes" CHECK ("frozen_diagnostic_evidence"."context_hash" ~ '^[a-f0-9]{64}$' and "frozen_diagnostic_evidence"."evidence_hash" ~ '^[a-f0-9]{64}$' and "frozen_diagnostic_evidence"."category_composition_hash" ~ '^[a-f0-9]{64}$' and "frozen_diagnostic_evidence"."policy_set_hash" ~ '^[a-f0-9]{64}$' and ("frozen_diagnostic_evidence"."creative_binding_hash" is null or "frozen_diagnostic_evidence"."creative_binding_hash" ~ '^[a-f0-9]{64}$')),
	CONSTRAINT "frozen_diagnostic_evidence_exact_context" CHECK (btrim("frozen_diagnostic_evidence"."context_ref") <> '' and btrim("frozen_diagnostic_evidence"."entity_ref") <> '' and "frozen_diagnostic_evidence"."entity_type" in ('campaign', 'ad_set', 'ad', 'creative') and jsonb_typeof("frozen_diagnostic_evidence"."hierarchy_refs") = 'array' and jsonb_array_length("frozen_diagnostic_evidence"."hierarchy_refs") >= 1 and jsonb_typeof("frozen_diagnostic_evidence"."feature_manifest") = 'array' and jsonb_array_length("frozen_diagnostic_evidence"."feature_manifest") >= 1 and jsonb_typeof("frozen_diagnostic_evidence"."window_manifest") = 'array' and jsonb_array_length("frozen_diagnostic_evidence"."window_manifest") >= 1 and jsonb_typeof("frozen_diagnostic_evidence"."canonical_config_evidence") = 'object' and jsonb_typeof("frozen_diagnostic_evidence"."source_refs") = 'array' and jsonb_array_length("frozen_diagnostic_evidence"."source_refs") >= 1),
	CONSTRAINT "frozen_diagnostic_evidence_no_authority" CHECK ("frozen_diagnostic_evidence"."capabilities" = '{"canAuthorizeAction":false,"canExecuteWrite":false,"canWriteMeta":false,"canPublish":false,"canApprove":false,"canExecute":false,"canAccessNetwork":false}'::jsonb)
);
--> statement-breakpoint
ALTER TABLE "frozen_diagnostic_evidence" ADD CONSTRAINT "frozen_diagnostic_evidence_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "frozen_diagnostic_evidence" ADD CONSTRAINT "frozen_diagnostic_evidence_context_scope_fk" FOREIGN KEY ("workspace_id","context_id") REFERENCES "public"."effective_campaign_contexts"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "frozen_diagnostic_evidence_context_unique" ON "frozen_diagnostic_evidence" USING btree ("context_id");--> statement-breakpoint
CREATE UNIQUE INDEX "frozen_diagnostic_evidence_workspace_id_unique" ON "frozen_diagnostic_evidence" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "frozen_diagnostic_evidence_workspace_hash_unique" ON "frozen_diagnostic_evidence" USING btree ("workspace_id","evidence_hash");--> statement-breakpoint
CREATE INDEX "frozen_diagnostic_evidence_lookup_idx" ON "frozen_diagnostic_evidence" USING btree ("workspace_id","entity_type","entity_ref","captured_at");
--> statement-breakpoint
ALTER TABLE "frozen_diagnostic_evidence" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "frozen_diagnostic_evidence" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "frozen_diagnostic_evidence" FROM PUBLIC, anon, authenticated, service_role;
--> statement-breakpoint
CREATE FUNCTION public.frozen_diagnostic_evidence_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' AND EXISTS (SELECT 1 FROM public.workspaces WHERE id = OLD.workspace_id AND lifecycle_state = 'tombstoning') THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'frozen_diagnostic_evidence_append_only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER frozen_diagnostic_evidence_append_only BEFORE UPDATE OR DELETE ON "frozen_diagnostic_evidence" FOR EACH ROW EXECUTE FUNCTION public.frozen_diagnostic_evidence_guard();
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION public.frozen_diagnostic_evidence_guard() FROM PUBLIC, anon, authenticated, service_role;
