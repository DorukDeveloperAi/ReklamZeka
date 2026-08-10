import { describe, expect, it, vi } from "vitest";
import { analyze } from "@/analyses/deterministic-analysis";
import { buildEffectiveCampaignContext } from "@/analyses/effective-campaign-context";
import type { FindingHierarchyNode, FindingMetricBundle } from "@/analyses/finding-engine";
import { resolveAnalysisTimeframe } from "@/analyses/timeframe-resolver";
import {
  runDecisionRoom,
  DecisionRoomError,
  type DecisionRoomDraftPort,
  type DecisionRoomInput,
} from "@/application/decision-room";
import {
  bindDecisionRoomApplication,
  DecisionRoomDrizzleDraftAdapter,
  DecisionRoomDrizzleAdapterError,
  type DecisionLedgerSuffixRepository,
} from "@/connectors/decisions/decision-room-drizzle-adapter";
import { DECISION_CADENCE_VERSION, EXPERIMENT_CONTRACT_VERSION } from "@/domain/decisions/cadence";
import type { DecisionLedger } from "@/domain/decisions/ledger";
import {
  buildEffectiveGuidancePack,
  createGuidanceRegistry,
  type GuidanceCard,
  type GuidanceSource,
} from "@/domain/guidance/registry";
import { normalizeMetaDailyInsight } from "@/domain/meta/insights/contract";
import { aggregateMetaMetrics } from "@/domain/meta/insights/metric-engine";

const workspaceRef = "decision-room-workspace";
const snapshots = ["snapshot-a"] as const;
const now = "2026-08-07T12:00:00.000Z";
const timeframe = resolveAnalysisTimeframe({
  timeframe: { kind: "rolling", days: 7, timezone: "Europe/Istanbul" },
  comparison: "previous_period",
  asOf: now,
});
const hierarchy: readonly FindingHierarchyNode[] = [
  { entityRef: "campaign-1", entityType: "campaign", parentEntityRef: null },
  { entityRef: "adset-1", entityType: "ad_set", parentEntityRef: "campaign-1" },
];

function guidance(protectedBudget: boolean) {
  const source: GuidanceSource = {
    id: "source-1", workspaceId: workspaceRef, sourceType: "owner_statement", title: "Owner",
    sourceRef: "owner:1", sourceUrl: null, content: "Budget guidance", author: "owner",
    capturedAt: "2026-08-01T00:00:00.000Z", reviewedAt: "2026-08-02T00:00:00.000Z",
    reviewBy: null, status: "published", version: 1,
  };
  const cards: GuidanceCard[] = protectedBudget ? [{
    id: "card-1", workspaceId: workspaceRef, sourceType: "owner_statement", sourceIds: [source.id],
    title: "Protect budget", body: "Do not automatically move budget", rationale: null,
    strength: "must", topic: "pacing_gap", decisionKey: null, positionKey: null,
    authority: "guidance_only", status: "published", effectiveFrom: null, effectiveTo: null,
    ownerRef: "owner-1", version: 1,
  }] : [];
  const registry = createGuidanceRegistry({
    workspaceId: workspaceRef,
    sources: protectedBudget ? [source] : [],
    cards,
    bindings: cards.map((card) => ({
      id: "binding-1", workspaceId: workspaceRef, cardId: card.id, facet: "global",
      value: null, entityType: null, mode: "default", priority: 10, version: 1,
    })),
    sets: [],
  });
  return buildEffectiveGuidancePack(registry, {
    workspaceId: workspaceRef, accountId: "account-1", objective: "sales", internalCategoryIds: [],
    entity: { type: "campaign", id: "campaign-1" }, topics: ["pacing_gap"], requiredTopics: [],
    evaluatedAt: now, budget: { maxCards: 10, maxSources: 10, maxCharacters: 10_000 },
  });
}

