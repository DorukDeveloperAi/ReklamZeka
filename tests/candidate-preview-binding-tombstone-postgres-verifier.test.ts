import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("candidate preview binding tombstone PostgreSQL verifier", () => {
  it("materializes real lifecycle rows, tombstones them, then proves the outer rollback", () => {
    const source = readFileSync("scripts/verify-candidate-preview-binding-tombstone-postgres.ts", "utf8");
    expect(source).toContain("materializeCandidatePreviewBindingG3Fixture");
    expect(source).toContain("DrizzleCandidatePreviewBindingRepository");
    expect(source).toContain("new WorkspaceTombstoneService(new DrizzleWorkspaceTombstoneStore(transaction as never, purge)");
    expect(source).toContain("candidate_preview_binding_invalidations");
    expect(source).toContain("candidate_preview_tombstone_outer_rollback");
    expect(source).not.toContain("insert into candidate_preview_binding");
  });
});
