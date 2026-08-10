import { describe, expect, it, vi } from "vitest";
import { normalizeMetaDailyInsight } from "@/domain/meta/insights/contract";
import { aggregateMetaMetrics } from "@/domain/meta/insights/metric-engine";
import { buildDeterministicFeatureSnapshot } from "@/analyses/deterministic-feature-snapshot";
import { buildDeterministicWindowSnapshot } from "@/analyses/deterministic-window-snapshot";
import { resolveAnalysisTimeframe } from "@/analyses/timeframe-resolver";
import { DrizzleDeterministicWindowSnapshotRepository, DeterministicWindowSnapshotRepositoryError } from "@/connectors/analyses/deterministic-window-snapshot-drizzle-repository";

const scope = { workspaceId: "10000000-0000-4000-8000-000000000001", metaConnectionId: "20000000-0000-4000-8000-000000000002", adAccountId: "30000000-0000-4000-8000-000000000003", entityLevel: "campaign" as const, externalEntityId: "campaign-safe" };
function fixture() { const row = normalizeMetaDailyInsight({ schemaVersion: 1, workspaceId: scope.workspaceId, metaConnectionId: scope.metaConnectionId, adAccountId: scope.adAccountId, entityLevel: "campaign", externalEntityId: scope.externalEntityId, dateStart: "2026-08-01", dateStop: "2026-08-01", attributionLabel: "default", currency: "TRY", timezone: "Europe/Istanbul", sourceRevision: "1", sourcePayloadHash: "hash", metricProvenance: {}, metrics: [{ metricKey: "spend", aggregation: "additive", valueMinor: 1, currency: "TRY", provenance: {} }] }); const feature = buildDeterministicFeatureSnapshot({ scope, observation: { observationRef: "observation_a", role: "primary", startDate: "2026-08-01", endDate: "2026-08-01", timezone: "Europe/Istanbul", sampleSize: 1, settled: true, qualityStatus: "ready", qualityReasonCodes: [], metricResult: aggregateMetaMetrics({ rows: [row], metrics: ["spendMinor"] }), snapshotRefs: ["snapshot_a"] } }); const timeframe = resolveAnalysisTimeframe({ timeframe: { kind: "fixed", startDate: "2026-08-01", endDate: "2026-08-01", timezone: "Europe/Istanbul" }, comparison: "none", asOf: "2026-08-02T00:00:00.000Z" }); return { feature, window: buildDeterministicWindowSnapshot({ timeframe, features: [feature] }) }; }
describe("DrizzleDeterministicWindowSnapshotRepository", () => {
  it("rejects before insert when one exact L2 feature is no longer current", async () => { const value = fixture(); let call = 0; const execute = vi.fn(async (): Promise<any> => ({ rows: [[{ id: scope.workspaceId }], []][call++] })); const repository = new DrizzleDeterministicWindowSnapshotRepository({ execute, transaction: async (work: (tx: unknown) => Promise<unknown>) => work({ execute }) } as never); await expect(repository.save({ window: value.window, features: [value.feature] })).rejects.toEqual(expect.objectContaining<Partial<DeterministicWindowSnapshotRepositoryError>>({ code: "source_changed" })); expect(execute).toHaveBeenCalledTimes(2); });

  it("returns a stale window when one persisted L2 feature was invalidated", async () => {
    const value = fixture();
    const execute = vi.fn(async (): Promise<any> => ({
      rows: [{ window_payload: value.window, features: [value.feature], invalidations: 1 }],
    }));
    const repository = new DrizzleDeterministicWindowSnapshotRepository({ execute } as never);

    await expect(repository.loadCurrent({ workspaceId: scope.workspaceId, windowRef: value.window.windowRef })).resolves.toEqual({
      state: "stale",
      window: value.window,
    });
  });

  it("materializes the complete current L2 set for one exact timeframe under the workspace lock", async () => {
    const value = fixture();
    const executeResults = [
      { rows: [{ id: scope.workspaceId }] },
      { rows: [{ feature_payload: value.feature }] },
      { rows: [{ id: scope.workspaceId }] },
      { rows: [{ id: "40000000-0000-4000-8000-000000000004", feature_payload: value.feature }] },
      { rows: [] },
    ];
    const execute = vi.fn(async (): Promise<any> => executeResults.shift());
    const repository = new DrizzleDeterministicWindowSnapshotRepository({
      transaction: async (work: (tx: unknown) => Promise<unknown>) => work({ execute }),
    } as never);

    await expect(repository.materializeForTimeframe({
      workspaceId: scope.workspaceId, metaConnectionId: scope.metaConnectionId, adAccountId: scope.adAccountId,
      entityLevel: scope.entityLevel, externalEntityId: scope.externalEntityId, timeframe: value.window.resolvedTimeframe,
    })).resolves.toEqual({ window: value.window, outcome: "unchanged" });
    expect(execute).toHaveBeenCalledTimes(5);
  });
});
