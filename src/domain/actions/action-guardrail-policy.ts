import { createHash } from "node:crypto";

import type { ActionEntity, ActionType } from "@/domain/actions/autonomy-valve";

export const ACTION_GUARDRAIL_POLICY_VERSION = "action-guardrail-policy/1.0.0" as const;
export const PROTECTION_RESOLUTION_VERSION = "protection-resolution/1.0.0" as const;

export type GuardrailActionType = Extract<ActionType,
  "status_pause" | "status_activate" | "budget_decrease" | "budget_increase" | "existing_post_promotion">;
export type ActionGuardrailPolicyState = "draft" | "published" | "disabled";
export type GuardrailAuthorRole = "owner" | "admin" | "analyst";
export type GuardrailPublisherRole = "owner" | "admin";

export type ActionGuardrailSelector = Readonly<{
  actionTypes: readonly GuardrailActionType[];
  accountRefs: readonly string[];
  campaignRefs: readonly string[];
  entities: readonly ActionEntity[];
  internalCategoryRefs: readonly string[];
  geoRefs: readonly string[];
}>;

export type ActionGuardrailClause =
  | Readonly<{ clauseRef: string; kind: "deny_action" }>
  | Readonly<{
    clauseRef: string;
    kind: "budget_delta_limit";
    currency: string;
    maximumAbsoluteDeltaDecimal: string | null;
    maximumRelativeDeltaBasisPoints: number | null;
  }>
  | Readonly<{
    clauseRef: string;
    kind: "protect_budget";
    dimension: "internal_category" | "geo";
    refs: readonly string[];
    behavior: "fixed" | "no_outflow";
  }>;

export type ActionGuardrailPolicyRevision = Readonly<{
  version: typeof ACTION_GUARDRAIL_POLICY_VERSION;
  workspaceRef: string;
  policyRef: string;
  revision: number;
  previousHash: string | null;
  state: ActionGuardrailPolicyState;
  effectiveFrom: string;
  expiresAt: string | null;
  defaultDisposition: "allow_if_no_matching_deny";
  selector: ActionGuardrailSelector;
  clauses: readonly ActionGuardrailClause[];
  provenance: Readonly<{
    normalizedByActorRef: string;
    normalizedByRole: GuardrailAuthorRole;
    sourceGuidanceRefs: readonly string[];
    publishedByActorRef: string | null;
    publishedByRole: GuardrailPublisherRole | null;
    publicationDecisionRef: string | null;
    publicationReasonRef: string | null;
    publishedAt: string | null;
    disabledByActorRef: string | null;
    disabledByRole: GuardrailPublisherRole | null;
    disableDecisionRef: string | null;
    disableReasonRef: string | null;
    disabledAt: string | null;
  }>;
  authority: Readonly<{
    canApprove: false;
    canExecute: false;
    canWriteMeta: false;
    canGrantApproval: false;
    canPromoteGuidance: false;
  }>;
  canonicalHash: string;
}>;

export type ActionGuardrailDraftInput = Readonly<{
  workspaceRef: string;
  policyRef: string;
  revision: number;
  previousHash: string | null;
  effectiveFrom: string;
  expiresAt: string | null;
  selector: ActionGuardrailSelector;
  clauses: readonly ActionGuardrailClause[];
  normalizedBy: Readonly<{ actorRef: string; role: GuardrailAuthorRole }>;
  sourceGuidanceRefs: readonly string[];
}>;

type ScopedEvidence =
  | Readonly<{ status: "known"; refs: readonly string[]; evidenceHash: string }>
  | Readonly<{ status: "unknown"; reasonRef: string }>;

export type ProtectionResolutionInput = Readonly<{
  workspaceRef: string;
  evaluatedAt: string;
  action: Readonly<{
    actionHash: string;
    actionType: GuardrailActionType;
    accountRef: string;
    campaignRef: string;
    entity: ActionEntity;
    budgetChange: Readonly<{
      currency: string;
      absoluteDeltaDecimal: string;
      relativeDeltaBasisPoints: number | null;
    }> | null;
  }>;
  categoryEvidence: ScopedEvidence;
  affectedGeoEvidence: ScopedEvidence;
  revisions: readonly ActionGuardrailPolicyRevision[];
}>;

