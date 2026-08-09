import { createHash } from "node:crypto";

import {
  assertStrictInstructionPolicyArtifact,
  type InstructionPolicyScope,
  type StrictInstructionPolicy,
} from "@/domain/policies/instruction-policy-dsl";

export const POLICY_PRECEDENCE_RESOLVER_VERSION = "policy-precedence-resolver/1.0.0" as const;

/** Exact normative order from plans/proje/v2/MASTER.md, highest authority first. */
export const POLICY_AUTHORITY_ORDER = Object.freeze([
  "platform_legal_tenant_safety",
  "system_hard_safety",
  "user_locked_instruction",
  "budget_commitment",
  "entity_exception",
  "internal_category_playbook",
  "meta_objective_playbook",
  "metric_rule",
  "agent_advice",
] as const);

export type PolicyAuthorityTier = typeof POLICY_AUTHORITY_ORDER[number];
export type PolicyEntityLevel = "campaign" | "adset" | "ad" | "creative";

export type PolicyPrecedenceCandidate = Readonly<{
  policy: StrictInstructionPolicy;
  /** Assigned by a trusted, versioned catalog; the resolver never infers authority from raw text. */
  authorityTier: PolicyAuthorityTier;
  publishedAt: string;
  /** Explicit semantic grouping, equivalent to GuidanceCard decision/position keys. */
  decision: Readonly<{ decisionKey: string; positionKey: string }> | null;
}>;

export type PolicyPrecedenceContext = Readonly<{
  workspaceRef: string;
  evaluatedAt: string;
  accountGroupRefs: readonly string[];
  accountRefs: readonly string[];
  objectiveRefs: readonly string[];
  /** Effective category refs already resolved over the campaign→child inheritance path. */
  effectiveInternalCategoryRefs: readonly string[];
  /** Full root→target path makes campaign/adset policy inheritance explicit and replayable. */
  entityPath: readonly Readonly<{ level: PolicyEntityLevel; ref: string }>[];
  topicRefs: readonly string[];
  /** External proof that a typed policy is bound by a current manual lock. */
  manualLockedPolicyRefs: readonly string[];
}>;

export type PolicyPrecedenceTraceReason =
  | "applied"
  | "status_not_published"
  | "outside_effective_dates"
  | "scope_not_matched"
  | "older_policy_revision"
  | "suppressed_by_higher_precedence"
  | "suppressed_by_exception"
  | "parked_conflict";

export type PolicyPrecedenceTrace = Readonly<{
  policyRef: string;
  policyVersion: number;
  policyHash: string;
  authorityTier: PolicyAuthorityTier;
  authorityRank: number;
  specificity: number;
  publishedAt: string;
  priority: number;
  decisionKey: string | null;
  positionKey: string | null;
  outcome: "applied" | "suppressed" | "parked";
  reason: PolicyPrecedenceTraceReason;
  byPolicyRef: string | null;
}>;

export type PolicyPrecedenceConflict = Readonly<{
  decisionKey: string;
  policyRefs: readonly string[];
  reason: "equal_precedence_positions" | "equal_precedence_exception";
}>;

export type PolicyExceptionEffect = Readonly<{
  exceptionPolicyRef: string;
  targetPolicyRef: string;
  outcome: "suppressed" | "blocked_by_higher_precedence" | "parked_conflict" | "target_not_effective";
}>;

export type PolicyPrecedenceResolution = Readonly<{
  schemaVersion: typeof POLICY_PRECEDENCE_RESOLVER_VERSION;
  state: "RESOLVED" | "PARKED_CONFLICT";
  workspaceRef: string;
  evaluatedAt: string;
  applied: readonly PolicyPrecedenceTrace[];
  suppressed: readonly PolicyPrecedenceTrace[];
  parked: readonly PolicyPrecedenceTrace[];
  conflicts: readonly PolicyPrecedenceConflict[];
  exceptionEffects: readonly PolicyExceptionEffect[];
  authority: Readonly<{
    canExecute: false;
    canWriteMeta: false;
    canApprove: false;
    canSchedule: false;
    canCallTool: false;
    canAccessNetwork: false;
    canQuerySql: false;
  }>;
  resolutionHash: string;
}>;

