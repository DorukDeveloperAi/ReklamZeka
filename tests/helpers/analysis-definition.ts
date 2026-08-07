import type { AnalysisDefinition } from "@/analyses/schema";

export function analysisDefinition(overrides: Partial<AnalysisDefinition> = {}): AnalysisDefinition {
  return {
    id: "analysis-sales-daily",
    workspaceId: "workspace-a",
    ownerId: "user-a",
    version: 1,
    status: "draft",
    name: "Günlük satış kontrolü",
    campaignContext: {
      objective: "sales",
      funnelStage: "conversion",
      optimizationEvent: "purchase",
      classificationSource: "user_confirmed",
    },
    timeframe: { kind: "rolling", days: 7, timezone: "Europe/Istanbul" },
    comparison: "previous_period",
    rules: [{
      id: "roas-floor",
      name: "ROAS alt sınırı",
      metric: "roas",
      operator: "lt",
      threshold: 2.5,
      minimumSample: { metric: "spendMinor", value: 50_000 },
      severity: "warning",
      enabled: true,
    }],
    schedule: { frequency: "daily", at: "09:00", timezone: "Europe/Istanbul", enabled: true, misfirePolicy: "run_once" },
    narrative: { mode: "narrative_only", userGuidance: "Yönetici dilinde kısa yaz.", tone: "concise", sections: ["summary", "recommendations"] },
    ...overrides,
  };
}