export type ProtectionResolution = Readonly<{
  version: typeof PROTECTION_RESOLUTION_VERSION;
  workspaceRef: string;
  evaluatedAt: string;
  actionHash: string;
  actionType: GuardrailActionType;
  disposition: "allowed" | "denied" | "unresolved";
  reasonCodes: readonly string[];
  protectedInternalCategoryRefs: readonly string[];
  affectedGeoRefs: readonly string[];
  protectedGeoRefs: readonly string[];
  categoryEvidenceHash: string | null;
  affectedGeoEvidenceHash: string | null;
  /** Binds normalized action facts and evidence refs to this evaluation, even if a caller reuses actionHash. */
  evaluationContextHash: string;
  policySetHash: string;
  policyEvidence: readonly Readonly<{
    policyRef: string;
    revision: number;
    canonicalHash: string;
    expiresAt: string | null;
    clauseRefs: readonly string[];
  }>[];
  capabilities: Readonly<{ canApprove: false; canExecute: false; canWriteMeta: false; canGrantApproval: false }>;
  resolutionHash: string;
}>;

export class ActionGuardrailPolicyError extends Error {
  constructor(readonly code:
    | "invalid_input"
    | "invalid_transition"
    | "publish_forbidden"
    | "workspace_scope_mismatch"
    | "corrupt_registry") {
    super("Action guardrail policy güvenli biçimde işlenemedi");
    this.name = "ActionGuardrailPolicyError";
  }
}

const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const HASH = /^[a-f0-9]{64}$/;
const DECIMAL = /^(0|[1-9]\d{0,29})(?:\.\d{1,12})?$/;
const CURRENCY = /^[A-Z]{3}$/;
const ACTION_TYPES: readonly GuardrailActionType[] = [
  "status_pause", "status_activate", "budget_decrease", "budget_increase", "existing_post_promotion",
];
const BUDGET_ACTIONS: readonly GuardrailActionType[] = ["budget_decrease", "budget_increase"];
const AUTHORITY = Object.freeze({ canApprove: false as const, canExecute: false as const, canWriteMeta: false as const,
  canGrantApproval: false as const, canPromoteGuidance: false as const });
const RESOLUTION_CAPABILITIES = Object.freeze({ canApprove: false as const, canExecute: false as const,
  canWriteMeta: false as const, canGrantApproval: false as const });

function fail(code: ActionGuardrailPolicyError["code"]): never { throw new ActionGuardrailPolicyError(code); }
function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype
    || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) fail("invalid_input");
}
function ref(value: unknown): string {
  if (typeof value !== "string" || !REF.test(value) || value.includes("*")
    || /(token|secret|prompt|raw[_-]?(payload|request|response|json)|free[_-]?text)/i.test(value)) fail("invalid_input");
  return value;
}
function instant(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) fail("invalid_input");
  const normalized = new Date(value).toISOString();
  if (normalized !== value) fail("invalid_input");
  return normalized;
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, child]) => [key, stable(child)]));
  return value;
}
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
  }
  return value;
}
function refs(value: unknown, allowEmpty = true): readonly string[] {
  if (!Array.isArray(value) || !allowEmpty && value.length === 0 || value.length > 500) fail("invalid_input");
  const normalized = value.map(ref).sort();
  if (new Set(normalized).size !== normalized.length) fail("invalid_input");
  return Object.freeze(normalized);
}
function hash(value: unknown): string { if (typeof value !== "string" || !HASH.test(value)) fail("invalid_input"); return value; }

function normalizeSelector(value: unknown): ActionGuardrailSelector {
  exact(value, ["actionTypes", "accountRefs", "campaignRefs", "entities", "internalCategoryRefs", "geoRefs"]);
  if (!Array.isArray(value.actionTypes) || value.actionTypes.length === 0 || value.actionTypes.length > ACTION_TYPES.length
    || value.actionTypes.some((item) => !ACTION_TYPES.includes(item as GuardrailActionType))) fail("invalid_input");
  const actionTypes = [...value.actionTypes as GuardrailActionType[]].sort();
  if (new Set(actionTypes).size !== actionTypes.length || !Array.isArray(value.entities) || value.entities.length > 500) fail("invalid_input");
  const entities = value.entities.map((raw) => {
    exact(raw, ["level", "ref"]);
    if (!(["campaign", "adset", "ad"] as const).includes(raw.level as ActionEntity["level"])) fail("invalid_input");
    return Object.freeze({ level: raw.level as ActionEntity["level"], ref: ref(raw.ref) });
  }).sort((left, right) => left.level.localeCompare(right.level) || left.ref.localeCompare(right.ref));
  if (new Set(entities.map((entity) => `${entity.level}:${entity.ref}`)).size !== entities.length) fail("invalid_input");
  return freeze({ actionTypes, accountRefs: refs(value.accountRefs), campaignRefs: refs(value.campaignRefs), entities,
    internalCategoryRefs: refs(value.internalCategoryRefs), geoRefs: refs(value.geoRefs) });
}

