-- Historical authority snapshots may bind the same immutable fact independently.
-- Scope the exact fact uniqueness by immutable snapshot instead of globally by policy.
DROP INDEX IF EXISTS "policy_authority_bindings_exact_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX "policy_authority_bindings_snapshot_exact_unique"
  ON "policy_authority_bindings" USING btree
  ("authority_snapshot_id", "policy_revision_id", "binding_kind", "binding_ref", "binding_version");
