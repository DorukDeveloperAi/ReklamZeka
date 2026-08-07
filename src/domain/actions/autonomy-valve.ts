import { createHash } from "node:crypto";

export const ACTION_PLAN_VERSION = "action-plan/1.0.0" as const;

export type ActionRisk = "K0" | "K1" | "K2" | "K3" | "K4";
export type AutonomyMode = "denied" | "approval_only" | "policy_limited";
export type ActionType =
  | "no_change"
  | "internal_annotation"
  | "status_pause"
  | "status_activate"
  | "budget_decrease"
  | "budget_increase"
  | "existing_post_promotion";

export type ActionEntity = Readonly<{
  level: "campaign" | "adset" | "ad";
  ref: string;
}>;

export type TypedActionIntent =
  | Readonly<{ kind: "no_change"; entity: ActionEntity; reasonRef: string }>
  | Readonly<{ kind: "internal_annotation"; entity: ActionEntity; annotationRef: string }>
  | Readonly<{
    kind: "status_change";
    entity: ActionEntity;
    fromStatus: "ACTIVE" | "PAUSED";
    toStatus: "ACTIVE" | "PAUSED";
  }>
  | Readonly<{
    kind: "budget_change";
    entity: Readonly<{ level: "campaign" | "adset"; ref: string }>;
    budgetKind: "daily" | "lifetime";
    currency: string;
    beforeDecimal: string;
    afterDecimal: string;
    budgetOwnerRef: string;
  }>
  | Readonly<{
    kind: "existing_post_promotion";
    entity: Readonly<{ level: "adset"; ref: string }>;
    placeholderOnly: true;
    postRef: string;
    postContentHash: string;
    creativeBindingHash: string;
    actorRef: string;
    promotionTemplateVersionRef: string;
    audiencePresetVersionRef: string;
    destinationRef: string;
    budgetPlanVersionRef: string;
    timeframeRef: string;
    scheduleMode: "continuous" | "fixed_duration";
    durationDays: number | null;
  }>;

export type AutonomyScope =
  | Readonly<{ level: "workspace"; ref: string }>
  | Readonly<{ level: "account_group"; ref: string }>
  | Readonly<{ level: "account"; ref: string }>
  | Readonly<{ level: "internal_category"; ref: string }>
  | Readonly<{ level: "campaign"; ref: string }>
  | Readonly<{ level: "entity"; entityLevel: "campaign" | "adset" | "ad"; ref: string }>
  | Readonly<{ level: "action_type"; actionType: ActionType }>;

export type AutonomyRule = Readonly<{
  ruleRef: string;
  workspaceRef: string;
  scope: AutonomyScope;
  mode: AutonomyMode;
  state: "published" | "disabled";
  effectiveFrom: string;
  expiresAt: string | null;
  killSwitch: boolean;
  maximumActionsPerRun: number | null;
}>;

export type BudgetDeltaLimits = Readonly<{
  currency: string;
  maximumAbsoluteDeltaDecimal: string | null;
  maximumRelativeDeltaBasisPoints: number | null;
  limitRefs: readonly string[];
}>;

export type ProtectionContext = Readonly<{
  protectedInternalCategoryRefs: readonly string[];
  affectedGeoRefs: readonly string[];
  protectedGeoRefs: readonly string[];
  changeDisposition: "allowed" | "denied" | "unresolved";
  policyRefs: readonly string[];
}>;

export type ActionValveContext = Readonly<{
  workspaceRef: string;
  accountGroupRef: string | null;
  accountRef: string;
  internalCategoryRefs: readonly string[];
  campaignRef: string;
  entity: ActionEntity;
  evaluatedAt: string;
  rules: readonly AutonomyRule[];
  budgetLimits: BudgetDeltaLimits | null;
  protection: ProtectionContext;
}>;

