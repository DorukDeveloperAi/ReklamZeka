import { createHash } from "node:crypto";
import { inspectMetaPersistenceWrite } from "@/domain/meta/data-lifecycle";

export const ADVISED_PRACTICE_VERSION = "advised-practice/1.0.0" as const;
export const ADVISED_PRACTICE_EVENT_VERSION = "advised-practice-event/1.0.0" as const;

export type PracticeEntityType = "campaign" | "ad_set" | "ad" | "creative" | "post";
export type PracticeDecompositionTarget =
  | "feature"
  | "analysis_agenda"
  | "playbook"
  | "cadence"
  | "guidance"
  | "policy"
  | "human_judgment";

export type AdvisedPracticeDefinition = Readonly<{
  schemaVersion: typeof ADVISED_PRACTICE_VERSION;
  workspaceRef: string;
  practiceRef: string;
  version: number;
  previousDefinitionHash: "GENESIS" | string;
  problem: string;
  requiredInputs: readonly string[];
  steps: readonly string[];
  rationale: string;
  cadence: string;
  exceptions: readonly string[];
  confidence: number;
  scope: Readonly<{
    kind: "global" | "bounded";
    accountRefs: readonly string[];
    objectives: readonly string[];
    internalCategoryRefs: readonly string[];
    entities: readonly Readonly<{ type: PracticeEntityType; ref: string }>[];
    topics: readonly string[];
  }>;
  provenance: Readonly<{
    conversationRef: string;
    ownerSource: Readonly<{
      sourceRef: string;
      ownerRef: string;
      capturedAt: string;
      statementHash: string;
    }>;
    metaSources: readonly Readonly<{
      sourceRef: string;
      sourceUrl: string;
      capturedAt: string;
      reviewedAt: string;
      reviewBy: string;
    }>[];
    evidenceRefs: readonly string[];
    deliberation: Readonly<{
      alignment: "aligned" | "conflicted" | "uncertain";
      conflictRefs: readonly string[];
      rationale: string;
    }>;
  }>;
  capabilities: Readonly<{
    canCreateGuidance: false;
    canPromotePolicy: false;
    canEnableAutomation: false;
    canAuthorizeAction: false;
  }>;
  definitionHash: string;
}>;

type PracticeEventBase = Readonly<{
  schemaVersion: typeof ADVISED_PRACTICE_EVENT_VERSION;
  workspaceRef: string;
  practiceRef: string;
  definitionVersion: number;
  definitionHash: string;
  sequence: number;
  previousEventHash: "GENESIS" | string;
  occurredAt: string;
  eventId: string;
  eventHash: string;
  authority: "advisory_only";
}>;

export type PracticeCandidateEvent = PracticeEventBase & Readonly<{
  eventType: "candidate_created";
  origin: "agentic_conversation" | "human_draft";
  createdByRef: string;
}>;

export type PracticeReviewedEvent = PracticeEventBase & Readonly<{
  eventType: "reviewed";
  reviewerRef: string;
  reviewNote: string;
}>;

export type PracticeTrialEvent = PracticeEventBase & Readonly<{
  eventType: "trial_started";
  trialRef: string;
  effectiveContextRef: string;
  analysisRef: string;
  findingRefs: readonly string[];
  evidenceRefs: readonly string[];
  hypothesis: string;
}>;

export type PracticeOutcomeEvent = PracticeEventBase & Readonly<{
  eventType: "outcome_recorded";
  trialRef: string;
  outcomeRef: string;
  result: "validated" | "conditional" | "rejected";
  evidenceRefs: readonly string[];
  observedAt: string;
  outcomeNote: string;
}>;

export type PracticeStandardizationReviewEvent = PracticeEventBase & Readonly<{
  eventType: "standardization_reviewed";
  reviewerRef: string;
  outcomeEventRef: string;
  decomposition: readonly Readonly<{
    target: PracticeDecompositionTarget;
    summary: string;
    sourceRefs: readonly string[];
    artifactRef: null;
    promotionCapability: "disabled";
  }>[];
  reviewNote: string;
  policyPromotionCapability: "disabled";
  automationCapability: "disabled";
}>;

export type PracticeRetiredEvent = PracticeEventBase & Readonly<{
  eventType: "retired";
  retiredByRef: string;
  reason: string;
}>;

