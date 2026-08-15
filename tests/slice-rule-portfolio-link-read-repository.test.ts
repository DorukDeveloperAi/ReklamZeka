import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Slice Rule portfolio link read model", () => {
  it("uses the immutable allocation binding → exact selection → closed trace chain, never a display-name match", () => {
    const source = readFileSync("src/connectors/campaigns/slice-rule-portfolio-link-drizzle-read-repository.ts", "utf8");
    expect(source).toContain("sliceRuleAllocationEntityBindings.campaignId");
    expect(source).toContain("sliceRuleWorkspaceDrafts.draftHash, schema.sliceRuleAllocationEntityBindings.draftHash");
    expect(source).toContain("`${selection.draftHash}:${selection.allocationRef}`");
    expect(source).toContain("DrizzleSliceRuleDecisionTraceReadRepository");
    expect(source).toContain('metaPublicReference("campaign", workspaceId, row.campaignId)');
    expect(source).not.toMatch(/campaignName|campaign\.name|\.name\s*===|toLocaleLowerCase|includes\(/);
  });
});
