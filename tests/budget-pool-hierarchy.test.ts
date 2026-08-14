import { describe, expect, it } from "vitest";
import { BudgetPoolHierarchyError, createBudgetPoolHierarchy } from "@/domain/budget/budget-pool-hierarchy";
const at = "2026-08-13T00:00:00.000Z"; const until = "2026-09-13T00:00:00.000Z";
const roots = [
  { poolRef: "budget_pool_domestic", parentPoolRef: null, layer: "market" as const, market: "domestic" as const, currency: "TRY", hardCapDecimal: "500000", effectiveFrom: at, effectiveTo: until },
  { poolRef: "budget_pool_international", parentPoolRef: null, layer: "market" as const, market: "international" as const, currency: "TRY", hardCapDecimal: "500000", effectiveFrom: at, effectiveTo: until },
] as const;
describe("budget pool hierarchy", () => {
  it("pins market roots and named child caps without action authority", () => {
    const result = createBudgetPoolHierarchy({ nodes: [...roots, { poolRef: "budget_pool_int_ftr", parentPoolRef: "budget_pool_international", layer: "service_family", market: "international", currency: "TRY", hardCapDecimal: "120000", effectiveFrom: at, effectiveTo: until }, { poolRef: "budget_pool_int_ftr_ar", parentPoolRef: "budget_pool_int_ftr", layer: "named", market: "international", currency: "TRY", hardCapDecimal: "60000", effectiveFrom: at, effectiveTo: until }] });
    expect(result.nodes.map((node) => node.poolRef)).toEqual(["budget_pool_domestic", "budget_pool_int_ftr", "budget_pool_int_ftr_ar", "budget_pool_international"]);
    expect(result.authority).toMatchObject({ canExecute: false, canWriteMeta: false });
  });
  it("rejects domestic/international leakage and child caps over a parent", () => {
    const child = { poolRef: "budget_pool_bad", parentPoolRef: "budget_pool_domestic", layer: "named" as const, market: "international" as const, currency: "TRY", hardCapDecimal: "1", effectiveFrom: at, effectiveTo: until };
    expect(() => createBudgetPoolHierarchy({ nodes: [...roots, child] })).toThrow(BudgetPoolHierarchyError);
    expect(() => createBudgetPoolHierarchy({ nodes: [...roots, { ...child, market: "domestic", hardCapDecimal: "600000" }] })).toThrow(BudgetPoolHierarchyError);
  });
  it("does not let a dated child outlive its market-cap window", () => {
    const create = () => createBudgetPoolHierarchy({ nodes: [...roots, {
      poolRef: "budget_pool_domestic_late", parentPoolRef: "budget_pool_domestic", layer: "named", market: "domestic", currency: "TRY", hardCapDecimal: "1",
      effectiveFrom: at, effectiveTo: "2026-10-13T00:00:00.000Z",
    }] });
    expect(create).toThrow(BudgetPoolHierarchyError);
    try { create(); } catch (error) { expect(error).toMatchObject({ code: "time_window" }); }
  });
});
