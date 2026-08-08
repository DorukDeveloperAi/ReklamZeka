import { describe, expect, it } from "vitest";
import { ANALYSIS_METRICS, type AnalysisMetric } from "@/analyses/schema";
import {
  META_METRIC_FORMULA_CATALOG,
  META_METRIC_FORMULA_CATALOG_VERSION,
  MetaMetricAggregationError,
  aggregateMetaMetrics,
  type MetaAggregatedMetric,
} from "@/domain/meta/insights/metric-engine";
import {
  normalizeMetaDailyInsight,
  type CanonicalMetaDailyInsight,
  type MetaMetricValue,
} from "@/domain/meta/insights/contract";

function metric(metricKey: string, valueDecimal: string, actionType?: string): MetaMetricValue {
  return { metricKey, ...(actionType ? { actionType } : {}), aggregation: "additive", valueDecimal, provenance: { field: metricKey } };
}

function money(metricKey: string, valueMinor: number, actionType?: string, currency = "TRY"): MetaMetricValue {
  return { metricKey, ...(actionType ? { actionType } : {}), aggregation: "additive", valueMinor, currency, provenance: { field: metricKey } };
}

function row(input: Readonly<{
  id: string;
  date: string;
  attributionLabel?: string;
  currency?: string;
  metrics: readonly MetaMetricValue[];
}>): CanonicalMetaDailyInsight {
  return normalizeMetaDailyInsight({
    schemaVersion: 1,
    workspaceId: "workspace",
    metaConnectionId: "connection",
    adAccountId: "account",
    entityLevel: "campaign",
    externalEntityId: input.id,
    dateStart: input.date,
    dateStop: input.date,
    attributionLabel: input.attributionLabel ?? "7d_click_1d_view",
    attributionWindow: { click: 7, view: 1 },
    currency: input.currency ?? "TRY",
    timezone: "Europe/Istanbul",
    sourceRevision: `revision-${input.id}`,
    sourcePayloadHash: `hash-${input.id}`,
    metricProvenance: { source: "meta" },
    metrics: input.metrics,
  });
}

function completeRows(): readonly CanonicalMetaDailyInsight[] {
  return [
    row({ id: "campaign-a", date: "2026-08-05", metrics: [
      money("spend", 10_000), metric("impressions", "1000"), metric("clicks", "40"),
      metric("actions", "4", "conversion"), money("action_values", 20_000, "purchase"),
      { ...metric("reach", "800"), aggregation: "non_additive" },
      { ...metric("frequency", "1.25"), aggregation: "non_additive" },
      metric("actions", "30", "landing_page_view"), metric("actions", "100", "post_engagement"),
      metric("actions", "5", "lead"), metric("actions", "2", "qualified_lead"),
      metric("actions", "3", "messaging_conversation_started"), metric("actions", "2", "app_install"),
      metric("actions", "4", "purchase"),
      { ...metric("retention_d7", "0.2"), aggregation: "non_additive" },
      { metricKey: "ctr", aggregation: "derived", valueDecimal: "0.99", provenance: { formulaVersion: "upstream" } },
    ] }),
    row({ id: "campaign-b", date: "2026-08-06", metrics: [
      money("spend", 20_000), metric("impressions", "2000"), metric("clicks", "50"),
      metric("actions", "6", "conversion"), money("action_values", 40_000, "purchase"),
      { ...metric("reach", "1500"), aggregation: "non_additive" },
      { ...metric("frequency", "1.4"), aggregation: "non_additive" },
      metric("actions", "40", "landing_page_view"), metric("actions", "200", "post_engagement"),
      metric("actions", "7", "lead"), metric("actions", "3", "qualified_lead"),
      metric("actions", "5", "messaging_conversation_started"), metric("actions", "4", "app_install"),
      metric("actions", "6", "purchase"),
      { ...metric("retention_d7", "0.25"), aggregation: "non_additive" },
      { metricKey: "ctr", aggregation: "derived", valueDecimal: "0.01", provenance: { formulaVersion: "upstream" } },
    ] }),
  ];
}

function byMetric(result: readonly MetaAggregatedMetric[]): Readonly<Record<string, MetaAggregatedMetric>> {
  return Object.fromEntries(result.map((item) => [item.metric, item]));
}

