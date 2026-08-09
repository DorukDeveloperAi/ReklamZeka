import { createHash } from "node:crypto";

import {
  assertStrictInstructionPolicyArtifact,
  type StrictInstructionPolicy,
} from "@/domain/policies/instruction-policy-dsl";

export const PROGRESSIVE_FORMALIZATION_VERSION = "progressive-formalization/1.0.0" as const;
export const NORMALIZED_POLICY_DRAFT_VERSION = "normalized-policy-draft/1.0.0" as const;

export type FormalizationLevel = "G0" | "G1" | "G2" | "G3" | "G4";
export type FormalizationActorRole = "owner" | "admin" | "analyst";

export type FormalizationScope = Readonly<{
  global: boolean;
  accountGroupRefs: readonly string[];
  accountRefs: readonly string[];
  objectiveRefs: readonly string[];
  internalCategoryRefs: readonly string[];
  entityRefs: readonly string[];
  promotionTemplateRefs: readonly string[];
  topicRefs: readonly string[];
}>;

export type NormalizedPolicyDraftInput = Readonly<{
  schemaVersion: typeof NORMALIZED_POLICY_DRAFT_VERSION;
  workspaceRef: string;
  formalizationRef: string;
  guidanceSetRef: string;
  strictPolicy: StrictInstructionPolicy;
  assumptions: readonly Readonly<{
    assumptionRef: string;
    statement: string;
    disposition: "accepted" | "rejected";
  }>[];
  questions: readonly Readonly<{
    questionRef: string;
    question: string;
    answer: string | null;
  }>[];
  semanticDiff: Readonly<{
    status: "resolved" | "ambiguous" | "unknown";
    items: readonly Readonly<{
      meaningRef: string;
      sourceStatementHash: string;
      normalizedClauseRef: string | null;
      disposition: "preserved" | "narrowed" | "excluded";
      reasonCode: string;
    }>[];
    diffHash: string;
  }>;
  historicalReplay: Readonly<{
    status: "complete" | "no_history" | "incomplete";
    evaluatedRevisionRefs: readonly string[];
    changedOutcomeRefs: readonly string[];
    unknownOutcomeRefs: readonly string[];
    replayHash: string;
  }>;
  conflictPreview: Readonly<{
    status: "clear" | "parked_conflict" | "unknown";
    conflictRefs: readonly string[];
    previewHash: string;
  }>;
  impactPreview: Readonly<{
    status: "complete" | "partial" | "unknown";
    affectedScopeRefs: readonly string[];
    affectedEntityCount: number;
    affectedPolicyCount: number;
    affectedBudgetCount: number;
    affectedAutomationCount: number;
    unresolvedDependencyRefs: readonly string[];
    previewHash: string;
  }>;
}>;

export type NormalizedPolicyDraft = Readonly<NormalizedPolicyDraftInput & {
  authority: Readonly<{
    canPublish: false;
    canApprove: false;
    canExecute: false;
    canWriteMeta: false;
    canGrant: false;
    canCallTool: false;
    canAccessNetwork: false;
    canQuerySql: false;
  }>;
  draftHash: string;
}>;

type Confirmation = Readonly<{
  confirmed: true;
  confirmationRef: string;
  confirmedAt: string;
}>;

