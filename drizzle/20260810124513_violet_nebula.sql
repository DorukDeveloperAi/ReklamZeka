ALTER TABLE "decision_room_run_analysis_assets" DROP CONSTRAINT "decision_room_run_analysis_assets_shape";--> statement-breakpoint
ALTER TABLE "decision_room_run_analysis_assets" ADD COLUMN "cadence_profile_revision_id" uuid;--> statement-breakpoint
ALTER TABLE "decision_room_run_analysis_assets" ADD COLUMN "cadence_profile_hash" text;--> statement-breakpoint
ALTER TABLE "decision_room_run_analysis_assets" ADD CONSTRAINT "decision_room_run_analysis_assets_cadence_profile_scope_fk" FOREIGN KEY ("workspace_id","cadence_profile_revision_id") REFERENCES "public"."decision_cadence_profile_revisions"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "decision_room_run_analysis_assets_cadence_profile_idx" ON "decision_room_run_analysis_assets" USING btree ("cadence_profile_revision_id");--> statement-breakpoint
ALTER TABLE "decision_room_run_analysis_assets" ADD CONSTRAINT "decision_room_run_analysis_assets_shape" CHECK ((
    "decision_room_run_analysis_assets"."asset_hash" ~ '^[a-f0-9]{64}$'
    and jsonb_typeof("decision_room_run_analysis_assets"."resolved_timeframe") = 'object'
    and "decision_room_run_analysis_assets"."resolved_timeframe" #>> '{resolverVersion}' = 'analysis-timeframe-resolver/1.0.0'
    and (("decision_room_run_analysis_assets"."cadence_profile_revision_id" is null and "decision_room_run_analysis_assets"."cadence_profile_hash" is null)
      or ("decision_room_run_analysis_assets"."cadence_profile_revision_id" is not null and "decision_room_run_analysis_assets"."cadence_profile_hash" ~ '^[a-f0-9]{64}$'))
  ) is true);