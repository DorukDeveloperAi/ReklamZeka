CREATE TABLE "local_agent_handoffs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"handoff_ref" text NOT NULL,
	"workspace_ref" text NOT NULL,
	"creator_session_ref" text NOT NULL,
	"target_session_ref" text NOT NULL,
	"intent" text NOT NULL,
	"entity_ref" text NOT NULL,
	"timeframe_ref" text NOT NULL,
	"context_ref" text NOT NULL,
	"context_version" integer NOT NULL,
	"template_ref" text,
	"correlation_ref" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	CONSTRAINT "local_agent_handoffs_identity" CHECK (
    "local_agent_handoffs"."handoff_ref" ~ '^handoff_[a-f0-9]{32}$'
    and "local_agent_handoffs"."workspace_ref" ~ '^workspace_[a-z0-9][a-z0-9_.:-]{0,86}$'
    and "local_agent_handoffs"."creator_session_ref" ~ '^session_[a-f0-9]{32}$'
    and "local_agent_handoffs"."target_session_ref" ~ '^session_[a-f0-9]{32}$'
    and "local_agent_handoffs"."correlation_ref" ~ '^correlation_[a-f0-9]{32}$'
  ),
	CONSTRAINT "local_agent_handoffs_context" CHECK (
    "local_agent_handoffs"."intent" in ('analysis', 'existing_post_promotion')
    and "local_agent_handoffs"."context_version" between 1 and 1000000
    and "local_agent_handoffs"."entity_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,94}$'
    and "local_agent_handoffs"."timeframe_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,94}$'
    and "local_agent_handoffs"."context_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,94}$'
    and ("local_agent_handoffs"."template_ref" is null or "local_agent_handoffs"."template_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,94}$')
    and ("local_agent_handoffs"."entity_ref" || ' ' || "local_agent_handoffs"."timeframe_ref" || ' ' || "local_agent_handoffs"."context_ref" || ' ' || coalesce("local_agent_handoffs"."template_ref", ''))
      !~* '(token|secret|prompt|raw|hash|sql|uuid|grant|approve|execute|human)'
    and (("local_agent_handoffs"."intent" = 'analysis' and "local_agent_handoffs"."template_ref" is null)
      or ("local_agent_handoffs"."intent" = 'existing_post_promotion' and "local_agent_handoffs"."template_ref" is not null))
  ),
	CONSTRAINT "local_agent_handoffs_time" CHECK (
    "local_agent_handoffs"."expires_at" >= "local_agent_handoffs"."created_at" + interval '15 seconds'
    and "local_agent_handoffs"."expires_at" <= "local_agent_handoffs"."created_at" + interval '120 seconds'
    and ("local_agent_handoffs"."consumed_at" is null or ("local_agent_handoffs"."consumed_at" >= "local_agent_handoffs"."created_at" and "local_agent_handoffs"."consumed_at" < "local_agent_handoffs"."expires_at"))
  )
);
--> statement-breakpoint
CREATE TABLE "local_agent_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"session_ref" text NOT NULL,
	"workspace_ref" text NOT NULL,
	"user_id" uuid NOT NULL,
	"client_ref" text NOT NULL,
	"transport" text NOT NULL,
	"tool_catalog_version" text NOT NULL,
	"allowed_tools" jsonb NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "local_agent_sessions_identity" CHECK (
    "local_agent_sessions"."session_ref" ~ '^session_[a-f0-9]{32}$'
    and "local_agent_sessions"."workspace_ref" ~ '^workspace_[a-z0-9][a-z0-9_.:-]{0,86}$'
    and "local_agent_sessions"."client_ref" ~ '^client_[a-z0-9][a-z0-9_-]{0,86}$'
    and "local_agent_sessions"."transport" in ('deterministic_fixture', 'project_stdio', 'loopback_http')
    and "local_agent_sessions"."tool_catalog_version" = 'local-agent-tools/1.0.0'
  ),
	CONSTRAINT "local_agent_sessions_tools" CHECK (
    jsonb_typeof("local_agent_sessions"."allowed_tools") = 'array'
    and jsonb_array_length("local_agent_sessions"."allowed_tools") between 1 and 10
    and "local_agent_sessions"."allowed_tools" <@ '[
      "decision_room_list", "decision_room_mark_inbox_read", "policy_bundle_read",
      "budget_lab_list", "budget_lab_get", "budget_lab_dry_run", "budget_lab_save_draft",
      "practice_lab_list", "practice_lab_get", "practice_lab_prepare_draft"
    ]'::jsonb
  ),
	CONSTRAINT "local_agent_sessions_time" CHECK (
    "local_agent_sessions"."last_seen_at" >= "local_agent_sessions"."started_at"
    and "local_agent_sessions"."expires_at" > "local_agent_sessions"."started_at"
    and "local_agent_sessions"."expires_at" <= "local_agent_sessions"."started_at" + interval '8 hours'
  )
);
--> statement-breakpoint
ALTER TABLE "local_agent_handoffs" ADD CONSTRAINT "local_agent_handoffs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "local_agent_handoffs" ADD CONSTRAINT "local_agent_handoffs_workspace_creator_session_fk" FOREIGN KEY ("workspace_id","creator_session_ref") REFERENCES "public"."local_agent_sessions"("workspace_id","session_ref") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "local_agent_handoffs" ADD CONSTRAINT "local_agent_handoffs_workspace_target_session_fk" FOREIGN KEY ("workspace_id","target_session_ref") REFERENCES "public"."local_agent_sessions"("workspace_id","session_ref") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "local_agent_sessions" ADD CONSTRAINT "local_agent_sessions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "local_agent_sessions" ADD CONSTRAINT "local_agent_sessions_workspace_membership_fk" FOREIGN KEY ("workspace_id","user_id") REFERENCES "public"."memberships"("workspace_id","user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "local_agent_handoffs_workspace_id_unique" ON "local_agent_handoffs" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "local_agent_handoffs_workspace_ref_unique" ON "local_agent_handoffs" USING btree ("workspace_id","handoff_ref");--> statement-breakpoint
CREATE INDEX "local_agent_handoffs_creator_idx" ON "local_agent_handoffs" USING btree ("workspace_id","creator_session_ref");--> statement-breakpoint
CREATE INDEX "local_agent_handoffs_target_idx" ON "local_agent_handoffs" USING btree ("workspace_id","target_session_ref","expires_at");--> statement-breakpoint
CREATE INDEX "local_agent_handoffs_expiry_idx" ON "local_agent_handoffs" USING btree ("workspace_id","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "local_agent_sessions_workspace_id_unique" ON "local_agent_sessions" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "local_agent_sessions_workspace_session_unique" ON "local_agent_sessions" USING btree ("workspace_id","session_ref");--> statement-breakpoint
CREATE INDEX "local_agent_sessions_workspace_expiry_idx" ON "local_agent_sessions" USING btree ("workspace_id","expires_at");--> statement-breakpoint

ALTER TABLE local_agent_sessions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE local_agent_sessions FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE local_agent_handoffs ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE local_agent_handoffs FORCE ROW LEVEL SECURITY;--> statement-breakpoint

REVOKE ALL PRIVILEGES ON TABLE local_agent_sessions FROM PUBLIC, anon, authenticated, service_role;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE local_agent_handoffs FROM PUBLIC, anon, authenticated, service_role;