export type AutonomyTraceItem = Readonly<{
  ruleRef: string;
  scopeKey: string;
  outcome:
    | "workspace_default"
    | "applied"
    | "ignored_disabled"
    | "ignored_not_effective"
    | "expired_fail_closed"
    | "widening_conflict"
    | "scope_conflict"
    | "kill_switch";
  resultingMode: AutonomyMode;
  maximumActionsPerRun: number | null;
}>;

export type ActionPlan = Readonly<{
  schemaVersion: typeof ACTION_PLAN_VERSION;
  actionType: ActionType;
  risk: ActionRisk;
  action: TypedActionIntent;
  effectiveAutonomy: AutonomyMode;
  disposition: "no_write" | "approval_required" | "policy_limited_candidate" | "denied";
  reasonCodes: readonly string[];
  trace: readonly AutonomyTraceItem[];
  budgetDelta: null | Readonly<{
    currency: string;
    direction: "decrease" | "increase";
    absoluteDecimal: string;
  }>;
  capabilities: Readonly<{
    canExecute: false;
    canWriteMeta: false;
    canGrantApproval: false;
    canAccessRawGraph: false;
  }>;
  contextHash: string;
  planHash: string;
}>;

export type AutonomyValveErrorCode =
  | "invalid_contract"
  | "invalid_action"
  | "invalid_scope"
  | "invalid_rule"
  | "invalid_amount"
  | "currency_mismatch";

export class AutonomyValveError extends Error {
  constructor(readonly code: AutonomyValveErrorCode) {
    super("Eylem planı güvenli biçimde değerlendirilemedi");
    this.name = "AutonomyValveError";
  }
}

type Decimal = Readonly<{ coefficient: bigint; scale: number }>;
type ClassifiedAction = Readonly<{
  action: TypedActionIntent;
  actionType: ActionType;
  risk: ActionRisk;
  budgetDelta: ActionPlan["budgetDelta"];
  budgetBefore: Decimal | null;
  budgetAfter: Decimal | null;
}>;

const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_-]{0,94}$/;
const HASH = /^[a-f0-9]{64}$/;
const CURRENCY = /^[A-Z]{3}$/;
const DECIMAL = /^(0|[1-9]\d{0,29})(?:\.(\d{1,12}))?$/;
const MODES: readonly AutonomyMode[] = ["denied", "approval_only", "policy_limited"];
const SCOPE_RANK: Readonly<Record<AutonomyScope["level"], number>> = Object.freeze({
  workspace: 0,
  account_group: 1,
  account: 2,
  internal_category: 3,
  campaign: 4,
  entity: 5,
  action_type: 6,
});

function fail(code: AutonomyValveErrorCode): never {
  throw new AutonomyValveError(code);
}

function exactKeys(value: unknown, allowed: readonly string[]): void {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    fail("invalid_contract");
  }
  const keys = Object.keys(value);
  if (keys.length !== allowed.length || keys.some((key) => !allowed.includes(key))) fail("invalid_contract");
}

function reference(value: unknown): string {
  if (typeof value !== "string" || !REF.test(value)) fail("invalid_contract");
  return value;
}

function timestamp(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) fail("invalid_contract");
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) fail("invalid_contract");
  return value;
}

function parseDecimal(value: unknown): Decimal {
  if (typeof value !== "string") fail("invalid_amount");
  const match = DECIMAL.exec(value);
  if (!match) fail("invalid_amount");
  const fraction = (match[2] ?? "").replace(/0+$/, "");
  return { coefficient: BigInt(`${match[1]}${fraction}`), scale: fraction.length };
}

function align(left: Decimal, right: Decimal): readonly [bigint, bigint, number] {
  const scale = Math.max(left.scale, right.scale);
  return [
    left.coefficient * 10n ** BigInt(scale - left.scale),
    right.coefficient * 10n ** BigInt(scale - right.scale),
    scale,
  ];
}

function compareDecimal(left: Decimal, right: Decimal): number {
  const [leftUnits, rightUnits] = align(left, right);
  return leftUnits < rightUnits ? -1 : leftUnits > rightUnits ? 1 : 0;
}

