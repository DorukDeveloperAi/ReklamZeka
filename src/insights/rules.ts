import { INSIGHT_CALCULATION_VERSION, metricValue, validateInsight, type Insight, type InsightEngineSnapshot } from "./schema";

export interface InsightRule {
  readonly id: string;
  evaluate(snapshot: InsightEngineSnapshot): Insight | null;
}

function ratio(current: number, previous: number): number | null {
  return previous === 0 ? null : (current - previous) / previous;
}

function makeInsight(
  snapshot: InsightEngineSnapshot,
  input: Omit<Insight, "id" | "calculationVersion" | "evidence"> & {
    metric: string;
    current: number;
    previous: number;
    threshold: string;
  },
): Insight {
  return validateInsight({
    id: `${input.ruleId}:${INSIGHT_CALCULATION_VERSION}:${snapshot.id}`,
    ruleId: input.ruleId,
    calculationVersion: INSIGHT_CALCULATION_VERSION,
    title: input.title,
    explanation: input.explanation,
    severity: input.severity,
    confidence: input.confidence,
    recommendedAction: input.recommendedAction,
    evidence: {
      snapshotId: snapshot.id,
      sourcePlatforms: [...snapshot.sourcePlatforms].sort(),
      periodDays: snapshot.performance.periodDays,
      asOf: snapshot.performance.asOf,
      metric: input.metric,
      current: input.current,
      previous: input.previous,
      changeRatio: ratio(input.current, input.previous),
      threshold: input.threshold,
    },
  });
}

export const spendSpikeRule: InsightRule = {
  id: "spend-spike",
  evaluate(snapshot) {
    const current = snapshot.performance.current.spendMinor;
    const previous = snapshot.performance.previous.spendMinor;
    if (previous < 10_000 || current < previous * 1.25) return null;
    return makeInsight(snapshot, {
      ruleId: this.id, metric: "spendMinor", current, previous, threshold: ">= %25 artış; önceki harcama >= 100 TRY",
      title: "Harcama belirgin biçimde yükseldi",
      explanation: "Seçili dönem harcaması önceki eş dönemin en az %25 üzerinde.",
      severity: current >= previous * 1.5 ? "critical" : "warning",
      confidence: { level: "high", score: 0.94, reason: "İki tam dönem ve yeterli harcama hacmi karşılaştırıldı." },
      recommendedAction: "Bütçe, teklif ve yayın durumu değişikliklerini kampanya bazında inceleyin; otomatik değişiklik yapılmadı.",
    });
  },
};

export const conversionDropRule: InsightRule = {
  id: "conversion-drop",
  evaluate(snapshot) {
    const current = snapshot.performance.current.conversions;
    const previous = snapshot.performance.previous.conversions;
    if (previous < 20 || current > previous * 0.75) return null;
    return makeInsight(snapshot, {
      ruleId: this.id, metric: "conversions", current, previous, threshold: "<= %25 düşüş; önceki dönüşüm >= 20",
      title: "Dönüşümler geriledi",
      explanation: "Dönüşüm hacmi önceki eş döneme göre en az %25 düştü.",
      severity: current <= previous * 0.5 ? "critical" : "warning",
      confidence: { level: "high", score: 0.91, reason: "Dönüşüm tabanı az-veri eşiğinin üzerinde." },
      recommendedAction: "Dönüşüm izleme sağlığını, landing page değişikliklerini ve kampanya dağılımını kontrol edin.",
    });
  },
};

export const efficiencyDeclineRule: InsightRule = {
  id: "efficiency-decline",
  evaluate(snapshot) {
    const currentCpa = metricValue(snapshot.performance.current, "cpaMinor");
    const previousCpa = metricValue(snapshot.performance.previous, "cpaMinor");
    const currentRoas = metricValue(snapshot.performance.current, "roas");
    const previousRoas = metricValue(snapshot.performance.previous, "roas");
    const cpaWorse = previousCpa > 0 && currentCpa >= previousCpa * 1.25;
    const roasWorse = previousRoas > 0 && currentRoas <= previousRoas * 0.75;
    if (snapshot.performance.previous.conversions < 20 || (!cpaWorse && !roasWorse)) return null;
    const useCpa = cpaWorse;
    return makeInsight(snapshot, {
      ruleId: this.id,
      metric: useCpa ? "cpaMinor" : "roas",
      current: useCpa ? currentCpa : currentRoas,
      previous: useCpa ? previousCpa : previousRoas,
      threshold: useCpa ? "CPA >= %25 artış" : "ROAS >= %25 düşüş",
      title: "Edinme verimliliği bozuldu",
      explanation: useCpa ? "Dönüşüm başına maliyet anlamlı biçimde yükseldi." : "Harcama getirisi anlamlı biçimde düştü.",
      severity: "warning",
      confidence: { level: "medium", score: 0.84, reason: "Yeterli dönüşüm var; attribution ve ürün karması yine de sonucu etkileyebilir." },
      recommendedAction: "En çok harcayan kampanyalarda maliyet ve dönüşüm değerini ayrı ayrı karşılaştırın.",
    });
  },
};

export const dataDelayRule: InsightRule = {
  id: "data-delay",
  evaluate(snapshot) {
    const hours = snapshot.performance.freshness.hours ?? 0;
    if (snapshot.performance.freshness.status === "fresh" || snapshot.performance.freshness.status === "empty") return null;
    return makeInsight(snapshot, {
      ruleId: this.id, metric: "freshnessHours", current: hours, previous: 24, threshold: "> 24 saat",
      title: "Karar için veri yeterince taze değil",
      explanation: `Son kaynak güncellemesi yaklaşık ${Math.round(hours)} saat önce gerçekleşti.`,
      severity: hours > 72 ? "critical" : "warning",
      confidence: { level: "high", score: 0.99, reason: "Kaynak güncellenme zamanı doğrudan connector izinden alındı." },
      recommendedAction: "Senkronizasyon durumunu ve connector kotasını kontrol edin; veri yenilenene kadar aksiyon almayın.",
    });
  },
};

export const DEFAULT_INSIGHT_RULES = [spendSpikeRule, conversionDropRule, efficiencyDeclineRule, dataDelayRule] as const;

export function runInsightEngine(snapshot: InsightEngineSnapshot, rules: readonly InsightRule[] = DEFAULT_INSIGHT_RULES): readonly Insight[] {
  return rules
    .map((rule) => rule.evaluate(snapshot))
    .filter((insight): insight is Insight => insight !== null)
    .sort((left, right) => left.ruleId.localeCompare(right.ruleId));
}
