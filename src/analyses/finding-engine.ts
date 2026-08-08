import { createHash } from "node:crypto";
import type { AnalysisAgenda, AnalysisPassKey } from "@/analyses/agenda";
import type { DeterministicAnalysisRun, DeterministicAnalysisRecord } from "@/analyses/deterministic-analysis";
import type { EffectiveCampaignContext } from "@/analyses/effective-campaign-context";
import { ANALYSIS_METRICS, type AnalysisMetric } from "@/analyses/schema";
import { inspectMetaPersistenceWrite } from "@/domain/meta/data-lifecycle";
import {
  META_METRIC_FORMULA_CATALOG_VERSION,
  type MetaAggregatedMetric,
  type MetaMetricAggregationResult,
} from "@/domain/meta/insights/metric-engine";

export const DETERMINISTIC_FINDING_ENGINE_VERSION = "deterministic-finding-engine/1.0.0" as const;

export type FindingEntityType = "account" | "campaign" | "ad_set" | "ad" | "creative";
export type FindingHierarchyNode = Readonly<{
  entityRef: string;
  entityType: FindingEntityType;
  parentEntityRef: string | null;
}>;

export type FindingMetricBundle = Readonly<{
  entityRef: string;
  result: MetaMetricAggregationResult;
}>;

export type FindingPassAssignment = Readonly<{
  recordId: string;
  passKey: AnalysisPassKey;
}>;

export type DeterministicDriver = Readonly<{
  recordId: string;
  entityRef: string;
  entityType: FindingEntityType;
  depth: 1 | 2;
  metricKey: string;
}>;

export type DeterministicFinding = Readonly<{
  findingId: string;
  recordId: string;
  passKey: AnalysisPassKey;
  entityRef: string;
  entityType: FindingEntityType;
  checkKey: string;
  metricKey: string;
  state: "finding" | "insufficient_data";
  evidence: readonly Readonly<{
    metric: AnalysisMetric;
    metricStatus: "available" | "unknown" | "not_supplied";
    valueDecimal?: string;
    unknownReason?: string;
    metricResultHash?: string;
    snapshotRefs: readonly string[];
  }>[];
  blockers: readonly string[];
  drivers: readonly DeterministicDriver[];
  unresolvedReasons: readonly ("insufficient_data" | "driver_unresolved" | "guidance_conflict")[];
  suppression: Readonly<{
    findingVisible: true;
    proposalEligibility: "eligible" | "suppressed" | "not_applicable";
    reasons: readonly string[];
    guidanceCardRefs: readonly string[];
  }>;
}>;

export type DeterministicFindingRun = Readonly<{
  contractVersion: typeof DETERMINISTIC_FINDING_ENGINE_VERSION;
  findingRunId: string;
  findingRunHash: string;
  agendaId: string;
  contextHash: string;
  analysisRunId: string;
  findings: readonly DeterministicFinding[];
  capabilities: Readonly<{
    containsRawData: false;
    canAuthorizeAction: false;
    canExecuteWrite: false;
  }>;
}>;

export class DeterministicFindingEngineError extends Error {
  constructor(readonly code:
    | "invalid_input"
    | "inauthentic_component"
    | "scope_mismatch"
    | "forbidden_material") {
    super(`Deterministic finding üretilemedi: ${code}`);
    this.name = "DeterministicFindingEngineError";
  }
}

const ENTITY_ORDER: readonly FindingEntityType[] = ["account", "campaign", "ad_set", "ad", "creative"];

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareText(left, right))
      .map(([key, entry]) => [key, stableValue(entry)]));
  }
  return value;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function exactKeys(value: object, allowed: readonly string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new DeterministicFindingEngineError("forbidden_material");
  }
}

function authenticContext(context: EffectiveCampaignContext): boolean {
  const { contextHash, ...core } = context;
  return /^[a-f0-9]{64}$/.test(contextHash) && digest(core) === contextHash;
}

function authenticAgenda(agenda: AnalysisAgenda): boolean {
  const { agendaId, agendaHash, ...core } = agenda;
  return agendaId === `agenda_${agendaHash.slice(0, 24)}` && digest(core) === agendaHash;
}

function authenticAnalysis(run: DeterministicAnalysisRun): boolean {
  const { runId, ...core } = run;
  const hash = createHash("sha256").update(JSON.stringify(core)).digest("hex");
  return runId === `analysis_${hash.slice(0, 24)}`;
}

