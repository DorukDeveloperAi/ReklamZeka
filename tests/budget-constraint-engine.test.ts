import { describe, expect, it } from "vitest";
import {
  BudgetConstraintEngineError,
  planBudgetAllocation,
  type BudgetAllocation,
} from "../src/domain/budget/constraint-engine";

const allocations: readonly BudgetAllocation[] = [
  { ref: "ankara", currentAmountMinor: 4_000, categoryRef: "brand", geoRef: "ankara", groupRefs: ["tr"] },
  { ref: "bursa", currentAmountMinor: 3_000, categoryRef: "brand", geoRef: "bursa", groupRefs: ["tr"] },
  { ref: "dubai", currentAmountMinor: 3_000, categoryRef: "intl", geoRef: "dubai", groupRefs: ["intl"] },
];

describe("budget constraint engine", () => {
  it("applies floor, cap and reserve with deterministic proportional rounding", () => {
    const result = planBudgetAllocation({
      totalBudgetMinor: 10_000,
      allocations,
      constraints: [
        { kind: "reserve", amountMinor: 1_000 },
        { kind: "floor", selector: { allocationRefs: ["ankara"] }, amountMinor: 3_000 },
        { kind: "cap", selector: { allocationRefs: ["dubai"] }, amountMinor: 2_000 },
      ],
      strategy: { mode: "proportional", weights: [
        { ref: "ankara", weight: 2 }, { ref: "bursa", weight: 1 }, { ref: "dubai", weight: 1 },
      ] },
    });
    expect(result.status).toBe("planned");
    expect(result.reserveAmountMinor).toBe(1_000);
    expect(result.allocations.reduce((sum, item) => sum + item.proposedAmountMinor, 0)).toBe(9_000);
    expect(result.allocations.find((item) => item.ref === "dubai")?.proposedAmountMinor).toBeLessThanOrEqual(2_000);
    expect(result.actionAuthority).toBe("none");
    expect(result.trace.map((item) => item.sequence)).toEqual(result.trace.map((_, index) => index + 1));
  });

  it("supports fixed, priority and ladder modes", () => {
    const fixed = planBudgetAllocation({ totalBudgetMinor: 10_000, allocations, constraints: [],
      strategy: { mode: "fixed", targets: [
        { ref: "ankara", amountMinor: 5_000 }, { ref: "bursa", amountMinor: 2_000 }, { ref: "dubai", amountMinor: 3_000 },
      ] } });
    const priority = planBudgetAllocation({ totalBudgetMinor: 10_000, allocations,
      constraints: [{ kind: "cap", selector: { allocationRefs: ["ankara"] }, amountMinor: 6_000 }],
      strategy: { mode: "priority", orderedRefs: ["ankara", "bursa", "dubai"] } });
    const ladder = planBudgetAllocation({ totalBudgetMinor: 10_000, allocations, constraints: [],
      strategy: { mode: "ladder", rungs: [
        { ref: "ankara", upToMinor: 4_000 }, { ref: "bursa", upToMinor: 3_000 }, { ref: "dubai", upToMinor: 3_000 },
      ] } });
    expect(fixed.status).toBe("planned");
    expect(priority.allocations.map((item) => item.proposedAmountMinor)).toEqual([6_000, 4_000, 0]);
    expect(ladder.status).toBe("no_change");
    expect(ladder.reason).toBe("already_at_target");
  });

  it("can freeze a selected category at each allocation's current amount", () => {
    const result = planBudgetAllocation({ totalBudgetMinor: 10_000, allocations,
      constraints: [{ kind: "fixed", selector: { categoryRefs: ["brand"] } }],
      strategy: { mode: "fixed", targets: [
        { ref: "ankara", amountMinor: 4_000 }, { ref: "bursa", amountMinor: 3_000 }, { ref: "dubai", amountMinor: 3_000 },
      ] } });
    expect(result.status).toBe("no_change");
    expect(result.trace.filter((item) => item.code === "fixed_applied").map((item) => item.allocationRef)).toEqual([
      "ankara", "bursa",
    ]);
  });

  it("does not move budget away from an expensive protected geo when configured", () => {
    const result = planBudgetAllocation({
      totalBudgetMinor: 10_000,
      allocations,
      constraints: [{ kind: "protected", dimension: "geo", refs: ["dubai"], behavior: "no_outflow" }],
      strategy: { mode: "fixed", targets: [
        { ref: "ankara", amountMinor: 5_000 }, { ref: "bursa", amountMinor: 2_000 }, { ref: "dubai", amountMinor: 3_000 },
      ] },
    });
    expect(result.status).toBe("planned");
    expect(result.allocations.find((item) => item.ref === "dubai")?.deltaMinor).toBe(0);
    expect(result.trace.some((item) => item.code === "protected_no_outflow" && item.allocationRef === "dubai")).toBe(true);
  });

  it("does not make geo protection a default rule", () => {
    const result = planBudgetAllocation({ totalBudgetMinor: 10_000, allocations, constraints: [],
      strategy: { mode: "fixed", targets: [
        { ref: "ankara", amountMinor: 5_000 }, { ref: "bursa", amountMinor: 4_000 }, { ref: "dubai", amountMinor: 1_000 },
      ] } });
    expect(result.status).toBe("planned");
    expect(result.transfers).toContainEqual({ fromRef: "dubai", toRef: "ankara", amountMinor: 1_000 });
  });

  it("enforces allow, deny and only-within-group transfer policies", () => {
    const denied = planBudgetAllocation({ totalBudgetMinor: 10_000, allocations,
      constraints: [{ kind: "transfer_deny", from: { allocationRefs: ["dubai"] }, to: { allocationRefs: ["ankara"] } }],
      strategy: { mode: "fixed", targets: [
        { ref: "ankara", amountMinor: 5_000 }, { ref: "bursa", amountMinor: 3_000 }, { ref: "dubai", amountMinor: 2_000 },
      ] } });
    const withinGroup = planBudgetAllocation({ totalBudgetMinor: 10_000, allocations,
      constraints: [{ kind: "transfer_only_within_group", dimension: "group" }],
      strategy: { mode: "fixed", targets: [
        { ref: "ankara", amountMinor: 4_000 }, { ref: "bursa", amountMinor: 4_000 }, { ref: "dubai", amountMinor: 2_000 },
      ] } });
    const allowed = planBudgetAllocation({ totalBudgetMinor: 10_000, allocations,
      constraints: [{ kind: "transfer_allow", from: { allocationRefs: ["dubai"] }, to: { allocationRefs: ["ankara"] } }],
      strategy: { mode: "fixed", targets: [
        { ref: "ankara", amountMinor: 5_000 }, { ref: "bursa", amountMinor: 3_000 }, { ref: "dubai", amountMinor: 2_000 },
      ] } });
    expect(denied).toMatchObject({ status: "unsatisfied", reason: "transfer_restricted", transfers: [] });
    expect(withinGroup).toMatchObject({ status: "unsatisfied", reason: "transfer_restricted" });
    expect(allowed.transfers).toEqual([{ fromRef: "dubai", toRef: "ankara", amountMinor: 1_000 }]);
  });

  it("returns explicit unsatisfied reasons and rejects malformed configuration", () => {
    expect(planBudgetAllocation({ totalBudgetMinor: 1_000, allocations,
      constraints: [{ kind: "floor", selector: { allocationRefs: ["ankara"] }, amountMinor: 1_001 }],
      strategy: { mode: "priority", orderedRefs: ["ankara", "bursa", "dubai"] },
    })).toMatchObject({ status: "unsatisfied", reason: "target_below_floors" });
    expect(planBudgetAllocation({ totalBudgetMinor: 10_000, allocations, constraints: [],
      strategy: { mode: "ladder", rungs: [{ ref: "ankara", upToMinor: 1_000 }] },
    })).toMatchObject({ status: "unsatisfied", reason: "ladder_capacity_exhausted" });
    expect(() => planBudgetAllocation({ totalBudgetMinor: 10_000, allocations, constraints: [],
      strategy: { mode: "proportional", weights: [{ ref: "ankara", weight: 1 }] },
    })).toThrow(BudgetConstraintEngineError);
  });

  it("is deterministic regardless of allocation input order", () => {
    const request = { totalBudgetMinor: 10_000, constraints: [] as const,
      strategy: { mode: "proportional" as const, weights: [
        { ref: "ankara", weight: 1 }, { ref: "bursa", weight: 1 }, { ref: "dubai", weight: 1 },
      ] } };
    const first = planBudgetAllocation({ ...request, allocations });
    const second = planBudgetAllocation({ ...request, allocations: [...allocations].reverse() });
    expect(second).toEqual(first);
  });

  it("uses exact integer weight arithmetic and rejects unsafe weights", () => {
    const exact = planBudgetAllocation({
      totalBudgetMinor: 4_000_000_000_000_000,
      allocations: allocations.map((item) => ({ ...item, currentAmountMinor: 0 })),
      constraints: [
        { kind: "cap", selector: { allocationRefs: ["ankara"] }, amountMinor: 2_000_000_000_000_000 },
        { kind: "cap", selector: { allocationRefs: ["bursa"] }, amountMinor: 1_500_000_000_000_000 },
        { kind: "cap", selector: { allocationRefs: ["dubai"] }, amountMinor: 500_000_000_000_000 },
      ],
      strategy: { mode: "proportional", weights: [
        { ref: "ankara", weight: 3 }, { ref: "bursa", weight: 2 }, { ref: "dubai", weight: 1 },
      ] },
    });
    expect(exact.allocations.reduce((sum, item) => sum + BigInt(item.proposedAmountMinor), 0n))
      .toBe(4_000_000_000_000_000n);
    expect(() => planBudgetAllocation({
      totalBudgetMinor: 10_000,
      allocations,
      constraints: [],
      strategy: { mode: "proportional", weights: [
        { ref: "ankara", weight: 1.5 }, { ref: "bursa", weight: 1 }, { ref: "dubai", weight: 1 },
      ] },
    })).toThrow(BudgetConstraintEngineError);
  });
});
