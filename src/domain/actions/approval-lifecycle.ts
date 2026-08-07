import { createHash } from "node:crypto";

export const ACTION_APPROVAL_LIFECYCLE_VERSION = "action-approval-lifecycle/1.0.0" as const;
export const ACTION_BUNDLE_VERSION = "action-bundle/1.0.0" as const;
export const ACTION_APPROVAL_POLICY_VERSION = "action-approval-policy/1.0.0" as const;
export const ACTION_APPROVAL_GRANT_VERSION = "action-approval-grant/1.0.0" as const;

export type ActionRisk = "K0" | "K1" | "K2" | "K3" | "K4";
export type ActionActorRole = "owner" | "admin" | "operator" | "analyst";
export type ActionApprovalRole = Exclude<ActionActorRole, "analyst">;
export type ActionUnitApprovalState =
  | "awaiting_approval"
  | "approved"
  | "rejected"
  | "changes_requested"
  | "expired"
  | "stale"
  | "superseded"
  | "dependency_failed";

export type ActionActor = Readonly<{ actorRef: string; role: ActionActorRole }>;
export type ActionScope = Readonly<{
  workspaceRef: string;
  accountRef: string;
  entityRef: string;
  actionType: string;
}>;
export type FrozenPlanIdentity = Readonly<{ planRef: string; revision: number; planHash: string }>;

export type ActionUnitInput = Readonly<{
  unitRef: string;
  scope: ActionScope;
  risk: ActionRisk;
  sourceHash: string;
  contextHash: string;
  specHash: string;
  dependencies: readonly string[];
  requester: ActionActor;
  proposedAt: string;
  expiresAt: string;
}>;

export type ActionUnit = Readonly<ActionUnitInput & {
  plan: FrozenPlanIdentity;
  unitHash: string;
  scopeHash: string;
}>;

/** Bundle carries grouping and dependency topology only; never approval or execution authority. */
export type ActionBundle = Readonly<{
  version: typeof ACTION_BUNDLE_VERSION;
  bundleRef: string;
  plan: FrozenPlanIdentity;
  units: readonly ActionUnit[];
  bundleHash: string;
}>;

export type ApprovalPolicy = Readonly<{
  version: typeof ACTION_APPROVAL_POLICY_VERSION;
  policyRef: string;
  revision: number;
  autonomyMode?: "approval_only";
  requesterRoles: readonly ActionActorRole[];
  approverRoles: readonly Readonly<{ risk: ActionRisk; roles: readonly ActionApprovalRole[] }>[];
  grantConsumerRoles: readonly ActionApprovalRole[];
  separationOfDutiesRisks: readonly ActionRisk[];
  maximumGrantLifetimeSeconds: number;
}>;

export type ResolvedApprovalPolicy = Readonly<Omit<ApprovalPolicy, "autonomyMode"> & {
  autonomyMode: "approval_only";
  policyHash: string;
}>;

export type HumanApprovalAuthorization = Readonly<{
  authorizationRef: string;
  unitRef: string;
  unitHash: string;
  scopeHash: string;
  actor: ActionActor;
  issuedAt: string;
  expiresAt: string;
  humanPresence: true;
  canExecute: false;
}>;

export type ActionApprovalGrant = Readonly<{
  version: typeof ACTION_APPROVAL_GRANT_VERSION;
  grantRef: string;
  unitRef: string;
  unitHash: string;
  scopeHash: string;
  planRef: string;
  planRevision: number;
  planHash: string;
  approver: ActionActor;
  approvedAt: string;
  expiresAt: string;
  singleUse: true;
  consumedAt: string | null;
  consumedBy: ActionActor | null;
  capability: "approval_evidence_only";
  canExecute: false;
  grantHash: string;
}>;

export type ApprovalUnitState = Readonly<{
  unitRef: string;
  unitHash: string;
  state: ActionUnitApprovalState;
  decisionRef: string | null;
  decisionActor: ActionActor | null;
  decidedAt: string | null;
  reasonCode: string | null;
  grant: ActionApprovalGrant | null;
}>;

export type ApprovalAuditEventIntent = Readonly<{
  version: typeof ACTION_APPROVAL_LIFECYCLE_VERSION;
  eventRef: string;
  sequence: number;
  previousHash: string;
  eventType:
    | "lifecycle_initialized"
    | "unit_approved"
    | "unit_rejected"
    | "unit_changes_requested"
    | "unit_expired"
    | "unit_stale"
    | "unit_superseded"
    | "unit_dependency_failed"
    | "approval_grant_consumed";
  bundleRef: string;
  unitRef: string | null;
  unitHash: string | null;
  actorRef: string | null;
  occurredAt: string;
  reasonCode: string;
  eventHash: string;
  persistRequested: true;
  persisted: false;
  executionAuthority: "none";
}>;

export type ApprovalLifecycle = Readonly<{
  version: typeof ACTION_APPROVAL_LIFECYCLE_VERSION;
  bundle: ActionBundle;
  policy: ResolvedApprovalPolicy;
  units: readonly ApprovalUnitState[];
  trace: readonly ApprovalAuditEventIntent[];
  traceHash: string;
  executionAuthority: "none";
}>;

