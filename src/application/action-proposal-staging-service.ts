import { createHash } from "node:crypto";
import {
  assertValidApprovalLifecycle,
  createActionBundle,
  initializeApprovalLifecycle,
  type ActionActor,
  type ActionBundle,
  type ApprovalAuditEventIntent,
  type ApprovalLifecycle,
  type ApprovalPolicy,
  type FrozenPlanIdentity,
} from "@/domain/actions/approval-lifecycle";
import {
  ACTION_PLAN_VERSION,
  EXISTING_POST_SOURCE_BINDING_VERSION,
  type ActionPlan,
  type ActionRisk,
  type ActionType,
  type TypedActionIntent,
} from "@/domain/actions/autonomy-valve";

export const ACTION_PROPOSAL_STAGING_VERSION = "action-proposal-staging/1.0.0" as const;

export type PublicSafeActionSummary = Readonly<{
  safety: "public_safe";
  before: Readonly<{ label: string; value: string }>;
  after: Readonly<{ label: string; value: string }>;
  evidence: readonly Readonly<{ evidenceRef: string; label: string }>[];
}>;

export type ActionProposalStagingUnitInput = Readonly<{
  unitKey: string;
  plan: FrozenPlanIdentity;
  actionPlan: ActionPlan;
  workspaceRef: string;
  accountRef: string;
  entityRef: string;
  actionType: ActionType;
  risk: ActionRisk;
  actionHash: string;
  dependencies: readonly string[];
  summary: PublicSafeActionSummary;
}>;

export type ActionProposalStagingInput = Readonly<{
  plan: FrozenPlanIdentity;
  workspaceRef: string;
  accountRef: string;
  requester: ActionActor;
  proposedAt: string;
  expiresAt: string;
  units: readonly ActionProposalStagingUnitInput[];
}>;

export type StagedActionSummary = Readonly<{
  unitRef: string;
  actionPlanHash: string;
  actionHash: string;
  summaryHash: string;
  /** Server-private typed spec; public-safe presentation remains in summary. */
  actionPlan: ActionPlan;
  summary: PublicSafeActionSummary;
}>;

export type StagedActionProposal = Readonly<{
  version: typeof ACTION_PROPOSAL_STAGING_VERSION;
  idempotencyKey: string;
  bundle: ActionBundle;
  lifecycle: ApprovalLifecycle;
  auditEventIntents: readonly ApprovalAuditEventIntent[];
  summaries: readonly StagedActionSummary[];
  stagingHash: string;
  persistenceRequested: true;
  persisted: false;
  authority: "none";
  executionPerformed: false;
}>;

export type ActionProposalStagingErrorCode =
  | "invalid_input"
  | "invalid_plan"
  | "mixed_scope"
  | "mixed_plan"
  | "approval_queue_ineligible"
  | "duplicate_unit"
  | "conflicting_unit"
  | "invalid_dependency"
  | "unsafe_summary"
  | "bundle_rejected"
  | "approval_policy_rejected";

export class ActionProposalStagingError extends Error {
  constructor(readonly code: ActionProposalStagingErrorCode) {
    super("Eylem önerisi güvenli biçimde kuyruğa hazırlanamadı");
    this.name = "ActionProposalStagingError";
  }
}

const HASH = /^[a-f0-9]{64}$/;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const SAFE_TEXT_BLOCKLIST = /(?:access[_-]?token|authorization\s*:|bearer\s+|graph\.facebook|https?:\/\/|act_\d|\b[A-Za-z0-9_-]{80,}\b)/i;
const RISK_BY_ACTION: Readonly<Record<ActionType, ActionRisk>> = Object.freeze({
  no_change: "K0",
  internal_annotation: "K1",
  status_pause: "K2",
  status_activate: "K3",
  budget_decrease: "K2",
  budget_increase: "K3",
  existing_post_promotion: "K4",
});

function fail(code: ActionProposalStagingErrorCode): never {
  throw new ActionProposalStagingError(code);
}

function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype
    || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) {
    fail("invalid_input");
  }
}

function exactPlan(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype
    || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) {
    fail("invalid_plan");
  }
}

