import { describe, expect, it } from "vitest";
import { dashboardResponse } from "@/app/api/dashboard/route";
import { GET, insightsResponse } from "@/app/api/insights/route";
import { runInsightEngine } from "@/insights/rules";
import {
  INSIGHT_CALCULATION_VERSION,
  InsightValidationError,
  validateInsight,
  type Insight,
  type InsightEngineSnapshot,
} from "@/insights/schema";

function snapshot(overrides: Partial<InsightEngineSnapshot["performance"]> = {}): InsightEngineSnapshot {
  const base = dashboardResponse(7).snapshot;
  return {
    id: "snapshot-2026-08-06",
    workspaceId: "workspace-a",
    sourcePlatforms: ["meta_ads", "google_ads"],
    performance: { ...base, ...overrides },
  };
}

const total = (input: { spend: number; conversions: number; value: number }) => ({
  spendMinor: input.spend,
  impressions: 10_000,
  clicks: 500,
  conversions: input.conversions,
  conversionValueMinor: input.value,
  ctr: 0.05,
  cpaMinor: input.conversions === 0 ? null : Math.round(input.spend / input.conversions),
  roas: input.spend === 0 ? null : input.value / input.spend,
});

describe("deterministic insight engine", () => {
  it("emits spend, conversion, efficiency and freshness findings on positive fixtures", () => {
    const input = snapshot({
      current: total({ spend: 20_000, conversions: 10, value: 40_000 }),
      previous: total({ spend: 10_000, conversions: 40, value: 40_000 }),
      freshness: { status: "stale", hours: 100, latestAt: "2026-08-02T08:00:00Z" },
    });
    const insights = runInsightEngine(input);
    expect(insights.map((insight) => insight.ruleId)).toEqual([
      "conversion-drop", "data-delay", "efficiency-decline", "spend-spike",
    ]);
    expect(insights.every((insight) => insight.calculationVersion === INSIGHT_CALCULATION_VERSION)).toBe(true);
    expect(insights.every((insight) => insight.evidence.snapshotId === input.id)).toBe(true);
  });

  it("stays quiet for stable and low-data snapshots", () => {
    const stable = total({ spend: 20_000, conversions: 30, value: 80_000 });
    expect(runInsightEngine(snapshot({ current: stable, previous: stable }))).toEqual([]);
    expect(runInsightEngine(snapshot({
      current: total({ spend: 8_000, conversions: 1, value: 500 }),
      previous: total({ spend: 5_000, conversions: 5, value: 4_000 }),
    }))).toEqual([]);
  });

  it("returns byte-equal, sorted JSON for the same snapshot", () => {
    const input = snapshot({ freshness: { status: "delayed", hours: 48, latestAt: "2026-08-04T12:00:00Z" } });
    expect(JSON.stringify(runInsightEngine(input))).toBe(JSON.stringify(runInsightEngine(input)));
  });

  it("exposes the same deterministic findings through the API contract", async () => {
    expect(insightsResponse(7, "delayed").map((insight) => insight.ruleId)).toContain("data-delay");
    const response = GET(new Request("http://localhost/api/insights?period=7&state=delayed"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ insights: [{ ruleId: "data-delay" }] });
  });

  it("rejects insights missing source, confidence or calculation version", () => {
    const invalid = {
      id: "bad", ruleId: "bad", calculationVersion: INSIGHT_CALCULATION_VERSION,
      title: "Eksik", explanation: "Eksik", severity: "warning",
      confidence: { level: "high", score: 2, reason: "" },
      evidence: { snapshotId: "", sourcePlatforms: [], periodDays: 7, asOf: "", metric: "", current: 1, previous: 1, changeRatio: 0, threshold: "" },
      recommendedAction: "Kontrol et",
    } as Insight;
    expect(() => validateInsight(invalid)).toThrow(InsightValidationError);
  });
});
