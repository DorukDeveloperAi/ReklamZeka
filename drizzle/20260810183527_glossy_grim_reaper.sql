CREATE TABLE "deterministic_window_snapshot_features" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"window_snapshot_id" uuid NOT NULL,
	"feature_snapshot_id" uuid NOT NULL,
	"feature_ref" text NOT NULL,
	"feature_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deterministic_window_snapshot_features_shape" CHECK ("deterministic_window_snapshot_features"."feature_ref" ~ '^feature_[a-f0-9]{24}$' and "deterministic_window_snapshot_features"."feature_hash" ~ '^[a-f0-9]{64}$')
);
--> statement-breakpoint
CREATE TABLE "deterministic_window_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"meta_connection_id" uuid NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"entity_level" "meta_insight_entity_level" NOT NULL,
	"external_entity_id" text NOT NULL,
	"window_ref" text NOT NULL,
	"window_hash" text NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date NOT NULL,
	"window_payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deterministic_window_snapshots_shape" CHECK ("deterministic_window_snapshots"."window_ref" ~ '^window_[a-f0-9]{24}$' and "deterministic_window_snapshots"."window_hash" ~ '^[a-f0-9]{64}$' and "deterministic_window_snapshots"."start_date" <= "deterministic_window_snapshots"."end_date" and "deterministic_window_snapshots"."window_payload" #>> '{windowRef}' = "deterministic_window_snapshots"."window_ref" and "deterministic_window_snapshots"."window_payload" #>> '{windowHash}' = "deterministic_window_snapshots"."window_hash"),
	CONSTRAINT "deterministic_window_snapshots_no_authority" CHECK ("deterministic_window_snapshots"."window_payload" #> '{capabilities,containsRawL0}' = 'false'::jsonb and "deterministic_window_snapshots"."window_payload" #> '{capabilities,canAuthorizeAction}' = 'false'::jsonb and "deterministic_window_snapshots"."window_payload" #> '{capabilities,canExecuteWrite}' = 'false'::jsonb)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "deterministic_window_snapshots_workspace_id_unique" ON "deterministic_window_snapshots" USING btree ("workspace_id","id");--> statement-breakpoint
ALTER TABLE "deterministic_window_snapshot_features" ADD CONSTRAINT "deterministic_window_snapshot_features_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deterministic_window_snapshot_features" ADD CONSTRAINT "deterministic_window_snapshot_features_window_scope_fk" FOREIGN KEY ("workspace_id","window_snapshot_id") REFERENCES "public"."deterministic_window_snapshots"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deterministic_window_snapshot_features" ADD CONSTRAINT "deterministic_window_snapshot_features_feature_scope_fk" FOREIGN KEY ("workspace_id","feature_snapshot_id") REFERENCES "public"."deterministic_feature_snapshots"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deterministic_window_snapshots" ADD CONSTRAINT "deterministic_window_snapshots_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deterministic_window_snapshots" ADD CONSTRAINT "deterministic_window_snapshots_connection_scope_fk" FOREIGN KEY ("workspace_id","meta_connection_id") REFERENCES "public"."meta_connections"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deterministic_window_snapshots" ADD CONSTRAINT "deterministic_window_snapshots_account_scope_fk" FOREIGN KEY ("workspace_id","ad_account_id") REFERENCES "public"."ad_accounts"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "deterministic_window_snapshot_features_exact_unique" ON "deterministic_window_snapshot_features" USING btree ("window_snapshot_id","feature_snapshot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "deterministic_window_snapshot_features_ref_unique" ON "deterministic_window_snapshot_features" USING btree ("window_snapshot_id","feature_ref");--> statement-breakpoint
CREATE INDEX "deterministic_window_snapshot_features_feature_idx" ON "deterministic_window_snapshot_features" USING btree ("workspace_id","feature_snapshot_id");--> statement-breakpoint
CREATE UNIQUE INDEX "deterministic_window_snapshots_workspace_ref_unique" ON "deterministic_window_snapshots" USING btree ("workspace_id","window_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "deterministic_window_snapshots_workspace_hash_unique" ON "deterministic_window_snapshots" USING btree ("workspace_id","window_hash");--> statement-breakpoint
CREATE INDEX "deterministic_window_snapshots_scope_idx" ON "deterministic_window_snapshots" USING btree ("workspace_id","ad_account_id","entity_level","external_entity_id","start_date","end_date");--> statement-breakpoint
ALTER TABLE "deterministic_window_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deterministic_window_snapshots" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deterministic_window_snapshot_features" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "deterministic_window_snapshot_features" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "deterministic_window_snapshots", "deterministic_window_snapshot_features" FROM PUBLIC, anon, authenticated, service_role;--> statement-breakpoint
CREATE FUNCTION deterministic_window_snapshot_immutable() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$ BEGIN IF TG_OP = 'DELETE' AND EXISTS (SELECT 1 FROM public.workspaces WHERE id = OLD.workspace_id AND lifecycle_state = 'tombstoning') THEN RETURN OLD; END IF; RAISE EXCEPTION 'deterministic window snapshots are append-only'; END; $$;--> statement-breakpoint
CREATE FUNCTION deterministic_window_snapshot_feature_immutable() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$ BEGIN IF TG_OP = 'DELETE' AND EXISTS (SELECT 1 FROM public.workspaces WHERE id = OLD.workspace_id AND lifecycle_state = 'tombstoning') THEN RETURN OLD; END IF; RAISE EXCEPTION 'deterministic window snapshot features are append-only'; END; $$;--> statement-breakpoint
CREATE TRIGGER deterministic_window_snapshot_guard BEFORE UPDATE OR DELETE ON deterministic_window_snapshots FOR EACH ROW EXECUTE FUNCTION deterministic_window_snapshot_immutable();--> statement-breakpoint
CREATE TRIGGER deterministic_window_snapshot_feature_guard BEFORE UPDATE OR DELETE ON deterministic_window_snapshot_features FOR EACH ROW EXECUTE FUNCTION deterministic_window_snapshot_feature_immutable();--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION deterministic_window_snapshot_immutable(), deterministic_window_snapshot_feature_immutable() FROM PUBLIC, anon, authenticated, service_role;