export type ProgressiveFormalizationTransitionInput =
  | Readonly<{
    schemaVersion: typeof PROGRESSIVE_FORMALIZATION_VERSION;
    transition: "capture_g0";
    workspaceRef: string;
    formalizationRef: string;
    occurredAt: string;
    actor: Readonly<{ actorRef: string; role: FormalizationActorRole }>;
    payload: Readonly<{ rawProvenanceRef: string; rawTextHash: string }>;
  }>
  | Readonly<{
    schemaVersion: typeof PROGRESSIVE_FORMALIZATION_VERSION;
    transition: "scope_g1";
    workspaceRef: string;
    formalizationRef: string;
    occurredAt: string;
    actor: Readonly<{ actorRef: string; role: FormalizationActorRole }>;
    payload: Readonly<{ guidanceCardRefs: readonly string[]; scope: FormalizationScope }>;
  }>
  | Readonly<{
    schemaVersion: typeof PROGRESSIVE_FORMALIZATION_VERSION;
    transition: "review_g2";
    workspaceRef: string;
    formalizationRef: string;
    occurredAt: string;
    actor: Readonly<{ actorRef: string; role: FormalizationActorRole }>;
    payload: Readonly<{ guidanceSetRef: string; reviewedGuidanceHash: string; confirmation: Confirmation }>;
  }>
  | Readonly<{
    schemaVersion: typeof PROGRESSIVE_FORMALIZATION_VERSION;
    transition: "promote_g3";
    workspaceRef: string;
    formalizationRef: string;
    occurredAt: string;
    actor: Readonly<{ actorRef: string; role: FormalizationActorRole }>;
    payload: Readonly<{ normalizedDraft: NormalizedPolicyDraft; confirmation: Confirmation }>;
  }>
  | Readonly<{
    schemaVersion: typeof PROGRESSIVE_FORMALIZATION_VERSION;
    transition: "qualify_g4";
    workspaceRef: string;
    formalizationRef: string;
    occurredAt: string;
    actor: Readonly<{ actorRef: string; role: FormalizationActorRole }>;
    payload: Readonly<{
      publishedPolicyRef: string;
      publishedPolicyHash: string;
      riskAssessmentRef: string;
      capPolicyRef: string;
      approvalPolicyRef: string;
      rolloutEvidenceRefs: readonly string[];
      actionValveRef: string;
      approvalMode: "approval_only";
      confirmation: Confirmation;
    }>;
  }>;

type FormalizationPayload = ProgressiveFormalizationTransitionInput["payload"];

export type ProgressiveFormalizationRevision = Readonly<{
  schemaVersion: typeof PROGRESSIVE_FORMALIZATION_VERSION;
  formalizationRef: string;
  workspaceRef: string;
  sequence: number;
  previousRevisionHash: "GENESIS" | string;
  fromLevel: FormalizationLevel | null;
  toLevel: FormalizationLevel;
  transition: ProgressiveFormalizationTransitionInput["transition"];
  occurredAt: string;
  actor: Readonly<{ actorRef: string; role: FormalizationActorRole }>;
  payload: FormalizationPayload;
  authority: Readonly<{
    canPublish: false;
    canApprove: false;
    canExecute: false;
    canWriteMeta: false;
    canGrant: false;
    canSchedule: false;
    canCallTool: false;
    canAccessNetwork: false;
    canQuerySql: false;
  }>;
  revisionHash: string;
}>;

export class ProgressiveFormalizationError extends Error {
  constructor(readonly code:
    | "invalid_input"
    | "invalid_transition"
    | "invalid_history"
    | "insufficient_role"
    | "confirmation_required"
    | "unresolved_semantics"
    | "incomplete_preview"
    | "authority_escalation") {
    super("Progressive formalization güvenli biçimde işlenemedi");
    this.name = "ProgressiveFormalizationError";
  }
}

const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const REASON = /^[a-z][a-z0-9_]{1,63}$/;
const HASH = /^[a-f0-9]{64}$/;
const ROLES = new Set<FormalizationActorRole>(["owner", "admin", "analyst"]);
const DRAFT_AUTHORITY = Object.freeze({ canPublish: false as const, canApprove: false as const,
  canExecute: false as const, canWriteMeta: false as const, canGrant: false as const,
  canCallTool: false as const, canAccessNetwork: false as const, canQuerySql: false as const });
const REVISION_AUTHORITY = Object.freeze({ ...DRAFT_AUTHORITY, canSchedule: false as const });

function fail(code: ProgressiveFormalizationError["code"] = "invalid_input"): never {
  throw new ProgressiveFormalizationError(code);
}

