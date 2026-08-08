CREATE TABLE "meta_sync_record_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"meta_connection_id" uuid NOT NULL,
	"ad_account_id" uuid NOT NULL,
	"stream_type" "meta_sync_stream_type" NOT NULL,
	"entity_level" "meta_insight_entity_level",
	"record_identity" text NOT NULL,
	"snapshot_hash" text NOT NULL,
	"first_seen_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meta_sync_record_ledger" ADD CONSTRAINT "meta_sync_record_ledger_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_sync_record_ledger" ADD CONSTRAINT "meta_sync_record_ledger_meta_connection_id_meta_connections_id_fk" FOREIGN KEY ("meta_connection_id") REFERENCES "public"."meta_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meta_sync_record_ledger" ADD CONSTRAINT "meta_sync_record_ledger_ad_account_id_ad_accounts_id_fk" FOREIGN KEY ("ad_account_id") REFERENCES "public"."ad_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "meta_sync_record_ledger_workspace_connection_identity_unique" ON "meta_sync_record_ledger" USING btree ("workspace_id","meta_connection_id","record_identity");--> statement-breakpoint
CREATE INDEX "meta_sync_record_ledger_account_stream_idx" ON "meta_sync_record_ledger" USING btree ("ad_account_id","stream_type");