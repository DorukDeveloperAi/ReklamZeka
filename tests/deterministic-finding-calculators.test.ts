import { describe, expect, it } from "vitest";
import {
  DETERMINISTIC_FINDING_CALCULATOR_VERSION,
  DeterministicFindingCalculatorError,
  calculateDeterministicFinding,
  type DeterministicFindingInput,
  type FindingObservation,
} from "@/analyses/finding-calculators";
import { resolveAnalysisTimeframe } from "@/analyses/timeframe-resolver";
import { aggregateMetaMetrics } from "@/domain/meta/insights/metric-engine";
import { normalizeMetaDailyInsight, type CanonicalMetaDailyInsight, type MetaMetricValue } from "@/domain/meta/insights/contract";

function sourceMetric(metricKey: string, valueDecimal: string): MetaMetricValue {
  return { metricKey, aggregation: "additive", valueDecimal, provenance: { field: metricKey } };
}

function canonicalRow(date: string, values: Readonly<{ spend?: number; impressions?: string; clicks?: string; reach?: string }>): CanonicalMetaDailyInsight {
  const metrics: MetaMetricValue[] = [];
  if (values.spend !== undefined) metrics.push({ metricKey: "spend", aggregation: "additive", valueMinor: values.spend, currency: "TRY", provenance: { field: "spend" } });
  if (values.impressions !== undefined) metrics.push(sourceMetric("impressions", values.impressions));
  if (values.clicks !== undefined) metrics.push(sourceMetric("clicks", values.clicks));
  if (values.reach !== undefined) metrics.push({ ...sourceMetric("reach", values.reach), aggregation: "non_additive" });
  return normalizeMetaDailyInsight({
    schemaVersion: 1,
    workspaceId: "workspace",
    metaConnectionId: "connection",
    adAccountId: "account",
    entityLevel: "campaign",
    externalEntityId: `campaign-${date}-${values.spend ?? values.clicks ?? values.reach}`,
    dateStart: date,
    dateStop: date,
    attributionLabel: "7d_click_1d_view",
    attributionWindow: { click: 7, view: 1 },
    currency: "TRY",
    timezone: "Europe/Istanbul",
    sourceRevision: `revision-${date}`,
    sourcePayloadHash: `hash-${date}-${values.spend ?? values.clicks ?? values.reach}`,
    metricProvenance: { source: "meta" },
    metrics,
  });
}

function result(date: string, values: Readonly<{ spend?: number; impressions?: string; clicks?: string; reach?: string }>) {
  return aggregateMetaMetrics({ rows: [canonicalRow(date, values)], metrics: ["spendMinor", "impressions", "clicks", "ctr", "reach"] });
}

const timeframe = resolveAnalysisTimeframe({
  timeframe: { kind: "fixed", startDate: "2026-08-01", endDate: "2026-08-07", timezone: "Europe/Istanbul" },
  comparison: "previous_period",
  asOf: "2026-08-07T15:00:00+03:00",
});

function observation(input: Partial<FindingObservation> & Pick<FindingObservation, "observationRef" | "role" | "startDate" | "endDate" | "metricResult">): FindingObservation {
  return {
    timezone: "Europe/Istanbul",
    sampleSize: 100,
    settled: true,
    qualityStatus: "ready",
    qualityReasonCodes: [],
    snapshotRefs: [`snapshot-${input.observationRef}`],
    ...input,
  };
}

function base(overrides: Partial<DeterministicFindingInput>): DeterministicFindingInput {
  return {
    entityRef: "campaign:alpha",
    entityType: "campaign",
    parentEntityRef: null,
    hierarchyPathRefs: ["campaign:alpha"],
    driverEvidenceRefs: ["driver:ad-set-one"],
    timeframe,
    spec: { kind: "threshold", metric: "spendMinor", operator: "gte", thresholdDecimal: "1000", minimumSample: 1 },
    observations: [],
    ...overrides,
  } as DeterministicFindingInput;
}