export type UnitFreshness = Readonly<{
  unitRef: string;
  planRevision: number;
  planHash: string;
  sourceHash: string;
  contextHash: string;
  specHash: string;
}>;

export type ApprovalDecisionCommand =
  | Readonly<{
    kind: "approve";
    commandRef: string;
    unitRef: string;
    actor: ActionActor;
    decidedAt: string;
    reasonCode: string;
    freshness: readonly UnitFreshness[];
    authorization: HumanApprovalAuthorization;
    grantRef: string;
  }>
  | Readonly<{
    kind: "reject" | "request_changes";
    commandRef: string;
    unitRef: string;
    actor: ActionActor;
    decidedAt: string;
    reasonCode: string;
    freshness: readonly UnitFreshness[];
  }>;

export type ApprovalTransitionResult = Readonly<{
  lifecycle: ApprovalLifecycle;
  auditEventIntents: readonly ApprovalAuditEventIntent[];
  executionAuthority: "none";
  executionPerformed: false;
}>;

export class ActionApprovalLifecycleError extends Error {
  constructor(readonly code:
    | "invalid_input"
    | "invalid_bundle"
    | "missing_dependency"
    | "dependency_cycle"
    | "policy_denied"
    | "separation_of_duties"
    | "invalid_transition"
    | "authorization_mismatch"
    | "grant_expired"
    | "grant_used"
    | "stale_unit"
    | "dependency_failed") {
    super(`Action approval lifecycle reddedildi: ${code}`);
    this.name = "ActionApprovalLifecycleError";
  }
}

const HASH = /^[a-f0-9]{64}$/;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const CODE = /^[a-z][a-z0-9_.:-]{0,127}$/;
const RISKS: readonly ActionRisk[] = ["K0", "K1", "K2", "K3", "K4"];
const ROLES: readonly ActionActorRole[] = ["owner", "admin", "operator", "analyst"];
const APPROVER_ROLES: readonly ActionApprovalRole[] = ["owner", "admin", "operator"];
const ZERO_HASH = "0".repeat(64);

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
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

function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length
    || Object.keys(value).some((key) => !keys.includes(key))) fail("invalid_input");
}

function fail(code: ActionApprovalLifecycleError["code"]): never {
  throw new ActionApprovalLifecycleError(code);
}

function ref(value: unknown): string {
  if (typeof value !== "string" || !REF.test(value) || value.includes("*")) fail("invalid_input");
  return value;
}

function hash(value: unknown): string {
  if (typeof value !== "string" || !HASH.test(value)) fail("invalid_input");
  return value;
}

function code(value: unknown): string {
  if (typeof value !== "string" || !CODE.test(value) || value.includes("*")) fail("invalid_input");
  return value;
}

function instant(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) fail("invalid_input");
  return new Date(value).toISOString();
}

function actor(value: unknown): ActionActor {
  exact(value, ["actorRef", "role"]);
  const normalized = { actorRef: ref(value.actorRef), role: value.role as ActionActorRole };
  if (!ROLES.includes(normalized.role)) fail("invalid_input");
  return freeze(normalized);
}

function plan(value: FrozenPlanIdentity): FrozenPlanIdentity {
  exact(value, ["planRef", "revision", "planHash"]);
  if (!Number.isSafeInteger(value.revision) || value.revision < 1) fail("invalid_input");
  return freeze({ planRef: ref(value.planRef), revision: value.revision, planHash: hash(value.planHash) });
}

function scope(value: ActionScope): ActionScope {
  exact(value, ["workspaceRef", "accountRef", "entityRef", "actionType"]);
  return freeze({
    workspaceRef: ref(value.workspaceRef), accountRef: ref(value.accountRef),
    entityRef: ref(value.entityRef), actionType: code(value.actionType),
  });
}

function normalizeRoles<T extends ActionActorRole>(value: readonly T[], allowed: readonly ActionActorRole[]): readonly T[] {
  if (!Array.isArray(value) || new Set(value).size !== value.length || value.some((role) => !allowed.includes(role))) {
    fail("invalid_input");
  }
  return freeze([...value].sort());
}

