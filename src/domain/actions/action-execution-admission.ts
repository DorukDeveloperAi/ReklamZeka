import { createHash } from "node:crypto";

import {
  assertValidApprovalLifecycle,
  type ActionActor,
  type ActionBundle,
  type ApprovalLifecycle,
  type ActionUnit,
  type UnitFreshness,
} from "@/domain/actions/approval-lifecycle";
import { type ActionPlan } from "@/domain/actions/autonomy-valve";
import { createMetaWriteSpec, type MetaWriteSpec } from "@/domain/actions/meta-write-spec";
import {
  assessMetaWriteEligibility,
  type MetaWriteEligibilitySnapshot,
} from "@/domain/actions/meta-write-eligibility";

export const ACTION_EXECUTION_ADMISSION_VERSION = "action-execution-admission/1.0.0" as const;

export type ExecutionHumanPresenceEvidence = Readonly<{
  authorizationRef: string;
  unitRef: string;
  unitHash: string;
  scopeHash: string;
  actor: ActionActor;
  issuedAt: string;
  expiresAt: string;
  humanPresence: true;
}>;

export type ActionExecutionAdmission = Readonly<{
  version: typeof ACTION_EXECUTION_ADMISSION_VERSION;
  unitRef: string;
  approvalDecisionRef: string;
  approvalGrantRef: string;
  executionPresenceRef: string;
  writeSpec: MetaWriteSpec;
  eligibilitySnapshotHash: string;
  eligibilityHash: string;
  dependencyUnitRefs: readonly string[];
  evaluatedAt: string;
  /** A future server-private executor may consume this admission; it is not a write capability. */
  disposition: "admitted_for_disabled_executor";
  capabilities: Readonly<{ canExecute: false; canWriteMeta: false; canDispatchNetwork: false }>;
  admissionHash: string;
}>;

export class ActionExecutionAdmissionError extends Error {
  constructor(readonly code:
    | "invalid_input"
    | "lifecycle_invalid"
    | "unit_not_approved"
    | "approval_grant_invalid"
    | "execution_presence_invalid"
    | "dependency_not_ready"
    | "freshness_mismatch"
    | "action_plan_mismatch"
    | "write_not_eligible"
    | "unsupported_action") {
    super(`Action execution admission reddedildi: ${code}`);
    this.name = "ActionExecutionAdmissionError";
  }
}

const HASH = /^[a-f0-9]{64}$/;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;

function fail(code: ActionExecutionAdmissionError["code"]): never { throw new ActionExecutionAdmissionError(code); }
function exact(value: unknown, keys: readonly string[], code: ActionExecutionAdmissionError["code"]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype
    || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) fail(code);
}
function stable(value: unknown, seen = new Set<object>()): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") { if (!Number.isFinite(value)) fail("invalid_input"); return value; }
  if (!value || typeof value !== "object" || seen.has(value)) fail("invalid_input");
  seen.add(value);
  if (Array.isArray(value)) { const result = value.map((item) => stable(item, seen)); seen.delete(value); return result; }
  if (Object.getPrototypeOf(value) !== Object.prototype) fail("invalid_input");
  const result = Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, child]) => [key, stable(child, seen)]));
  seen.delete(value);
  return result;
}
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function ref(value: unknown, code: ActionExecutionAdmissionError["code"]): string {
  if (typeof value !== "string" || !REF.test(value) || value.includes("*")) fail(code);
  return value;
}
function hash(value: unknown, code: ActionExecutionAdmissionError["code"]): string {
  if (typeof value !== "string" || !HASH.test(value)) fail(code);
  return value;
}
function instant(value: unknown, code: ActionExecutionAdmissionError["code"]): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail(code);
  return value;
}

function definition(bundle: ActionBundle, unitRef: string): ActionUnit {
  const unit = bundle.units.find((candidate) => candidate.unitRef === unitRef);
  if (!unit) fail("unit_not_approved");
  return unit;
}

function dependencyClosure(bundle: ActionBundle, unitRef: string): readonly ActionUnit[] {
  const visited = new Set<string>();
  const visit = (candidateRef: string): void => {
    if (visited.has(candidateRef)) return;
    visited.add(candidateRef);
    const candidate = definition(bundle, candidateRef);
    for (const dependency of candidate.dependencies) visit(dependency);
  };
  visit(unitRef);
  return Object.freeze([...visited].map((refValue) => definition(bundle, refValue)).sort((a, b) => a.unitRef.localeCompare(b.unitRef)));
}

