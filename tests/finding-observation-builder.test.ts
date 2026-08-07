import { describe, expect, it } from "vitest";
import {
  FINDING_OBSERVATION_BUILDER_VERSION,
  FINDING_OBSERVATION_LIMITS,
  FindingObservationBuilderError,
  buildFindingObservationPlan,
  buildFindingObservations,
  materializeFindingObservations,
  type FindingObservationMaterializationInput,
  type FindingObservationReadQuery,
  type FindingObservationReadResult,
} from "@/analyses/finding-observation-builder";
import { resolveAnalysisTimeframe } from "@/analyses/timeframe-resolver";
import { normalizeMetaDailyInsight, type CanonicalMetaDailyInsight, type MetaMetricValue } from "@/domain/meta/insights/contract";

const timeframe = resolveAnalysisTimeframe({
  timeframe: { kind: "fixed", startDate: "2026-08-01", endDate: "2026-08-03", timezone: "Europe/Istanbul" },
  comparison: "previous_period",
  asOf: "2026-08-03T12:00:00+03:00",
});

function base(overrides: Partial<FindingObservationMaterializationInput> = {}): FindingObservationMaterializationInput {
  return {
    workspaceId: "workspace",
    metaConnectionId: "connection",
    adAccountId: "account",
    entityLevel: "campaign",
    externalEntityId: "campaign-one",
    attributionLabel: "7d_click_1d_view",
    expectedCurrency: "TRY",
    timeframe,
    spec: { kind: "threshold", metric: "spendMinor", operator: "gt", thresholdDecimal: "100", minimumSample: 1 },
    maxRowsPerQuery: 100,
    ...overrides,
  } as FindingObservationMaterializationInput;
}

function metric(metricKey: string, valueDecimal: string, aggregation: MetaMetricValue["aggregation"] = "additive"): MetaMetricValue {
  return { metricKey, aggregation, valueDecimal, provenance: { field: metricKey } };
}

function row(input: Readonly<{
  date: string;
  metrics: readonly MetaMetricValue[];
  timezone?: string;
  currency?: string;
  attributionLabel?: string;
}>): CanonicalMetaDailyInsight {
  return normalizeMetaDailyInsight({
    schemaVersion: 1,
    workspaceId: "workspace",
    metaConnectionId: "connection",
    adAccountId: "account",
    entityLevel: "campaign",
    externalEntityId: "campaign-one",
    dateStart: input.date,
    dateStop: input.date,
    attributionLabel: input.attributionLabel ?? "7d_click_1d_view",
    attributionWindow: { click: 7, view: 1 },
    currency: input.currency ?? "TRY",
    timezone: input.timezone ?? "Europe/Istanbul",
    sourceRevision: `revision-${input.date}`,
    sourcePayloadHash: `hash-${input.date}`,
    metricProvenance: { source: "meta" },
    metrics: input.metrics,
  });
}

function read(query: FindingObservationReadQuery, rows: readonly CanonicalMetaDailyInsight[], overrides: Partial<FindingObservationReadResult> = {}): FindingObservationReadResult {
  return {
    queryRef: query.queryRef,
    rows,
    snapshotRefs: [`snapshot:${query.queryRef}`],
    settledThroughDate: "2026-08-31",
    complete: true,
    qualityStatus: "ready",
    qualityReasonCodes: [],
    ...overrides,
  };
}