function subtractDecimal(larger: Decimal, smaller: Decimal): Decimal {
  const [largerUnits, smallerUnits, scale] = align(larger, smaller);
  return { coefficient: largerUnits - smallerUnits, scale };
}

function formatDecimal(value: Decimal): string {
  if (value.scale === 0) return value.coefficient.toString();
  const padded = value.coefficient.toString().padStart(value.scale + 1, "0");
  const integer = padded.slice(0, -value.scale);
  const fraction = padded.slice(-value.scale).replace(/0+$/, "");
  return fraction ? `${integer}.${fraction}` : integer;
}

function validateEntity(value: unknown): ActionEntity {
  exactKeys(value, ["level", "ref"]);
  const candidate = value as Record<string, unknown>;
  if (!["campaign", "adset", "ad"].includes(candidate.level as string)) fail("invalid_action");
  return Object.freeze({ level: candidate.level as ActionEntity["level"], ref: reference(candidate.ref) });
}

function normalizeRefs(value: unknown): readonly string[] {
  if (!Array.isArray(value)) fail("invalid_contract");
  const refs = value.map(reference);
  if (new Set(refs).size !== refs.length) fail("invalid_contract");
  return Object.freeze([...refs].sort());
}

function classifyAction(value: unknown): ClassifiedAction {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("invalid_action");
  const candidate = value as Record<string, unknown>;
  if (candidate.kind === "no_change") {
    exactKeys(value, ["kind", "entity", "reasonRef"]);
    const action = Object.freeze({ kind: "no_change" as const, entity: validateEntity(candidate.entity), reasonRef: reference(candidate.reasonRef) });
    return { action, actionType: "no_change", risk: "K0", budgetDelta: null, budgetBefore: null, budgetAfter: null };
  }
  if (candidate.kind === "internal_annotation") {
    exactKeys(value, ["kind", "entity", "annotationRef"]);
    const action = Object.freeze({ kind: "internal_annotation" as const, entity: validateEntity(candidate.entity), annotationRef: reference(candidate.annotationRef) });
    return { action, actionType: "internal_annotation", risk: "K1", budgetDelta: null, budgetBefore: null, budgetAfter: null };
  }
  if (candidate.kind === "status_change") {
    exactKeys(value, ["kind", "entity", "fromStatus", "toStatus"]);
    const entity = validateEntity(candidate.entity);
    if (!(["ACTIVE", "PAUSED"].includes(candidate.fromStatus as string) && ["ACTIVE", "PAUSED"].includes(candidate.toStatus as string))) fail("invalid_action");
    if (candidate.fromStatus === candidate.toStatus) fail("invalid_action");
    const isPause = candidate.fromStatus === "ACTIVE" && candidate.toStatus === "PAUSED";
    const isActivate = candidate.fromStatus === "PAUSED" && candidate.toStatus === "ACTIVE";
    if (!isPause && !isActivate) fail("invalid_action");
    const action = Object.freeze({
      kind: "status_change" as const, entity,
      fromStatus: candidate.fromStatus as "ACTIVE" | "PAUSED",
      toStatus: candidate.toStatus as "ACTIVE" | "PAUSED",
    });
    return { action, actionType: isPause ? "status_pause" : "status_activate", risk: isPause ? "K2" : "K3", budgetDelta: null, budgetBefore: null, budgetAfter: null };
  }
  if (candidate.kind === "budget_change") {
    exactKeys(value, ["kind", "entity", "budgetKind", "currency", "beforeDecimal", "afterDecimal", "budgetOwnerRef"]);
    const entity = validateEntity(candidate.entity);
    if (entity.level === "ad") fail("invalid_action");
    if (!(["daily", "lifetime"] as const).includes(candidate.budgetKind as "daily" | "lifetime")) fail("invalid_action");
    if (typeof candidate.currency !== "string" || !CURRENCY.test(candidate.currency)) fail("invalid_action");
    const before = parseDecimal(candidate.beforeDecimal);
    const after = parseDecimal(candidate.afterDecimal);
    const comparison = compareDecimal(after, before);
    if (comparison === 0) fail("invalid_action");
    const direction = comparison < 0 ? "decrease" as const : "increase" as const;
    const delta = subtractDecimal(comparison < 0 ? before : after, comparison < 0 ? after : before);
    const action = Object.freeze({
      kind: "budget_change" as const,
      entity: Object.freeze({ level: entity.level as "campaign" | "adset", ref: entity.ref }),
      budgetKind: candidate.budgetKind as "daily" | "lifetime",
      currency: candidate.currency,
      beforeDecimal: formatDecimal(before),
      afterDecimal: formatDecimal(after),
      budgetOwnerRef: reference(candidate.budgetOwnerRef),
    });
    if (action.budgetOwnerRef !== action.entity.ref) fail("invalid_action");
    return {
      action,
      actionType: direction === "decrease" ? "budget_decrease" : "budget_increase",
      risk: direction === "decrease" ? "K2" : "K3",
      budgetDelta: Object.freeze({ currency: candidate.currency, direction, absoluteDecimal: formatDecimal(delta) }),
      budgetBefore: before,
      budgetAfter: after,
    };
  }
  if (candidate.kind === "existing_post_promotion") {
    exactKeys(value, [
      "kind", "entity", "placeholderOnly", "postRef", "postContentHash", "actorRef",
      "creativeBindingHash", "promotionTemplateVersionRef", "audiencePresetVersionRef", "destinationRef",
      "budgetPlanVersionRef", "timeframeRef", "scheduleMode", "durationDays",
    ]);
    const entity = validateEntity(candidate.entity);
    if (entity.level !== "adset" || candidate.placeholderOnly !== true || typeof candidate.postContentHash !== "string" || !HASH.test(candidate.postContentHash)) {
      fail("invalid_action");
    }
    const scheduleMode: "continuous" | "fixed_duration" = candidate.scheduleMode === "continuous"
      || candidate.scheduleMode === "fixed_duration" ? candidate.scheduleMode : fail("invalid_action");
    const durationDays: number | null = candidate.durationDays === null ? null
      : Number.isSafeInteger(candidate.durationDays) && (candidate.durationDays as number) >= 1
        && (candidate.durationDays as number) <= 365 ? candidate.durationDays as number : fail("invalid_action");
    const action = Object.freeze({
      kind: "existing_post_promotion" as const,
      entity: Object.freeze({ level: "adset" as const, ref: entity.ref }),
      placeholderOnly: true as const,
      postRef: reference(candidate.postRef),
      postContentHash: candidate.postContentHash,
      creativeBindingHash: typeof candidate.creativeBindingHash === "string" && HASH.test(candidate.creativeBindingHash)
        ? candidate.creativeBindingHash : fail("invalid_action"),
      actorRef: reference(candidate.actorRef),
      promotionTemplateVersionRef: reference(candidate.promotionTemplateVersionRef),
      audiencePresetVersionRef: reference(candidate.audiencePresetVersionRef),
      destinationRef: reference(candidate.destinationRef),
      budgetPlanVersionRef: reference(candidate.budgetPlanVersionRef),
      timeframeRef: reference(candidate.timeframeRef),
      scheduleMode,
      durationDays,
    });
    if ((action.scheduleMode === "continuous" && action.durationDays !== null)
      || (action.scheduleMode === "fixed_duration" && action.durationDays === null)) fail("invalid_action");
    return { action, actionType: "existing_post_promotion", risk: "K4", budgetDelta: null, budgetBefore: null, budgetAfter: null };
  }
  fail("invalid_action");
}