describe("versioned Meta metric formula catalog", () => {
  it("covers the complete AnalysisMetric vocabulary without a parallel metric namespace", () => {
    expect(Object.keys(META_METRIC_FORMULA_CATALOG).sort()).toEqual([...ANALYSIS_METRICS].sort());
    expect(META_METRIC_FORMULA_CATALOG_VERSION).toBe("meta-metric-formulas/1.0.0");
  });

  it("matches the golden ratio-of-sums formulas with explicit numerator provenance", () => {
    const metrics: AnalysisMetric[] = [
      "spendMinor", "impressions", "clicks", "conversions", "leads", "qualifiedLeads",
      "messages", "appInstalls", "purchases", "revenueMinor", "ctr", "cpcMinor", "cpmMinor",
      "cpaMinor", "cplMinor", "costPerMessageMinor", "roas", "averageOrderValueMinor",
      "conversionRate", "qualifiedLeadRate", "engagementRate", "cpeMinor", "cpiMinor",
    ];
    const result = byMetric(aggregateMetaMetrics({ rows: completeRows(), metrics }).metrics);
    const values = Object.fromEntries(Object.entries(result).map(([key, item]) => [
      key,
      item.status === "available" ? item.valueDecimal : item.reason,
    ]));

    expect(values).toMatchObject({
      spendMinor: "30000",
      impressions: "3000",
      clicks: "90",
      conversions: "10",
      leads: "12",
      qualifiedLeads: "5",
      messages: "8",
      appInstalls: "6",
      purchases: "10",
      revenueMinor: "60000",
      ctr: "0.03",
      cpcMinor: "333.333333333333",
      cpmMinor: "10000",
      cpaMinor: "3000",
      cplMinor: "2500",
      costPerMessageMinor: "3750",
      roas: "2",
      averageOrderValueMinor: "6000",
      conversionRate: "0.111111111111",
      qualifiedLeadRate: "0.416666666667",
      engagementRate: "0.1",
      cpeMinor: "100",
      cpiMinor: "5000",
    });
    expect(result.ctr?.provenance).toMatchObject({
      aggregationRule: "ratio_of_sums",
      numerator: "clicks",
      denominator: "impressions",
      factor: 1,
      components: {
        numerator: { metric: "clicks", sourceMetricKey: "clicks" },
        denominator: { metric: "impressions", sourceMetricKey: "impressions" },
      },
    });
    expect(result.ctr?.status === "available" && result.ctr.valueDecimal).not.toBe("0.99");
  });

  it("is replay- and order-stable for identical canonical rows", () => {
    const rows = completeRows();
    const metrics: AnalysisMetric[] = ["roas", "ctr", "spendMinor", "reach"];
    const first = aggregateMetaMetrics({ rows, metrics });
    const reordered = aggregateMetaMetrics({ rows: [rows[1]!, rows[0]!, rows[0]!], metrics: [...metrics].reverse() });

    expect(reordered.metrics).toEqual(first.metrics);
    expect(reordered.resultHash).toBe(first.resultHash);
    expect(first.resultHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("deduplicates an exact replay but rejects two revisions of one canonical identity", () => {
    const original = completeRows()[0]!;
    const exactReplay = aggregateMetaMetrics({ rows: [original, original], metrics: ["spendMinor"] });
    expect(exactReplay.metrics[0]).toMatchObject({ status: "available", valueDecimal: "10000" });

    const { identity: _identity, contentHash: _contentHash, ...originalInput } = original;
    const conflicting = normalizeMetaDailyInsight({
      ...originalInput,
      sourceRevision: "newer-revision",
      sourcePayloadHash: "newer-payload",
      metrics: original.metrics.map((item) => item.metricKey === "spend"
        ? { ...item, valueMinor: 20_000 }
        : item),
    });
    expect(() => aggregateMetaMetrics({ rows: [original, conflicting], metrics: ["spendMinor"] }))
      .toThrowError(expect.objectContaining<Partial<MetaMetricAggregationError>>({ code: "conflicting_revision" }));
  });

  it("never sums reach, frequency, or another non-additive source grain", () => {
    const rows = completeRows();
    const multi = byMetric(aggregateMetaMetrics({ rows, metrics: ["reach", "frequency", "retentionD7"] }).metrics);
    expect(multi.reach).toMatchObject({ status: "unknown", reason: "non_additive_requery_required" });
    expect(multi.frequency).toMatchObject({ status: "unknown", reason: "non_additive_requery_required" });
    expect(multi.retentionD7).toMatchObject({ status: "unknown", reason: "non_additive_requery_required" });

    const single = byMetric(aggregateMetaMetrics({ rows: [rows[0]!], metrics: ["reach", "frequency"] }).metrics);
    expect(single.reach).toMatchObject({ status: "available", valueDecimal: "800" });
    expect(single.frequency).toMatchObject({ status: "available", valueDecimal: "1.25" });
  });

  it("returns reasoned unknowns for zero denominator and missing or unavailable actions", () => {
    const zero = row({ id: "zero", date: "2026-08-06", metrics: [money("spend", 1000), metric("clicks", "0")] });
    const zeroResult = byMetric(aggregateMetaMetrics({ rows: [zero], metrics: ["cpcMinor", "cplMinor"] }).metrics);
    expect(zeroResult.cpcMinor).toMatchObject({ status: "unknown", reason: "zero_denominator" });
    expect(zeroResult.cplMinor).toMatchObject({ status: "unknown", reason: "missing_metric" });

    const unavailable = row({ id: "unavailable", date: "2026-08-06", metrics: [
      money("spend", 1000),
      { metricKey: "actions", actionType: "lead", aggregation: "additive", provenance: { field: "actions" }, availability: { reason: "permission_missing" } },
    ] });
    const unavailableResult = byMetric(aggregateMetaMetrics({ rows: [unavailable], metrics: ["cplMinor"] }).metrics);
    expect(unavailableResult.cplMinor).toMatchObject({
      status: "unknown",
      reason: "source_unavailable",
      provenance: { numerator: "spendMinor", denominator: "leads" },
    });
  });

  it("fails closed on attribution or currency mismatch while leaving compatible counts usable", () => {
    const [first, second] = completeRows();
    const attributionMismatch = row({
      id: "different-attribution",
      date: "2026-08-06",
      attributionLabel: "1d_click",
      metrics: second!.metrics,
    });
    const attribution = byMetric(aggregateMetaMetrics({
      rows: [first!, attributionMismatch], metrics: ["impressions", "roas"],
    }).metrics);
    expect(attribution.impressions).toMatchObject({ status: "unknown", reason: "attribution_mismatch" });
    expect(attribution.roas).toMatchObject({ status: "unknown", reason: "attribution_mismatch" });

    const usd = row({
      id: "usd", date: "2026-08-06", currency: "USD",
      metrics: [money("spend", 1000, undefined, "USD"), metric("impressions", "100")],
    });
    const currency = byMetric(aggregateMetaMetrics({
      rows: [
        row({ id: "try", date: "2026-08-05", metrics: [money("spend", 1000), metric("impressions", "100")] }),
        usd,
      ],
      metrics: ["spendMinor", "impressions", "cpmMinor"],
    }).metrics);
    expect(currency.spendMinor).toMatchObject({ status: "unknown", reason: "currency_mismatch" });
    expect(currency.cpmMinor).toMatchObject({ status: "unknown", reason: "currency_mismatch" });
    expect(currency.impressions).toMatchObject({ status: "available", valueDecimal: "200" });
  });

  it("rejects metric-level currency that contradicts its canonical account row", () => {
    const contradictory = row({
      id: "currency-conflict",
      date: "2026-08-06",
      currency: "TRY",
      metrics: [money("spend", 1000, undefined, "USD"), metric("impressions", "100")],
    });
    const result = byMetric(aggregateMetaMetrics({
      rows: [contradictory],
      metrics: ["spendMinor", "impressions", "cpmMinor"],
    }).metrics);
    expect(result.spendMinor).toMatchObject({ status: "unknown", reason: "currency_mismatch" });
    expect(result.cpmMinor).toMatchObject({ status: "unknown", reason: "currency_mismatch" });
    expect(result.impressions).toMatchObject({ status: "available", valueDecimal: "100" });
  });
});