function stable(value: unknown, seen = new Set<object>()): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("invalid_input");
    return value;
  }
  if (!value || typeof value !== "object" || seen.has(value)) fail("invalid_input");
  seen.add(value);
  if (Array.isArray(value)) {
    const result = value.map((item) => stable(item, seen));
    seen.delete(value);
    return result;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) fail("invalid_input");
  const result = Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, child]) => [key, stable(child, seen)]));
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
  if (typeof value !== "string" || !REF.test(value) || value.includes("*")) fail("invalid_input");
  return value;
}

function hash(value: unknown): string {
  if (typeof value !== "string" || !HASH.test(value)) fail("invalid_input");
  return value;
}

function instant(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) fail("invalid_input");
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString() !== value) fail("invalid_input");
  return value;
}

function frozenPlan(value: FrozenPlanIdentity): FrozenPlanIdentity {
  exact(value, ["planRef", "revision", "planHash"]);
  if (!Number.isSafeInteger(value.revision) || value.revision < 1) fail("invalid_input");
  return freeze({ planRef: ref(value.planRef), revision: value.revision, planHash: hash(value.planHash) });
}

function samePlan(left: FrozenPlanIdentity, right: FrozenPlanIdentity): boolean {
  return left.planRef === right.planRef && left.revision === right.revision && left.planHash === right.planHash;
}

function safeText(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() || value.length > 240
    || /[\u0000-\u001f\u007f]/.test(value) || SAFE_TEXT_BLOCKLIST.test(value)) fail("unsafe_summary");
  return value;
}

function normalizeSummary(value: PublicSafeActionSummary): PublicSafeActionSummary {
  exact(value, ["safety", "before", "after", "evidence"]);
  if (value.safety !== "public_safe" || !Array.isArray(value.evidence) || value.evidence.length > 50) fail("unsafe_summary");
  const pair = (candidate: unknown): Readonly<{ label: string; value: string }> => {
    exact(candidate, ["label", "value"]);
    return freeze({ label: safeText(candidate.label), value: safeText(candidate.value) });
  };
  const evidence = value.evidence.map((candidate) => {
    exact(candidate, ["evidenceRef", "label"]);
    return freeze({ evidenceRef: ref(candidate.evidenceRef), label: safeText(candidate.label) });
  }).sort((left, right) => left.evidenceRef.localeCompare(right.evidenceRef));
  if (new Set(evidence.map((item) => item.evidenceRef)).size !== evidence.length) fail("unsafe_summary");
  return freeze({ safety: "public_safe", before: pair(value.before), after: pair(value.after), evidence: freeze(evidence) });
}

