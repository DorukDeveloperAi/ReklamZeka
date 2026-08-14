import { describe, expect, it } from "vitest";

import {
  SliceRuleAllocationEntityBindingRepositoryError,
  sliceRuleDailyBudgetMinor,
} from "@/connectors/campaigns/slice-rule-allocation-entity-binding-drizzle-repository";

describe("Slice Rule allocation entity binding writer", () => {
  it("converts only exact persisted two-decimal allocation amounts to Meta minor units", () => {
    expect(sliceRuleDailyBudgetMinor("1200")).toBe(120_000);
    expect(sliceRuleDailyBudgetMinor("1200.5")).toBe(120_050);
    expect(sliceRuleDailyBudgetMinor("1200.50")).toBe(120_050);
  });

  it("fails closed instead of rounding an allocation amount into a different current mirror amount", () => {
    for (const amount of ["1200.001", "1200.999", "-1", "not-a-decimal"]) {
      expect(() => sliceRuleDailyBudgetMinor(amount)).toThrow(SliceRuleAllocationEntityBindingRepositoryError);
    }
  });
});
