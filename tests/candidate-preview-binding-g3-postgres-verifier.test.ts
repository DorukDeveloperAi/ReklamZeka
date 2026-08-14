import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("candidate preview G3 postgres verifier", () => {
  it("uses the authentic fixture, real binding writer, and an outer rollback", () => {
    const source = readFileSync("scripts/verify-candidate-preview-binding-g3-postgres.ts", "utf8");
    for (const required of [
      "materializeCandidatePreviewBindingG3Fixture", "DrizzleCandidatePreviewBindingRepository",
      "createDrizzleAuthoritativeG3EvidenceBridge", "candidateTierDecisionBound", "outerRollbackObserved",
      "crossTenantBlocked", "tamperedBlocked", "staleG2Blocked",
    ]) expect(source).toContain(required);
    expect(source).toContain("throw new Error(ROLLBACK)");
  });

  it("does not synthesize authority, outcome, or candidate evidence rows", () => {
    const source = readFileSync("scripts/verify-candidate-preview-binding-g3-postgres.ts", "utf8");
    for (const forbidden of [
      "insert into tenant_authority_snapshots", "insert into business_outcome_evidence_snapshots",
      "insert into candidate_preview_binding_revisions", "update candidate_preview_binding",
    ]) expect(source).not.toContain(forbidden);
  });
});
