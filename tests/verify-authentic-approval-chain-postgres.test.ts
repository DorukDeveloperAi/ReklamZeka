import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("authentic approval-chain PostgreSQL verifier", () => {
  it("uses normal lifecycle writers without manufacturing a context or ActionUnit", () => {
    const source = readFileSync("scripts/verify-authentic-approval-chain-postgres.ts", "utf8");
    expect(source).toContain("materializeReadyBudgetContext(database, source)");
    expect(source).toContain("new SliceRuleWorkspaceService");
    expect(source).toContain("saveRuleLinkedDraft");
    expect(source).toContain("new DrizzleSliceRuleAllocationEntityBindingRepository");
    expect(source).toContain("new DrizzleSliceRuleScenarioAllocationSelectionRepository");
    expect(source).toContain("new DrizzleSliceRuleBudgetActionUnitMaterializer");
    expect(source).toContain("new DrizzleApprovalPolicyRegistryRepository");
    expect(source).toContain("new WorkspaceTombstoneService");
    expect(source).not.toContain("effectiveCampaignContexts).values");
    expect(source).not.toContain("actionProposalUnits).values");
    expect(source).toContain("evidence.canExecuteFalse");
    expect(source).toContain("evidence.metaCalls !== 0");
    expect(source).toContain("evidence.executionCalls !== 0");
  });
});
