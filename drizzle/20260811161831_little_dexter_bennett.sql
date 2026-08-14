CREATE TABLE "robust_cohort_diagnostic_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"target_evidence_id" uuid NOT NULL,
	"cohort_ref" text NOT NULL,
	"cohort_hash" text NOT NULL,
	"profile" jsonb NOT NULL,
	"member_evidence_refs" jsonb NOT NULL,
	"result_payload" jsonb NOT NULL,
	"capabilities" jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "robust_cohort_diagnostic_assets_hashes" CHECK ("robust_cohort_diagnostic_assets"."cohort_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "robust_cohort_diagnostic_assets_shape" CHECK (jsonb_typeof("robust_cohort_diagnostic_assets"."profile") = 'object' and jsonb_typeof("robust_cohort_diagnostic_assets"."member_evidence_refs") = 'array' and jsonb_array_length("robust_cohort_diagnostic_assets"."member_evidence_refs") >= 1 and jsonb_array_length("robust_cohort_diagnostic_assets"."member_evidence_refs") <= 100 and jsonb_typeof("robust_cohort_diagnostic_assets"."result_payload") = 'object'),
	CONSTRAINT "robust_cohort_diagnostic_assets_advisory_only" CHECK ("robust_cohort_diagnostic_assets"."capabilities" = '{"canAuthorizeAction":false,"canExecuteWrite":false,"canWriteMeta":false,"canPublish":false,"canApprove":false,"canExecute":false,"canAccessNetwork":false}'::jsonb)
);
--> statement-breakpoint
ALTER TABLE "robust_cohort_diagnostic_assets" ADD CONSTRAINT "robust_cohort_diagnostic_assets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "robust_cohort_diagnostic_assets" ADD CONSTRAINT "robust_cohort_diagnostic_assets_target_scope_fk" FOREIGN KEY ("workspace_id","target_evidence_id") REFERENCES "public"."frozen_diagnostic_evidence"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "robust_cohort_diagnostic_assets_workspace_id_unique" ON "robust_cohort_diagnostic_assets" USING btree ("workspace_id","id");--> statement-breakpoint
CREATE UNIQUE INDEX "robust_cohort_diagnostic_assets_hash_unique" ON "robust_cohort_diagnostic_assets" USING btree ("workspace_id","cohort_hash");--> statement-breakpoint
CREATE INDEX "robust_cohort_diagnostic_assets_target_idx" ON "robust_cohort_diagnostic_assets" USING btree ("workspace_id","target_evidence_id","occurred_at");
--> statement-breakpoint
ALTER TABLE "robust_cohort_diagnostic_assets" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "robust_cohort_diagnostic_assets" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "robust_cohort_diagnostic_assets" FROM PUBLIC, anon, authenticated, service_role;
--> statement-breakpoint
CREATE FUNCTION public.robust_cohort_diagnostic_asset_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' AND EXISTS (
    SELECT 1 FROM public.workspaces WHERE id = OLD.workspace_id AND lifecycle_state = 'tombstoning'
  ) THEN RETURN OLD; END IF;
  RAISE EXCEPTION 'robust_cohort_diagnostic_asset_append_only';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER robust_cohort_diagnostic_assets_append_only BEFORE UPDATE OR DELETE ON "robust_cohort_diagnostic_assets" FOR EACH ROW EXECUTE FUNCTION public.robust_cohort_diagnostic_asset_guard();
--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION public.robust_cohort_diagnostic_asset_guard() FROM PUBLIC, anon, authenticated, service_role;