function normalizeClauses(value: unknown, actionTypes: readonly GuardrailActionType[]): readonly ActionGuardrailClause[] {
  if (!Array.isArray(value) || value.length > 500) fail("invalid_input");
  const clauses = value.map((raw): ActionGuardrailClause => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) fail("invalid_input");
    const clause = raw as Record<string, unknown>;
    if (clause.kind === "deny_action") {
      exact(raw, ["clauseRef", "kind"]);
      return Object.freeze({ clauseRef: ref(clause.clauseRef), kind: "deny_action" as const });
    }
    if (clause.kind === "budget_delta_limit") {
      exact(raw, ["clauseRef", "kind", "currency", "maximumAbsoluteDeltaDecimal", "maximumRelativeDeltaBasisPoints"]);
      if (!actionTypes.some((type) => BUDGET_ACTIONS.includes(type)) || typeof clause.currency !== "string" || !CURRENCY.test(clause.currency)
        || clause.maximumAbsoluteDeltaDecimal !== null && (typeof clause.maximumAbsoluteDeltaDecimal !== "string"
          || !DECIMAL.test(clause.maximumAbsoluteDeltaDecimal))
        || clause.maximumRelativeDeltaBasisPoints !== null && (!Number.isSafeInteger(clause.maximumRelativeDeltaBasisPoints)
          || (clause.maximumRelativeDeltaBasisPoints as number) < 1 || (clause.maximumRelativeDeltaBasisPoints as number) > 1_000_000)
        || clause.maximumAbsoluteDeltaDecimal === null && clause.maximumRelativeDeltaBasisPoints === null) fail("invalid_input");
      return Object.freeze({ clauseRef: ref(clause.clauseRef), kind: "budget_delta_limit" as const,
        currency: clause.currency, maximumAbsoluteDeltaDecimal: clause.maximumAbsoluteDeltaDecimal as string | null,
        maximumRelativeDeltaBasisPoints: clause.maximumRelativeDeltaBasisPoints as number | null });
    }
    if (clause.kind === "protect_budget") {
      exact(raw, ["clauseRef", "kind", "dimension", "refs", "behavior"]);
      if (!actionTypes.some((type) => BUDGET_ACTIONS.includes(type))
        || !["internal_category", "geo"].includes(clause.dimension as string)
        || !["fixed", "no_outflow"].includes(clause.behavior as string)) fail("invalid_input");
      return Object.freeze({ clauseRef: ref(clause.clauseRef), kind: "protect_budget" as const,
        dimension: clause.dimension as "internal_category" | "geo", refs: refs(clause.refs, false),
        behavior: clause.behavior as "fixed" | "no_outflow" });
    }
    return fail("invalid_input");
  }).sort((left, right) => left.clauseRef.localeCompare(right.clauseRef));
  if (new Set(clauses.map((clause) => clause.clauseRef)).size !== clauses.length) fail("invalid_input");
  return Object.freeze(clauses);
}

function emptyProvenance(input: ActionGuardrailDraftInput): ActionGuardrailPolicyRevision["provenance"] {
  exact(input.normalizedBy, ["actorRef", "role"]);
  if (!(["owner", "admin", "analyst"] as const).includes(input.normalizedBy.role)) fail("invalid_input");
  return Object.freeze({ normalizedByActorRef: ref(input.normalizedBy.actorRef), normalizedByRole: input.normalizedBy.role,
    sourceGuidanceRefs: refs(input.sourceGuidanceRefs), publishedByActorRef: null, publishedByRole: null,
    publicationDecisionRef: null, publicationReasonRef: null, publishedAt: null, disabledByActorRef: null,
    disabledByRole: null, disableDecisionRef: null, disableReasonRef: null, disabledAt: null });
}

