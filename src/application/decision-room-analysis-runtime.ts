import { createHash } from "node:crypto";
import { buildAnalysisAgenda, type AnalysisAgenda, type AnalysisPassKey } from "@/analyses/agenda";
import { analyze } from "@/analyses/deterministic-analysis";
import type { EffectiveCampaignContext } from "@/analyses/effective-campaign-context";
import {
  calculateDeterministicFinding,
  type FindingCalculatorSpec,
  type FindingEntityType,
} from "@/analyses/finding-calculators";
import {
  buildFindingObservationPlan,
} from "@/analyses/finding-observation-builder";
import type { FindingObservation } from "@/analyses/finding-calculators";
import type { FindingHierarchyNode, FindingMetricBundle } from "@/analyses/finding-engine";
import type { ResolvedAnalysisTimeframe } from "@/analyses/timeframe-resolver";
import { validateResolvedAnalysisTimeframe } from "@/analyses/timeframe-resolver";
import type { DeterministicFeatureSnapshot } from "@/analyses/deterministic-feature-snapshot";
import type { DeterministicWindowSnapshot } from "@/analyses/deterministic-window-snapshot";
import { runDecisionRoom, type DecisionRoomDraftPort } from "@/application/decision-room";
import type { DecisionRoomAnalysisPort } from "@/domain/decisions/executor";
import {
  evaluateDecisionCadence,
  type DecisionCadenceProfile,
  type DecisionDisposition,
} from "@/domain/decisions/cadence";
import { inspectMetaPersistenceWrite } from "@/domain/meta/data-lifecycle";
import {
  META_METRIC_FORMULA_CATALOG_VERSION,
  type MetaAggregatedMetric,
  type MetaMetricAggregationResult,
} from "@/domain/meta/insights/metric-engine";

export const DECISION_ROOM_ANALYSIS_RUNTIME_VERSION = "decision-room-analysis-runtime/1.0.0" as const;

export type DecisionRoomAnalysisRuntimeCheck = Readonly<{
  checkKey: string;
  passKey: AnalysisPassKey;
  entityRef: string;
  entityType: FindingEntityType;
  parentEntityRef: string | null;
  hierarchyPathRefs: readonly string[];
  driverEvidenceRefs: readonly string[];
  /** Server-private Meta external ID. It is never copied to a result or ledger. */
  externalEntityId: string;
  metaConnectionId: string;
  adAccountId: string;
  attributionLabel: string;
  expectedCurrency: string | null;
  spec: FindingCalculatorSpec;
  maxRowsPerQuery: number;
  /** Exact L2 snapshot refs frozen by the persisted asset loader for this check. */
  expectedSnapshotRefs: readonly string[];
}>;

export type DecisionRoomAnalysisRuntimeAssets = Readonly<{
  version: typeof DECISION_ROOM_ANALYSIS_RUNTIME_VERSION;
  workspaceRef: string;
  accountRef: string;
  campaignRef: string;
  timeframeRef: string;
  templateRef: string;
  occurredAt: string;
  context: EffectiveCampaignContext;
  resolvedTimeframe: ResolvedAnalysisTimeframe;
  requestedPasses: readonly AnalysisPassKey[];
  /** Exact immutable agenda persisted with this claimed run's analysis assets. */
  agenda: AnalysisAgenda;
  hierarchy: readonly FindingHierarchyNode[];
  checks: readonly DecisionRoomAnalysisRuntimeCheck[];
  cadence: Readonly<{
    profile: DecisionCadenceProfile;
    observationStartedAt: string;
    lastMaterialChangeAt: string | null;
    learning: Readonly<{ state: "not_applicable" | "active" | "exited"; startedAt: string | null }>;
    lastDecision: Readonly<{ disposition: DecisionDisposition; decidedAt: string; evidenceHash: string }> | null;
    recentDecisions: readonly Readonly<{ disposition: DecisionDisposition; decidedAt: string }>[];
    requestedDisposition: "act" | "test";
    emergencyGuardrail: Readonly<{ breached: boolean; evidenceRef: string | null }>;
  }>;
}>;

