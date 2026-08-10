import { describe, expect, it, vi } from "vitest";
import { buildEffectiveCampaignContext } from "@/analyses/effective-campaign-context";
import { buildAnalysisAgenda } from "@/analyses/agenda";
import { resolveAnalysisTimeframe } from "@/analyses/timeframe-resolver";
import {
  DECISION_ROOM_ANALYSIS_RUNTIME_VERSION,
  DecisionRoomAnalysisRuntimeError,
  DecisionRoomDeterministicAnalysisRuntime,
  type DecisionRoomAnalysisRuntimeAssets,
} from "@/application/decision-room-analysis-runtime";
import type { DecisionRoomDraftPort } from "@/application/decision-room";
import { DECISION_CADENCE_VERSION } from "@/domain/decisions/cadence";
import type { DecisionLedger } from "@/domain/decisions/ledger";
import {
  DECISION_ROOM_EXECUTOR_VERSION,
  DecisionRoomExecutor,
  InMemoryDecisionRoomInbox,
  InMemoryDecisionRoomRunStore,
} from "@/domain/decisions/executor";
import { normalizeMetaDailyInsight } from "@/domain/meta/insights/contract";
import { buildEffectiveGuidancePack, createGuidanceRegistry } from "@/domain/guidance/registry";

const now = "2026-08-07T12:00:00.000Z";
const workspaceId = "10000000-0000-4000-8000-000000000001";
const snapshotRef = "snapshot_l2_safe";
const featureRef = "feature_aaaaaaaaaaaaaaaaaaaaaaaa";
const windowRef = "window_bbbbbbbbbbbbbbbbbbbbbbbb";
const timeframe = resolveAnalysisTimeframe({
  timeframe: { kind: "rolling", days: 1, timezone: "Europe/Istanbul" },
  comparison: "none",
  asOf: now,
});

function context() {
  const registry = createGuidanceRegistry({ workspaceId, sources: [], cards: [], bindings: [], sets: [] });
  const guidance = buildEffectiveGuidancePack(registry, {
    workspaceId, accountId: "account_safe", objective: "sales", internalCategoryIds: [],
    entity: { type: "campaign", id: "campaign_safe" }, topics: [], requiredTopics: [],
    evaluatedAt: now, budget: { maxCards: 10, maxSources: 10, maxCharacters: 10_000 },
  });
  return buildEffectiveCampaignContext({
    workspaceId, capturedAt: now,
    identity: {
      connectionRef: "connection_safe", accountRef: "account_safe", campaignRef: "campaign_safe",
      entityRef: "campaign_safe", entityType: "campaign", hierarchyRefs: ["campaign_safe"],
    },
    meta: {
      objective: { state: "known", value: "sales" }, optimizationEvent: { state: "known", value: "purchase" },
      configuredStatus: { state: "known", value: "ACTIVE" }, effectiveStatus: { state: "known", value: "ACTIVE" },
      budgetOwnerRef: { state: "known", value: "campaign_safe" }, targetingSignature: { state: "unknown", reason: "not_loaded" },
      actorRef: { state: "known", value: "actor_safe" }, destinationRef: { state: "known", value: null },
    },
    categories: [], guidance, policies: [],
    cadence: { profileRef: "cadence_safe", decision: "eligible", reason: "window_open", cooldownUntil: null },
    data: {
      trustStatus: "ready", snapshotRefs: [snapshotRef], featureRefs: [featureRef],
      windowRefs: [windowRef], blockers: [],
    },
    history: { changeRefs: [], decisionRefs: [], experimentRefs: [], practiceRefs: [], outcomeRefs: [] },
    versions: {
      metaCatalog: "meta_v1", categoryResolver: "category_v1", guidanceRegistry: "guidance_v1",
      metricCatalog: "metric_v1", formulaCatalog: "formula_v1", timeframeResolver: "timeframe_v1",
    },
  });
}

