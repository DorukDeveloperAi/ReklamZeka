import { createHash } from "node:crypto";
import type { AnalysisAgenda } from "@/analyses/agenda";
import { projectEffectiveCampaignContext } from "@/analyses/effective-campaign-context-public";
import type { EffectiveCampaignContext } from "@/analyses/effective-campaign-context";
import type { DeterministicFinding, DeterministicFindingRun } from "@/analyses/finding-engine";
import { inspectMetaPersistenceWrite } from "@/domain/meta/data-lifecycle";

/** The bounded, public-safe default context for an L5 analysis turn. */
export const COMPACT_AGENT_CONTEXT_VERSION = "compact-agent-context/1.0.0" as const;

export type CompactAgentContextBudget = Readonly<{
  maxEntities: number;
  maxFindings: number;
  maxGuidanceCards: number;
  maxSources: number;
  maxTimeSeriesPoints: number;
  maxDrillDowns: number;
}>;

export const DEFAULT_COMPACT_AGENT_CONTEXT_BUDGET: CompactAgentContextBudget = Object.freeze({
  maxEntities: 8,
  maxFindings: 12,
  maxGuidanceCards: 8,
  maxSources: 8,
  maxTimeSeriesPoints: 48,
  maxDrillDowns: 4,
});

export type CompactAgentContext = Readonly<{
  contractVersion: typeof COMPACT_AGENT_CONTEXT_VERSION;
  compactContextRef: string;
  compactContextHash: string;
  contextRef: string;
  agendaRef: string;
  findingRunRef: string;
  capturedAt: string;
  entity: Readonly<{ entityType: "campaign" | "ad_set" | "ad" | "creative" }>;
  meta: ReturnType<typeof projectEffectiveCampaignContext>["meta"];
  data: Readonly<{
    trustStatus: "ready" | "degraded" | "not_ready";
    blockers: readonly string[];
    snapshotRefs: readonly string[];
    featureRefs: readonly string[];
    windowRefs: readonly string[];
  }>;
  guidance: Readonly<{
    applied: readonly Readonly<{
      cardRef: string;
      title: string;
      body: string;
      strength: "must" | "should" | "consider" | "avoid" | "question";
      topic: string;
      sourceRefs: readonly string[];
      authority: "guidance_only" | "policy_candidate";
    }>[];
    sources: readonly Readonly<{
      sourceRef: string;
      sourceType: string;
      sourceUrl: string | null;
      capturedAt: string | null;
      reviewedAt: string | null;
      freshness: "current" | "not_scheduled";
    }>[];
  }>;
  findings: readonly Readonly<{
    findingRef: string;
    passKey: string;
    entityRef: string;
    entityType: string;
    checkKey: string;
    metricKey: string;
    state: "finding" | "insufficient_data";
    evidence: readonly Readonly<{
      metric: string;
      metricStatus: "available" | "unknown" | "not_supplied";
      valueDecimal?: string;
      unknownReason?: string;
      metricResultRef?: string;
      sourceRefs: readonly string[];
    }>[];
    blockers: readonly string[];
    drivers: readonly Readonly<{ entityRef: string; entityType: string; depth: 1 | 2; metricKey: string }>[];
    unresolvedReasons: readonly string[];
    proposalEligibility: "eligible" | "suppressed" | "not_applicable";
    suppressionReasons: readonly string[];
  }>[];
  budget: Readonly<{
    limits: CompactAgentContextBudget;
    used: Readonly<{ entities: number; findings: number; guidanceCards: number; sources: number; timeSeriesPoints: 0; drillDowns: 0 }>;
    omitted: Readonly<{ entities: number; findings: number; guidanceCards: number; sources: number; timeSeriesPoints: 0; drillDowns: 0 }>;
    truncated: boolean;
    moreAvailable: boolean;
    reasons: readonly ("entity_limit" | "finding_limit" | "guidance_card_limit" | "source_limit")[];
  }>;
  capabilities: Readonly<{ containsRawL0: false; canAuthorizeAction: false; canExecuteWrite: false }>;
}>;