export type AdvisedPracticeEvent =
  | PracticeCandidateEvent
  | PracticeReviewedEvent
  | PracticeTrialEvent
  | PracticeOutcomeEvent
  | PracticeStandardizationReviewEvent
  | PracticeRetiredEvent;

export type AdvisedPracticeState =
  | "candidate"
  | "reviewed"
  | "trial"
  | "validated"
  | "conditional"
  | "rejected"
  | "standardization_reviewed"
  | "retired";

export class AdvisedPracticeError extends Error {
  constructor(readonly code:
    | "invalid_input"
    | "invalid_scope"
    | "invalid_provenance"
    | "authority_escalation"
    | "invalid_revision"
    | "invalid_history"
    | "invalid_transition"
    | "outcome_required") {
    super("Advised practice güvenli biçimde işlenemedi");
    this.name = "AdvisedPracticeError";
  }
}

const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_-]{0,94}$/;
const HASH = /^[a-f0-9]{64}$/;
const ENTITY_TYPES = new Set<PracticeEntityType>(["campaign", "ad_set", "ad", "creative", "post"]);
const TARGETS = new Set<PracticeDecompositionTarget>([
  "feature", "analysis_agenda", "playbook", "cadence", "guidance", "policy", "human_judgment",
]);

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactKeys(value: object, allowed: readonly string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new AdvisedPracticeError("invalid_input");
}

function stableValue(value: unknown, seen = new Set<object>()): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new AdvisedPracticeError("invalid_input");
    return value;
  }
  if (!value || typeof value !== "object" || seen.has(value)) throw new AdvisedPracticeError("invalid_input");
  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.map((item) => stableValue(item, seen));
    seen.delete(value);
    return result;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) throw new AdvisedPracticeError("invalid_input");
  const result = Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => compareText(left, right))
    .map(([key, item]) => [key, stableValue(item, seen)]));
  seen.delete(value);
  return result;
}

function stableStringify(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function digest(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function text(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 2_000) throw new AdvisedPracticeError("invalid_input");
  return value.trim();
}

function ref(value: unknown): string {
  const result = text(value);
  if (!REF.test(result)) throw new AdvisedPracticeError("invalid_input");
  return result;
}

function iso(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new AdvisedPracticeError("invalid_input");
  return new Date(value).toISOString();
}

function refs(values: readonly string[], minimum = 0): readonly string[] {
  if (!Array.isArray(values) || values.length < minimum || values.length > 100) throw new AdvisedPracticeError("invalid_input");
  const result = [...new Set(values.map(ref))].sort(compareText);
  if (result.length !== values.length) throw new AdvisedPracticeError("invalid_input");
  return Object.freeze(result);
}

function texts(values: readonly string[], minimum = 0): readonly string[] {
  if (!Array.isArray(values) || values.length < minimum || values.length > 100) throw new AdvisedPracticeError("invalid_input");
  const result = [...new Set(values.map(text))].sort(compareText);
  if (result.length !== values.length) throw new AdvisedPracticeError("invalid_input");
  return Object.freeze(result);
}

function orderedTexts(values: readonly string[], minimum = 0): readonly string[] {
  if (!Array.isArray(values) || values.length < minimum || values.length > 100) throw new AdvisedPracticeError("invalid_input");
  const result = values.map(text);
  if (new Set(result).size !== result.length) throw new AdvisedPracticeError("invalid_input");
  return Object.freeze(result);
}

function officialSourceUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 1_000) throw new AdvisedPracticeError("invalid_provenance");
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new AdvisedPracticeError("invalid_provenance");
  }
  const hostname = parsed.hostname.toLowerCase();
  const metaOwnedHost = ["facebook.com", "meta.com", "instagram.com"].some(
    (suffix) => hostname === suffix || hostname.endsWith(`.${suffix}`),
  );
  if (parsed.protocol !== "https:" || !metaOwnedHost || parsed.username || parsed.password || parsed.hash
    || parsed.hostname.length > 253 || parsed.pathname.length > 800) throw new AdvisedPracticeError("invalid_provenance");
  return parsed.toString();
}