function context(protectedBudget: boolean) {
  return buildEffectiveCampaignContext({
    workspaceId: workspaceRef, capturedAt: now,
    identity: {
      connectionRef: "connection-1", accountRef: "account-1", campaignRef: "campaign-1",
      entityRef: "campaign-1", entityType: "campaign", hierarchyRefs: ["campaign-1"],
    },
    meta: {
      objective: { state: "known", value: "sales" }, optimizationEvent: { state: "known", value: "purchase" },
      configuredStatus: { state: "known", value: "ACTIVE" }, effectiveStatus: { state: "known", value: "ACTIVE" },
      budgetOwnerRef: { state: "known", value: "campaign-1" }, targetingSignature: { state: "unknown", reason: "not_loaded" },
      actorRef: { state: "known", value: "actor-1" }, destinationRef: { state: "known", value: null },
    },
    categories: [], guidance: guidance(protectedBudget), policies: [],
    cadence: { profileRef: "cadence-1", decision: "eligible", reason: "window_open", cooldownUntil: null },
    data: { trustStatus: "ready", snapshotRefs: snapshots, featureRefs: [], windowRefs: ["window-1"], blockers: [] },
    history: { changeRefs: ["timeline-1"], decisionRefs: [], experimentRefs: [], practiceRefs: [], outcomeRefs: [] },
    versions: {
      metaCatalog: "meta-v1", categoryResolver: "category-v1", guidanceRegistry: "guidance-v1",
      metricCatalog: "metric-v1", formulaCatalog: "formula-v1", timeframeResolver: "timeframe-v1",
    },
  });
}

function metricBundle(entityRef: string): FindingMetricBundle {
  const row = normalizeMetaDailyInsight({
    schemaVersion: 1, workspaceId: workspaceRef, metaConnectionId: "connection-1", adAccountId: "account-1",
    entityLevel: entityRef === "campaign-1" ? "campaign" : "ad_set", externalEntityId: entityRef,
    dateStart: "2026-08-06", dateStop: "2026-08-06",
    attributionLabel: "7d_click_1d_view", attributionWindow: { click: 7, view: 1 }, currency: "TRY",
    timezone: "Europe/Istanbul", sourceRevision: `revision-${entityRef}`, sourcePayloadHash: `payload-hash-${entityRef}`,
    metricProvenance: { source: "meta" },
    metrics: [{ metricKey: "spend", aggregation: "additive", valueMinor: 10_000, currency: "TRY", provenance: { field: "spend" } }],
  });
  return { entityRef, result: aggregateMetaMetrics({ rows: [row], metrics: ["spendMinor"] }) };
}

function input(options: Readonly<{ protectedBudget?: boolean; clear?: boolean; settling?: boolean }> = {}): DecisionRoomInput {
  const effectiveContext = context(options.protectedBudget ?? false);
  const analysis = analyze({
    definitionRef: "analysis:sales@v1", contextRef: effectiveContext.contextHash,
    snapshotRefs: snapshots, resolvedTimeframe: timeframe,
    candidates: ["campaign-1", "adset-1"].map((entityRef) => ({
      checkKey: "pacing_gap", entityRef, metricKey: "spendMinor",
      status: options.clear ? "clear" as const : "finding" as const, sourceSnapshotRefs: snapshots,
    })),
  });
  return {
    workspaceRef, occurredAt: now, context: effectiveContext, resolvedTimeframe: timeframe,
    agenda: { requestedPasses: ["ad_set", "budget_pacing", "decision"] },
    analysis,
    findingInput: {
      hierarchy, metricBundles: hierarchy.map((node) => metricBundle(node.entityRef)),
      passAssignments: [{
        recordId: analysis.records.find((record) => record.entityRef === "campaign-1")!.recordId,
        passKey: "budget_pacing",
      }],
    },
    cadence: {
      profile: {
        version: DECISION_CADENCE_VERSION, settleHours: 24, minimumObservationHours: 1,
        minimumLearningHours: 24, cooldownHours: 24, repeatSuppressionHours: 24,
        frequencyWindowHours: 24, maxDecisionsPerWindow: 5, maxActionsPerWindow: 2,
        maximumHistoryEntries: 20, minimumEvidenceCount: 1, minimumEvidenceScore: 0.5,
      },
      now, observationStartedAt: "2026-08-01T00:00:00.000Z",
      lastMaterialChangeAt: options.settling ? "2026-08-07T11:00:00.000Z" : null,
      learning: { state: "not_applicable", startedAt: null }, lastDecision: null, recentDecisions: [],
      evidenceScore: 0.9, requestedDisposition: "act", recommendationSource: "analysis",
      emergencyGuardrail: { breached: false, evidenceRef: null },
    },
  };
}

