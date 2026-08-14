import { describe, expect, it, vi } from "vitest";
import { aggregateMetaMetrics } from "@/domain/meta/insights/metric-engine";
import { normalizeMetaDailyInsight } from "@/domain/meta/insights/contract";
import { buildDeterministicFeatureSnapshot } from "@/analyses/deterministic-feature-snapshot";
import { DrizzleDeterministicFeatureSnapshotRepository, DeterministicFeatureSnapshotRepositoryError } from "@/connectors/analyses/deterministic-feature-snapshot-drizzle-repository";
import { DrizzleFindingObservationReadPort, FINDING_OBSERVATION_SETTLEMENT_POLICY_VERSION } from "@/connectors/analyses/finding-observation-drizzle-read-port";
import { FINDING_OBSERVATION_BUILDER_VERSION } from "@/analyses/finding-observation-builder";

const ids = { workspace: "10000000-0000-4000-8000-000000000001", connection: "20000000-0000-4000-8000-000000000002", account: "30000000-0000-4000-8000-000000000003", insight: "40000000-0000-4000-8000-000000000004", feature: "50000000-0000-4000-8000-000000000005" };
const query = { builderVersion: FINDING_OBSERVATION_BUILDER_VERSION, queryRef: "observation_aaaaaaaaaaaaaaaaaaaaaaaa", workspaceId: ids.workspace, metaConnectionId: ids.connection, adAccountId: ids.account, entityLevel: "campaign" as const, externalEntityId: "campaign-safe", attributionLabel: "7d_click_1d_view", expectedCurrency: "TRY", role: "primary" as const, startDate: "2026-08-01", endDate: "2026-08-01", timezone: "Europe/Istanbul", maxRows: 10 };
const raw = { internalId: ids.insight, workspaceId: ids.workspace, metaConnectionId: ids.connection, adAccountId: ids.account, entityLevel: "campaign", externalEntityId: "campaign-safe", dateStart: "2026-08-01", dateStop: "2026-08-01", attributionLabel: "7d_click_1d_view", attributionWindow: {}, currency: "TRY", timezone: "Europe/Istanbul", fieldAvailability: {}, sourceRevision: "1", sourcePayloadHash: "source-hash-1", sourceUpdatedAt: null, metricProvenance: {}, sliceStatus: "completed", sliceCompletedAt: "2026-08-02T00:00:00.000Z", runStatus: "completed", runFinishedAt: "2026-08-02T00:00:00.000Z", metrics: [{ metricKey: "spend", actionType: "", aggregation: "additive", valueDecimal: null, valueMinor: 100, valueJson: null, currency: "TRY", provenance: {}, availability: {}, sourceRevision: "1", sourcePayloadHash: "source-hash-1" }] };

async function input() {
  const source = await new DrizzleFindingObservationReadPort({ execute: async () => ({ rows: [raw] }) } as never, { resolve: async () => ({ policyVersion: FINDING_OBSERVATION_SETTLEMENT_POLICY_VERSION, policyRef: "settlement_meta_default_v1", evaluatedAsOf: "2026-08-02T12:00:00.000Z", settledThroughDate: "2026-08-01" }) }).readForFeatureSnapshot(query);
  const row = normalizeMetaDailyInsight({ schemaVersion: 1, workspaceId: ids.workspace, metaConnectionId: ids.connection, adAccountId: ids.account, entityLevel: "campaign", externalEntityId: "campaign-safe", dateStart: "2026-08-01", dateStop: "2026-08-01", attributionLabel: "7d_click_1d_view", currency: "TRY", timezone: "Europe/Istanbul", sourceRevision: "1", sourcePayloadHash: "source-hash-1", metricProvenance: {}, metrics: [{ metricKey: "spend", aggregation: "additive", valueMinor: 100, currency: "TRY", provenance: {} }] });
  const observation = { observationRef: query.queryRef, role: "primary" as const, startDate: query.startDate, endDate: query.endDate, timezone: query.timezone, sampleSize: 1, settled: true, qualityStatus: "ready" as const, qualityReasonCodes: [], metricResult: aggregateMetaMetrics({ rows: [row], metrics: ["spendMinor"] }), snapshotRefs: source.read.snapshotRefs };
  return { source, feature: buildDeterministicFeatureSnapshot({ scope: { workspaceId: ids.workspace, metaConnectionId: ids.connection, adAccountId: ids.account, entityLevel: "campaign", externalEntityId: "campaign-safe" }, observation }) };
}

