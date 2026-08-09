ALTER TABLE "advised_practice_events" DROP CONSTRAINT "advised_practice_events_type";--> statement-breakpoint
ALTER TABLE "advised_practice_events" ADD CONSTRAINT "advised_practice_events_candidate_guard" CHECK (
    "advised_practice_events"."event_type" <> 'standardization_candidate' or (
      "advised_practice_events"."payload" #>> '{proposedByRole}' in ('owner', 'admin', 'analyst')
      and "advised_practice_events"."payload" #>> '{humanConfirmationRequired}' = 'true'
      and "advised_practice_events"."payload" #>> '{capabilities,canPromotePolicy}' = 'false'
      and "advised_practice_events"."payload" #>> '{capabilities,canEnableAutomation}' = 'false'
      and "advised_practice_events"."payload" #>> '{capabilities,canAuthorizeAction}' = 'false'
      and "advised_practice_events"."payload" #>> '{capabilities,canWriteMeta}' = 'false'
    )
  );--> statement-breakpoint
ALTER TABLE "advised_practice_events" ADD CONSTRAINT "advised_practice_events_standardized_guard" CHECK (
    "advised_practice_events"."event_type" <> 'standardized' or (
      "advised_practice_events"."payload" #>> '{confirmedByRole}' in ('owner', 'admin')
      and "advised_practice_events"."payload" #>> '{humanConfirmation}' = 'explicit'
      and "advised_practice_events"."payload" #>> '{capabilities,canPromotePolicy}' = 'false'
      and "advised_practice_events"."payload" #>> '{capabilities,canEnableAutomation}' = 'false'
      and "advised_practice_events"."payload" #>> '{capabilities,canAuthorizeAction}' = 'false'
      and "advised_practice_events"."payload" #>> '{capabilities,canWriteMeta}' = 'false'
    )
  );--> statement-breakpoint
ALTER TABLE "advised_practice_events" ADD CONSTRAINT "advised_practice_events_type" CHECK ("advised_practice_events"."event_type" in (
    'candidate_created', 'reviewed', 'trial_started', 'outcome_recorded', 'standardization_reviewed',
    'standardization_candidate', 'standardized', 'retired'
  ));--> statement-breakpoint
ALTER TABLE advised_practice_definitions ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE advised_practice_definitions FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE advised_practice_events ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE advised_practice_events FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE advised_practice_definitions FROM PUBLIC, anon, authenticated, service_role;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE advised_practice_events FROM PUBLIC, anon, authenticated, service_role;--> statement-breakpoint
CREATE OR REPLACE FUNCTION advised_practice_append_only()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'advised practice records are append-only';
END;
$$;--> statement-breakpoint
CREATE TRIGGER advised_practice_definitions_append_only_trigger
BEFORE UPDATE ON advised_practice_definitions
FOR EACH ROW EXECUTE FUNCTION advised_practice_append_only();--> statement-breakpoint
CREATE TRIGGER advised_practice_events_append_only_trigger
BEFORE UPDATE ON advised_practice_events
FOR EACH ROW EXECUTE FUNCTION advised_practice_append_only();--> statement-breakpoint
REVOKE ALL PRIVILEGES ON FUNCTION advised_practice_append_only() FROM PUBLIC, anon, authenticated, service_role;
