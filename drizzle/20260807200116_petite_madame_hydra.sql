CREATE TABLE "meta_compatibility_artifact_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"artifact_ref" text NOT NULL,
	"revision" integer NOT NULL,
	"schema_version" text NOT NULL,
	"workspace_ref" text NOT NULL,
	"artifact_kind" text NOT NULL,
	"dimension" text NOT NULL,
	"state" text NOT NULL,
	"selection_hash" text,
	"outcome" text,
	"previous_hash" text,
	"reviewed_by_actor_ref" text,
	"reviewed_by_role" text,
	"review_decision_ref" text,
	"reviewed_at" timestamp with time zone,
	"review_by" timestamp with time zone,
	"published_by_actor_ref" text,
	"published_by_role" text,
	"publication_decision_ref" text,
	"published_at" timestamp with time zone,
	"tombstoned_by_actor_ref" text,
	"tombstone_decision_ref" text,
	"tombstoned_at" timestamp with time zone,
	"canonical_hash" text NOT NULL,
	"artifact_payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meta_compatibility_artifact_revisions_identity" CHECK (
    "meta_compatibility_artifact_revisions"."revision" between 1 and 1000000
    and "meta_compatibility_artifact_revisions"."schema_version" = 'meta-compatibility-artifact/1.0.0'
    and "meta_compatibility_artifact_revisions"."artifact_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and "meta_compatibility_artifact_revisions"."workspace_ref" ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and "meta_compatibility_artifact_revisions"."artifact_kind" in ('mapping', 'evidence')
    and "meta_compatibility_artifact_revisions"."dimension" in ('destination', 'optimization', 'placement', 'special_category', 'tracking')
    and "meta_compatibility_artifact_revisions"."state" in ('draft', 'reviewed', 'published', 'tombstoned')
    and "meta_compatibility_artifact_revisions"."canonical_hash" ~ '^[a-f0-9]{64}$'
    and ("meta_compatibility_artifact_revisions"."previous_hash" is null or "meta_compatibility_artifact_revisions"."previous_hash" ~ '^[a-f0-9]{64}$')
  ),
	CONSTRAINT "meta_compatibility_artifact_revisions_kind_shape" CHECK (
    ("meta_compatibility_artifact_revisions"."artifact_kind" = 'mapping' and "meta_compatibility_artifact_revisions"."selection_hash" is null and "meta_compatibility_artifact_revisions"."outcome" is null)
    or ("meta_compatibility_artifact_revisions"."artifact_kind" = 'evidence' and "meta_compatibility_artifact_revisions"."selection_hash" ~ '^[a-f0-9]{64}$'
      and "meta_compatibility_artifact_revisions"."outcome" in ('confirmed', 'rejected', 'unknown'))
  ),
	CONSTRAINT "meta_compatibility_artifact_revisions_lifecycle" CHECK (
    ("meta_compatibility_artifact_revisions"."state" = 'draft' and "meta_compatibility_artifact_revisions"."revision" = 1 and "meta_compatibility_artifact_revisions"."previous_hash" is null
      and "meta_compatibility_artifact_revisions"."reviewed_by_actor_ref" is null and "meta_compatibility_artifact_revisions"."reviewed_by_role" is null and "meta_compatibility_artifact_revisions"."review_decision_ref" is null
      and "meta_compatibility_artifact_revisions"."reviewed_at" is null and "meta_compatibility_artifact_revisions"."review_by" is null
      and "meta_compatibility_artifact_revisions"."published_by_actor_ref" is null and "meta_compatibility_artifact_revisions"."published_by_role" is null and "meta_compatibility_artifact_revisions"."publication_decision_ref" is null and "meta_compatibility_artifact_revisions"."published_at" is null
      and "meta_compatibility_artifact_revisions"."tombstoned_by_actor_ref" is null and "meta_compatibility_artifact_revisions"."tombstone_decision_ref" is null and "meta_compatibility_artifact_revisions"."tombstoned_at" is null)
    or ("meta_compatibility_artifact_revisions"."state" = 'reviewed' and "meta_compatibility_artifact_revisions"."revision" >= 2 and "meta_compatibility_artifact_revisions"."previous_hash" is not null
      and "meta_compatibility_artifact_revisions"."reviewed_by_actor_ref" is not null and "meta_compatibility_artifact_revisions"."reviewed_by_role" in ('owner', 'admin')
      and "meta_compatibility_artifact_revisions"."review_decision_ref" is not null and "meta_compatibility_artifact_revisions"."reviewed_at" is not null and "meta_compatibility_artifact_revisions"."review_by" > "meta_compatibility_artifact_revisions"."reviewed_at"
      and "meta_compatibility_artifact_revisions"."published_by_actor_ref" is null and "meta_compatibility_artifact_revisions"."published_by_role" is null and "meta_compatibility_artifact_revisions"."publication_decision_ref" is null and "meta_compatibility_artifact_revisions"."published_at" is null
      and "meta_compatibility_artifact_revisions"."tombstoned_by_actor_ref" is null and "meta_compatibility_artifact_revisions"."tombstone_decision_ref" is null and "meta_compatibility_artifact_revisions"."tombstoned_at" is null)
    or ("meta_compatibility_artifact_revisions"."state" = 'published' and "meta_compatibility_artifact_revisions"."revision" >= 3 and "meta_compatibility_artifact_revisions"."previous_hash" is not null
      and "meta_compatibility_artifact_revisions"."reviewed_by_actor_ref" is not null and "meta_compatibility_artifact_revisions"."reviewed_by_role" in ('owner', 'admin')
      and "meta_compatibility_artifact_revisions"."review_decision_ref" is not null and "meta_compatibility_artifact_revisions"."reviewed_at" is not null
      and "meta_compatibility_artifact_revisions"."published_by_actor_ref" is not null and "meta_compatibility_artifact_revisions"."published_by_role" in ('owner', 'admin')
      and "meta_compatibility_artifact_revisions"."publication_decision_ref" is not null and "meta_compatibility_artifact_revisions"."published_at" >= "meta_compatibility_artifact_revisions"."reviewed_at" and "meta_compatibility_artifact_revisions"."review_by" > "meta_compatibility_artifact_revisions"."published_at"
      and "meta_compatibility_artifact_revisions"."tombstoned_by_actor_ref" is null and "meta_compatibility_artifact_revisions"."tombstone_decision_ref" is null and "meta_compatibility_artifact_revisions"."tombstoned_at" is null)
    or ("meta_compatibility_artifact_revisions"."state" = 'tombstoned' and "meta_compatibility_artifact_revisions"."revision" >= 4 and "meta_compatibility_artifact_revisions"."previous_hash" is not null
      and "meta_compatibility_artifact_revisions"."reviewed_by_actor_ref" is not null and "meta_compatibility_artifact_revisions"."reviewed_by_role" in ('owner', 'admin')
      and "meta_compatibility_artifact_revisions"."review_decision_ref" is not null and "meta_compatibility_artifact_revisions"."reviewed_at" is not null
      and "meta_compatibility_artifact_revisions"."published_by_actor_ref" is not null and "meta_compatibility_artifact_revisions"."published_by_role" in ('owner', 'admin')
      and "meta_compatibility_artifact_revisions"."publication_decision_ref" is not null and "meta_compatibility_artifact_revisions"."published_at" >= "meta_compatibility_artifact_revisions"."reviewed_at" and "meta_compatibility_artifact_revisions"."review_by" > "meta_compatibility_artifact_revisions"."published_at"
      and "meta_compatibility_artifact_revisions"."tombstoned_by_actor_ref" is not null and "meta_compatibility_artifact_revisions"."tombstone_decision_ref" is not null and "meta_compatibility_artifact_revisions"."tombstoned_at" >= "meta_compatibility_artifact_revisions"."published_at")
  ),
	CONSTRAINT "meta_compatibility_artifact_revisions_payload_exact" CHECK (
    jsonb_typeof("meta_compatibility_artifact_revisions"."artifact_payload") = 'object'
    and "meta_compatibility_artifact_revisions"."artifact_payload" #>> '{version}' = "meta_compatibility_artifact_revisions"."schema_version"
    and "meta_compatibility_artifact_revisions"."artifact_payload" #>> '{artifactRef}' = "meta_compatibility_artifact_revisions"."artifact_ref"
    and ("meta_compatibility_artifact_revisions"."artifact_payload" #>> '{revision}')::integer = "meta_compatibility_artifact_revisions"."revision"
    and "meta_compatibility_artifact_revisions"."artifact_payload" #>> '{workspaceRef}' = "meta_compatibility_artifact_revisions"."workspace_ref"
    and "meta_compatibility_artifact_revisions"."artifact_payload" #>> '{dimension}' = "meta_compatibility_artifact_revisions"."dimension"
    and "meta_compatibility_artifact_revisions"."artifact_payload" #>> '{state}' = "meta_compatibility_artifact_revisions"."state"
    and "meta_compatibility_artifact_revisions"."artifact_payload" #>> '{content,kind}' = "meta_compatibility_artifact_revisions"."artifact_kind"
    and ("meta_compatibility_artifact_revisions"."artifact_payload" #>> '{content,selectionHash}') is not distinct from "meta_compatibility_artifact_revisions"."selection_hash"
    and ("meta_compatibility_artifact_revisions"."artifact_payload" #>> '{content,outcome}') is not distinct from "meta_compatibility_artifact_revisions"."outcome"
    and ("meta_compatibility_artifact_revisions"."artifact_payload" #>> '{previousHash}') is not distinct from "meta_compatibility_artifact_revisions"."previous_hash"
    and "meta_compatibility_artifact_revisions"."artifact_payload" #>> '{canonicalHash}' = "meta_compatibility_artifact_revisions"."canonical_hash"
    and "meta_compatibility_artifact_revisions"."artifact_payload" #>> '{authority,canExecute}' = 'false'
    and "meta_compatibility_artifact_revisions"."artifact_payload" #>> '{authority,canWriteMeta}' = 'false'
    and "meta_compatibility_artifact_revisions"."artifact_payload" #>> '{authority,canGrantApproval}' = 'false'
    and "meta_compatibility_artifact_revisions"."artifact_payload" #>> '{authority,canCreatePolicy}' = 'false'
    and "meta_compatibility_artifact_revisions"."artifact_payload" #>> '{authority,canPromoteGuidance}' = 'false'
  ),
	CONSTRAINT "meta_compatibility_artifact_revisions_no_forbidden_material" CHECK (
    "meta_compatibility_artifact_revisions"."artifact_payload"::text
      !~* '"[^"[:space:]]*(token|secret|prompt|raw[_-]?(payload|request|response|json)|free[_-]?text)"[[:space:]]*:'
  )
);
--> statement-breakpoint
ALTER TABLE "meta_compatibility_artifact_revisions" ADD CONSTRAINT "meta_compatibility_artifact_revisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "meta_compatibility_artifact_revisions_workspace_row_unique" ON "meta_compatibility_artifact_revisions" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "meta_compatibility_artifact_revisions_identity_unique" ON "meta_compatibility_artifact_revisions" USING btree ("workspace_id","artifact_ref","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "meta_compatibility_artifact_revisions_hash_unique" ON "meta_compatibility_artifact_revisions" USING btree ("workspace_id","canonical_hash");--> statement-breakpoint
CREATE INDEX "meta_compatibility_artifact_revisions_registry_idx" ON "meta_compatibility_artifact_revisions" USING btree ("workspace_id","state","artifact_kind","dimension","artifact_ref","revision");--> statement-breakpoint
CREATE INDEX "meta_compatibility_artifact_revisions_selection_idx" ON "meta_compatibility_artifact_revisions" USING btree ("workspace_id","selection_hash","dimension","state","revision");
--> statement-breakpoint
ALTER TABLE meta_compatibility_artifact_revisions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE meta_compatibility_artifact_revisions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE meta_compatibility_artifact_revisions FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE POLICY meta_compatibility_artifact_revisions_tenant_select ON meta_compatibility_artifact_revisions
FOR SELECT TO authenticated
USING (exists (
  select 1 from memberships membership
  where membership.workspace_id = meta_compatibility_artifact_revisions.workspace_id
    and membership.user_id = (select auth.uid())
));
--> statement-breakpoint
CREATE FUNCTION meta_compatibility_artifact_append_only() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'meta_compatibility_artifact_append_only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER meta_compatibility_artifact_revisions_append_only_trigger
BEFORE UPDATE ON meta_compatibility_artifact_revisions
FOR EACH ROW EXECUTE FUNCTION meta_compatibility_artifact_append_only();
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION meta_compatibility_artifact_append_only() FROM PUBLIC, anon, authenticated;
