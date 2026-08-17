import { describe, expect, it } from "vitest";
import { buildScopeReport } from "@/domain/slices/scope-report";
import type { ScopeReportEvidence } from "@/domain/slices/scope-report";

const evidence: ScopeReportEvidence = Object.freeze({
  sliceId: "11111111-1111-4111-8111-111111111111",
  sliceRef: "slice_yerli_lead",
  revisionRef: "slice_revision_yerli_lead_1",
  revisionNumber: 1,
  definitionHash: "a".repeat(64),
  market: Object.freeze({ dimensionRef: "dimension_market", valueRef: "category_yerli", key: "yerli" }),
  resolution: Object.freeze({ memberships: Object.freeze([
    Object.freeze({ entityRef: "campaign_in", entityLevel: "campaign" as const, included: true, reason: "dynamic_filter" as const,
      marketEvidenceRefs: Object.freeze(["assignment_market_in"]), matchedDimensionIds: Object.freeze(["dimension_service"]), matchedDimensionEvidenceRefs: Object.freeze(["assignment_service_in"]) }),
    Object.freeze({ entityRef: "campaign_missing", entityLevel: "campaign" as const, included: false, reason: "excluded_market_missing" as const,
      marketEvidenceRefs: Object.freeze([]), matchedDimensionIds: Object.freeze([]), matchedDimensionEvidenceRefs: Object.freeze([]) }),
    Object.freeze({ entityRef: "ad_set_ambiguous", entityLevel: "ad_set" as const, included: false, reason: "excluded_market_ambiguous" as const,
      marketEvidenceRefs: Object.freeze(["assignment_market_a", "assignment_market_b"]), matchedDimensionIds: Object.freeze([]), matchedDimensionEvidenceRefs: Object.freeze([]) }),
    Object.freeze({ entityRef: "organization_campaign_out", entityLevel: "organization_campaign" as const, included: false, reason: "excluded_explicit" as const,
      marketEvidenceRefs: Object.freeze(["organization_campaign_out"]), matchedDimensionIds: Object.freeze([]), matchedDimensionEvidenceRefs: Object.freeze([]) }),
  ]) }),
});

