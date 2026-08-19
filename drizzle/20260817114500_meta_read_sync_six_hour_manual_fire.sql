-- P01-A: scheduled and manual Meta reads share one private scope lease.
-- This is additive/forward-only: historical daily fire rows remain immutable,
-- while provisioned schedules move to the canonical six-hour cadence.
ALTER TABLE "meta_read_sync_schedules" DROP CONSTRAINT "meta_read_sync_schedules_contract";--> statement-breakpoint
ALTER TABLE "meta_read_sync_schedule_runs" DROP CONSTRAINT "meta_read_sync_schedule_runs_identity";--> statement-breakpoint
UPDATE "meta_read_sync_schedules" SET "trigger_kind" = 'interval_6h' WHERE "trigger_kind" = 'daily';--> statement-breakpoint
ALTER TABLE "meta_read_sync_schedules" ALTER COLUMN "trigger_kind" SET DEFAULT 'interval_6h';--> statement-breakpoint
ALTER TABLE "meta_read_sync_schedules" ADD CONSTRAINT "meta_read_sync_schedules_contract" CHECK (
  "trigger_kind" = 'interval_6h'
  and "revision" between 1 and 1000000
  and "workspace_lifecycle_generation" >= 1
  and "connection_lifecycle_generation" >= 1
  and "timeframe_days" between 1 and 90
);--> statement-breakpoint
ALTER TABLE "meta_read_sync_schedule_runs" ADD CONSTRAINT "meta_read_sync_schedule_runs_identity" CHECK (
  "schedule_revision" between 1 and 1000000
  and "idempotency_key" ~ '^syncfire_[a-f0-9]{64}$'
  and "scope_key" ~ '^[a-f0-9]{64}$'
  and "trigger_kind" in ('daily', 'interval_6h', 'manual')
  and "date_start" <= "date_stop"
  and "attempt" between 1 and 5
);--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
ALTER TABLE "meta_read_sync_schedule_runs" ADD CONSTRAINT "meta_read_sync_schedule_runs_active_scope_lease_exclusion" EXCLUDE USING gist (
  "workspace_id" WITH =,
  "connection_id" WITH =,
  tstzrange("started_at", "lease_until", '[)') WITH &&
) WHERE ("state" = 'running');--> statement-breakpoint
ALTER TABLE "meta_read_sync_schedules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "meta_read_sync_schedules" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "meta_read_sync_schedule_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "meta_read_sync_schedule_runs" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "meta_read_sync_schedules" FROM PUBLIC, anon, authenticated, service_role;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "meta_read_sync_schedule_runs" FROM PUBLIC, anon, authenticated, service_role;
