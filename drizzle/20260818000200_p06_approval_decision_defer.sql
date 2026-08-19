-- Forward-only P06 decision vocabulary expansion. This migration is deliberately
-- unapplied: it preserves every existing immutable decision row and only broadens
-- the two constraints that enumerate command kinds.
ALTER TABLE action_approval_decision_events
  DROP CONSTRAINT action_approval_decision_events_identity,
  DROP CONSTRAINT action_approval_decision_events_approval_shape;

ALTER TABLE action_approval_decision_events
  ADD CONSTRAINT action_approval_decision_events_identity CHECK (
    command_ref ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    AND unit_ref ~ '^action_unit_[a-f0-9]{20}$'
    AND actor_ref ~ '^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$'
    AND actor_role IN ('owner', 'admin', 'operator')
    AND reason_code ~ '^[a-z][a-z0-9_.:-]{0,127}$'
    AND command_kind IN ('approve', 'reject', 'defer', 'request_changes')
  ) NOT VALID,
  ADD CONSTRAINT action_approval_decision_events_approval_shape CHECK (
    (command_kind = 'approve'
      AND command_payload #>> '{authorization,humanPresence}' = 'true'
      AND command_payload #>> '{authorization,canExecute}' = 'false'
      AND command_payload ? 'grantRef')
    OR (command_kind IN ('reject', 'defer', 'request_changes')
      AND NOT (command_payload ? 'authorization')
      AND NOT (command_payload ? 'grantRef'))
  ) NOT VALID;

ALTER TABLE action_approval_decision_events
  VALIDATE CONSTRAINT action_approval_decision_events_identity;
ALTER TABLE action_approval_decision_events
  VALIDATE CONSTRAINT action_approval_decision_events_approval_shape;