function artifact(core: Omit<ActionGuardrailPolicyRevision, "canonicalHash">): ActionGuardrailPolicyRevision {
  const frozen = freeze({ ...core, authority: AUTHORITY });
  return freeze({ ...frozen, canonicalHash: digest(frozen) });
}

export function createActionGuardrailPolicyDraft(input: ActionGuardrailDraftInput): ActionGuardrailPolicyRevision {
  exact(input, ["workspaceRef", "policyRef", "revision", "previousHash", "effectiveFrom", "expiresAt", "selector", "clauses",
    "normalizedBy", "sourceGuidanceRefs"]);
  if (!Number.isSafeInteger(input.revision) || input.revision < 1 || input.revision > 1_000_000
    || (input.revision === 1 ? input.previousHash !== null
      : typeof input.previousHash !== "string" || !HASH.test(input.previousHash))) fail("invalid_input");
  const effectiveFrom = instant(input.effectiveFrom);
  const expiresAt = input.expiresAt === null ? null : instant(input.expiresAt);
  if (expiresAt !== null && expiresAt <= effectiveFrom) fail("invalid_input");
  const selector = normalizeSelector(input.selector);
  return artifact({ version: ACTION_GUARDRAIL_POLICY_VERSION, workspaceRef: ref(input.workspaceRef), policyRef: ref(input.policyRef),
    revision: input.revision, previousHash: input.previousHash, state: "draft", effectiveFrom, expiresAt,
    defaultDisposition: "allow_if_no_matching_deny", selector, clauses: normalizeClauses(input.clauses, selector.actionTypes),
    provenance: emptyProvenance(input), authority: AUTHORITY });
}

export function reviseActionGuardrailPolicyDraft(input: Readonly<{
  current: ActionGuardrailPolicyRevision;
  effectiveFrom: string;
  expiresAt: string | null;
  selector: ActionGuardrailSelector;
  clauses: readonly ActionGuardrailClause[];
  normalizedBy: Readonly<{ actorRef: string; role: GuardrailAuthorRole }>;
  sourceGuidanceRefs: readonly string[];
}>): ActionGuardrailPolicyRevision {
  exact(input, ["current", "effectiveFrom", "expiresAt", "selector", "clauses", "normalizedBy", "sourceGuidanceRefs"]);
  const current = assertValidActionGuardrailPolicyRevision(input.current);
  if (current.state !== "published" && current.state !== "disabled") fail("invalid_transition");
  return createActionGuardrailPolicyDraft({ workspaceRef: current.workspaceRef, policyRef: current.policyRef,
    revision: current.revision + 1, previousHash: current.canonicalHash, effectiveFrom: input.effectiveFrom,
    expiresAt: input.expiresAt, selector: input.selector, clauses: input.clauses,
    normalizedBy: input.normalizedBy, sourceGuidanceRefs: input.sourceGuidanceRefs });
}

export function publishActionGuardrailPolicy(input: Readonly<{
  draft: ActionGuardrailPolicyRevision;
  actor: Readonly<{ actorRef: string; role: GuardrailPublisherRole }>;
  decisionRef: string;
  reasonRef: string;
  publishedAt: string;
}>): ActionGuardrailPolicyRevision {
  exact(input, ["draft", "actor", "decisionRef", "reasonRef", "publishedAt"]); exact(input.actor, ["actorRef", "role"]);
  const draft = assertValidActionGuardrailPolicyRevision(input.draft);
  if (draft.state !== "draft") fail("invalid_transition");
  if (!(["owner", "admin"] as const).includes(input.actor.role)) fail("publish_forbidden");
  const { canonicalHash: _hash, ...core } = draft;
  return artifact({ ...core, revision: draft.revision + 1, previousHash: draft.canonicalHash, state: "published",
    provenance: Object.freeze({ ...draft.provenance, publishedByActorRef: ref(input.actor.actorRef), publishedByRole: input.actor.role,
      publicationDecisionRef: ref(input.decisionRef), publicationReasonRef: ref(input.reasonRef), publishedAt: instant(input.publishedAt) }),
    authority: AUTHORITY });
}