function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail();
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) fail();
}

function stable(value: unknown, seen = new Set<object>()): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail();
    return value;
  }
  if (!value || typeof value !== "object" || seen.has(value)) fail();
  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.map((entry) => stable(entry, seen));
    seen.delete(value);
    return result;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) fail();
  const result = Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, entry]) => [key, stable(entry, seen)]));
  seen.delete(value);
  return result;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
  }
  return value;
}

function ref(value: unknown): string {
  if (typeof value !== "string" || !REF.test(value) || value.includes("*") || value.includes("://")) fail();
  return value;
}

function hash(value: unknown): string {
  if (typeof value !== "string" || !HASH.test(value)) fail();
  return value;
}

function instant(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail();
  return value;
}

function naturalText(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.length > 2_000 || value.includes("\u0000")) fail();
  return value.trim();
}

function count(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 1_000_000_000) fail();
  return value as number;
}

function refs(value: unknown, minimum = 0): readonly string[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > 1_000) fail();
  const normalized = value.map(ref).sort();
  if (new Set(normalized).size !== normalized.length) fail();
  return Object.freeze(normalized);
}

function actor(value: unknown): Readonly<{ actorRef: string; role: FormalizationActorRole }> {
  exact(value, ["actorRef", "role"]);
  if (!ROLES.has(value.role as FormalizationActorRole)) fail("insufficient_role");
  return Object.freeze({ actorRef: ref(value.actorRef), role: value.role as FormalizationActorRole });
}

function confirmation(value: unknown, occurredAt: string): Confirmation {
  exact(value, ["confirmed", "confirmationRef", "confirmedAt"]);
  if (value.confirmed !== true) fail("confirmation_required");
  const confirmedAt = instant(value.confirmedAt);
  if (confirmedAt > occurredAt) fail("confirmation_required");
  return Object.freeze({ confirmed: true, confirmationRef: ref(value.confirmationRef), confirmedAt });
}

function scope(value: unknown): FormalizationScope {
  exact(value, ["global", "accountGroupRefs", "accountRefs", "objectiveRefs", "internalCategoryRefs", "entityRefs",
    "promotionTemplateRefs", "topicRefs"]);
  if (typeof value.global !== "boolean") fail();
  const result = Object.freeze({ global: value.global, accountGroupRefs: refs(value.accountGroupRefs),
    accountRefs: refs(value.accountRefs), objectiveRefs: refs(value.objectiveRefs),
    internalCategoryRefs: refs(value.internalCategoryRefs), entityRefs: refs(value.entityRefs),
    promotionTemplateRefs: refs(value.promotionTemplateRefs), topicRefs: refs(value.topicRefs) });
  const bounded = result.accountGroupRefs.length + result.accountRefs.length + result.objectiveRefs.length
    + result.internalCategoryRefs.length + result.entityRefs.length + result.promotionTemplateRefs.length
    + result.topicRefs.length;
  if (result.global ? bounded !== 0 : bounded === 0) fail();
  return result;
}

function assertNoAuthorityEscalation(authority: unknown, draft: boolean): void {
  const keys = draft
    ? ["canPublish", "canApprove", "canExecute", "canWriteMeta", "canGrant", "canCallTool", "canAccessNetwork", "canQuerySql"]
    : ["canPublish", "canApprove", "canExecute", "canWriteMeta", "canGrant", "canSchedule", "canCallTool", "canAccessNetwork", "canQuerySql"];
  exact(authority, keys);
  if (Object.values(authority).some((capability) => capability !== false)) fail("authority_escalation");
}

