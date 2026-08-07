import { describe, expect, it } from "vitest";
import {
  BudgetPacingError,
  evaluateBudgetPacing,
  type BudgetPacingInput,
} from "../src/domain/budget/pacing-forecast";

function request(patch: Partial<BudgetPacingInput> = {}): BudgetPacingInput {
  const base: BudgetPacingInput = {
    period: { startDate: "2026-08-01", endDate: "2026-08-10", timezone: "Europe/Istanbul" },
    asOfAt: "2026-08-06T00:00:00.000Z",
    amounts: {
      currency: "TRY",
      plannedDecimal: "1000.00",
      committedDecimal: "1000.00",
      actualDecimal: "550.00",
      requestedCommitmentDecimal: "1080.00",
    },
    signal: {
      kind: "business_outcome",
      metricRef: "qualified_lead",
      sampleSize: 120,
      coverageBps: 9500,
      observedThroughAt: "2026-08-04T00:00:00.000Z",
      retrievedAt: "2026-08-05T23:45:00.000Z",
      learningPhase: false,
      lastMaterialChangeAt: "2026-08-03T00:00:00.000Z",
    },
    policy: {
      moneyScale: 2,
      moneyRounding: "half_even",
      minimumElapsedBps: 1000,
      conservativeRemainingRateBps: 8000,
      forecastMinimumDecimal: "0",
      forecastMaximumDecimal: "1400",
      maximumFreshnessMinutes: 60,
      minimumCoverageBps: 9000,
      minimumSampleSize: 100,
      attributionLagMinutes: 1440,
      suppressDuringLearning: true,
      cooldownMinutes: 1440,
      allowProxyAction: false,
      maximumChangeBps: 1000,
      maximumChangeAbsoluteDecimal: "150",
    },
  };
  return {
    ...base,
    ...patch,
    period: patch.period ?? base.period,
    amounts: patch.amounts ?? base.amounts,
    signal: patch.signal ?? base.signal,
    policy: patch.policy ?? base.policy,
  };
}