describe("DrizzleDeterministicFeatureSnapshotRepository", () => {
  it("fails closed as stale when a persisted L1 change invalidates an otherwise authentic feature", async () => {
    const candidate = await input();
    const execute = vi.fn(async (): Promise<any> => ({ rows: [{ feature_payload: candidate.feature, invalidation_hashes: ["a".repeat(64)] }] }));
    const repo = new DrizzleDeterministicFeatureSnapshotRepository({ execute } as never);
    await expect(repo.loadCurrent({ workspaceId: ids.workspace, featureRef: candidate.feature.featureRef })).resolves.toEqual({
      state: "stale", feature: candidate.feature, invalidationEventHashes: ["a".repeat(64)],
    });
  });

  it("rejects forged persisted feature payloads instead of returning current evidence", async () => {
    const candidate = await input();
    const execute = vi.fn(async (): Promise<any> => ({ rows: [{ feature_payload: { ...candidate.feature, featureHash: "0".repeat(64) }, invalidation_hashes: [] }] }));
    const repo = new DrizzleDeterministicFeatureSnapshotRepository({ execute } as never);
    await expect(repo.loadCurrent({ workspaceId: ids.workspace, featureRef: candidate.feature.featureRef })).rejects.toEqual(expect.objectContaining<Partial<DeterministicFeatureSnapshotRepositoryError>>({ code: "corrupt_store" }));
  });

  it("rechecks tenant L1 source hashes and persists an immutable header plus exact sources", async () => {
    const execute = vi.fn(async (): Promise<any> => ({ rows: [] })); let n = 0;
    execute.mockImplementation(async () => ({ rows: [ [{ id: ids.workspace }], [{ id: ids.account }], [{ id: ids.insight, source_payload_hash: "source-hash-1" }], [{ id: ids.feature }], [] ][n++] ?? [] }));
    const repo = new DrizzleDeterministicFeatureSnapshotRepository({ execute, transaction: async (work: (tx: unknown) => Promise<unknown>) => work({ execute }) } as never);
    const candidate = await input();
    expect(candidate.feature.sourceSnapshotRefs).toEqual(candidate.source.read.snapshotRefs);
    expect(candidate.feature.sourceSnapshotRefs).toEqual(candidate.source.sourceManifest.map((item) => item.snapshotRef));
    expect(candidate.source.sourceManifest[0]).toMatchObject({ dailyInsightId: ids.insight, contentHash: expect.stringMatching(/^[a-f0-9]{64}$/), sourcePayloadHash: "source-hash-1" });
    expect(candidate.source.read.rows[0]).toMatchObject({ workspaceId: ids.workspace, metaConnectionId: ids.connection, adAccountId: ids.account, entityLevel: "campaign", externalEntityId: "campaign-safe" });
    const saved = await repo.save(candidate);
    expect(saved.outcome).toBe("inserted");
    expect(execute).toHaveBeenCalledTimes(5);
  });
  it("fails closed before insert when the canonical L1 source changed", async () => {
    const execute = vi.fn(async (): Promise<any> => ({ rows: [] })); let n = 0;
    execute.mockImplementation(async () => ({ rows: [ [{ id: ids.workspace }], [{ id: ids.account }], [] ][n++] ?? [] }));
    const repo = new DrizzleDeterministicFeatureSnapshotRepository({ execute, transaction: async (work: (tx: unknown) => Promise<unknown>) => work({ execute }) } as never);
    await expect(repo.save(await input())).rejects.toEqual(expect.objectContaining<Partial<DeterministicFeatureSnapshotRepositoryError>>({ code: "source_changed" }));
    expect(execute).toHaveBeenCalledTimes(3);
  });
});
