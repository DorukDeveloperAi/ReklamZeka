CREATE TABLE "meta_change_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"meta_connection_id" uuid NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"previous_snapshot_id" uuid NOT NULL,
	"current_snapshot_id" uuid NOT NULL,
	"change_ref" text NOT NULL,
	"entity_ref" text NOT NULL,
	"entity_type" text NOT NULL,
	"field" text NOT NULL,
	"before_value" jsonb NOT NULL,
	"after_value" jsonb NOT NULL,
	"classification" text NOT NULL,
	"correlated_action_ref" text,
	"timeline_hash" text NOT NULL,
	"field_catalog_version" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"detected_at" timestamp with time zone NOT NULL,
	"persisted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meta_change_events_distinct_snapshots" CHECK ("meta_change_events"."previous_snapshot_id" <> "meta_change_events"."current_snapshot_id"),
	CONSTRAINT "meta_change_events_change_ref_format" CHECK ("meta_change_events"."change_ref" ~ '^ref_[a-f0-9]{20}$'),
	CONSTRAINT "meta_change_events_entity_ref_format" CHECK ("meta_change_events"."entity_ref" ~ '^ref_[a-f0-9]{20}$'),
	CONSTRAINT "meta_change_events_action_ref_format" CHECK ("meta_change_events"."correlated_action_ref" is null or "meta_change_events"."correlated_action_ref" ~ '^ref_[a-f0-9]{20}$'),
	CONSTRAINT "meta_change_events_timeline_hash_format" CHECK ("meta_change_events"."timeline_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "meta_change_events_classification_valid" CHECK ("meta_change_events"."classification" in ('internal_expected', 'external_change')),
	CONSTRAINT "meta_change_events_entity_type_valid" CHECK ("meta_change_events"."entity_type" in ('campaign', 'ad_set', 'ad')),
	CONSTRAINT "meta_change_events_period_valid" CHECK ("meta_change_events"."detected_at" >= "meta_change_events"."occurred_at")
);
--> statement-breakpoint
CREATE TABLE "meta_change_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"meta_connection_id" uuid NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"public_ref" text NOT NULL,
	"snapshot_hash" text NOT NULL,
	"schema_version" integer NOT NULL,
	"field_catalog_version" text NOT NULL,
	"captured_at" timestamp with time zone NOT NULL,
	"canonical_payload" jsonb NOT NULL,
	"safe_aggregate" jsonb NOT NULL,
	"persisted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meta_change_snapshots_hash_format" CHECK ("meta_change_snapshots"."snapshot_hash" ~ '^[a-f0-9]{64}$'),
	CONSTRAINT "meta_change_snapshots_public_ref_format" CHECK ("meta_change_snapshots"."public_ref" ~ '^snapshot_[a-f0-9]{20}$'),
	CONSTRAINT "meta_change_snapshots_schema_version_positive" CHECK ("meta_change_snapshots"."schema_version" >= 1)
);
--> statement-breakpoint
ALTER TABLE "meta_change_events" ADD CONSTRAINT "meta_change_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_change_events" ADD CONSTRAINT "meta_change_events_meta_connection_id_meta_connections_id_fk" FOREIGN KEY ("meta_connection_id") REFERENCES "public"."meta_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_change_events" ADD CONSTRAINT "meta_change_events_ad_account_id_ad_accounts_id_fk" FOREIGN KEY ("ad_account_id") REFERENCES "public"."ad_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_change_events" ADD CONSTRAINT "meta_change_events_previous_snapshot_scope_fk" FOREIGN KEY ("previous_snapshot_id","workspace_id","meta_connection_id","ad_account_id") REFERENCES "public"."meta_change_snapshots"("id","workspace_id","meta_connection_id","ad_account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_change_events" ADD CONSTRAINT "meta_change_events_current_snapshot_scope_fk" FOREIGN KEY ("current_snapshot_id","workspace_id","meta_connection_id","ad_account_id") REFERENCES "public"."meta_change_snapshots"("id","workspace_id","meta_connection_id","ad_account_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_change_snapshots" ADD CONSTRAINT "meta_change_snapshots_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_change_snapshots" ADD CONSTRAINT "meta_change_snapshots_meta_connection_id_meta_connections_id_fk" FOREIGN KEY ("meta_connection_id") REFERENCES "public"."meta_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_change_snapshots" ADD CONSTRAINT "meta_change_snapshots_ad_account_id_ad_accounts_id_fk" FOREIGN KEY ("ad_account_id") REFERENCES "public"."ad_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "meta_change_events_scope_change_ref_unique" ON "meta_change_events" USING btree ("workspace_id","meta_connection_id","ad_account_id","change_ref");--> statement-breakpoint
CREATE INDEX "meta_change_events_scope_occurred_idx" ON "meta_change_events" USING btree ("workspace_id","meta_connection_id","ad_account_id","occurred_at");--> statement-breakpoint
CREATE INDEX "meta_change_events_previous_snapshot_idx" ON "meta_change_events" USING btree ("previous_snapshot_id");--> statement-breakpoint
CREATE INDEX "meta_change_events_current_snapshot_idx" ON "meta_change_events" USING btree ("current_snapshot_id");--> statement-breakpoint
CREATE INDEX "meta_change_events_connection_idx" ON "meta_change_events" USING btree ("meta_connection_id");--> statement-breakpoint
CREATE INDEX "meta_change_events_account_idx" ON "meta_change_events" USING btree ("ad_account_id");--> statement-breakpoint
CREATE UNIQUE INDEX "meta_change_snapshots_scope_hash_unique" ON "meta_change_snapshots" USING btree ("workspace_id","meta_connection_id","ad_account_id","snapshot_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "meta_change_snapshots_scope_public_ref_unique" ON "meta_change_snapshots" USING btree ("workspace_id","meta_connection_id","ad_account_id","public_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "meta_change_snapshots_id_scope_unique" ON "meta_change_snapshots" USING btree ("id","workspace_id","meta_connection_id","ad_account_id");--> statement-breakpoint
CREATE INDEX "meta_change_snapshots_scope_captured_idx" ON "meta_change_snapshots" USING btree ("workspace_id","meta_connection_id","ad_account_id","captured_at");--> statement-breakpoint
CREATE INDEX "meta_change_snapshots_connection_idx" ON "meta_change_snapshots" USING btree ("meta_connection_id");--> statement-breakpoint
CREATE INDEX "meta_change_snapshots_account_idx" ON "meta_change_snapshots" USING btree ("ad_account_id");--> statement-breakpoint
ALTER TABLE "meta_change_snapshots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "meta_change_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON TABLE "meta_change_snapshots" FROM "anon", "authenticated";--> statement-breakpoint
REVOKE ALL ON TABLE "meta_change_events" FROM "anon", "authenticated";