function sameFreshness(expected: ActionUnit, actual: UnitFreshness): boolean {
  return actual.unitRef === expected.unitRef && actual.planRevision === expected.plan.revision
    && actual.planHash === expected.plan.planHash && actual.sourceHash === expected.sourceHash
    && actual.contextHash === expected.contextHash && actual.specHash === expected.specHash;
}
function normalizedFreshness(value: unknown): UnitFreshness {
  exact(value, ["unitRef", "planRevision", "planHash", "sourceHash", "contextHash", "specHash"], "freshness_mismatch");
  return value as unknown as UnitFreshness;
}

function validatePresence(value: ExecutionHumanPresenceEvidence, unit: ActionUnit, lifecycle: ApprovalLifecycle, evaluatedAt: string): ExecutionHumanPresenceEvidence {
  exact(value, ["authorizationRef", "unitRef", "unitHash", "scopeHash", "actor", "issuedAt", "expiresAt", "humanPresence"], "execution_presence_invalid");
  exact(value.actor, ["actorRef", "role"], "execution_presence_invalid");
  const issuedAt = instant(value.issuedAt, "execution_presence_invalid");
  const expiresAt = instant(value.expiresAt, "execution_presence_invalid");
  const role = value.actor.role;
  if (!REF.test(value.authorizationRef) || value.unitRef !== unit.unitRef || value.unitHash !== unit.unitHash
    || value.scopeHash !== unit.scopeHash || value.humanPresence !== true
    || !REF.test(value.actor.actorRef) || (role !== "owner" && role !== "admin" && role !== "operator")
    || !lifecycle.policy.grantConsumerRoles.includes(role)
    || Date.parse(issuedAt) > Date.parse(evaluatedAt) || Date.parse(expiresAt) <= Date.parse(evaluatedAt)) {
    fail("execution_presence_invalid");
  }
  return Object.freeze({ ...value, actor: Object.freeze({ ...value.actor }), issuedAt, expiresAt });
}

/** Validates a stored/public boundary admission without recreating authority. */
export function assertValidActionExecutionAdmission(value: unknown): asserts value is ActionExecutionAdmission {
  exact(value, ["version", "unitRef", "approvalDecisionRef", "approvalGrantRef", "executionPresenceRef", "writeSpec", "eligibilitySnapshotHash", "eligibilityHash", "dependencyUnitRefs", "evaluatedAt", "disposition", "capabilities", "admissionHash"], "invalid_input");
  if (value.version !== ACTION_EXECUTION_ADMISSION_VERSION || value.disposition !== "admitted_for_disabled_executor"
    || !Array.isArray(value.dependencyUnitRefs) || value.dependencyUnitRefs.length > 100
    || new Set(value.dependencyUnitRefs).size !== value.dependencyUnitRefs.length) fail("invalid_input");
  ref(value.unitRef, "invalid_input"); ref(value.approvalDecisionRef, "invalid_input");
  ref(value.approvalGrantRef, "invalid_input"); ref(value.executionPresenceRef, "invalid_input");
  hash(value.eligibilitySnapshotHash, "invalid_input"); hash(value.eligibilityHash, "invalid_input");
  instant(value.evaluatedAt, "invalid_input");
  for (const dependency of value.dependencyUnitRefs) ref(dependency, "invalid_input");
  exact(value.capabilities, ["canExecute", "canWriteMeta", "canDispatchNetwork"], "invalid_input");
  if (value.capabilities.canExecute !== false || value.capabilities.canWriteMeta !== false || value.capabilities.canDispatchNetwork !== false) fail("invalid_input");
  const writeSpec = value.writeSpec as MetaWriteSpec;
  if (!writeSpec || typeof writeSpec !== "object" || writeSpec.unitRef !== value.unitRef || !HASH.test(writeSpec.specHash)) fail("invalid_input");
  const { admissionHash, ...core } = value;
  if (digest(core) !== hash(admissionHash, "invalid_input")) fail("invalid_input");
}

/**
 * Admission is intentionally not execution: it is the deterministic boundary
 * between an approved unit and a future server-private write executor. The
 * caller cannot turn this result into a Graph request or network capability.
 */