export class PolicyPrecedenceResolverError extends Error {
  constructor(readonly code: "invalid_input" | "workspace_scope_mismatch" | "inauthentic_policy") {
    super(`Policy precedence resolution rejected: ${code}`);
    this.name = "PolicyPrecedenceResolverError";
  }
}

type EvaluatedCandidate = Readonly<{
  candidate: PolicyPrecedenceCandidate;
  policy: StrictInstructionPolicy;
  authorityRank: number;
  specificity: number;
  publishedAtMs: number;
}>;

const AUTHORITY = Object.freeze({
  canExecute: false as const,
  canWriteMeta: false as const,
  canApprove: false as const,
  canSchedule: false as const,
  canCallTool: false as const,
  canAccessNetwork: false as const,
  canQuerySql: false as const,
});
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const SEMANTIC_KEY = /^[a-z][a-z0-9_.:-]{1,127}$/;
const ENTITY_LEVELS = ["campaign", "adset", "ad", "creative"] as const;
const SCOPE_WEIGHTS = Object.freeze({
  account_group: 10,
  account: 10,
  objective: 20,
  internal_category: 30,
  topic: 1,
} as const);

function fail(code: PolicyPrecedenceResolverError["code"]): never {
  throw new PolicyPrecedenceResolverError(code);
}

function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) {
    fail("invalid_input");
  }
}

function canonicalInstant(value: string): string {
  if (!Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail("invalid_input");
  return value;
}

function refs(values: readonly string[]): readonly string[] {
  if (!Array.isArray(values) || values.length > 100 || values.some((value) => !REF.test(value))) fail("invalid_input");
  const sorted = [...values].sort(compareText);
  if (new Set(sorted).size !== sorted.length) fail("invalid_input");
  return Object.freeze(sorted);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareText(left, right))
      .map(([key, child]) => [key, stable(child)]));
  }
  return value;
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

function intersects(left: readonly string[], right: ReadonlySet<string>): boolean {
  return left.length === 0 || left.some((value) => right.has(value));
}

function scopeMatches(scope: InstructionPolicyScope, context: PolicyPrecedenceContext): boolean {
  if (scope.global) return true;
  const path = new Set(context.entityPath.map((entity) => `${entity.level}:${entity.ref}`));
  return intersects(scope.accountGroupRefs, new Set(context.accountGroupRefs))
    && intersects(scope.accountRefs, new Set(context.accountRefs))
    && intersects(scope.objectiveRefs, new Set(context.objectiveRefs))
    && intersects(scope.internalCategoryRefs, new Set(context.effectiveInternalCategoryRefs))
    && intersects(scope.topicRefs, new Set(context.topicRefs))
    && (scope.entities.length === 0 || scope.entities.some((entity) => path.has(`${entity.level}:${entity.ref}`)));
}

/** Reuses the existing guidance scope weights; deeper entity levels refine the entity facet. */
function scopeSpecificity(scope: InstructionPolicyScope): number {
  if (scope.global) return 0;
  let score = 0;
  if (scope.accountGroupRefs.length > 0) score += SCOPE_WEIGHTS.account_group;
  if (scope.accountRefs.length > 0) score += SCOPE_WEIGHTS.account;
  if (scope.objectiveRefs.length > 0) score += SCOPE_WEIGHTS.objective;
  if (scope.internalCategoryRefs.length > 0) score += SCOPE_WEIGHTS.internal_category;
  if (scope.topicRefs.length > 0) score += SCOPE_WEIGHTS.topic;
  if (scope.entities.length > 0) {
    score += 40 + Math.max(...scope.entities.map((entity) => ENTITY_LEVELS.indexOf(entity.level)));
  }
  return score;
}

/** Negative means left has higher precedence. Priority is trace-only: MASTER does not rank by it. */
function comparePrecedence(left: EvaluatedCandidate, right: EvaluatedCandidate): number {
  return right.authorityRank - left.authorityRank
    || right.specificity - left.specificity
    || right.publishedAtMs - left.publishedAtMs
    || right.policy.policyVersion - left.policy.policyVersion;
}