describe("finding observation materialization", () => {
  it("plans deterministic bounded primary and comparison windows", () => {
    const input = base({ spec: { kind: "period_comparison", metric: "ctr", direction: "increase", minimumRelativeChange: 0.1, minimumSample: 1 } });
    const first = buildFindingObservationPlan(input);
    const replay = buildFindingObservationPlan(input);
    expect(first).toEqual(replay);
    expect(first).toMatchObject({
      builderVersion: FINDING_OBSERVATION_BUILDER_VERSION,
      metric: "ctr",
      queries: [
        { role: "primary", startDate: "2026-08-01", endDate: "2026-08-03", maxRows: 100 },
        { role: "comparison", startDate: "2026-07-29", endDate: "2026-07-31", maxRows: 100 },
      ],
    });
    expect(first.planHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("plans one source-grain query per day for trend/anomaly", () => {
    const plan = buildFindingObservationPlan(base({
      spec: { kind: "trend", metric: "clicks", direction: "increase", minimumRelativeChange: 0.1, minimumPoints: 2, minimumSample: 1 },
    }));
    expect(plan.queries.map((query) => [query.role, query.startDate, query.endDate])).toEqual([
      ["series", "2026-08-01", "2026-08-01"],
      ["series", "2026-08-02", "2026-08-02"],
      ["series", "2026-08-03", "2026-08-03"],
    ]);
  });

  it("materializes additive sums and ratio-of-sums through the metric engine", async () => {
    const input = base({
      spec: { kind: "period_comparison", metric: "ctr", direction: "increase", minimumRelativeChange: 0.1, minimumSample: 1 },
    });
    const rowsByRole = {
      primary: [
        row({ date: "2026-08-01", metrics: [metric("clicks", "10"), metric("impressions", "100")] }),
        row({ date: "2026-08-02", metrics: [metric("clicks", "30"), metric("impressions", "300")] }),
      ],
      comparison: [row({ date: "2026-07-31", metrics: [metric("clicks", "5"), metric("impressions", "100")] })],
    } as const;
    const observations = await materializeFindingObservations(input, {
      read: async (query) => read(query, rowsByRole[query.role as "primary" | "comparison"]),
    });
    expect(observations.map((item) => item.metricResult.metrics[0])).toEqual([
      expect.objectContaining({ metric: "ctr", status: "available", valueDecimal: "0.1", aggregation: "derived" }),
      expect.objectContaining({ metric: "ctr", status: "available", valueDecimal: "0.05", aggregation: "derived" }),
    ]);
    expect(observations[0]).toMatchObject({ sampleSize: 2, settled: true, qualityStatus: "ready" });
  });

  it("preserves missing and non-additive requery reasons from the metric engine", () => {
    const missingPlan = buildFindingObservationPlan(base({ spec: { kind: "threshold", metric: "clicks", operator: "gt", thresholdDecimal: "1", minimumSample: 1 } }));
    const missing = buildFindingObservations({ plan: missingPlan, reads: [read(missingPlan.queries[0]!, [])] });
    expect(missing[0]!.metricResult.metrics[0]).toMatchObject({ status: "unknown", reason: "missing_metric" });

    const reachPlan = buildFindingObservationPlan(base({ spec: { kind: "threshold", metric: "reach", operator: "gt", thresholdDecimal: "1", minimumSample: 1 } }));
    const reachRows = [
      row({ date: "2026-08-01", metrics: [metric("reach", "100", "non_additive")] }),
      row({ date: "2026-08-02", metrics: [metric("reach", "150", "non_additive")] }),
    ];
    const reach = buildFindingObservations({ plan: reachPlan, reads: [read(reachPlan.queries[0]!, reachRows)] });
    expect(reach[0]!.metricResult.metrics[0]).toMatchObject({ status: "unknown", reason: "non_additive_requery_required", aggregation: "non_additive" });
  });

  it("derives settling, quality, currency/timezone reasons and stable snapshot refs", () => {
    const plan = buildFindingObservationPlan(base({ expectedCurrency: "TRY" }));
    const source = row({ date: "2026-08-01", timezone: "UTC", currency: "USD", metrics: [{ metricKey: "spend", aggregation: "additive", valueMinor: 100, currency: "USD", provenance: { field: "spend" } }] });
    const observations = buildFindingObservations({
      plan,
      reads: [read(plan.queries[0]!, [source], {
        snapshotRefs: ["snapshot:z", "snapshot:a", "snapshot:z"],
        settledThroughDate: "2026-08-02",
        complete: false,
        qualityReasonCodes: ["partial_sync"],
      })],
    });
    expect(observations[0]).toMatchObject({
      settled: false,
      qualityStatus: "degraded",
      qualityReasonCodes: ["currency_mismatch", "partial_sync", "read_incomplete", "timezone_mismatch"],
      snapshotRefs: ["snapshot:a", "snapshot:z"],
    });
  });

  it("builds exact pre/post windows from action-relative timeframe", () => {
    const actionTimeframe = resolveAnalysisTimeframe({
      timeframe: { kind: "action_relative", beforeDays: 2, afterDays: 2, timezone: "Europe/Istanbul" },
      comparison: "none",
      asOf: "2026-08-05T12:00:00+03:00",
      anchors: { action: { occurredAt: "2026-08-03T09:00:00+03:00" } },
    });
    const plan = buildFindingObservationPlan(base({
      timeframe: actionTimeframe,
      spec: { kind: "pre_post", metric: "clicks", direction: "increase", minimumRelativeChange: 0.1, minimumSample: 1, actionDate: "2026-08-03", minimumSettledPostDays: 2 },
    }));
    expect(plan.queries.map((query) => ({ role: query.role, start: query.startDate, end: query.endDate }))).toEqual([
      { role: "pre", start: "2026-08-01", end: "2026-08-02" },
      { role: "post", start: "2026-08-03", end: "2026-08-05" },
    ]);
  });

  it("enforces query/window/total-row bounds", () => {
    expect(() => buildFindingObservationPlan(base({ maxRowsPerQuery: FINDING_OBSERVATION_LIMITS.maxRowsPerQuery + 1 })))
      .toThrowError(expect.objectContaining<Partial<FindingObservationBuilderError>>({ code: "bounds_exceeded" }));
    expect(() => buildFindingObservationPlan(base({
      spec: { kind: "trend", metric: "clicks", direction: "increase", minimumRelativeChange: 0.1, minimumPoints: 2, minimumSample: 1 },
      maxRowsPerQuery: 20_000,
    }))).toThrowError(expect.objectContaining<Partial<FindingObservationBuilderError>>({ code: "bounds_exceeded" }));
  });

  it("fails closed on port scope drift, row tampering, missing snapshots, and duplicate reads", () => {
    const plan = buildFindingObservationPlan(base());
    const query = plan.queries[0]!;
    const valid = row({ date: "2026-08-01", metrics: [{ metricKey: "spend", aggregation: "additive", valueMinor: 100, currency: "TRY", provenance: { field: "spend" } }] });
    const cases: readonly FindingObservationReadResult[] = [
      read(query, [{ ...valid, externalEntityId: "other" }]),
      read(query, [{ ...valid, contentHash: "0".repeat(64) }]),
      read(query, [valid], { snapshotRefs: [] }),
      read(query, [valid], { queryRef: "wrong-query" }),
    ];
    for (const candidate of cases) {
      expect(() => buildFindingObservations({ plan, reads: [candidate] }))
        .toThrowError(expect.objectContaining<Partial<FindingObservationBuilderError>>({ code: "read_contract_violation" }));
    }
  });

  it("is replay-stable even when reads and snapshot refs arrive out of order", () => {
    const plan = buildFindingObservationPlan(base({ spec: { kind: "period_comparison", metric: "clicks", direction: "increase", minimumRelativeChange: 0.1, minimumSample: 1 } }));
    const firstRead = read(plan.queries[0]!, [row({ date: "2026-08-01", metrics: [metric("clicks", "10")] })], { snapshotRefs: ["snapshot:z", "snapshot:a"] });
    const secondRead = read(plan.queries[1]!, [row({ date: "2026-07-31", metrics: [metric("clicks", "5")] })]);
    const first = buildFindingObservations({ plan, reads: [firstRead, secondRead] });
    const replay = buildFindingObservations({ plan, reads: [secondRead, { ...firstRead, snapshotRefs: [...firstRead.snapshotRefs].reverse() }] });
    expect(replay).toEqual(first);
  });
});