function authenticMetrics(result: MetaMetricAggregationResult): boolean {
  return result.catalogVersion === META_METRIC_FORMULA_CATALOG_VERSION
    && digest({ catalogVersion: result.catalogVersion, metrics: result.metrics }) === result.resultHash;
}

function passFor(entityType: FindingEntityType): AnalysisPassKey {
  return entityType === "account" ? "account_objective" : entityType;
}

function passAllowsEntity(pass: AnalysisPassKey, entityType: FindingEntityType): boolean {
  const allowed: Readonly<Record<AnalysisPassKey, readonly FindingEntityType[]>> = {
    data_health: ["account", "campaign"],
    account_objective: ["account", "campaign"],
    category: ["campaign"],
    campaign: ["campaign"],
    ad_set: ["ad_set"],
    ad: ["ad"],
    creative: ["creative"],
    budget_pacing: ["campaign", "ad_set"],
    history: ["campaign"],
    decision: ["campaign"],
  };
  return allowed[pass].includes(entityType);
}

function normalizeHierarchy(nodes: readonly FindingHierarchyNode[]): ReadonlyMap<string, FindingHierarchyNode> {
  const result = new Map<string, FindingHierarchyNode>();
  for (const node of nodes) {
    exactKeys(node, ["entityRef", "entityType", "parentEntityRef"]);
    if (!node.entityRef.trim() || !ENTITY_ORDER.includes(node.entityType) || result.has(node.entityRef)) {
      throw new DeterministicFindingEngineError("invalid_input");
    }
    result.set(node.entityRef, Object.freeze({ ...node }));
  }
  for (const node of result.values()) {
    if (node.parentEntityRef === null) {
      if (node.entityType !== "account" && node.entityType !== "campaign") {
        throw new DeterministicFindingEngineError("invalid_input");
      }
      continue;
    }
    const parent = result.get(node.parentEntityRef);
    if (!parent || ENTITY_ORDER.indexOf(node.entityType) !== ENTITY_ORDER.indexOf(parent.entityType) + 1) {
      throw new DeterministicFindingEngineError("invalid_input");
    }
  }
  return result;
}

function metricEvidence(
  record: DeterministicAnalysisRecord,
  bundle: FindingMetricBundle | undefined,
): DeterministicFinding["evidence"][number] {
  const metric = bundle?.result.metrics.find((entry) => entry.metric === record.metricKey) as MetaAggregatedMetric | undefined;
  const base = {
    metric: record.metricKey as AnalysisMetric,
    snapshotRefs: record.sourceSnapshotRefs,
    ...(bundle ? { metricResultHash: bundle.result.resultHash } : {}),
  };
  if (!metric) return Object.freeze({ ...base, metricStatus: "not_supplied" as const, unknownReason: "metric_not_supplied" });
  if (metric.status === "unknown") {
    return Object.freeze({ ...base, metricStatus: "unknown" as const, unknownReason: metric.reason });
  }
  return Object.freeze({ ...base, metricStatus: "available" as const, valueDecimal: metric.valueDecimal });
}

function descendants(
  parent: FindingHierarchyNode,
  hierarchy: ReadonlyMap<string, FindingHierarchyNode>,
  records: readonly DeterministicAnalysisRecord[],
  record: DeterministicAnalysisRecord,
  maxDepth: 2,
  maxDrivers: 3,
): Readonly<{ drivers: readonly DeterministicDriver[]; unresolved: boolean }> {
  const drivers: DeterministicDriver[] = [];
  let frontier = [parent.entityRef];
  let hadDescendants = false;
  for (let depth = 1 as 1 | 2; depth <= maxDepth; depth = (depth + 1) as 1 | 2) {
    const children = [...hierarchy.values()]
      .filter((node) => node.parentEntityRef !== null && frontier.includes(node.parentEntityRef))
      .sort((left, right) => compareText(left.entityRef, right.entityRef));
    if (children.length === 0) break;
    hadDescendants = true;
    const childRefs = new Set(children.map((node) => node.entityRef));
    const matches = records.filter((candidate) => (
      childRefs.has(candidate.entityRef)
      && candidate.checkKey === record.checkKey
      && candidate.metricKey === record.metricKey
      && candidate.status === "finding"
    )).sort((left, right) => compareText(left.entityRef, right.entityRef));
    for (const match of matches) {
      const node = hierarchy.get(match.entityRef)!;
      if (drivers.length < maxDrivers) drivers.push(Object.freeze({
        recordId: match.recordId,
        entityRef: match.entityRef,
        entityType: node.entityType,
        depth,
        metricKey: match.metricKey,
      }));
    }
    if (drivers.length >= maxDrivers) break;
    frontier = children.map((node) => node.entityRef);
  }
  const canHaveDriver = ENTITY_ORDER.indexOf(parent.entityType) < ENTITY_ORDER.indexOf("creative");
  return Object.freeze({ drivers: Object.freeze(drivers), unresolved: canHaveDriver && (!hadDescendants || drivers.length === 0) });
}