function assertNoForbiddenMaterial(value: unknown): void {
  const forbidden = /(token|secret|prompt|authorization|raw[_-]?(payload|request|response|json))/i;
  const authority = /^(canwrite|writeenabled|actionauthority|writeauthority|executionauthority|approvalgranted|canauthorizeaction|canexecutewrite|canenforcepolicy|canalterapproval|cancreateguidance|canpromotepolicy|canenableautomation|policypromotioncapability|automationcapability)$/i;
  const visit = (item: unknown, seen = new Set<object>()): void => {
    if (!item || typeof item !== "object" || seen.has(item)) return;
    seen.add(item);
    if (Array.isArray(item)) return item.forEach((child) => visit(child, seen));
    for (const [key, child] of Object.entries(item as Record<string, unknown>)) {
      if (forbidden.test(key)) throw new AdvisedPracticeError("invalid_input");
      if (authority.test(key) && child !== false && child !== "none" && child !== "disabled") {
        throw new AdvisedPracticeError("authority_escalation");
      }
      visit(child, seen);
    }
  };
  visit(value);
  if (!inspectMetaPersistenceWrite(value).compliant) throw new AdvisedPracticeError("invalid_input");
}

type DefinitionInput = Omit<AdvisedPracticeDefinition,
  "schemaVersion" | "version" | "previousDefinitionHash" | "definitionHash" | "capabilities">;

function canonicalDefinition(input: DefinitionInput): DefinitionInput {
  exactKeys(input, [
    "workspaceRef", "practiceRef", "problem", "requiredInputs", "steps", "rationale", "cadence",
    "exceptions", "confidence", "scope", "provenance",
  ]);
  exactKeys(input.scope, ["kind", "accountRefs", "objectives", "internalCategoryRefs", "entities", "topics"]);
  exactKeys(input.provenance, ["conversationRef", "ownerSource", "metaSources", "evidenceRefs", "deliberation"]);
  exactKeys(input.provenance.ownerSource, ["sourceRef", "ownerRef", "capturedAt", "statementHash"]);
  exactKeys(input.provenance.deliberation, ["alignment", "conflictRefs", "rationale"]);
  if (!Array.isArray(input.scope.entities) || input.scope.entities.length > 100) throw new AdvisedPracticeError("invalid_scope");
  const entities = input.scope.entities.map((entity) => {
    exactKeys(entity, ["type", "ref"]);
    if (!ENTITY_TYPES.has(entity.type)) throw new AdvisedPracticeError("invalid_scope");
    return Object.freeze({ type: entity.type, ref: ref(entity.ref) });
  }).sort((left, right) => compareText(`${left.type}:${left.ref}`, `${right.type}:${right.ref}`));
  if (new Set(entities.map((entity) => `${entity.type}:${entity.ref}`)).size !== entities.length) {
    throw new AdvisedPracticeError("invalid_scope");
  }
  const scope = Object.freeze({
    kind: input.scope.kind,
    accountRefs: refs(input.scope.accountRefs),
    objectives: texts(input.scope.objectives),
    internalCategoryRefs: refs(input.scope.internalCategoryRefs),
    entities: Object.freeze(entities),
    topics: texts(input.scope.topics),
  });
  const boundedCount = scope.accountRefs.length + scope.objectives.length + scope.internalCategoryRefs.length
    + scope.entities.length + scope.topics.length;
  if ((scope.kind !== "global" && scope.kind !== "bounded")
    || (scope.kind === "global" && boundedCount !== 0) || (scope.kind === "bounded" && boundedCount === 0)) {
    throw new AdvisedPracticeError("invalid_scope");
  }
  if (!Array.isArray(input.provenance.metaSources) || input.provenance.metaSources.length < 1
    || input.provenance.metaSources.length > 20) throw new AdvisedPracticeError("invalid_provenance");
  const metaSources = input.provenance.metaSources.map((source) => {
    exactKeys(source, ["sourceRef", "sourceUrl", "capturedAt", "reviewedAt", "reviewBy"]);
    const capturedAt = iso(source.capturedAt);
    const reviewedAt = iso(source.reviewedAt);
    const reviewBy = iso(source.reviewBy);
    const sourceUrl = officialSourceUrl(source.sourceUrl);
    if (Date.parse(reviewedAt) < Date.parse(capturedAt)
      || Date.parse(reviewBy) <= Date.parse(reviewedAt)) throw new AdvisedPracticeError("invalid_provenance");
    return Object.freeze({ sourceRef: ref(source.sourceRef), sourceUrl, capturedAt, reviewedAt, reviewBy });
  }).sort((left, right) => compareText(left.sourceRef, right.sourceRef));
  if (new Set(metaSources.map((source) => source.sourceRef)).size !== metaSources.length) {
    throw new AdvisedPracticeError("invalid_provenance");
  }
  const owner = input.provenance.ownerSource;
  if (!HASH.test(owner.statementHash)) throw new AdvisedPracticeError("invalid_provenance");
  const conflictRefs = refs(input.provenance.deliberation.conflictRefs);
  if (!["aligned", "conflicted", "uncertain"].includes(input.provenance.deliberation.alignment)
    || (input.provenance.deliberation.alignment === "aligned" && conflictRefs.length !== 0)
    || (input.provenance.deliberation.alignment !== "aligned" && conflictRefs.length === 0)) {
    throw new AdvisedPracticeError("invalid_provenance");
  }
  if (!Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
    throw new AdvisedPracticeError("invalid_input");
  }
  return Object.freeze({
    workspaceRef: ref(input.workspaceRef), practiceRef: ref(input.practiceRef), problem: text(input.problem),
    requiredInputs: texts(input.requiredInputs, 1), steps: orderedTexts(input.steps, 1), rationale: text(input.rationale),
    cadence: text(input.cadence), exceptions: texts(input.exceptions), confidence: input.confidence, scope,
    provenance: Object.freeze({
      conversationRef: ref(input.provenance.conversationRef),
      ownerSource: Object.freeze({
        sourceRef: ref(owner.sourceRef), ownerRef: ref(owner.ownerRef), capturedAt: iso(owner.capturedAt),
        statementHash: owner.statementHash,
      }),
      metaSources: Object.freeze(metaSources), evidenceRefs: refs(input.provenance.evidenceRefs, 1),
      deliberation: Object.freeze({
        alignment: input.provenance.deliberation.alignment,
        conflictRefs,
        rationale: text(input.provenance.deliberation.rationale),
      }),
    }),
  });
}

