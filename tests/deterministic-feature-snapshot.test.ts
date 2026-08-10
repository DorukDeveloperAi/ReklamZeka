import { describe, expect, it } from "vitest";
import { buildDeterministicFeatureSnapshot, DeterministicFeatureSnapshotError } from "@/analyses/deterministic-feature-snapshot";
import { aggregateMetaMetrics } from "@/domain/meta/insights/metric-engine";
import { normalizeMetaDailyInsight } from "@/domain/meta/insights/contract";

function observation() {
  const row = normalizeMetaDailyInsight({ schemaVersion: 1, workspaceId: "workspace", metaConnectionId: "connection", adAccountId: "account", entityLevel: "campaign", externalEntityId: "campaign", dateStart: "2026-08-01", dateStop: "2026-08-01", attributionLabel: "default", currency: "TRY", timezone: "Europe/Istanbul", sourceRevision: "1", sourcePayloadHash: "hash", metricProvenance: {}, metrics: [{ metricKey: "spend", aggregation: "additive", valueMinor: 100, currency: "TRY", provenance: {} }] });
  return { observationRef: "observation_1", role: "primary" as const, startDate: "2026-08-01", endDate: "2026-08-01", timezone: "Europe/Istanbul", sampleSize: 1, settled: true, qualityStatus: "ready" as const, qualityReasonCodes: [], metricResult: aggregateMetaMetrics({ rows: [row], metrics: ["spendMinor"] }), snapshotRefs: ["snapshot_a"] };
}

describe("deterministic L2 feature snapshot", () => {
  it("freezes an authenticated metric result and source manifest deterministically", () => {
    const input = { scope: { workspaceId: "workspace", metaConnectionId: "connection", adAccountId: "account", entityLevel: "campaign" as const, externalEntityId: "campaign" }, observation: observation() };
    expect(buildDeterministicFeatureSnapshot(input)).toEqual(buildDeterministicFeatureSnapshot(input));
    expect(buildDeterministicFeatureSnapshot(input)).toMatchObject({ featureRef: expect.stringMatching(/^feature_/), sourceManifestHash: expect.stringMatching(/^[a-f0-9]{64}$/), capabilities: { containsRawL0: false } });
  });
  it("rejects forged metric hashes and raw material", () => {
    const scope = { workspaceId: "workspace", metaConnectionId: "connection", adAccountId: "account", entityLevel: "campaign" as const, externalEntityId: "campaign" };
    expect(() => buildDeterministicFeatureSnapshot({ scope, observation: { ...observation(), metricResult: { ...observation().metricResult, resultHash: "0".repeat(64) } } })).toThrowError(DeterministicFeatureSnapshotError);
    expect(() => buildDeterministicFeatureSnapshot({ scope, observation: observation(), rawPayload: {} } as never)).toThrowError(DeterministicFeatureSnapshotError);
  });
});
