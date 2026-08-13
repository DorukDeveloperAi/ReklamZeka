import { describe, expect, it } from "vitest";

import {
  selectPlannedScenarioAllocation,
  SliceRuleScenarioAllocationSelectionRepositoryError,
} from "@/connectors/campaigns/slice-rule-scenario-allocation-selection-drizzle-repository";

const alternative = (overrides: Record<string, unknown> = {}) => ({
  scenarioRef: "scenario.keep", kind: "keep", status: "composed", actionAuthority: "none",
  result: {
    status: "planned", frozenInput: { ref: "context.abc", hash: "a".repeat(64) },
    before: { allocations: [{ ref: "allocation.ftr", amountMinor: 100 }] },
    after: { allocations: [{ ref: "allocation.ftr", amountMinor: 120, deltaMinor: 20 }] },
  },
  ...overrides,
});

describe("slice rule scenario allocation selection", () => {
  it("selects only one exact composed planned allocation with a consistent before/after delta", () => {
    expect(selectPlannedScenarioAllocation({ alternative: alternative() as never, contextHash: "a".repeat(64), allocationRef: "allocation.ftr" }))
      .toEqual({ beforeAmountMinor: 100, afterAmountMinor: 120 });
  });

  it("fails closed for no-change, ambiguous allocation, scope mismatch, or forged delta", () => {
    const cases = [
      alternative({ result: { ...alternative().result, status: "no_change" } }),
      alternative({ result: { ...alternative().result, before: { allocations: [{ ref: "allocation.ftr", amountMinor: 100 }, { ref: "allocation.other", amountMinor: 20 }] } } }),
      alternative({ result: { ...alternative().result, after: { allocations: [{ ref: "allocation.ftr", amountMinor: 120, deltaMinor: 1 }] } } }),
    ];
    for (const value of cases) expect(() => selectPlannedScenarioAllocation({ alternative: value as never, contextHash: "a".repeat(64), allocationRef: "allocation.ftr" }))
      .toThrow(SliceRuleScenarioAllocationSelectionRepositoryError);
    expect(() => selectPlannedScenarioAllocation({ alternative: alternative() as never, contextHash: "b".repeat(64), allocationRef: "allocation.ftr" }))
      .toThrow(SliceRuleScenarioAllocationSelectionRepositoryError);
  });
});