function deterministicOrder(left: EvaluatedCandidate, right: EvaluatedCandidate): number {
  return comparePrecedence(left, right)
    || compareText(left.policy.policyRef, right.policy.policyRef)
    || compareText(left.policy.canonicalHash, right.policy.canonicalHash);
}

function trace(
  row: EvaluatedCandidate,
  outcome: PolicyPrecedenceTrace["outcome"],
  reason: PolicyPrecedenceTraceReason,
  byPolicyRef: string | null = null,
): PolicyPrecedenceTrace {
  return freeze({
    policyRef: row.policy.policyRef,
    policyVersion: row.policy.policyVersion,
    policyHash: row.policy.canonicalHash,
    authorityTier: row.candidate.authorityTier,
    authorityRank: row.authorityRank,
    specificity: row.specificity,
    publishedAt: row.candidate.publishedAt,
    priority: row.policy.priority,
    decisionKey: row.candidate.decision?.decisionKey ?? null,
    positionKey: row.candidate.decision?.positionKey ?? null,
    outcome,
    reason,
    byPolicyRef,
  });
}

function validateContext(input: PolicyPrecedenceContext): PolicyPrecedenceContext {
  exact(input, ["workspaceRef", "evaluatedAt", "accountGroupRefs", "accountRefs", "objectiveRefs",
    "effectiveInternalCategoryRefs", "entityPath", "topicRefs", "manualLockedPolicyRefs"]);
  if (!REF.test(input.workspaceRef)) fail("invalid_input");
  const evaluatedAt = canonicalInstant(input.evaluatedAt);
  if (!Array.isArray(input.entityPath)) fail("invalid_input");
  const entityPath = input.entityPath.map((entity, index) => {
    const typed = entity as Readonly<{ level: PolicyEntityLevel; ref: string }>;
    exact(entity, ["level", "ref"]);
    if (ENTITY_LEVELS[index] !== typed.level || !REF.test(typed.ref)) fail("invalid_input");
    return freeze({ level: typed.level, ref: typed.ref });
  });
  if (entityPath.length === 0 || entityPath.length > ENTITY_LEVELS.length) fail("invalid_input");
  return freeze({
    workspaceRef: input.workspaceRef,
    evaluatedAt,
    accountGroupRefs: refs(input.accountGroupRefs),
    accountRefs: refs(input.accountRefs),
    objectiveRefs: refs(input.objectiveRefs),
    effectiveInternalCategoryRefs: refs(input.effectiveInternalCategoryRefs),
    entityPath: freeze(entityPath),
    topicRefs: refs(input.topicRefs),
    manualLockedPolicyRefs: refs(input.manualLockedPolicyRefs),
  });
}

function validateCandidate(candidate: PolicyPrecedenceCandidate, context: PolicyPrecedenceContext): EvaluatedCandidate {
  exact(candidate, ["policy", "authorityTier", "publishedAt", "decision"]);
  let policy: StrictInstructionPolicy;
  try {
    policy = assertStrictInstructionPolicyArtifact(candidate.policy);
  } catch {
    return fail("inauthentic_policy");
  }
  if (policy.workspaceRef !== context.workspaceRef) fail("workspace_scope_mismatch");
  const authorityRank = POLICY_AUTHORITY_ORDER.length - POLICY_AUTHORITY_ORDER.indexOf(candidate.authorityTier);
  if (authorityRank > POLICY_AUTHORITY_ORDER.length) fail("invalid_input");
  const publishedAt = canonicalInstant(candidate.publishedAt);
  if (candidate.decision !== null) {
    exact(candidate.decision, ["decisionKey", "positionKey"]);
    if (!SEMANTIC_KEY.test(candidate.decision.decisionKey) || !SEMANTIC_KEY.test(candidate.decision.positionKey)) fail("invalid_input");
  }
  if (candidate.authorityTier === "user_locked_instruction"
    && !context.manualLockedPolicyRefs.includes(policy.policyRef)) fail("invalid_input");
  if (candidate.authorityTier === "entity_exception"
    && (policy.policyType !== "exception" || policy.scope.entities.length === 0)) fail("invalid_input");
  if (candidate.authorityTier === "internal_category_playbook"
    && policy.scope.internalCategoryRefs.length === 0) fail("invalid_input");
  if (candidate.authorityTier === "meta_objective_playbook"
    && policy.scope.objectiveRefs.length === 0) fail("invalid_input");
  return freeze({ candidate: freeze({ ...candidate, publishedAt }), policy, authorityRank,
    specificity: scopeSpecificity(policy.scope), publishedAtMs: Date.parse(publishedAt) });
}