function validateScope(value: unknown): AutonomyScope {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("invalid_scope");
  const candidate = value as Record<string, unknown>;
  if (["workspace", "account_group", "account", "internal_category", "campaign"].includes(candidate.level as string)) {
    exactKeys(value, ["level", "ref"]);
    return Object.freeze({ level: candidate.level as "workspace" | "account_group" | "account" | "internal_category" | "campaign", ref: reference(candidate.ref) });
  }
  if (candidate.level === "entity") {
    exactKeys(value, ["level", "entityLevel", "ref"]);
    if (!["campaign", "adset", "ad"].includes(candidate.entityLevel as string)) fail("invalid_scope");
    return Object.freeze({ level: "entity", entityLevel: candidate.entityLevel as ActionEntity["level"], ref: reference(candidate.ref) });
  }
  if (candidate.level === "action_type") {
    exactKeys(value, ["level", "actionType"]);
    if (!["no_change", "internal_annotation", "status_pause", "status_activate", "budget_decrease", "budget_increase", "existing_post_promotion"].includes(candidate.actionType as string)) fail("invalid_scope");
    return Object.freeze({ level: "action_type", actionType: candidate.actionType as ActionType });
  }
  fail("invalid_scope");
}

function validateRule(value: unknown, workspaceRef: string): AutonomyRule {
  exactKeys(value, ["ruleRef", "workspaceRef", "scope", "mode", "state", "effectiveFrom", "expiresAt", "killSwitch", "maximumActionsPerRun"]);
  const candidate = value as Record<string, unknown>;
  if (reference(candidate.workspaceRef) !== workspaceRef) fail("invalid_rule");
  const scope = validateScope(candidate.scope);
  if (scope.level === "workspace" && scope.ref !== workspaceRef) fail("invalid_rule");
  if (!MODES.includes(candidate.mode as AutonomyMode) || !["published", "disabled"].includes(candidate.state as string)) fail("invalid_rule");
  if (typeof candidate.killSwitch !== "boolean") fail("invalid_rule");
  if (candidate.killSwitch && candidate.mode !== "denied") fail("invalid_rule");
  if (candidate.maximumActionsPerRun !== null && (!Number.isSafeInteger(candidate.maximumActionsPerRun) || (candidate.maximumActionsPerRun as number) <= 0)) fail("invalid_rule");
  const effectiveFrom = timestamp(candidate.effectiveFrom);
  const expiresAt = candidate.expiresAt === null ? null : timestamp(candidate.expiresAt);
  if (expiresAt !== null && expiresAt <= effectiveFrom) fail("invalid_rule");
  return Object.freeze({
    ruleRef: reference(candidate.ruleRef), workspaceRef, scope,
    mode: candidate.mode as AutonomyMode, state: candidate.state as "published" | "disabled",
    effectiveFrom, expiresAt, killSwitch: candidate.killSwitch,
    maximumActionsPerRun: candidate.maximumActionsPerRun as number | null,
  });
}

