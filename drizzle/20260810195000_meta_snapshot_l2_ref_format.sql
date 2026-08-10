ALTER TABLE "meta_change_snapshots"
  DROP CONSTRAINT "meta_change_snapshots_public_ref_format";
--> statement-breakpoint
ALTER TABLE "meta_change_snapshots"
  ADD CONSTRAINT "meta_change_snapshots_public_ref_format"
  CHECK ("meta_change_snapshots"."public_ref" ~ '^snapshot_[a-f0-9]{20}([a-f0-9]{12})?$');