function normalizePolicy(candidate: ApprovalPolicy): ResolvedApprovalPolicy {
  exact(candidate, [
    "version", "policyRef", "revision", ...(Object.hasOwn(candidate, "autonomyMode") ? ["autonomyMode"] : []),
    "requesterRoles", "approverRoles", "grantConsumerRoles", "separationOfDutiesRisks",
    "maximumGrantLifetimeSeconds",
  ]);
  if (candidate.version !== ACTION_APPROVAL_POLICY_VERSION || (candidate.autonomyMode ?? "approval_only") !== "approval_only"
    || !Number.isSafeInteger(candidate.revision) || candidate.revision < 1
    || !Number.isSafeInteger(candidate.maximumGrantLifetimeSeconds)
    || candidate.maximumGrantLifetimeSeconds < 1 || candidate.maximumGrantLifetimeSeconds > 86_400
    || !Array.isArray(candidate.approverRoles) || !Array.isArray(candidate.separationOfDutiesRisks)
    || new Set(candidate.separationOfDutiesRisks).size !== candidate.separationOfDutiesRisks.length
    || candidate.separationOfDutiesRisks.some((risk) => !RISKS.includes(risk))) fail("invalid_input");
  const seen = new Set<ActionRisk>();
  const approverRoles = candidate.approverRoles.map((entry) => {
    exact(entry, ["risk", "roles"]);
    const risk = entry.risk as ActionRisk;
    if (!RISKS.includes(risk) || seen.has(risk)) fail("invalid_input");
    seen.add(risk);
    return freeze({ risk, roles: normalizeRoles(entry.roles as readonly ActionApprovalRole[], APPROVER_ROLES) });
  }).sort((left, right) => left.risk.localeCompare(right.risk));
  const core = {
    version: ACTION_APPROVAL_POLICY_VERSION,
    policyRef: ref(candidate.policyRef),
    revision: candidate.revision,
    autonomyMode: "approval_only" as const,
    requesterRoles: normalizeRoles(candidate.requesterRoles, ROLES),
    approverRoles: freeze(approverRoles),
    grantConsumerRoles: normalizeRoles(candidate.grantConsumerRoles, APPROVER_ROLES),
    separationOfDutiesRisks: freeze([...candidate.separationOfDutiesRisks].sort()),
    maximumGrantLifetimeSeconds: candidate.maximumGrantLifetimeSeconds,
  };
  return freeze({ ...core, policyHash: digest(core) });
}

