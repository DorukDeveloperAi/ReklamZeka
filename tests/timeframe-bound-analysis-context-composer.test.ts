import { describe, expect, it, vi } from "vitest";
import { buildEffectiveCampaignContext } from "@/analyses/effective-campaign-context";
import { buildDeterministicFeatureSnapshot } from "@/analyses/deterministic-feature-snapshot";
import { buildDeterministicWindowSnapshot } from "@/analyses/deterministic-window-snapshot";
import { resolveAnalysisTimeframe } from "@/analyses/timeframe-resolver";
import { aggregateMetaMetrics } from "@/domain/meta/insights/metric-engine";
import { normalizeMetaDailyInsight } from "@/domain/meta/insights/contract";
import { buildEffectiveGuidancePack, createGuidanceRegistry } from "@/domain/guidance/registry";
import { TimeframeBoundAnalysisContextComposer, TimeframeBoundAnalysisContextComposerError } from "@/application/timeframe-bound-analysis-context-composer";

const workspaceId = "10000000-0000-4000-8000-000000000001";
const metaConnectionId = "20000000-0000-4000-8000-000000000002";
const adAccountId = "30000000-0000-4000-8000-000000000003";
const timeframe = resolveAnalysisTimeframe({ timeframe: { kind: "fixed", startDate: "2026-08-01", endDate: "2026-08-01", timezone: "Europe/Istanbul" }, comparison: "none", asOf: "2026-08-02T00:00:00.000Z" });

function sourceContext() {
  const guidance = buildEffectiveGuidancePack(createGuidanceRegistry({ workspaceId, sources: [], cards: [], sets: [], bindings: [] }), {
    workspaceId, accountId: "account_safe", objective: "sales", internalCategoryIds: [], entity: { type: "campaign", id: "campaign_safe" },
    topics: [], requiredTopics: [], evaluatedAt: "2026-08-02T00:00:00.000Z", budget: { maxCards: 10, maxSources: 10, maxCharacters: 1_000 },
  });
  return buildEffectiveCampaignContext({ workspaceId, capturedAt: "2026-08-02T00:00:00.000Z", identity: {
    connectionRef: "connection_safe", accountRef: "account_safe", campaignRef: "campaign_safe", entityType: "campaign", entityRef: "campaign_safe", hierarchyRefs: ["campaign_safe"],
  }, meta: {
    objective: { state: "known", value: "sales" }, optimizationEvent: { state: "known", value: "purchase" }, configuredStatus: { state: "known", value: "ACTIVE" }, effectiveStatus: { state: "known", value: "ACTIVE" },
    budgetOwnerRef: { state: "known", value: "campaign_safe" }, targetingSignature: { state: "unknown", reason: "not_observed" }, actorRef: { state: "known", value: null }, destinationRef: { state: "known", value: null },
  }, categories: [], guidance, policies: [], cadence: { profileRef: "cadence_safe", decision: "eligible", reason: "window_open", cooldownUntil: null },
  data: { trustStatus: "not_ready", snapshotRefs: ["snapshot_safe"], featureRefs: [], windowRefs: [], blockers: ["analysis_window_not_bound"] },
  history: { changeRefs: [], decisionRefs: [], experimentRefs: [], practiceRefs: [], outcomeRefs: [] }, versions: { metaCatalog: "meta", categoryResolver: "category", guidanceRegistry: "guidance", metricCatalog: "metric", formulaCatalog: "formula", timeframeResolver: "timeframe", instructionPolicyRegistry: "a".repeat(64), promotionRegistry: "b".repeat(64) },
  });
}

function window() {
  const row = normalizeMetaDailyInsight({ schemaVersion: 1, workspaceId, metaConnectionId, adAccountId, entityLevel: "campaign", externalEntityId: "campaign_safe", dateStart: "2026-08-01", dateStop: "2026-08-01", attributionLabel: "default", currency: "TRY", timezone: "Europe/Istanbul", sourceRevision: "1", sourcePayloadHash: "hash", metricProvenance: {}, metrics: [{ metricKey: "spend", aggregation: "additive", valueMinor: 1, currency: "TRY", provenance: {} }] });
  const feature = buildDeterministicFeatureSnapshot({ scope: { workspaceId, metaConnectionId, adAccountId, entityLevel: "campaign", externalEntityId: "campaign_safe" }, observation: { observationRef: "obs_safe", role: "primary", startDate: "2026-08-01", endDate: "2026-08-01", timezone: "Europe/Istanbul", sampleSize: 1, settled: true, qualityStatus: "ready", qualityReasonCodes: [], metricResult: aggregateMetaMetrics({ rows: [row], metrics: ["spendMinor"] }), snapshotRefs: ["snapshot_safe"] } });
  return buildDeterministicWindowSnapshot({ timeframe, features: [feature] });
}

describe("TimeframeBoundAnalysisContextComposer", () => {
  it("derives L2/L3 data only from the latest valid repository context and exact timeframe", async () => {
    const source = sourceContext(); const l3 = window();
    const record = { context: source, analysisDataScope: { metaConnectionId, adAccountId, campaignId: "30000000-0000-4000-8000-000000000004" }, sourceComponents: [], invalidated: false } as const;
    const loadLatestValid = vi.fn(async () => record);
    const materializeForTimeframe = vi.fn(async () => ({ window: l3, outcome: "inserted" as const }));
    const save = vi.fn(async (context) => ({ outcome: "inserted" as const, record: { ...record, context, invalidated: false } }));
    const composer = new TimeframeBoundAnalysisContextComposer({ loadLatestValid }, { materializeForTimeframe }, { save }, () => new Date("2026-08-02T00:00:01.000Z"));

    const result = await composer.composeAndSave({ workspaceId, entityType: "campaign", entityRef: "campaign_safe", timeframe });
    expect(materializeForTimeframe).toHaveBeenCalledWith({ workspaceId, metaConnectionId, adAccountId, entityLevel: "campaign", externalEntityId: "campaign_safe", timeframe });
    expect(result.context.data).toEqual({ trustStatus: "ready", snapshotRefs: ["snapshot_safe"], featureRefs: l3.featureRefs, windowRefs: [l3.windowRef], blockers: [] });
    expect(result.context.capturedAt).toBe("2026-08-02T00:00:01.000Z");
    expect(save).toHaveBeenCalledWith(result.context, { mode: "evidence_bound" });
  });

  it("rejects invalidated or stale current context before materializing a window", async () => {
    const source = sourceContext();
    const materializeForTimeframe = vi.fn();
    const composer = new TimeframeBoundAnalysisContextComposer({ loadLatestValid: async () => ({ context: source, analysisDataScope: { metaConnectionId, adAccountId }, sourceComponents: [], invalidated: true }) as never }, { materializeForTimeframe }, { save: vi.fn() }, () => new Date("2026-08-02T00:00:01.000Z"));
    await expect(composer.composeAndSave({ workspaceId, entityType: "campaign", entityRef: "campaign_safe", timeframe }))
      .rejects.toMatchObject({ code: "source_rejected" } satisfies Partial<TimeframeBoundAnalysisContextComposerError>);
    expect(materializeForTimeframe).not.toHaveBeenCalled();
  });
});