/** Deterministic top-down findings with bounded, finding-triggered bottom-up driver lookup. */
export function buildDeterministicFindings(input: Readonly<{
  agenda: AnalysisAgenda;
  context: EffectiveCampaignContext;
  analysis: DeterministicAnalysisRun;
  hierarchy: readonly FindingHierarchyNode[];
  metricBundles: readonly FindingMetricBundle[];
  passAssignments?: readonly FindingPassAssignment[];
}>): DeterministicFindingRun {
  exactKeys(input, ["agenda", "context", "analysis", "hierarchy", "metricBundles", "passAssignments"]);
  if (!inspectMetaPersistenceWrite(input).compliant) throw new DeterministicFindingEngineError("forbidden_material");
  if (!authenticAgenda(input.agenda) || !authenticContext(input.context) || !authenticAnalysis(input.analysis)) {
    throw new DeterministicFindingEngineError("inauthentic_component");
  }
  if (input.agenda.contextHash !== input.context.contextHash
    || input.analysis.contextRef !== input.context.contextHash
    || input.analysis.runId.length === 0) {
    throw new DeterministicFindingEngineError("scope_mismatch");
  }
  if (digest(input.agenda.resolvedTimeframe) !== digest(input.analysis.resolvedTimeframe)) {
    throw new DeterministicFindingEngineError("scope_mismatch");
  }
  // L0/L1 source snapshots and frozen L2 feature snapshots are both valid
  // evidence roots. Runtime analysis must never introduce a ref that was not
  // frozen into the authentic campaign context.
  const allowedSnapshots = new Set([
    ...input.context.data.snapshotRefs,
    ...input.context.data.featureRefs,
  ]);
  if (input.analysis.snapshotRefs.some((ref) => !allowedSnapshots.has(ref))) {
    throw new DeterministicFindingEngineError("scope_mismatch");
  }
  const hierarchy = normalizeHierarchy(input.hierarchy);
  const selectedCampaign = hierarchy.get(input.context.identity.campaignRef);
  if (!selectedCampaign || selectedCampaign.entityType !== "campaign") {
    throw new DeterministicFindingEngineError("scope_mismatch");
  }
  for (const node of hierarchy.values()) {
    if (node.entityType === "account" && node.entityRef !== input.context.identity.accountRef) {
      throw new DeterministicFindingEngineError("scope_mismatch");
    }
    if (node.entityType === "campaign" && node.entityRef !== input.context.identity.campaignRef) {
      throw new DeterministicFindingEngineError("scope_mismatch");
    }
    let cursor: FindingHierarchyNode | undefined = node;
    const visited = new Set<string>();
    while (cursor?.parentEntityRef !== null) {
      if (visited.has(cursor.entityRef)) throw new DeterministicFindingEngineError("invalid_input");
      visited.add(cursor.entityRef);
      cursor = hierarchy.get(cursor.parentEntityRef);
      if (!cursor) throw new DeterministicFindingEngineError("invalid_input");
    }
    if (node.entityType !== "account" && cursor?.entityRef !== input.context.identity.campaignRef
      && cursor?.entityRef !== input.context.identity.accountRef) {
      throw new DeterministicFindingEngineError("scope_mismatch");
    }
  }
  const bundles = new Map<string, FindingMetricBundle>();
  for (const bundle of input.metricBundles) {
    exactKeys(bundle, ["entityRef", "result"]);
    if (!hierarchy.has(bundle.entityRef) || bundles.has(bundle.entityRef) || !authenticMetrics(bundle.result)) {
      throw new DeterministicFindingEngineError("inauthentic_component");
    }
    bundles.set(bundle.entityRef, bundle);
  }
  const enabledPasses = new Set(input.agenda.passes.map((pass) => pass.key));
  const passAssignments = new Map<string, AnalysisPassKey>();
  for (const assignment of input.passAssignments ?? []) {
    exactKeys(assignment, ["recordId", "passKey"]);
    if (passAssignments.has(assignment.recordId) || !enabledPasses.has(assignment.passKey)
      || !input.analysis.records.some((record) => record.recordId === assignment.recordId)) {
      throw new DeterministicFindingEngineError("invalid_input");
    }
    passAssignments.set(assignment.recordId, assignment.passKey);
  }
  const records = input.analysis.records.filter((record) => record.status !== "clear");
  const findings: DeterministicFinding[] = [];
  for (const record of records) {
    if (!(ANALYSIS_METRICS as readonly string[]).includes(record.metricKey)) {
      throw new DeterministicFindingEngineError("invalid_input");
    }
    const node = hierarchy.get(record.entityRef);
    if (!node) throw new DeterministicFindingEngineError("scope_mismatch");
    const passKey = passAssignments.get(record.recordId) ?? passFor(node.entityType);
    if (!passAllowsEntity(passKey, node.entityType)) throw new DeterministicFindingEngineError("invalid_input");
    if (!enabledPasses.has(passKey)) continue;
    const evidence = metricEvidence(record, bundles.get(record.entityRef));
    const blockers = new Set<string>();
    const unresolved = new Set<DeterministicFinding["unresolvedReasons"][number]>();
    if (record.status === "insufficient_data") {
      blockers.add(record.missingDataReason!);
      unresolved.add("insufficient_data");
    }
    if (evidence.metricStatus !== "available") {
      blockers.add(evidence.unknownReason ?? "metric_unavailable");
      unresolved.add("insufficient_data");
    }
    const driver = record.status === "finding"
      ? descendants(node, hierarchy, input.analysis.records, record,
        input.agenda.driverBudget.maxDepth, input.agenda.driverBudget.maxDriversPerFinding)
      : { drivers: [] as readonly DeterministicDriver[], unresolved: false };
    if (driver.unresolved) unresolved.add("driver_unresolved");
    if (input.context.guidance.conflicting.length > 0) unresolved.add("guidance_conflict");

    const protectedCards = input.context.guidance.applied.filter((card) => (
      (card.strength === "must" || card.strength === "avoid")
      && (card.topic === record.checkKey || card.topic === record.metricKey || (passKey === "budget_pacing" && card.topic === "budget"))
    )).map((card) => card.cardId).sort(compareText);
    const suppressionReasons: string[] = [];
    if (protectedCards.length > 0) suppressionReasons.push("protected_guidance");
    if (input.context.cadence.decision !== "eligible") suppressionReasons.push(`cadence_${input.context.cadence.decision}`);
    if (unresolved.size > 0) suppressionReasons.push("unresolved_reason");
    const state = record.status === "finding" ? "finding" as const : "insufficient_data" as const;
    const proposalEligibility = state === "insufficient_data" ? "not_applicable" as const
      : suppressionReasons.length > 0 ? "suppressed" as const : "eligible" as const;
    const canonical: Omit<DeterministicFinding, "findingId"> = {
      recordId: record.recordId,
      passKey,
      entityRef: record.entityRef,
      entityType: node.entityType,
      checkKey: record.checkKey,
      metricKey: record.metricKey,
      state,
      evidence: Object.freeze([evidence]),
      blockers: [...blockers].sort(compareText),
      drivers: driver.drivers,
      unresolvedReasons: [...unresolved].sort(compareText),
      suppression: {
        findingVisible: true as const,
        proposalEligibility,
        reasons: [...new Set(suppressionReasons)].sort(compareText),
        guidanceCardRefs: protectedCards,
      },
    };
    findings.push(Object.freeze({ findingId: `finding_${digest(canonical).slice(0, 24)}`, ...canonical }));
  }
  findings.sort((left, right) => (
      input.agenda.passes.findIndex((pass) => pass.key === left.passKey)
      - input.agenda.passes.findIndex((pass) => pass.key === right.passKey)
      || compareText(left.entityRef, right.entityRef)
      || compareText(left.checkKey, right.checkKey)
      || compareText(left.metricKey, right.metricKey)
  ));
  const core = {
    contractVersion: DETERMINISTIC_FINDING_ENGINE_VERSION,
    agendaId: input.agenda.agendaId,
    contextHash: input.context.contextHash,
    analysisRunId: input.analysis.runId,
    findings: Object.freeze(findings),
    capabilities: { containsRawData: false as const, canAuthorizeAction: false as const, canExecuteWrite: false as const },
  };
  const findingRunHash = digest(core);
  return Object.freeze({
    ...core,
    findingRunHash,
    findingRunId: `finding_run_${findingRunHash.slice(0, 24)}`,
  });
}
