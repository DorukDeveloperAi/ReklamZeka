import { describe, expect, it } from "vitest";
import { buildDeterministicFeatureSnapshot } from "@/analyses/deterministic-feature-snapshot";
import { buildDeterministicWindowSnapshot, DeterministicWindowSnapshotError } from "@/analyses/deterministic-window-snapshot";
import { resolveAnalysisTimeframe } from "@/analyses/timeframe-resolver";
import { aggregateMetaMetrics } from "@/domain/meta/insights/metric-engine";
import { normalizeMetaDailyInsight } from "@/domain/meta/insights/contract";

function feature() { const row = normalizeMetaDailyInsight({ schemaVersion: 1, workspaceId: "workspace", metaConnectionId: "connection", adAccountId: "account", entityLevel: "campaign", externalEntityId: "campaign", dateStart: "2026-08-01", dateStop: "2026-08-01", attributionLabel: "default", currency: "TRY", timezone: "Europe/Istanbul", sourceRevision: "1", sourcePayloadHash: "hash", metricProvenance: {}, metrics: [{ metricKey: "spend", aggregation: "additive", valueMinor: 100, currency: "TRY", provenance: {} }] }); return buildDeterministicFeatureSnapshot({ scope: { workspaceId: "workspace", metaConnectionId: "connection", adAccountId: "account", entityLevel: "campaign", externalEntityId: "campaign" }, observation: { observationRef: "observation_1", role: "primary", startDate: "2026-08-01", endDate: "2026-08-01", timezone: "Europe/Istanbul", sampleSize: 1, settled: true, qualityStatus: "ready", qualityReasonCodes: [], metricResult: aggregateMetaMetrics({ rows: [row], metrics: ["spendMinor"] }), snapshotRefs: ["snapshot_a"] } }); }
const timeframe = resolveAnalysisTimeframe({ timeframe: { kind: "fixed", startDate: "2026-08-01", endDate: "2026-08-07", timezone: "Europe/Istanbul" }, comparison: "none", asOf: "2026-08-08T00:00:00.000Z" });
describe("deterministic L3 window snapshot", () => {
  it("freezes exact ready L2 features under an authenticated window", () => { const value = buildDeterministicWindowSnapshot({ timeframe, features: [feature()] }); expect(value).toEqual(buildDeterministicWindowSnapshot({ timeframe, features: [feature()] })); expect(value).toMatchObject({ windowRef: expect.stringMatching(/^window_/), capabilities: { canExecuteWrite: false } }); });
  it("rejects stale-quality or out-of-window feature candidates", () => { expect(() => buildDeterministicWindowSnapshot({ timeframe, features: [{ ...feature(), settled: false }] })).toThrowError(DeterministicWindowSnapshotError); expect(() => buildDeterministicWindowSnapshot({ timeframe, features: [{ ...feature(), startDate: "2026-07-31" }] })).toThrowError(DeterministicWindowSnapshotError); });
});