export function createAdvisedPracticeDefinition(input: Readonly<DefinitionInput>): AdvisedPracticeDefinition {
  assertNoForbiddenMaterial(input);
  const body = Object.freeze({
    schemaVersion: ADVISED_PRACTICE_VERSION,
    ...canonicalDefinition(input),
    version: 1,
    previousDefinitionHash: "GENESIS" as const,
    capabilities: Object.freeze({
      canCreateGuidance: false as const, canPromotePolicy: false as const,
      canEnableAutomation: false as const, canAuthorizeAction: false as const,
    }),
  });
  return Object.freeze({ ...body, definitionHash: digest(body) });
}

export function reviseAdvisedPracticeDefinition(
  previous: AdvisedPracticeDefinition,
  input: Readonly<DefinitionInput>,
): AdvisedPracticeDefinition {
  if (!verifyAdvisedPracticeDefinition(previous)) throw new AdvisedPracticeError("invalid_revision");
  assertNoForbiddenMaterial(input);
  const canonical = canonicalDefinition(input);
  if (canonical.workspaceRef !== previous.workspaceRef || canonical.practiceRef !== previous.practiceRef) {
    throw new AdvisedPracticeError("invalid_revision");
  }
  const body = Object.freeze({
    schemaVersion: ADVISED_PRACTICE_VERSION, ...canonical, version: previous.version + 1,
    previousDefinitionHash: previous.definitionHash,
    capabilities: previous.capabilities,
  });
  return Object.freeze({ ...body, definitionHash: digest(body) });
}

