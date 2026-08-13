import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("budget proposal PostgreSQL verifier", () => {
  it("builds an authentic committed L1/L2/L3 context before proposal rollback checks", () => {
    const source = readFileSync("scripts/verify-budget-proposal-postgres.ts", "utf8");
    expect(source).toContain('from "./support/current-effective-analysis-context-source-fixture"');
    expect(source).toContain("await materializeCurrentEffectiveAnalysisContextSourceFixture(database as never)");
    expect(source).toContain('from "./support/materialize-ready-budget-context"');
    expect(source).toContain("const prepared = await materializeReadyBudgetContext(database, sourceFixture)");
    const helper = readFileSync("scripts/support/materialize-ready-budget-context.ts", "utf8");
    expect(helper).toContain("new DrizzleDeterministicFeatureSnapshotRepository(transaction as never).save");
    expect(helper).toContain("createDrizzleEffectiveAnalysisContextComposer({ database: database as never }).composeAndSave(source.request)");
    expect(helper).toContain("createDrizzleTimeframeBoundAnalysisContextComposer({ database: database as never");
    expect(source).not.toContain("buildEffectiveCampaignContext");
    expect(source).not.toContain("DrizzleEffectiveCampaignContextRepository");
    expect(source).toContain("new WorkspaceTombstoneService(new DrizzleWorkspaceTombstoneStore(database as never, purge)");
    expect(source).toContain("proposalRowsRolledBack");
    expect(source).toContain("tombstoneCleanup");
    expect(source).toContain("const evidencePassed =");
    expect(source).toContain("evidence.purgeCandidateCount === 0");
    expect(source).not.toContain('Object.entries(evidence).some');
  });
});
