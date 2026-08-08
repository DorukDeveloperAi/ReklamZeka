CREATE TABLE "decision_ledger_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"workspace_ref" text NOT NULL,
	"version" text NOT NULL,
	"record_type" text NOT NULL,
	"sequence" integer NOT NULL,
	"previous_hash" text NOT NULL,
	"record_id" text NOT NULL,
	"record_hash" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"effective_context_id" uuid,
	"effective_context_ref" text,
	"analysis_record_row_id" uuid,
	"analysis_record_ref" text,
	"analysis_definition_ref" text,
	"cadence_result_ref" text,
	"disposition" text,
	"payload" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decision_ledger_records_version" CHECK ("decision_ledger_records"."version" = 'decision-ledger/1.0.0'),
	CONSTRAINT "decision_ledger_records_sequence_positive" CHECK ("decision_ledger_records"."sequence" >= 1),
	CONSTRAINT "decision_ledger_records_type" CHECK ("decision_ledger_records"."record_type" in ('analysis', 'decision')),
	CONSTRAINT "decision_ledger_records_hash_format" CHECK (
    "decision_ledger_records"."previous_hash" = 'GENESIS' or "decision_ledger_records"."previous_hash" ~ '^[a-f0-9]{64}$'
  ),
	CONSTRAINT "decision_ledger_records_identity_format" CHECK (
    "decision_ledger_records"."record_id" ~ '^(analysis|decision)_[a-f0-9]{20}$'
    and "decision_ledger_records"."record_hash" ~ '^[a-f0-9]{64}$'
  ),
	CONSTRAINT "decision_ledger_records_required" CHECK (
    btrim("decision_ledger_records"."workspace_ref") <> '' and btrim("decision_ledger_records"."record_id") <> ''
  ),
	CONSTRAINT "decision_ledger_records_shape" CHECK ((
    ("decision_ledger_records"."record_type" = 'analysis'
      and "decision_ledger_records"."effective_context_id" is not null
      and "decision_ledger_records"."effective_context_ref" is not null and btrim("decision_ledger_records"."effective_context_ref") <> ''
      and "decision_ledger_records"."analysis_definition_ref" is not null and btrim("decision_ledger_records"."analysis_definition_ref") <> ''
      and "decision_ledger_records"."analysis_record_row_id" is null and "decision_ledger_records"."analysis_record_ref" is null
      and "decision_ledger_records"."cadence_result_ref" is null and "decision_ledger_records"."disposition" is null)
    or ("decision_ledger_records"."record_type" = 'decision'
      and "decision_ledger_records"."effective_context_id" is null and "decision_ledger_records"."effective_context_ref" is null
      and "decision_ledger_records"."analysis_definition_ref" is null
      and "decision_ledger_records"."analysis_record_row_id" is not null
      and "decision_ledger_records"."analysis_record_ref" is not null and btrim("decision_ledger_records"."analysis_record_ref") <> ''
      and "decision_ledger_records"."cadence_result_ref" is not null and btrim("decision_ledger_records"."cadence_result_ref") <> ''
      and "decision_ledger_records"."disposition" in ('act', 'test', 'observe', 'no_change', 'blocked'))
  ) is true),
	CONSTRAINT "decision_ledger_records_payload_object" CHECK (jsonb_typeof("decision_ledger_records"."payload"::jsonb) = 'object'),
	CONSTRAINT "decision_ledger_records_payload_exact" CHECK ((
    "decision_ledger_records"."payload"::jsonb #>> '{version}' = "decision_ledger_records"."version"
    and "decision_ledger_records"."payload"::jsonb #>> '{recordType}' = "decision_ledger_records"."record_type"
    and ("decision_ledger_records"."payload"::jsonb #>> '{sequence}')::integer = "decision_ledger_records"."sequence"
    and "decision_ledger_records"."payload"::jsonb #>> '{previousHash}' = "decision_ledger_records"."previous_hash"
    and "decision_ledger_records"."payload"::jsonb #>> '{workspaceRef}' = "decision_ledger_records"."workspace_ref"
    and ("decision_ledger_records"."payload"::jsonb #>> '{occurredAt}')::timestamptz = "decision_ledger_records"."occurred_at"
    and "decision_ledger_records"."payload"::jsonb #>> '{recordId}' = "decision_ledger_records"."record_id"
    and "decision_ledger_records"."payload"::jsonb #>> '{recordHash}' = "decision_ledger_records"."record_hash"
    and ("decision_ledger_records"."record_type" <> 'analysis' or (
      "decision_ledger_records"."payload"::jsonb #>> '{effectiveContextRef}' = "decision_ledger_records"."effective_context_ref"
      and "decision_ledger_records"."payload"::jsonb #>> '{analysisDefinitionRef}' = "decision_ledger_records"."analysis_definition_ref"
      and "decision_ledger_records"."payload"::jsonb #>> '{actionAuthority}' = 'none'
      and not ("decision_ledger_records"."payload"::jsonb ? 'executionAuthority')))
    and ("decision_ledger_records"."record_type" <> 'decision' or (
      "decision_ledger_records"."payload"::jsonb #>> '{analysisRecordRef}' = "decision_ledger_records"."analysis_record_ref"
      and "decision_ledger_records"."payload"::jsonb #>> '{cadenceResultRef}' = "decision_ledger_records"."cadence_result_ref"
      and "decision_ledger_records"."payload"::jsonb #>> '{disposition}' = "decision_ledger_records"."disposition"
      and "decision_ledger_records"."payload"::jsonb #>> '{executionAuthority}' = 'none'
      and not ("decision_ledger_records"."payload"::jsonb ? 'actionAuthority')))
  ) is true),
	CONSTRAINT "decision_ledger_records_no_forbidden_material" CHECK (
    "decision_ledger_records"."payload" !~* '"[^"[:space:]]*(token|secret|prompt)"[[:space:]]*:'
    and "decision_ledger_records"."payload" !~* '"authorization"[[:space:]]*:'
    and "decision_ledger_records"."payload" !~* '"[^"[:space:]]*raw[_-]?(payload|request|response|json)"[[:space:]]*:'
  ),
	CONSTRAINT "decision_ledger_records_no_authority_escalation" CHECK (
    not jsonb_path_exists(
      "decision_ledger_records"."payload"::jsonb - 'actionAuthority' - 'executionAuthority',
      '$.** ? (@.type() == "object").keyvalue() ? (@.key like_regex "^(canwrite|writeenabled|actionauthority|writeauthority|executionauthority|approvalgranted|canauthorizeaction|canexecutewrite|canenforcepolicy|canalterapproval)$" flag "i")'
    )
  )
);
--> statement-breakpoint
ALTER TABLE "decision_ledger_records" ADD CONSTRAINT "decision_ledger_records_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_ledger_records" ADD CONSTRAINT "decision_ledger_records_context_scope_fk" FOREIGN KEY ("workspace_id","effective_context_id") REFERENCES "public"."effective_campaign_contexts"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "decision_ledger_records_workspace_row_unique" ON "decision_ledger_records" USING btree ("workspace_id","id");--> statement-breakpoint
ALTER TABLE "decision_ledger_records" ADD CONSTRAINT "decision_ledger_records_analysis_scope_fk" FOREIGN KEY ("workspace_id","analysis_record_row_id") REFERENCES "public"."decision_ledger_records"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "decision_ledger_records_workspace_sequence_unique" ON "decision_ledger_records" USING btree ("workspace_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "decision_ledger_records_workspace_record_unique" ON "decision_ledger_records" USING btree ("workspace_id","record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "decision_ledger_records_workspace_hash_unique" ON "decision_ledger_records" USING btree ("workspace_id","record_hash");--> statement-breakpoint
CREATE INDEX "decision_ledger_records_workspace_ref_sequence_idx" ON "decision_ledger_records" USING btree ("workspace_id","workspace_ref","sequence");--> statement-breakpoint
CREATE INDEX "decision_ledger_records_context_idx" ON "decision_ledger_records" USING btree ("effective_context_id");--> statement-breakpoint
CREATE INDEX "decision_ledger_records_analysis_idx" ON "decision_ledger_records" USING btree ("analysis_record_row_id");--> statement-breakpoint
ALTER TABLE "decision_ledger_records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "decision_ledger_records" FROM PUBLIC, anon, authenticated;
