import { createHash } from "node:crypto";
import type { EffectiveCampaignContext } from "@/analyses/effective-campaign-context";
import { OBJECTIVE_PLAYBOOKS, OBJECTIVE_PLAYBOOK_VERSION } from "@/analyses/objective-playbooks";
import type { AnalysisMetric, CampaignObjective } from "@/analyses/schema";
import {
  validateResolvedAnalysisTimeframe,
  type ResolvedAnalysisTimeframe,
} from "@/analyses/timeframe-resolver";
import { inspectMetaPersistenceWrite } from "@/domain/meta/data-lifecycle";

export const ANALYSIS_AGENDA_VERSION = "analysis-agenda/1.0.0" as const;
export const ANALYSIS_PASS_ORDER = [
  "data_health",
  "account_objective",
  "category",
  "campaign",
  "ad_set",
  "ad",
  "creative",
  "budget_pacing",
  "history",
  "decision",
] as const;

export type AnalysisPassKey = typeof ANALYSIS_PASS_ORDER[number];

export type AnalysisAgendaSelectionRefs = Readonly<{
  categoryDimensionKeys: readonly string[];
  categoryDefinitionRefs: readonly string[];
  guidanceTopics: readonly string[];
}>;

export type AnalysisAgendaPass = Readonly<{
  passId: string;
  key: AnalysisPassKey;
  ordinal: number;
  direction: "top_down";
  requiredMetrics: readonly AnalysisMetric[];
  blockers: readonly string[];
  selectionRefs: AnalysisAgendaSelectionRefs;
}>;

export type AnalysisAgenda = Readonly<{
  contractVersion: typeof ANALYSIS_AGENDA_VERSION;
  agendaId: string;
  agendaHash: string;
  contextHash: string;
  objective: CampaignObjective | null;
  objectivePlaybookVersion: typeof OBJECTIVE_PLAYBOOK_VERSION;
  resolvedTimeframe: ResolvedAnalysisTimeframe;
  selectionRefs: AnalysisAgendaSelectionRefs;
  passes: readonly AnalysisAgendaPass[];
  driverBudget: Readonly<{ maxDepth: 2; maxDriversPerFinding: 3 }>;
  capabilities: Readonly<{
    containsRawData: false;
    canAuthorizeAction: false;
    canExecuteWrite: false;
  }>;
}>;

export class AnalysisAgendaError extends Error {
  constructor(readonly code: "invalid_input" | "inauthentic_context" | "forbidden_material") {
    super(`Analysis agenda oluşturulamadı: ${code}`);
    this.name = "AnalysisAgendaError";
  }
}

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
    throw new AnalysisAgendaError("forbidden_material");
  }
}

function authenticContext(context: EffectiveCampaignContext): boolean {
  const { contextHash, ...core } = context;
  return /^[a-f0-9]{64}$/.test(contextHash) && digest(core) === contextHash;
}

function uniqueMetrics(values: readonly AnalysisMetric[]): readonly AnalysisMetric[] {
  return Object.freeze([...new Set(values)].sort(compareText));
}

function normalizeRequestedKeys(values: readonly string[], limit: number): readonly string[] {
  if (values.length > limit * 2) throw new AnalysisAgendaError("invalid_input");
  const normalized = [...new Set(values.map((value) => value.trim()))].sort(compareText);
  if (normalized.length > limit || normalized.some((value) => !value || value.length > 128)) {
    throw new AnalysisAgendaError("invalid_input");
  }
  return Object.freeze(normalized);
}

function selectionRefs(
  context: EffectiveCampaignContext,
  selection: Readonly<{
    categoryDimensionKeys?: readonly string[];
    categoryDefinitions?: readonly Readonly<{ dimensionKey: string; definitionKey: string }>[];
    guidanceTopics?: readonly string[];
  }> | undefined,
): AnalysisAgendaSelectionRefs {
  if (selection) exactKeys(selection, ["categoryDimensionKeys", "categoryDefinitions", "guidanceTopics"]);
  const availableDimensions = new Set(context.categories.map((category) => category.dimension.key));
  const availableDefinitions = new Set(context.categories.flatMap((category) => (
    category.effectiveDefinitions.map((definition) => `${category.dimension.key}:${definition.key}`)
  )));
  const availableTopics = new Set(context.guidance.applied.map((card) => card.topic));

  const categoryDimensionKeys = selection?.categoryDimensionKeys === undefined
    ? [...availableDimensions].sort(compareText)
    : normalizeRequestedKeys(selection.categoryDimensionKeys, 32);
  const selectedDimensions = new Set(categoryDimensionKeys);
  if ((selection?.categoryDefinitions?.length ?? 0) > 256) {
    throw new AnalysisAgendaError("invalid_input");
  }
  const requestedDefinitions = selection?.categoryDefinitions === undefined
    ? [...availableDefinitions]
      .filter((ref) => selectedDimensions.has(ref.slice(0, ref.indexOf(":"))))
      .sort(compareText)
    : normalizeRequestedKeys(selection.categoryDefinitions.map((definition) => {
      exactKeys(definition, ["dimensionKey", "definitionKey"]);
      return `${definition.dimensionKey.trim()}:${definition.definitionKey.trim()}`;
    }), 128);
  const guidanceTopics = selection?.guidanceTopics === undefined
    ? [...availableTopics].sort(compareText)
    : normalizeRequestedKeys(selection.guidanceTopics, 64);
  if (categoryDimensionKeys.some((key) => !availableDimensions.has(key))
    || requestedDefinitions.some((ref) => !availableDefinitions.has(ref))
    || requestedDefinitions.some((ref) => !selectedDimensions.has(ref.slice(0, ref.indexOf(":"))))
    || guidanceTopics.some((topic) => !availableTopics.has(topic))) {
    throw new AnalysisAgendaError("invalid_input");
  }
  return Object.freeze({
    categoryDimensionKeys: Object.freeze(categoryDimensionKeys),
    categoryDefinitionRefs: Object.freeze(requestedDefinitions),
    guidanceTopics: Object.freeze(guidanceTopics),
  });
}

