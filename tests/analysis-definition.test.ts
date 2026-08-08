import { describe, expect, it } from "vitest";
import {
  AnalysisDefinitionValidationError,
  validateAnalysisDefinition,
  type AnalysisDefinition,
} from "@/analyses/schema";
import { analysisDefinition } from "./helpers/analysis-definition";

describe("analysis definition contract", () => {
  it("accepts a versioned category-aware definition with separate timeframe and schedule", () => {
    expect(validateAnalysisDefinition(analysisDefinition())).toMatchObject({
      version: 1,
      timeframe: { kind: "rolling", days: 7 },
      schedule: { frequency: "daily", at: "09:00" },
    });
  });

  it("does not publish an uncertain campaign classification", () => {
    const input = analysisDefinition({
      status: "published",
      campaignContext: { objective: "sales", funnelStage: "conversion", optimizationEvent: "purchase", classificationSource: "uncertain" },
    });
    expect(() => validateAnalysisDefinition(input)).toThrow("Belirsiz kampanya sınıflandırması yayınlanamaz");
  });

  it.each([
    ["invalid timezone", { timeframe: { kind: "rolling", days: 7, timezone: "Mars/Olympus" } }],
    ["impossible fixed date", { timeframe: { kind: "fixed", startDate: "2026-02-30", endDate: "2026-03-01", timezone: "UTC" } }],
    ["invalid schedule clock", { schedule: { frequency: "daily", at: "25:00", timezone: "Europe/Istanbul", enabled: true, misfirePolicy: "skip" } }],
    ["raw cron field", { schedule: { frequency: "daily", at: "09:00", timezone: "Europe/Istanbul", enabled: true, misfirePolicy: "skip", cron: "* * * * *" } }],
    ["executable code field", { rules: [{ id: "unsafe", name: "unsafe", metric: "roas", operator: "lt", threshold: 1, minimumSample: { metric: "spendMinor", value: 1 }, severity: "critical", enabled: true, sql: "select *" }] }],
  ])("rejects %s", (_label, override) => {
    expect(() => validateAnalysisDefinition(analysisDefinition(override as Partial<AnalysisDefinition>))).toThrow(AnalysisDefinitionValidationError);
  });
});
