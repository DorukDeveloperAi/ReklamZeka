import { readFileSync } from "node:fs";
import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  metaDailyInsightMetrics,
  metaDailyInsights,
  deterministicFeatureSnapshotSources,
  deterministicFeatureSnapshots,
  deterministicFeatureSnapshotInvalidations,
  metaPortfolioSyncRuns,
  metaSyncRecordLedger,
  metaSyncRuns,
  metaSyncSlices,
  metaSyncStreams,
} from "@/db/schema";
import {
  type MetaDailyInsightInput,
  MetaInsightValidationError,
  normalizeMetaDailyInsight,
} from "@/domain/meta/insights/contract";
import { InMemoryMetaSyncPersistence } from "@/domain/meta/sync-persistence";

function fixture(): MetaDailyInsightInput {
  return JSON.parse(readFileSync(new URL("./fixtures/meta-insights/daily-campaign.json", import.meta.url), "utf8")) as MetaDailyInsightInput;
}

describe("Meta sync persistence schema", () => {
  it("keeps parent run, independent stream, slice and canonical daily insight identities explicit", () => {
    expect([
      metaPortfolioSyncRuns, metaSyncStreams, metaSyncRuns, metaSyncSlices, metaSyncRecordLedger, metaDailyInsights, metaDailyInsightMetrics,
      deterministicFeatureSnapshots, deterministicFeatureSnapshotSources, deterministicFeatureSnapshotInvalidations,
    ].map(getTableName)).toEqual([
      "meta_portfolio_sync_runs", "meta_sync_streams", "meta_sync_runs", "meta_sync_slices", "meta_sync_record_ledger", "meta_daily_insights", "meta_daily_insight_metrics",
      "deterministic_feature_snapshots", "deterministic_feature_snapshot_sources", "deterministic_feature_snapshot_invalidations",
    ]);
    expect(getTableColumns(metaSyncStreams)).toMatchObject({
      workspaceId: expect.anything(), metaConnectionId: expect.anything(), adAccountId: expect.anything(),
      streamType: expect.anything(), cursor: expect.anything(), checkpoint: expect.anything(), sourceRevision: expect.anything(),
      lastErrorClassification: expect.anything(), retryAt: expect.anything(),
    });
    expect(getTableColumns(metaSyncRuns)).toMatchObject({ portfolioRunId: expect.anything(), parentRunId: expect.anything(), attemptCount: expect.anything(), sourcePayloadHash: expect.anything() });
    expect(getTableColumns(metaSyncSlices)).toMatchObject({
      entityLevel: expect.anything(), dateStart: expect.anything(), dateStop: expect.anything(), cursor: expect.anything(),
      checkpoint: expect.anything(), attemptCount: expect.anything(), retryAt: expect.anything(), errorClassification: expect.anything(),
    });
    expect(getTableColumns(metaSyncRecordLedger)).toMatchObject({
      workspaceId: expect.anything(), metaConnectionId: expect.anything(), adAccountId: expect.anything(),
      streamType: expect.anything(), recordIdentity: expect.anything(), snapshotHash: expect.anything(),
    });
    expect(getTableColumns(metaDailyInsights)).toMatchObject({
      entityLevel: expect.anything(), dateStart: expect.anything(), dateStop: expect.anything(), attributionLabel: expect.anything(),
      currency: expect.anything(), timezone: expect.anything(), fieldAvailability: expect.anything(), metricProvenance: expect.anything(),
    });
    expect(getTableColumns(deterministicFeatureSnapshots)).toMatchObject({
      featureRef: expect.anything(), featureHash: expect.anything(), sourceManifestHash: expect.anything(), featurePayload: expect.anything(),
    });
    expect(getTableColumns(deterministicFeatureSnapshotSources)).toMatchObject({
      featureSnapshotId: expect.anything(), dailyInsightId: expect.anything(), snapshotRef: expect.anything(), contentHash: expect.anything(),
    });
    expect(getTableColumns(deterministicFeatureSnapshotInvalidations)).toMatchObject({
      featureSnapshotId: expect.anything(), dailyInsightId: expect.anything(), previousSourcePayloadHash: expect.anything(), currentSourcePayloadHash: expect.anything(),
    });
    expect(getTableColumns(metaDailyInsightMetrics)).toMatchObject({ aggregation: expect.anything(), actionType: expect.anything(), provenance: expect.anything() });
  });
});

