CREATE TABLE "orchestrator_interview_kit_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kit_ref" text NOT NULL,
	"revision" integer NOT NULL,
	"previous_hash" text NOT NULL,
	"kit_hash" text NOT NULL,
	"state" text NOT NULL,
	"source_id" uuid NOT NULL,
	"source_snapshot" jsonb NOT NULL,
	"payload" jsonb NOT NULL,
	"created_by_actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orchestrator_interview_kit_revisions_identity" CHECK ("orchestrator_interview_kit_revisions"."kit_ref" ~ '^interview_kit_[a-f0-9]{32}$' and "orchestrator_interview_kit_revisions"."revision" >= 1 and "orchestrator_interview_kit_revisions"."kit_hash" ~ '^[a-f0-9]{64}$' and ("orchestrator_interview_kit_revisions"."revision" = 1 and "orchestrator_interview_kit_revisions"."previous_hash" = 'GENESIS' or "orchestrator_interview_kit_revisions"."revision" > 1 and "orchestrator_interview_kit_revisions"."previous_hash" ~ '^[a-f0-9]{64}$') and "orchestrator_interview_kit_revisions"."state" in ('active', 'archived')),
	CONSTRAINT "orchestrator_interview_kit_revisions_payload" CHECK (jsonb_typeof("orchestrator_interview_kit_revisions"."payload") = 'object' and "orchestrator_interview_kit_revisions"."payload" ?& array['name','explanation','questions','applicability'] and "orchestrator_interview_kit_revisions"."payload" - array['name','explanation','questions','applicability'] = '{}'::jsonb and jsonb_typeof("orchestrator_interview_kit_revisions"."payload"->'questions') = 'array' and jsonb_array_length("orchestrator_interview_kit_revisions"."payload"->'questions') between 1 and 12 and "orchestrator_interview_kit_revisions"."payload"::text !~* '"(policy|rule|scope|approval|execute|meta[_-]?write|persist|publish|action)"[[:space:]]*:'),
	CONSTRAINT "orchestrator_interview_kit_revisions_source_snapshot" CHECK (jsonb_typeof("orchestrator_interview_kit_revisions"."source_snapshot") = 'object' and "orchestrator_interview_kit_revisions"."source_snapshot" ?& array['optionId','title','url','version','recordHash','reviewBy'] and "orchestrator_interview_kit_revisions"."source_snapshot" - array['optionId','title','url','version','recordHash','reviewBy'] = '{}'::jsonb and "orchestrator_interview_kit_revisions"."source_snapshot"->>'recordHash' ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
ALTER TABLE "orchestrator_interview_kit_revisions" ADD CONSTRAINT "orchestrator_interview_kit_revisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orchestrator_interview_kit_revisions" ADD CONSTRAINT "orchestrator_interview_kit_revisions_source_fk" FOREIGN KEY ("workspace_id","source_id") REFERENCES "public"."guidance_sources"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orchestrator_interview_kit_revisions" ADD CONSTRAINT "orchestrator_interview_kit_revisions_membership_fk" FOREIGN KEY ("workspace_id","created_by_actor_id") REFERENCES "public"."memberships"("workspace_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "orchestrator_interview_kit_revisions_workspace_row_unique" ON "orchestrator_interview_kit_revisions" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "orchestrator_interview_kit_revisions_identity_unique" ON "orchestrator_interview_kit_revisions" USING btree ("workspace_id","kit_ref","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "orchestrator_interview_kit_revisions_hash_unique" ON "orchestrator_interview_kit_revisions" USING btree ("workspace_id","kit_hash");--> statement-breakpoint
CREATE INDEX "orchestrator_interview_kit_revisions_current_idx" ON "orchestrator_interview_kit_revisions" USING btree ("workspace_id","kit_ref","revision");
--> statement-breakpoint
ALTER TABLE orchestrator_interview_kit_revisions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE orchestrator_interview_kit_revisions FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE orchestrator_interview_kit_revisions FROM PUBLIC, anon, authenticated, service_role;--> statement-breakpoint
CREATE TRIGGER orchestrator_interview_kit_revisions_append_only BEFORE UPDATE OR DELETE ON orchestrator_interview_kit_revisions FOR EACH ROW EXECUTE FUNCTION public.orchestrator_skill_catalog_append_only();