export function createNormalizedPolicyDraft(input: NormalizedPolicyDraftInput): NormalizedPolicyDraft {
  exact(input, ["schemaVersion", "workspaceRef", "formalizationRef", "guidanceSetRef", "strictPolicy", "assumptions",
    "questions", "semanticDiff", "historicalReplay", "conflictPreview", "impactPreview"]);
  if (input.schemaVersion !== NORMALIZED_POLICY_DRAFT_VERSION) fail();
  const workspaceRef = ref(input.workspaceRef);
  const formalizationRef = ref(input.formalizationRef);
  const guidanceSetRef = ref(input.guidanceSetRef);
  const strictPolicy = assertStrictInstructionPolicyArtifact(input.strictPolicy);
  if (strictPolicy.workspaceRef !== workspaceRef || strictPolicy.status !== "draft"
    || strictPolicy.source.promotedFromGuidanceRefs.length === 0) fail();

  if (!Array.isArray(input.assumptions) || input.assumptions.length > 100) fail();
  const assumptions = input.assumptions.map((entry) => {
    exact(entry, ["assumptionRef", "statement", "disposition"]);
    if (entry.disposition !== "accepted" && entry.disposition !== "rejected") fail();
    return Object.freeze({ assumptionRef: ref(entry.assumptionRef), statement: naturalText(entry.statement),
      disposition: entry.disposition });
  }).sort((left, right) => left.assumptionRef.localeCompare(right.assumptionRef));
  if (new Set(assumptions.map((entry) => entry.assumptionRef)).size !== assumptions.length) fail();

  if (!Array.isArray(input.questions) || input.questions.length > 100) fail();
  const questions = input.questions.map((entry) => {
    exact(entry, ["questionRef", "question", "answer"]);
    return Object.freeze({ questionRef: ref(entry.questionRef), question: naturalText(entry.question),
      answer: entry.answer === null ? null : naturalText(entry.answer) });
  }).sort((left, right) => left.questionRef.localeCompare(right.questionRef));
  if (new Set(questions.map((entry) => entry.questionRef)).size !== questions.length) fail();

  exact(input.semanticDiff, ["status", "items", "diffHash"]);
  if (input.semanticDiff.status !== "resolved" && input.semanticDiff.status !== "ambiguous"
    && input.semanticDiff.status !== "unknown") fail();
  if (!Array.isArray(input.semanticDiff.items) || input.semanticDiff.items.length === 0
    || input.semanticDiff.items.length > 200) fail();
  const diffItems = input.semanticDiff.items.map((entry) => {
    exact(entry, ["meaningRef", "sourceStatementHash", "normalizedClauseRef", "disposition", "reasonCode"]);
    if (entry.disposition !== "preserved" && entry.disposition !== "narrowed" && entry.disposition !== "excluded") fail();
    const normalizedClauseRef = entry.normalizedClauseRef === null ? null : ref(entry.normalizedClauseRef);
    if (entry.disposition === "excluded" ? normalizedClauseRef !== null : normalizedClauseRef === null) fail();
    if (typeof entry.reasonCode !== "string" || !REASON.test(entry.reasonCode)) fail();
    return Object.freeze({ meaningRef: ref(entry.meaningRef), sourceStatementHash: hash(entry.sourceStatementHash),
      normalizedClauseRef, disposition: entry.disposition, reasonCode: entry.reasonCode });
  }).sort((left, right) => left.meaningRef.localeCompare(right.meaningRef));
  if (new Set(diffItems.map((entry) => entry.meaningRef)).size !== diffItems.length) fail();
  const semanticDiff = Object.freeze({ status: input.semanticDiff.status, items: Object.freeze(diffItems),
    diffHash: hash(input.semanticDiff.diffHash) });

  exact(input.historicalReplay, ["status", "evaluatedRevisionRefs", "changedOutcomeRefs", "unknownOutcomeRefs", "replayHash"]);
  if (input.historicalReplay.status !== "complete" && input.historicalReplay.status !== "no_history"
    && input.historicalReplay.status !== "incomplete") fail();
  const historicalReplay = Object.freeze({ status: input.historicalReplay.status,
    evaluatedRevisionRefs: refs(input.historicalReplay.evaluatedRevisionRefs),
    changedOutcomeRefs: refs(input.historicalReplay.changedOutcomeRefs),
    unknownOutcomeRefs: refs(input.historicalReplay.unknownOutcomeRefs), replayHash: hash(input.historicalReplay.replayHash) });
  if (historicalReplay.status === "no_history" && (historicalReplay.evaluatedRevisionRefs.length !== 0
    || historicalReplay.changedOutcomeRefs.length !== 0 || historicalReplay.unknownOutcomeRefs.length !== 0)) fail();

  exact(input.conflictPreview, ["status", "conflictRefs", "previewHash"]);
  if (input.conflictPreview.status !== "clear" && input.conflictPreview.status !== "parked_conflict"
    && input.conflictPreview.status !== "unknown") fail();
  const conflictPreview = Object.freeze({ status: input.conflictPreview.status,
    conflictRefs: refs(input.conflictPreview.conflictRefs), previewHash: hash(input.conflictPreview.previewHash) });
  if (conflictPreview.status === "clear" ? conflictPreview.conflictRefs.length !== 0
    : conflictPreview.status === "parked_conflict" && conflictPreview.conflictRefs.length === 0) fail();

  exact(input.impactPreview, ["status", "affectedScopeRefs", "affectedEntityCount", "affectedPolicyCount",
    "affectedBudgetCount", "affectedAutomationCount", "unresolvedDependencyRefs", "previewHash"]);
  if (input.impactPreview.status !== "complete" && input.impactPreview.status !== "partial"
    && input.impactPreview.status !== "unknown") fail();
  const impactPreview = Object.freeze({ status: input.impactPreview.status,
    affectedScopeRefs: refs(input.impactPreview.affectedScopeRefs),
    affectedEntityCount: count(input.impactPreview.affectedEntityCount),
    affectedPolicyCount: count(input.impactPreview.affectedPolicyCount),
    affectedBudgetCount: count(input.impactPreview.affectedBudgetCount),
    affectedAutomationCount: count(input.impactPreview.affectedAutomationCount),
    unresolvedDependencyRefs: refs(input.impactPreview.unresolvedDependencyRefs), previewHash: hash(input.impactPreview.previewHash) });

  const core: NormalizedPolicyDraftInput = freeze({ schemaVersion: NORMALIZED_POLICY_DRAFT_VERSION,
    workspaceRef, formalizationRef, guidanceSetRef, strictPolicy, assumptions: Object.freeze(assumptions),
    questions: Object.freeze(questions), semanticDiff, historicalReplay, conflictPreview, impactPreview });
  const artifact = freeze({ ...core, authority: DRAFT_AUTHORITY });
  return freeze({ ...artifact, draftHash: digest(artifact) });
}