/**
 * This port is deliberately not implemented with a fallback fixture. Production
 * composition must load a published template/timeframe and its exact frozen
 * context from persistence, bound to the already-claimed run.
 */
export type DecisionRoomAnalysisRuntimeAssetPort = Readonly<{
  loadExact(input: Readonly<{
    runRef: string;
    workspaceRef: string;
    accountRef: string;
    campaignRef: string;
    timeframeRef: string;
    templateRef: string;
    triggerKind: "manual" | "scheduled";
  }>): Promise<DecisionRoomAnalysisRuntimeAssets>;
}>;

/**
 * Private evidence reader used before a run can consume its frozen context.
 * It deliberately reads the exact L2/L3 refs already frozen in that context;
 * it has no L1/Meta transport and never selects a replacement snapshot.
 */
export type DecisionRoomFrozenEvidencePort = Readonly<{
  loadFeature(input: Readonly<{ workspaceId: string; featureRef: string }>): Promise<Readonly<{
    state: "ready" | "stale"; feature: DeterministicFeatureSnapshot;
  }>>;
  loadWindow(input: Readonly<{ workspaceId: string; windowRef: string }>): Promise<Readonly<{
    state: "ready" | "stale"; window: DeterministicWindowSnapshot;
  }>>;
}>;

export class DecisionRoomAnalysisRuntimeError extends Error {
  constructor(readonly code:
    | "invalid_input"
    | "asset_not_bound"
    | "forbidden_material"
    | "evidence_not_frozen"
    | "runtime_failure") {
    super(`Decision Room deterministic runtime güvenli biçimde çalıştırılamadı: ${code}`);
    this.name = "DecisionRoomAnalysisRuntimeError";
  }
}

const MAX_CHECKS = 100;
const REF = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const PASSES: readonly AnalysisPassKey[] = [
  "data_health", "account_objective", "category", "campaign", "ad_set", "ad", "creative",
  "budget_pacing", "history", "decision",
];

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compare(left, right))
      .map(([key, child]) => [key, stable(child)]));
  }
  return value;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function exact(value: unknown, keys: readonly string[], code: DecisionRoomAnalysisRuntimeError["code"]): void {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length
    || Object.keys(value).some((key) => !keys.includes(key))) {
    throw new DecisionRoomAnalysisRuntimeError(code);
  }
}

function ref(value: unknown): string {
  if (typeof value !== "string" || !REF.test(value)) throw new DecisionRoomAnalysisRuntimeError("invalid_input");
  return value;
}

