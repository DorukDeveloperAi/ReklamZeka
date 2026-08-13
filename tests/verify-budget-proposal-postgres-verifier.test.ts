import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("budget proposal PostgreSQL verifier", () => {
  it("builds an authentic committed L1/L2/L3 context before proposal rollback checks", () => {
    const source = readFileSync("scripts/verify-budget-proposal-postgres.ts", "utf8");
    expect(source).toContain('from "./support/current-effective-analysis-context-source-fixture"');
    expect(source).toContain("await materializeCurrentEffectiveAnalysisContextSourceFixture(database as never)");
    expect(source).toContain("async function materializeReadyBudgetContext");
    expect(source).toContain("new DrizzleDeterministicFeatureSnapshotRepository(transaction as never).save");
    expect(source).toContain("createDrizzleEffectiveAnalysisContextComposer({ database: database as never }).composeAndSave(source.request)");
    expect(source).toContain("createDrizzleTimeframeBoundAnalysisContextComposer({ database: database as never");
    expect(source).toContain("const prepared = await materializeReadyBudgetContext(sourceFixture)");
    expect(source).not.toContain("buildEffectiveCampaignContext");
    expect(source).not.toContain("DrizzleEffectiveCampaignContextRepository");
    expect(source).toContain("new WorkspaceTombstoneService(new DrizzleWorkspaceTombstoneStore(database as never, purge)");
    expect(source).toContain("proposalRowsRolledBack");
    expect(source).toContain("tombstoneCleanup");
  });
});