describe("versioned deterministic finding calculator family", () => {
  it("evaluates threshold and emits stable hierarchy-bindable evidence only", () => {
    const primary = observation({ observationRef: "obs:primary", role: "primary", startDate: "2026-08-01", endDate: "2026-08-07", metricResult: result("2026-08-07", { spend: 1200 }) });
    const first = calculateDeterministicFinding(base({ observations: [primary] }));
    const replay = calculateDeterministicFinding(base({ observations: [primary] }));

    expect(first).toEqual(replay);
    expect(first).toMatchObject({
      calculatorVersion: DETERMINISTIC_FINDING_CALCULATOR_VERSION,
      kind: "threshold",
      state: "finding",
      reasonCode: "condition_met",
      evidence: {
        entityRef: "campaign:alpha",
        metric: "spendMinor",
        aggregation: "additive",
        observedValueDecimal: "1200",
        baselineValueDecimal: "1000",
        effectValueDecimal: "200",
        driverEvidenceRefs: ["driver:ad-set-one"],
      },
    });
    expect(first.findingRef).toMatch(/^finding_[a-f0-9]{24}$/);
    expect(JSON.stringify(first)).not.toMatch(/action|proposal|policy|prompt/i);
  });

  it("compares period ratios without averaging or summing them", () => {
    const primary = observation({ observationRef: "obs:current", role: "primary", startDate: "2026-08-01", endDate: "2026-08-07", metricResult: result("2026-08-07", { clicks: "20", impressions: "100" }) });
    const comparison = observation({ observationRef: "obs:previous", role: "comparison", startDate: "2026-07-25", endDate: "2026-07-31", metricResult: result("2026-07-31", { clicks: "10", impressions: "100" }) });
    const finding = calculateDeterministicFinding(base({
      spec: { kind: "period_comparison", metric: "ctr", direction: "increase", minimumRelativeChange: 0.5, minimumSample: 10 },
      observations: [comparison, primary],
    }));
    expect(finding).toMatchObject({ state: "finding", evidence: { aggregation: "derived", observedValueDecimal: "0.2", baselineValueDecimal: "0.1", effectValueDecimal: "1" } });
    const reordered = calculateDeterministicFinding(base({
      hierarchyPathRefs: ["campaign:alpha", "account:one"],
      driverEvidenceRefs: ["driver:two", "driver:one"],
      spec: { kind: "period_comparison", metric: "ctr", direction: "increase", minimumRelativeChange: 0.5, minimumSample: 10 },
      observations: [primary, comparison],
    }));
    const reorderedReplay = calculateDeterministicFinding(base({
      hierarchyPathRefs: ["account:one", "campaign:alpha"],
      driverEvidenceRefs: ["driver:one", "driver:two"],
      spec: { kind: "period_comparison", metric: "ctr", direction: "increase", minimumRelativeChange: 0.5, minimumSample: 10 },
      observations: [comparison, primary],
    }));
    expect(reorderedReplay.inputHash).toBe(reordered.inputHash);
    expect(reorderedReplay.findingRef).toBe(reordered.findingRef);
  });

  it("detects a trend from independently computed daily observations", () => {
    const series = [100, 110, 130].map((spend, index) => observation({
      observationRef: `obs:day-${index + 1}`,
      role: "series",
      startDate: `2026-08-0${index + 1}`,
      endDate: `2026-08-0${index + 1}`,
      metricResult: result(`2026-08-0${index + 1}`, { spend }),
    }));
    const finding = calculateDeterministicFinding(base({
      spec: { kind: "trend", metric: "spendMinor", direction: "increase", minimumRelativeChange: 0.2, minimumPoints: 3, minimumSample: 1 },
      observations: series,
    }));
    expect(finding).toMatchObject({ state: "finding", evidence: { observedValueDecimal: "130", baselineValueDecimal: "100", effectValueDecimal: "0.3" } });
  });

  it("detects anomaly against a non-zero-variance baseline", () => {
    const values = [10, 11, 9, 30];
    const series = values.map((clicks, index) => observation({
      observationRef: `obs:anomaly-${index + 1}`,
      role: "series",
      startDate: `2026-08-0${index + 1}`,
      endDate: `2026-08-0${index + 1}`,
      metricResult: result(`2026-08-0${index + 1}`, { clicks: clicks.toString() }),
    }));
    const finding = calculateDeterministicFinding(base({
      spec: { kind: "anomaly", metric: "clicks", minimumAbsoluteZScore: 3, minimumBaselinePoints: 3, minimumSample: 1 },
      observations: series,
    }));
    expect(finding.state).toBe("finding");
    expect(Number(finding.evidence.effectValueDecimal)).toBeGreaterThan(20);
  });

  it("evaluates budget pacing only from additive spend and elapsed plan", () => {
    const primary = observation({ observationRef: "obs:pacing", role: "primary", startDate: "2026-08-01", endDate: "2026-08-07", metricResult: result("2026-08-07", { spend: 4000 }) });
    const finding = calculateDeterministicFinding(base({
      spec: { kind: "pacing", metric: "spendMinor", plannedTotalDecimal: "10000", elapsedFraction: 0.5, toleranceFraction: 0.1, direction: "decrease", minimumSample: 1 },
      observations: [primary],
    }));
    expect(finding).toMatchObject({ state: "finding", evidence: { observedValueDecimal: "4000", baselineValueDecimal: "5000", effectValueDecimal: "-0.2" } });
  });

  it("binds pre/post exactly to an action-relative timeframe and honors settling days", () => {
    const actionTimeframe = resolveAnalysisTimeframe({
      timeframe: { kind: "action_relative", beforeDays: 3, afterDays: 3, timezone: "Europe/Istanbul" },
      comparison: "none",
      asOf: "2026-08-07T15:00:00+03:00",
      anchors: { action: { occurredAt: "2026-08-04T10:00:00+03:00" } },
    });
    const pre = observation({ observationRef: "obs:pre", role: "pre", startDate: "2026-08-01", endDate: "2026-08-03", metricResult: result("2026-08-03", { clicks: "10" }) });
    const post = observation({ observationRef: "obs:post", role: "post", startDate: "2026-08-04", endDate: "2026-08-07", metricResult: result("2026-08-07", { clicks: "15" }) });
    const finding = calculateDeterministicFinding(base({
      timeframe: actionTimeframe,
      spec: { kind: "pre_post", metric: "clicks", direction: "increase", minimumRelativeChange: 0.25, minimumSample: 1, actionDate: "2026-08-04", minimumSettledPostDays: 4 },
      observations: [pre, post],
    }));
    expect(finding).toMatchObject({ state: "finding", evidence: { effectValueDecimal: "0.5" } });

    const settling = calculateDeterministicFinding(base({
      timeframe: actionTimeframe,
      spec: { kind: "pre_post", metric: "clicks", direction: "increase", minimumRelativeChange: 0.25, minimumSample: 1, actionDate: "2026-08-04", minimumSettledPostDays: 5 },
      observations: [pre, post],
    }));
    expect(settling).toMatchObject({ state: "settling", reasonCode: "window_settling" });
  });

  it("returns explicit sample, quality, settling and unavailable metric reasons", () => {
    const primary = observation({ observationRef: "obs:reasons", role: "primary", startDate: "2026-08-01", endDate: "2026-08-07", sampleSize: 1, metricResult: result("2026-08-07", { spend: 1200 }) });
    expect(calculateDeterministicFinding(base({ spec: { kind: "threshold", metric: "spendMinor", operator: "gt", thresholdDecimal: "1", minimumSample: 2 }, observations: [primary] }))).toMatchObject({ state: "insufficient_data", reasonCode: "minimum_sample_not_met" });
    expect(calculateDeterministicFinding(base({ observations: [{ ...primary, sampleSize: 100, qualityStatus: "degraded", qualityReasonCodes: ["partial-day"] }] }))).toMatchObject({ state: "insufficient_data", reasonCode: "data_quality_degraded", evidence: { qualityReasonCodes: ["partial-day"] } });
    expect(calculateDeterministicFinding(base({ observations: [{ ...primary, sampleSize: 100, settled: false }] }))).toMatchObject({ state: "settling", reasonCode: "window_settling" });
    expect(calculateDeterministicFinding(base({ spec: { kind: "threshold", metric: "roas", operator: "gt", thresholdDecimal: "1", minimumSample: 1 }, observations: [{ ...primary, sampleSize: 100 }] }))).toMatchObject({ state: "insufficient_data", reasonCode: "metric_missing" });
  });

  it("propagates non-additive requery requirements rather than summing reach", () => {
    const metricResult = aggregateMetaMetrics({
      rows: [canonicalRow("2026-08-06", { reach: "100" }), canonicalRow("2026-08-07", { reach: "150" })],
      metrics: ["reach"],
    });
    const primary = observation({ observationRef: "obs:reach", role: "primary", startDate: "2026-08-01", endDate: "2026-08-07", metricResult });
    expect(calculateDeterministicFinding(base({ spec: { kind: "threshold", metric: "reach", operator: "gt", thresholdDecimal: "1", minimumSample: 1 }, observations: [primary] })))
      .toMatchObject({ state: "insufficient_data", reasonCode: "metric_non_additive_requery_required", evidence: { aggregation: "non_additive" } });
  });

  it("fails closed on timezone drift, tampering, secret material, and extra prompt fields", () => {
    const primary = observation({ observationRef: "obs:negative", role: "primary", startDate: "2026-08-01", endDate: "2026-08-07", metricResult: result("2026-08-07", { spend: 1200 }) });
    expect(calculateDeterministicFinding(base({ observations: [{ ...primary, timezone: "UTC" }] }))).toMatchObject({ state: "insufficient_data", reasonCode: "timeframe_mismatch" });
    expect(() => calculateDeterministicFinding(base({ observations: [{ ...primary, metricResult: { ...primary.metricResult, resultHash: "0".repeat(64) } }] })))
      .toThrowError(expect.objectContaining<Partial<DeterministicFindingCalculatorError>>({ code: "invalid_metric_result" }));
    expect(() => calculateDeterministicFinding({ ...base({ observations: [primary] }), accessToken: "secret" } as never))
      .toThrowError(expect.objectContaining<Partial<DeterministicFindingCalculatorError>>({ code: "forbidden_material" }));
    expect(() => calculateDeterministicFinding({ ...base({ observations: [primary] }), prompt: "act now" } as never))
      .toThrowError(expect.objectContaining<Partial<DeterministicFindingCalculatorError>>({ code: "invalid_contract" }));
    expect(() => calculateDeterministicFinding(base({ observations: [primary, { ...primary, observationRef: "obs:duplicate-primary" }] })))
      .toThrowError(expect.objectContaining<Partial<DeterministicFindingCalculatorError>>({ code: "invalid_contract" }));
  });

  it("turns malformed runtime shape matrices into typed fail-closed errors", () => {
    const primary = observation({ observationRef: "obs:shape", role: "primary", startDate: "2026-08-01", endDate: "2026-08-07", metricResult: result("2026-08-07", { spend: 1200 }) });
    const malformed: readonly unknown[] = [
      null,
      [],
      { ...base({ observations: [primary] }), spec: null },
      { ...base({ observations: [primary] }), hierarchyPathRefs: {} },
      { ...base({ observations: [primary] }), driverEvidenceRefs: "driver" },
      { ...base({ observations: [primary] }), observations: {} },
      { ...base({ observations: [primary] }), observations: [42] },
      { ...base({ observations: [primary] }), observations: [{ ...primary, metricResult: 42 }] },
      { ...base({ observations: [primary] }), timeframe: null },
      { ...base({ observations: [primary] }), timeframe: {} },
    ];

    for (const candidate of malformed) {
      expect(() => calculateDeterministicFinding(candidate as never))
        .toThrowError(expect.objectContaining<Partial<DeterministicFindingCalculatorError>>({ code: "invalid_contract" }));
    }
  });

  it("rejects decimal-to-Number precision loss at the contract boundary", () => {
    const unsafeMetric = observation({
      observationRef: "obs:unsafe-metric",
      role: "primary",
      startDate: "2026-08-01",
      endDate: "2026-08-07",
      metricResult: result("2026-08-07", { clicks: "9007199254740993" }),
    });
    expect(() => calculateDeterministicFinding(base({
      spec: { kind: "threshold", metric: "clicks", operator: "gt", thresholdDecimal: "1", minimumSample: 1 },
      observations: [unsafeMetric],
    }))).toThrowError(expect.objectContaining<Partial<DeterministicFindingCalculatorError>>({ code: "invalid_metric_result" }));

    const safeMetric = observation({ observationRef: "obs:safe-metric", role: "primary", startDate: "2026-08-01", endDate: "2026-08-07", metricResult: result("2026-08-07", { clicks: "10" }) });
    expect(() => calculateDeterministicFinding(base({
      spec: { kind: "threshold", metric: "clicks", operator: "gt", thresholdDecimal: "9007199254740993", minimumSample: 1 },
      observations: [safeMetric],
    }))).toThrowError(expect.objectContaining<Partial<DeterministicFindingCalculatorError>>({ code: "invalid_contract" }));
  });

  it("does not overclaim an anomaly from a zero-variance baseline", () => {
    const series = [10, 10, 10, 30].map((clicks, index) => observation({
      observationRef: `obs:flat-${index}`,
      role: "series",
      startDate: `2026-08-0${index + 1}`,
      endDate: `2026-08-0${index + 1}`,
      metricResult: result(`2026-08-0${index + 1}`, { clicks: clicks.toString() }),
    }));
    expect(calculateDeterministicFinding(base({ spec: { kind: "anomaly", metric: "clicks", minimumAbsoluteZScore: 2, minimumBaselinePoints: 3, minimumSample: 1 }, observations: series })))
      .toMatchObject({ state: "insufficient_data", reasonCode: "zero_variance_baseline" });
  });
});