export function createActionBundle(input: Readonly<{
  bundleRef: string;
  plan: FrozenPlanIdentity;
  units: readonly ActionUnitInput[];
}>): ActionBundle {
  exact(input, ["bundleRef", "plan", "units"]);
  const frozenPlan = plan(input.plan);
  if (!Array.isArray(input.units) || input.units.length < 1 || input.units.length > 200) fail("invalid_bundle");
  const refs = new Set<string>();
  const units = input.units.map((candidate) => {
    exact(candidate, [
      "unitRef", "scope", "risk", "sourceHash", "contextHash", "specHash", "dependencies",
      "requester", "proposedAt", "expiresAt",
    ]);
    const unitRef = ref(candidate.unitRef);
    const risk = candidate.risk as ActionRisk;
    if (refs.has(unitRef) || !RISKS.includes(risk) || !Array.isArray(candidate.dependencies)
      || new Set(candidate.dependencies).size !== candidate.dependencies.length) fail("invalid_bundle");
    refs.add(unitRef);
    const normalizedScope = scope(candidate.scope as ActionScope);
    const proposedAt = instant(candidate.proposedAt);
    const expiresAt = instant(candidate.expiresAt);
    if (Date.parse(expiresAt) <= Date.parse(proposedAt)) fail("invalid_bundle");
    const core = {
      unitRef,
      plan: frozenPlan,
      scope: normalizedScope,
      risk,
      sourceHash: hash(candidate.sourceHash),
      contextHash: hash(candidate.contextHash),
      specHash: hash(candidate.specHash),
      dependencies: freeze(candidate.dependencies.map(ref).sort()),
      requester: actor(candidate.requester),
      proposedAt,
      expiresAt,
      scopeHash: digest(normalizedScope),
    };
    return freeze({ ...core, unitHash: digest(core) });
  }).sort((left, right) => left.unitRef.localeCompare(right.unitRef));
  const byRef = new Map(units.map((unit) => [unit.unitRef, unit]));
  for (const unit of units) {
    if (unit.dependencies.includes(unit.unitRef) || unit.dependencies.some((dependency) => !byRef.has(dependency))) {
      fail("missing_dependency");
    }
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (unitRef: string): void => {
    if (visiting.has(unitRef)) fail("dependency_cycle");
    if (visited.has(unitRef)) return;
    visiting.add(unitRef);
    for (const dependency of byRef.get(unitRef)!.dependencies) visit(dependency);
    visiting.delete(unitRef);
    visited.add(unitRef);
  };
  for (const unit of units) visit(unit.unitRef);
  const core = { version: ACTION_BUNDLE_VERSION, bundleRef: ref(input.bundleRef), plan: frozenPlan, units: freeze(units) };
  return freeze({ ...core, bundleHash: digest(core) });
}

function appendEvent(
  lifecycle: ApprovalLifecycle | null,
  input: Omit<ApprovalAuditEventIntent, "version" | "sequence" | "previousHash" | "eventHash" | "persistRequested" | "persisted" | "executionAuthority">,
): ApprovalAuditEventIntent {
  const eventRef = ref(input.eventRef);
  if (lifecycle?.trace.some((event) => event.eventRef === eventRef)) fail("invalid_transition");
  const previousHash = lifecycle?.trace.at(-1)?.eventHash ?? ZERO_HASH;
  const occurredAt = instant(input.occurredAt);
  if (lifecycle?.trace.at(-1) && Date.parse(occurredAt) < Date.parse(lifecycle.trace.at(-1)!.occurredAt)) {
    fail("invalid_input");
  }
  const core = {
    version: ACTION_APPROVAL_LIFECYCLE_VERSION,
    eventRef,
    sequence: (lifecycle?.trace.length ?? 0) + 1,
    previousHash,
    eventType: input.eventType,
    bundleRef: ref(input.bundleRef),
    unitRef: input.unitRef === null ? null : ref(input.unitRef),
    unitHash: input.unitHash === null ? null : hash(input.unitHash),
    actorRef: input.actorRef === null ? null : ref(input.actorRef),
    occurredAt,
    reasonCode: code(input.reasonCode),
    persistRequested: true as const,
    persisted: false as const,
    executionAuthority: "none" as const,
  };
  return freeze({ ...core, eventHash: digest(core) });
}

function withEvents(
  lifecycle: ApprovalLifecycle,
  units: readonly ApprovalUnitState[],
  events: readonly ApprovalAuditEventIntent[],
): ApprovalLifecycle {
  const trace = freeze([...lifecycle.trace, ...events]);
  return freeze({ ...lifecycle, units: freeze([...units]), trace, traceHash: digest(trace) });
}

export function initializeApprovalLifecycle(input: Readonly<{
  bundle: ActionBundle;
  policy: ApprovalPolicy;
  initializedAt: string;
  eventRef: string;
}>): ApprovalTransitionResult {
  exact(input, ["bundle", "policy", "initializedAt", "eventRef"]);
  exact(input.bundle, ["version", "bundleRef", "plan", "units", "bundleHash"]);
  const rebuilt = createActionBundle({
    bundleRef: input.bundle.bundleRef,
    plan: input.bundle.plan,
    units: input.bundle.units.map(({ plan: _plan, unitHash: _unitHash, scopeHash: _scopeHash, ...unit }) => unit),
  });
  if (rebuilt.bundleHash !== input.bundle.bundleHash) fail("invalid_bundle");
  const policy = normalizePolicy(input.policy);
  if (rebuilt.units.some((unit) => !policy.requesterRoles.includes(unit.requester.role))) fail("policy_denied");
  const occurredAt = instant(input.initializedAt);
  if (rebuilt.units.some((unit) => Date.parse(occurredAt) < Date.parse(unit.proposedAt))) fail("invalid_input");
  const units = freeze(rebuilt.units.map((unit) => freeze({
    unitRef: unit.unitRef, unitHash: unit.unitHash, state: "awaiting_approval" as const,
    decisionRef: null, decisionActor: null, decidedAt: null, reasonCode: null, grant: null,
  })));
  const shell: ApprovalLifecycle = freeze({
    version: ACTION_APPROVAL_LIFECYCLE_VERSION, bundle: rebuilt, policy, units,
    trace: freeze([]), traceHash: digest([]), executionAuthority: "none",
  });
  const event = appendEvent(null, {
    eventRef: input.eventRef, eventType: "lifecycle_initialized", bundleRef: rebuilt.bundleRef,
    unitRef: null, unitHash: null, actorRef: null, occurredAt, reasonCode: "approval_only_initialized",
  });
  const lifecycle = withEvents(shell, units, [event]);
  return freeze({ lifecycle, auditEventIntents: freeze([event]), executionAuthority: "none", executionPerformed: false });
}

function validateLifecycle(candidate: ApprovalLifecycle): ApprovalLifecycle {
  exact(candidate, ["version", "bundle", "policy", "units", "trace", "traceHash", "executionAuthority"]);
  if (candidate.version !== ACTION_APPROVAL_LIFECYCLE_VERSION || candidate.executionAuthority !== "none"
    || digest(candidate.trace) !== candidate.traceHash || candidate.units.length !== candidate.bundle.units.length) fail("invalid_input");
  exact(candidate.bundle, ["version", "bundleRef", "plan", "units", "bundleHash"]);
  if (candidate.bundle.version !== ACTION_BUNDLE_VERSION) fail("invalid_bundle");
  const rebuiltBundle = createActionBundle({
    bundleRef: candidate.bundle.bundleRef,
    plan: candidate.bundle.plan,
    units: candidate.bundle.units.map(({ plan: _plan, unitHash: _unitHash, scopeHash: _scopeHash, ...unit }) => unit),
  });
  if (rebuiltBundle.bundleHash !== candidate.bundle.bundleHash) fail("invalid_bundle");
  const { policyHash, ...policyInput } = candidate.policy;
  if (normalizePolicy(policyInput).policyHash !== policyHash) fail("invalid_input");
  const definitions = new Map(candidate.bundle.units.map((unit) => [unit.unitRef, unit]));
  const seen = new Set<string>();
  const grantRefs = new Set<string>();
  for (const unit of candidate.units) {
    exact(unit, ["unitRef", "unitHash", "state", "decisionRef", "decisionActor", "decidedAt", "reasonCode", "grant"]);
    const definition = definitions.get(unit.unitRef);
    if (!definition || definition.unitHash !== unit.unitHash || seen.has(unit.unitRef)
      || !["awaiting_approval", "approved", "rejected", "changes_requested", "expired", "stale", "superseded", "dependency_failed"].includes(unit.state)) {
      fail("invalid_input");
    }
    seen.add(unit.unitRef);
    if (unit.state === "approved" ? unit.grant === null : unit.grant !== null) fail("invalid_input");
    const hasDecisionActor = unit.decisionActor !== null;
    const hasDecisionRef = unit.decisionRef !== null;
    const hasDecidedAt = unit.decidedAt !== null;
    const hasCompleteDecision = hasDecisionActor && hasDecisionRef && hasDecidedAt;
    if (unit.state === "awaiting_approval") {
      if (hasDecisionActor || hasDecisionRef || hasDecidedAt || unit.reasonCode !== null || unit.grant !== null) {
        fail("invalid_input");
      }
    } else if (unit.state === "approved" || unit.state === "rejected" || unit.state === "changes_requested") {
      if (!hasCompleteDecision || unit.reasonCode === null) fail("invalid_input");
    } else if ((hasDecisionActor || hasDecisionRef || hasDecidedAt) && !hasCompleteDecision) {
      fail("invalid_input");
    }
    let normalizedDecisionActor: ActionActor | null = null;
    if (hasCompleteDecision) {
      ref(unit.decisionRef);
      instant(unit.decidedAt);
      normalizedDecisionActor = actor(unit.decisionActor);
      if (normalizedDecisionActor.role === "analyst"
        || !policyRoles(candidate, definition.risk).includes(normalizedDecisionActor.role)
        || (candidate.policy.separationOfDutiesRisks.includes(definition.risk)
          && normalizedDecisionActor.actorRef === definition.requester.actorRef)) fail("invalid_input");
    }
    if (unit.reasonCode !== null) code(unit.reasonCode);
    if (unit.grant) {
      exact(unit.grant, [
        "version", "grantRef", "unitRef", "unitHash", "scopeHash", "planRef", "planRevision", "planHash",
        "approver", "approvedAt", "expiresAt", "singleUse", "consumedAt", "consumedBy", "capability", "canExecute", "grantHash",
      ]);
      const { grantHash, ...grantCore } = unit.grant;
      const grantRef = ref(unit.grant.grantRef);
      const approver = actor(unit.grant.approver);
      const approvedAt = instant(unit.grant.approvedAt);
      const expiresAt = instant(unit.grant.expiresAt);
      const consumedAt = unit.grant.consumedAt === null ? null : instant(unit.grant.consumedAt);
      const consumedBy = unit.grant.consumedBy === null ? null : actor(unit.grant.consumedBy);
      const maximumExpiry = Date.parse(approvedAt) + candidate.policy.maximumGrantLifetimeSeconds * 1_000;
      if (unit.grant.version !== ACTION_APPROVAL_GRANT_VERSION || unit.grant.unitRef !== definition.unitRef
        || grantRefs.has(grantRef) || ref(unit.grant.unitRef) !== definition.unitRef
        || unit.grant.unitHash !== definition.unitHash || unit.grant.scopeHash !== definition.scopeHash
        || hash(unit.grant.unitHash) !== definition.unitHash || hash(unit.grant.scopeHash) !== definition.scopeHash
        || ref(unit.grant.planRef) !== definition.plan.planRef || unit.grant.planRevision !== definition.plan.revision
        || !Number.isSafeInteger(unit.grant.planRevision) || unit.grant.planRevision < 1
        || unit.grant.planHash !== definition.plan.planHash || unit.grant.singleUse !== true
        || unit.grant.capability !== "approval_evidence_only" || unit.grant.canExecute !== false
        || approver.role === "analyst" || !policyRoles(candidate, definition.risk).includes(approver.role)
        || (candidate.policy.separationOfDutiesRisks.includes(definition.risk)
          && approver.actorRef === definition.requester.actorRef)
        || !normalizedDecisionActor || unit.decisionRef === null || unit.decidedAt === null
        || approver.actorRef !== normalizedDecisionActor.actorRef || approver.role !== normalizedDecisionActor.role
        || approvedAt !== unit.decidedAt || Date.parse(approvedAt) < Date.parse(definition.proposedAt)
        || Date.parse(expiresAt) <= Date.parse(approvedAt) || Date.parse(expiresAt) > Date.parse(definition.expiresAt)
        || Date.parse(expiresAt) > maximumExpiry
        || (consumedAt === null) !== (consumedBy === null)
        || (consumedAt !== null && (Date.parse(consumedAt) < Date.parse(approvedAt)
          || Date.parse(consumedAt) >= Date.parse(expiresAt)))
        || (consumedBy !== null && (consumedBy.role === "analyst"
          || !candidate.policy.grantConsumerRoles.includes(consumedBy.role)))
        || digest(grantCore) !== grantHash) fail("invalid_input");
      grantRefs.add(grantRef);
    }
  }
  let previousHash = ZERO_HASH;
  let previousTime = -Infinity;
  const eventRefs = new Set<string>();
  for (const [index, event] of candidate.trace.entries()) {
    exact(event, [
      "version", "eventRef", "sequence", "previousHash", "eventType", "bundleRef", "unitRef", "unitHash",
      "actorRef", "occurredAt", "reasonCode", "eventHash", "persistRequested", "persisted", "executionAuthority",
    ]);
    const { eventHash, ...eventCore } = event;
    const eventRef = ref(event.eventRef);
    if (event.version !== ACTION_APPROVAL_LIFECYCLE_VERSION || event.sequence !== index + 1
      || eventRefs.has(eventRef)
      || event.previousHash !== previousHash || event.bundleRef !== candidate.bundle.bundleRef
      || event.persistRequested !== true || event.persisted !== false || event.executionAuthority !== "none"
      || digest(eventCore) !== eventHash || Date.parse(event.occurredAt) < previousTime) fail("invalid_input");
    eventRefs.add(eventRef);
    previousHash = eventHash;
    previousTime = Date.parse(event.occurredAt);
  }
  return candidate;
}

/** Pure persistence-boundary verifier; it never mutates, approves, grants, or executes. */
export function assertValidApprovalLifecycle(candidate: unknown): asserts candidate is ApprovalLifecycle {
  validateLifecycle(candidate as ApprovalLifecycle);
}

function freshnessMap(lifecycle: ApprovalLifecycle, candidates: readonly UnitFreshness[]): Map<string, UnitFreshness> {
  if (!Array.isArray(candidates) || candidates.length !== lifecycle.bundle.units.length) fail("stale_unit");
  const map = new Map<string, UnitFreshness>();
  for (const candidate of candidates) {
    exact(candidate, ["unitRef", "planRevision", "planHash", "sourceHash", "contextHash", "specHash"]);
    const unitRef = ref(candidate.unitRef);
    const planRevision = candidate.planRevision as number;
    if (map.has(unitRef) || !Number.isSafeInteger(planRevision) || planRevision < 1) fail("stale_unit");
    map.set(unitRef, {
      unitRef, planRevision, planHash: hash(candidate.planHash),
      sourceHash: hash(candidate.sourceHash), contextHash: hash(candidate.contextHash), specHash: hash(candidate.specHash),
    });
  }
  if (lifecycle.bundle.units.some((unit) => !map.has(unit.unitRef))) fail("stale_unit");
  return map;
}

function derivedState(unit: ActionUnit, current: UnitFreshness, checkedAt: string): ActionUnitApprovalState | null {
  if (current.planRevision !== unit.plan.revision) return "superseded";
  if (current.planHash !== unit.plan.planHash || current.sourceHash !== unit.sourceHash
    || current.contextHash !== unit.contextHash || current.specHash !== unit.specHash) return "stale";
  if (Date.parse(checkedAt) >= Date.parse(unit.expiresAt)) return "expired";
  return null;
}

function invalidate(
  lifecycle: ApprovalLifecycle,
  at: string,
  current: readonly UnitFreshness[],
  eventSeed: string,
): Readonly<{ lifecycle: ApprovalLifecycle; events: readonly ApprovalAuditEventIntent[] }> {
  const checkedAt = instant(at);
  const seed = ref(eventSeed);
  const fresh = freshnessMap(lifecycle, current);
  const definitions = new Map(lifecycle.bundle.units.map((unit) => [unit.unitRef, unit]));
  const mutable = lifecycle.units.map((state) => ({ ...state })) as Array<{
    unitRef: string;
    unitHash: string;
    state: ActionUnitApprovalState;
    decisionRef: string | null;
    decisionActor: ActionActor | null;
    decidedAt: string | null;
    reasonCode: string | null;
    grant: ActionApprovalGrant | null;
  }>;
  const states = new Map(mutable.map((state) => [state.unitRef, state]));
  const changes: Array<{ unitRef: string; state: ActionUnitApprovalState; reason: string }> = [];
  const closed = new Set<ActionUnitApprovalState>(["rejected", "changes_requested", "expired", "stale", "superseded", "dependency_failed"]);
  for (const state of mutable) {
    if (closed.has(state.state)) continue;
    const next = derivedState(definitions.get(state.unitRef)!, fresh.get(state.unitRef)!, checkedAt);
    if (next) {
      state.state = next;
      state.reasonCode = next === "expired" ? "unit_expired" : next === "superseded" ? "plan_revision_superseded" : "frozen_hash_changed";
      state.grant = null;
      changes.push({ unitRef: state.unitRef, state: next, reason: state.reasonCode });
    }
  }
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const state of mutable) {
      if (closed.has(state.state)) continue;
      const dependency = definitions.get(state.unitRef)!.dependencies
        .map((dependencyRef) => states.get(dependencyRef)!)
        .find((dependencyState) => closed.has(dependencyState.state));
      if (dependency) {
        state.state = "dependency_failed";
        state.reasonCode = `dependency_${dependency.unitRef}_failed`;
        state.grant = null;
        changes.push({ unitRef: state.unitRef, state: "dependency_failed", reason: state.reasonCode });
        progressed = true;
      }
    }
  }
  let working = lifecycle;
  const events: ApprovalAuditEventIntent[] = [];
  for (const [index, change] of changes.entries()) {
    const eventType = change.state === "expired" ? "unit_expired"
      : change.state === "stale" ? "unit_stale"
        : change.state === "superseded" ? "unit_superseded" : "unit_dependency_failed";
    const definition = definitions.get(change.unitRef)!;
    const event = appendEvent(working, {
      eventRef: `event_${digest({ seed, index, unitRef: change.unitRef, state: change.state }).slice(0, 32)}`,
      eventType, bundleRef: lifecycle.bundle.bundleRef, unitRef: change.unitRef,
      unitHash: definition.unitHash, actorRef: null, occurredAt: checkedAt, reasonCode: change.reason,
    });
    events.push(event);
    working = withEvents(working, mutable, [event]);
  }
  return freeze({ lifecycle: changes.length === 0 ? lifecycle : working, events: freeze(events) });
}