export function verifyAdvisedPracticeDefinition(definition: AdvisedPracticeDefinition): boolean {
  try {
    exactKeys(definition, [
      "schemaVersion", "workspaceRef", "practiceRef", "version", "previousDefinitionHash", "problem",
      "requiredInputs", "steps", "rationale", "cadence", "exceptions", "confidence", "scope", "provenance",
      "capabilities", "definitionHash",
    ]);
    if (definition.schemaVersion !== ADVISED_PRACTICE_VERSION || !Number.isInteger(definition.version)
      || definition.version < 1 || !HASH.test(definition.definitionHash)
      || (definition.version === 1) !== (definition.previousDefinitionHash === "GENESIS")
      || (definition.previousDefinitionHash !== "GENESIS" && !HASH.test(definition.previousDefinitionHash))) return false;
    exactKeys(definition.capabilities, ["canCreateGuidance", "canPromotePolicy", "canEnableAutomation", "canAuthorizeAction"]);
    if (Object.values(definition.capabilities).some(Boolean)) return false;
    const { schemaVersion: _schemaVersion, version: _version, previousDefinitionHash: _previous, capabilities: _capabilities,
      definitionHash: _hash, ...input } = definition;
    const canonical = canonicalDefinition(input);
    const body = { schemaVersion: definition.schemaVersion, ...canonical, version: definition.version,
      previousDefinitionHash: definition.previousDefinitionHash, capabilities: definition.capabilities };
    return stableStringify(canonical) === stableStringify(input) && digest(body) === definition.definitionHash;
  } catch {
    return false;
  }
}

type CandidateInput = Omit<PracticeCandidateEvent, keyof PracticeEventBase | "eventType">;
type ReviewedInput = Omit<PracticeReviewedEvent, keyof PracticeEventBase | "eventType">;
type TrialInput = Omit<PracticeTrialEvent, keyof PracticeEventBase | "eventType">;
type OutcomeInput = Omit<PracticeOutcomeEvent, keyof PracticeEventBase | "eventType">;
type ReviewInput = Omit<PracticeStandardizationReviewEvent, keyof PracticeEventBase | "eventType"
  | "policyPromotionCapability" | "automationCapability">;
type RetiredInput = Omit<PracticeRetiredEvent, keyof PracticeEventBase | "eventType">;

export type AppendPracticeEventInput =
  | Readonly<{ eventType: "candidate_created"; occurredAt: string; payload: CandidateInput }>
  | Readonly<{ eventType: "reviewed"; occurredAt: string; payload: ReviewedInput }>
  | Readonly<{ eventType: "trial_started"; occurredAt: string; payload: TrialInput }>
  | Readonly<{ eventType: "outcome_recorded"; occurredAt: string; payload: OutcomeInput }>
  | Readonly<{ eventType: "standardization_reviewed"; occurredAt: string; payload: ReviewInput }>
  | Readonly<{ eventType: "retired"; occurredAt: string; payload: RetiredInput }>;

function stateOf(history: readonly AdvisedPracticeEvent[]): AdvisedPracticeState | null {
  const last = history.at(-1);
  if (!last) return null;
  if (last.eventType === "candidate_created") return "candidate";
  if (last.eventType === "reviewed") return "reviewed";
  if (last.eventType === "trial_started") return "trial";
  if (last.eventType === "outcome_recorded") return last.result;
  if (last.eventType === "standardization_reviewed") return "standardization_reviewed";
  return "retired";
}

function makeEvent(definition: AdvisedPracticeDefinition, history: readonly AdvisedPracticeEvent[],
  eventType: AdvisedPracticeEvent["eventType"], occurredAt: string, payload: Record<string, unknown>): AdvisedPracticeEvent {
  const previous = history.at(-1);
  const canonicalOccurredAt = iso(occurredAt);
  if (previous && Date.parse(canonicalOccurredAt) < Date.parse(previous.occurredAt)) {
    throw new AdvisedPracticeError("invalid_input");
  }
  const body = {
    schemaVersion: ADVISED_PRACTICE_EVENT_VERSION, workspaceRef: definition.workspaceRef,
    practiceRef: definition.practiceRef, definitionVersion: definition.version,
    definitionHash: definition.definitionHash, sequence: history.length + 1,
    previousEventHash: previous?.eventHash ?? "GENESIS", occurredAt: canonicalOccurredAt, eventType,
    ...payload, authority: "advisory_only" as const,
  };
  const eventId = `practice_event_${digest(body).slice(0, 20)}`;
  return Object.freeze({ ...body, eventId, eventHash: digest({ ...body, eventId }) }) as AdvisedPracticeEvent;
}