export function validateDecisionRoomAnalysisRuntimeAssets(
  input: Parameters<DecisionRoomAnalysisPort["execute"]>[0],
  assets: DecisionRoomAnalysisRuntimeAssets,
): void {
  exact(assets, [
    "version", "workspaceRef", "accountRef", "campaignRef", "timeframeRef", "templateRef",
    "occurredAt", "context", "resolvedTimeframe", "requestedPasses", "agenda", "hierarchy", "checks", "cadence",
  ], "asset_not_bound");
  if (assets.version !== DECISION_ROOM_ANALYSIS_RUNTIME_VERSION
    || assets.workspaceRef !== input.workspaceRef || assets.accountRef !== input.accountRef
    || assets.campaignRef !== input.campaignRef || assets.timeframeRef !== input.timeframeRef
    || assets.templateRef !== input.templateRef || !Number.isFinite(Date.parse(assets.occurredAt))) {
    throw new DecisionRoomAnalysisRuntimeError("asset_not_bound");
  }
  if (!inspectMetaPersistenceWrite(assets).compliant) {
    throw new DecisionRoomAnalysisRuntimeError("forbidden_material");
  }
  try {
    validateResolvedAnalysisTimeframe(assets.resolvedTimeframe);
  } catch {
    throw new DecisionRoomAnalysisRuntimeError("asset_not_bound");
  }
  if (assets.context.identity.accountRef !== input.accountRef
    || assets.context.identity.campaignRef !== input.campaignRef
    || assets.context.identity.entityRef !== input.campaignRef
    || assets.context.identity.entityType !== "campaign"
    || !Array.isArray(assets.requestedPasses) || !Array.isArray(assets.hierarchy)
    || !Array.isArray(assets.checks) || assets.checks.length < 1 || assets.checks.length > MAX_CHECKS) {
    throw new DecisionRoomAnalysisRuntimeError("asset_not_bound");
  }
  if (assets.context.data.trustStatus !== "ready" || assets.context.data.blockers.length !== 0
    || assets.context.data.featureRefs.length === 0 || assets.context.data.windowRefs.length === 0
    || assets.context.data.featureRefs.some((featureRef) => !/^feature_[a-f0-9]{24}$/.test(featureRef))
    || assets.context.data.windowRefs.some((windowRef) => !/^window_[a-f0-9]{24}$/.test(windowRef))) {
    throw new DecisionRoomAnalysisRuntimeError("asset_not_bound");
  }
  if (assets.requestedPasses.length < 1 || new Set(assets.requestedPasses).size !== assets.requestedPasses.length
    || assets.requestedPasses.some((pass) => !PASSES.includes(pass))) {
    throw new DecisionRoomAnalysisRuntimeError("asset_not_bound");
  }
  try {
    const expectedAgenda = buildAnalysisAgenda({
      context: assets.context,
      resolvedTimeframe: assets.resolvedTimeframe,
      requestedPasses: assets.requestedPasses,
    });
    if (JSON.stringify(stable(assets.agenda)) !== JSON.stringify(stable(expectedAgenda))) {
      throw new Error("agenda mismatch");
    }
  } catch {
    throw new DecisionRoomAnalysisRuntimeError("asset_not_bound");
  }
  const hierarchy = new Map(assets.hierarchy.map((node) => [node.entityRef, node]));
  if (hierarchy.size !== assets.hierarchy.length) throw new DecisionRoomAnalysisRuntimeError("asset_not_bound");
  for (const node of assets.hierarchy) {
    exact(node, ["entityRef", "entityType", "parentEntityRef"], "asset_not_bound");
    ref(node.entityRef);
  }
  const identities = new Set<string>();
  for (const check of assets.checks) {
    exact(check, [
      "checkKey", "passKey", "entityRef", "entityType", "parentEntityRef", "hierarchyPathRefs",
      "driverEvidenceRefs", "externalEntityId", "metaConnectionId", "adAccountId", "attributionLabel",
      "expectedCurrency", "spec", "maxRowsPerQuery", "expectedSnapshotRefs",
    ], "asset_not_bound");
    const node = hierarchy.get(check.entityRef);
    const identity = `${check.entityRef}\u0000${check.checkKey}\u0000${check.spec.metric}`;
    if (!node || node.entityType !== check.entityType || node.parentEntityRef !== check.parentEntityRef
      || check.adAccountId.length === 0 || check.metaConnectionId.length === 0
      || !REF.test(check.checkKey) || !REF.test(check.externalEntityId)
      || !assets.requestedPasses.includes(check.passKey) || identities.has(identity)
      || !Array.isArray(check.expectedSnapshotRefs) || check.expectedSnapshotRefs.length < 1
      || new Set(check.expectedSnapshotRefs).size !== check.expectedSnapshotRefs.length
      || check.expectedSnapshotRefs.some((snapshot: string) => !REF.test(snapshot)
        || !assets.context.data.snapshotRefs.includes(snapshot))) {
      throw new DecisionRoomAnalysisRuntimeError("asset_not_bound");
    }
    identities.add(identity);
    try {
      buildFindingObservationPlan({
        workspaceId: assets.context.workspaceId,
        metaConnectionId: check.metaConnectionId,
        adAccountId: check.adAccountId,
        entityLevel: check.entityType,
        externalEntityId: check.externalEntityId,
        attributionLabel: check.attributionLabel,
        expectedCurrency: check.expectedCurrency,
        timeframe: assets.resolvedTimeframe,
        spec: check.spec,
        maxRowsPerQuery: check.maxRowsPerQuery,
      });
      // The materialization planner validates read bounds; the calculator owns
      // the complete spec/entity/hierarchy contract. An empty observation set
      // is sufficient to validate that contract without performing I/O.
      calculateDeterministicFinding({
        entityRef: check.entityRef,
        entityType: check.entityType,
        parentEntityRef: check.parentEntityRef,
        hierarchyPathRefs: check.hierarchyPathRefs,
        driverEvidenceRefs: check.driverEvidenceRefs,
        timeframe: assets.resolvedTimeframe,
        spec: check.spec,
        observations: [],
      });
    } catch {
      throw new DecisionRoomAnalysisRuntimeError("asset_not_bound");
    }
  }
  exact(assets.cadence, [
    "profile", "observationStartedAt", "lastMaterialChangeAt", "learning", "lastDecision",
    "recentDecisions", "requestedDisposition", "emergencyGuardrail",
  ], "asset_not_bound");
  try {
    evaluateDecisionCadence({
      ...assets.cadence,
      now: new Date(assets.occurredAt).toISOString(),
      evidence: { refs: ["runtime_validation"], score: 1 },
      recommendationSource: "deterministic_policy",
    });
  } catch {
    throw new DecisionRoomAnalysisRuntimeError("asset_not_bound");
  }
}

