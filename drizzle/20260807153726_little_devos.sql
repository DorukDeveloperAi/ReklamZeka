CREATE TABLE "advised_practice_definitions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"workspace_ref" text NOT NULL,
	"practice_ref" text NOT NULL,
	"version" integer NOT NULL,
	"schema_version" text NOT NULL,
	"previous_definition_hash" text NOT NULL,
	"definition_hash" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "advised_practice_definitions_version" CHECK (
    "advised_practice_definitions"."version" >= 1 and "advised_practice_definitions"."schema_version" = 'advised-practice/1.0.0'
    and (("advised_practice_definitions"."version" = 1 and "advised_practice_definitions"."previous_definition_hash" = 'GENESIS')
      or ("advised_practice_definitions"."version" > 1 and "advised_practice_definitions"."previous_definition_hash" ~ '^[a-f0-9]{64}$'))
  ),
	CONSTRAINT "advised_practice_definitions_identity" CHECK (
    "advised_practice_definitions"."workspace_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_-]{0,94}$'
    and "advised_practice_definitions"."practice_ref" ~ '^practice_[a-z0-9][a-z0-9_-]{0,86}$'
    and "advised_practice_definitions"."definition_hash" ~ '^[a-f0-9]{64}$'
  ),
	CONSTRAINT "advised_practice_definitions_payload_exact" CHECK ((
    jsonb_typeof("advised_practice_definitions"."payload") = 'object'
    and "advised_practice_definitions"."payload" #>> '{schemaVersion}' = "advised_practice_definitions"."schema_version"
    and "advised_practice_definitions"."payload" #>> '{workspaceRef}' = "advised_practice_definitions"."workspace_ref"
    and "advised_practice_definitions"."payload" #>> '{practiceRef}' = "advised_practice_definitions"."practice_ref"
    and ("advised_practice_definitions"."payload" #>> '{version}')::integer = "advised_practice_definitions"."version"
    and "advised_practice_definitions"."payload" #>> '{previousDefinitionHash}' = "advised_practice_definitions"."previous_definition_hash"
    and "advised_practice_definitions"."payload" #>> '{definitionHash}' = "advised_practice_definitions"."definition_hash"
    and "advised_practice_definitions"."payload" #>> '{capabilities,canCreateGuidance}' = 'false'
    and "advised_practice_definitions"."payload" #>> '{capabilities,canPromotePolicy}' = 'false'
    and "advised_practice_definitions"."payload" #>> '{capabilities,canEnableAutomation}' = 'false'
    and "advised_practice_definitions"."payload" #>> '{capabilities,canAuthorizeAction}' = 'false'
    and "advised_practice_definitions"."payload" #> '{capabilities}' = '{
      "canCreateGuidance": false,
      "canPromotePolicy": false,
      "canEnableAutomation": false,
      "canAuthorizeAction": false
    }'::jsonb
  ) is true),
	CONSTRAINT "advised_practice_definitions_required_provenance" CHECK ((
    jsonb_typeof("advised_practice_definitions"."payload" #> '{provenance,ownerSource}') = 'object'
    and jsonb_typeof("advised_practice_definitions"."payload" #> '{provenance,metaSources}') = 'array'
    and jsonb_array_length("advised_practice_definitions"."payload" #> '{provenance,metaSources}') >= 1
    and jsonb_typeof("advised_practice_definitions"."payload" #> '{provenance,evidenceRefs}') = 'array'
    and jsonb_array_length("advised_practice_definitions"."payload" #> '{provenance,evidenceRefs}') >= 1
    and jsonb_typeof("advised_practice_definitions"."payload" #> '{provenance,deliberation}') = 'object'
  ) is true),
	CONSTRAINT "advised_practice_definitions_no_forbidden_material" CHECK (
    "advised_practice_definitions"."payload"::text !~* '"[^"[:space:]]*(token|secret|prompt)"[[:space:]]*:'
    and "advised_practice_definitions"."payload"::text !~* '"authorization"[[:space:]]*:'
    and "advised_practice_definitions"."payload"::text !~* '"[^"[:space:]]*raw[_-]?(payload|request|response|json)"[[:space:]]*:'
  ),
	CONSTRAINT "advised_practice_definitions_no_authority_escalation" CHECK (
    not jsonb_path_exists(
      "advised_practice_definitions"."payload" - 'capabilities',
      '$.** ? (@.type() == "object").keyvalue() ? (@.key like_regex "^(canwrite|writeenabled|actionauthority|writeauthority|executionauthority|approvalgranted|canauthorizeaction|canexecutewrite|canenforcepolicy|canalterapproval|cancreateguidance|canpromotepolicy|canenableautomation)$" flag "i")'
    )
  )
);
--> statement-breakpoint
CREATE TABLE "advised_practice_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"definition_id" uuid NOT NULL,
	"workspace_ref" text NOT NULL,
	"practice_ref" text NOT NULL,
	"definition_version" integer NOT NULL,
	"definition_hash" text NOT NULL,
	"schema_version" text NOT NULL,
	"sequence" integer NOT NULL,
	"previous_event_hash" text NOT NULL,
	"event_id" text NOT NULL,
	"event_hash" text NOT NULL,
	"event_type" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "advised_practice_events_version" CHECK (
    "advised_practice_events"."schema_version" = 'advised-practice-event/1.0.0' and "advised_practice_events"."definition_version" >= 1 and "advised_practice_events"."sequence" >= 1
  ),
	CONSTRAINT "advised_practice_events_identity" CHECK (
    "advised_practice_events"."workspace_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_-]{0,94}$'
    and "advised_practice_events"."practice_ref" ~ '^practice_[a-z0-9][a-z0-9_-]{0,86}$'
    and "advised_practice_events"."definition_hash" ~ '^[a-f0-9]{64}$'
    and ("advised_practice_events"."previous_event_hash" = 'GENESIS' or "advised_practice_events"."previous_event_hash" ~ '^[a-f0-9]{64}$')
  ),
	CONSTRAINT "advised_practice_events_event_identity" CHECK (
    "advised_practice_events"."event_id" ~ '^practice_event_[a-f0-9]{20}$' and "advised_practice_events"."event_hash" ~ '^[a-f0-9]{64}$'
  ),
	CONSTRAINT "advised_practice_events_type" CHECK ("advised_practice_events"."event_type" in (
    'candidate_created', 'reviewed', 'trial_started', 'outcome_recorded', 'standardization_reviewed', 'retired'
  )),
	CONSTRAINT "advised_practice_events_payload_exact" CHECK ((
    jsonb_typeof("advised_practice_events"."payload") = 'object'
    and "advised_practice_events"."payload" #>> '{schemaVersion}' = "advised_practice_events"."schema_version"
    and "advised_practice_events"."payload" #>> '{workspaceRef}' = "advised_practice_events"."workspace_ref"
    and "advised_practice_events"."payload" #>> '{practiceRef}' = "advised_practice_events"."practice_ref"
    and ("advised_practice_events"."payload" #>> '{definitionVersion}')::integer = "advised_practice_events"."definition_version"
    and "advised_practice_events"."payload" #>> '{definitionHash}' = "advised_practice_events"."definition_hash"
    and ("advised_practice_events"."payload" #>> '{sequence}')::integer = "advised_practice_events"."sequence"
    and "advised_practice_events"."payload" #>> '{previousEventHash}' = "advised_practice_events"."previous_event_hash"
    and "advised_practice_events"."payload" #>> '{eventId}' = "advised_practice_events"."event_id"
    and "advised_practice_events"."payload" #>> '{eventHash}' = "advised_practice_events"."event_hash"
    and "advised_practice_events"."payload" #>> '{eventType}' = "advised_practice_events"."event_type"
    and ("advised_practice_events"."payload" #>> '{occurredAt}')::timestamptz = "advised_practice_events"."occurred_at"
    and "advised_practice_events"."payload" #>> '{authority}' = 'advisory_only'
  ) is true),
	CONSTRAINT "advised_practice_events_outcome" CHECK (
    "advised_practice_events"."event_type" <> 'outcome_recorded' or (
      "advised_practice_events"."payload" #>> '{result}' in ('validated', 'conditional', 'rejected')
      and jsonb_typeof("advised_practice_events"."payload" #> '{evidenceRefs}') = 'array'
      and jsonb_array_length("advised_practice_events"."payload" #> '{evidenceRefs}') >= 1
    )
  ),
	CONSTRAINT "advised_practice_events_review_disabled" CHECK (
    "advised_practice_events"."event_type" <> 'standardization_reviewed' or (
      "advised_practice_events"."payload" #>> '{policyPromotionCapability}' = 'disabled'
      and "advised_practice_events"."payload" #>> '{automationCapability}' = 'disabled'
      and jsonb_typeof("advised_practice_events"."payload" #> '{decomposition}') = 'array'
      and jsonb_array_length("advised_practice_events"."payload" #> '{decomposition}') >= 1
      and not jsonb_path_exists("advised_practice_events"."payload", '$.decomposition[*] ? (@.artifactRef != null || @.promotionCapability != "disabled")')
    )
  ),
	CONSTRAINT "advised_practice_events_no_forbidden_material" CHECK (
    "advised_practice_events"."payload"::text !~* '"[^"[:space:]]*(token|secret|prompt)"[[:space:]]*:'
    and "advised_practice_events"."payload"::text !~* '"authorization"[[:space:]]*:'
    and "advised_practice_events"."payload"::text !~* '"[^"[:space:]]*raw[_-]?(payload|request|response|json)"[[:space:]]*:'
  ),
	CONSTRAINT "advised_practice_events_no_authority_escalation" CHECK (
    not jsonb_path_exists(
      "advised_practice_events"."payload" - 'authority' - 'policyPromotionCapability' - 'automationCapability',
      '$.** ? (@.type() == "object").keyvalue() ? (@.key like_regex "^(canwrite|writeenabled|actionauthority|writeauthority|executionauthority|approvalgranted|canauthorizeaction|canexecutewrite|canenforcepolicy|canalterapproval|canpromotepolicy|canenableautomation)$" flag "i")'
    )
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "advised_practice_definitions_event_binding_unique" ON "advised_practice_definitions" USING btree ("workspace_id","id","practice_ref","version","definition_hash");--> statement-breakpoint
ALTER TABLE "advised_practice_definitions" ADD CONSTRAINT "advised_practice_definitions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advised_practice_events" ADD CONSTRAINT "advised_practice_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advised_practice_events" ADD CONSTRAINT "advised_practice_events_definition_binding_fk" FOREIGN KEY ("workspace_id","definition_id","practice_ref","definition_version","definition_hash") REFERENCES "public"."advised_practice_definitions"("workspace_id","id","practice_ref","version","definition_hash") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "advised_practice_definitions_workspace_row_unique" ON "advised_practice_definitions" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "advised_practice_definitions_workspace_ref_version_unique" ON "advised_practice_definitions" USING btree ("workspace_id","practice_ref","version");--> statement-breakpoint
CREATE UNIQUE INDEX "advised_practice_definitions_workspace_ref_hash_unique" ON "advised_practice_definitions" USING btree ("workspace_id","practice_ref","definition_hash");--> statement-breakpoint
CREATE INDEX "advised_practice_definitions_workspace_created_idx" ON "advised_practice_definitions" USING btree ("workspace_id","created_at","practice_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "advised_practice_events_workspace_event_unique" ON "advised_practice_events" USING btree ("workspace_id","event_id");--> statement-breakpoint
CREATE UNIQUE INDEX "advised_practice_events_workspace_hash_unique" ON "advised_practice_events" USING btree ("workspace_id","event_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "advised_practice_events_definition_sequence_unique" ON "advised_practice_events" USING btree ("workspace_id","definition_id","sequence");--> statement-breakpoint
CREATE INDEX "advised_practice_events_definition_idx" ON "advised_practice_events" USING btree ("definition_id");--> statement-breakpoint
CREATE INDEX "advised_practice_events_workspace_practice_occurred_idx" ON "advised_practice_events" USING btree ("workspace_id","practice_ref","occurred_at");--> statement-breakpoint
ALTER TABLE "advised_practice_definitions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "advised_practice_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "advised_practice_definitions" FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "advised_practice_events" FROM PUBLIC, anon, authenticated;