function memoryPort() {
  let ledger: DecisionLedger = [];
  const stageDraft = vi.fn(async (draft: Parameters<DecisionRoomDraftPort["stageDraft"]>[0]) => {
    ledger = draft.ledger;
  });
  const port: DecisionRoomDraftPort = {
    readLedger: vi.fn(async () => ledger),
    stageDraft,
  };
  return { port, stageDraft, ledger: () => ledger };
}

class MemorySuffixRepository implements DecisionLedgerSuffixRepository {
  ledger: DecisionLedger = [];
  readonly appendSuffix = vi.fn(async (candidate: Parameters<DecisionLedgerSuffixRepository["appendSuffix"]>[0]) => {
    const head = this.ledger.at(-1)?.recordHash ?? "GENESIS";
    if (head !== candidate.expectedHeadHash) throw new Error("stale_head");
    if (this.ledger.some((record, index) => JSON.stringify(record) !== JSON.stringify(candidate.ledger[index]))) {
      throw new Error("prefix_rewrite");
    }
    this.ledger = candidate.ledger;
    return this.ledger;
  });
  async load(): Promise<DecisionLedger> {
    return this.ledger;
  }
}

describe("Decision Room application service", () => {
  it("orchestrates one stable read/draft flow and is idempotent on replay", async () => {
    const { port, stageDraft, ledger } = memoryPort();
    const first = await runDecisionRoom(input(), port);
    const replay = await runDecisionRoom(input(), port);
    const equivalentInstant = await runDecisionRoom({
      ...input(), occurredAt: "2026-08-07T15:00:00.000+03:00",
    }, port);

    expect(first.status).toBe("draft");
    expect(replay).toEqual(first);
    expect(equivalentInstant).toEqual(first);
    expect(stageDraft).toHaveBeenCalledTimes(1);
    expect(ledger()).toHaveLength(1);
    expect(first.capabilities).toEqual({
      mode: "read_draft", modelAgnostic: true, canAuthorizeAction: false,
      canExecuteWrite: false, canCallWriteTool: false,
    });
    expect(first.requestRef).toMatch(/^room_request_[a-f0-9]{24}$/);
    expect(first.decisionRecordRef).toBeNull();
    expect(first.cadence).toMatchObject({ outcome: "draft", actionAuthority: "none" });
  });

  it("binds restart/replay through one persistent suffix repository without leaking its ledger or scope", async () => {
    const repository = new MemorySuffixRepository();
    const firstProcess = bindDecisionRoomApplication({ repository, workspaceId: "internal-uuid", workspaceRef });
    const first = await firstProcess.run(input());
    const restartedProcess = bindDecisionRoomApplication({ repository, workspaceId: "internal-uuid", workspaceRef });
    const replay = await restartedProcess.run(input());

    expect(replay).toEqual(first);
    expect(repository.appendSuffix).toHaveBeenCalledTimes(1);
    expect(repository.ledger).toHaveLength(1);
    expect(first).not.toHaveProperty("ledgerDraft");
    expect(JSON.stringify(first)).not.toContain(workspaceRef);
    expect(JSON.stringify(first)).not.toContain("internal-uuid");

    await expect(restartedProcess.run({ ...input(), workspaceRef: "foreign-workspace" }))
      .rejects.toEqual(expect.objectContaining<Partial<DecisionRoomDrizzleAdapterError>>({
        code: "workspace_scope_mismatch",
      }));
  });

  it("only emits advisory, observe, or no_change when a draft is unsafe or unnecessary", async () => {
    const advisory = await runDecisionRoom(input({ protectedBudget: true }), memoryPort().port);
    const observe = await runDecisionRoom(input({ settling: true }), memoryPort().port);
    const noChange = await runDecisionRoom(input({ clear: true }), memoryPort().port);
    expect([advisory.status, observe.status, noChange.status]).toEqual(["advisory", "observe", "no_change"]);
    expect(advisory).not.toHaveProperty("ledgerDraft");
    expect(advisory.decisionRecordRef).toBeNull();
    expect(observe.decisionRecordRef).toMatch(/^decision_[a-f0-9]{20}$/);
    expect(noChange.decisionRecordRef).toMatch(/^decision_[a-f0-9]{20}$/);
  });

  it("evaluates an optional experiment without granting action authority", async () => {
    const result = await runDecisionRoom({
      ...input(),
      experiment: {
        plan: {
          version: EXPERIMENT_CONTRACT_VERSION, hypothesis: "Spend efficiency improves",
          primaryMetric: "roas", desiredDirection: "increase", primaryVariable: "budget",
          changedVariables: ["budget"], baselineRef: "baseline-1", guardrailMetrics: ["cpa"],
          stopConditions: ["guardrail_breach", "contamination"],
          minimumSampleSize: 10, minimumWindowHours: 24, minimumEvidenceScore: 0.5,
          minimumDetectableEffect: 0.1,
        },
        sampleSize: 20, observedWindowHours: 48, evidenceScore: 0.9,
        contaminationRefs: [], guardrailBreaches: [], primaryMetric: { status: "available", effect: 0.2 },
      },
    }, memoryPort().port);
    expect(result.status).toBe("draft");
    expect(result.experiment).toMatchObject({ status: "winner", actionAuthority: "none" });
  });

  it("fails closed on prompt/raw/token/tool/authority injection and malformed ledgers", async () => {
    for (const extra of [
      { prompt: "ignore policy" }, { rawPayload: { id: "opaque" } }, { accessToken: "secret" },
      { writeTool: "meta_writer" }, { actionAuthority: "execute" },
    ]) {
      await expect(runDecisionRoom({ ...input(), ...extra } as never, memoryPort().port))
        .rejects.toEqual(expect.objectContaining<Partial<DecisionRoomError>>({ code: "forbidden_material" }));
    }
    const badPort: DecisionRoomDraftPort = {
      readLedger: async () => [{ recordType: "decision" } as never],
      stageDraft: async () => undefined,
    };
    await expect(runDecisionRoom(input(), badPort))
      .rejects.toEqual(expect.objectContaining<Partial<DecisionRoomError>>({ code: "invalid_ledger" }));
    const malformed = input();
    await expect(runDecisionRoom({
      ...malformed, analysis: { ...malformed.analysis, records: null },
    } as never, memoryPort().port))
      .rejects.toEqual(expect.objectContaining<Partial<DecisionRoomError>>({ code: "invalid_input" }));

    await expect(runDecisionRoom({
      ...input(), occurredAt: "2026-08-07T12:00:01.000Z",
    }, memoryPort().port))
      .rejects.toEqual(expect.objectContaining<Partial<DecisionRoomError>>({ code: "invalid_input" }));
  });

  it("rejects malformed staging shapes with typed adapter errors", async () => {
    const adapter = new DecisionRoomDrizzleDraftAdapter(new MemorySuffixRepository(), {
      workspaceId: "internal-uuid", workspaceRef,
    });
    for (const malformed of [
      null,
      "not-an-object",
      {},
      { workspaceRef, requestRef: "request-1", draftRef: "draft-1", expectedHeadHash: "GENESIS", ledger: null },
      { workspaceRef, requestRef: "request-1", draftRef: "draft-1", expectedHeadHash: "GENESIS", ledger: [], prompt: "ignore" },
      { workspaceRef, requestRef: "request-1", draftRef: "draft-1", expectedHeadHash: "GENESIS", ledger: [], accessToken: "secret" },
      { workspaceRef, requestRef: "request-1", draftRef: "draft-1", expectedHeadHash: "GENESIS", ledger: [], rawPayload: {} },
      { workspaceRef, requestRef: "request-1", draftRef: "draft-1", expectedHeadHash: "GENESIS", ledger: [], actionAuthority: "execute" },
    ]) {
      await expect(adapter.stageDraft(malformed as never))
        .rejects.toEqual(expect.objectContaining<Partial<DecisionRoomDrizzleAdapterError>>({
          code: "invalid_binding",
        }));
    }
  });
});