function validateActionShape(action: TypedActionIntent, actionType: ActionType): void {
  const expectedKind: Readonly<Record<ActionType, TypedActionIntent["kind"]>> = {
    no_change: "no_change",
    internal_annotation: "internal_annotation",
    status_pause: "status_change",
    status_activate: "status_change",
    budget_decrease: "budget_change",
    budget_increase: "budget_change",
    existing_post_promotion: "existing_post_promotion",
  };
  if (!action || typeof action !== "object" || action.kind !== expectedKind[actionType]) fail("invalid_plan");
  const keysByKind: Readonly<Record<TypedActionIntent["kind"], readonly string[]>> = {
    no_change: ["kind", "entity", "reasonRef"],
    internal_annotation: ["kind", "entity", "annotationRef"],
    status_change: ["kind", "entity", "fromStatus", "toStatus"],
    budget_change: ["kind", "entity", "budgetKind", "currency", "beforeDecimal", "afterDecimal", "budgetOwnerRef"],
    existing_post_promotion: [
      "kind", "entity", "placeholderOnly", "postRef", "postContentHash", "actorRef",
      "sourceBinding", "promotionTemplateVersionRef", "audiencePresetVersionRef", "destinationRef",
      "budgetPlanVersionRef", "timeframeRef", "scheduleMode", "durationDays",
    ],
  };
  const actionRecord = action as unknown as Record<string, unknown>;
  const legacyExistingPost = action.kind === "existing_post_promotion"
    && Object.hasOwn(actionRecord, "creativeBindingHash") && !Object.hasOwn(actionRecord, "sourceBinding");
  exactPlan(action, legacyExistingPost ? [
    "kind", "entity", "placeholderOnly", "postRef", "postContentHash", "actorRef",
    "creativeBindingHash", "promotionTemplateVersionRef", "audiencePresetVersionRef", "destinationRef",
    "budgetPlanVersionRef", "timeframeRef", "scheduleMode", "durationDays",
  ] : keysByKind[action.kind]);
  exactPlan(action.entity, ["level", "ref"]);
  ref(action.entity.ref);
  if (!(["campaign", "adset", "ad"] as const).includes(action.entity.level)) fail("invalid_plan");
  if (actionType === "status_pause" && (action.kind !== "status_change" || action.fromStatus !== "ACTIVE" || action.toStatus !== "PAUSED")) fail("invalid_plan");
  if (actionType === "status_activate" && (action.kind !== "status_change" || action.fromStatus !== "PAUSED" || action.toStatus !== "ACTIVE")) fail("invalid_plan");
  if ((actionType === "budget_decrease" || actionType === "budget_increase")
    && (action.kind !== "budget_change" || !["daily", "lifetime"].includes(action.budgetKind)
      || !["campaign", "adset"].includes(action.entity.level))) fail("invalid_plan");
  if (action.kind === "no_change") ref(action.reasonRef);
  if (action.kind === "internal_annotation") ref(action.annotationRef);
  if (action.kind === "budget_change") {
    if (!/^[A-Z]{3}$/.test(action.currency) || !/^(0|[1-9]\d{0,29})(?:\.\d{1,12})?$/.test(action.beforeDecimal)
      || !/^(0|[1-9]\d{0,29})(?:\.\d{1,12})?$/.test(action.afterDecimal)) fail("invalid_plan");
    ref(action.budgetOwnerRef);
  }
  if (actionType === "existing_post_promotion") {
    if (action.kind !== "existing_post_promotion" || action.placeholderOnly !== true || action.entity.level !== "adset") fail("invalid_plan");
    ref(action.postRef); hash(action.postContentHash);
    if (legacyExistingPost) {
      hash(actionRecord.creativeBindingHash);
    } else {
      const binding = action.sourceBinding;
      if (binding.kind === "existing_ad_binding") {
        exactPlan(binding, ["version", "kind", "bindingRef", "bindingHash"]);
        if (binding.version !== EXISTING_POST_SOURCE_BINDING_VERSION) fail("invalid_plan");
        if (binding.bindingRef !== null) ref(binding.bindingRef);
        hash(binding.bindingHash);
      } else if (binding.kind === "organic_post_binding") {
        exactPlan(binding, ["version", "kind", "sourceRef", "sourceHash", "postIdentityHash", "objectStorySpecHash"]);
        if (binding.version !== EXISTING_POST_SOURCE_BINDING_VERSION) fail("invalid_plan");
        ref(binding.sourceRef); hash(binding.sourceHash); hash(binding.postIdentityHash); hash(binding.objectStorySpecHash);
      } else fail("invalid_plan");
    }
    ref(action.actorRef); ref(action.promotionTemplateVersionRef);
    ref(action.audiencePresetVersionRef); ref(action.destinationRef); ref(action.budgetPlanVersionRef);
    ref(action.timeframeRef);
    if (!(["continuous", "fixed_duration"] as const).includes(action.scheduleMode)
      || action.durationDays !== null && (!Number.isSafeInteger(action.durationDays)
        || action.durationDays < 1 || action.durationDays > 365)
      || action.scheduleMode === "continuous" && action.durationDays !== null
      || action.scheduleMode === "fixed_duration" && action.durationDays === null) fail("invalid_plan");
  }
}

