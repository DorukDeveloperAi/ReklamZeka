import { describe, expect, it } from "vitest";
import { calculateFrozenL2Contribution } from "@/analyses/frozen-l2-advisory-diagnostics";
import { buildDeterministicFeatureSnapshot } from "@/analyses/deterministic-feature-snapshot";
import { aggregateMetaMetrics } from "@/domain/meta/insights/metric-engine";
import { normalizeMetaDailyInsight } from "@/domain/meta/insights/contract";

const workspaceId = "10000000-0000-4000-8000-000000000001";

function feature(externalEntityId: string, spend: number, options: Readonly<{ unknown?: boolean; role?: "primary" | "comparison"; date?: string }> = {}) {
  const date = options.date ?? "2026-08-01";
  const metricResult = aggregateMetaMetrics({ rows: [normalizeMetaDailyInsight({
    schemaVersion: 1, workspaceId, metaConnectionId: "20000000-0000-4000-8000-000000000002",
    adAccountId: "30000000-0000-4000-8000-000000000003", entityLevel: "ad",
    externalEntityId, dateStart: date, dateStop: date, attributionLabel: "7d_click_1d_view",
    attributionWindow: { click: 7, view: 1 }, currency: "TRY", timezone: "Europe/Istanbul",
    sourceRevision: `revision_${externalEntityId}`, sourcePayloadHash: `payload_${externalEntityId}`,
    metricProvenance: { source: "meta" }, metrics: options.unknown ? [] : [{ metricKey: "spend", aggregation: "additive", valueMinor: spend, currency: "TRY", provenance: { field: "spend" } }],
  })], metrics: ["spendMinor"] });
  return buildDeterministicFeatureSnapshot({
    scope: { workspaceId, metaConnectionId: "20000000-0000-4000-8000-000000000002", adAccountId: "30000000-0000-4000-8000-000000000003", entityLevel: "ad", externalEntityId },
    observation: { observationRef: `observation_${externalEntityId}`, role: options.role ?? "primary", startDate: date, endDate: date,
      timezone: "Europe/Istanbul", sampleSize: 1, settled: true, qualityStatus: "ready", qualityReasonCodes: [], metricResult, snapshotRefs: [`snapshot_${externalEntityId}`] },
  });
}

describe("frozen L2 advisory contribution", () => {
  it("calculates deterministic peer shares from exact frozen primary L2 features only", () => {
    const first = calculateFrozenL2Contribution({ metric: "spendMinor", features: [feature("238000000000002", 30), feature("238000000000001", 10)] });
    const second = calculateFrozenL2Contribution({ metric: "spendMinor", features: [feature("238000000000001", 10), feature("238000000000002", 30)] });
    expect(first).toEqual(second);
    expect(first).toMatchObject({ state: "available", reason: "available", capabilities: { canAuthorizeAction: false, canExecuteWrite: false, canWriteMeta: false } });
    expect(first.contributions).toEqual([
      expect.objectContaining({ entityRef: "238000000000001", valueDecimal: "10", contributionFraction: "0.25" }),
      expect.objectContaining({ entityRef: "238000000000002", valueDecimal: "30", contributionFraction: "0.75" }),
    ]);
  });

  it("reports insufficient or unknown instead of filling in a missing peer or metric", () => {
    expect(calculateFrozenL2Contribution({ metric: "spendMinor", features: [feature("238000000000001", 10)] }))
      .toMatchObject({ state: "insufficient_data", reason: "minimum_entities_not_met" });
    expect(calculateFrozenL2Contribution({ metric: "spendMinor", features: [feature("238000000000001", 10), feature("238000000000002", 0, { unknown: true })] }))
      .toMatchObject({ state: "unknown", reason: "metric_unknown" });
    expect(calculateFrozenL2Contribution({ metric: "spendMinor", features: [feature("238000000000001", 10), feature("238000000000002", 20, { date: "2026-08-02" })] }))
      .toMatchObject({ state: "insufficient_data", reason: "incompatible_scope" });
  });
});
