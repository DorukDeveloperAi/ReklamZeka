CREATE TABLE "progressive_formalization_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"workspace_ref" text NOT NULL,
	"formalization_ref" text NOT NULL,
	"sequence" integer NOT NULL,
	"previous_revision_hash" text NOT NULL,
	"from_level" text,
	"to_level" text NOT NULL,
	"transition" text NOT NULL,
	"actor_ref" text NOT NULL,
	"actor_role" text NOT NULL,
	"revision_hash" text NOT NULL,
	"revision_payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "progressive_formalization_identity" CHECK (
    "progressive_formalization_revisions"."workspace_ref" ~ '^workspace_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and "progressive_formalization_revisions"."formalization_ref" ~ '^formalization_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and "progressive_formalization_revisions"."actor_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and "progressive_formalization_revisions"."sequence" between 1 and 5
    and ("progressive_formalization_revisions"."previous_revision_hash" = 'GENESIS' or "progressive_formalization_revisions"."previous_revision_hash" ~ '^[a-f0-9]{64}$')
  ),
	CONSTRAINT "progressive_formalization_transition_exact" CHECK (
    ("progressive_formalization_revisions"."sequence" = 1 and "progressive_formalization_revisions"."previous_revision_hash" = 'GENESIS' and "progressive_formalization_revisions"."from_level" is null
      and "progressive_formalization_revisions"."to_level" = 'G0' and "progressive_formalization_revisions"."transition" = 'capture_g0')
    or ("progressive_formalization_revisions"."sequence" = 2 and "progressive_formalization_revisions"."from_level" = 'G0' and "progressive_formalization_revisions"."to_level" = 'G1'
      and "progressive_formalization_revisions"."transition" = 'scope_g1')
    or ("progressive_formalization_revisions"."sequence" = 3 and "progressive_formalization_revisions"."from_level" = 'G1' and "progressive_formalization_revisions"."to_level" = 'G2'
      and "progressive_formalization_revisions"."transition" = 'review_g2')
    or ("progressive_formalization_revisions"."sequence" = 4 and "progressive_formalization_revisions"."from_level" = 'G2' and "progressive_formalization_revisions"."to_level" = 'G3'
      and "progressive_formalization_revisions"."transition" = 'promote_g3')
    or ("progressive_formalization_revisions"."sequence" = 5 and "progressive_formalization_revisions"."from_level" = 'G3' and "progressive_formalization_revisions"."to_level" = 'G4'
      and "progressive_formalization_revisions"."transition" = 'qualify_g4')
  ),
	CONSTRAINT "progressive_formalization_payload_exact" CHECK ((
    jsonb_typeof("progressive_formalization_revisions"."revision_payload") = 'object'
    and "progressive_formalization_revisions"."revision_payload" #>> '{schemaVersion}' = 'progressive-formalization/1.0.0'
    and "progressive_formalization_revisions"."revision_payload" #>> '{workspaceRef}' = "progressive_formalization_revisions"."workspace_ref"
    and "progressive_formalization_revisions"."revision_payload" #>> '{formalizationRef}' = "progressive_formalization_revisions"."formalization_ref"
    and ("progressive_formalization_revisions"."revision_payload" #>> '{sequence}')::integer = "progressive_formalization_revisions"."sequence"
    and "progressive_formalization_revisions"."revision_payload" #>> '{previousRevisionHash}' = "progressive_formalization_revisions"."previous_revision_hash"
    and ("progressive_formalization_revisions"."revision_payload" #>> '{fromLevel}') is not distinct from "progressive_formalization_revisions"."from_level"
    and "progressive_formalization_revisions"."revision_payload" #>> '{toLevel}' = "progressive_formalization_revisions"."to_level"
    and "progressive_formalization_revisions"."revision_payload" #>> '{transition}' = "progressive_formalization_revisions"."transition"
    and "progressive_formalization_revisions"."revision_payload" #>> '{actor,actorRef}' = "progressive_formalization_revisions"."actor_ref"
    and "progressive_formalization_revisions"."revision_payload" #>> '{actor,role}' = "progressive_formalization_revisions"."actor_role"
    and "progressive_formalization_revisions"."revision_payload" #>> '{revisionHash}' = "progressive_formalization_revisions"."revision_hash"
    and ("progressive_formalization_revisions"."revision_payload" #>> '{occurredAt}')::timestamptz = "progressive_formalization_revisions"."occurred_at"
    and "progressive_formalization_revisions"."actor_role" in ('owner', 'admin', 'analyst')
    and ("progressive_formalization_revisions"."sequence" <= 2 or "progressive_formalization_revisions"."actor_role" in ('owner', 'admin'))
    and "progressive_formalization_revisions"."revision_hash" ~ '^[a-f0-9]{64}$'
    and jsonb_typeof("progressive_formalization_revisions"."revision_payload" #> '{payload}') = 'object'
    and "progressive_formalization_revisions"."revision_payload" #> '{authority,canPublish}' = 'false'::jsonb
    and "progressive_formalization_revisions"."revision_payload" #> '{authority,canApprove}' = 'false'::jsonb
    and "progressive_formalization_revisions"."revision_payload" #> '{authority,canExecute}' = 'false'::jsonb
    and "progressive_formalization_revisions"."revision_payload" #> '{authority,canWriteMeta}' = 'false'::jsonb
    and "progressive_formalization_revisions"."revision_payload" #> '{authority,canGrant}' = 'false'::jsonb
    and "progressive_formalization_revisions"."revision_payload" #> '{authority,canSchedule}' = 'false'::jsonb
    and "progressive_formalization_revisions"."revision_payload" #> '{authority,canCallTool}' = 'false'::jsonb
    and "progressive_formalization_revisions"."revision_payload" #> '{authority,canAccessNetwork}' = 'false'::jsonb
    and "progressive_formalization_revisions"."revision_payload" #> '{authority,canQuerySql}' = 'false'::jsonb
  ) is true),
	CONSTRAINT "progressive_formalization_nested_exact" CHECK ((
    ("progressive_formalization_revisions"."revision_payload"
      - 'schemaVersion' - 'formalizationRef' - 'workspaceRef' - 'sequence' - 'previousRevisionHash'
      - 'fromLevel' - 'toLevel' - 'transition' - 'occurredAt' - 'actor' - 'payload' - 'authority' - 'revisionHash') = '{}'::jsonb
    and ("progressive_formalization_revisions"."revision_payload" #> '{actor}' - 'actorRef' - 'role') = '{}'::jsonb
    and ("progressive_formalization_revisions"."revision_payload" #> '{authority}' - 'canPublish' - 'canApprove' - 'canExecute' - 'canWriteMeta'
      - 'canGrant' - 'canSchedule' - 'canCallTool' - 'canAccessNetwork' - 'canQuerySql') = '{}'::jsonb
    and case "progressive_formalization_revisions"."transition"
      when 'capture_g0' then
        ("progressive_formalization_revisions"."revision_payload" #> '{payload}' - 'rawProvenanceRef' - 'rawTextHash') = '{}'::jsonb
        and "progressive_formalization_revisions"."revision_payload" #>> '{payload,rawProvenanceRef}' ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
        and "progressive_formalization_revisions"."revision_payload" #>> '{payload,rawTextHash}' ~ '^[a-f0-9]{64}$'
      when 'scope_g1' then
        ("progressive_formalization_revisions"."revision_payload" #> '{payload}' - 'guidanceCardRefs' - 'scope') = '{}'::jsonb
        and jsonb_typeof("progressive_formalization_revisions"."revision_payload" #> '{payload,guidanceCardRefs}') = 'array'
        and jsonb_array_length("progressive_formalization_revisions"."revision_payload" #> '{payload,guidanceCardRefs}') between 1 and 1000
        and ("progressive_formalization_revisions"."revision_payload" #> '{payload,scope}' - 'global' - 'accountGroupRefs' - 'accountRefs'
          - 'objectiveRefs' - 'internalCategoryRefs' - 'entityRefs' - 'promotionTemplateRefs' - 'topicRefs') = '{}'::jsonb
      when 'review_g2' then
        ("progressive_formalization_revisions"."revision_payload" #> '{payload}' - 'guidanceSetRef' - 'reviewedGuidanceHash' - 'confirmation') = '{}'::jsonb
        and "progressive_formalization_revisions"."revision_payload" #>> '{payload,reviewedGuidanceHash}' ~ '^[a-f0-9]{64}$'
        and ("progressive_formalization_revisions"."revision_payload" #> '{payload,confirmation}' - 'confirmed' - 'confirmationRef' - 'confirmedAt') = '{}'::jsonb
        and "progressive_formalization_revisions"."revision_payload" #> '{payload,confirmation,confirmed}' = 'true'::jsonb
      when 'promote_g3' then
        ("progressive_formalization_revisions"."revision_payload" #> '{payload}' - 'normalizedDraft' - 'confirmation') = '{}'::jsonb
        and ("progressive_formalization_revisions"."revision_payload" #> '{payload,confirmation}' - 'confirmed' - 'confirmationRef' - 'confirmedAt') = '{}'::jsonb
        and "progressive_formalization_revisions"."revision_payload" #> '{payload,confirmation,confirmed}' = 'true'::jsonb
        and ("progressive_formalization_revisions"."revision_payload" #> '{payload,normalizedDraft}' - 'schemaVersion' - 'workspaceRef'
          - 'formalizationRef' - 'guidanceSetRef' - 'strictPolicy' - 'assumptions' - 'questions' - 'semanticDiff'
          - 'historicalReplay' - 'conflictPreview' - 'impactPreview' - 'authority' - 'draftHash') = '{}'::jsonb
        and ("progressive_formalization_revisions"."revision_payload" #> '{payload,normalizedDraft,authority}' - 'canPublish' - 'canApprove'
          - 'canExecute' - 'canWriteMeta' - 'canGrant' - 'canCallTool' - 'canAccessNetwork' - 'canQuerySql') = '{}'::jsonb
        and ("progressive_formalization_revisions"."revision_payload" #> '{payload,normalizedDraft,strictPolicy}' - 'dslVersion' - 'workspaceRef'
          - 'policyRef' - 'policyVersion' - 'previousVersionHash' - 'policyType' - 'owner' - 'status' - 'reasonCode'
          - 'priority' - 'effectiveDates' - 'scope' - 'source' - 'clause' - 'authority' - 'canonicalHash') = '{}'::jsonb
        and ("progressive_formalization_revisions"."revision_payload" #> '{payload,normalizedDraft,semanticDiff}' - 'status' - 'items' - 'diffHash') = '{}'::jsonb
        and ("progressive_formalization_revisions"."revision_payload" #> '{payload,normalizedDraft,historicalReplay}' - 'status'
          - 'evaluatedRevisionRefs' - 'changedOutcomeRefs' - 'unknownOutcomeRefs' - 'replayHash') = '{}'::jsonb
        and ("progressive_formalization_revisions"."revision_payload" #> '{payload,normalizedDraft,conflictPreview}' - 'status' - 'conflictRefs' - 'previewHash') = '{}'::jsonb
        and ("progressive_formalization_revisions"."revision_payload" #> '{payload,normalizedDraft,impactPreview}' - 'status' - 'affectedScopeRefs'
          - 'affectedEntityCount' - 'affectedPolicyCount' - 'affectedBudgetCount' - 'affectedAutomationCount'
          - 'unresolvedDependencyRefs' - 'previewHash') = '{}'::jsonb
      when 'qualify_g4' then
        ("progressive_formalization_revisions"."revision_payload" #> '{payload}' - 'publishedPolicyRef' - 'publishedPolicyHash'
          - 'riskAssessmentRef' - 'capPolicyRef' - 'approvalPolicyRef' - 'rolloutEvidenceRefs'
          - 'actionValveRef' - 'approvalMode' - 'confirmation') = '{}'::jsonb
        and "progressive_formalization_revisions"."revision_payload" #>> '{payload,approvalMode}' = 'approval_only'
        and "progressive_formalization_revisions"."revision_payload" #>> '{payload,publishedPolicyHash}' ~ '^[a-f0-9]{64}$'
        and jsonb_typeof("progressive_formalization_revisions"."revision_payload" #> '{payload,rolloutEvidenceRefs}') = 'array'
        and jsonb_array_length("progressive_formalization_revisions"."revision_payload" #> '{payload,rolloutEvidenceRefs}') between 1 and 1000
        and ("progressive_formalization_revisions"."revision_payload" #> '{payload,confirmation}' - 'confirmed' - 'confirmationRef' - 'confirmedAt') = '{}'::jsonb
        and "progressive_formalization_revisions"."revision_payload" #> '{payload,confirmation,confirmed}' = 'true'::jsonb
      else false
    end
  ) is true),
	CONSTRAINT "progressive_formalization_no_forbidden_material" CHECK (
    "progressive_formalization_revisions"."revision_payload"::text !~* '"[^"[:space:]]*(token|secret|prompt|raw[_-]?(payload|request|response|json)|authorization|approvalgranted)"[[:space:]]*:'
    and "progressive_formalization_revisions"."revision_payload"::text !~* '"(canPublish|canApprove|canExecute|canWriteMeta|canGrant|canSchedule|canCallTool|canAccessNetwork|canQuerySql)"[[:space:]]*:[[:space:]]*true'
  )
);
--> statement-breakpoint
ALTER TABLE "progressive_formalization_revisions" ADD CONSTRAINT "progressive_formalization_revisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "progressive_formalization_workspace_row_unique" ON "progressive_formalization_revisions" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "progressive_formalization_workspace_sequence_unique" ON "progressive_formalization_revisions" USING btree ("workspace_id","formalization_ref","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "progressive_formalization_workspace_hash_unique" ON "progressive_formalization_revisions" USING btree ("workspace_id","revision_hash");--> statement-breakpoint
CREATE INDEX "progressive_formalization_workspace_head_idx" ON "progressive_formalization_revisions" USING btree ("workspace_id","formalization_ref","sequence");
--> statement-breakpoint
ALTER TABLE "progressive_formalization_revisions" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "progressive_formalization_revisions" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "progressive_formalization_revisions" FROM PUBLIC, anon, authenticated, service_role;
--> statement-breakpoint
CREATE FUNCTION progressive_formalization_revision_guard() RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  expected_previous text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.sequence = 1 THEN
      IF EXISTS (
        SELECT 1 FROM public.progressive_formalization_revisions
        WHERE workspace_id = NEW.workspace_id AND formalization_ref = NEW.formalization_ref
      ) THEN
        RAISE EXCEPTION 'progressive_formalization_genesis_conflict';
      END IF;
    ELSE
      SELECT revision_hash INTO expected_previous
      FROM public.progressive_formalization_revisions
      WHERE workspace_id = NEW.workspace_id AND formalization_ref = NEW.formalization_ref
        AND sequence = NEW.sequence - 1;
      IF expected_previous IS NULL OR expected_previous <> NEW.previous_revision_hash THEN
        RAISE EXCEPTION 'progressive_formalization_chain_conflict';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' AND EXISTS (
    SELECT 1 FROM public.workspaces
    WHERE id = OLD.workspace_id AND lifecycle_state = 'tombstoning'
  ) THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'progressive_formalization_revision_immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER progressive_formalization_revision_guard_trigger
BEFORE INSERT OR UPDATE OR DELETE ON progressive_formalization_revisions
FOR EACH ROW EXECUTE FUNCTION progressive_formalization_revision_guard();
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION progressive_formalization_revision_guard()
  FROM PUBLIC, anon, authenticated, service_role;