function scopeKey(scope: AutonomyScope): string {
  if (scope.level === "entity") return `entity:${scope.entityLevel}:${scope.ref}`;
  if (scope.level === "action_type") return `action_type:${scope.actionType}`;
  return `${scope.level}:${scope.ref}`;
}

function scopeMatches(scope: AutonomyScope, context: ActionValveContext, action: ClassifiedAction): boolean {
  switch (scope.level) {
    case "workspace": return scope.ref === context.workspaceRef;
    case "account_group": return scope.ref === context.accountGroupRef;
    case "account": return scope.ref === context.accountRef;
    case "internal_category": return context.internalCategoryRefs.includes(scope.ref);
    case "campaign": return scope.ref === context.campaignRef;
    case "entity": return scope.entityLevel === context.entity.level && scope.ref === context.entity.ref;
    case "action_type": return scope.actionType === action.actionType;
  }
}

function stableValue(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean" || typeof value === "number") return value;
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") fail("invalid_contract");
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, item]) => [key, stableValue(item)]));
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function validateBudgetLimits(value: unknown): BudgetDeltaLimits | null {
  if (value === null) return null;
  exactKeys(value, ["currency", "maximumAbsoluteDeltaDecimal", "maximumRelativeDeltaBasisPoints", "limitRefs"]);
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.currency !== "string" || !CURRENCY.test(candidate.currency)) fail("invalid_contract");
  const absolute = candidate.maximumAbsoluteDeltaDecimal === null ? null : formatDecimal(parseDecimal(candidate.maximumAbsoluteDeltaDecimal));
  const relative = candidate.maximumRelativeDeltaBasisPoints;
  if (relative !== null && (!Number.isSafeInteger(relative) || (relative as number) < 0 || (relative as number) > 1_000_000)) fail("invalid_contract");
  const limitRefs = normalizeRefs(candidate.limitRefs);
  if (absolute === null && relative === null) fail("invalid_contract");
  if (limitRefs.length === 0) fail("invalid_contract");
  return Object.freeze({
    currency: candidate.currency,
    maximumAbsoluteDeltaDecimal: absolute,
    maximumRelativeDeltaBasisPoints: relative as number | null,
    limitRefs,
  });
}