export function assertNormalizedPolicyDraftArtifact(value: unknown): NormalizedPolicyDraft {
  exact(value, ["schemaVersion", "workspaceRef", "formalizationRef", "guidanceSetRef", "strictPolicy", "assumptions",
    "questions", "semanticDiff", "historicalReplay", "conflictPreview", "impactPreview", "authority", "draftHash"]);
  assertNoAuthorityEscalation(value.authority, true);
  const input = Object.fromEntries(["schemaVersion", "workspaceRef", "formalizationRef", "guidanceSetRef", "strictPolicy",
    "assumptions", "questions", "semanticDiff", "historicalReplay", "conflictPreview", "impactPreview"]
    .map((key) => [key, value[key]])) as unknown as NormalizedPolicyDraftInput;
  const parsed = createNormalizedPolicyDraft(input);
  if (hash(value.draftHash) !== parsed.draftHash) fail("invalid_history");
  return parsed;
}

function validateTransitionInput(value: unknown): ProgressiveFormalizationTransitionInput {
  exact(value, ["schemaVersion", "transition", "workspaceRef", "formalizationRef", "occurredAt", "actor", "payload"]);
  if (value.schemaVersion !== PROGRESSIVE_FORMALIZATION_VERSION) fail();
  const common = { schemaVersion: PROGRESSIVE_FORMALIZATION_VERSION, workspaceRef: ref(value.workspaceRef),
    formalizationRef: ref(value.formalizationRef), occurredAt: instant(value.occurredAt), actor: actor(value.actor) };
  if (value.transition === "capture_g0") {
    exact(value.payload, ["rawProvenanceRef", "rawTextHash"]);
    return freeze({ ...common, transition: "capture_g0", payload: {
      rawProvenanceRef: ref(value.payload.rawProvenanceRef), rawTextHash: hash(value.payload.rawTextHash) } });
  }
  if (value.transition === "scope_g1") {
    exact(value.payload, ["guidanceCardRefs", "scope"]);
    return freeze({ ...common, transition: "scope_g1", payload: {
      guidanceCardRefs: refs(value.payload.guidanceCardRefs, 1), scope: scope(value.payload.scope) } });
  }
  if (value.transition === "review_g2") {
    exact(value.payload, ["guidanceSetRef", "reviewedGuidanceHash", "confirmation"]);
    return freeze({ ...common, transition: "review_g2", payload: { guidanceSetRef: ref(value.payload.guidanceSetRef),
      reviewedGuidanceHash: hash(value.payload.reviewedGuidanceHash),
      confirmation: confirmation(value.payload.confirmation, common.occurredAt) } });
  }
  if (value.transition === "promote_g3") {
    exact(value.payload, ["normalizedDraft", "confirmation"]);
    return freeze({ ...common, transition: "promote_g3", payload: {
      normalizedDraft: assertNormalizedPolicyDraftArtifact(value.payload.normalizedDraft),
      confirmation: confirmation(value.payload.confirmation, common.occurredAt) } });
  }
  if (value.transition === "qualify_g4") {
    exact(value.payload, ["publishedPolicyRef", "publishedPolicyHash", "riskAssessmentRef", "capPolicyRef",
      "approvalPolicyRef", "rolloutEvidenceRefs", "actionValveRef", "approvalMode", "confirmation"]);
    if (value.payload.approvalMode !== "approval_only") fail("authority_escalation");
    return freeze({ ...common, transition: "qualify_g4", payload: {
      publishedPolicyRef: ref(value.payload.publishedPolicyRef), publishedPolicyHash: hash(value.payload.publishedPolicyHash),
      riskAssessmentRef: ref(value.payload.riskAssessmentRef), capPolicyRef: ref(value.payload.capPolicyRef),
      approvalPolicyRef: ref(value.payload.approvalPolicyRef), rolloutEvidenceRefs: refs(value.payload.rolloutEvidenceRefs, 1),
      actionValveRef: ref(value.payload.actionValveRef), approvalMode: "approval_only",
      confirmation: confirmation(value.payload.confirmation, common.occurredAt) } });
  }
  return fail("invalid_transition");
}

