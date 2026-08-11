ALTER TABLE "decision_room_run_analysis_assets" DROP CONSTRAINT "decision_room_run_analysis_assets_shape";--> statement-breakpoint
ALTER TABLE "decision_room_run_analysis_assets" ADD CONSTRAINT "decision_room_run_analysis_assets_shape" CHECK ((
    "decision_room_run_analysis_assets"."asset_hash" ~ '^[a-f0-9]{64}$'
    and jsonb_typeof("decision_room_run_analysis_assets"."resolved_timeframe") = 'object'
    and "decision_room_run_analysis_assets"."resolved_timeframe" #>> '{resolverVersion}' = 'analysis-timeframe-resolver/1.0.0'
    and (("decision_room_run_analysis_assets"."cadence_profile_revision_id" is null and "decision_room_run_analysis_assets"."cadence_profile_hash" is null)
      or ("decision_room_run_analysis_assets"."cadence_profile_revision_id" is not null and "decision_room_run_analysis_assets"."cadence_profile_hash" ~ '^[a-f0-9]{64}$'))
    and (("decision_room_run_analysis_assets"."agenda_hash" is null and "decision_room_run_analysis_assets"."agenda_payload" is null)
      or ("decision_room_run_analysis_assets"."agenda_hash" ~ '^[a-f0-9]{64}$'
        and jsonb_typeof("decision_room_run_analysis_assets"."agenda_payload") = 'object'
        and "decision_room_run_analysis_assets"."agenda_payload" #>> '{contractVersion}' = 'analysis-agenda/2.0.0'
        and "decision_room_run_analysis_assets"."agenda_payload" #>> '{agendaHash}' = "decision_room_run_analysis_assets"."agenda_hash"))
  ) is true);