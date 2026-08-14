import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("candidate preview G3 fixture harness", () => {
  it("builds the historical chain through normal private lifecycle writers", () => {
    const source = readFileSync("scripts/support/candidate-preview-binding-g3-fixture.ts", "utf8");
    for (const writer of [
      "materializeCurrentEffectiveAnalysisContextSourceFixture", "DrizzleBusinessOutcomeSignalRepository",
      "DrizzleBusinessOutcomeEvidenceRepository", "BusinessOutcomeContextComposer",
      "DrizzleDecisionRoomAnalysisAssetRegistry", "DrizzleDecisionRoomAnalysisRuntimeAssetLoader",
      "createDrizzleTimeframeBoundAnalysisContextComposer",
      "InstructionPolicyLifecycleService", "ProgressiveFormalizationService",
    ]) expect(source).toContain(writer);
    for (const forbidden of [
      "insert into tenant_authority_snapshots", "insert into business_outcome_evidence_snapshots",
      "insert into guidance_analysis_run_bindings", "insert into candidate_preview_binding_revisions",
    ]) expect(source).not.toContain(forbidden);
  });

  it("is caller-owned test infrastructure rather than a route or a standalone database process", () => {
    const source = readFileSync("scripts/support/candidate-preview-binding-g3-fixture.ts", "utf8");
    expect(source).toContain("materializeCandidatePreviewBindingG3Fixture(database: Database");
    expect(source).not.toContain("new Pool(");
    expect(source).not.toContain("process.exit");
  });
});
