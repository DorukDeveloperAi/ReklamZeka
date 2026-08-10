CREATE TABLE "authority_topic_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"topic_id" uuid NOT NULL,
	"topic_ref" text NOT NULL,
	"revision" integer NOT NULL,
	"previous_revision_hash" text,
	"revision_hash" text NOT NULL,
	"status" text NOT NULL,
	"payload" jsonb NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "authority_topic_revisions_identity" CHECK ("authority_topic_revisions"."topic_ref" ~ '^topic_[a-z0-9][a-z0-9_.:-]{0,126}$' and "authority_topic_revisions"."revision" between 1 and 1000000 and (("authority_topic_revisions"."revision" = 1 and "authority_topic_revisions"."previous_revision_hash" is null) or ("authority_topic_revisions"."revision" > 1 and "authority_topic_revisions"."previous_revision_hash" ~ '^[a-f0-9]{64}$')) and "authority_topic_revisions"."revision_hash" ~ '^[a-f0-9]{64}$' and "authority_topic_revisions"."status" in ('active', 'archived')),
	CONSTRAINT "authority_topic_revisions_no_authority" CHECK ("authority_topic_revisions"."payload" #> '{authority,canPublish}' = 'false'::jsonb and "authority_topic_revisions"."payload" #> '{authority,canApprove}' = 'false'::jsonb and "authority_topic_revisions"."payload" #> '{authority,canExecute}' = 'false'::jsonb and "authority_topic_revisions"."payload" #> '{authority,canWriteMeta}' = 'false'::jsonb)
);
--> statement-breakpoint
CREATE TABLE "authority_topics" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"topic_ref" text NOT NULL,
	"current_revision" integer DEFAULT 0 NOT NULL,
	"current_revision_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "authority_topics_identity" CHECK ("authority_topics"."topic_ref" ~ '^topic_[a-z0-9][a-z0-9_.:-]{0,126}$' and "authority_topics"."current_revision" >= 0 and (("authority_topics"."current_revision" = 0 and "authority_topics"."current_revision_hash" is null) or ("authority_topics"."current_revision" > 0 and "authority_topics"."current_revision_hash" ~ '^[a-f0-9]{64}$')))
);
--> statement-breakpoint
CREATE TABLE "category_topic_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"category_definition_id" uuid NOT NULL,
	"topic_revision_id" uuid NOT NULL,
	"binding_ref" text NOT NULL,
	"binding_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "category_topic_bindings_identity" CHECK ("category_topic_bindings"."binding_ref" ~ '^category_topic_binding_[a-z0-9][a-z0-9_.:-]{0,126}$' and "category_topic_bindings"."binding_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "policy_semantic_binding_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"policy_revision_id" uuid NOT NULL,
	"semantic_ref" text NOT NULL,
	"revision" integer NOT NULL,
	"previous_revision_hash" text,
	"revision_hash" text NOT NULL,
	"payload" jsonb NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policy_semantic_binding_revisions_identity" CHECK ("policy_semantic_binding_revisions"."semantic_ref" ~ '^semantic_[a-z0-9][a-z0-9_.:-]{0,126}$' and "policy_semantic_binding_revisions"."revision" between 1 and 1000000 and (("policy_semantic_binding_revisions"."revision" = 1 and "policy_semantic_binding_revisions"."previous_revision_hash" is null) or ("policy_semantic_binding_revisions"."revision" > 1 and "policy_semantic_binding_revisions"."previous_revision_hash" ~ '^[a-f0-9]{64}$')) and "policy_semantic_binding_revisions"."revision_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "policy_semantic_binding_revisions_no_authority" CHECK ("policy_semantic_binding_revisions"."payload" #> '{authority,canPublish}' = 'false'::jsonb and "policy_semantic_binding_revisions"."payload" #> '{authority,canApprove}' = 'false'::jsonb and "policy_semantic_binding_revisions"."payload" #> '{authority,canExecute}' = 'false'::jsonb and "policy_semantic_binding_revisions"."payload" #> '{authority,canWriteMeta}' = 'false'::jsonb)
);
--> statement-breakpoint
ALTER TABLE "authority_topic_revisions" ADD CONSTRAINT "authority_topic_revisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "authority_topics" ADD CONSTRAINT "authority_topics_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_topic_bindings" ADD CONSTRAINT "category_topic_bindings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_topic_bindings" ADD CONSTRAINT "category_topic_bindings_category_scope_fk" FOREIGN KEY ("workspace_id","category_definition_id") REFERENCES "public"."category_definitions"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_semantic_binding_revisions" ADD CONSTRAINT "policy_semantic_binding_revisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "policy_semantic_binding_revisions" ADD CONSTRAINT "policy_semantic_binding_revisions_policy_scope_fk" FOREIGN KEY ("workspace_id","policy_revision_id") REFERENCES "public"."strict_instruction_policy_revisions"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "authority_topic_revisions_workspace_row_unique" ON "authority_topic_revisions" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "authority_topic_revisions_workspace_version_unique" ON "authority_topic_revisions" USING btree ("workspace_id","topic_ref","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "authority_topic_revisions_workspace_hash_unique" ON "authority_topic_revisions" USING btree ("workspace_id","revision_hash");--> statement-breakpoint
CREATE INDEX "authority_topic_revisions_head_idx" ON "authority_topic_revisions" USING btree ("workspace_id","topic_ref","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "authority_topics_workspace_row_unique" ON "authority_topics" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "authority_topics_workspace_ref_unique" ON "authority_topics" USING btree ("workspace_id","topic_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "category_topic_bindings_workspace_row_unique" ON "category_topic_bindings" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "category_topic_bindings_exact_unique" ON "category_topic_bindings" USING btree ("category_definition_id","topic_revision_id");--> statement-breakpoint
CREATE INDEX "category_topic_bindings_topic_lookup_idx" ON "category_topic_bindings" USING btree ("workspace_id","topic_revision_id");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_semantic_binding_revisions_workspace_row_unique" ON "policy_semantic_binding_revisions" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_semantic_binding_revisions_exact_unique" ON "policy_semantic_binding_revisions" USING btree ("policy_revision_id","semantic_ref","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "policy_semantic_binding_revisions_workspace_hash_unique" ON "policy_semantic_binding_revisions" USING btree ("workspace_id","revision_hash");--> statement-breakpoint
CREATE INDEX "policy_semantic_binding_revisions_lookup_idx" ON "policy_semantic_binding_revisions" USING btree ("workspace_id","semantic_ref","revision");
--> statement-breakpoint
ALTER TABLE "authority_topic_revisions" ADD CONSTRAINT "authority_topic_revisions_topic_scope_fk" FOREIGN KEY ("workspace_id","topic_id") REFERENCES "public"."authority_topics"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_topic_bindings" ADD CONSTRAINT "category_topic_bindings_topic_scope_fk" FOREIGN KEY ("workspace_id","topic_revision_id") REFERENCES "public"."authority_topic_revisions"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE authority_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE authority_topics FORCE ROW LEVEL SECURITY;
ALTER TABLE authority_topic_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE authority_topic_revisions FORCE ROW LEVEL SECURITY;
ALTER TABLE category_topic_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE category_topic_bindings FORCE ROW LEVEL SECURITY;
ALTER TABLE policy_semantic_binding_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE policy_semantic_binding_revisions FORCE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON TABLE authority_topics, authority_topic_revisions, category_topic_bindings,
  policy_semantic_binding_revisions FROM PUBLIC, anon, authenticated, service_role;
--> statement-breakpoint
CREATE FUNCTION authority_topic_revision_chain_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE expected_previous text;
BEGIN
  IF TG_OP <> 'INSERT' THEN RETURN public.authority_substrate_append_only(); END IF;
  IF NOT EXISTS (SELECT 1 FROM public.authority_topics WHERE workspace_id = NEW.workspace_id AND id = NEW.topic_id AND topic_ref = NEW.topic_ref) THEN
    RAISE EXCEPTION 'authority_topic_revision_identity_mismatch';
  END IF;
  IF NEW.revision = 1 THEN
    IF EXISTS (SELECT 1 FROM public.authority_topic_revisions WHERE workspace_id = NEW.workspace_id AND topic_ref = NEW.topic_ref) THEN RAISE EXCEPTION 'authority_topic_revision_genesis_conflict'; END IF;
  ELSE
    SELECT revision_hash INTO expected_previous FROM public.authority_topic_revisions WHERE workspace_id = NEW.workspace_id AND topic_ref = NEW.topic_ref AND revision = NEW.revision - 1;
    IF expected_previous IS NULL OR expected_previous <> NEW.previous_revision_hash THEN RAISE EXCEPTION 'authority_topic_revision_chain_conflict'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION authority_topic_head_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;
  IF TG_OP = 'DELETE' THEN RETURN public.authority_substrate_append_only(); END IF;
  IF NEW.workspace_id <> OLD.workspace_id OR NEW.id <> OLD.id OR NEW.topic_ref <> OLD.topic_ref
    OR NEW.current_revision <> OLD.current_revision + 1
    OR NOT EXISTS (SELECT 1 FROM public.authority_topic_revisions revision WHERE revision.workspace_id = NEW.workspace_id
      AND revision.topic_id = NEW.id AND revision.topic_ref = NEW.topic_ref AND revision.revision = NEW.current_revision
      AND revision.revision_hash = NEW.current_revision_hash) THEN RAISE EXCEPTION 'authority_topic_head_occ_conflict'; END IF;
  RETURN NEW;
END;
$$;
CREATE FUNCTION authority_semantic_binding_chain_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE expected_previous text;
BEGIN
  IF TG_OP <> 'INSERT' THEN RETURN public.authority_substrate_append_only(); END IF;
  IF NEW.revision = 1 THEN
    IF EXISTS (SELECT 1 FROM public.policy_semantic_binding_revisions WHERE policy_revision_id = NEW.policy_revision_id AND semantic_ref = NEW.semantic_ref) THEN RAISE EXCEPTION 'policy_semantic_binding_genesis_conflict'; END IF;
  ELSE
    SELECT revision_hash INTO expected_previous FROM public.policy_semantic_binding_revisions WHERE policy_revision_id = NEW.policy_revision_id AND semantic_ref = NEW.semantic_ref AND revision = NEW.revision - 1;
    IF expected_previous IS NULL OR expected_previous <> NEW.previous_revision_hash THEN RAISE EXCEPTION 'policy_semantic_binding_chain_conflict'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER authority_topics_head_trigger BEFORE INSERT OR UPDATE OR DELETE ON authority_topics FOR EACH ROW EXECUTE FUNCTION authority_topic_head_guard();
CREATE TRIGGER authority_topic_revisions_append_only_trigger BEFORE INSERT OR UPDATE OR DELETE ON authority_topic_revisions FOR EACH ROW EXECUTE FUNCTION authority_topic_revision_chain_guard();
CREATE TRIGGER category_topic_bindings_append_only_trigger BEFORE INSERT OR UPDATE OR DELETE ON category_topic_bindings FOR EACH ROW EXECUTE FUNCTION public.authority_substrate_append_only();
CREATE TRIGGER policy_semantic_binding_revisions_append_only_trigger BEFORE INSERT OR UPDATE OR DELETE ON policy_semantic_binding_revisions FOR EACH ROW EXECUTE FUNCTION authority_semantic_binding_chain_guard();
REVOKE ALL PRIVILEGES ON FUNCTION authority_topic_revision_chain_guard(), authority_topic_head_guard(), authority_semantic_binding_chain_guard() FROM PUBLIC, anon, authenticated, service_role;
