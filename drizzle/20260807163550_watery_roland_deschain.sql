CREATE TABLE "budget_proposal_alternatives" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"proposal_id" uuid NOT NULL,
	"proposal_hash" text NOT NULL,
	"ordinal" integer NOT NULL,
	"scenario_ref" text NOT NULL,
	"scenario_kind" text NOT NULL,
	"scenario_status" text NOT NULL,
	"alternative_payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_proposal_alternatives_shape" CHECK (
    "budget_proposal_alternatives"."ordinal" >= 1 and "budget_proposal_alternatives"."ordinal" <= 3
    and "budget_proposal_alternatives"."scenario_ref" ~ '^[a-z][a-z0-9_.:-]{0,127}$'
    and "budget_proposal_alternatives"."scenario_kind" in ('keep', 'conservative', 'target_seeking')
    and "budget_proposal_alternatives"."scenario_status" in ('composed', 'suppressed')
    and "budget_proposal_alternatives"."proposal_hash" ~ '^[a-f0-9]{64}$'
  ),
	CONSTRAINT "budget_proposal_alternatives_payload_exact" CHECK ((
    jsonb_typeof("budget_proposal_alternatives"."alternative_payload") = 'object'
    and "budget_proposal_alternatives"."alternative_payload" #>> '{scenarioRef}' = "budget_proposal_alternatives"."scenario_ref"
    and "budget_proposal_alternatives"."alternative_payload" #>> '{kind}' = "budget_proposal_alternatives"."scenario_kind"
    and "budget_proposal_alternatives"."alternative_payload" #>> '{status}' = "budget_proposal_alternatives"."scenario_status"
    and "budget_proposal_alternatives"."alternative_payload" #>> '{actionAuthority}' = 'none'
  ) is true),
	CONSTRAINT "budget_proposal_alternatives_no_authority" CHECK (
    "budget_proposal_alternatives"."alternative_payload"::text !~* '"(canApprove|canExecute|canWriteMeta|approvalGranted|writeEnabled)"[[:space:]]*:[[:space:]]*true'
  )
);
--> statement-breakpoint
CREATE TABLE "budget_proposal_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"context_id" uuid NOT NULL,
	"context_hash" text NOT NULL,
	"series_ref" text NOT NULL,
	"revision" integer NOT NULL,
	"previous_proposal_hash" text NOT NULL,
	"proposal_ref" text NOT NULL,
	"proposal_hash" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"schema_version" text NOT NULL,
	"proposed_at" timestamp with time zone NOT NULL,
	"proposal_payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_proposal_versions_identity" CHECK (
    "budget_proposal_versions"."series_ref" ~ '^[a-z][a-z0-9_.:-]{0,127}$'
    and "budget_proposal_versions"."idempotency_key" ~ '^[a-z][a-z0-9_.:-]{0,127}$'
    and "budget_proposal_versions"."proposal_ref" ~ '^budget_proposal_[a-f0-9]{20}$'
    and "budget_proposal_versions"."proposal_hash" ~ '^[a-f0-9]{64}$'
    and "budget_proposal_versions"."context_hash" ~ '^[a-f0-9]{64}$'
    and "budget_proposal_versions"."revision" >= 1
    and (("budget_proposal_versions"."revision" = 1 and "budget_proposal_versions"."previous_proposal_hash" = 'GENESIS')
      or ("budget_proposal_versions"."revision" > 1 and "budget_proposal_versions"."previous_proposal_hash" ~ '^[a-f0-9]{64}$'))
  ),
	CONSTRAINT "budget_proposal_versions_payload_exact" CHECK ((
    jsonb_typeof("budget_proposal_versions"."proposal_payload") = 'object'
    and "budget_proposal_versions"."proposal_payload" #>> '{schemaVersion}' = "budget_proposal_versions"."schema_version"
    and "budget_proposal_versions"."schema_version" = 'budget-proposal/1.0.0'
    and "budget_proposal_versions"."proposal_payload" #>> '{seriesRef}' = "budget_proposal_versions"."series_ref"
    and ("budget_proposal_versions"."proposal_payload" #>> '{revision}')::integer = "budget_proposal_versions"."revision"
    and "budget_proposal_versions"."proposal_payload" #>> '{previousProposalHash}' = "budget_proposal_versions"."previous_proposal_hash"
    and "budget_proposal_versions"."proposal_payload" #>> '{proposalRef}' = "budget_proposal_versions"."proposal_ref"
    and "budget_proposal_versions"."proposal_payload" #>> '{proposalHash}' = "budget_proposal_versions"."proposal_hash"
    and "budget_proposal_versions"."proposal_payload" #>> '{idempotencyKey}' = "budget_proposal_versions"."idempotency_key"
    and ("budget_proposal_versions"."proposal_payload" #>> '{createdAt}')::timestamptz = "budget_proposal_versions"."proposed_at"
    and "budget_proposal_versions"."proposal_payload" #>> '{scope,workspaceId}' = "budget_proposal_versions"."workspace_id"::text
    and "budget_proposal_versions"."proposal_payload" #>> '{scope,adAccountId}' = "budget_proposal_versions"."ad_account_id"::text
    and "budget_proposal_versions"."proposal_payload" #>> '{scope,campaignId}' = "budget_proposal_versions"."campaign_id"::text
    and "budget_proposal_versions"."proposal_payload" #>> '{scope,contextHash}' = "budget_proposal_versions"."context_hash"
    and "budget_proposal_versions"."proposal_payload" #>> '{frozenContext,contextHash}' = "budget_proposal_versions"."context_hash"
    and "budget_proposal_versions"."proposal_payload" #>> '{actionAuthority}' = 'none'
    and "budget_proposal_versions"."proposal_payload" #> '{capabilities}' = '{
      "canApprove": false, "canExecute": false, "canWriteMeta": false
    }'::jsonb
  ) is true),
	CONSTRAINT "budget_proposal_versions_no_forbidden_material" CHECK (
    "budget_proposal_versions"."proposal_payload"::text !~* '"[^"[:space:]]*(token|secret|prompt)"[[:space:]]*:'
    and "budget_proposal_versions"."proposal_payload"::text !~* '"authorization"[[:space:]]*:'
    and "budget_proposal_versions"."proposal_payload"::text !~* '"[^"[:space:]]*raw[_-]?(payload|request|response|json)"[[:space:]]*:'
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "budget_proposal_versions_alternative_binding_unique" ON "budget_proposal_versions" USING btree ("workspace_id","id","proposal_hash");--> statement-breakpoint
ALTER TABLE "budget_proposal_alternatives" ADD CONSTRAINT "budget_proposal_alternatives_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_proposal_alternatives" ADD CONSTRAINT "budget_proposal_alternatives_proposal_binding_fk" FOREIGN KEY ("workspace_id","proposal_id","proposal_hash") REFERENCES "public"."budget_proposal_versions"("workspace_id","id","proposal_hash") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_proposal_versions" ADD CONSTRAINT "budget_proposal_versions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_proposal_versions" ADD CONSTRAINT "budget_proposal_versions_account_scope_fk" FOREIGN KEY ("workspace_id","ad_account_id") REFERENCES "public"."ad_accounts"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_proposal_versions" ADD CONSTRAINT "budget_proposal_versions_campaign_scope_fk" FOREIGN KEY ("workspace_id","campaign_id") REFERENCES "public"."ad_campaigns"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_proposal_versions" ADD CONSTRAINT "budget_proposal_versions_context_scope_fk" FOREIGN KEY ("workspace_id","context_id") REFERENCES "public"."effective_campaign_contexts"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "budget_proposal_alternatives_proposal_ordinal_unique" ON "budget_proposal_alternatives" USING btree ("proposal_id","ordinal");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_proposal_alternatives_proposal_scenario_unique" ON "budget_proposal_alternatives" USING btree ("proposal_id","scenario_ref");--> statement-breakpoint
CREATE INDEX "budget_proposal_alternatives_workspace_proposal_idx" ON "budget_proposal_alternatives" USING btree ("workspace_id","proposal_id");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_proposal_versions_workspace_row_unique" ON "budget_proposal_versions" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_proposal_versions_workspace_series_revision_unique" ON "budget_proposal_versions" USING btree ("workspace_id","series_ref","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_proposal_versions_workspace_hash_unique" ON "budget_proposal_versions" USING btree ("workspace_id","proposal_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_proposal_versions_workspace_idempotency_unique" ON "budget_proposal_versions" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "budget_proposal_versions_scope_created_idx" ON "budget_proposal_versions" USING btree ("workspace_id","ad_account_id","campaign_id","proposed_at","id");--> statement-breakpoint
CREATE INDEX "budget_proposal_versions_context_idx" ON "budget_proposal_versions" USING btree ("context_id");--> statement-breakpoint
CREATE FUNCTION budget_proposal_append_only() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'budget_proposal_append_only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER budget_proposal_versions_append_only_trigger
BEFORE UPDATE ON budget_proposal_versions
FOR EACH ROW EXECUTE FUNCTION budget_proposal_append_only();--> statement-breakpoint
CREATE TRIGGER budget_proposal_alternatives_append_only_trigger
BEFORE UPDATE ON budget_proposal_alternatives
FOR EACH ROW EXECUTE FUNCTION budget_proposal_append_only();--> statement-breakpoint
ALTER TABLE budget_proposal_versions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE budget_proposal_alternatives ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE budget_proposal_versions FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE budget_proposal_alternatives FROM PUBLIC, anon, authenticated;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION budget_proposal_append_only() FROM PUBLIC, anon, authenticated;
