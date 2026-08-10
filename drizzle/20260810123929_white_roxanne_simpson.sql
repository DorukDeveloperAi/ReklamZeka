CREATE TABLE "decision_cadence_profile_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"profile_ref" text NOT NULL,
	"revision" integer NOT NULL,
	"profile_version" text NOT NULL,
	"profile_hash" text NOT NULL,
	"profile_payload" jsonb NOT NULL,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "decision_cadence_profile_revisions_shape" CHECK ((
    "decision_cadence_profile_revisions"."profile_ref" ~ '^cadence_[a-z0-9][a-z0-9_.:-]{0,126}$'
    and "decision_cadence_profile_revisions"."revision" >= 1 and "decision_cadence_profile_revisions"."profile_version" = 'decision-cadence/1.0.0'
    and "decision_cadence_profile_revisions"."profile_hash" ~ '^[a-f0-9]{64}$' and jsonb_typeof("decision_cadence_profile_revisions"."profile_payload") = 'object'
    and "decision_cadence_profile_revisions"."profile_payload" #>> '{version}' = "decision_cadence_profile_revisions"."profile_version"
  ) is true),
	CONSTRAINT "decision_cadence_profile_revisions_no_forbidden_material" CHECK (
    "decision_cadence_profile_revisions"."profile_payload"::text !~* '"[^"[:space:]]*(token|secret|prompt)"[[:space:]]*:'
    and "decision_cadence_profile_revisions"."profile_payload"::text !~* '"authorization"[[:space:]]*:'
    and "decision_cadence_profile_revisions"."profile_payload"::text !~* '"[^"[:space:]]*raw[_-]?(payload|request|response|json)"[[:space:]]*:'
  )
);
--> statement-breakpoint
ALTER TABLE "decision_cadence_profile_revisions" ADD CONSTRAINT "decision_cadence_profile_revisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_cadence_profile_revisions" ADD CONSTRAINT "decision_cadence_profile_revisions_account_scope_fk" FOREIGN KEY ("workspace_id","ad_account_id") REFERENCES "public"."ad_accounts"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_cadence_profile_revisions" ADD CONSTRAINT "decision_cadence_profile_revisions_campaign_scope_fk" FOREIGN KEY ("workspace_id","campaign_id") REFERENCES "public"."ad_campaigns"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "decision_cadence_profile_revisions_workspace_row_unique" ON "decision_cadence_profile_revisions" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "decision_cadence_profile_revisions_workspace_ref_revision_unique" ON "decision_cadence_profile_revisions" USING btree ("workspace_id","profile_ref","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "decision_cadence_profile_revisions_workspace_ref_hash_unique" ON "decision_cadence_profile_revisions" USING btree ("workspace_id","profile_ref","profile_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "decision_cadence_profile_revisions_workspace_current_unique" ON "decision_cadence_profile_revisions" USING btree ("workspace_id","profile_ref") WHERE "decision_cadence_profile_revisions"."superseded_at" is null;--> statement-breakpoint
CREATE INDEX "decision_cadence_profile_revisions_scope_idx" ON "decision_cadence_profile_revisions" USING btree ("workspace_id","ad_account_id","campaign_id","profile_ref");
--> statement-breakpoint
CREATE FUNCTION decision_cadence_profile_revision_immutable() RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.workspaces WHERE id = OLD.workspace_id AND lifecycle_state = 'tombstoning') THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'decision_cadence_profile_revision_immutable';
  END IF;
  IF (to_jsonb(NEW) - 'superseded_at') <> (to_jsonb(OLD) - 'superseded_at')
     OR OLD.superseded_at IS NOT NULL OR NEW.superseded_at IS NULL THEN
    RAISE EXCEPTION 'decision_cadence_profile_revision_immutable';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER decision_cadence_profile_revisions_immutable_trigger
BEFORE UPDATE OR DELETE ON decision_cadence_profile_revisions
FOR EACH ROW EXECUTE FUNCTION decision_cadence_profile_revision_immutable();
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION decision_cadence_profile_revision_immutable() FROM PUBLIC, anon, authenticated, service_role;
--> statement-breakpoint
ALTER TABLE decision_cadence_profile_revisions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE decision_cadence_profile_revisions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE decision_cadence_profile_revisions FROM PUBLIC, anon, authenticated, service_role;