export function disableActionGuardrailPolicy(input: Readonly<{
  current: ActionGuardrailPolicyRevision;
  actor: Readonly<{ actorRef: string; role: GuardrailPublisherRole }>;
  decisionRef: string;
  reasonRef: string;
  disabledAt: string;
}>): ActionGuardrailPolicyRevision {
  exact(input, ["current", "actor", "decisionRef", "reasonRef", "disabledAt"]); exact(input.actor, ["actorRef", "role"]);
  const current = assertValidActionGuardrailPolicyRevision(input.current);
  if (current.state !== "published") fail("invalid_transition");
  if (!(["owner", "admin"] as const).includes(input.actor.role)) fail("publish_forbidden");
  const disabledAt = instant(input.disabledAt);
  if (current.provenance.publishedAt === null || disabledAt < current.provenance.publishedAt) fail("invalid_input");
  const { canonicalHash: _hash, ...core } = current;
  return artifact({ ...core, revision: current.revision + 1, previousHash: current.canonicalHash, state: "disabled",
    provenance: Object.freeze({ ...current.provenance, disabledByActorRef: ref(input.actor.actorRef), disabledByRole: input.actor.role,
      disableDecisionRef: ref(input.decisionRef), disableReasonRef: ref(input.reasonRef), disabledAt }), authority: AUTHORITY });
}

export function assertValidActionGuardrailPolicyRevision(value: unknown): ActionGuardrailPolicyRevision {
  exact(value, ["version", "workspaceRef", "policyRef", "revision", "previousHash", "state", "effectiveFrom", "expiresAt",
    "defaultDisposition", "selector", "clauses", "provenance", "authority", "canonicalHash"]);
  const candidate = value as unknown as ActionGuardrailPolicyRevision;
  exact(candidate.provenance, ["normalizedByActorRef", "normalizedByRole", "sourceGuidanceRefs", "publishedByActorRef",
    "publishedByRole", "publicationDecisionRef", "publicationReasonRef", "publishedAt", "disabledByActorRef", "disabledByRole",
    "disableDecisionRef", "disableReasonRef", "disabledAt"]);
  exact(candidate.authority, ["canApprove", "canExecute", "canWriteMeta", "canGrantApproval", "canPromoteGuidance"]);
  if (candidate.version !== ACTION_GUARDRAIL_POLICY_VERSION || !["draft", "published", "disabled"].includes(candidate.state)
    || candidate.defaultDisposition !== "allow_if_no_matching_deny" || !Number.isSafeInteger(candidate.revision)
    || candidate.revision < 1 || candidate.revision > 1_000_000 || !HASH.test(candidate.canonicalHash)
    || candidate.authority.canApprove || candidate.authority.canExecute || candidate.authority.canWriteMeta
    || candidate.authority.canGrantApproval || candidate.authority.canPromoteGuidance) fail("invalid_input");
  if (candidate.revision === 1 ? candidate.previousHash !== null
    : typeof candidate.previousHash !== "string" || !HASH.test(candidate.previousHash)) fail("invalid_input");
  const selector = normalizeSelector(candidate.selector); const clauses = normalizeClauses(candidate.clauses, selector.actionTypes);
  const workspaceRef = ref(candidate.workspaceRef); const policyRef = ref(candidate.policyRef);
  const effectiveFrom = instant(candidate.effectiveFrom); const expiresAt = candidate.expiresAt === null ? null : instant(candidate.expiresAt);
  if (expiresAt !== null && expiresAt <= effectiveFrom || !(["owner", "admin", "analyst"] as const).includes(candidate.provenance.normalizedByRole)) fail("invalid_input");
  ref(candidate.provenance.normalizedByActorRef); const sourceGuidanceRefs = refs(candidate.provenance.sourceGuidanceRefs);
  const publication = [candidate.provenance.publishedByActorRef, candidate.provenance.publishedByRole,
    candidate.provenance.publicationDecisionRef, candidate.provenance.publicationReasonRef, candidate.provenance.publishedAt];
  const disabling = [candidate.provenance.disabledByActorRef, candidate.provenance.disabledByRole,
    candidate.provenance.disableDecisionRef, candidate.provenance.disableReasonRef, candidate.provenance.disabledAt];
  if (candidate.state === "draft") {
    if (publication.some((item) => item !== null) || disabling.some((item) => item !== null)) fail("invalid_input");
  } else {
    if (candidate.provenance.publishedByActorRef === null || candidate.provenance.publishedByRole === null
      || candidate.provenance.publicationDecisionRef === null || candidate.provenance.publicationReasonRef === null
      || candidate.provenance.publishedAt === null || !(["owner", "admin"] as const).includes(candidate.provenance.publishedByRole)) fail("invalid_input");
    ref(candidate.provenance.publishedByActorRef); ref(candidate.provenance.publicationDecisionRef);
    ref(candidate.provenance.publicationReasonRef); instant(candidate.provenance.publishedAt);
    if (candidate.state === "published" && disabling.some((item) => item !== null)) fail("invalid_input");
    if (candidate.state === "disabled") {
      if (candidate.provenance.disabledByActorRef === null || candidate.provenance.disabledByRole === null
        || candidate.provenance.disableDecisionRef === null || candidate.provenance.disableReasonRef === null
        || candidate.provenance.disabledAt === null || !(["owner", "admin"] as const).includes(candidate.provenance.disabledByRole)) fail("invalid_input");
      ref(candidate.provenance.disabledByActorRef); ref(candidate.provenance.disableDecisionRef); ref(candidate.provenance.disableReasonRef);
      if (instant(candidate.provenance.disabledAt) < instant(candidate.provenance.publishedAt)) fail("invalid_input");
    }
  }
  const { canonicalHash, ...core } = candidate;
  const normalizedCore = { ...core, workspaceRef, policyRef, effectiveFrom, expiresAt, selector, clauses,
    provenance: Object.freeze({ ...candidate.provenance, sourceGuidanceRefs }), authority: AUTHORITY };
  if (digest(normalizedCore) !== canonicalHash) fail("corrupt_registry");
  return artifact(normalizedCore);
}

