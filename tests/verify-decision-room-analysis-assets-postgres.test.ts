import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("Decision Room analysis-assets PostgreSQL verifier", () => {
  it("persists only a composer-derived, source-bound analysis context", () => {
    const source = readFileSync("scripts/verify-decision-room-analysis-assets-postgres.ts", "utf8");
    expect(source).toContain("materializeCurrentEffectiveAnalysisContextSourceFixture");
    expect(source).toContain("createDrizzleEffectiveAnalysisContextComposer");
    expect(source).toContain(".composeAndSave(fixture.request)");
    expect(source).not.toContain("buildEffectiveCampaignContext");
    expect(source).not.toContain("new DrizzleEffectiveCampaignContextRepository");
  });

  it("retains the asset acceptance checks inside an outer rollback", () => {
    const source = readFileSync("scripts/verify-decision-room-analysis-assets-postgres.ts", "utf8");
    for (const assertion of [
      "guidanceBindingImmutable", "exactGuidanceRefGuard", "crossTenantBlocked",
      "immutableRows", "rlsAndGrants", "throw rollback",
    ]) expect(source).toContain(assertion);
  });
});
