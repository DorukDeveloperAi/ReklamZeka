import { describe, expect, it, vi } from "vitest";
import { SliceRuleBudgetPoolBindingService, createSliceRuleBudgetPoolBinding } from "@/application/slice-rule-budget-pool-binding-service";

const base = { workspaceId: "11111111-1111-4111-8111-111111111111", draftHash: "a".repeat(64), hierarchyHash: "b".repeat(64), poolRef: "budget_pool_international", market: "international" as const, idempotencyKey: "bind.r1", boundAt: "2026-08-13T00:00:00.000Z" };
describe("slice rule budget pool binding", () => {
  it("pins an exact recommendation-only binding", async () => {
    const bind = vi.fn(async () => ({ outcome: "inserted" as const })); const service = new SliceRuleBudgetPoolBindingService({ bind });
    await expect(service.bind("22222222-2222-4222-8222-222222222222", base)).resolves.toEqual({ outcome: "inserted" });
    expect(bind).toHaveBeenCalledWith(expect.objectContaining({ binding: expect.objectContaining({ market: "international", authority: expect.objectContaining({ canExecute: false, canWriteMeta: false }) }) }));
  });
  it("rejects malformed pool or market input before persistence", () => {
    expect(() => createSliceRuleBudgetPoolBinding({ ...base, poolRef: "bad" })).toThrow("invalid_input");
    expect(() => createSliceRuleBudgetPoolBinding({ ...base, market: "mixed" as never })).toThrow("invalid_input");
  });
});