function isEffective(row: EvaluatedCandidate, at: number): boolean {
  return row.policy.effectiveDates.from <= new Date(at).toISOString()
    && (row.policy.effectiveDates.until === null || row.policy.effectiveDates.until > new Date(at).toISOString());
}

function conflictKey(conflict: PolicyPrecedenceConflict): string {
  return `${conflict.decisionKey}:${conflict.reason}:${conflict.policyRefs.join(",")}`;
}

/**
 * Resolves typed, published policy artifacts without interpreting raw instruction text.
 * Every input revision receives exactly one terminal trace row; explicit exception
 * effects and every unresolved tie remain lossless and replay-stable.
 */
export function resolvePolicyPrecedence(input: Readonly<{
  context: PolicyPrecedenceContext;
  candidates: readonly PolicyPrecedenceCandidate[];
}>): PolicyPrecedenceResolution {
  exact(input, ["context", "candidates"]);
  const context = validateContext(input.context);
  if (!Array.isArray(input.candidates) || input.candidates.length > 1_000) fail("invalid_input");
  const rows = input.candidates.map((candidate) => validateCandidate(candidate, context));
  const identity = new Set<string>();
  for (const row of rows) {
    const key = `${row.policy.policyRef}:${row.policy.policyVersion}`;
    if (identity.has(key)) fail("invalid_input");
    identity.add(key);
  }

  const outcomes = new Map<EvaluatedCandidate, PolicyPrecedenceTrace>();
  const effective: EvaluatedCandidate[] = [];
  const evaluatedAtMs = Date.parse(context.evaluatedAt);
  for (const row of rows) {
    if (row.policy.status !== "published") outcomes.set(row, trace(row, "suppressed", "status_not_published"));
    else if (!isEffective(row, evaluatedAtMs)) outcomes.set(row, trace(row, "suppressed", "outside_effective_dates"));
    else if (!scopeMatches(row.policy.scope, context)) outcomes.set(row, trace(row, "suppressed", "scope_not_matched"));
    else effective.push(row);
  }

  const current: EvaluatedCandidate[] = [];
  const revisions = new Map<string, EvaluatedCandidate[]>();
  for (const row of effective) revisions.set(row.policy.policyRef, [...(revisions.get(row.policy.policyRef) ?? []), row]);
  for (const group of revisions.values()) {
    const ordered = group.sort((left, right) => right.policy.policyVersion - left.policy.policyVersion
      || right.publishedAtMs - left.publishedAtMs || compareText(left.policy.canonicalHash, right.policy.canonicalHash));
    current.push(ordered[0]!);
    for (const row of ordered.slice(1)) outcomes.set(row, trace(row, "suppressed", "older_policy_revision", ordered[0]!.policy.policyRef));
  }

  const conflicts: PolicyPrecedenceConflict[] = [];
  const decisionGroups = new Map<string, EvaluatedCandidate[]>();
  for (const row of current) {
    const decisionKey = row.candidate.decision?.decisionKey;
    if (decisionKey) decisionGroups.set(decisionKey, [...(decisionGroups.get(decisionKey) ?? []), row]);
  }
  for (const [decisionKey, group] of decisionGroups) {
    if (new Set(group.map((row) => row.candidate.decision!.positionKey)).size < 2) continue;
    const ordered = [...group].sort(deterministicOrder);
    const top = ordered[0]!;
    const tied = ordered.filter((row) => comparePrecedence(top, row) === 0);
    if (new Set(tied.map((row) => row.candidate.decision!.positionKey)).size > 1) {
      const policyRefs = tied.map((row) => row.policy.policyRef).sort(compareText);
      conflicts.push(freeze({ decisionKey, policyRefs, reason: "equal_precedence_positions" as const }));
      for (const row of group) outcomes.set(row, trace(row, "parked", "parked_conflict"));
      continue;
    }
    for (const row of ordered) {
      if (row.candidate.decision!.positionKey !== top.candidate.decision!.positionKey) {
        outcomes.set(row, trace(row, "suppressed", "suppressed_by_higher_precedence", top.policy.policyRef));
      }
    }
  }

  const exceptionEffects: PolicyExceptionEffect[] = [];
  const currentByRef = new Map(current.map((row) => [row.policy.policyRef, row] as const));
  const exceptions = current.filter((row) => row.policy.policyType === "exception" && !outcomes.has(row));
  for (const exception of exceptions.sort(deterministicOrder)) {
    const clause = exception.policy.clause;
    if (clause.kind !== "exception") continue;
    for (const targetRef of clause.policyRefs) {
      const target = currentByRef.get(targetRef);
      if (!target || outcomes.has(target)) {
        exceptionEffects.push(freeze({ exceptionPolicyRef: exception.policy.policyRef, targetPolicyRef: targetRef,
          outcome: "target_not_effective" as const }));
        continue;
      }
      const comparison = comparePrecedence(exception, target);
      if (comparison < 0) {
        outcomes.set(target, trace(target, "suppressed", "suppressed_by_exception", exception.policy.policyRef));
        exceptionEffects.push(freeze({ exceptionPolicyRef: exception.policy.policyRef, targetPolicyRef: targetRef,
          outcome: "suppressed" as const }));
      } else if (comparison > 0) {
        exceptionEffects.push(freeze({ exceptionPolicyRef: exception.policy.policyRef, targetPolicyRef: targetRef,
          outcome: "blocked_by_higher_precedence" as const }));
      } else {
        outcomes.set(exception, trace(exception, "parked", "parked_conflict"));
        outcomes.set(target, trace(target, "parked", "parked_conflict"));
        const policyRefs = [exception.policy.policyRef, target.policy.policyRef].sort(compareText);
        conflicts.push(freeze({ decisionKey: `exception:${target.policy.policyRef}`, policyRefs,
          reason: "equal_precedence_exception" as const }));
        exceptionEffects.push(freeze({ exceptionPolicyRef: exception.policy.policyRef, targetPolicyRef: targetRef,
          outcome: "parked_conflict" as const }));
      }
    }
  }

  for (const row of current) if (!outcomes.has(row)) outcomes.set(row, trace(row, "applied", "applied"));
  const allTrace = [...outcomes.values()].sort((left, right) => compareText(left.policyRef, right.policyRef)
    || left.policyVersion - right.policyVersion || compareText(left.policyHash, right.policyHash));
  const uniqueConflicts = [...new Map(conflicts.map((conflict) => [conflictKey(conflict), conflict])).values()]
    .sort((left, right) => compareText(conflictKey(left), conflictKey(right)));
  const core = freeze({
    schemaVersion: POLICY_PRECEDENCE_RESOLVER_VERSION,
    state: uniqueConflicts.length > 0 ? "PARKED_CONFLICT" as const : "RESOLVED" as const,
    workspaceRef: context.workspaceRef,
    evaluatedAt: context.evaluatedAt,
    applied: allTrace.filter((row) => row.outcome === "applied"),
    suppressed: allTrace.filter((row) => row.outcome === "suppressed"),
    parked: allTrace.filter((row) => row.outcome === "parked"),
    conflicts: freeze(uniqueConflicts),
    exceptionEffects: freeze(exceptionEffects.sort((left, right) => compareText(left.exceptionPolicyRef, right.exceptionPolicyRef)
      || compareText(left.targetPolicyRef, right.targetPolicyRef))),
    authority: AUTHORITY,
  });
  return freeze({ ...core, resolutionHash: digest(core) });
}
