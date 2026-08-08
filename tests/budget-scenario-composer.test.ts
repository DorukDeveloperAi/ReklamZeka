import { describe, expect, it } from "vitest";

import {
  BudgetScenarioComposerError,
  composeBudgetScenarios,
  type BudgetScenarioDefinition,
} from "../src/domain/budget/scenario-composer";

const allocations = [
  { ref: "ankara", currentAmountMinor: 6_000, categoryRef: "local", geoRef: "ankara", groupRefs: ["tr"] },
  { ref: "dubai", currentAmountMinor: 4_000, categoryRef: "intl", geoRef: "dubai", groupRefs: ["intl"] },
] as const;

function scenario(
  kind: BudgetScenarioDefinition["kind"],
  patch: Partial<BudgetScenarioDefinition> = {},
): BudgetScenarioDefinition {
  const base: BudgetScenarioDefinition = {
    scenarioRef: `scenario.${kind}`,
    kind,
    minorUnitScale: 2,
    requestedBudgetMinor: 11_000,
    allocations,
    constraints: [],
    strategy: { mode: "proportional", weights: [{ ref: "ankara", weight: 3 }, { ref: "dubai", weight: 2 }] },
    pacing: {
      period: { startDate: "2026-08-01", endDate: "2026-08-10", timezone: "Europe/Istanbul" },
      asOfAt: "2026-08-06T00:00:00.000Z",
      amounts: {
        currency: "TRY", plannedDecimal: "100.00", committedDecimal: "100.00",
        actualDecimal: "55.00", requestedCommitmentDecimal: "110.00",
      },
      signal: {
        kind: "business_outcome", metricRef: "qualified_lead", sampleSize: 120, coverageBps: 9500,
        observedThroughAt: "2026-08-04T00:00:00.000Z", retrievedAt: "2026-08-05T23:45:00.000Z",
        learningPhase: false, lastMaterialChangeAt: "2026-08-03T00:00:00.000Z",
      },
      policy: {
        moneyScale: 2, moneyRounding: "half_even", minimumElapsedBps: 1000,
        conservativeRemainingRateBps: 8000, forecastMinimumDecimal: "0", forecastMaximumDecimal: "140",
        maximumFreshnessMinutes: 60, minimumCoverageBps: 9000, minimumSampleSize: 100,
        attributionLagMinutes: 1440, suppressDuringLearning: true, cooldownMinutes: 1440,
        allowProxyAction: false, maximumChangeBps: 1000, maximumChangeAbsoluteDecimal: "15",
      },
    },
  };
  return { ...base, ...patch };
}

const frozenInput = { ref: "snapshot.budget.20260806", hash: "a".repeat(64) } as const;