function mergeMetricBundles(
  entries: readonly Readonly<{ entityRef: string; results: readonly MetaMetricAggregationResult[] }>[],
): readonly FindingMetricBundle[] {
  return Object.freeze(entries.map(({ entityRef, results }) => {
    const metrics = new Map<string, MetaAggregatedMetric>();
    for (const result of results) {
      if (result.catalogVersion !== META_METRIC_FORMULA_CATALOG_VERSION) {
        throw new DecisionRoomAnalysisRuntimeError("runtime_failure");
      }
      for (const metric of result.metrics) {
        const existing = metrics.get(metric.metric);
        if (existing && JSON.stringify(stable(existing)) !== JSON.stringify(stable(metric))) {
          throw new DecisionRoomAnalysisRuntimeError("runtime_failure");
        }
        metrics.set(metric.metric, metric);
      }
    }
    const normalized = [...metrics.values()].sort((left, right) => compare(left.metric, right.metric));
    const core = { catalogVersion: META_METRIC_FORMULA_CATALOG_VERSION, metrics: Object.freeze(normalized) };
    return Object.freeze({ entityRef, result: Object.freeze({ ...core, resultHash: digest(core) }) });
  }));
}

async function revalidateFrozenEvidence(
  context: EffectiveCampaignContext,
  evidence: DecisionRoomFrozenEvidencePort,
): Promise<readonly DeterministicFeatureSnapshot[]> {
  const features = await Promise.all(context.data.featureRefs.map((featureRef) => evidence.loadFeature({ workspaceId: context.workspaceId, featureRef })));
  const windows = await Promise.all(context.data.windowRefs.map((windowRef) => evidence.loadWindow({ workspaceId: context.workspaceId, windowRef })));
  if (features.some((entry) => entry.state !== "ready" || entry.feature.scope.workspaceId !== context.workspaceId)
    || windows.some((entry) => entry.state !== "ready" || entry.window.scope.workspaceId !== context.workspaceId)) {
    throw new DecisionRoomAnalysisRuntimeError("evidence_not_frozen");
  }
  const frozenFeatures = new Set(context.data.featureRefs);
  const covered = new Set<string>();
  for (const entry of windows) {
    if (entry.window.featureRefs.some((featureRef) => !frozenFeatures.has(featureRef))) {
      throw new DecisionRoomAnalysisRuntimeError("evidence_not_frozen");
    }
    entry.window.featureRefs.forEach((featureRef) => covered.add(featureRef));
  }
  if (covered.size !== frozenFeatures.size || [...frozenFeatures].some((featureRef) => !covered.has(featureRef))) {
    throw new DecisionRoomAnalysisRuntimeError("evidence_not_frozen");
  }
  return Object.freeze(features.map((entry) => entry.feature));
}