function evidence(value: unknown): ScopedEvidence {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("invalid_input");
  const candidate = value as Record<string, unknown>;
  if (candidate.status === "unknown") { exact(value, ["status", "reasonRef"]); return Object.freeze({ status: "unknown", reasonRef: ref(candidate.reasonRef) }); }
  if (candidate.status === "known") {
    exact(value, ["status", "refs", "evidenceHash"]);
    return Object.freeze({ status: "known", refs: refs(candidate.refs), evidenceHash: hash(candidate.evidenceHash) });
  }
  return fail("invalid_input");
}
function decimalUnits(value: string): Readonly<{ coefficient: bigint; scale: number }> {
  if (!DECIMAL.test(value)) fail("invalid_input"); const [whole, fraction = ""] = value.split(".");
  return { coefficient: BigInt(`${whole}${fraction}`), scale: fraction.length };
}
function greaterThan(left: string, right: string): boolean {
  const a = decimalUnits(left); const b = decimalUnits(right); const scale = Math.max(a.scale, b.scale);
  return a.coefficient * 10n ** BigInt(scale - a.scale) > b.coefficient * 10n ** BigInt(scale - b.scale);
}
function intersects(left: readonly string[], right: readonly string[]): boolean { const set = new Set(left); return right.some((item) => set.has(item)); }
function selectorMatches(selector: ActionGuardrailSelector, input: ProtectionResolutionInput, categories: readonly string[], geos: readonly string[]): boolean {
  const action = input.action;
  return selector.actionTypes.includes(action.actionType)
    && (selector.accountRefs.length === 0 || selector.accountRefs.includes(action.accountRef))
    && (selector.campaignRefs.length === 0 || selector.campaignRefs.includes(action.campaignRef))
    && (selector.entities.length === 0 || selector.entities.some((entity) => entity.level === action.entity.level && entity.ref === action.entity.ref))
    && (selector.internalCategoryRefs.length === 0 || intersects(selector.internalCategoryRefs, categories))
    && (selector.geoRefs.length === 0 || intersects(selector.geoRefs, geos));
}

function resolution(core: Omit<ProtectionResolution, "version" | "capabilities" | "resolutionHash">): ProtectionResolution {
  const envelope = freeze({ version: PROTECTION_RESOLUTION_VERSION, ...core, capabilities: RESOLUTION_CAPABILITIES });
  return freeze({ ...envelope, resolutionHash: digest(envelope) });
}