function policyRoles(lifecycle: ApprovalLifecycle, risk: ActionRisk): readonly ActionApprovalRole[] {
  return lifecycle.policy.approverRoles.find((entry) => entry.risk === risk)?.roles ?? [];
}

function authorization(value: HumanApprovalAuthorization, unit: ActionUnit, approver: ActionActor, at: string): HumanApprovalAuthorization {
  exact(value, [
    "authorizationRef", "unitRef", "unitHash", "scopeHash", "actor", "issuedAt", "expiresAt",
    "humanPresence", "canExecute",
  ]);
  const issuedAt = instant(value.issuedAt);
  const expiresAt = instant(value.expiresAt);
  const authorizedActor = actor(value.actor);
  if (value.humanPresence !== true || value.canExecute !== false || ref(value.unitRef) !== unit.unitRef
    || hash(value.unitHash) !== unit.unitHash || hash(value.scopeHash) !== unit.scopeHash
    || authorizedActor.actorRef !== approver.actorRef || authorizedActor.role !== approver.role
    || Date.parse(issuedAt) > Date.parse(at) || Date.parse(expiresAt) <= Date.parse(at)) {
    fail("authorization_mismatch");
  }
  return freeze({ ...value, authorizationRef: ref(value.authorizationRef), actor: authorizedActor, issuedAt, expiresAt });
}