function assets(): DecisionRoomAnalysisRuntimeAssets {
  return {
    version: DECISION_ROOM_ANALYSIS_RUNTIME_VERSION,
    workspaceRef: "workspace_safe", accountRef: "account_safe", campaignRef: "campaign_safe",
    timeframeRef: "timeframe_daily", templateRef: "template_daily", occurredAt: now,
    context: context(), resolvedTimeframe: timeframe, requestedPasses: ["ad"],
    agenda: buildAnalysisAgenda({ context: context(), resolvedTimeframe: timeframe, requestedPasses: ["ad"] }),
    hierarchy: [
      { entityRef: "campaign_safe", entityType: "campaign", parentEntityRef: null },
      { entityRef: "adset_safe", entityType: "ad_set", parentEntityRef: "campaign_safe" },
      { entityRef: "ad_safe", entityType: "ad", parentEntityRef: "adset_safe" },
    ],
    checks: [{
      checkKey: "spend_guard", passKey: "ad", entityRef: "ad_safe", entityType: "ad",
      parentEntityRef: "adset_safe", hierarchyPathRefs: ["campaign_safe", "adset_safe", "ad_safe"],
      driverEvidenceRefs: [], externalEntityId: "238000000000001",
      metaConnectionId: "20000000-0000-4000-8000-000000000002",
      adAccountId: "30000000-0000-4000-8000-000000000003", attributionLabel: "7d_click_1d_view",
      expectedCurrency: "TRY",
      spec: { kind: "threshold", metric: "spendMinor", operator: "gt", thresholdDecimal: "1000", minimumSample: 1 },
      maxRowsPerQuery: 10, expectedSnapshotRefs: [snapshotRef],
    }],
    cadence: {
      profile: {
        version: DECISION_CADENCE_VERSION, settleHours: 0, minimumObservationHours: 0,
        minimumLearningHours: 0, cooldownHours: 24, repeatSuppressionHours: 24,
        frequencyWindowHours: 24, maxDecisionsPerWindow: 5, maxActionsPerWindow: 2,
        maximumHistoryEntries: 20, minimumEvidenceCount: 1, minimumEvidenceScore: 0.5,
      },
      observationStartedAt: "2026-08-01T00:00:00.000Z", lastMaterialChangeAt: null,
      learning: { state: "not_applicable", startedAt: null }, lastDecision: null, recentDecisions: [],
      requestedDisposition: "act", emergencyGuardrail: { breached: false, evidenceRef: null },
    },
  };
}

function input() {
  return {
    runRef: "run_safe", workspaceRef: "workspace_safe", accountRef: "account_safe",
    campaignRef: "campaign_safe", timeframeRef: "timeframe_daily", templateRef: "template_daily",
    triggerKind: "scheduled" as const, actionAuthority: "none" as const,
  };
}

function drafts() {
  let ledger: DecisionLedger = [];
  const port: DecisionRoomDraftPort = {
    readLedger: async () => ledger,
    stageDraft: async (candidate) => { ledger = candidate.ledger; },
  };
  return { port, ledger: () => ledger };
}

function canonicalRow() {
  return normalizeMetaDailyInsight({
    schemaVersion: 1, workspaceId,
    metaConnectionId: "20000000-0000-4000-8000-000000000002",
    adAccountId: "30000000-0000-4000-8000-000000000003", entityLevel: "ad",
    externalEntityId: "238000000000001", dateStart: timeframe.startDate, dateStop: timeframe.endDate,
    attributionLabel: "7d_click_1d_view", attributionWindow: { click: 7, view: 1 },
    currency: "TRY", timezone: "Europe/Istanbul", sourceRevision: "revision_safe",
    sourcePayloadHash: "payload_safe", metricProvenance: { source: "meta" },
    metrics: [{ metricKey: "spend", aggregation: "additive", valueMinor: 1250, currency: "TRY", provenance: { field: "spend" } }],
  });
}