function validateActionPlan(value: ActionPlan): ActionPlan {
  exact(value, [
    "schemaVersion", "actionType", "risk", "action", "effectiveAutonomy", "disposition",
    "reasonCodes", "trace", "budgetDelta", "capabilities", "contextHash", "planHash",
  ]);
  if (value.schemaVersion !== ACTION_PLAN_VERSION || !Object.hasOwn(RISK_BY_ACTION, value.actionType)
    || value.risk !== RISK_BY_ACTION[value.actionType]) fail("invalid_plan");
  if (value.disposition !== "approval_required") fail("approval_queue_ineligible");
  if (value.risk === "K0" || value.actionType === "no_change") fail("approval_queue_ineligible");
  exact(value.capabilities, ["canExecute", "canWriteMeta", "canGrantApproval", "canAccessRawGraph"]);
  if (value.capabilities.canExecute !== false || value.capabilities.canWriteMeta !== false
    || value.capabilities.canGrantApproval !== false || value.capabilities.canAccessRawGraph !== false) fail("invalid_plan");
  if (value.effectiveAutonomy !== "approval_only" || !Array.isArray(value.reasonCodes)
    || value.reasonCodes.length < 1 || value.reasonCodes.length > 50 || !Array.isArray(value.trace)
    || value.trace.length < 1 || value.trace.length > 100) fail("invalid_plan");
  for (const reason of value.reasonCodes) ref(reason);
  for (const step of value.trace) {
    exactPlan(step, ["ruleRef", "scopeKey", "outcome", "resultingMode", "maximumActionsPerRun"]);
    ref(step.ruleRef);
    const outcome = step.outcome as string;
    const resultingMode = step.resultingMode as string;
    const maximumActionsPerRun = step.maximumActionsPerRun as number | null;
    if (typeof step.scopeKey !== "string" || !step.scopeKey || step.scopeKey.length > 256
      || !["workspace_default", "applied", "ignored_disabled", "ignored_not_effective", "expired_fail_closed", "widening_conflict", "scope_conflict", "kill_switch"].includes(outcome)
      || !["denied", "approval_only", "policy_limited"].includes(resultingMode)
      || maximumActionsPerRun !== null && (!Number.isSafeInteger(maximumActionsPerRun) || maximumActionsPerRun < 1)) {
      fail("invalid_plan");
    }
  }
  validateActionShape(value.action, value.actionType);
  if (value.action.kind === "budget_change") {
    const decimal = (input: string) => {
      const [whole, fraction = ""] = input.split(".");
      return { coefficient: BigInt(`${whole}${fraction}`), scale: fraction.length };
    };
    const before = decimal(value.action.beforeDecimal);
    const after = decimal(value.action.afterDecimal);
    const scale = Math.max(before.scale, after.scale);
    const beforeValue = before.coefficient * 10n ** BigInt(scale - before.scale);
    const afterValue = after.coefficient * 10n ** BigInt(scale - after.scale);
    const direction = afterValue < beforeValue ? "decrease" : afterValue > beforeValue ? "increase" : null;
    if (direction === null || value.action.budgetOwnerRef !== value.action.entity.ref
      || value.actionType !== `budget_${direction}` || value.budgetDelta === null) fail("invalid_plan");
    exactPlan(value.budgetDelta, ["currency", "direction", "absoluteDecimal"]);
    if (value.budgetDelta.currency !== value.action.currency || value.budgetDelta.direction !== direction
      || !/^(0|[1-9]\d{0,29})(?:\.\d{1,12})?$/.test(value.budgetDelta.absoluteDecimal)) fail("invalid_plan");
  } else if (value.budgetDelta !== null) fail("invalid_plan");
  hash(value.contextHash);
  hash(value.planHash);
  const { planHash, ...base } = value;
  if (digest(base) !== planHash) fail("invalid_plan");
  return freeze(value);
}

function normalizeRequester(value: ActionActor): ActionActor {
  exact(value, ["actorRef", "role"]);
  if (!["owner", "admin", "operator", "analyst"].includes(value.role)) fail("invalid_input");
  return freeze({ actorRef: ref(value.actorRef), role: value.role });
}