function grant(
  lifecycle: ApprovalLifecycle,
  unit: ActionUnit,
  approver: ActionActor,
  approvedAt: string,
  grantRef: string,
  auth: HumanApprovalAuthorization,
): ActionApprovalGrant {
  const policyExpiry = new Date(Date.parse(approvedAt) + lifecycle.policy.maximumGrantLifetimeSeconds * 1_000).toISOString();
  const expiresAt = [unit.expiresAt, auth.expiresAt, policyExpiry].sort()[0]!;
  const core = {
    version: ACTION_APPROVAL_GRANT_VERSION,
    grantRef: ref(grantRef), unitRef: unit.unitRef, unitHash: unit.unitHash, scopeHash: unit.scopeHash,
    planRef: unit.plan.planRef, planRevision: unit.plan.revision, planHash: unit.plan.planHash,
    approver, approvedAt, expiresAt, singleUse: true as const, consumedAt: null, consumedBy: null,
    capability: "approval_evidence_only" as const, canExecute: false as const,
  };
  return freeze({ ...core, grantHash: digest(core) });
}

export function decideActionUnit(lifecycleInput: ApprovalLifecycle, command: ApprovalDecisionCommand): ApprovalTransitionResult {
  const lifecycle = validateLifecycle(lifecycleInput);
  const common = ["kind", "commandRef", "unitRef", "actor", "decidedAt", "reasonCode", "freshness"];
  exact(command, command.kind === "approve" ? [...common, "authorization", "grantRef"] : common);
  if (!["approve", "reject", "request_changes"].includes(command.kind)) fail("invalid_input");
  const commandRef = ref(command.commandRef);
  const unitRef = ref(command.unitRef);
  const decidedAt = instant(command.decidedAt);
  const decisionActor = actor(command.actor);
  const refreshed = invalidate(
    lifecycle, decidedAt, command.freshness,
    `event_${digest({ commandRef, phase: "freshness" }).slice(0, 32)}`,
  );
  const working = refreshed.lifecycle;
  const definition = working.bundle.units.find((unit) => unit.unitRef === unitRef);
  const current = working.units.find((unit) => unit.unitRef === unitRef);
  if (!definition || !current || current.state !== "awaiting_approval") {
    if (current?.state === "stale" || current?.state === "superseded" || current?.state === "expired") fail("stale_unit");
    if (current?.state === "dependency_failed") fail("dependency_failed");
    fail("invalid_transition");
  }
  if (decisionActor.role === "analyst" || !policyRoles(working, definition.risk).includes(decisionActor.role)) {
    fail("policy_denied");
  }
  if (working.policy.separationOfDutiesRisks.includes(definition.risk)
    && decisionActor.actorRef === definition.requester.actorRef) fail("separation_of_duties");
  const reasonCode = code(command.reasonCode);
  const nextState: ActionUnitApprovalState = command.kind === "approve" ? "approved"
    : command.kind === "reject" ? "rejected" : "changes_requested";
  const approvalGrant = command.kind === "approve"
    ? grant(working, definition, decisionActor, decidedAt, command.grantRef,
      authorization(command.authorization, definition, decisionActor, decidedAt))
    : null;
  const units: readonly ApprovalUnitState[] = working.units.map((state) => state.unitRef === unitRef ? freeze({
    ...state, state: nextState, decisionRef: commandRef, decisionActor, decidedAt, reasonCode, grant: approvalGrant,
  }) : state);
  const event = appendEvent(working, {
    eventRef: commandRef,
    eventType: command.kind === "approve" ? "unit_approved"
      : command.kind === "reject" ? "unit_rejected" : "unit_changes_requested",
    bundleRef: working.bundle.bundleRef, unitRef, unitHash: definition.unitHash,
    actorRef: decisionActor.actorRef, occurredAt: decidedAt, reasonCode,
  });
  let result = withEvents(working, units, [event]);
  const cascaded = command.kind === "approve"
    ? { lifecycle: result, events: freeze([]) as readonly ApprovalAuditEventIntent[] }
    : invalidate(
      result, decidedAt, command.freshness,
      `event_${digest({ commandRef, phase: "dependency" }).slice(0, 32)}`,
    );
  result = cascaded.lifecycle;
  const events = freeze([...refreshed.events, event, ...cascaded.events]);
  return freeze({ lifecycle: result, auditEventIntents: events, executionAuthority: "none", executionPerformed: false });
}