/** Pure, side-effect-free resolver. Registry loading and evidence materialization remain server-private ports. */
export function resolveProtection(input: ProtectionResolutionInput): ProtectionResolution {
  exact(input, ["workspaceRef", "evaluatedAt", "action", "categoryEvidence", "affectedGeoEvidence", "revisions"]);
  exact(input.action, ["actionHash", "actionType", "accountRef", "campaignRef", "entity", "budgetChange"]);
  const workspaceRef = ref(input.workspaceRef); const evaluatedAt = instant(input.evaluatedAt); hash(input.action.actionHash);
  if (!ACTION_TYPES.includes(input.action.actionType)) fail("invalid_input"); ref(input.action.accountRef); ref(input.action.campaignRef);
  exact(input.action.entity, ["level", "ref"]); if (!(["campaign", "adset", "ad"] as const).includes(input.action.entity.level)) fail("invalid_input"); ref(input.action.entity.ref);
  const isBudget = BUDGET_ACTIONS.includes(input.action.actionType);
  if (isBudget) {
    exact(input.action.budgetChange, ["currency", "absoluteDeltaDecimal", "relativeDeltaBasisPoints"]);
    if (!CURRENCY.test(input.action.budgetChange.currency) || !DECIMAL.test(input.action.budgetChange.absoluteDeltaDecimal)
      || input.action.budgetChange.relativeDeltaBasisPoints !== null && (!Number.isSafeInteger(input.action.budgetChange.relativeDeltaBasisPoints)
        || input.action.budgetChange.relativeDeltaBasisPoints < 0 || input.action.budgetChange.relativeDeltaBasisPoints > 1_000_000)) fail("invalid_input");
  } else if (input.action.budgetChange !== null) fail("invalid_input");
  const categoryEvidence = evidence(input.categoryEvidence); const geoEvidence = evidence(input.affectedGeoEvidence);
  if (!Array.isArray(input.revisions) || input.revisions.length > 10_000) fail("invalid_input");

  const chains = new Map<string, ActionGuardrailPolicyRevision[]>();
  for (const raw of input.revisions) {
    const revision = assertValidActionGuardrailPolicyRevision(raw);
    if (revision.workspaceRef !== workspaceRef) fail("workspace_scope_mismatch");
    const chain = chains.get(revision.policyRef) ?? []; chain.push(revision); chains.set(revision.policyRef, chain);
  }
  const latestLifecycle: ActionGuardrailPolicyRevision[] = [];
  for (const chain of chains.values()) {
    chain.sort((left, right) => left.revision - right.revision);
    for (let index = 0; index < chain.length; index += 1) {
      const current = chain[index]!; const previous = chain[index - 1] ?? null;
      if (current.revision !== index + 1 || current.previousHash !== (previous?.canonicalHash ?? null)
        || (previous === null && current.state !== "draft")
        || (previous?.state === "draft" && current.state !== "published")
        || (previous?.state === "published" && current.state !== "draft" && current.state !== "disabled")
        || (previous?.state === "disabled" && current.state !== "draft")) fail("corrupt_registry");
    }
    const latest = [...chain].reverse().find((item) => item.state !== "draft");
    if (latest) latestLifecycle.push(latest);
  }
  latestLifecycle.sort((left, right) => left.policyRef.localeCompare(right.policyRef));
  const policySetHash = digest(latestLifecycle.map((item) => ({ policyRef: item.policyRef, revision: item.revision,
    state: item.state, canonicalHash: item.canonicalHash })));
  const evaluationContextHash = digest({ action: input.action, categoryEvidence, affectedGeoEvidence: geoEvidence });
  const base = { workspaceRef, evaluatedAt, actionHash: input.action.actionHash, actionType: input.action.actionType,
    protectedInternalCategoryRefs: [] as string[], affectedGeoRefs: geoEvidence.status === "known" ? [...geoEvidence.refs] : [],
    protectedGeoRefs: [] as string[], categoryEvidenceHash: categoryEvidence.status === "known" ? categoryEvidence.evidenceHash : null,
    affectedGeoEvidenceHash: geoEvidence.status === "known" ? geoEvidence.evidenceHash : null, evaluationContextHash, policySetHash,
    policyEvidence: [] as ProtectionResolution["policyEvidence"] };
  if (categoryEvidence.status === "unknown" || geoEvidence.status === "unknown") {
    return resolution({ ...base, disposition: "unresolved", reasonCodes: Object.freeze([
      ...(categoryEvidence.status === "unknown" ? ["category_evidence_unknown"] : []),
      ...(geoEvidence.status === "unknown" ? ["affected_geo_evidence_unknown"] : []),
    ]) });
  }
  const active = latestLifecycle.filter((item) => item.state === "published" && item.effectiveFrom <= evaluatedAt
    && (item.expiresAt === null || item.expiresAt > evaluatedAt));
  if (active.length === 0) return resolution({ ...base, disposition: "unresolved", reasonCodes: Object.freeze([
    latestLifecycle.length === 0 ? "policy_set_missing" : "policy_set_inactive",
  ]) });
  const matched = active.filter((item) => selectorMatches(item.selector, input, categoryEvidence.refs, geoEvidence.refs));
  if (matched.length === 0) return resolution({ ...base, disposition: "unresolved", reasonCodes: Object.freeze(["policy_coverage_missing"]) });
  const selectorKeys = new Set<string>();
  for (const policy of matched) {
    const key = digest(policy.selector);
    if (selectorKeys.has(key)) return resolution({ ...base, disposition: "unresolved", reasonCodes: Object.freeze(["ambiguous_policy_scope"]) });
    selectorKeys.add(key);
  }
  const clauseOwners = new Map<string, string>();
  for (const policy of matched) for (const clause of policy.clauses) {
    const previous = clauseOwners.get(clause.clauseRef);
    if (previous && previous !== digest(clause)) return resolution({ ...base, disposition: "unresolved", reasonCodes: Object.freeze(["policy_clause_conflict"]) });
    if (previous) return resolution({ ...base, disposition: "unresolved", reasonCodes: Object.freeze(["ambiguous_policy_clause"]) });
    clauseOwners.set(clause.clauseRef, digest(clause));
  }
  const policyEvidence = Object.freeze(matched.sort((left, right) => left.policyRef.localeCompare(right.policyRef)).map((policy) => Object.freeze({
    policyRef: policy.policyRef, revision: policy.revision, canonicalHash: policy.canonicalHash,
    expiresAt: policy.expiresAt,
    clauseRefs: Object.freeze(policy.clauses.map((clause) => clause.clauseRef).sort()),
  })));
  const clauses = matched.flatMap((policy) => policy.clauses);
  const reasons: string[] = [];
  if (clauses.some((clause) => clause.kind === "deny_action")) reasons.push("deny_action_matched");
  const protectedCategories = new Set<string>(); const protectedGeos = new Set<string>();
  for (const clause of clauses) if (clause.kind === "protect_budget") {
    const evidenceRefs = clause.dimension === "internal_category" ? categoryEvidence.refs : geoEvidence.refs;
    const matchedRefs = clause.refs.filter((item) => evidenceRefs.includes(item));
    if (clause.dimension === "internal_category") matchedRefs.forEach((item) => protectedCategories.add(item));
    else matchedRefs.forEach((item) => protectedGeos.add(item));
    if (matchedRefs.length > 0 && isBudget && (clause.behavior === "fixed" || input.action.actionType === "budget_decrease")) {
      reasons.push(clause.behavior === "fixed" ? "protected_budget_fixed" : "protected_budget_no_outflow");
    }
  }
  if (isBudget) {
    const budget = input.action.budgetChange!;
    const limits = clauses.filter((clause): clause is Extract<ActionGuardrailClause, { kind: "budget_delta_limit" }> => (
      clause.kind === "budget_delta_limit" && clause.currency === budget.currency
    ));
    if (limits.length === 0) reasons.push("budget_limit_missing");
    for (const limit of limits) {
      if (limit.maximumAbsoluteDeltaDecimal !== null && greaterThan(budget.absoluteDeltaDecimal, limit.maximumAbsoluteDeltaDecimal)) {
        reasons.push("maximum_absolute_budget_delta_exceeded");
      }
      if (limit.maximumRelativeDeltaBasisPoints !== null && (budget.relativeDeltaBasisPoints === null
        || budget.relativeDeltaBasisPoints > limit.maximumRelativeDeltaBasisPoints)) {
        reasons.push(budget.relativeDeltaBasisPoints === null ? "relative_budget_delta_unknown" : "maximum_relative_budget_delta_exceeded");
      }
    }
  }
  const uniqueReasons = Object.freeze([...new Set(reasons)].sort());
  const unresolvedReasons = new Set(["budget_limit_missing", "relative_budget_delta_unknown"]);
  const disposition = uniqueReasons.some((reason) => unresolvedReasons.has(reason)) ? "unresolved" as const
    : uniqueReasons.length > 0 ? "denied" as const : "allowed" as const;
  return resolution({ ...base, disposition, reasonCodes: uniqueReasons,
    protectedInternalCategoryRefs: Object.freeze([...protectedCategories].sort()),
    protectedGeoRefs: Object.freeze([...protectedGeos].sort()), policyEvidence });
}