describe("Meta daily insight contract", () => {
  it("does not duplicate a matching workspace/account/date/entity/attribution snapshot and rejects stale revisions", () => {
    const store = new InMemoryMetaSyncPersistence();
    const input = fixture();
    expect(store.upsertInsight(input, "2026-08-02T04:00:00.000Z")).toBe("inserted");
    expect(store.upsertInsight(input, "2026-08-02T05:00:00.000Z")).toBe("unchanged");
    expect(store.upsertInsight({ ...input, sourceRevision: "9", sourcePayloadHash: "older" }, "2026-08-02T06:00:00.000Z")).toBe("stale");
    expect(store.values()).toHaveLength(1);
  });

  it("isolates account cursor and insight state even inside one workspace", () => {
    const store = new InMemoryMetaSyncPersistence();
    const inventory = { workspaceId: "workspace-a", metaConnectionId: "connection-a", adAccountId: "account-a", stream: "inventory" } as const;
    const creative = { ...inventory, stream: "creative" } as const;
    const otherAccount = { ...inventory, adAccountId: "account-b" } as const;
    store.saveCheckpoint(inventory, { cursor: "inventory-page-2", checkpoint: { pageSize: 50 }, status: "partial", attemptCount: 2, retryAt: null, errorClassification: "rate_limited" });
    store.saveCheckpoint(creative, { cursor: "creative-page-4", checkpoint: {}, status: "running", attemptCount: 1, retryAt: null, errorClassification: null });
    expect(store.resume(otherAccount)).toBeUndefined();
    expect(store.resume(inventory)?.cursor).toBe("inventory-page-2");
    expect(store.resume(creative)?.cursor).toBe("creative-page-4");
    expect(store.upsertInsight(fixture(), "2026-08-02T04:00:00.000Z")).toBe("inserted");
    expect(store.upsertInsight({ ...fixture(), adAccountId: "account-b", currency: "USD", timezone: "America/New_York" }, "2026-08-02T04:00:00.000Z")).toBe("inserted");
    expect(store.values().map((value) => value.insight.currency).sort()).toEqual(["TRY", "USD"]);
  });

  it("preserves partial resume checkpoints without inferring unavailable platform fields", () => {
    const store = new InMemoryMetaSyncPersistence();
    const scope = { workspaceId: "workspace-a", metaConnectionId: "connection-a", adAccountId: "account-a", stream: "insights" } as const;
    store.saveCheckpoint(scope, { cursor: "after:campaign-1", checkpoint: { entityLevel: "campaign", dateStart: "2026-08-01", dateStop: "2026-08-03" }, status: "partial", attemptCount: 3, retryAt: "2026-08-02T05:00:00.000Z", errorClassification: "payload_too_large" });
    expect(store.resume(scope)).toEqual(expect.objectContaining({ status: "partial", cursor: "after:campaign-1", attemptCount: 3 }));
    const unavailable = normalizeMetaDailyInsight({
      ...fixture(), currency: undefined, timezone: undefined,
      fieldAvailability: {
        currency: { reason: "permission_missing" }, timezone: { reason: "unsupported" }, attributionWindow: { reason: "unsupported" },
      }, attributionWindow: undefined,
      metrics: [{ metricKey: "reach", aggregation: "non_additive", provenance: { field: "reach" }, availability: { reason: "permission_missing" } }],
    });
    expect(unavailable.currency).toBeUndefined();
    expect(unavailable.fieldAvailability?.currency).toEqual({ reason: "permission_missing" });
  });

  it("defines additive, non-additive and derived metrics and rejects accidental ad-level budgets", () => {
    const insight = normalizeMetaDailyInsight(fixture());
    expect(insight.metrics.map((metric) => [metric.metricKey, metric.aggregation])).toContainEqual(["spend", "additive"]);
    expect(insight.metrics.map((metric) => [metric.metricKey, metric.aggregation])).toContainEqual(["reach", "non_additive"]);
    expect(insight.metrics.map((metric) => [metric.metricKey, metric.aggregation])).toContainEqual(["ctr", "derived"]);
    expect(() => normalizeMetaDailyInsight({
      ...fixture(), entityLevel: "ad", metrics: [{ metricKey: "daily_budget", aggregation: "additive", valueMinor: 100, provenance: {} }],
    })).toThrowError(expect.objectContaining<Partial<MetaInsightValidationError>>({ code: "ad_level_budget_not_supported" }));
  });

  it.each(["campaign", "ad_set", "ad"] as const)("supports the %s daily insight grain", (entityLevel) => {
    expect(normalizeMetaDailyInsight({ ...fixture(), entityLevel, externalEntityId: `${entityLevel}-1` }).entityLevel).toBe(entityLevel);
  });
});