describe("DecisionRoomDeterministicAnalysisRuntime", () => {
  it("materializes exact L2 evidence and stages a model-free deterministic decision room run", async () => {
    const storage = drafts();
    const loadExact = vi.fn(async () => assets());
    const read = vi.fn(async (query: { queryRef: string; endDate: string }) => ({
      queryRef: query.queryRef, rows: [canonicalRow()], snapshotRefs: [snapshotRef],
      settledThroughDate: query.endDate, complete: true as const, qualityStatus: "ready" as const,
      qualityReasonCodes: [],
    }));
    const runtime = new DecisionRoomDeterministicAnalysisRuntime({ loadExact }, { read } as never, storage.port);

    const result = await runtime.execute(input());

    expect(result).toMatchObject({
      analysisRef: expect.stringMatching(/^decision_room_[a-f0-9]{24}$/),
      summaryCode: "deterministic_advisory",
      evidenceRefs: [expect.stringMatching(/^finding_[a-f0-9]{24}$/)],
    });
    expect(loadExact).toHaveBeenCalledWith({
      runRef: "run_safe", workspaceRef: "workspace_safe", accountRef: "account_safe",
      campaignRef: "campaign_safe", timeframeRef: "timeframe_daily", templateRef: "template_daily",
      triggerKind: "scheduled",
    });
    expect(read).toHaveBeenCalledTimes(1);
    expect(storage.ledger()).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain(workspaceId);
    expect(JSON.stringify(result)).not.toContain("238000000000001");
  });

  it("turns degraded or empty L2 material into a safe no-change record", async () => {
    const storage = drafts();
    const runtime = new DecisionRoomDeterministicAnalysisRuntime(
      { loadExact: async () => assets() },
      { read: async (query) => ({
        queryRef: query.queryRef, rows: [], snapshotRefs: [snapshotRef],
        settledThroughDate: "2026-08-05", complete: true, qualityStatus: "degraded",
        qualityReasonCodes: ["no_data"],
      }) },
      storage.port,
    );

    await expect(runtime.execute(input())).resolves.toMatchObject({ summaryCode: "deterministic_no_change" });
    expect(storage.ledger()).toHaveLength(2);
  });

  it("fails closed on unbound assets and non-frozen L2 evidence before ledger staging", async () => {
    const storage = drafts();
    const read = vi.fn(async (query: { queryRef: string; endDate: string }) => ({
      queryRef: query.queryRef, rows: [canonicalRow()], snapshotRefs: ["snapshot_not_frozen"],
      settledThroughDate: query.endDate, complete: true as const, qualityStatus: "ready" as const,
      qualityReasonCodes: [],
    }));
    const mismatch = new DecisionRoomDeterministicAnalysisRuntime(
      { loadExact: async () => ({ ...assets(), templateRef: "template_foreign" }) }, { read } as never, storage.port,
    );
    await expect(mismatch.execute(input())).rejects.toEqual(
      expect.objectContaining<Partial<DecisionRoomAnalysisRuntimeError>>({ code: "asset_not_bound" }),
    );
    expect(read).not.toHaveBeenCalled();

    const unfrozen = new DecisionRoomDeterministicAnalysisRuntime(
      { loadExact: async () => assets() }, { read } as never, storage.port,
    );
    await expect(unfrozen.execute(input())).rejects.toEqual(
      expect.objectContaining<Partial<DecisionRoomAnalysisRuntimeError>>({ code: "evidence_not_frozen" }),
    );
    expect(storage.ledger()).toHaveLength(0);
  });

  it("rejects a current Decision Room asset without frozen L3 evidence", async () => {
    const withoutWindow = assets();
    const { schemaVersion: _schemaVersion, contextHash: _contextHash, capabilities: _capabilities, ...inputContext } = withoutWindow.context;
    const contextWithoutWindow = buildEffectiveCampaignContext({ ...inputContext, data: {
      ...inputContext.data, featureRefs: [], windowRefs: [],
    } });
    const runtime = new DecisionRoomDeterministicAnalysisRuntime(
      { loadExact: async () => ({ ...withoutWindow, context: contextWithoutWindow,
        agenda: buildAnalysisAgenda({ context: contextWithoutWindow, resolvedTimeframe: timeframe, requestedPasses: ["ad"] }) }) },
      { read: vi.fn() }, drafts().port,
    );
    await expect(runtime.execute(input())).rejects.toMatchObject({ code: "asset_not_bound" });
  });

  it("fails closed when the frozen agenda payload is stale or tampered", async () => {
    const storage = drafts();
    const read = vi.fn();
    const prepared = assets();
    const runtime = new DecisionRoomDeterministicAnalysisRuntime(
      { loadExact: async () => ({
        ...prepared,
        agenda: { ...prepared.agenda, agendaHash: "f".repeat(64) },
      }) },
      { read } as never,
      storage.port,
    );

    await expect(runtime.execute(input())).rejects.toEqual(
      expect.objectContaining<Partial<DecisionRoomAnalysisRuntimeError>>({ code: "asset_not_bound" }),
    );
    expect(read).not.toHaveBeenCalled();
    expect(storage.ledger()).toHaveLength(0);
  });

  it("validates every nested check before the first L2 read", async () => {
    const prepared = assets();
    const read = vi.fn();
    const malformed = {
      ...prepared,
      checks: [
        prepared.checks[0]!,
        { ...prepared.checks[0]!, checkKey: "spend_guard_invalid", spec: { kind: "threshold", metric: "spendMinor", operator: "gt", thresholdDecimal: "1000", minimumSample: 0 } },
      ],
    } as unknown as DecisionRoomAnalysisRuntimeAssets;
    const runtime = new DecisionRoomDeterministicAnalysisRuntime(
      { loadExact: async () => malformed }, { read } as never, drafts().port,
    );

    await expect(runtime.execute(input())).rejects.toEqual(
      expect.objectContaining<Partial<DecisionRoomAnalysisRuntimeError>>({ code: "asset_not_bound" }),
    );
    expect(read).not.toHaveBeenCalled();
  });

  it("binds both manual and scheduled executor runs to the same deterministic runtime", async () => {
    const storage = drafts();
    const triggerKinds: string[] = [];
    const runtime = new DecisionRoomDeterministicAnalysisRuntime(
      { loadExact: async (request) => { triggerKinds.push(request.triggerKind); return assets(); } },
      { read: async (query) => ({
        queryRef: query.queryRef, rows: [canonicalRow()], snapshotRefs: [snapshotRef],
        settledThroughDate: query.endDate, complete: true, qualityStatus: "ready", qualityReasonCodes: [],
      }) },
      storage.port,
    );
    const inbox = new InMemoryDecisionRoomInbox();
    const executor = new DecisionRoomExecutor(
      new InMemoryDecisionRoomRunStore(), runtime, inbox, () => new Date(now),
    );
    const base = {
      version: DECISION_ROOM_EXECUTOR_VERSION,
      requestedAt: now, workspaceRef: "workspace_safe", accountRef: "account_safe",
      campaignRef: "campaign_safe", timeframeRef: "timeframe_daily", templateRef: "template_daily",
      notificationChannel: "in_app_inbox" as const,
    };

    const manual = await executor.execute({
      ...base, trigger: { kind: "manual", requestRef: "request_safe", requestedByRef: "actor_safe" },
    });
    const scheduled = await executor.execute({
      ...base,
      trigger: {
        kind: "scheduled", scheduleRef: "schedule_safe", scheduleDefinitionHash: "a".repeat(64), scheduledFor: now,
      },
    });

    expect([manual.status, scheduled.status]).toEqual(["completed", "completed"]);
    expect(triggerKinds).toEqual(["manual", "scheduled"]);
    expect(inbox.list()).toHaveLength(2);
    expect(storage.ledger()).toHaveLength(1);
  });
});
