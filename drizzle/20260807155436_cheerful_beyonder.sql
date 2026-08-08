CREATE TABLE "analysis_template_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"context_id" uuid NOT NULL,
	"timeframe_definition_id" uuid NOT NULL,
	"account_ref" text NOT NULL,
	"campaign_ref" text NOT NULL,
	"template_ref" text NOT NULL,
	"revision" integer NOT NULL,
	"definition_version" text NOT NULL,
	"definition_hash" text NOT NULL,
	"timeframe_ref" text NOT NULL,
	"timeframe_definition_hash" text NOT NULL,
	"context_hash" text NOT NULL,
	"definition_payload" jsonb NOT NULL,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analysis_template_definitions_shape" CHECK ((
    "analysis_template_definitions"."template_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_-]{0,94}$'
    and "analysis_template_definitions"."timeframe_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_-]{0,94}$'
    and "analysis_template_definitions"."revision" >= 1
    and "analysis_template_definitions"."definition_version" = 'analysis-template-definition/1.0.0'
    and "analysis_template_definitions"."definition_hash" ~ '^[a-f0-9]{64}$'
    and "analysis_template_definitions"."timeframe_definition_hash" ~ '^[a-f0-9]{64}$'
    and "analysis_template_definitions"."context_hash" ~ '^[a-f0-9]{64}$'
    and jsonb_typeof("analysis_template_definitions"."definition_payload") = 'object'
    and "analysis_template_definitions"."definition_payload" #>> '{version}' = "analysis_template_definitions"."definition_version"
    and "analysis_template_definitions"."definition_payload" #>> '{templateRef}' = "analysis_template_definitions"."template_ref"
    and ("analysis_template_definitions"."definition_payload" #>> '{revision}')::integer = "analysis_template_definitions"."revision"
    and "analysis_template_definitions"."definition_payload" #>> '{timeframeRef}' = "analysis_template_definitions"."timeframe_ref"
    and "analysis_template_definitions"."definition_payload" #>> '{timeframeDefinitionHash}' = "analysis_template_definitions"."timeframe_definition_hash"
    and "analysis_template_definitions"."definition_payload" #>> '{contextHash}' = "analysis_template_definitions"."context_hash"
  ) is true),
	CONSTRAINT "analysis_template_definitions_no_forbidden_material" CHECK (
    "analysis_template_definitions"."definition_payload"::text !~* '"[^"[:space:]]*(token|secret|prompt)"[[:space:]]*:'
    and "analysis_template_definitions"."definition_payload"::text !~* '"authorization"[[:space:]]*:'
    and "analysis_template_definitions"."definition_payload"::text !~* '"[^"[:space:]]*raw[_-]?(payload|request|response|json)"[[:space:]]*:'
  )
);
--> statement-breakpoint
CREATE TABLE "analysis_timeframe_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"timeframe_ref" text NOT NULL,
	"revision" integer NOT NULL,
	"definition_version" text NOT NULL,
	"definition_hash" text NOT NULL,
	"definition_payload" jsonb NOT NULL,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analysis_timeframe_definitions_shape" CHECK ((
    "analysis_timeframe_definitions"."timeframe_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_-]{0,94}$'
    and "analysis_timeframe_definitions"."revision" >= 1
    and "analysis_timeframe_definitions"."definition_version" = 'analysis-timeframe-definition/1.0.0'
    and "analysis_timeframe_definitions"."definition_hash" ~ '^[a-f0-9]{64}$'
    and jsonb_typeof("analysis_timeframe_definitions"."definition_payload") = 'object'
    and "analysis_timeframe_definitions"."definition_payload" #>> '{version}' = "analysis_timeframe_definitions"."definition_version"
    and "analysis_timeframe_definitions"."definition_payload" #>> '{timeframeRef}' = "analysis_timeframe_definitions"."timeframe_ref"
    and ("analysis_timeframe_definitions"."definition_payload" #>> '{revision}')::integer = "analysis_timeframe_definitions"."revision"
  ) is true),
	CONSTRAINT "analysis_timeframe_definitions_no_forbidden_material" CHECK (
    "analysis_timeframe_definitions"."definition_payload"::text !~* '"[^"[:space:]]*(token|secret|prompt)"[[:space:]]*:'
    and "analysis_timeframe_definitions"."definition_payload"::text !~* '"authorization"[[:space:]]*:'
    and "analysis_timeframe_definitions"."definition_payload"::text !~* '"[^"[:space:]]*raw[_-]?(payload|request|response|json)"[[:space:]]*:'
  )
);
--> statement-breakpoint
CREATE TABLE "decision_room_run_analysis_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"run_id" uuid NOT NULL,
	"template_definition_id" uuid NOT NULL,
	"timeframe_definition_id" uuid NOT NULL,
	"context_id" uuid NOT NULL,
	"asset_hash" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"resolved_timeframe" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decision_room_run_analysis_assets_shape" CHECK ((
    "decision_room_run_analysis_assets"."asset_hash" ~ '^[a-f0-9]{64}$'
    and jsonb_typeof("decision_room_run_analysis_assets"."resolved_timeframe") = 'object'
    and "decision_room_run_analysis_assets"."resolved_timeframe" #>> '{resolverVersion}' = 'analysis-timeframe-resolver/1.0.0'
  ) is true)
);
--> statement-breakpoint
CREATE TABLE "decision_room_schedule_analysis_bindings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"schedule_id" uuid NOT NULL,
	"template_definition_id" uuid NOT NULL,
	"timeframe_definition_id" uuid NOT NULL,
	"binding_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decision_room_schedule_analysis_bindings_hash_format" CHECK ("decision_room_schedule_analysis_bindings"."binding_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_template_definitions_workspace_row_unique" ON "analysis_template_definitions" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_timeframe_definitions_workspace_row_unique" ON "analysis_timeframe_definitions" USING btree ("workspace_id","id");--> statement-breakpoint
ALTER TABLE "analysis_template_definitions" ADD CONSTRAINT "analysis_template_definitions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_template_definitions" ADD CONSTRAINT "analysis_template_definitions_account_scope_fk" FOREIGN KEY ("workspace_id","ad_account_id") REFERENCES "public"."ad_accounts"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_template_definitions" ADD CONSTRAINT "analysis_template_definitions_campaign_scope_fk" FOREIGN KEY ("workspace_id","campaign_id") REFERENCES "public"."ad_campaigns"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_template_definitions" ADD CONSTRAINT "analysis_template_definitions_context_scope_fk" FOREIGN KEY ("workspace_id","context_id") REFERENCES "public"."effective_campaign_contexts"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_template_definitions" ADD CONSTRAINT "analysis_template_definitions_timeframe_scope_fk" FOREIGN KEY ("workspace_id","timeframe_definition_id") REFERENCES "public"."analysis_timeframe_definitions"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_timeframe_definitions" ADD CONSTRAINT "analysis_timeframe_definitions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_room_run_analysis_assets" ADD CONSTRAINT "decision_room_run_analysis_assets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_room_run_analysis_assets" ADD CONSTRAINT "decision_room_run_analysis_assets_run_scope_fk" FOREIGN KEY ("workspace_id","run_id") REFERENCES "public"."decision_room_runs"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_room_run_analysis_assets" ADD CONSTRAINT "decision_room_run_analysis_assets_template_scope_fk" FOREIGN KEY ("workspace_id","template_definition_id") REFERENCES "public"."analysis_template_definitions"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_room_run_analysis_assets" ADD CONSTRAINT "decision_room_run_analysis_assets_timeframe_scope_fk" FOREIGN KEY ("workspace_id","timeframe_definition_id") REFERENCES "public"."analysis_timeframe_definitions"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_room_run_analysis_assets" ADD CONSTRAINT "decision_room_run_analysis_assets_context_scope_fk" FOREIGN KEY ("workspace_id","context_id") REFERENCES "public"."effective_campaign_contexts"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_room_schedule_analysis_bindings" ADD CONSTRAINT "decision_room_schedule_analysis_bindings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_room_schedule_analysis_bindings" ADD CONSTRAINT "decision_room_schedule_analysis_bindings_schedule_scope_fk" FOREIGN KEY ("workspace_id","schedule_id") REFERENCES "public"."decision_room_schedules"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_room_schedule_analysis_bindings" ADD CONSTRAINT "decision_room_schedule_analysis_bindings_template_scope_fk" FOREIGN KEY ("workspace_id","template_definition_id") REFERENCES "public"."analysis_template_definitions"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_room_schedule_analysis_bindings" ADD CONSTRAINT "decision_room_schedule_analysis_bindings_timeframe_scope_fk" FOREIGN KEY ("workspace_id","timeframe_definition_id") REFERENCES "public"."analysis_timeframe_definitions"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_template_definitions_workspace_ref_revision_unique" ON "analysis_template_definitions" USING btree ("workspace_id","template_ref","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_template_definitions_workspace_ref_hash_unique" ON "analysis_template_definitions" USING btree ("workspace_id","template_ref","definition_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_template_definitions_workspace_current_unique" ON "analysis_template_definitions" USING btree ("workspace_id","template_ref") WHERE "analysis_template_definitions"."superseded_at" is null;--> statement-breakpoint
CREATE INDEX "analysis_template_definitions_workspace_asset_idx" ON "analysis_template_definitions" USING btree ("workspace_id","ad_account_id","campaign_id","template_ref");--> statement-breakpoint
CREATE INDEX "analysis_template_definitions_context_idx" ON "analysis_template_definitions" USING btree ("context_id");--> statement-breakpoint
CREATE INDEX "analysis_template_definitions_timeframe_idx" ON "analysis_template_definitions" USING btree ("timeframe_definition_id");--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_timeframe_definitions_workspace_ref_revision_unique" ON "analysis_timeframe_definitions" USING btree ("workspace_id","timeframe_ref","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_timeframe_definitions_workspace_ref_hash_unique" ON "analysis_timeframe_definitions" USING btree ("workspace_id","timeframe_ref","definition_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "analysis_timeframe_definitions_workspace_current_unique" ON "analysis_timeframe_definitions" USING btree ("workspace_id","timeframe_ref") WHERE "analysis_timeframe_definitions"."superseded_at" is null;--> statement-breakpoint
CREATE INDEX "analysis_timeframe_definitions_workspace_lookup_idx" ON "analysis_timeframe_definitions" USING btree ("workspace_id","timeframe_ref","superseded_at");--> statement-breakpoint
CREATE UNIQUE INDEX "decision_room_run_analysis_assets_run_unique" ON "decision_room_run_analysis_assets" USING btree ("workspace_id","run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "decision_room_run_analysis_assets_hash_unique" ON "decision_room_run_analysis_assets" USING btree ("workspace_id","asset_hash");--> statement-breakpoint
CREATE INDEX "decision_room_run_analysis_assets_template_idx" ON "decision_room_run_analysis_assets" USING btree ("template_definition_id");--> statement-breakpoint
CREATE INDEX "decision_room_run_analysis_assets_timeframe_idx" ON "decision_room_run_analysis_assets" USING btree ("timeframe_definition_id");--> statement-breakpoint
CREATE INDEX "decision_room_run_analysis_assets_context_idx" ON "decision_room_run_analysis_assets" USING btree ("context_id");--> statement-breakpoint
CREATE UNIQUE INDEX "decision_room_schedule_analysis_bindings_schedule_unique" ON "decision_room_schedule_analysis_bindings" USING btree ("workspace_id","schedule_id");--> statement-breakpoint
CREATE UNIQUE INDEX "decision_room_schedule_analysis_bindings_hash_unique" ON "decision_room_schedule_analysis_bindings" USING btree ("workspace_id","binding_hash");--> statement-breakpoint
CREATE INDEX "decision_room_schedule_analysis_bindings_template_idx" ON "decision_room_schedule_analysis_bindings" USING btree ("template_definition_id");--> statement-breakpoint
CREATE INDEX "decision_room_schedule_analysis_bindings_timeframe_idx" ON "decision_room_schedule_analysis_bindings" USING btree ("timeframe_definition_id");
--> statement-breakpoint
ALTER TABLE "analysis_template_definitions" ADD CONSTRAINT "analysis_template_definitions_no_authority_escalation" CHECK (
    not jsonb_path_exists(
      "analysis_template_definitions"."definition_payload",
      '$.** ? (@.type() == "object").keyvalue() ? (@.key like_regex "^(canwrite|writeenabled|actionauthority|writeauthority|executionauthority|approvalgranted|canauthorizeaction|canexecutewrite|canenforcepolicy|canalterapproval)$" flag "i")'
    )
  );--> statement-breakpoint
CREATE FUNCTION analysis_definition_revision_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF (to_jsonb(NEW) - 'superseded_at') <> (to_jsonb(OLD) - 'superseded_at')
     OR OLD.superseded_at IS NOT NULL OR NEW.superseded_at IS NULL THEN
    RAISE EXCEPTION 'analysis_definition_revision_immutable';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE FUNCTION decision_room_analysis_binding_immutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'decision_room_analysis_binding_immutable';
END;
$$;--> statement-breakpoint
CREATE TRIGGER analysis_timeframe_definitions_immutable_trigger
BEFORE UPDATE ON analysis_timeframe_definitions
FOR EACH ROW EXECUTE FUNCTION analysis_definition_revision_immutable();--> statement-breakpoint
CREATE TRIGGER analysis_template_definitions_immutable_trigger
BEFORE UPDATE ON analysis_template_definitions
FOR EACH ROW EXECUTE FUNCTION analysis_definition_revision_immutable();--> statement-breakpoint
CREATE TRIGGER decision_room_schedule_analysis_bindings_immutable_trigger
BEFORE UPDATE ON decision_room_schedule_analysis_bindings
FOR EACH ROW EXECUTE FUNCTION decision_room_analysis_binding_immutable();--> statement-breakpoint
CREATE TRIGGER decision_room_run_analysis_assets_immutable_trigger
BEFORE UPDATE ON decision_room_run_analysis_assets
FOR EACH ROW EXECUTE FUNCTION decision_room_analysis_binding_immutable();--> statement-breakpoint
ALTER TABLE analysis_timeframe_definitions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE analysis_template_definitions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE decision_room_schedule_analysis_bindings ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE decision_room_run_analysis_assets ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE analysis_timeframe_definitions FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE analysis_template_definitions FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE decision_room_schedule_analysis_bindings FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE decision_room_run_analysis_assets FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION analysis_definition_revision_immutable() FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION decision_room_analysis_binding_immutable() FROM PUBLIC, anon, authenticated;
