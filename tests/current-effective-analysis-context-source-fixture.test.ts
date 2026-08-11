import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("current effective analysis source fixture harness", () => {
  it("keeps authority, guidance, category and cadence facts on their normal private writers", () => {
    const source = readFileSync("scripts/support/current-effective-analysis-context-source-fixture.ts", "utf8");
    for (const writer of [
      "DrizzleCategoryAuthoringRepository", "DrizzleCategoryProfileLifecycleRepository",
      "DrizzleGuidanceRegistryRepository", "DrizzleGuidanceCampaignSelectionRepository",
      "DrizzleDecisionCadenceProfileRepository", "DrizzlePolicyAuthorityCatalogMaterializerRepository",
    ]) expect(source).toContain(writer);
    expect(source).not.toContain("insert into tenant_authority_snapshots");
    expect(source).not.toContain("insert into guidance_analysis_run_bindings");
  });

  it("is private test infrastructure and accepts its caller-owned database boundary", () => {
    const source = readFileSync("scripts/support/current-effective-analysis-context-source-fixture.ts", "utf8");
    expect(source).toContain("materializeCurrentEffectiveAnalysisContextSourceFixture(database: Database");
    expect(source).not.toContain("new Pool(");
    expect(source).not.toContain("process.exit");
  });
});
