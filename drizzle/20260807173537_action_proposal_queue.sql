CREATE TABLE "action_approval_policy_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"policy_ref" text NOT NULL,
	"revision" integer NOT NULL,
	"schema_version" text NOT NULL,
	"policy_hash" text NOT NULL,
	"policy_payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "action_approval_policy_snapshots_revision_positive" CHECK ("action_approval_policy_snapshots"."revision" >= 1),
	CONSTRAINT "action_approval_policy_snapshots_hash_format" CHECK ("action_approval_policy_snapshots"."policy_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "action_approval_policy_snapshots_identity" CHECK (
    "action_approval_policy_snapshots"."schema_version" = 'action-approval-policy/1.0.0'
    and "action_approval_policy_snapshots"."policy_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
  ),
	CONSTRAINT "action_approval_policy_snapshots_payload_exact" CHECK (
    jsonb_typeof("action_approval_policy_snapshots"."policy_payload") = 'object'
    and "action_approval_policy_snapshots"."policy_payload" #>> '{version}' = "action_approval_policy_snapshots"."schema_version"
    and "action_approval_policy_snapshots"."policy_payload" #>> '{policyRef}' = "action_approval_policy_snapshots"."policy_ref"
    and ("action_approval_policy_snapshots"."policy_payload" #>> '{revision}')::integer = "action_approval_policy_snapshots"."revision"
    and "action_approval_policy_snapshots"."policy_payload" #>> '{policyHash}' = "action_approval_policy_snapshots"."policy_hash"
    and "action_approval_policy_snapshots"."policy_payload" #>> '{autonomyMode}' = 'approval_only'
  ),
	CONSTRAINT "action_approval_policy_snapshots_no_authority" CHECK (
    not jsonb_path_exists("action_approval_policy_snapshots"."policy_payload", '$.** ? (@.type() == "object").keyvalue() ? (@.key like_regex "^(actionauthority|executionauthority|writeauthority|writeenabled|canexecute|canwrite|approvalgranted|grant|authorization)$" flag "i")')
  ),
	CONSTRAINT "action_approval_policy_snapshots_no_forbidden_material" CHECK (
    "action_approval_policy_snapshots"."policy_payload"::text !~* '"[^"[:space:]]*(token|secret|prompt)"[[:space:]]*:'
    and "action_approval_policy_snapshots"."policy_payload"::text !~* '"authorization"[[:space:]]*:'
    and "action_approval_policy_snapshots"."policy_payload"::text !~* '"[^"[:space:]]*raw[_-]?(payload|request|response|json)"[[:space:]]*:'
  )
);
--> statement-breakpoint
CREATE TABLE "action_proposal_bundles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"policy_snapshot_id" uuid NOT NULL,
	"workspace_ref" text NOT NULL,
	"bundle_ref" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"staging_version" text NOT NULL,
	"staging_hash" text NOT NULL,
	"schema_version" text NOT NULL,
	"bundle_hash" text NOT NULL,
	"plan_ref" text NOT NULL,
	"plan_revision" integer NOT NULL,
	"plan_hash" text NOT NULL,
	"trace_hash" text NOT NULL,
	"lifecycle_hash" text NOT NULL,
	"bundle_payload" jsonb NOT NULL,
	"initialized_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "action_proposal_bundles_plan_revision_positive" CHECK ("action_proposal_bundles"."plan_revision" >= 1),
	CONSTRAINT "action_proposal_bundles_identity" CHECK (
    "action_proposal_bundles"."staging_version" = 'action-proposal-staging/1.0.0'
    and "action_proposal_bundles"."schema_version" = 'action-bundle/1.0.0'
    and "action_proposal_bundles"."workspace_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and "action_proposal_bundles"."bundle_ref" ~ '^action_bundle_[a-f0-9]{20}$'
    and "action_proposal_bundles"."plan_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
  ),
	CONSTRAINT "action_proposal_bundles_hash_formats" CHECK (
    "action_proposal_bundles"."bundle_hash" ~ '^[a-f0-9]{64}$'
    and "action_proposal_bundles"."plan_hash" ~ '^[a-f0-9]{64}$'
    and "action_proposal_bundles"."trace_hash" ~ '^[a-f0-9]{64}$'
    and "action_proposal_bundles"."lifecycle_hash" ~ '^[a-f0-9]{64}$'
    and "action_proposal_bundles"."idempotency_key" ~ '^[a-f0-9]{64}$'
    and "action_proposal_bundles"."staging_hash" ~ '^[a-f0-9]{64}$'
  ),
	CONSTRAINT "action_proposal_bundles_payload_exact" CHECK (
    jsonb_typeof("action_proposal_bundles"."bundle_payload") = 'object'
    and "action_proposal_bundles"."bundle_payload" #>> '{version}' = "action_proposal_bundles"."schema_version"
    and "action_proposal_bundles"."bundle_payload" #>> '{bundleRef}' = "action_proposal_bundles"."bundle_ref"
    and "action_proposal_bundles"."bundle_payload" #>> '{bundleHash}' = "action_proposal_bundles"."bundle_hash"
    and "action_proposal_bundles"."bundle_payload" #>> '{plan,planRef}' = "action_proposal_bundles"."plan_ref"
    and ("action_proposal_bundles"."bundle_payload" #>> '{plan,revision}')::integer = "action_proposal_bundles"."plan_revision"
    and "action_proposal_bundles"."bundle_payload" #>> '{plan,planHash}' = "action_proposal_bundles"."plan_hash"
    and jsonb_typeof("action_proposal_bundles"."bundle_payload" #> '{units}') = 'array'
    and jsonb_array_length("action_proposal_bundles"."bundle_payload" #> '{units}') >= 1
  ),
	CONSTRAINT "action_proposal_bundles_no_authority" CHECK (
    not jsonb_path_exists("action_proposal_bundles"."bundle_payload", '$.** ? (@.type() == "object").keyvalue() ? (@.key like_regex "^(actionauthority|executionauthority|writeauthority|writeenabled|canexecute|canwrite|approvalgranted|grant|authorization)$" flag "i")')
  ),
	CONSTRAINT "action_proposal_bundles_no_forbidden_material" CHECK (
    "action_proposal_bundles"."bundle_payload"::text !~* '"[^"[:space:]]*(token|secret|prompt)"[[:space:]]*:'
    and "action_proposal_bundles"."bundle_payload"::text !~* '"authorization"[[:space:]]*:'
    and "action_proposal_bundles"."bundle_payload"::text !~* '"[^"[:space:]]*raw[_-]?(payload|request|response|json)"[[:space:]]*:'
  )
);
--> statement-breakpoint
CREATE TABLE "action_proposal_dependencies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"bundle_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"dependency_unit_id" uuid NOT NULL,
	"unit_ref" text NOT NULL,
	"dependency_unit_ref" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "action_proposal_dependencies_identity" CHECK (
    "action_proposal_dependencies"."unit_ref" ~ '^action_unit_[a-f0-9]{20}$'
    and "action_proposal_dependencies"."dependency_unit_ref" ~ '^action_unit_[a-f0-9]{20}$'
    and "action_proposal_dependencies"."unit_ref" <> "action_proposal_dependencies"."dependency_unit_ref"
  )
);
--> statement-breakpoint
CREATE TABLE "action_proposal_initial_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"bundle_id" uuid NOT NULL,
	"event_ref" text NOT NULL,
	"sequence" integer NOT NULL,
	"previous_hash" text NOT NULL,
	"event_hash" text NOT NULL,
	"event_type" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"reason_code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "action_proposal_initial_events_shape" CHECK (
    "action_proposal_initial_events"."sequence" = 1
    and "action_proposal_initial_events"."previous_hash" = '0000000000000000000000000000000000000000000000000000000000000000'
    and "action_proposal_initial_events"."event_type" = 'lifecycle_initialized'
    and "action_proposal_initial_events"."event_hash" ~ '^[a-f0-9]{64}$'
  ),
	CONSTRAINT "action_proposal_initial_events_identity" CHECK (
    "action_proposal_initial_events"."event_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and "action_proposal_initial_events"."reason_code" ~ '^[a-z][a-z0-9_.:-]{0,127}$'
  )
);
--> statement-breakpoint
CREATE TABLE "action_proposal_units" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"bundle_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"unit_ref" text NOT NULL,
	"unit_hash" text NOT NULL,
	"scope_hash" text NOT NULL,
	"account_ref" text NOT NULL,
	"entity_ref" text NOT NULL,
	"action_type" text NOT NULL,
	"risk" text NOT NULL,
	"source_hash" text NOT NULL,
	"context_hash" text NOT NULL,
	"spec_hash" text NOT NULL,
	"action_plan_hash" text NOT NULL,
	"action_hash" text NOT NULL,
	"summary_hash" text NOT NULL,
	"requester_ref" text NOT NULL,
	"requester_role" text NOT NULL,
	"proposed_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"initial_state" text NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"campaign_id" uuid,
	"ad_set_id" uuid,
	"ad_id" uuid,
	"unit_payload" jsonb NOT NULL,
	"action_plan_payload" jsonb NOT NULL,
	"summary_payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "action_proposal_units_ordinal_positive" CHECK ("action_proposal_units"."ordinal" >= 1),
	CONSTRAINT "action_proposal_units_initial_state" CHECK ("action_proposal_units"."initial_state" = 'awaiting_approval'),
	CONSTRAINT "action_proposal_units_risk" CHECK ("action_proposal_units"."risk" in ('K0', 'K1', 'K2', 'K3', 'K4')),
	CONSTRAINT "action_proposal_units_identity" CHECK (
    "action_proposal_units"."unit_ref" ~ '^action_unit_[a-f0-9]{20}$'
    and "action_proposal_units"."account_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and "action_proposal_units"."entity_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and "action_proposal_units"."requester_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and "action_proposal_units"."requester_role" in ('owner', 'admin', 'operator', 'analyst')
    and "action_proposal_units"."action_type" in ('internal_annotation', 'status_pause', 'status_activate', 'budget_decrease', 'budget_increase', 'existing_post_promotion')
  ),
	CONSTRAINT "action_proposal_units_hash_formats" CHECK (
    "action_proposal_units"."unit_hash" ~ '^[a-f0-9]{64}$'
    and "action_proposal_units"."scope_hash" ~ '^[a-f0-9]{64}$'
    and "action_proposal_units"."source_hash" ~ '^[a-f0-9]{64}$'
    and "action_proposal_units"."context_hash" ~ '^[a-f0-9]{64}$'
    and "action_proposal_units"."spec_hash" ~ '^[a-f0-9]{64}$'
    and "action_proposal_units"."action_plan_hash" ~ '^[a-f0-9]{64}$'
    and "action_proposal_units"."action_hash" ~ '^[a-f0-9]{64}$'
    and "action_proposal_units"."summary_hash" ~ '^[a-f0-9]{64}$'
  ),
	CONSTRAINT "action_proposal_units_authentic_entity_single" CHECK (
    num_nonnulls("action_proposal_units"."campaign_id", "action_proposal_units"."ad_set_id", "action_proposal_units"."ad_id") = 1
    and not ("action_proposal_units"."action_type" in ('budget_decrease', 'budget_increase') and "action_proposal_units"."ad_id" is not null)
  ),
	CONSTRAINT "action_proposal_units_time_order" CHECK ("action_proposal_units"."expires_at" > "action_proposal_units"."proposed_at"),
	CONSTRAINT "action_proposal_units_payload_exact" CHECK (
    jsonb_typeof("action_proposal_units"."unit_payload") = 'object'
    and "action_proposal_units"."unit_payload" #>> '{unitRef}' = "action_proposal_units"."unit_ref"
    and "action_proposal_units"."unit_payload" #>> '{unitHash}' = "action_proposal_units"."unit_hash"
    and "action_proposal_units"."unit_payload" #>> '{scopeHash}' = "action_proposal_units"."scope_hash"
    and "action_proposal_units"."unit_payload" #>> '{scope,accountRef}' = "action_proposal_units"."account_ref"
    and "action_proposal_units"."unit_payload" #>> '{scope,entityRef}' = "action_proposal_units"."entity_ref"
    and "action_proposal_units"."unit_payload" #>> '{scope,actionType}' = "action_proposal_units"."action_type"
    and "action_proposal_units"."unit_payload" #>> '{risk}' = "action_proposal_units"."risk"
    and "action_proposal_units"."unit_payload" #>> '{sourceHash}' = "action_proposal_units"."source_hash"
    and "action_proposal_units"."unit_payload" #>> '{contextHash}' = "action_proposal_units"."context_hash"
    and "action_proposal_units"."unit_payload" #>> '{specHash}' = "action_proposal_units"."spec_hash"
    and "action_proposal_units"."unit_payload" #>> '{requester,actorRef}' = "action_proposal_units"."requester_ref"
    and "action_proposal_units"."unit_payload" #>> '{requester,role}' = "action_proposal_units"."requester_role"
    and ("action_proposal_units"."unit_payload" #>> '{proposedAt}')::timestamptz = "action_proposal_units"."proposed_at"
    and ("action_proposal_units"."unit_payload" #>> '{expiresAt}')::timestamptz = "action_proposal_units"."expires_at"
  ),
	CONSTRAINT "action_proposal_units_action_plan_exact" CHECK (
    jsonb_typeof("action_proposal_units"."action_plan_payload") = 'object'
    and "action_proposal_units"."action_plan_payload" #>> '{schemaVersion}' = 'action-plan/1.0.0'
    and "action_proposal_units"."action_plan_payload" #>> '{planHash}' = "action_proposal_units"."action_plan_hash"
    and "action_proposal_units"."action_plan_payload" #>> '{actionType}' = "action_proposal_units"."action_type"
    and "action_proposal_units"."action_plan_payload" #>> '{risk}' = "action_proposal_units"."risk"
    and "action_proposal_units"."action_plan_payload" #>> '{action,entity,ref}' = "action_proposal_units"."entity_ref"
    and "action_proposal_units"."action_plan_payload" #>> '{disposition}' = 'approval_required'
    and "action_proposal_units"."action_plan_payload" #>> '{contextHash}' = "action_proposal_units"."context_hash"
    and "action_proposal_units"."action_plan_payload" #>> '{capabilities,canExecute}' = 'false'
    and "action_proposal_units"."action_plan_payload" #>> '{capabilities,canWriteMeta}' = 'false'
    and "action_proposal_units"."action_plan_payload" #>> '{capabilities,canGrantApproval}' = 'false'
    and "action_proposal_units"."action_plan_payload" #>> '{capabilities,canAccessRawGraph}' = 'false'
  ),
	CONSTRAINT "action_proposal_units_summary_exact" CHECK (
    jsonb_typeof("action_proposal_units"."summary_payload") = 'object'
    and "action_proposal_units"."summary_payload" #>> '{safety}' = 'public_safe'
    and jsonb_typeof("action_proposal_units"."summary_payload" #> '{before}') = 'object'
    and jsonb_typeof("action_proposal_units"."summary_payload" #> '{after}') = 'object'
    and jsonb_typeof("action_proposal_units"."summary_payload" #> '{evidence}') = 'array'
  ),
	CONSTRAINT "action_proposal_units_authentic_level_exact" CHECK (
    ("action_proposal_units"."action_plan_payload" #>> '{action,entity,level}' = 'campaign'
      and "action_proposal_units"."campaign_id" is not null and "action_proposal_units"."ad_set_id" is null and "action_proposal_units"."ad_id" is null)
    or ("action_proposal_units"."action_plan_payload" #>> '{action,entity,level}' = 'adset'
      and "action_proposal_units"."campaign_id" is null and "action_proposal_units"."ad_set_id" is not null and "action_proposal_units"."ad_id" is null)
    or ("action_proposal_units"."action_plan_payload" #>> '{action,entity,level}' = 'ad'
      and "action_proposal_units"."campaign_id" is null and "action_proposal_units"."ad_set_id" is null and "action_proposal_units"."ad_id" is not null)
  ),
	CONSTRAINT "action_proposal_units_no_authority" CHECK (
    not jsonb_path_exists("action_proposal_units"."unit_payload", '$.** ? (@.type() == "object").keyvalue() ? (@.key like_regex "^(actionauthority|executionauthority|writeauthority|writeenabled|canexecute|canwrite|approvalgranted|grant|authorization)$" flag "i")')
    and not jsonb_path_exists("action_proposal_units"."action_plan_payload" - 'capabilities', '$.** ? (@.type() == "object").keyvalue() ? (@.key like_regex "^(actionauthority|executionauthority|writeauthority|writeenabled|canexecute|canwrite|approvalgranted|grant|authorization)$" flag "i")')
    and not jsonb_path_exists("action_proposal_units"."summary_payload", '$.** ? (@.type() == "object").keyvalue() ? (@.key like_regex "^(actionauthority|executionauthority|writeauthority|writeenabled|canexecute|canwrite|approvalgranted|grant|authorization)$" flag "i")')
  ),
	CONSTRAINT "action_proposal_units_no_forbidden_material" CHECK (
    ("action_proposal_units"."unit_payload"::text || "action_proposal_units"."action_plan_payload"::text || "action_proposal_units"."summary_payload"::text)
      !~* '"[^"[:space:]]*(token|secret|prompt)"[[:space:]]*:'
    and ("action_proposal_units"."unit_payload"::text || "action_proposal_units"."action_plan_payload"::text || "action_proposal_units"."summary_payload"::text)
      !~* '"authorization"[[:space:]]*:'
    and ("action_proposal_units"."unit_payload"::text || "action_proposal_units"."action_plan_payload"::text || "action_proposal_units"."summary_payload"::text)
      !~* '"[^"[:space:]]*raw[_-]?(payload|request|response|json)"[[:space:]]*:'
  )
);
--> statement-breakpoint
-- Composite FK targets must exist before PostgreSQL validates the ALTER statements below.
CREATE UNIQUE INDEX "action_approval_policy_snapshots_workspace_row_unique" ON "action_approval_policy_snapshots" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "action_proposal_bundles_workspace_row_unique" ON "action_proposal_bundles" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "action_proposal_units_workspace_row_unique" ON "action_proposal_units" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "action_proposal_units_dependency_binding_unique" ON "action_proposal_units" USING btree ("workspace_id","bundle_id","id","unit_ref");--> statement-breakpoint
ALTER TABLE "action_approval_policy_snapshots" ADD CONSTRAINT "action_approval_policy_snapshots_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_proposal_bundles" ADD CONSTRAINT "action_proposal_bundles_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_proposal_bundles" ADD CONSTRAINT "action_proposal_bundles_policy_scope_fk" FOREIGN KEY ("workspace_id","policy_snapshot_id") REFERENCES "public"."action_approval_policy_snapshots"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_proposal_dependencies" ADD CONSTRAINT "action_proposal_dependencies_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_proposal_dependencies" ADD CONSTRAINT "action_proposal_dependencies_bundle_scope_fk" FOREIGN KEY ("workspace_id","bundle_id") REFERENCES "public"."action_proposal_bundles"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_proposal_dependencies" ADD CONSTRAINT "action_proposal_dependencies_unit_scope_fk" FOREIGN KEY ("workspace_id","bundle_id","unit_id","unit_ref") REFERENCES "public"."action_proposal_units"("workspace_id","bundle_id","id","unit_ref") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_proposal_dependencies" ADD CONSTRAINT "action_proposal_dependencies_dependency_scope_fk" FOREIGN KEY ("workspace_id","bundle_id","dependency_unit_id","dependency_unit_ref") REFERENCES "public"."action_proposal_units"("workspace_id","bundle_id","id","unit_ref") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_proposal_initial_events" ADD CONSTRAINT "action_proposal_initial_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_proposal_initial_events" ADD CONSTRAINT "action_proposal_initial_events_bundle_scope_fk" FOREIGN KEY ("workspace_id","bundle_id") REFERENCES "public"."action_proposal_bundles"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_proposal_units" ADD CONSTRAINT "action_proposal_units_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_proposal_units" ADD CONSTRAINT "action_proposal_units_bundle_scope_fk" FOREIGN KEY ("workspace_id","bundle_id") REFERENCES "public"."action_proposal_bundles"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_proposal_units" ADD CONSTRAINT "action_proposal_units_account_scope_fk" FOREIGN KEY ("workspace_id","ad_account_id") REFERENCES "public"."ad_accounts"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_proposal_units" ADD CONSTRAINT "action_proposal_units_campaign_scope_fk" FOREIGN KEY ("workspace_id","campaign_id") REFERENCES "public"."ad_campaigns"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_proposal_units" ADD CONSTRAINT "action_proposal_units_ad_set_scope_fk" FOREIGN KEY ("ad_set_id","workspace_id") REFERENCES "public"."meta_ad_sets"("id","workspace_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_proposal_units" ADD CONSTRAINT "action_proposal_units_ad_scope_fk" FOREIGN KEY ("ad_id","workspace_id") REFERENCES "public"."meta_ads"("id","workspace_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "action_approval_policy_snapshots_workspace_revision_unique" ON "action_approval_policy_snapshots" USING btree ("workspace_id","policy_ref","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "action_approval_policy_snapshots_workspace_hash_unique" ON "action_approval_policy_snapshots" USING btree ("workspace_id","policy_ref","policy_hash");--> statement-breakpoint
CREATE INDEX "action_approval_policy_snapshots_workspace_created_idx" ON "action_approval_policy_snapshots" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "action_proposal_bundles_workspace_identity_unique" ON "action_proposal_bundles" USING btree ("workspace_id","bundle_ref","plan_ref","plan_revision");--> statement-breakpoint
CREATE UNIQUE INDEX "action_proposal_bundles_workspace_hash_unique" ON "action_proposal_bundles" USING btree ("workspace_id","bundle_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "action_proposal_bundles_workspace_idempotency_unique" ON "action_proposal_bundles" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "action_proposal_bundles_workspace_staging_hash_unique" ON "action_proposal_bundles" USING btree ("workspace_id","staging_hash");--> statement-breakpoint
CREATE INDEX "action_proposal_bundles_workspace_initialized_idx" ON "action_proposal_bundles" USING btree ("workspace_id","initialized_at","id");--> statement-breakpoint
CREATE INDEX "action_proposal_bundles_policy_idx" ON "action_proposal_bundles" USING btree ("policy_snapshot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "action_proposal_dependencies_edge_unique" ON "action_proposal_dependencies" USING btree ("bundle_id","unit_id","dependency_unit_id");--> statement-breakpoint
CREATE INDEX "action_proposal_dependencies_unit_idx" ON "action_proposal_dependencies" USING btree ("unit_id");--> statement-breakpoint
CREATE INDEX "action_proposal_dependencies_dependency_idx" ON "action_proposal_dependencies" USING btree ("dependency_unit_id");--> statement-breakpoint
CREATE UNIQUE INDEX "action_proposal_initial_events_bundle_unique" ON "action_proposal_initial_events" USING btree ("bundle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "action_proposal_initial_events_workspace_event_unique" ON "action_proposal_initial_events" USING btree ("workspace_id","event_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "action_proposal_initial_events_workspace_hash_unique" ON "action_proposal_initial_events" USING btree ("workspace_id","event_hash");--> statement-breakpoint
CREATE INDEX "action_proposal_initial_events_bundle_idx" ON "action_proposal_initial_events" USING btree ("bundle_id");--> statement-breakpoint
CREATE UNIQUE INDEX "action_proposal_units_bundle_ordinal_unique" ON "action_proposal_units" USING btree ("bundle_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "action_proposal_units_bundle_ref_unique" ON "action_proposal_units" USING btree ("bundle_id","unit_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "action_proposal_units_bundle_hash_unique" ON "action_proposal_units" USING btree ("bundle_id","unit_hash");--> statement-breakpoint
CREATE INDEX "action_proposal_units_workspace_account_idx" ON "action_proposal_units" USING btree ("workspace_id","ad_account_id");--> statement-breakpoint
CREATE INDEX "action_proposal_units_bundle_idx" ON "action_proposal_units" USING btree ("bundle_id");--> statement-breakpoint
ALTER TABLE "action_approval_policy_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "action_proposal_bundles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "action_proposal_units" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "action_proposal_dependencies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "action_proposal_initial_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "action_approval_policy_snapshots" FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "action_proposal_bundles" FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "action_proposal_units" FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "action_proposal_dependencies" FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "action_proposal_initial_events" FROM PUBLIC, anon, authenticated;--> statement-breakpoint
CREATE FUNCTION action_proposal_queue_append_only() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'action_proposal_queue_append_only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER action_approval_policy_snapshots_append_only_trigger BEFORE UPDATE ON action_approval_policy_snapshots
FOR EACH ROW EXECUTE FUNCTION action_proposal_queue_append_only();--> statement-breakpoint
CREATE TRIGGER action_proposal_bundles_append_only_trigger BEFORE UPDATE ON action_proposal_bundles
FOR EACH ROW EXECUTE FUNCTION action_proposal_queue_append_only();--> statement-breakpoint
CREATE TRIGGER action_proposal_units_append_only_trigger BEFORE UPDATE ON action_proposal_units
FOR EACH ROW EXECUTE FUNCTION action_proposal_queue_append_only();--> statement-breakpoint
CREATE TRIGGER action_proposal_dependencies_append_only_trigger BEFORE UPDATE ON action_proposal_dependencies
FOR EACH ROW EXECUTE FUNCTION action_proposal_queue_append_only();--> statement-breakpoint
CREATE TRIGGER action_proposal_initial_events_append_only_trigger BEFORE UPDATE ON action_proposal_initial_events
FOR EACH ROW EXECUTE FUNCTION action_proposal_queue_append_only();--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION action_proposal_queue_append_only() FROM PUBLIC, anon, authenticated;
