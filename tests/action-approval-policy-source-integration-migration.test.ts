import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const queueMigration = readFileSync("drizzle/20260807173537_action_proposal_queue.sql", "utf8");
const sourceMigration = readFileSync("drizzle/20260807204003_unusual_taskmaster.sql", "utf8");

describe("trusted ApprovalPolicy snapshot source migration", () => {
  it("adds a nullable legacy-safe but tenant/hash-exact composite source FK", () => {
    expect(sourceMigration).toContain('ADD COLUMN "source_definition_id" uuid');
    expect(sourceMigration).toContain('ADD COLUMN "source_definition_canonical_hash" text');
    expect(sourceMigration).toContain("action_approval_policy_snapshots_source_definition_scope_fk");
    expect(sourceMigration).toContain('FOREIGN KEY ("workspace_id","source_definition_id","policy_ref","revision","policy_hash","source_definition_canonical_hash")');
    expect(sourceMigration).toContain('REFERENCES "public"."approval_policy_definition_revisions"("workspace_id","id","policy_ref","revision","policy_hash","canonical_hash") ON DELETE restrict');
    expect(sourceMigration.indexOf("approval_policy_definition_revisions_snapshot_source_unique"))
      .toBeLessThan(sourceMigration.indexOf("action_approval_policy_snapshots_source_definition_scope_fk"));
    expect(sourceMigration).toContain("source_definition_id\" is null");
    expect(sourceMigration).toContain("source_definition_canonical_hash\" ~ '^[a-f0-9]{64}$'");
  });

  it("preserves the dark append-only boundary and adds forced RLS without API grants", () => {
    expect(queueMigration).toContain('ALTER TABLE "action_approval_policy_snapshots" ENABLE ROW LEVEL SECURITY');
    expect(queueMigration).toContain("action_approval_policy_snapshots_append_only_trigger");
    expect(sourceMigration).toContain('ALTER TABLE "action_approval_policy_snapshots" FORCE ROW LEVEL SECURITY');
    expect(sourceMigration).toContain('REVOKE ALL PRIVILEGES ON TABLE "action_approval_policy_snapshots" FROM PUBLIC, anon, authenticated');
    expect(sourceMigration).not.toMatch(/GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE|ALL).*action_approval_policy_snapshots/i);
  });
});