function metricsFor(pass: AnalysisPassKey, objective: CampaignObjective | null): readonly AnalysisMetric[] {
  const playbook = objective === null ? null : OBJECTIVE_PLAYBOOKS[objective];
  if (pass === "data_health" || pass === "category" || pass === "history") return [];
  if (pass === "account_objective") return uniqueMetrics(playbook?.guardrailMetrics ?? ["spendMinor"]);
  if (pass === "campaign" || pass === "decision") {
    return uniqueMetrics([
      ...(playbook?.primaryMetrics ?? []),
      ...(playbook?.diagnosticMetrics ?? []),
      ...(playbook?.guardrailMetrics ?? ["spendMinor"]),
    ]);
  }
  if (pass === "budget_pacing") {
    return uniqueMetrics(["spendMinor", ...(playbook?.primaryMetrics ?? [])]);
  }
  return uniqueMetrics(playbook?.diagnosticMetrics ?? []);
}

function blockersFor(pass: AnalysisPassKey, context: EffectiveCampaignContext): readonly string[] {
  const blockers: string[] = [];
  if (pass === "data_health") {
    if (context.data.trustStatus !== "ready") blockers.push(`trust_${context.data.trustStatus}`);
    blockers.push(...context.data.blockers);
  }
  if (pass === "account_objective" && context.meta.objective.state === "unknown") {
    blockers.push(`objective_unknown:${context.meta.objective.reason}`);
  }
  if (pass === "category" && context.categories.length === 0) blockers.push("category_context_missing");
  if (pass === "decision") {
    if (context.guidance.conflicting.length > 0) blockers.push("guidance_conflict_unresolved");
    if (context.cadence.decision !== "eligible") blockers.push(`cadence_${context.cadence.decision}`);
  }
  return Object.freeze([...new Set(blockers)].sort(compareText));
}

/** Produces the immutable top-down pass plan; no model, network, raw data or writer is reachable here. */
export function buildAnalysisAgenda(input: Readonly<{
  context: EffectiveCampaignContext;
  resolvedTimeframe: ResolvedAnalysisTimeframe;
  requestedPasses?: readonly AnalysisPassKey[];
  selection?: Readonly<{
    categoryDimensionKeys?: readonly string[];
    categoryDefinitions?: readonly Readonly<{ dimensionKey: string; definitionKey: string }>[];
    guidanceTopics?: readonly string[];
  }>;
}>): AnalysisAgenda {
  exactKeys(input, ["context", "resolvedTimeframe", "requestedPasses", "selection"]);
  if (!inspectMetaPersistenceWrite(input).compliant) throw new AnalysisAgendaError("forbidden_material");
  if (!authenticContext(input.context)) throw new AnalysisAgendaError("inauthentic_context");
  if (input.context.capabilities.canAuthorizeAction || input.context.capabilities.canExecuteWrite) {
    throw new AnalysisAgendaError("forbidden_material");
  }
  validateResolvedAnalysisTimeframe(input.resolvedTimeframe);
  const requested = input.requestedPasses ?? ANALYSIS_PASS_ORDER;
  if (requested.length === 0 || new Set(requested).size !== requested.length
    || requested.some((pass) => !(ANALYSIS_PASS_ORDER as readonly string[]).includes(pass))) {
    throw new AnalysisAgendaError("invalid_input");
  }
  const selected = new Set(requested);
  const resolvedSelection = selectionRefs(input.context, input.selection);
  const objective = input.context.meta.objective.state === "known" ? input.context.meta.objective.value : null;
  const passes = ANALYSIS_PASS_ORDER.filter((key) => selected.has(key)).map((key) => {
    const ordinal = ANALYSIS_PASS_ORDER.indexOf(key) + 1;
    const canonical = {
      key,
      ordinal,
      direction: "top_down" as const,
      requiredMetrics: metricsFor(key, objective),
      blockers: blockersFor(key, input.context),
      selectionRefs: resolvedSelection,
    };
    return Object.freeze({ passId: `pass_${digest(canonical).slice(0, 20)}`, ...canonical });
  });
  const core = {
    contractVersion: ANALYSIS_AGENDA_VERSION,
    contextHash: input.context.contextHash,
    objective,
    objectivePlaybookVersion: OBJECTIVE_PLAYBOOK_VERSION,
    resolvedTimeframe: input.resolvedTimeframe,
    selectionRefs: resolvedSelection,
    passes: Object.freeze(passes),
    driverBudget: { maxDepth: 2 as const, maxDriversPerFinding: 3 as const },
    capabilities: { containsRawData: false as const, canAuthorizeAction: false as const, canExecuteWrite: false as const },
  };
  const agendaHash = digest(core);
  return Object.freeze({
    ...core,
    agendaHash,
    agendaId: `agenda_${agendaHash.slice(0, 24)}`,
  });
}
