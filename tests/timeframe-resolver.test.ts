import { describe, expect, it } from "vitest";
import {
  resolveAnalysisTimeframe,
  TimeframeResolutionError,
  validateResolvedAnalysisTimeframe,
} from "@/analyses/timeframe-resolver";

describe("analysis timeframe resolver", () => {
  it("resolves rolling days inclusively in the selected timezone across DST", () => {
    const result = resolveAnalysisTimeframe({
      timeframe: { kind: "rolling", days: 2, timezone: "America/New_York" },
      comparison: "previous_period",
      asOf: "2026-03-09T03:30:00.000Z",
    });

    expect(result).toMatchObject({
      asOfDate: "2026-03-08",
      startDate: "2026-03-07",
      endDate: "2026-03-08",
      inclusiveDayCount: 2,
      comparisonStartDate: "2026-03-05",
      comparisonEndDate: "2026-03-06",
    });
  });

  it.each([
    [{ unit: "week", offset: 0 } as const, "2025-12-29", "2026-01-01"],
    [{ unit: "month", offset: 0 } as const, "2026-01-01", "2026-01-01"],
    [{ unit: "quarter", offset: -1 } as const, "2025-10-01", "2025-12-31"],
  ])("resolves calendar $unit/$offset boundaries", (calendar, startDate, endDate) => {
    const result = resolveAnalysisTimeframe({
      timeframe: { kind: "calendar", ...calendar, timezone: "Europe/Istanbul" },
      comparison: "none",
      asOf: "2026-01-01T12:00:00.000Z",
    });
    expect(result).toMatchObject({ startDate, endDate });
  });

  it("caps lifetime and learning anchors at the local as-of date", () => {
    expect(resolveAnalysisTimeframe({
      timeframe: { kind: "lifetime", timezone: "Europe/Istanbul" },
      comparison: "none",
      asOf: "2026-08-07T08:00:00.000Z",
      anchors: { lifetime: { startDate: "2026-07-01", endDate: "2026-12-31" } },
    })).toMatchObject({ startDate: "2026-07-01", endDate: "2026-08-07" });

    expect(resolveAnalysisTimeframe({
      timeframe: { kind: "learning", timezone: "Europe/Istanbul" },
      comparison: "none",
      asOf: "2026-08-07T08:00:00.000Z",
      anchors: { learning: { startDate: "2026-08-03", endDate: "2026-08-05" } },
    })).toMatchObject({ startDate: "2026-08-03", endDate: "2026-08-05" });
  });

  it("resolves action-relative days using the action's local calendar date", () => {
    const result = resolveAnalysisTimeframe({
      timeframe: { kind: "action_relative", beforeDays: 2, afterDays: 3, timezone: "America/New_York" },
      comparison: "none",
      asOf: "2026-11-05T12:00:00.000Z",
      anchors: { action: { occurredAt: "2026-11-02T02:30:00.000Z" } },
    });
    expect(result).toMatchObject({ startDate: "2026-10-30", endDate: "2026-11-04", inclusiveDayCount: 6 });
  });

  it("keeps weekday-matched comparisons non-overlapping while preserving weekdays", () => {
    const result = resolveAnalysisTimeframe({
      timeframe: { kind: "fixed", startDate: "2026-08-03", endDate: "2026-08-12", timezone: "Europe/Istanbul" },
      comparison: "weekday_matched",
      asOf: "2026-08-12T12:00:00.000Z",
    });
    expect(result).toMatchObject({ comparisonStartDate: "2026-07-20", comparisonEndDate: "2026-07-29" });
  });

  it("clamps leap-day previous-year comparisons to a real calendar day", () => {
    const result = resolveAnalysisTimeframe({
      timeframe: { kind: "fixed", startDate: "2024-02-29", endDate: "2024-02-29", timezone: "UTC" },
      comparison: "previous_year",
      asOf: "2024-03-01T00:00:00.000Z",
    });
    expect(result).toMatchObject({ comparisonStartDate: "2023-02-28", comparisonEndDate: "2023-02-28" });
  });

  it("does not resolve a fixed window containing future unobserved days", () => {
    expect(() => resolveAnalysisTimeframe({
      timeframe: { kind: "fixed", startDate: "2026-08-01", endDate: "2026-08-08", timezone: "Europe/Istanbul" },
      comparison: "none",
      asOf: "2026-08-07T08:00:00.000Z",
    })).toThrow("asOf sonrasını kapsayamaz");
  });

  it.each([
    ["resolver version", { resolverVersion: "forged/v9" }],
    ["inclusive day count", { inclusiveDayCount: 99 }],
    ["none dates", { comparisonStartDate: "2026-07-01" }],
    ["future primary", { endDate: "2026-08-08", inclusiveDayCount: 8 }],
  ])("rejects a forged resolved window with invalid %s", (_label, override) => {
    const valid = resolveAnalysisTimeframe({
      timeframe: { kind: "rolling", days: 7, timezone: "Europe/Istanbul" },
      comparison: "none",
      asOf: "2026-08-07T08:00:00.000Z",
    });
    expect(() => validateResolvedAnalysisTimeframe({ ...valid, ...override } as typeof valid)).toThrow(TimeframeResolutionError);
  });

  it("rejects overlapping or otherwise forged weekday comparison dates", () => {
    const valid = resolveAnalysisTimeframe({
      timeframe: { kind: "rolling", days: 7, timezone: "UTC" },
      comparison: "weekday_matched",
      asOf: "2026-08-07T08:00:00.000Z",
    });
    expect(() => validateResolvedAnalysisTimeframe({
      ...valid,
      comparisonStartDate: valid.startDate,
      comparisonEndDate: valid.endDate,
    })).toThrow("politikayla uyuşmuyor");
  });

  it.each([
    ["missing lifetime anchor", { timeframe: { kind: "lifetime", timezone: "UTC" }, comparison: "none", asOf: "2026-08-07T00:00:00Z" }],
    ["invalid fixed date", { timeframe: { kind: "fixed", startDate: "2026-02-30", endDate: "2026-03-01", timezone: "UTC" }, comparison: "none", asOf: "2026-08-07T00:00:00Z" }],
    ["future learning anchor", { timeframe: { kind: "learning", timezone: "UTC" }, comparison: "none", asOf: "2026-08-07T00:00:00Z", anchors: { learning: { startDate: "2026-08-08" } } }],
    ["date-only as-of", { timeframe: { kind: "rolling", days: 7, timezone: "UTC" }, comparison: "none", asOf: "2026-08-07" }],
    ["zero-day rolling", { timeframe: { kind: "rolling", days: 0, timezone: "UTC" }, comparison: "none", asOf: "2026-08-07T00:00:00Z" }],
  ])("fails closed for %s", (_label, input) => {
    expect(() => resolveAnalysisTimeframe(input as Parameters<typeof resolveAnalysisTimeframe>[0])).toThrow(TimeframeResolutionError);
  });
});
