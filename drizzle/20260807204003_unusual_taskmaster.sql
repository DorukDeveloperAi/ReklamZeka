ALTER TABLE "action_approval_policy_snapshots" ADD COLUMN "source_definition_id" uuid;--> statement-breakpoint
ALTER TABLE "action_approval_policy_snapshots" ADD COLUMN "source_definition_canonical_hash" text;--> statement-breakpoint
CREATE UNIQUE INDEX "approval_policy_definition_revisions_snapshot_source_unique" ON "approval_policy_definition_revisions" USING btree ("workspace_id","id","policy_ref","revision","policy_hash","canonical_hash");--> statement-breakpoint
ALTER TABLE "action_approval_policy_snapshots" ADD CONSTRAINT "action_approval_policy_snapshots_source_definition_scope_fk" FOREIGN KEY ("workspace_id","source_definition_id","policy_ref","revision","policy_hash","source_definition_canonical_hash") REFERENCES "public"."approval_policy_definition_revisions"("workspace_id","id","policy_ref","revision","policy_hash","canonical_hash") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "action_approval_policy_snapshots_source_definition_idx" ON "action_approval_policy_snapshots" USING btree ("workspace_id","source_definition_id");--> statement-breakpoint
ALTER TABLE "action_approval_policy_snapshots" ADD CONSTRAINT "action_approval_policy_snapshots_source_definition_exact" CHECK (
    ("action_approval_policy_snapshots"."source_definition_id" is null and "action_approval_policy_snapshots"."source_definition_canonical_hash" is null)
    or ("action_approval_policy_snapshots"."source_definition_id" is not null and "action_approval_policy_snapshots"."source_definition_canonical_hash" ~ '^[a-f0-9]{64}$')
  );--> statement-breakpoint
ALTER TABLE "action_approval_policy_snapshots" FORCE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "action_approval_policy_snapshots" FROM PUBLIC, anon, authenticated;