export function appendAdvisedPracticeEvent(
  definition: AdvisedPracticeDefinition,
  history: readonly AdvisedPracticeEvent[],
  input: AppendPracticeEventInput,
): Readonly<{ history: readonly AdvisedPracticeEvent[]; event: AdvisedPracticeEvent; state: AdvisedPracticeState }> {
  if (!verifyAdvisedPracticeDefinition(definition) || !verifyAdvisedPracticeHistory(definition, history)) {
    throw new AdvisedPracticeError("invalid_history");
  }
  exactKeys(input, ["eventType", "occurredAt", "payload"]);
  assertNoForbiddenMaterial(input);
  const state = stateOf(history);
  let payload: Record<string, unknown>;
  if (input.eventType === "candidate_created") {
    if (state !== null) throw new AdvisedPracticeError("invalid_transition");
    exactKeys(input.payload, ["origin", "createdByRef"]);
    if (!["agentic_conversation", "human_draft"].includes(input.payload.origin)) throw new AdvisedPracticeError("invalid_input");
    payload = { origin: input.payload.origin, createdByRef: ref(input.payload.createdByRef) };
  } else if (input.eventType === "reviewed") {
    if (state !== "candidate") throw new AdvisedPracticeError("invalid_transition");
    exactKeys(input.payload, ["reviewerRef", "reviewNote"]);
    payload = { reviewerRef: ref(input.payload.reviewerRef), reviewNote: text(input.payload.reviewNote) };
  } else if (input.eventType === "trial_started") {
    if (state !== "reviewed" && state !== "conditional") throw new AdvisedPracticeError("invalid_transition");
    exactKeys(input.payload, ["trialRef", "effectiveContextRef", "analysisRef", "findingRefs", "evidenceRefs", "hypothesis"]);
    payload = {
      trialRef: ref(input.payload.trialRef), effectiveContextRef: ref(input.payload.effectiveContextRef),
      analysisRef: ref(input.payload.analysisRef), findingRefs: refs(input.payload.findingRefs, 1),
      evidenceRefs: refs(input.payload.evidenceRefs, 1), hypothesis: text(input.payload.hypothesis),
    };
  } else if (input.eventType === "outcome_recorded") {
    if (state !== "trial") throw new AdvisedPracticeError("invalid_transition");
    exactKeys(input.payload, ["trialRef", "outcomeRef", "result", "evidenceRefs", "observedAt", "outcomeNote"]);
    const trial = history.at(-1) as PracticeTrialEvent;
    if (input.payload.trialRef !== trial.trialRef || !["validated", "conditional", "rejected"].includes(input.payload.result)) {
      throw new AdvisedPracticeError("invalid_transition");
    }
    const observedAt = iso(input.payload.observedAt);
    if (Date.parse(observedAt) < Date.parse(trial.occurredAt)) throw new AdvisedPracticeError("invalid_input");
    payload = {
      trialRef: ref(input.payload.trialRef), outcomeRef: ref(input.payload.outcomeRef), result: input.payload.result,
      evidenceRefs: refs(input.payload.evidenceRefs, 1), observedAt, outcomeNote: text(input.payload.outcomeNote),
    };
  } else if (input.eventType === "standardization_reviewed") {
    if (state !== "validated") throw new AdvisedPracticeError("outcome_required");
    exactKeys(input.payload, ["reviewerRef", "outcomeEventRef", "decomposition", "reviewNote"]);
    const outcome = history.at(-1) as PracticeOutcomeEvent;
    if (input.payload.outcomeEventRef !== outcome.eventId || !Array.isArray(input.payload.decomposition)
      || input.payload.decomposition.length < 1 || input.payload.decomposition.length > 20) {
      throw new AdvisedPracticeError("invalid_input");
    }
    const decomposition = input.payload.decomposition.map((part) => {
      exactKeys(part, ["target", "summary", "sourceRefs", "artifactRef", "promotionCapability"]);
      if (!TARGETS.has(part.target) || part.artifactRef !== null || part.promotionCapability !== "disabled") {
        throw new AdvisedPracticeError("authority_escalation");
      }
      return Object.freeze({ target: part.target, summary: text(part.summary), sourceRefs: refs(part.sourceRefs, 1),
        artifactRef: null, promotionCapability: "disabled" as const });
    });
    payload = {
      reviewerRef: ref(input.payload.reviewerRef), outcomeEventRef: ref(input.payload.outcomeEventRef),
      decomposition: Object.freeze(decomposition), reviewNote: text(input.payload.reviewNote),
      policyPromotionCapability: "disabled", automationCapability: "disabled",
    };
  } else {
    if (state === null || state === "retired") throw new AdvisedPracticeError("invalid_transition");
    exactKeys(input.payload, ["retiredByRef", "reason"]);
    payload = { retiredByRef: ref(input.payload.retiredByRef), reason: text(input.payload.reason) };
  }
  const event = makeEvent(definition, history, input.eventType, input.occurredAt, payload);
  const next = Object.freeze([...history, event]);
  if (!verifyAdvisedPracticeHistory(definition, next)) throw new AdvisedPracticeError("invalid_history");
  return Object.freeze({ history: next, event, state: stateOf(next)! });
}