describe("budget scenario composer", () => {
  it("composes three explicit alternatives over exactly the same frozen input", () => {
    const result = composeBudgetScenarios({
      frozenInput,
      scenarios: [scenario("keep", {
        requestedBudgetMinor: 10_000,
        pacing: { ...scenario("keep").pacing, amounts: {
          ...scenario("keep").pacing.amounts, requestedCommitmentDecimal: "100.00",
        } },
      }), scenario("conservative"), scenario("target_seeking", {
        requestedBudgetMinor: 12_000,
        pacing: { ...scenario("target_seeking").pacing, amounts: {
          ...scenario("target_seeking").pacing.amounts, requestedCommitmentDecimal: "120.00",
        } },
      })],
    });

    expect(result.alternatives).toHaveLength(3);
    expect(result.alternatives.every((item) => item.frozenInput === result.frozenInput)).toBe(true);
    expect(result.alternatives.every((item) => item.actionAuthority === "none")).toBe(true);
    expect(result.actionAuthority).toBe("none");
    expect(result.alternatives[0]).toMatchObject({ status: "no_change", reason: "already_at_target" });
    expect(result.alternatives[1]).toMatchObject({ status: "planned", after: { guardedBudgetMinor: 11_000 } });
    expect(result.alternatives[2]).toMatchObject({ status: "planned", after: { guardedBudgetMinor: 11_000 } });
  });

  it("preserves before/after values and the complete constraint and pacing traces", () => {
    const result = composeBudgetScenarios({ frozenInput, scenarios: [scenario("conservative", {
      constraints: [{ kind: "protected", dimension: "geo", refs: ["dubai"], behavior: "no_outflow" }],
      strategy: { mode: "fixed", targets: [{ ref: "ankara", amountMinor: 7_000 }, { ref: "dubai", amountMinor: 4_000 }] },
    })] });
    const alternative = result.alternatives[0]!;

    expect(alternative.before.allocations).toEqual([
      { ref: "ankara", amountMinor: 6_000 }, { ref: "dubai", amountMinor: 4_000 },
    ]);
    expect(alternative.after.allocations).toEqual([
      { ref: "ankara", amountMinor: 7_000, deltaMinor: 1_000 },
      { ref: "dubai", amountMinor: 4_000, deltaMinor: 0 },
    ]);
    expect(alternative.constraint.trace.some((item) => item.code === "protected_no_outflow")).toBe(true);
    expect(alternative.pacing.trace.some((item) => item.code === "maximum_change_passed")).toBe(true);
  });

  it("keeps pacing suppression visible and does not expose a changed after-state", () => {
    const definition = scenario("target_seeking");
    const result = composeBudgetScenarios({ frozenInput, scenarios: [{
      ...definition,
      pacing: { ...definition.pacing, signal: { ...definition.pacing.signal, learningPhase: true } },
    }] });
    const alternative = result.alternatives[0]!;

    expect(alternative).toMatchObject({ status: "suppressed", reason: "pacing_suppressed" });
    expect(alternative.pacing.adjustment).toMatchObject({ status: "suppressed", suppressionReasons: ["learning_phase"] });
    expect(alternative.after.allocations).toEqual(alternative.before.allocations.map((item) => ({
      ref: item.ref, amountMinor: item.amountMinor, deltaMinor: 0,
    })));
  });

  it("keeps pacing suppression primary even when the guarded constraint plan is unsatisfied", () => {
    const definition = scenario("target_seeking");
    const result = composeBudgetScenarios({ frozenInput, scenarios: [{
      ...definition,
      pacing: { ...definition.pacing, signal: { ...definition.pacing.signal, learningPhase: true } },
      strategy: { mode: "fixed", targets: [
        { ref: "ankara", amountMinor: 7_000 }, { ref: "dubai", amountMinor: 4_000 },
      ] },
    }] });
    expect(result.alternatives[0]).toMatchObject({
      status: "suppressed",
      reason: "pacing_suppressed",
      constraint: { status: "unsatisfied", reason: "fixed_total_mismatch" },
    });
  });

  it("keeps constraint unsatisfied details and traces visible", () => {
    const result = composeBudgetScenarios({ frozenInput, scenarios: [scenario("conservative", {
      constraints: [{ kind: "floor", selector: { allocationRefs: ["ankara"] }, amountMinor: 12_000 }],
    })] });
    const alternative = result.alternatives[0]!;

    expect(alternative).toMatchObject({ status: "unsatisfied", reason: "target_below_floors" });
    expect(alternative.constraint.status).toBe("unsatisfied");
    expect(alternative.constraint.trace.at(-1)?.code).toBe("target_below_floors");
    expect(alternative.after.allocations.every((item) => item.deltaMinor === 0)).toBe(true);
  });

  it("requires every amount/policy explicitly and rejects mismatches, duplicate modes and excess alternatives", () => {
    expect(() => composeBudgetScenarios({ frozenInput, scenarios: [scenario("keep", { requestedBudgetMinor: 10_999 })] }))
      .toThrowError(expect.objectContaining({ code: "amount_mismatch" }));
    expect(() => composeBudgetScenarios({ frozenInput, scenarios: [scenario("keep"), scenario("keep", { scenarioRef: "scenario.keep.2" })] }))
      .toThrowError(expect.objectContaining({ code: "invalid_scenario" }));
    expect(() => composeBudgetScenarios({ frozenInput, scenarios: [
      scenario("keep"), scenario("conservative"), scenario("target_seeking"), scenario("keep", { scenarioRef: "scenario.fourth" }),
    ] })).toThrow(BudgetScenarioComposerError);
    expect(() => composeBudgetScenarios({ frozenInput, scenarios: [{
      ...scenario("keep"), pacing: { ...scenario("keep").pacing, policy: undefined },
    } as never] })).toThrow();
  });

  it("is deterministic without persistence, Meta calls or execution authority", () => {
    const input = { frozenInput, scenarios: [scenario("conservative")] } as const;
    expect(composeBudgetScenarios(input)).toEqual(composeBudgetScenarios(input));
    expect(composeBudgetScenarios(input).proposalRef).toMatch(/^budget_scenarios_[a-f0-9]{20}$/);
  });
});
