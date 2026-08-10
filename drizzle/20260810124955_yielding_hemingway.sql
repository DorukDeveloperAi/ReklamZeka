CREATE TABLE "experiment_record_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"cadence_profile_revision_id" uuid NOT NULL,
	"experiment_ref" text NOT NULL,
	"sequence" integer NOT NULL,
	"previous_record_hash" text NOT NULL,
	"record_hash" text NOT NULL,
	"event_type" text NOT NULL,
	"plan_hash" text NOT NULL,
	"plan_payload" jsonb NOT NULL,
	"outcome_payload" jsonb,
	"actor_ref" text NOT NULL,
	"actor_role" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "experiment_record_revisions_shape" CHECK ((
    "experiment_record_revisions"."experiment_ref" ~ '^experiment_[a-f0-9]{20}$' and "experiment_record_revisions"."sequence" >= 1
    and ("experiment_record_revisions"."previous_record_hash" = 'GENESIS' or "experiment_record_revisions"."previous_record_hash" ~ '^[a-f0-9]{64}$')
    and "experiment_record_revisions"."record_hash" ~ '^[a-f0-9]{64}$' and "experiment_record_revisions"."plan_hash" ~ '^[a-f0-9]{64}$'
    and "experiment_record_revisions"."event_type" in ('planned', 'outcome_recorded') and "experiment_record_revisions"."actor_role" in ('owner', 'admin', 'analyst')
    and jsonb_typeof("experiment_record_revisions"."plan_payload") = 'object' and "experiment_record_revisions"."plan_payload" #>> '{version}' = 'decision-experiment/1.0.0'
    and (("experiment_record_revisions"."event_type" = 'planned' and "experiment_record_revisions"."sequence" = 1 and "experiment_record_revisions"."previous_record_hash" = 'GENESIS' and "experiment_record_revisions"."outcome_payload" is null)
      or ("experiment_record_revisions"."event_type" = 'outcome_recorded' and "experiment_record_revisions"."sequence" > 1 and "experiment_record_revisions"."outcome_payload" is not null
        and jsonb_typeof("experiment_record_revisions"."outcome_payload") = 'object' and "experiment_record_revisions"."outcome_payload" #>> '{version}' = 'decision-experiment/1.0.0'
        and "experiment_record_revisions"."outcome_payload" #>> '{actionAuthority}' = 'none'))
  ) is true),
	CONSTRAINT "experiment_record_revisions_no_forbidden_material" CHECK (
    concat_ws('|', "experiment_record_revisions"."plan_payload"::text, "experiment_record_revisions"."outcome_payload"::text) !~* '"[^"[:space:]]*(token|secret|prompt)"[[:space:]]*:'
    and concat_ws('|', "experiment_record_revisions"."plan_payload"::text, "experiment_record_revisions"."outcome_payload"::text) !~* '"authorization"[[:space:]]*:'
  )
);
--> statement-breakpoint
ALTER TABLE "experiment_record_revisions" ADD CONSTRAINT "experiment_record_revisions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_record_revisions" ADD CONSTRAINT "experiment_record_revisions_account_scope_fk" FOREIGN KEY ("workspace_id","ad_account_id") REFERENCES "public"."ad_accounts"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_record_revisions" ADD CONSTRAINT "experiment_record_revisions_campaign_scope_fk" FOREIGN KEY ("workspace_id","campaign_id") REFERENCES "public"."ad_campaigns"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "experiment_record_revisions" ADD CONSTRAINT "experiment_record_revisions_cadence_profile_scope_fk" FOREIGN KEY ("workspace_id","cadence_profile_revision_id") REFERENCES "public"."decision_cadence_profile_revisions"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "experiment_record_revisions_workspace_row_unique" ON "experiment_record_revisions" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "experiment_record_revisions_sequence_unique" ON "experiment_record_revisions" USING btree ("workspace_id","experiment_ref","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "experiment_record_revisions_hash_unique" ON "experiment_record_revisions" USING btree ("workspace_id","record_hash");--> statement-breakpoint
CREATE INDEX "experiment_record_revisions_scope_idx" ON "experiment_record_revisions" USING btree ("workspace_id","ad_account_id","campaign_id","occurred_at");
--> statement-breakpoint
CREATE FUNCTION experiment_record_revision_chain_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
DECLARE prior_hash text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM public.workspaces WHERE id = OLD.workspace_id AND lifecycle_state = 'tombstoning') THEN RETURN OLD; END IF;
    RAISE EXCEPTION 'experiment_record_revision_immutable';
  END IF;
  IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'experiment_record_revision_immutable'; END IF;
  IF NEW.sequence = 1 THEN
    IF NEW.previous_record_hash <> 'GENESIS' OR EXISTS (SELECT 1 FROM public.experiment_record_revisions WHERE workspace_id = NEW.workspace_id AND experiment_ref = NEW.experiment_ref) THEN
      RAISE EXCEPTION 'experiment_record_genesis_conflict';
    END IF;
  ELSE
    SELECT record_hash INTO prior_hash FROM public.experiment_record_revisions
      WHERE workspace_id = NEW.workspace_id AND experiment_ref = NEW.experiment_ref AND sequence = NEW.sequence - 1;
    IF prior_hash IS NULL OR prior_hash <> NEW.previous_record_hash THEN RAISE EXCEPTION 'experiment_record_chain_conflict'; END IF;
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER experiment_record_revisions_chain_trigger BEFORE INSERT OR UPDATE OR DELETE ON experiment_record_revisions
FOR EACH ROW EXECUTE FUNCTION experiment_record_revision_chain_guard();
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION experiment_record_revision_chain_guard() FROM PUBLIC, anon, authenticated, service_role;
--> statement-breakpoint
ALTER TABLE experiment_record_revisions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE experiment_record_revisions FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE experiment_record_revisions FROM PUBLIC, anon, authenticated, service_role;
