CREATE TABLE "budget_pool_hierarchy_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"previous_hierarchy_hash" text NOT NULL,
	"hierarchy_hash" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"lifecycle_state" text NOT NULL,
	"created_by_actor_id" uuid NOT NULL,
	"hierarchy_payload" jsonb NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"effective_to" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "budget_pool_hierarchy_revisions_identity" CHECK (
    "budget_pool_hierarchy_revisions"."revision" >= 1
    and (("budget_pool_hierarchy_revisions"."revision" = 1 and "budget_pool_hierarchy_revisions"."previous_hierarchy_hash" = 'GENESIS')
      or ("budget_pool_hierarchy_revisions"."revision" > 1 and "budget_pool_hierarchy_revisions"."previous_hierarchy_hash" ~ '^[a-f0-9]{64}$'))
    and "budget_pool_hierarchy_revisions"."hierarchy_hash" ~ '^[a-f0-9]{64}$'
    and "budget_pool_hierarchy_revisions"."idempotency_key" ~ '^[a-z][a-z0-9_.:-]{0,127}$'
    and "budget_pool_hierarchy_revisions"."lifecycle_state" = 'draft'
    and "budget_pool_hierarchy_revisions"."effective_to" > "budget_pool_hierarchy_revisions"."effective_from"
  ),
	CONSTRAINT "budget_pool_hierarchy_revisions_payload_exact" CHECK ((
    jsonb_typeof("budget_pool_hierarchy_revisions"."hierarchy_payload") = 'object'
    and "budget_pool_hierarchy_revisions"."hierarchy_payload" #>> '{schemaVersion}' = 'budget-pool-hierarchy/1.0.0'
    and "budget_pool_hierarchy_revisions"."hierarchy_payload" #>> '{hierarchyHash}' = "budget_pool_hierarchy_revisions"."hierarchy_hash"
    and "budget_pool_hierarchy_revisions"."hierarchy_payload" #> '{authority}' = '{
      "recommendationOnly": true, "canPublish": false, "canApprove": false,
      "canExecute": false, "canWriteMeta": false, "canEnableAutomation": false
    }'::jsonb
  ) is true),
	CONSTRAINT "budget_pool_hierarchy_revisions_no_forbidden_authority" CHECK (
    "budget_pool_hierarchy_revisions"."hierarchy_payload"::text !~* '"(approvalGranted|writeEnabled|policyPublished|actionAuthorized)"[[:space:]]*:[[:space:]]*true'
    and "budget_pool_hierarchy_revisions"."hierarchy_payload"::text !~* '"[^"[:space:]]*(token|secret|authorization|raw[_-]?(payload|request|response|json))"[[:space:]]*:'
  )
);
--> statement-breakpoint
ALTER TABLE "budget_pool_hierarchy_revisions" ADD CONSTRAINT "budget_pool_hierarchy_revisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "budget_pool_hierarchy_revisions" ADD CONSTRAINT "budget_pool_hierarchy_revisions_membership_scope_fk" FOREIGN KEY ("workspace_id","created_by_actor_id") REFERENCES "public"."memberships"("workspace_id","user_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "budget_pool_hierarchy_revisions_workspace_row_unique" ON "budget_pool_hierarchy_revisions" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_pool_hierarchy_revisions_workspace_revision_unique" ON "budget_pool_hierarchy_revisions" USING btree ("workspace_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_pool_hierarchy_revisions_workspace_hash_unique" ON "budget_pool_hierarchy_revisions" USING btree ("workspace_id","hierarchy_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "budget_pool_hierarchy_revisions_workspace_idempotency_unique" ON "budget_pool_hierarchy_revisions" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "budget_pool_hierarchy_revisions_current_idx" ON "budget_pool_hierarchy_revisions" USING btree ("workspace_id","revision" DESC NULLS LAST);
--> statement-breakpoint
ALTER TABLE "budget_pool_hierarchy_revisions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "budget_pool_hierarchy_revisions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "budget_pool_hierarchy_revisions" FROM PUBLIC, anon, authenticated, service_role;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.budget_pool_hierarchy_revision_append_only_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND EXISTS (
    SELECT 1 FROM public.workspaces
    WHERE id = OLD.workspace_id AND lifecycle_state = 'tombstoning'
  ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'budget pool hierarchy revisions are append-only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER budget_pool_hierarchy_revisions_append_only
BEFORE UPDATE OR DELETE ON "budget_pool_hierarchy_revisions"
FOR EACH ROW EXECUTE FUNCTION public.budget_pool_hierarchy_revision_append_only_guard();
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION public.budget_pool_hierarchy_revision_append_only_guard() FROM PUBLIC, anon, authenticated, service_role;