describe("budget pacing and bounded forecast", () => {
  it("uses the configured timezone and inclusive local-date period", () => {
    const result = evaluateBudgetPacing(request());

    expect(result.period).toEqual({
      timezone: "Europe/Istanbul",
      startAt: "2026-07-31T21:00:00.000Z",
      endExclusiveAt: "2026-08-10T21:00:00.000Z",
      elapsedMilliseconds: "442800000",
      totalMilliseconds: "864000000",
      elapsedBps: 5125,
    });
    expect(result.amounts).toMatchObject({
      plannedDecimal: "1000.00",
      committedDecimal: "1000.00",
      actualDecimal: "550.00",
      expectedToDateDecimal: "512.50",
      paceVarianceDecimal: "37.50",
      paceVarianceBps: 732,
    });
  });

  it("calculates linear and configured conservative forecasts then applies explicit bounds", () => {
    const result = evaluateBudgetPacing(request());
    expect(result.forecast).toEqual({
      status: "available",
      linearDecimal: "1073.17",
      conservativeDecimal: "968.54",
      minimumDecimal: "0.00",
      maximumDecimal: "1400.00",
    });

    const bounded = evaluateBudgetPacing(request({
      policy: { ...request().policy, forecastMaximumDecimal: "900" },
    }));
    expect(bounded.forecast.linearDecimal).toBe("900.00");
    expect(bounded.forecast.conservativeDecimal).toBe("830.00");
  });

  it("keeps decimal money exact and follows the configured rounding mode", () => {
    const result = evaluateBudgetPacing(request({
      asOfAt: "2026-08-05T21:00:00.000Z",
      amounts: {
        currency: "TRY", plannedDecimal: "0.30", committedDecimal: "0.20",
        actualDecimal: "0.10", requestedCommitmentDecimal: "0.22",
      },
      signal: { ...request().signal, retrievedAt: "2026-08-05T20:45:00.000Z" },
      policy: {
        ...request().policy,
        forecastMaximumDecimal: "1",
        maximumChangeAbsoluteDecimal: "1",
      },
    }));
    expect(result.amounts.expectedToDateDecimal).toBe("0.15");
    expect(result.amounts.paceVarianceDecimal).toBe("-0.05");
    expect(result.adjustment.guardedCommitmentDecimal).toBe("0.22");
  });

  it("caps both requested increases and decreases by the tighter absolute/percentage guard", () => {
    const increase = evaluateBudgetPacing(request({
      amounts: { ...request().amounts, requestedCommitmentDecimal: "1300" },
    }));
    expect(increase.adjustment).toMatchObject({
      status: "capped",
      requestedCommitmentDecimal: "1300.00",
      guardedCommitmentDecimal: "1100.00",
      guardedDeltaDecimal: "100.00",
      actionAuthority: "none",
    });
    expect(increase.trace).toContainEqual(expect.objectContaining({ code: "maximum_increase_applied", disposition: "cap" }));

    const decrease = evaluateBudgetPacing(request({
      amounts: { ...request().amounts, requestedCommitmentDecimal: "500" },
    }));
    expect(decrease.adjustment).toMatchObject({ status: "capped", guardedCommitmentDecimal: "900.00", guardedDeltaDecimal: "-100.00" });
  });

  it.each([
    ["minimum_elapsed_not_met", {
      asOfAt: "2026-07-31T22:00:00.000Z",
      signal: {
        ...request().signal,
        observedThroughAt: "2026-07-30T00:00:00.000Z",
        retrievedAt: "2026-07-31T22:00:00.000Z",
        lastMaterialChangeAt: null,
      },
    }],
    ["stale_retrieval", { signal: { ...request().signal, retrievedAt: "2026-08-05T20:00:00.000Z" } }],
    ["insufficient_coverage", { signal: { ...request().signal, coverageBps: 8999 } }],
    ["insufficient_sample", { signal: { ...request().signal, sampleSize: 99 } }],
    ["attribution_unsettled", { signal: { ...request().signal, observedThroughAt: "2026-08-05T12:01:00.000Z" } }],
    ["learning_phase", { signal: { ...request().signal, learningPhase: true } }],
    ["cooldown_active", { signal: { ...request().signal, lastMaterialChangeAt: "2026-08-05T12:01:00.000Z" } }],
  ] as const)("suppresses adjustment when %s guard fails", (reason, patch) => {
    const result = evaluateBudgetPacing(request(patch as Partial<BudgetPacingInput>));
    expect(result.adjustment.status).toBe("suppressed");
    expect(result.adjustment.guardedCommitmentDecimal).toBe("1000.00");
    expect(result.adjustment.suppressionReasons).toContain(reason);
    expect(result.trace).toContainEqual(expect.objectContaining({ code: reason, disposition: "suppress" }));
  });

  it("keeps proxy separate from business outcome and requires explicit permission for action", () => {
    const proxy = evaluateBudgetPacing(request({
      signal: { ...request().signal, kind: "proxy", metricRef: "landing_page_view", observedThroughAt: "2026-08-05T23:59:00.000Z", retrievedAt: "2026-08-05T23:59:30.000Z" },
    }));
    expect(proxy.signal).toEqual({ kind: "proxy", metricRef: "landing_page_view", interpretation: "proxy_not_outcome" });
    expect(proxy.adjustment.suppressionReasons).toContain("proxy_action_not_allowed");
    expect(proxy.adjustment.suppressionReasons).not.toContain("attribution_unsettled");

    const explicitlyAllowed = evaluateBudgetPacing(request({
      signal: { ...request().signal, kind: "proxy", metricRef: "landing_page_view", observedThroughAt: "2026-08-05T23:59:00.000Z", retrievedAt: "2026-08-05T23:59:30.000Z" },
      policy: { ...request().policy, allowProxyAction: true },
    }));
    expect(explicitlyAllowed.adjustment.status).toBe("allowed");
  });

  it("reports every suppression in stable order instead of hiding the first failure", () => {
    const result = evaluateBudgetPacing(request({
      signal: {
        ...request().signal,
        sampleSize: 1,
        coverageBps: 10,
        learningPhase: true,
        observedThroughAt: "2026-08-03T00:00:00.000Z",
        retrievedAt: "2026-08-04T00:00:00.000Z",
      },
    }));
    expect(result.adjustment.suppressionReasons).toEqual([
      "stale_retrieval", "insufficient_coverage", "insufficient_sample", "learning_phase",
    ]);
    expect(result.trace.map((entry) => entry.sequence)).toEqual(result.trace.map((_, index) => index + 1));
  });

  it("does not produce a forecast or adjustment at the local period boundary", () => {
    const result = evaluateBudgetPacing(request({
      asOfAt: "2026-07-31T21:00:00.000Z",
      signal: {
        ...request().signal,
        observedThroughAt: "2026-07-30T20:00:00.000Z",
        retrievedAt: "2026-07-31T21:00:00.000Z",
        lastMaterialChangeAt: null,
      },
    }));
    expect(result.forecast).toMatchObject({ status: "period_not_started", linearDecimal: null, conservativeDecimal: null });
    expect(result.adjustment.suppressionReasons).toEqual(["period_not_started", "minimum_elapsed_not_met"]);
  });

  it("accounts for DST when determining local calendar duration", () => {
    const result = evaluateBudgetPacing(request({
      period: { startDate: "2026-03-08", endDate: "2026-03-08", timezone: "America/New_York" },
      asOfAt: "2026-03-08T16:00:00.000Z",
      signal: {
        ...request().signal,
        observedThroughAt: "2026-03-07T00:00:00.000Z",
        retrievedAt: "2026-03-08T15:45:00.000Z",
        lastMaterialChangeAt: null,
      },
    }));
    expect(result.period).toMatchObject({
      startAt: "2026-03-08T05:00:00.000Z",
      endExclusiveAt: "2026-03-09T04:00:00.000Z",
      totalMilliseconds: String(23 * 60 * 60 * 1000),
    });
  });

  it.each([
    ["implicit policy defaults", { policy: { ...request().policy, minimumSampleSize: undefined } }, "invalid_policy"],
    ["unknown timezone", { period: { ...request().period, timezone: "Mars/Olympus" } }, "invalid_period"],
    ["invalid calendar", { period: { ...request().period, startDate: "2026-02-30" } }, "invalid_period"],
    ["future retrieval", { signal: { ...request().signal, retrievedAt: "2026-08-07T00:00:00.000Z" } }, "invalid_observation"],
    ["retrieval before observation", { signal: { ...request().signal, retrievedAt: "2026-08-03T00:00:00.000Z" } }, "invalid_observation"],
    ["negative money", { amounts: { ...request().amounts, actualDecimal: "-1" } }, "invalid_money"],
    ["inverted bounds", { policy: { ...request().policy, forecastMinimumDecimal: "1500" } }, "invalid_policy"],
  ] as const)("fails closed for %s", (_label, patch, code) => {
    expect(() => evaluateBudgetPacing(request(patch as Partial<BudgetPacingInput>)))
      .toThrowError(expect.objectContaining({ code }));
  });

  it("redacts values from thrown errors", () => {
    try {
      evaluateBudgetPacing(request({ amounts: { ...request().amounts, actualDecimal: "secret-invalid" } }));
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(BudgetPacingError);
      expect((error as Error).message).toBe("Bütçe pacing değerlendirmesi güvenli biçimde üretilemedi");
      expect((error as Error).message).not.toContain("secret-invalid");
    }
  });
});
