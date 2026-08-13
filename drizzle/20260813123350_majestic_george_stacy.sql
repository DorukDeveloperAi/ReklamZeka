CREATE TABLE "orchestrator_conversation_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"conversation_ref" text NOT NULL,
	"turn_ref" text NOT NULL,
	"message_ref" text NOT NULL,
	"message_number" integer NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "orchestrator_conversation_messages_identity" CHECK (
    "orchestrator_conversation_messages"."message_ref" ~ '^message_[a-f0-9]{32}$'
    and "orchestrator_conversation_messages"."message_number" between 1 and 2000000
    and "orchestrator_conversation_messages"."role" in ('user', 'assistant')
    and length("orchestrator_conversation_messages"."content") between 1 and 30000
  )
);
--> statement-breakpoint
CREATE TABLE "orchestrator_conversation_tombstones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"conversation_ref" text NOT NULL,
	"tombstone_ref" text NOT NULL,
	"user_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "orchestrator_conversation_tombstones_identity" CHECK (
    "orchestrator_conversation_tombstones"."tombstone_ref" ~ '^tombstone_[a-f0-9]{32}$'
    and "orchestrator_conversation_tombstones"."reason" = 'operator_requested'
  )
);
--> statement-breakpoint
CREATE TABLE "orchestrator_conversation_turns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"conversation_ref" text NOT NULL,
	"turn_ref" text NOT NULL,
	"turn_number" integer NOT NULL,
	"provider" text NOT NULL,
	"provider_thread_ref" text,
	"outcome" text NOT NULL,
	"failure_code" text,
	"page_guide" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "orchestrator_conversation_turns_identity" CHECK (
    "orchestrator_conversation_turns"."turn_ref" ~ '^turn_[a-f0-9]{32}$'
    and "orchestrator_conversation_turns"."turn_number" between 1 and 1000000
    and "orchestrator_conversation_turns"."provider" = 'codex_cli'
    and ("orchestrator_conversation_turns"."provider_thread_ref" is null or "orchestrator_conversation_turns"."provider_thread_ref" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
  ),
	CONSTRAINT "orchestrator_conversation_turns_outcome" CHECK (
    ("orchestrator_conversation_turns"."outcome" = 'completed' and "orchestrator_conversation_turns"."provider_thread_ref" is not null and "orchestrator_conversation_turns"."failure_code" is null)
    or ("orchestrator_conversation_turns"."outcome" = 'failed' and "orchestrator_conversation_turns"."failure_code" in
      ('adapter_unavailable', 'adapter_timeout', 'adapter_failed', 'invalid_provider_output') and "orchestrator_conversation_turns"."provider_thread_ref" is null)
  ),
	CONSTRAINT "orchestrator_conversation_turns_page_guide" CHECK (
    jsonb_typeof("orchestrator_conversation_turns"."page_guide") = 'object'
    and "orchestrator_conversation_turns"."page_guide" ?& array['version', 'pageId', 'pageLabel', 'purpose', 'codePath', 'recordPath']
    and "orchestrator_conversation_turns"."page_guide" - array['version', 'pageId', 'pageLabel', 'purpose', 'codePath', 'recordPath'] = '{}'::jsonb
    and "orchestrator_conversation_turns"."page_guide" #>> '{version}' = 'orchestrator-page-guide/1.0.0'
  )
);
--> statement-breakpoint
CREATE TABLE "orchestrator_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"conversation_ref" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "orchestrator_conversations_identity" CHECK (
    "orchestrator_conversations"."conversation_ref" ~ '^conversation_[a-f0-9]{32}$'
  )
);
--> statement-breakpoint
-- Composite foreign keys require their referenced unique indexes first.
CREATE UNIQUE INDEX "orchestrator_conversation_turns_workspace_conversation_ref_unique" ON "orchestrator_conversation_turns" USING btree ("workspace_id","conversation_ref","turn_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "orchestrator_conversations_workspace_ref_unique" ON "orchestrator_conversations" USING btree ("workspace_id","conversation_ref");--> statement-breakpoint
ALTER TABLE "orchestrator_conversation_messages" ADD CONSTRAINT "orchestrator_conversation_messages_workspace_turn_fk" FOREIGN KEY ("workspace_id","conversation_ref","turn_ref") REFERENCES "public"."orchestrator_conversation_turns"("workspace_id","conversation_ref","turn_ref") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orchestrator_conversation_tombstones" ADD CONSTRAINT "orchestrator_conversation_tombstones_workspace_conversation_fk" FOREIGN KEY ("workspace_id","conversation_ref") REFERENCES "public"."orchestrator_conversations"("workspace_id","conversation_ref") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orchestrator_conversation_tombstones" ADD CONSTRAINT "orchestrator_conversation_tombstones_workspace_membership_fk" FOREIGN KEY ("workspace_id","user_id") REFERENCES "public"."memberships"("workspace_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orchestrator_conversation_turns" ADD CONSTRAINT "orchestrator_conversation_turns_workspace_conversation_fk" FOREIGN KEY ("workspace_id","conversation_ref") REFERENCES "public"."orchestrator_conversations"("workspace_id","conversation_ref") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orchestrator_conversations" ADD CONSTRAINT "orchestrator_conversations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "orchestrator_conversations" ADD CONSTRAINT "orchestrator_conversations_workspace_membership_fk" FOREIGN KEY ("workspace_id","user_id") REFERENCES "public"."memberships"("workspace_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "orchestrator_conversation_messages_workspace_id_unique" ON "orchestrator_conversation_messages" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "orchestrator_conversation_messages_workspace_ref_unique" ON "orchestrator_conversation_messages" USING btree ("workspace_id","message_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "orchestrator_conversation_messages_sequence_unique" ON "orchestrator_conversation_messages" USING btree ("workspace_id","conversation_ref","message_number");--> statement-breakpoint
CREATE INDEX "orchestrator_conversation_messages_turn_idx" ON "orchestrator_conversation_messages" USING btree ("workspace_id","turn_ref","message_number");--> statement-breakpoint
CREATE UNIQUE INDEX "orchestrator_conversation_tombstones_workspace_id_unique" ON "orchestrator_conversation_tombstones" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "orchestrator_conversation_tombstones_workspace_ref_unique" ON "orchestrator_conversation_tombstones" USING btree ("workspace_id","tombstone_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "orchestrator_conversation_tombstones_conversation_unique" ON "orchestrator_conversation_tombstones" USING btree ("workspace_id","conversation_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "orchestrator_conversation_turns_workspace_id_unique" ON "orchestrator_conversation_turns" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "orchestrator_conversation_turns_workspace_ref_unique" ON "orchestrator_conversation_turns" USING btree ("workspace_id","turn_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "orchestrator_conversation_turns_sequence_unique" ON "orchestrator_conversation_turns" USING btree ("workspace_id","conversation_ref","turn_number");--> statement-breakpoint
CREATE INDEX "orchestrator_conversation_turns_timeline_idx" ON "orchestrator_conversation_turns" USING btree ("workspace_id","conversation_ref","turn_number");--> statement-breakpoint
CREATE UNIQUE INDEX "orchestrator_conversations_workspace_id_unique" ON "orchestrator_conversations" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE INDEX "orchestrator_conversations_operator_idx" ON "orchestrator_conversations" USING btree ("workspace_id","user_id","created_at");--> statement-breakpoint

ALTER TABLE orchestrator_conversations ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE orchestrator_conversations FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE orchestrator_conversation_turns ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE orchestrator_conversation_turns FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE orchestrator_conversation_messages ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE orchestrator_conversation_messages FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE orchestrator_conversation_tombstones ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE orchestrator_conversation_tombstones FORCE ROW LEVEL SECURITY;--> statement-breakpoint

REVOKE ALL PRIVILEGES ON TABLE orchestrator_conversations FROM PUBLIC, anon, authenticated, service_role;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE orchestrator_conversation_turns FROM PUBLIC, anon, authenticated, service_role;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE orchestrator_conversation_messages FROM PUBLIC, anon, authenticated, service_role;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE orchestrator_conversation_tombstones FROM PUBLIC, anon, authenticated, service_role;--> statement-breakpoint

CREATE FUNCTION public.orchestrator_conversation_immutable() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' AND EXISTS (
    SELECT 1 FROM public.workspaces
    WHERE id = OLD.workspace_id AND lifecycle_state = 'tombstoning'
  ) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'orchestrator conversation ledger is append-only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER orchestrator_conversations_immutable BEFORE UPDATE OR DELETE ON orchestrator_conversations
FOR EACH ROW EXECUTE FUNCTION public.orchestrator_conversation_immutable();--> statement-breakpoint
CREATE TRIGGER orchestrator_conversation_turns_immutable BEFORE UPDATE OR DELETE ON orchestrator_conversation_turns
FOR EACH ROW EXECUTE FUNCTION public.orchestrator_conversation_immutable();--> statement-breakpoint
CREATE TRIGGER orchestrator_conversation_messages_immutable BEFORE UPDATE OR DELETE ON orchestrator_conversation_messages
FOR EACH ROW EXECUTE FUNCTION public.orchestrator_conversation_immutable();--> statement-breakpoint
CREATE TRIGGER orchestrator_conversation_tombstones_immutable BEFORE UPDATE OR DELETE ON orchestrator_conversation_tombstones
FOR EACH ROW EXECUTE FUNCTION public.orchestrator_conversation_immutable();--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION public.orchestrator_conversation_immutable() FROM PUBLIC, anon, authenticated, service_role;