function expectedTransition(previous: ProgressiveFormalizationRevision | null): Readonly<{
  transition: ProgressiveFormalizationTransitionInput["transition"];
  fromLevel: FormalizationLevel | null;
  toLevel: FormalizationLevel;
}> {
  if (previous === null) return { transition: "capture_g0", fromLevel: null, toLevel: "G0" };
  if (previous.toLevel === "G0") return { transition: "scope_g1", fromLevel: "G0", toLevel: "G1" };
  if (previous.toLevel === "G1") return { transition: "review_g2", fromLevel: "G1", toLevel: "G2" };
  if (previous.toLevel === "G2") return { transition: "promote_g3", fromLevel: "G2", toLevel: "G3" };
  if (previous.toLevel === "G3") return { transition: "qualify_g4", fromLevel: "G3", toLevel: "G4" };
  return fail("invalid_transition");
}

export function advanceProgressiveFormalization(
  previous: ProgressiveFormalizationRevision | null,
  rawInput: ProgressiveFormalizationTransitionInput,
): ProgressiveFormalizationRevision {
  const input = validateTransitionInput(rawInput);
  const expected = expectedTransition(previous);
  if (input.transition !== expected.transition) fail("invalid_transition");
  if (previous !== null && (previous.workspaceRef !== input.workspaceRef
    || previous.formalizationRef !== input.formalizationRef || input.occurredAt < previous.occurredAt)) fail("invalid_history");
  if ((input.transition === "review_g2" || input.transition === "promote_g3" || input.transition === "qualify_g4")
    && input.actor.role !== "owner" && input.actor.role !== "admin") fail("insufficient_role");

  if (input.transition === "promote_g3") {
    const draft = input.payload.normalizedDraft;
    if (draft.workspaceRef !== input.workspaceRef || draft.formalizationRef !== input.formalizationRef
      || draft.guidanceSetRef !== (previous!.payload as Extract<FormalizationPayload, { guidanceSetRef: string }>).guidanceSetRef) {
      fail("invalid_history");
    }
    if (draft.semanticDiff.status !== "resolved" || draft.questions.some((entry) => entry.answer === null)) {
      fail("unresolved_semantics");
    }
    if ((draft.historicalReplay.status !== "complete" && draft.historicalReplay.status !== "no_history")
      || draft.historicalReplay.unknownOutcomeRefs.length !== 0 || draft.conflictPreview.status === "unknown"
      || draft.impactPreview.status !== "complete" || draft.impactPreview.unresolvedDependencyRefs.length !== 0) {
      fail("incomplete_preview");
    }
  }

  const sequence = previous === null ? 1 : previous.sequence + 1;
  const core = freeze({ schemaVersion: PROGRESSIVE_FORMALIZATION_VERSION, formalizationRef: input.formalizationRef,
    workspaceRef: input.workspaceRef, sequence, previousRevisionHash: previous?.revisionHash ?? "GENESIS",
    fromLevel: expected.fromLevel, toLevel: expected.toLevel, transition: input.transition,
    occurredAt: input.occurredAt, actor: input.actor, payload: input.payload, authority: REVISION_AUTHORITY });
  return freeze({ ...core, revisionHash: digest(core) });
}