export function admitActionExecution(input: Readonly<{
  lifecycle: ApprovalLifecycle;
  unitRef: string;
  actionPlan: ActionPlan;
  eligibilitySnapshot: MetaWriteEligibilitySnapshot;
  currentFreshness: readonly UnitFreshness[];
  executionPresence: ExecutionHumanPresenceEvidence;
  evaluatedAt: string;
}>): ActionExecutionAdmission {
  exact(input, ["lifecycle", "unitRef", "actionPlan", "eligibilitySnapshot", "currentFreshness", "executionPresence", "evaluatedAt"], "invalid_input");
  const evaluatedAt = instant(input.evaluatedAt, "invalid_input");
  if (!Array.isArray(input.currentFreshness) || input.currentFreshness.length > 100) fail("invalid_input");
  try { assertValidApprovalLifecycle(input.lifecycle); } catch { fail("lifecycle_invalid"); }
  const unitRef = ref(input.unitRef, "invalid_input");
  const unit = definition(input.lifecycle.bundle, unitRef);
  const state = input.lifecycle.units.find((candidate) => candidate.unitRef === unitRef);
  if (!state || state.state !== "approved" || !state.decisionRef || !state.grant) fail("unit_not_approved");
  const grant = state.grant;
  if (grant.unitHash !== unit.unitHash || grant.scopeHash !== unit.scopeHash || grant.consumedAt !== null || grant.consumedBy !== null
    || Date.parse(grant.expiresAt) <= Date.parse(evaluatedAt)) fail("approval_grant_invalid");
  const closure = dependencyClosure(input.lifecycle.bundle, unitRef);
  const freshness = new Map<string, UnitFreshness>();
  for (const candidate of input.currentFreshness) {
    const normalized = normalizedFreshness(candidate);
    if (freshness.has(normalized.unitRef)) fail("freshness_mismatch");
    freshness.set(normalized.unitRef, normalized);
  }
  for (const candidate of closure) {
    const unitState = input.lifecycle.units.find((stateCandidate) => stateCandidate.unitRef === candidate.unitRef);
    if (!unitState || unitState.state !== "approved") fail("dependency_not_ready");
    const current = freshness.get(candidate.unitRef);
    if (!current || !sameFreshness(candidate, current)) fail("freshness_mismatch");
  }
  if (input.actionPlan.planHash !== unit.sourceHash || input.actionPlan.contextHash !== unit.contextHash
    || input.actionPlan.actionType !== unit.scope.actionType || input.actionPlan.action.entity.ref !== unit.scope.entityRef) {
    fail("action_plan_mismatch");
  }
  const executionPresence = validatePresence(input.executionPresence, unit, input.lifecycle, evaluatedAt);
  let writeSpec: MetaWriteSpec;
  try { writeSpec = createMetaWriteSpec({ unitRef: unit.unitRef, unitHash: unit.unitHash, actionPlan: input.actionPlan }); }
  catch (reason) {
    if (reason instanceof Error && reason.name === "MetaWriteSpecError") fail("unsupported_action");
    throw reason;
  }
  let eligibility;
  try { eligibility = assessMetaWriteEligibility({ writeSpec, snapshot: input.eligibilitySnapshot }); }
  catch { fail("write_not_eligible"); }
  if (input.eligibilitySnapshot.workspaceRef !== unit.scope.workspaceRef
    || input.eligibilitySnapshot.accountRef !== unit.scope.accountRef
    || eligibility.disposition !== "eligible_for_separate_human_execution") fail("write_not_eligible");
  const core = Object.freeze({
    version: ACTION_EXECUTION_ADMISSION_VERSION,
    unitRef: unit.unitRef,
    approvalDecisionRef: state.decisionRef,
    approvalGrantRef: grant.grantRef,
    executionPresenceRef: executionPresence.authorizationRef,
    writeSpec,
    eligibilitySnapshotHash: eligibility.snapshotHash,
    eligibilityHash: eligibility.eligibilityHash,
    dependencyUnitRefs: Object.freeze(closure.filter((candidate) => candidate.unitRef !== unit.unitRef).map((candidate) => candidate.unitRef)),
    evaluatedAt,
    disposition: "admitted_for_disabled_executor" as const,
    capabilities: Object.freeze({ canExecute: false as const, canWriteMeta: false as const, canDispatchNetwork: false as const }),
  });
  return Object.freeze({ ...core, admissionHash: digest(core) });
}