/** Canonical runtime verifier shared by persistence and any future queue adapter. */
export function assertValidStagedActionProposal(candidate: unknown): asserts candidate is StagedActionProposal {
  exact(candidate, [
    "version", "idempotencyKey", "bundle", "lifecycle", "auditEventIntents", "summaries", "stagingHash",
    "persistenceRequested", "persisted", "authority", "executionPerformed",
  ]);
  if (candidate.version !== ACTION_PROPOSAL_STAGING_VERSION || candidate.persistenceRequested !== true
    || candidate.persisted !== false || candidate.authority !== "none" || candidate.executionPerformed !== false
    || !Array.isArray(candidate.auditEventIntents) || !Array.isArray(candidate.summaries)) fail("invalid_input");
  const idempotencyKey = hash(candidate.idempotencyKey);
  const stagingHash = hash(candidate.stagingHash);
  let lifecycle: ApprovalLifecycle;
  try {
    assertValidApprovalLifecycle(candidate.lifecycle);
    lifecycle = candidate.lifecycle;
  } catch {
    fail("invalid_input");
  }
  if (lifecycle.units.some((unit) => unit.state !== "awaiting_approval" || unit.decisionRef !== null
    || unit.decisionActor !== null || unit.decidedAt !== null || unit.reasonCode !== null || unit.grant !== null)
    || lifecycle.trace.length !== 1 || lifecycle.trace[0]?.eventType !== "lifecycle_initialized"
    || lifecycle.trace[0].unitRef !== null || lifecycle.trace[0].unitHash !== null
    || lifecycle.trace[0].actorRef !== null || lifecycle.executionAuthority !== "none"
    || lifecycle.bundle.bundleRef !== `action_bundle_${idempotencyKey.slice(0, 20)}`
    || digest(candidate.bundle) !== digest(lifecycle.bundle)
    || digest(candidate.auditEventIntents) !== digest(lifecycle.trace)
    || candidate.summaries.length !== lifecycle.bundle.units.length) fail("invalid_input");

  const definitions = new Map(lifecycle.bundle.units.map((unit) => [unit.unitRef, unit]));
  const seen = new Set<string>();
  for (const rawSummary of candidate.summaries) {
    exact(rawSummary, ["unitRef", "actionPlanHash", "actionHash", "summaryHash", "actionPlan", "summary"]);
    const unitRef = ref(rawSummary.unitRef);
    const unit = definitions.get(unitRef);
    if (!unit || seen.has(unitRef)) fail("invalid_input");
    seen.add(unitRef);
    const actionPlan = validateActionPlan(rawSummary.actionPlan as ActionPlan);
    const summary = normalizeSummary(rawSummary.summary as PublicSafeActionSummary);
    const actionPlanHash = hash(rawSummary.actionPlanHash);
    const actionHash = hash(rawSummary.actionHash);
    const summaryHash = hash(rawSummary.summaryHash);
    if (actionPlan.planHash !== actionPlanHash || digest(actionPlan.action) !== actionHash
      || digest(summary) !== summaryHash || actionPlan.actionType !== unit.scope.actionType
      || actionPlan.risk !== unit.risk || actionPlan.contextHash !== unit.contextHash
      || actionPlan.planHash !== unit.sourceHash || actionPlan.action.entity.ref !== unit.scope.entityRef
      || unit.specHash !== digest({ actionHash, summaryHash })) fail("invalid_input");
  }
  const { stagingHash: _stagingHash, ...base } = candidate;
  if (digest(base) !== stagingHash) fail("invalid_input");
}

export class ActionProposalStagingService {
  constructor(private readonly approvalPolicy: ApprovalPolicy) {}

