import { describe, expect, it } from "vitest";
import {
  OBJECTIVE_PLAYBOOKS,
  assertComparableObjectives,
  evaluateAnalysisReadiness,
} from "@/analyses/objective-playbooks";
import { analysisDefinition } from "./helpers/analysis-definition";

describe("campaign objective playbooks", () => {
  it("uses different success criteria and decision guides per campaign objective", () => {
    expect(OBJECTIVE_PLAYBOOKS.awareness.primaryMetrics).toEqual(["reach", "impressions"]);
    expect(OBJECTIVE_PLAYBOOKS.traffic.primaryMetrics).toEqual(["landingPageViews", "cpcMinor"]);
    expect(OBJECTIVE_PLAYBOOKS.lead_generation.primaryMetrics).toContain("qualifiedLeads");
    expect(OBJECTIVE_PLAYBOOKS.sales.primaryMetrics).toContain("roas");
    expect(OBJECTIVE_PLAYBOOKS.awareness.decisionGuide).not.toEqual(OBJECTIVE_PLAYBOOKS.sales.decisionGuide);
  });

  it("rejects funnel and optimization-event combinations that conflict with the objective", () => {
    const input = analysisDefinition({
      campaignContext: { objective: "awareness", funnelStage: "conversion", optimizationEvent: "purchase", classificationSource: "user_confirmed" },
    });
    const result = evaluateAnalysisReadiness(input, ["impressions", "reach", "spendMinor"]);
    expect(result.ready).toBe(false);
    expect(result.blockers.join(" ")).toContain("funnel");
    expect(result.blockers.join(" ")).toContain("optimizasyon eventi");
  });

  it("reports missing objective metrics instead of treating generic conversions as every outcome", () => {
    const awareness = analysisDefinition({
      campaignContext: { objective: "awareness", funnelStage: "awareness", optimizationEvent: "reach", classificationSource: "user_confirmed" },
      rules: [{ id: "reach-floor", name: "Erişim", metric: "reach", operator: "lt", threshold: 1_000, minimumSample: { metric: "impressions", value: 10_000 }, severity: "warning", enabled: true }],
    });
    const result = evaluateAnalysisReadiness(awareness, ["conversions"]);
    expect(result.ready).toBe(false);
    expect(result.blockers.join(" ")).toContain("ana KPI");
    expect(result.blockers.join(" ")).toContain("reach");
  });

  it("does not permit a single success judgment across incompatible objectives", () => {
    expect(() => assertComparableObjectives("awareness", "sales")).toThrow("karşılaştırılamaz");
    expect(() => assertComparableObjectives("sales", "sales")).not.toThrow();
  });
});
