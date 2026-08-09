CREATE TABLE "guidance_analysis_run_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"registry_hash" text NOT NULL,
	"pack_hash" text NOT NULL,
	"selected_set_refs" jsonb NOT NULL,
	"card_refs" jsonb NOT NULL,
	"source_refs" jsonb NOT NULL,
	"authority" text DEFAULT 'guidance_only' NOT NULL,
	"binding_hash" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "guidance_analysis_run_bindings_hashes" CHECK (
    "guidance_analysis_run_bindings"."registry_hash" ~ '^[a-f0-9]{64}$' and "guidance_analysis_run_bindings"."pack_hash" ~ '^[a-f0-9]{64}$'
    and "guidance_analysis_run_bindings"."binding_hash" ~ '^[a-f0-9]{64}$'
  ),
	CONSTRAINT "guidance_analysis_run_bindings_arrays" CHECK (
    jsonb_typeof("guidance_analysis_run_bindings"."selected_set_refs") = 'array'
    and jsonb_typeof("guidance_analysis_run_bindings"."card_refs") = 'array'
    and jsonb_typeof("guidance_analysis_run_bindings"."source_refs") = 'array'
  ),
	CONSTRAINT "guidance_analysis_run_bindings_guidance_only" CHECK ("guidance_analysis_run_bindings"."authority" = 'guidance_only'),
	CONSTRAINT "guidance_analysis_run_bindings_no_forbidden_material" CHECK (
    concat_ws('|', "guidance_analysis_run_bindings"."selected_set_refs"::text, "guidance_analysis_run_bindings"."card_refs"::text, "guidance_analysis_run_bindings"."source_refs"::text)
      !~* '(token|secret|prompt|raw[_-]?(payload|request|response|json)|authorization|canwrite|canauthorize|canexecute|canenforce)'
  )
);
--> statement-breakpoint
ALTER TABLE "guidance_bindings" DROP CONSTRAINT "guidance_bindings_facet_allowlist";--> statement-breakpoint
ALTER TABLE "guidance_analysis_run_bindings" ADD CONSTRAINT "guidance_analysis_run_bindings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "guidance_analysis_run_bindings" ADD CONSTRAINT "guidance_analysis_run_bindings_run_scope_fk" FOREIGN KEY ("workspace_id","run_id") REFERENCES "public"."decision_room_runs"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "guidance_analysis_run_bindings_run_unique" ON "guidance_analysis_run_bindings" USING btree ("workspace_id","run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "guidance_analysis_run_bindings_hash_unique" ON "guidance_analysis_run_bindings" USING btree ("workspace_id","binding_hash");--> statement-breakpoint
CREATE INDEX "guidance_analysis_run_bindings_run_idx" ON "guidance_analysis_run_bindings" USING btree ("run_id");--> statement-breakpoint
ALTER TABLE "guidance_bindings" ADD CONSTRAINT "guidance_bindings_facet_allowlist" CHECK ("guidance_bindings"."facet" in (
    'global', 'account_group', 'account', 'objective', 'funnel', 'optimization',
    'internal_category', 'lifecycle', 'entity', 'promotion_template', 'topic'
  ));--> statement-breakpoint
CREATE FUNCTION guidance_revision_refs_exact(payload jsonb, ref_key text) RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
SET search_path = ''
AS $$
DECLARE
  entry jsonb;
BEGIN
  IF jsonb_typeof(payload) <> 'array' OR ref_key NOT IN ('setRef', 'cardRef', 'sourceRef') THEN
    RETURN false;
  END IF;
  FOR entry IN SELECT value FROM pg_catalog.jsonb_array_elements(payload) LOOP
    IF jsonb_typeof(entry) <> 'object'
      OR entry - ref_key - 'version' - 'recordHash' <> '{}'::jsonb
      OR NOT entry ? ref_key OR NOT entry ? 'version' OR NOT entry ? 'recordHash'
      OR entry ->> ref_key !~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
      OR jsonb_typeof(entry -> 'version') <> 'number'
      OR entry ->> 'version' !~ '^[1-9][0-9]*$'
      OR entry ->> 'recordHash' !~ '^[a-f0-9]{64}$'
    THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END;
$$;--> statement-breakpoint
ALTER TABLE "guidance_analysis_run_bindings"
  ADD CONSTRAINT "guidance_analysis_run_bindings_exact_refs" CHECK (
    guidance_revision_refs_exact("selected_set_refs", 'setRef')
    and guidance_revision_refs_exact("card_refs", 'cardRef')
    and guidance_revision_refs_exact("source_refs", 'sourceRef')
  );--> statement-breakpoint
CREATE FUNCTION guidance_analysis_run_binding_immutable() RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND EXISTS (
    SELECT 1 FROM public.workspaces
    WHERE id = OLD.workspace_id AND lifecycle_state = 'tombstoning'
  ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'guidance_analysis_run_binding_immutable';
END;
$$;--> statement-breakpoint
CREATE TRIGGER guidance_analysis_run_bindings_append_only_trigger
BEFORE UPDATE OR DELETE ON guidance_analysis_run_bindings
FOR EACH ROW EXECUTE FUNCTION guidance_analysis_run_binding_immutable();--> statement-breakpoint
CREATE FUNCTION guidance_registry_revision_immutable() RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND EXISTS (
    SELECT 1 FROM public.workspaces
    WHERE id = OLD.workspace_id AND lifecycle_state = 'tombstoning'
  ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'guidance_registry_revision_immutable';
END;
$$;--> statement-breakpoint
CREATE TRIGGER guidance_sources_append_only_trigger BEFORE UPDATE OR DELETE ON guidance_sources
FOR EACH ROW EXECUTE FUNCTION guidance_registry_revision_immutable();--> statement-breakpoint
CREATE TRIGGER guidance_cards_append_only_trigger BEFORE UPDATE OR DELETE ON guidance_cards
FOR EACH ROW EXECUTE FUNCTION guidance_registry_revision_immutable();--> statement-breakpoint
CREATE TRIGGER guidance_bindings_append_only_trigger BEFORE UPDATE OR DELETE ON guidance_bindings
FOR EACH ROW EXECUTE FUNCTION guidance_registry_revision_immutable();--> statement-breakpoint
CREATE TRIGGER guidance_sets_append_only_trigger BEFORE UPDATE OR DELETE ON guidance_sets
FOR EACH ROW EXECUTE FUNCTION guidance_registry_revision_immutable();--> statement-breakpoint
ALTER TABLE "guidance_sources" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "guidance_cards" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "guidance_bindings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "guidance_sets" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "guidance_sources", "guidance_cards", "guidance_bindings", "guidance_sets"
  FROM PUBLIC, anon, authenticated, service_role;--> statement-breakpoint
ALTER TABLE "guidance_analysis_run_bindings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "guidance_analysis_run_bindings" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "guidance_analysis_run_bindings" FROM PUBLIC, anon, authenticated, service_role;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION guidance_revision_refs_exact(jsonb, text) FROM PUBLIC, anon, authenticated, service_role;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION guidance_analysis_run_binding_immutable() FROM PUBLIC, anon, authenticated, service_role;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION guidance_registry_revision_immutable() FROM PUBLIC, anon, authenticated, service_role;