  stage(raw: ActionProposalStagingInput): StagedActionProposal {
    exact(raw, ["plan", "workspaceRef", "accountRef", "requester", "proposedAt", "expiresAt", "units"]);
    const plan = frozenPlan(raw.plan);
    const workspaceRef = ref(raw.workspaceRef);
    const accountRef = ref(raw.accountRef);
    const requester = normalizeRequester(raw.requester);
    const proposedAt = instant(raw.proposedAt);
    const expiresAt = instant(raw.expiresAt);
    const proposalLifetimeMilliseconds = Date.parse(expiresAt) - Date.parse(proposedAt);
    if (expiresAt <= proposedAt
      || proposalLifetimeMilliseconds > this.approvalPolicy.maximumProposalLifetimeSeconds * 1_000
      || !Array.isArray(raw.units) || raw.units.length < 1 || raw.units.length > 200) fail("invalid_input");

    const unitKeys = new Set<string>();
    const actionPlanHashes = new Set<string>();
    const actionHashes = new Set<string>();
    const mutationKeys = new Set<string>();
    const normalized = raw.units.map((candidate) => {
      exact(candidate, [
        "unitKey", "plan", "actionPlan", "workspaceRef", "accountRef", "entityRef",
        "actionType", "risk", "actionHash", "dependencies", "summary",
      ]);
      const unitKey = ref(candidate.unitKey);
      if (unitKeys.has(unitKey)) fail("duplicate_unit");
      unitKeys.add(unitKey);
      const unitPlan = frozenPlan(candidate.plan as FrozenPlanIdentity);
      if (!samePlan(plan, unitPlan)) fail("mixed_plan");
      if (ref(candidate.workspaceRef) !== workspaceRef || ref(candidate.accountRef) !== accountRef) fail("mixed_scope");
      const actionPlan = validateActionPlan(candidate.actionPlan as ActionPlan);
      if (candidate.actionType !== actionPlan.actionType || candidate.risk !== actionPlan.risk) fail("invalid_plan");
      const entityRef = ref(candidate.entityRef);
      if (entityRef !== actionPlan.action.entity.ref) fail("invalid_plan");
      const computedActionHash = digest(actionPlan.action);
      if (hash(candidate.actionHash) !== computedActionHash) fail("invalid_plan");
      if (actionPlanHashes.has(actionPlan.planHash) || actionHashes.has(computedActionHash)) fail("duplicate_unit");
      actionPlanHashes.add(actionPlan.planHash);
      actionHashes.add(computedActionHash);
      const mutationKey = `${workspaceRef}:${accountRef}:${entityRef}:${actionPlan.actionType}`;
      if (mutationKeys.has(mutationKey)) fail("conflicting_unit");
      mutationKeys.add(mutationKey);
      if (!Array.isArray(candidate.dependencies) || new Set(candidate.dependencies).size !== candidate.dependencies.length) fail("invalid_dependency");
      const dependencies = candidate.dependencies.map(ref).sort();
      const summary = normalizeSummary(candidate.summary as PublicSafeActionSummary);
      return freeze({
        unitKey, unitPlan, actionPlan, entityRef, actionHash: computedActionHash,
        dependencies: freeze(dependencies), summary, summaryHash: digest(summary),
      });
    }).sort((left, right) => left.unitKey.localeCompare(right.unitKey));

    for (const unit of normalized) {
      if (unit.dependencies.includes(unit.unitKey) || unit.dependencies.some((dependency) => !unitKeys.has(dependency))) fail("invalid_dependency");
    }
    const fingerprintCore = {
      plan, workspaceRef, accountRef, requester, proposedAt, expiresAt,
      units: normalized.map((unit) => ({
        unitKey: unit.unitKey, actionPlanHash: unit.actionPlan.planHash, actionHash: unit.actionHash,
        dependencies: unit.dependencies, summaryHash: unit.summaryHash,
      })),
    };
    const idempotencyKey = digest(fingerprintCore);
    const unitRefByKey = new Map(normalized.map((unit) => [
      unit.unitKey,
      `action_unit_${digest({ idempotencyKey, unitKey: unit.unitKey }).slice(0, 20)}`,
    ]));

    let bundle: ActionBundle;
    try {
      bundle = createActionBundle({
        bundleRef: `action_bundle_${idempotencyKey.slice(0, 20)}`,
        plan,
        units: normalized.map((unit) => ({
          unitRef: unitRefByKey.get(unit.unitKey)!,
          scope: { workspaceRef, accountRef, entityRef: unit.entityRef, actionType: unit.actionPlan.actionType },
          risk: unit.actionPlan.risk,
          sourceHash: unit.actionPlan.planHash,
          contextHash: unit.actionPlan.contextHash,
          specHash: digest({ actionHash: unit.actionHash, summaryHash: unit.summaryHash }),
          dependencies: unit.dependencies.map((dependency) => unitRefByKey.get(dependency)!),
          requester,
          proposedAt,
          expiresAt,
        })),
      });
    } catch {
      fail("bundle_rejected");
    }

    let initialized: ReturnType<typeof initializeApprovalLifecycle>;
    try {
      initialized = initializeApprovalLifecycle({
        bundle,
        policy: this.approvalPolicy,
        initializedAt: proposedAt,
        eventRef: `approval_event_${bundle.bundleHash.slice(0, 40)}`,
      });
    } catch {
      fail("approval_policy_rejected");
    }
    const summaries = freeze(normalized.map((unit) => freeze({
      unitRef: unitRefByKey.get(unit.unitKey)!,
      actionPlanHash: unit.actionPlan.planHash,
      actionHash: unit.actionHash,
      summaryHash: unit.summaryHash,
      actionPlan: unit.actionPlan,
      summary: unit.summary,
    })));
    const base = freeze({
      version: ACTION_PROPOSAL_STAGING_VERSION,
      idempotencyKey,
      bundle,
      lifecycle: initialized.lifecycle,
      auditEventIntents: initialized.auditEventIntents,
      summaries,
      persistenceRequested: true as const,
      persisted: false as const,
      authority: "none" as const,
      executionPerformed: false as const,
    });
    return freeze({ ...base, stagingHash: digest(base) });
  }
}