export function replayProgressiveFormalization(
  revisions: readonly ProgressiveFormalizationRevision[],
): Readonly<{ level: FormalizationLevel; headHash: string; revisions: readonly ProgressiveFormalizationRevision[] }> {
  if (!Array.isArray(revisions) || revisions.length === 0 || revisions.length > 5) fail("invalid_history");
  let previous: ProgressiveFormalizationRevision | null = null;
  const replayed: ProgressiveFormalizationRevision[] = [];
  for (const candidate of revisions) {
    exact(candidate, ["schemaVersion", "formalizationRef", "workspaceRef", "sequence", "previousRevisionHash", "fromLevel",
      "toLevel", "transition", "occurredAt", "actor", "payload", "authority", "revisionHash"]);
    assertNoAuthorityEscalation(candidate.authority, false);
    const rebuilt = advanceProgressiveFormalization(previous, {
      schemaVersion: candidate.schemaVersion, transition: candidate.transition, workspaceRef: candidate.workspaceRef,
      formalizationRef: candidate.formalizationRef, occurredAt: candidate.occurredAt, actor: candidate.actor,
      payload: candidate.payload,
    } as ProgressiveFormalizationTransitionInput);
    if (candidate.sequence !== rebuilt.sequence || candidate.previousRevisionHash !== rebuilt.previousRevisionHash
      || candidate.fromLevel !== rebuilt.fromLevel || candidate.toLevel !== rebuilt.toLevel
      || hash(candidate.revisionHash) !== rebuilt.revisionHash) fail("invalid_history");
    replayed.push(rebuilt);
    previous = rebuilt;
  }
  return freeze({ level: previous!.toLevel, headHash: previous!.revisionHash, revisions: Object.freeze(replayed) });
}
