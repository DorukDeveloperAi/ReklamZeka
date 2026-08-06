import type { MetricTotals, PerformanceSnapshot } from "@/domain/ads/performance";

export const INSIGHT_CALCULATION_VERSION = "insight-engine/1.0.0" as const;
export type InsightSeverity = "info" | "warning" | "critical";
export type InsightConfidence = "low" | "medium" | "high";

export type InsightEvidence = Readonly<{
  snapshotId: string;
  sourcePlatforms: readonly string[];
  periodDays: number;
  asOf: string;
  metric: string;
  current: number;
  previous: number;
  changeRatio: number | null;
  threshold: string;
}>;

export type Insight = Readonly<{
  id: string;
  ruleId: string;
  calculationVersion: typeof INSIGHT_CALCULATION_VERSION;
  title: string;
  explanation: string;
  severity: InsightSeverity;
  confidence: Readonly<{ level: InsightConfidence; score: number; reason: string }>;
  evidence: InsightEvidence;
  recommendedAction: string;
}>;

export type InsightEngineSnapshot = Readonly<{
  id: string;
  workspaceId: string;
  sourcePlatforms: readonly string[];
  performance: PerformanceSnapshot;
}>;

export class InsightValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InsightValidationError";
  }
}

export function validateInsight(insight: Insight): Insight {
  if (insight.calculationVersion !== INSIGHT_CALCULATION_VERSION) throw new InsightValidationError("Hesaplama sürümü zorunludur");
  if (!insight.id || !insight.ruleId || !insight.title || !insight.explanation || !insight.recommendedAction) {
    throw new InsightValidationError("İçgörü kimlik, açıklama ve önerilen aksiyon taşımalıdır");
  }
  if (!insight.evidence.snapshotId || insight.evidence.sourcePlatforms.length === 0 || !insight.evidence.metric) {
    throw new InsightValidationError("Kaynak ve kanıt alanları zorunludur");
  }
  if (!Number.isFinite(insight.confidence.score) || insight.confidence.score < 0 || insight.confidence.score > 1 || !insight.confidence.reason) {
    throw new InsightValidationError("Güven skoru 0–1 arasında ve gerekçeli olmalıdır");
  }
  return insight;
}

export function metricValue(totals: MetricTotals, metric: "spendMinor" | "conversions" | "cpaMinor" | "roas"): number {
  return totals[metric] ?? 0;
}