describe("Kapsam Raporu", () => {
  it("carries exact canonical resolver membership reasons without re-evaluation", () => {
    const report = buildScopeReport(evidence);
    expect(report).toMatchObject({ version: "scope-report/1.0.0", scope: { sliceRef: "slice_yerli_lead", revisionRef: "slice_revision_yerli_lead_1", revisionNumber: 1,
      market: { dimensionRef: "dimension_market", valueRef: "category_yerli", key: "yerli" } }, counts: { included: 1, excluded: 3, missingMarket: 1, ambiguousMarket: 1 },
      authority: { canWriteMeta: false, canExecute: false, canApprove: false } });
    expect(report.rows.map((row) => [row.entityRef, row.membership, row.reason])).toEqual([
      ["campaign_in", "included", "dynamic_filter"], ["campaign_missing", "excluded", "excluded_market_missing"],
      ["ad_set_ambiguous", "excluded", "excluded_market_ambiguous"], ["organization_campaign_out", "excluded", "excluded_explicit"],
    ]);
  });

  it("binds empty output to the exact requested period and granularity", () => {
    const day = buildScopeReport(evidence, [], { granularity: "day", startDate: "2026-08-01", endDate: "2026-08-01" });
    const month = buildScopeReport(evidence, [], { granularity: "month", startDate: "2026-08-01", endDate: "2026-08-31" });
    expect(day.rawMetrics).toEqual([]);
    expect(month.rawMetrics).toEqual([]);
    expect(day.appliedFilters).toMatchObject({ granularity: "day", startDate: "2026-08-01", endDate: "2026-08-01" });
    expect(month.appliedFilters).toMatchObject({ granularity: "month", startDate: "2026-08-01", endDate: "2026-08-31" });
    expect(day.appliedFilters).not.toEqual(month.appliedFilters);
  });

  it("keeps every raw action attribution and produces deterministic day/week/month pivot buckets", () => {
    const metrics = [
      { entityRef: "campaign_in", entityLevel: "campaign" as const, date: "2026-08-02", attribution: "7d_click", metricKey: "spend", actionType: null, valueDecimal: null, valueMinor: "100", currency: "TRY", availability: "available" as const },
      { entityRef: "campaign_in", entityLevel: "campaign" as const, date: "2026-08-02", attribution: "7d_click", metricKey: "actions", actionType: "lead", valueDecimal: "2", valueMinor: null, currency: "TRY", availability: "available" as const },
      { entityRef: "campaign_in", entityLevel: "campaign" as const, date: "2026-08-02", attribution: "1d_view", metricKey: "actions", actionType: "purchase", valueDecimal: "3", valueMinor: null, currency: "TRY", availability: "unavailable" as const },
    ];
    const report = buildScopeReport(evidence, metrics, { granularity: "week", startDate: "2026-08-01", endDate: "2026-08-03", actionType: "lead" });
    expect(report.rawMetrics).toHaveLength(2);
    expect(report.rawMetrics.map((metric) => metric.actionType)).toEqual([null, "lead"]);
    expect(report.pivot).toEqual([expect.objectContaining({ bucket: "2026-07-27", subtotal: { metricCount: 2, availableMetricCount: 2 }, ratios: { spendPerAction: null }, drill: { entityRef: "campaign_in", bucket: "2026-07-27" } })]);
    expect(report.coverage).toEqual([expect.objectContaining({ actionType: "lead", expectedDays: ["2026-08-01", "2026-08-02", "2026-08-03"], observedDays: ["2026-08-02"], missingDays: ["2026-08-01", "2026-08-03"], sourceState: "partial", reasonCodes: ["coverage_incomplete"] })]);
    expect(buildScopeReport(evidence, metrics, { granularity: "day", entityLevel: "campaign", metricKey: "actions", sort: "metric", direction: "desc" }).rawMetrics)
      .toEqual(expect.arrayContaining([expect.objectContaining({ actionType: "lead" }), expect.objectContaining({ actionType: "purchase" })]));
    expect(buildScopeReport(evidence, metrics, { granularity: "day" }).pivot[0]?.ratios.spendPerAction).toBeNull();
  });

  it("uses exact BigInt rational evidence and nulls a ratio for currency or attribution disagreement", () => {
    const base = [
      { entityRef: "campaign_in", entityLevel: "campaign" as const, date: "2026-08-01", attribution: "7d_click", metricKey: "spend", actionType: null, valueDecimal: null, valueMinor: "99999999999999999999999999999999999999", currency: "TRY", availability: "available" as const },
      { entityRef: "campaign_in", entityLevel: "campaign" as const, date: "2026-08-01", attribution: "7d_click", metricKey: "actions", actionType: "lead", valueDecimal: "0.000000000000000001", valueMinor: null, currency: "TRY", availability: "available" as const },
    ];
    expect(buildScopeReport(evidence, base, { granularity: "day", actionType: "lead" }).pivot[0]?.ratios.spendPerAction)
      .toEqual({ numeratorMinor: "99999999999999999999999999999999999999", denominatorAction: "0.000000000000000001" });
    expect(buildScopeReport(evidence, [{ ...base[1]!, attribution: "1d_view" }, base[0]!], { granularity: "day", actionType: "lead" }).pivot[0]?.ratios.spendPerAction).toBeNull();
    expect(buildScopeReport(evidence, [{ ...base[0]!, currency: "USD" }, base[0]!, base[1]!], { granularity: "day", actionType: "lead" }).pivot[0]?.ratios.spendPerAction).toBeNull();
  });

  it("keeps selector coverage independent from display filters and nulls incomplete day/week/month ratios", () => {
    const metrics = [
      { entityRef: "campaign_in", entityLevel: "campaign" as const, date: "2026-08-01", attribution: "7d_click", metricKey: "spend", actionType: null, valueDecimal: null, valueMinor: "100", currency: "TRY", availability: "available" as const },
      { entityRef: "campaign_in", entityLevel: "campaign" as const, date: "2026-08-01", attribution: "7d_click", metricKey: "actions", actionType: "lead", valueDecimal: "2", valueMinor: null, currency: "TRY", availability: "available" as const },
      { entityRef: "campaign_in", entityLevel: "campaign" as const, date: "2026-08-02", attribution: "7d_click", metricKey: "spend", actionType: null, valueDecimal: null, valueMinor: "100", currency: "TRY", availability: "available" as const },
      { entityRef: "campaign_in", entityLevel: "campaign" as const, date: "2026-08-02", attribution: "7d_click", metricKey: "actions", actionType: "lead", valueDecimal: "1", valueMinor: null, currency: "TRY", availability: "unavailable" as const },
    ];
    const options = { startDate: "2026-08-01", endDate: "2026-08-02", actionType: "lead" as const };
    const day = buildScopeReport(evidence, metrics, { ...options, granularity: "day", metricKey: "spend" });
    expect(day.coverage).toEqual(expect.arrayContaining([expect.objectContaining({ entityRef: "campaign_in", sourceState: "unavailable", reasonCodes: ["coverage_incomplete", "action_unavailable"] })]));
    expect(day.pivot.find((row) => row.bucket === "2026-08-01")?.ratios.spendPerAction).toBeNull();
    expect(day.pivot.find((row) => row.bucket === "2026-08-02")?.ratios.spendPerAction).toBeNull();
    expect(buildScopeReport(evidence, metrics, { ...options, granularity: "week" }).pivot[0]?.ratios.spendPerAction).toBeNull();
    expect(buildScopeReport(evidence, metrics, { ...options, granularity: "month" }).pivot[0]?.ratios.spendPerAction).toBeNull();
  });

  it("rejects global/no-published-slice evidence instead of inventing a report scope", () => {
    expect(() => buildScopeReport({ ...evidence, sliceId: null, resolution: null, sliceRef: null, revisionRef: null,
      revisionNumber: null, definitionHash: null, market: null })).toThrow("scope report rejected: slice");
  });
});
