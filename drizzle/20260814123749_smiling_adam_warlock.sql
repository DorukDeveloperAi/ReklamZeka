CREATE TABLE "orchestrator_playbook_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"playbook_ref" text NOT NULL,
	"revision" integer NOT NULL,
	"previous_hash" text NOT NULL,
	"playbook_hash" text NOT NULL,
	"state" text NOT NULL,
	"source_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"created_by_actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orchestrator_playbook_revisions_identity" CHECK ("orchestrator_playbook_revisions"."playbook_ref" ~ '^playbook_[a-z0-9][a-z0-9_-]{0,86}$' and "orchestrator_playbook_revisions"."revision" >= 1 and "orchestrator_playbook_revisions"."playbook_hash" ~ '^[a-f0-9]{64}$' and ("orchestrator_playbook_revisions"."revision" = 1 and "orchestrator_playbook_revisions"."previous_hash" = 'GENESIS' or "orchestrator_playbook_revisions"."revision" > 1 and "orchestrator_playbook_revisions"."previous_hash" ~ '^[a-f0-9]{64}$') and "orchestrator_playbook_revisions"."state" in ('active', 'tombstoned')),
	CONSTRAINT "orchestrator_playbook_revisions_no_authority" CHECK ("orchestrator_playbook_revisions"."payload"::text !~* '"(policy|rule|scope|approval|execute|meta[_-]?write|persist|publish)"[[:space:]]*:')
);
--> statement-breakpoint
CREATE TABLE "orchestrator_profile_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"profile_ref" text NOT NULL,
	"revision" integer NOT NULL,
	"previous_hash" text NOT NULL,
	"profile_hash" text NOT NULL,
	"state" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_by_actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orchestrator_profile_revisions_identity" CHECK ("orchestrator_profile_revisions"."profile_ref" ~ '^profile_[a-z0-9][a-z0-9_-]{0,86}$' and "orchestrator_profile_revisions"."revision" >= 1 and "orchestrator_profile_revisions"."profile_hash" ~ '^[a-f0-9]{64}$' and ("orchestrator_profile_revisions"."revision" = 1 and "orchestrator_profile_revisions"."previous_hash" = 'GENESIS' or "orchestrator_profile_revisions"."revision" > 1 and "orchestrator_profile_revisions"."previous_hash" ~ '^[a-f0-9]{64}$') and "orchestrator_profile_revisions"."state" in ('active', 'tombstoned'))
);
--> statement-breakpoint
ALTER TABLE "orchestrator_conversation_turns" ADD COLUMN "profile_snapshot" jsonb DEFAULT '{"version":"legacy_not_recorded"}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "orchestrator_conversation_turns" ADD COLUMN "manifest_snapshots" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "orchestrator_conversation_turns" ADD COLUMN "skill_catalog_binding_hash" text DEFAULT 'LEGACY_NOT_RECORDED' NOT NULL;--> statement-breakpoint
ALTER TABLE "orchestrator_playbook_revisions" ADD CONSTRAINT "orchestrator_playbook_revisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orchestrator_playbook_revisions" ADD CONSTRAINT "orchestrator_playbook_revisions_source_fk" FOREIGN KEY ("workspace_id","source_id") REFERENCES "public"."guidance_sources"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orchestrator_playbook_revisions" ADD CONSTRAINT "orchestrator_playbook_revisions_membership_fk" FOREIGN KEY ("workspace_id","created_by_actor_id") REFERENCES "public"."memberships"("workspace_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orchestrator_profile_revisions" ADD CONSTRAINT "orchestrator_profile_revisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orchestrator_profile_revisions" ADD CONSTRAINT "orchestrator_profile_revisions_membership_fk" FOREIGN KEY ("workspace_id","created_by_actor_id") REFERENCES "public"."memberships"("workspace_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "orchestrator_playbook_revisions_workspace_row_unique" ON "orchestrator_playbook_revisions" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "orchestrator_playbook_revisions_identity_unique" ON "orchestrator_playbook_revisions" USING btree ("workspace_id","playbook_ref","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "orchestrator_playbook_revisions_hash_unique" ON "orchestrator_playbook_revisions" USING btree ("workspace_id","playbook_hash");--> statement-breakpoint
CREATE INDEX "orchestrator_playbook_revisions_current_idx" ON "orchestrator_playbook_revisions" USING btree ("workspace_id","playbook_ref","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "orchestrator_profile_revisions_workspace_row_unique" ON "orchestrator_profile_revisions" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "orchestrator_profile_revisions_identity_unique" ON "orchestrator_profile_revisions" USING btree ("workspace_id","profile_ref","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "orchestrator_profile_revisions_hash_unique" ON "orchestrator_profile_revisions" USING btree ("workspace_id","profile_hash");--> statement-breakpoint
CREATE INDEX "orchestrator_profile_revisions_current_idx" ON "orchestrator_profile_revisions" USING btree ("workspace_id","profile_ref","revision");--> statement-breakpoint
ALTER TABLE "orchestrator_conversation_turns" ADD CONSTRAINT "orchestrator_conversation_turns_skill_catalog_binding" CHECK (
    ("orchestrator_conversation_turns"."skill_catalog_binding_hash" = 'LEGACY_NOT_RECORDED' and "orchestrator_conversation_turns"."profile_snapshot" = '{"version":"legacy_not_recorded"}'::jsonb and "orchestrator_conversation_turns"."manifest_snapshots" = '[]'::jsonb)
    or ("orchestrator_conversation_turns"."skill_catalog_binding_hash" ~ '^[a-f0-9]{64}$'
      and jsonb_typeof("orchestrator_conversation_turns"."profile_snapshot") = 'object'
      and "orchestrator_conversation_turns"."profile_snapshot" ?& array['version', 'profileRef', 'revision', 'profileHash']
      and "orchestrator_conversation_turns"."profile_snapshot" - array['version', 'profileRef', 'revision', 'profileHash'] = '{}'::jsonb
      and jsonb_typeof("orchestrator_conversation_turns"."manifest_snapshots") = 'array' and jsonb_array_length("orchestrator_conversation_turns"."manifest_snapshots") between 1 and 9)
  );
--> statement-breakpoint
ALTER TABLE orchestrator_profile_revisions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE orchestrator_profile_revisions FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE orchestrator_playbook_revisions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE orchestrator_playbook_revisions FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE orchestrator_profile_revisions FROM PUBLIC, anon, authenticated, service_role;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE orchestrator_playbook_revisions FROM PUBLIC, anon, authenticated, service_role;--> statement-breakpoint
CREATE FUNCTION public.orchestrator_skill_catalog_append_only() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' AND EXISTS (SELECT 1 FROM public.workspaces WHERE id = OLD.workspace_id AND lifecycle_state = 'tombstoning') THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'orchestrator skill catalog records are append-only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER orchestrator_profile_revisions_append_only BEFORE UPDATE OR DELETE ON orchestrator_profile_revisions FOR EACH ROW EXECUTE FUNCTION public.orchestrator_skill_catalog_append_only();--> statement-breakpoint
CREATE TRIGGER orchestrator_playbook_revisions_append_only BEFORE UPDATE OR DELETE ON orchestrator_playbook_revisions FOR EACH ROW EXECUTE FUNCTION public.orchestrator_skill_catalog_append_only();--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION public.orchestrator_skill_catalog_append_only() FROM PUBLIC, anon, authenticated, service_role;