export function refreshApprovalLifecycle(input: Readonly<{
  lifecycle: ApprovalLifecycle;
  checkedAt: string;
  freshness: readonly UnitFreshness[];
  eventRef: string;
}>): ApprovalTransitionResult {
  exact(input, ["lifecycle", "checkedAt", "freshness", "eventRef"]);
  const refreshed = invalidate(validateLifecycle(input.lifecycle), input.checkedAt, input.freshness, input.eventRef);
  return freeze({
    lifecycle: refreshed.lifecycle, auditEventIntents: refreshed.events,
    executionAuthority: "none", executionPerformed: false,
  });
}

export function consumeApprovalGrant(input: Readonly<{
  lifecycle: ApprovalLifecycle;
  grantRef: string;
  unitRef: string;
  unitHash: string;
  scopeHash: string;
  planRef: string;
  planRevision: number;
  planHash: string;
  consumer: ActionActor;
  consumedAt: string;
  freshness: readonly UnitFreshness[];
  eventRef: string;
  purpose: "present_to_action_valve";
  execute: false;
}>): ApprovalTransitionResult {
  exact(input, [
    "lifecycle", "grantRef", "unitRef", "unitHash", "scopeHash", "planRef", "planRevision", "planHash",
    "consumer", "consumedAt", "freshness", "eventRef", "purpose", "execute",
  ]);
  if (input.purpose !== "present_to_action_valve" || input.execute !== false) fail("invalid_input");
  const consumedAt = instant(input.consumedAt);
  const eventRef = ref(input.eventRef);
  const refreshed = invalidate(
    validateLifecycle(input.lifecycle), consumedAt, input.freshness,
    `event_${digest({ eventRef, phase: "freshness" }).slice(0, 32)}`,
  );
  const lifecycle = refreshed.lifecycle;
  const unitRef = ref(input.unitRef);
  const definition = lifecycle.bundle.units.find((unit) => unit.unitRef === unitRef);
  const state = lifecycle.units.find((unit) => unit.unitRef === unitRef);
  const consumer = actor(input.consumer);
  if (!definition || !state || state.state !== "approved" || !state.grant) fail("invalid_transition");
  if (consumer.role === "analyst" || !lifecycle.policy.grantConsumerRoles.includes(consumer.role)) fail("policy_denied");
  if (state.grant.consumedAt !== null) fail("grant_used");
  if (Date.parse(consumedAt) >= Date.parse(state.grant.expiresAt)) fail("grant_expired");
  if (ref(input.grantRef) !== state.grant.grantRef || hash(input.unitHash) !== definition.unitHash
    || hash(input.scopeHash) !== definition.scopeHash || ref(input.planRef) !== definition.plan.planRef
    || input.planRevision !== definition.plan.revision || hash(input.planHash) !== definition.plan.planHash) {
    fail("authorization_mismatch");
  }
  const dependencies = definition.dependencies.map((dependencyRef) => lifecycle.units.find((unit) => unit.unitRef === dependencyRef));
  if (dependencies.some((dependency) => !dependency || dependency.state !== "approved")) fail("dependency_failed");
  const { grantHash: _previousGrantHash, ...grantCore } = state.grant;
  const consumedCore = { ...grantCore, consumedAt, consumedBy: consumer };
  const consumedGrant = freeze({ ...consumedCore, grantHash: digest(consumedCore) }) as ActionApprovalGrant;
  const units = lifecycle.units.map((unit) => unit.unitRef === unitRef ? freeze({ ...unit, grant: consumedGrant }) : unit);
  const event = appendEvent(lifecycle, {
    eventRef, eventType: "approval_grant_consumed", bundleRef: lifecycle.bundle.bundleRef,
    unitRef, unitHash: definition.unitHash, actorRef: consumer.actorRef, occurredAt: consumedAt,
    reasonCode: "presented_to_action_valve",
  });
  const result = withEvents(lifecycle, units, [event]);
  return freeze({
    lifecycle: result, auditEventIntents: freeze([...refreshed.events, event]),
    executionAuthority: "none", executionPerformed: false,
  });
}