export class CompactAgentContextError extends Error {
  constructor(readonly code: "invalid_input" | "inauthentic_component" | "scope_mismatch" | "forbidden_material") {
    super(`Compact agent context oluşturulamadı: ${code}`);
    this.name = "CompactAgentContextError";
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

function publicRef(value: string): string {
  return `ref_${createHash("sha256").update(value).digest("hex").slice(0, 12)}`;
}

function authenticAgenda(agenda: AnalysisAgenda): boolean {
  const { agendaId, agendaHash, ...core } = agenda;
  return agendaId === `agenda_${agendaHash.slice(0, 24)}`
    && /^[a-f0-9]{64}$/.test(agendaHash) && digest(core) === agendaHash;
}

function authenticFindingRun(run: DeterministicFindingRun): boolean {
  const { findingRunId, findingRunHash, ...core } = run;
  return findingRunId === `finding_run_${findingRunHash.slice(0, 24)}`
    && /^[a-f0-9]{64}$/.test(findingRunHash) && digest(core) === findingRunHash;
}

function normalizeBudget(input: CompactAgentContextBudget | undefined): CompactAgentContextBudget {
  const candidate = input ?? DEFAULT_COMPACT_AGENT_CONTEXT_BUDGET;
  const keys = ["maxEntities", "maxFindings", "maxGuidanceCards", "maxSources", "maxTimeSeriesPoints", "maxDrillDowns"];
  if (Object.keys(candidate).length !== keys.length || Object.keys(candidate).some((key) => !keys.includes(key))) {
    throw new CompactAgentContextError("invalid_input");
  }
  for (const value of Object.values(candidate)) {
    if (!Number.isInteger(value) || value < 1 || value > 256) throw new CompactAgentContextError("invalid_input");
  }
  return Object.freeze({ ...candidate });
}

function priority(agenda: AnalysisAgenda, finding: DeterministicFinding): readonly [number, number, number, string] {
  return [
    finding.blockers.length > 0 ? 0 : 1,
    finding.state === "finding" ? 0 : 1,
    Math.max(0, agenda.passes.findIndex((pass) => pass.key === finding.passKey)),
    finding.findingId,
  ];
}

function compareFinding(agenda: AnalysisAgenda, left: DeterministicFinding, right: DeterministicFinding): number {
  const leftPriority = priority(agenda, left);
  const rightPriority = priority(agenda, right);
  for (let index = 0; index < leftPriority.length; index += 1) {
    const difference = typeof leftPriority[index] === "number"
      ? (leftPriority[index] as number) - (rightPriority[index] as number)
      : compareText(leftPriority[index] as string, rightPriority[index] as string);
    if (difference !== 0) return difference;
  }
  return 0;
}

function compactFinding(finding: DeterministicFinding): CompactAgentContext["findings"][number] {
  return Object.freeze({
    findingRef: publicRef(finding.findingId),
    passKey: finding.passKey,
    entityRef: publicRef(finding.entityRef),
    entityType: finding.entityType,
    checkKey: finding.checkKey,
    metricKey: finding.metricKey,
    state: finding.state,
    evidence: Object.freeze(finding.evidence.map((entry) => Object.freeze({
      metric: entry.metric,
      metricStatus: entry.metricStatus,
      ...(entry.valueDecimal === undefined ? {} : { valueDecimal: entry.valueDecimal }),
      ...(entry.unknownReason === undefined ? {} : { unknownReason: entry.unknownReason }),
      ...(entry.metricResultHash === undefined ? {} : { metricResultRef: publicRef(entry.metricResultHash) }),
      sourceRefs: Object.freeze(entry.snapshotRefs.map(publicRef).sort(compareText)),
    }))),
    blockers: Object.freeze([...finding.blockers].sort(compareText)),
    drivers: Object.freeze(finding.drivers.map((driver) => Object.freeze({
      entityRef: publicRef(driver.entityRef), entityType: driver.entityType, depth: driver.depth, metricKey: driver.metricKey,
    }))),
    unresolvedReasons: Object.freeze([...finding.unresolvedReasons].sort(compareText)),
    proposalEligibility: finding.suppression.proposalEligibility,
    suppressionReasons: Object.freeze([...finding.suppression.reasons].sort(compareText)),
  });
}

/**
 * Produces a bounded L5 context from authentic frozen components. It deliberately has no
 * raw L0 input, drill-down transport, action authority, or writer capability.
 */
export function buildCompactAgentContext(input: Readonly<{
  context: EffectiveCampaignContext;
  agenda: AnalysisAgenda;
  findingRun: DeterministicFindingRun;
  budget?: CompactAgentContextBudget;
}>): CompactAgentContext {
  if (Object.keys(input).some((key) => !["context", "agenda", "findingRun", "budget"].includes(key))
    || !inspectMetaPersistenceWrite(input).compliant) throw new CompactAgentContextError("forbidden_material");
  if (!authenticAgenda(input.agenda) || !authenticFindingRun(input.findingRun)) {
    throw new CompactAgentContextError("inauthentic_component");
  }
  let context: ReturnType<typeof projectEffectiveCampaignContext>;
  try {
    context = projectEffectiveCampaignContext(input.context);
  } catch {
    throw new CompactAgentContextError("inauthentic_component");
  }
  if (input.agenda.contextHash !== input.context.contextHash || input.findingRun.contextHash !== input.context.contextHash
    || input.findingRun.agendaId !== input.agenda.agendaId) throw new CompactAgentContextError("scope_mismatch");
  const enabledPasses = new Set(input.agenda.passes.map((pass) => pass.key));
  if (input.findingRun.findings.some((finding) => !enabledPasses.has(finding.passKey))) {
    throw new CompactAgentContextError("scope_mismatch");
  }
  const budget = normalizeBudget(input.budget);
  const reasons = new Set<CompactAgentContext["budget"]["reasons"][number]>();
  const selectedFindings: DeterministicFinding[] = [];
  const entities = new Set<string>();
  let omittedFindings = 0;
  let omittedEntities = 0;
  for (const finding of [...input.findingRun.findings].sort((left, right) => compareFinding(input.agenda, left, right))) {
    const newEntity = !entities.has(finding.entityRef);
    if (selectedFindings.length >= budget.maxFindings) {
      omittedFindings += 1;
      reasons.add("finding_limit");
      continue;
    }
    if (newEntity && entities.size >= budget.maxEntities) {
      omittedFindings += 1;
      omittedEntities += 1;
      reasons.add("entity_limit");
      continue;
    }
    selectedFindings.push(finding);
    entities.add(finding.entityRef);
  }
  const selectedCards = context.guidance.applied.slice(0, budget.maxGuidanceCards);
  const omittedCards = context.guidance.applied.length - selectedCards.length;
  if (omittedCards > 0) reasons.add("guidance_card_limit");
  const selectedCardRefs = new Set(selectedCards.map((card) => card.cardRef));
  const candidateSources = context.guidance.sources
    .filter((source) => selectedCards.some((card) => card.sourceRefs.includes(source.sourceRef)))
    .sort((left, right) => compareText(left.sourceRef, right.sourceRef));
  const selectedSources = candidateSources.slice(0, budget.maxSources);
  const omittedSources = candidateSources.length - selectedSources.length;
  if (omittedSources > 0) reasons.add("source_limit");
  const allowedSources = new Set(selectedSources.map((source) => source.sourceRef));
  const compactGuidance = Object.freeze(selectedCards.map((card) => Object.freeze({
    cardRef: card.cardRef, title: card.title, body: card.body, strength: card.strength, topic: card.topic,
    sourceRefs: Object.freeze(card.sourceRefs.filter((sourceRef) => allowedSources.has(sourceRef)).sort(compareText)),
    authority: card.authority,
  })).filter((card) => selectedCardRefs.has(card.cardRef)));
  const compactData = Object.freeze({
    trustStatus: context.data.trustStatus,
    blockers: Object.freeze([...context.data.blockers].sort(compareText)),
    snapshotRefs: Object.freeze([...context.data.snapshotRefs].sort(compareText).slice(0, budget.maxSources)),
    featureRefs: Object.freeze([...context.data.featureRefs].sort(compareText).slice(0, budget.maxSources)),
    windowRefs: Object.freeze([...context.data.windowRefs].sort(compareText).slice(0, budget.maxSources)),
  });
  const core = {
    contractVersion: COMPACT_AGENT_CONTEXT_VERSION,
    contextRef: context.contextRef,
    agendaRef: publicRef(input.agenda.agendaId),
    findingRunRef: publicRef(input.findingRun.findingRunId),
    capturedAt: context.capturedAt,
    entity: { entityType: context.identity.entityType },
    meta: context.meta,
    data: compactData,
    guidance: { applied: compactGuidance, sources: Object.freeze(selectedSources.map((source) => Object.freeze({
      sourceRef: source.sourceRef, sourceType: source.sourceType, sourceUrl: source.sourceUrl,
      capturedAt: source.capturedAt, reviewedAt: source.reviewedAt, freshness: source.freshness,
    }))) },
    findings: Object.freeze(selectedFindings.map(compactFinding)),
    budget: {
      limits: budget,
      used: { entities: entities.size, findings: selectedFindings.length, guidanceCards: compactGuidance.length, sources: selectedSources.length, timeSeriesPoints: 0 as const, drillDowns: 0 as const },
      omitted: { entities: omittedEntities, findings: omittedFindings, guidanceCards: omittedCards, sources: omittedSources, timeSeriesPoints: 0 as const, drillDowns: 0 as const },
      truncated: reasons.size > 0,
      moreAvailable: reasons.size > 0,
      reasons: Object.freeze([...reasons].sort(compareText)),
    },
    capabilities: { containsRawL0: false as const, canAuthorizeAction: false as const, canExecuteWrite: false as const },
  };
  const compactContextHash = digest(core);
  return Object.freeze({ ...core, compactContextHash, compactContextRef: `compact_context_${compactContextHash.slice(0, 24)}` });
}
