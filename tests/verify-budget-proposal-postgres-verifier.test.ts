import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("budget proposal PostgreSQL verifier", () => {
  it("uses the closed-world source fixture and composer instead of manufacturing an effective context", () => {
    const source = readFileSync("scripts/verify-budget-proposal-postgres.ts", "utf8");
    expect(source).toContain('from "./support/current-effective-analysis-context-source-fixture"');
    expect(source).toContain("await materializeCurrentEffectiveAnalysisContextSourceFixture(database as never)");
    expect(source).toContain("createDrizzleEffectiveAnalysisContextComposer({ database: database as never }).composeAndSave(sourceFixture.request)");
    expect(source).not.toContain("buildEffectiveCampaignContext");
    expect(source).not.toContain("DrizzleEffectiveCampaignContextRepository");
    expect(source).toContain("new WorkspaceTombstoneService(new DrizzleWorkspaceTombstoneStore(database as never, purge)");
    expect(source).toContain("proposalRowsRolledBack");
    expect(source).toContain("tombstoneCleanup");
  });
});