function observationFromFrozenFeature(feature: DeterministicFeatureSnapshot): FindingObservation {
  return Object.freeze({
    observationRef: feature.observationRef, role: feature.role, startDate: feature.startDate, endDate: feature.endDate,
    timezone: feature.timezone, sampleSize: feature.sampleSize, settled: feature.settled,
    qualityStatus: feature.qualityStatus, qualityReasonCodes: feature.qualityReasonCodes,
    metricResult: feature.metricResult, snapshotRefs: feature.sourceSnapshotRefs,
  });
}

/**
 * Deterministic AnalysisPort used by both manual executor calls and schedule ticks.
 * It performs no model, Meta network/write, authority or external notification call.
 */
export class DecisionRoomDeterministicAnalysisRuntime implements DecisionRoomAnalysisPort {
  constructor(
    private readonly assets: DecisionRoomAnalysisRuntimeAssetPort,
    private readonly frozenEvidence: DecisionRoomFrozenEvidencePort,
    private readonly drafts: DecisionRoomDraftPort,
  ) {}

  async execute(input: Parameters<DecisionRoomAnalysisPort["execute"]>[0]) {
    exact(input, [
      "runRef", "workspaceRef", "accountRef", "campaignRef", "timeframeRef", "templateRef",
      "triggerKind", "actionAuthority",
    ], "invalid_input");
    if (input.actionAuthority !== "none") throw new DecisionRoomAnalysisRuntimeError("forbidden_material");
    ref(input.runRef);
    let prepared: DecisionRoomAnalysisRuntimeAssets;
    try {
      prepared = await this.assets.loadExact({
        runRef: input.runRef,
        workspaceRef: input.workspaceRef,
        accountRef: input.accountRef,
        campaignRef: input.campaignRef,
        timeframeRef: input.timeframeRef,
        templateRef: input.templateRef,
        triggerKind: input.triggerKind,
      });
    } catch (error) {
      if (error instanceof DecisionRoomAnalysisRuntimeError) throw error;
      throw new DecisionRoomAnalysisRuntimeError("asset_not_bound");
    }
    validateDecisionRoomAnalysisRuntimeAssets(input, prepared);
    let frozenFeatures: readonly DeterministicFeatureSnapshot[];
    try {
      frozenFeatures = await revalidateFrozenEvidence(prepared.context, this.frozenEvidence);
    } catch (error) {
      if (error instanceof DecisionRoomAnalysisRuntimeError) throw error;
      throw new DecisionRoomAnalysisRuntimeError("evidence_not_frozen");
    }

    const evaluated = [] as Array<Readonly<{
      check: DecisionRoomAnalysisRuntimeCheck;
      finding: ReturnType<typeof calculateDeterministicFinding>;
      metricResults: readonly MetaMetricAggregationResult[];
    }>>;
    for (const check of prepared.checks) {
      const observations = frozenFeatures
        .filter((feature) => feature.scope.externalEntityId === check.externalEntityId
          && feature.scope.entityLevel === check.entityType
          && feature.sourceSnapshotRefs.some((snapshotRef) => check.expectedSnapshotRefs.includes(snapshotRef)))
        .map(observationFromFrozenFeature);
      if (observations.length === 0) throw new DecisionRoomAnalysisRuntimeError("evidence_not_frozen");
      evaluated.push(Object.freeze({
        check,
        finding: calculateDeterministicFinding({
          entityRef: check.entityRef,
          entityType: check.entityType,
          parentEntityRef: check.parentEntityRef,
          hierarchyPathRefs: check.hierarchyPathRefs,
          driverEvidenceRefs: check.driverEvidenceRefs,
          timeframe: prepared.resolvedTimeframe,
          spec: check.spec,
          observations,
        }),
        metricResults: Object.freeze([(
          observations.find((observation) => observation.role === "primary")
          ?? observations.find((observation) => observation.role === "post")
          ?? observations.at(-1)
        )!.metricResult]),
      }));
      if (evaluated.at(-1)!.finding.evidence.snapshotRefs.some((snapshot) => !check.expectedSnapshotRefs.includes(snapshot))) {
        throw new DecisionRoomAnalysisRuntimeError("evidence_not_frozen");
      }
    }

    const evidenceRefs = [...new Set(evaluated.flatMap((entry) => entry.finding.evidence.snapshotRefs))].sort(compare);
    const frozenEvidence = new Set([...prepared.context.data.snapshotRefs, ...prepared.context.data.featureRefs]);
    if (evidenceRefs.length === 0 || evidenceRefs.some((entry) => !frozenEvidence.has(entry))) {
      throw new DecisionRoomAnalysisRuntimeError("evidence_not_frozen");
    }
    const analysis = analyze({
      definitionRef: prepared.templateRef,
      contextRef: prepared.context.contextHash,
      snapshotRefs: evidenceRefs,
      resolvedTimeframe: prepared.resolvedTimeframe,
      candidates: evaluated.map(({ check, finding }) => ({
        checkKey: check.checkKey,
        entityRef: check.entityRef,
        metricKey: check.spec.metric,
        status: finding.state === "finding" ? "finding" as const
          : finding.state === "clear" ? "clear" as const : "insufficient_data" as const,
        ...(finding.state === "finding" || finding.state === "clear"
          ? {} : { missingDataReason: finding.reasonCode }),
        sourceSnapshotRefs: finding.evidence.snapshotRefs,
      })),
    });
    const resultsByEntity = new Map<string, MetaMetricAggregationResult[]>();
    for (const item of evaluated) {
      resultsByEntity.set(item.check.entityRef, [
        ...(resultsByEntity.get(item.check.entityRef) ?? []), ...item.metricResults,
      ]);
    }
    const metricBundles = mergeMetricBundles([...resultsByEntity.entries()].map(([entityRef, results]) => ({ entityRef, results })));
    const passAssignments = analysis.records.map((record) => {
      const source = evaluated.find(({ check }) => check.entityRef === record.entityRef
        && check.checkKey === record.checkKey && check.spec.metric === record.metricKey);
      if (!source) throw new DecisionRoomAnalysisRuntimeError("runtime_failure");
      return Object.freeze({ recordId: record.recordId, passKey: source.check.passKey });
    });
    const decisive = evaluated.filter((entry) => entry.finding.state === "finding" || entry.finding.state === "clear").length;
    const room = await runDecisionRoom({
      workspaceRef: prepared.workspaceRef,
      occurredAt: new Date(prepared.occurredAt).toISOString(),
      context: prepared.context,
      resolvedTimeframe: prepared.resolvedTimeframe,
      agenda: { requestedPasses: prepared.requestedPasses },
      analysis,
      findingInput: { hierarchy: prepared.hierarchy, metricBundles, passAssignments },
      cadence: {
        ...prepared.cadence,
        now: new Date(prepared.occurredAt).toISOString(),
        evidenceScore: decisive / evaluated.length,
        recommendationSource: "deterministic_policy",
      },
    }, this.drafts);
    if (room.agendaRef !== prepared.agenda.agendaId) {
      throw new DecisionRoomAnalysisRuntimeError("asset_not_bound");
    }
    return Object.freeze({
      analysisRef: room.roomRunRef,
      evidenceRefs: Object.freeze(evaluated.map((entry) => entry.finding.findingRef).sort(compare)),
      summaryCode: `deterministic_${room.status}`,
    });
  }
}