function validateProtection(value: unknown): ProtectionContext {
  exactKeys(value, ["protectedInternalCategoryRefs", "affectedGeoRefs", "protectedGeoRefs", "changeDisposition", "policyRefs"]);
  const candidate = value as Record<string, unknown>;
  if (!["allowed", "denied", "unresolved"].includes(candidate.changeDisposition as string)) fail("invalid_contract");
  const normalized = Object.freeze({
    protectedInternalCategoryRefs: normalizeRefs(candidate.protectedInternalCategoryRefs),
    affectedGeoRefs: normalizeRefs(candidate.affectedGeoRefs),
    protectedGeoRefs: normalizeRefs(candidate.protectedGeoRefs),
    changeDisposition: candidate.changeDisposition as ProtectionContext["changeDisposition"],
    policyRefs: normalizeRefs(candidate.policyRefs),
  });
  if ((normalized.protectedInternalCategoryRefs.length > 0 || normalized.protectedGeoRefs.length > 0 || normalized.changeDisposition !== "allowed")
    && normalized.policyRefs.length === 0) fail("invalid_contract");
  return normalized;
}

function normalizeContext(value: ActionValveContext, action: ClassifiedAction): Readonly<{
  context: ActionValveContext;
  rules: readonly AutonomyRule[];
  budgetLimits: BudgetDeltaLimits | null;
  protection: ProtectionContext;
}> {
  exactKeys(value, [
    "workspaceRef", "accountGroupRef", "accountRef", "internalCategoryRefs", "campaignRef",
    "entity", "evaluatedAt", "rules", "budgetLimits", "protection",
  ]);
  const workspaceRef = reference(value.workspaceRef);
  const entity = validateEntity(value.entity);
  if (entity.level !== action.action.entity.level || entity.ref !== action.action.entity.ref) fail("invalid_contract");
  if (!Array.isArray(value.rules)) fail("invalid_contract");
  const rules = value.rules.map((rule) => validateRule(rule, workspaceRef));
  if (new Set(rules.map((rule) => rule.ruleRef)).size !== rules.length) fail("invalid_rule");
  rules.sort((left, right) => {
    const rank = SCOPE_RANK[left.scope.level] - SCOPE_RANK[right.scope.level];
    if (rank !== 0) return rank;
    const leftKey = scopeKey(left.scope);
    const rightKey = scopeKey(right.scope);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : left.ruleRef < right.ruleRef ? -1 : left.ruleRef > right.ruleRef ? 1 : 0;
  });
  const protection = validateProtection(value.protection);
  const budgetLimits = validateBudgetLimits(value.budgetLimits);
  const context = Object.freeze({
    workspaceRef,
    accountGroupRef: value.accountGroupRef === null ? null : reference(value.accountGroupRef),
    accountRef: reference(value.accountRef),
    internalCategoryRefs: normalizeRefs(value.internalCategoryRefs),
    campaignRef: reference(value.campaignRef),
    entity,
    evaluatedAt: timestamp(value.evaluatedAt),
    rules: Object.freeze(rules),
    budgetLimits,
    protection,
  });
  return { context, rules, budgetLimits, protection };
}

