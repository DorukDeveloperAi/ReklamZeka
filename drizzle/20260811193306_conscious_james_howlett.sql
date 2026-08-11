CREATE TABLE "normalization_workbench_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"source_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"set_id" uuid NOT NULL,
	"workspace_ref" text NOT NULL,
	"normalization_ref" text NOT NULL,
	"revision" integer NOT NULL,
	"previous_revision_hash" text NOT NULL,
	"source_key" text NOT NULL,
	"source_version" integer NOT NULL,
	"source_hash" text NOT NULL,
	"card_key" text NOT NULL,
	"card_version" integer NOT NULL,
	"card_hash" text NOT NULL,
	"set_key" text NOT NULL,
	"set_version" integer NOT NULL,
	"set_hash" text NOT NULL,
	"actor_ref" text NOT NULL,
	"actor_role" text NOT NULL,
	"revision_hash" text NOT NULL,
	"revision_payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "normalization_workbench_revisions_identity" CHECK (
    "normalization_workbench_revisions"."workspace_ref" ~ '^workspace_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and "normalization_workbench_revisions"."normalization_ref" ~ '^normalization_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and "normalization_workbench_revisions"."revision" between 1 and 1000000
    and (("normalization_workbench_revisions"."revision" = 1 and "normalization_workbench_revisions"."previous_revision_hash" = 'GENESIS')
      or ("normalization_workbench_revisions"."revision" > 1 and "normalization_workbench_revisions"."previous_revision_hash" ~ '^[a-f0-9]{64}$'))
    and "normalization_workbench_revisions"."source_version" >= 1 and "normalization_workbench_revisions"."card_version" >= 1 and "normalization_workbench_revisions"."set_version" >= 1
    and "normalization_workbench_revisions"."source_hash" ~ '^[a-f0-9]{64}$' and "normalization_workbench_revisions"."card_hash" ~ '^[a-f0-9]{64}$'
    and "normalization_workbench_revisions"."set_hash" ~ '^[a-f0-9]{64}$' and "normalization_workbench_revisions"."revision_hash" ~ '^[a-f0-9]{64}$'
    and "normalization_workbench_revisions"."actor_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and "normalization_workbench_revisions"."actor_role" in ('owner', 'admin', 'analyst')
  ),
	CONSTRAINT "normalization_workbench_revisions_payload_exact" CHECK ((
    jsonb_typeof("normalization_workbench_revisions"."revision_payload") = 'object'
    and "normalization_workbench_revisions"."revision_payload" #>> '{schemaVersion}' = 'normalization-workbench/1.0.0'
    and "normalization_workbench_revisions"."revision_payload" #>> '{workspaceRef}' = "normalization_workbench_revisions"."workspace_ref"
    and "normalization_workbench_revisions"."revision_payload" #>> '{normalizationRef}' = "normalization_workbench_revisions"."normalization_ref"
    and ("normalization_workbench_revisions"."revision_payload" #>> '{revision}')::integer = "normalization_workbench_revisions"."revision"
    and "normalization_workbench_revisions"."revision_payload" #>> '{previousRevisionHash}' = "normalization_workbench_revisions"."previous_revision_hash"
    and "normalization_workbench_revisions"."revision_payload" #>> '{source,ref}' = "normalization_workbench_revisions"."source_key"
    and ("normalization_workbench_revisions"."revision_payload" #>> '{source,version}')::integer = "normalization_workbench_revisions"."source_version"
    and "normalization_workbench_revisions"."revision_payload" #>> '{source,recordHash}' = "normalization_workbench_revisions"."source_hash"
    and "normalization_workbench_revisions"."revision_payload" #>> '{card,ref}' = "normalization_workbench_revisions"."card_key"
    and ("normalization_workbench_revisions"."revision_payload" #>> '{card,version}')::integer = "normalization_workbench_revisions"."card_version"
    and "normalization_workbench_revisions"."revision_payload" #>> '{card,recordHash}' = "normalization_workbench_revisions"."card_hash"
    and "normalization_workbench_revisions"."revision_payload" #>> '{set,ref}' = "normalization_workbench_revisions"."set_key"
    and ("normalization_workbench_revisions"."revision_payload" #>> '{set,version}')::integer = "normalization_workbench_revisions"."set_version"
    and "normalization_workbench_revisions"."revision_payload" #>> '{set,recordHash}' = "normalization_workbench_revisions"."set_hash"
    and "normalization_workbench_revisions"."revision_payload" #>> '{actor,ref}' = "normalization_workbench_revisions"."actor_ref"
    and "normalization_workbench_revisions"."revision_payload" #>> '{actor,role}' = "normalization_workbench_revisions"."actor_role"
    and "normalization_workbench_revisions"."revision_payload" #>> '{revisionHash}' = "normalization_workbench_revisions"."revision_hash"
    and ("normalization_workbench_revisions"."revision_payload" #>> '{occurredAt}')::timestamptz = "normalization_workbench_revisions"."occurred_at"
    and jsonb_typeof("normalization_workbench_revisions"."revision_payload" #> '{normalizedGuidance}') = 'object'
    and jsonb_typeof("normalization_workbench_revisions"."revision_payload" #> '{assumptions}') = 'array'
    and jsonb_typeof("normalization_workbench_revisions"."revision_payload" #> '{questions}') = 'array'
    and "normalization_workbench_revisions"."revision_payload" #>> '{impactSummary,status}' = 'not_applicable'
    and "normalization_workbench_revisions"."revision_payload" #> '{impactSummary,affectedScopeRefs}' = '[]'::jsonb
    and "normalization_workbench_revisions"."revision_payload" #> '{impactSummary,unresolvedDependencyRefs}' = '[]'::jsonb
    and "normalization_workbench_revisions"."revision_payload" #> '{authority,canPublish}' = 'false'::jsonb
    and "normalization_workbench_revisions"."revision_payload" #> '{authority,canPromotePolicy}' = 'false'::jsonb
    and "normalization_workbench_revisions"."revision_payload" #> '{authority,canApprove}' = 'false'::jsonb
    and "normalization_workbench_revisions"."revision_payload" #> '{authority,canExecute}' = 'false'::jsonb
    and "normalization_workbench_revisions"."revision_payload" #> '{authority,canWriteMeta}' = 'false'::jsonb
  ) is true),
	CONSTRAINT "normalization_workbench_revisions_no_forbidden_material" CHECK (
    "normalization_workbench_revisions"."revision_payload"::text !~* '"[^"[:space:]]*(token|secret|prompt|raw[_-]?(payload|request|response|json|text)|authorization|approvalgranted)"[[:space:]]*:'
    and "normalization_workbench_revisions"."revision_payload"::text !~* '"(canPublish|canPromotePolicy|canApprove|canExecute|canWriteMeta)"[[:space:]]*:[[:space:]]*true'
    and not ("normalization_workbench_revisions"."revision_payload" ? 'strictPolicy')
  )
);
--> statement-breakpoint
CREATE UNIQUE INDEX "normalization_workbench_revisions_workspace_row_unique" ON "normalization_workbench_revisions" USING btree ("workspace_id","id");--> statement-breakpoint
ALTER TABLE "normalization_workbench_revisions" ADD CONSTRAINT "normalization_workbench_revisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "normalization_workbench_revisions" ADD CONSTRAINT "normalization_workbench_revisions_set_scope_fk" FOREIGN KEY ("workspace_id","set_id") REFERENCES "public"."guidance_sets"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "normalization_workbench_revisions_workspace_ref_revision_unique" ON "normalization_workbench_revisions" USING btree ("workspace_id","normalization_ref","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "normalization_workbench_revisions_workspace_hash_unique" ON "normalization_workbench_revisions" USING btree ("workspace_id","revision_hash");--> statement-breakpoint
CREATE INDEX "normalization_workbench_revisions_workspace_head_idx" ON "normalization_workbench_revisions" USING btree ("workspace_id","normalization_ref","revision");--> statement-breakpoint
CREATE INDEX "normalization_workbench_revisions_source_snapshot_idx" ON "normalization_workbench_revisions" USING btree ("workspace_id","source_key","source_version","card_key","set_key");--> statement-breakpoint
ALTER TABLE "normalization_workbench_revisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "normalization_workbench_revisions" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "normalization_workbench_revisions" FROM PUBLIC, anon, authenticated, service_role;--> statement-breakpoint
CREATE FUNCTION normalization_workbench_revision_guard() RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  expected_previous text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.revision = 1 THEN
      IF EXISTS (
        SELECT 1 FROM public.normalization_workbench_revisions
        WHERE workspace_id = NEW.workspace_id AND normalization_ref = NEW.normalization_ref
      ) THEN
        RAISE EXCEPTION 'normalization_workbench_genesis_conflict';
      END IF;
    ELSE
      SELECT revision_hash INTO expected_previous
      FROM public.normalization_workbench_revisions
      WHERE workspace_id = NEW.workspace_id AND normalization_ref = NEW.normalization_ref
        AND revision = NEW.revision - 1;
      IF expected_previous IS NULL OR expected_previous <> NEW.previous_revision_hash THEN
        RAISE EXCEPTION 'normalization_workbench_chain_conflict';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' AND EXISTS (
    SELECT 1 FROM public.workspaces WHERE id = OLD.workspace_id AND lifecycle_state = 'tombstoning'
  ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'normalization_workbench_revision_immutable';
END;
$$;--> statement-breakpoint
CREATE TRIGGER normalization_workbench_revision_guard_trigger
BEFORE INSERT OR UPDATE OR DELETE ON normalization_workbench_revisions
FOR EACH ROW EXECUTE FUNCTION normalization_workbench_revision_guard();--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION normalization_workbench_revision_guard() FROM PUBLIC, anon, authenticated, service_role;