export function verifyAdvisedPracticeHistory(
  definition: AdvisedPracticeDefinition,
  history: readonly AdvisedPracticeEvent[],
): boolean {
  try {
    if (!verifyAdvisedPracticeDefinition(definition) || !Array.isArray(history)) return false;
    let rebuilt: readonly AdvisedPracticeEvent[] = [];
    for (const event of history) {
      if (!event || event.workspaceRef !== definition.workspaceRef || event.practiceRef !== definition.practiceRef
        || event.definitionVersion !== definition.version || event.definitionHash !== definition.definitionHash
        || event.sequence !== rebuilt.length + 1 || event.previousEventHash !== (rebuilt.at(-1)?.eventHash ?? "GENESIS")
        || event.schemaVersion !== ADVISED_PRACTICE_EVENT_VERSION || event.authority !== "advisory_only"
        || iso(event.occurredAt) !== event.occurredAt
        || (rebuilt.at(-1) && Date.parse(event.occurredAt) < Date.parse(rebuilt.at(-1)!.occurredAt))
        || !/^practice_event_[a-f0-9]{20}$/.test(event.eventId) || !HASH.test(event.eventHash)) return false;
      assertPersistedEventShape(event, rebuilt);
      const { schemaVersion: _schema, workspaceRef: _workspace, practiceRef: _practice,
        definitionVersion: _version, definitionHash: _definitionHash, sequence: _sequence,
        previousEventHash: _previous, occurredAt, eventId: _eventId, eventHash: _eventHash,
        authority: _authority, eventType, ...payload } = event;
      const rebuiltResult = appendAdvisedPracticeEventUnchecked(definition, rebuilt, {
        eventType, occurredAt, payload,
      } as AppendPracticeEventInput);
      if (stableStringify(rebuiltResult.event) !== stableStringify(event)) return false;
      rebuilt = rebuiltResult.history;
    }
    return true;
  } catch {
    return false;
  }
}

function sameCanonical(values: readonly string[], minimum = 0): boolean {
  try {
    return JSON.stringify(values) === JSON.stringify(refs(values, minimum));
  } catch {
    return false;
  }
}