function checkBudgetCaps(action: ClassifiedAction, limits: BudgetDeltaLimits | null): readonly string[] {
  if (action.budgetDelta === null) return [];
  if (limits === null) return ["budget_cap_missing"];
  if (limits.currency !== action.budgetDelta.currency) return ["budget_cap_currency_mismatch"];
  const reasons: string[] = [];
  const delta = parseDecimal(action.budgetDelta.absoluteDecimal);
  if (limits.maximumAbsoluteDeltaDecimal !== null && compareDecimal(delta, parseDecimal(limits.maximumAbsoluteDeltaDecimal)) > 0) {
    reasons.push("maximum_absolute_budget_delta_exceeded");
  }
  if (limits.maximumRelativeDeltaBasisPoints !== null) {
    const before = action.budgetBefore!;
    if (before.coefficient === 0n) {
      reasons.push("relative_budget_delta_undefined");
    } else {
      const [deltaUnits, beforeUnits] = align(delta, before);
      if (deltaUnits * 10_000n > beforeUnits * BigInt(limits.maximumRelativeDeltaBasisPoints)) {
        reasons.push("maximum_relative_budget_delta_exceeded");
      }
    }
  }
  return reasons;
}

export function buildActionPlan(intent: TypedActionIntent, rawContext: ActionValveContext): ActionPlan {
  const classified = classifyAction(intent);
  const normalized = normalizeContext(rawContext, classified);
  const context = normalized.context;
  const matched = normalized.rules.filter((rule) => scopeMatches(rule.scope, context, classified))
    .sort((left, right) => {
      const rank = SCOPE_RANK[left.scope.level] - SCOPE_RANK[right.scope.level];
      if (rank !== 0) return rank;
      const leftKey = scopeKey(left.scope);
      const rightKey = scopeKey(right.scope);
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : left.ruleRef < right.ruleRef ? -1 : left.ruleRef > right.ruleRef ? 1 : 0;
    });

  let effective: AutonomyMode = "approval_only";
  let maximumActionsPerRun: number | null = null;
  let actionTypePolicyCapPresent = false;
  let conflict = false;
  const trace: AutonomyTraceItem[] = [];
  const hasWorkspaceRule = matched.some((rule) => rule.scope.level === "workspace" && rule.state === "published" && rule.effectiveFrom <= context.evaluatedAt);
  if (!hasWorkspaceRule) {
    trace.push(Object.freeze({
      ruleRef: "system_workspace_default", scopeKey: `workspace:${context.workspaceRef}`,
      outcome: "workspace_default", resultingMode: effective, maximumActionsPerRun,
    }));
  }

  const activeByScope = new Map<string, AutonomyMode>();
  let workspaceEstablished = false;
  for (const rule of matched) {
    const key = scopeKey(rule.scope);
    if (rule.state === "disabled") {
      trace.push(Object.freeze({ ruleRef: rule.ruleRef, scopeKey: key, outcome: "ignored_disabled", resultingMode: effective, maximumActionsPerRun }));
      continue;
    }
    if (rule.effectiveFrom > context.evaluatedAt) {
      trace.push(Object.freeze({ ruleRef: rule.ruleRef, scopeKey: key, outcome: "ignored_not_effective", resultingMode: effective, maximumActionsPerRun }));
      continue;
    }
    const expired = rule.expiresAt !== null && rule.expiresAt <= context.evaluatedAt;
    const candidateMode: AutonomyMode = expired && rule.mode === "policy_limited" ? "approval_only" : rule.mode;
    if (rule.killSwitch || candidateMode === "denied") {
      effective = "denied";
      trace.push(Object.freeze({
        ruleRef: rule.ruleRef, scopeKey: key,
        outcome: rule.killSwitch ? "kill_switch" : expired ? "expired_fail_closed" : "applied",
        resultingMode: effective, maximumActionsPerRun,
      }));
      continue;
    }
    const previousAtScope = activeByScope.get(key);
    if (previousAtScope !== undefined && previousAtScope !== candidateMode) {
      conflict = true;
      effective = "denied";
      trace.push(Object.freeze({ ruleRef: rule.ruleRef, scopeKey: key, outcome: "scope_conflict", resultingMode: effective, maximumActionsPerRun }));
      continue;
    }
    activeByScope.set(key, candidateMode);
    if (rule.scope.level === "workspace" && !workspaceEstablished) {
      effective = candidateMode;
      workspaceEstablished = true;
      if (rule.maximumActionsPerRun !== null) maximumActionsPerRun = rule.maximumActionsPerRun;
      trace.push(Object.freeze({
        ruleRef: rule.ruleRef, scopeKey: key,
        outcome: expired ? "expired_fail_closed" : "applied",
        resultingMode: effective, maximumActionsPerRun,
      }));
      continue;
    }
    if (MODES.indexOf(candidateMode) > MODES.indexOf(effective)) {
      conflict = true;
      effective = "denied";
      trace.push(Object.freeze({ ruleRef: rule.ruleRef, scopeKey: key, outcome: "widening_conflict", resultingMode: effective, maximumActionsPerRun }));
      continue;
    }
    effective = candidateMode;
    if (rule.maximumActionsPerRun !== null) {
      maximumActionsPerRun = maximumActionsPerRun === null
        ? rule.maximumActionsPerRun
        : Math.min(maximumActionsPerRun, rule.maximumActionsPerRun);
    }
    if (!expired && rule.scope.level === "action_type" && rule.mode === "policy_limited" && rule.maximumActionsPerRun !== null) {
      actionTypePolicyCapPresent = true;
    }
    trace.push(Object.freeze({
      ruleRef: rule.ruleRef, scopeKey: key,
      outcome: expired ? "expired_fail_closed" : "applied",
      resultingMode: effective, maximumActionsPerRun,
    }));
  }

  const reasonCodes: string[] = [];
  const budgetReasons = checkBudgetCaps(classified, normalized.budgetLimits);
  reasonCodes.push(...budgetReasons);
  if (normalized.protection.changeDisposition !== "allowed" && classified.risk !== "K0" && classified.risk !== "K1") {
    reasonCodes.push(normalized.protection.changeDisposition === "denied" ? "protected_scope_denied" : "protected_scope_unresolved");
  }
  if (conflict) reasonCodes.push("autonomy_conflict_denied");
  if (effective === "denied") reasonCodes.push("effective_autonomy_denied");

  let disposition: ActionPlan["disposition"];
  if (classified.risk === "K0") {
    disposition = effective === "denied" ? "denied" : "no_write";
  } else if (reasonCodes.length > 0) {
    disposition = "denied";
  } else if (classified.risk === "K3" || classified.risk === "K4" || effective === "approval_only") {
    disposition = "approval_required";
    reasonCodes.push(classified.risk === "K3" || classified.risk === "K4" ? "human_approval_mandatory_for_risk" : "approval_only_active");
  } else if (effective === "policy_limited") {
    if (maximumActionsPerRun === null || !actionTypePolicyCapPresent) {
      disposition = "denied";
      reasonCodes.push("action_type_policy_cap_missing");
    } else {
      disposition = "policy_limited_candidate";
      reasonCodes.push("bounded_policy_candidate_only");
    }
  } else {
    disposition = "denied";
    reasonCodes.push("effective_autonomy_denied");
  }

  const base = Object.freeze({
    schemaVersion: ACTION_PLAN_VERSION,
    actionType: classified.actionType,
    risk: classified.risk,
    action: classified.action,
    effectiveAutonomy: effective,
    disposition,
    reasonCodes: Object.freeze([...new Set(reasonCodes)].sort()),
    trace: Object.freeze(trace),
    budgetDelta: classified.budgetDelta,
    capabilities: Object.freeze({
      canExecute: false as const,
      canWriteMeta: false as const,
      canGrantApproval: false as const,
      canAccessRawGraph: false as const,
    }),
    contextHash: hash(context),
  });
  return Object.freeze({ ...base, planHash: hash(base) });
}