function assertPersistedEventShape(event: AdvisedPracticeEvent, history: readonly AdvisedPracticeEvent[]): void {
  const base = [
    "schemaVersion", "workspaceRef", "practiceRef", "definitionVersion", "definitionHash", "sequence",
    "previousEventHash", "occurredAt", "eventId", "eventHash", "eventType", "authority",
  ];
  if (event.eventType === "candidate_created") {
    exactKeys(event, [...base, "origin", "createdByRef"]);
    if (!["agentic_conversation", "human_draft"].includes(event.origin) || ref(event.createdByRef) !== event.createdByRef) {
      throw new AdvisedPracticeError("invalid_history");
    }
  } else if (event.eventType === "reviewed") {
    exactKeys(event, [...base, "reviewerRef", "reviewNote"]);
    if (ref(event.reviewerRef) !== event.reviewerRef || text(event.reviewNote) !== event.reviewNote) {
      throw new AdvisedPracticeError("invalid_history");
    }
  } else if (event.eventType === "trial_started") {
    exactKeys(event, [...base, "trialRef", "effectiveContextRef", "analysisRef", "findingRefs", "evidenceRefs", "hypothesis"]);
    if (ref(event.trialRef) !== event.trialRef || ref(event.effectiveContextRef) !== event.effectiveContextRef
      || ref(event.analysisRef) !== event.analysisRef || !sameCanonical(event.findingRefs, 1)
      || !sameCanonical(event.evidenceRefs, 1) || text(event.hypothesis) !== event.hypothesis) {
      throw new AdvisedPracticeError("invalid_history");
    }
  } else if (event.eventType === "outcome_recorded") {
    exactKeys(event, [...base, "trialRef", "outcomeRef", "result", "evidenceRefs", "observedAt", "outcomeNote"]);
    const trial = history.at(-1);
    if (!trial || trial.eventType !== "trial_started" || event.trialRef !== trial.trialRef
      || ref(event.outcomeRef) !== event.outcomeRef || !["validated", "conditional", "rejected"].includes(event.result)
      || !sameCanonical(event.evidenceRefs, 1) || iso(event.observedAt) !== event.observedAt
      || Date.parse(event.observedAt) < Date.parse(trial.occurredAt) || text(event.outcomeNote) !== event.outcomeNote) {
      throw new AdvisedPracticeError("invalid_history");
    }
  } else if (event.eventType === "standardization_reviewed") {
    exactKeys(event, [...base, "reviewerRef", "outcomeEventRef", "decomposition", "reviewNote",
      "policyPromotionCapability", "automationCapability"]);
    const outcome = history.at(-1);
    if (!outcome || outcome.eventType !== "outcome_recorded" || outcome.result !== "validated"
      || event.outcomeEventRef !== outcome.eventId || ref(event.reviewerRef) !== event.reviewerRef
      || text(event.reviewNote) !== event.reviewNote || event.policyPromotionCapability !== "disabled"
      || event.automationCapability !== "disabled" || !Array.isArray(event.decomposition)
      || event.decomposition.length < 1 || event.decomposition.length > 20) throw new AdvisedPracticeError("invalid_history");
    for (const part of event.decomposition) {
      exactKeys(part, ["target", "summary", "sourceRefs", "artifactRef", "promotionCapability"]);
      if (!TARGETS.has(part.target) || text(part.summary) !== part.summary || !sameCanonical(part.sourceRefs, 1)
        || part.artifactRef !== null || part.promotionCapability !== "disabled") throw new AdvisedPracticeError("invalid_history");
    }
  } else {
    exactKeys(event, [...base, "retiredByRef", "reason"]);
    if (ref(event.retiredByRef) !== event.retiredByRef || text(event.reason) !== event.reason) {
      throw new AdvisedPracticeError("invalid_history");
    }
  }
  assertNoForbiddenMaterial(event);
}

function appendAdvisedPracticeEventUnchecked(
  definition: AdvisedPracticeDefinition,
  history: readonly AdvisedPracticeEvent[],
  input: AppendPracticeEventInput,
): Readonly<{ history: readonly AdvisedPracticeEvent[]; event: AdvisedPracticeEvent }> {
  // Replay uses the public transition validator but avoids recursive history verification.
  const state = stateOf(history);
  if ((input.eventType === "candidate_created" && state !== null)
    || (input.eventType === "reviewed" && state !== "candidate")
    || (input.eventType === "trial_started" && state !== "reviewed" && state !== "conditional")
    || (input.eventType === "outcome_recorded" && state !== "trial")
    || (input.eventType === "standardization_reviewed" && state !== "validated")
    || (input.eventType === "retired" && (state === null || state === "retired"))) {
    throw new AdvisedPracticeError("invalid_transition");
  }
  const event = makeEvent(definition, history, input.eventType, input.occurredAt, input.payload as Record<string, unknown>);
  return { history: [...history, event], event };
}

export function replayAdvisedPractice(
  definition: AdvisedPracticeDefinition,
  history: readonly AdvisedPracticeEvent[],
): Readonly<{
  state: AdvisedPracticeState | null;
  outcomeStatus: "validated" | "conditional" | "rejected" | null;
  standardizationReviewStatus: "not_reviewed" | "reviewed";
  lastEventRef: string | null;
  historyHash: string;
}> {
  if (!verifyAdvisedPracticeHistory(definition, history)) throw new AdvisedPracticeError("invalid_history");
  const outcome = [...history].reverse().find((event): event is PracticeOutcomeEvent => event.eventType === "outcome_recorded");
  return Object.freeze({
    state: stateOf(history), outcomeStatus: outcome?.result ?? null,
    standardizationReviewStatus: history.some((event) => event.eventType === "standardization_reviewed")
      ? "reviewed" : "not_reviewed",
    lastEventRef: history.at(-1)?.eventId ?? null,
    historyHash: digest({ definitionHash: definition.definitionHash, eventHashes: history.map((event) => event.eventHash) }),
  });
}
