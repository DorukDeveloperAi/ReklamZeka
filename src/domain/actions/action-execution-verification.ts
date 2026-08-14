import { createHash } from "node:crypto";

import { assertValidActionExecutionAdmission, type ActionExecutionAdmission } from "@/domain/actions/action-execution-admission";
import type { ActionPlan } from "@/domain/actions/autonomy-valve";
import { createMetaWriteSpec, type MetaWriteSpec } from "@/domain/actions/meta-write-spec";

export const ACTION_EXECUTION_VERIFICATION_VERSION = "action-execution-verification/1.0.0" as const;

type Status = "ACTIVE" | "PAUSED" | "UNKNOWN";
type PlatformReview = "unknown" | "pending" | "approved" | "rejected" | "limited";
type Delivery = "unknown" | "pending" | "active" | "inactive" | "limited";
type TransportError = "authentication" | "authorization" | "rate_limited" | "transient" | "invalid_request" | "conflict" | "unknown";

export type ActionExecutionVerificationContract = Readonly<{
  version: typeof ACTION_EXECUTION_VERIFICATION_VERSION;
  admissionHash: string;
  writeSpecHash: string;
  target: MetaWriteSpec["target"];
  expected: Readonly<
    | { kind: "status"; configuredStatus: "ACTIVE" | "PAUSED" }
    | { kind: "budget"; budgetKind: "daily" | "lifetime"; currency: string; decimal: string }
  >;
  rollbackCandidate: Readonly<
    | { kind: "status"; configuredStatus: "ACTIVE" | "PAUSED" }
    | { kind: "budget"; budgetKind: "daily" | "lifetime"; currency: string; decimal: string }
  >;
  contractHash: string;
  capabilities: Readonly<{ canExecute: false; canWriteMeta: false; canDispatchNetwork: false }>;
}>;

export type MetaWriteDispatchReport = Readonly<{
  state: "not_attempted" | "accepted" | "rejected";
  error: TransportError | null;
}>;

export type MetaReadAfterWriteObservation = Readonly<{
  target: MetaWriteSpec["target"];
  capturedAt: string;
  sourceSnapshotHash: string;
  configuredStatus: Status;
  dailyBudgetDecimal: string | null;
  lifetimeBudgetDecimal: string | null;
  platformReview: PlatformReview;
  delivery: Delivery;
}>;

export type ActionExecutionVerification = Readonly<{
  version: typeof ACTION_EXECUTION_VERIFICATION_VERSION;
  contractHash: string;
  disposition: "parked" | "failed" | "verified";
  reason: "not_dispatched" | "retryable_transport" | "permanent_transport" | "read_unavailable" | "target_mismatch" | "expected_value_mismatch" | "verified";
  transport: "not_attempted" | "accepted" | "rejected";
  readAfterWrite: "not_attempted" | "unavailable" | "mismatch" | "matched";
  platformReview: PlatformReview;
  delivery: Delivery;
  rollback: Readonly<{
    disposition: "not_eligible" | "manual_recovery_required" | "requires_new_approved_action";
    reason: "not_verified" | "platform_constraint" | "new_human_approval_required";
  }>;
  capabilities: Readonly<{ canExecute: false; canWriteMeta: false; canDispatchNetwork: false }>;
}>;

export class ActionExecutionVerificationError extends Error {
  constructor(readonly code: "invalid_input" | "admission_mismatch") {
    super(`Execution verification reddedildi: ${code}`);
    this.name = "ActionExecutionVerificationError";
  }
}

const HASH = /^[a-f0-9]{64}$/;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const DECIMAL = /^(0|[1-9]\d{0,29})(?:\.\d{1,12})?$/;

function fail(code: ActionExecutionVerificationError["code"]): never { throw new ActionExecutionVerificationError(code); }
function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype
    || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) fail("invalid_input");
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, stable(child)]));
  return value;
}
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function hash(value: unknown): string { if (typeof value !== "string" || !HASH.test(value)) fail("invalid_input"); return value; }
function ref(value: unknown): string { if (typeof value !== "string" || !REF.test(value)) fail("invalid_input"); return value; }
function instant(value: unknown): string { if (typeof value !== "string" || !ISO.test(value) || new Date(value).toISOString() !== value) fail("invalid_input"); return value; }
function decimal(value: unknown): string { if (typeof value !== "string" || !DECIMAL.test(value)) fail("invalid_input"); return value; }
function sameSpec(left: MetaWriteSpec, right: MetaWriteSpec): boolean { return digest(left) === digest(right); }

/**
 * Freezes exactly what a future executor must observe after a write, and the
 * previous value that may only become a separately approved rollback proposal.
 */
export function createActionExecutionVerificationContract(input: Readonly<{
  admission: ActionExecutionAdmission;
  actionPlan: ActionPlan;
}>): ActionExecutionVerificationContract {
  exact(input, ["admission", "actionPlan"]);
  try { assertValidActionExecutionAdmission(input.admission); } catch { fail("invalid_input"); }
  let writeSpec: MetaWriteSpec;
  try { writeSpec = createMetaWriteSpec({ unitRef: input.admission.unitRef, unitHash: input.admission.writeSpec.unitHash, actionPlan: input.actionPlan }); }
  catch { fail("admission_mismatch"); }
  if (!sameSpec(writeSpec, input.admission.writeSpec) || writeSpec.specHash !== input.admission.writeSpec.specHash
    || writeSpec.actionPlanHash !== input.actionPlan.planHash) fail("admission_mismatch");
  const action = input.actionPlan.action;
  const pair = writeSpec.mutation.kind === "status"
    && action.kind === "status_change"
    ? Object.freeze({ expected: Object.freeze({ kind: "status" as const, configuredStatus: writeSpec.mutation.desiredStatus }),
      rollbackCandidate: Object.freeze({ kind: "status" as const, configuredStatus: action.fromStatus }) })
    : writeSpec.mutation.kind === "budget" && action.kind === "budget_change"
      ? Object.freeze({ expected: Object.freeze({ kind: "budget" as const, budgetKind: writeSpec.mutation.budgetKind,
        currency: writeSpec.mutation.currency, decimal: writeSpec.mutation.desiredDecimal }),
      rollbackCandidate: Object.freeze({ kind: "budget" as const, budgetKind: writeSpec.mutation.budgetKind,
        currency: writeSpec.mutation.currency, decimal: action.beforeDecimal }) })
      : fail("admission_mismatch");
  const core = Object.freeze({ version: ACTION_EXECUTION_VERIFICATION_VERSION, admissionHash: input.admission.admissionHash,
    writeSpecHash: writeSpec.specHash, target: Object.freeze({ ...writeSpec.target }), ...pair,
    capabilities: Object.freeze({ canExecute: false as const, canWriteMeta: false as const, canDispatchNetwork: false as const }) });
  return Object.freeze({ ...core, contractHash: digest(core) });
}

function validateDispatch(value: MetaWriteDispatchReport): MetaWriteDispatchReport {
  exact(value, ["state", "error"]);
  if (!["not_attempted", "accepted", "rejected"].includes(value.state)
    || (value.state === "accepted" && value.error !== null)
    || (value.state === "not_attempted" && value.error !== null)
    || (value.state === "rejected" && !["authentication", "authorization", "rate_limited", "transient", "invalid_request", "conflict", "unknown"].includes(value.error ?? ""))) fail("invalid_input");
  return value;
}
function validateObservation(value: MetaReadAfterWriteObservation, contract: ActionExecutionVerificationContract): MetaReadAfterWriteObservation {
  exact(value, ["target", "capturedAt", "sourceSnapshotHash", "configuredStatus", "dailyBudgetDecimal", "lifetimeBudgetDecimal", "platformReview", "delivery"]);
  exact(value.target, ["entityLevel", "entityRef"]);
  if (value.target.entityLevel !== contract.target.entityLevel || ref(value.target.entityRef) !== contract.target.entityRef
    || !["ACTIVE", "PAUSED", "UNKNOWN"].includes(value.configuredStatus) || !["unknown", "pending", "approved", "rejected", "limited"].includes(value.platformReview)
    || !["unknown", "pending", "active", "inactive", "limited"].includes(value.delivery)) fail("invalid_input");
  instant(value.capturedAt); hash(value.sourceSnapshotHash);
  if (value.dailyBudgetDecimal !== null) decimal(value.dailyBudgetDecimal);
  if (value.lifetimeBudgetDecimal !== null) decimal(value.lifetimeBudgetDecimal);
  return value;
}

/** Pure result classifier. It cannot dispatch a request or create a rollback action. */
export function assessActionExecutionVerification(input: Readonly<{
  contract: ActionExecutionVerificationContract;
  dispatch: MetaWriteDispatchReport;
  observation: MetaReadAfterWriteObservation | null;
}>): ActionExecutionVerification {
  exact(input, ["contract", "dispatch", "observation"]);
  const contract = input.contract;
  exact(contract, ["version", "admissionHash", "writeSpecHash", "target", "expected", "rollbackCandidate", "contractHash", "capabilities"]);
  if (contract.version !== ACTION_EXECUTION_VERIFICATION_VERSION) fail("invalid_input");
  const { contractHash, ...core } = contract;
  if (digest(core) !== hash(contractHash) || contract.capabilities.canExecute !== false || contract.capabilities.canWriteMeta !== false || contract.capabilities.canDispatchNetwork !== false) fail("invalid_input");
  const dispatch = validateDispatch(input.dispatch);
  const caps = Object.freeze({ canExecute: false as const, canWriteMeta: false as const, canDispatchNetwork: false as const });
  if (dispatch.state === "not_attempted") return Object.freeze({ version: ACTION_EXECUTION_VERIFICATION_VERSION, contractHash,
    disposition: "parked", reason: "not_dispatched", transport: dispatch.state, readAfterWrite: "not_attempted",
    platformReview: "unknown", delivery: "unknown", rollback: Object.freeze({ disposition: "not_eligible", reason: "not_verified" }), capabilities: caps });
  if (dispatch.state === "rejected") {
    const retryable = dispatch.error === "rate_limited" || dispatch.error === "transient";
    return Object.freeze({ version: ACTION_EXECUTION_VERIFICATION_VERSION, contractHash, disposition: retryable ? "parked" : "failed",
      reason: retryable ? "retryable_transport" : "permanent_transport", transport: dispatch.state, readAfterWrite: "not_attempted",
      platformReview: "unknown", delivery: "unknown", rollback: Object.freeze({ disposition: "not_eligible", reason: "not_verified" }), capabilities: caps });
  }
  if (input.observation === null) return Object.freeze({ version: ACTION_EXECUTION_VERIFICATION_VERSION, contractHash,
    disposition: "parked", reason: "read_unavailable", transport: dispatch.state, readAfterWrite: "unavailable",
    platformReview: "unknown", delivery: "unknown", rollback: Object.freeze({ disposition: "not_eligible", reason: "not_verified" }), capabilities: caps });
  const observation = validateObservation(input.observation, contract);
  const matched = contract.expected.kind === "status"
    ? observation.configuredStatus === contract.expected.configuredStatus
    : (contract.expected.budgetKind === "daily" ? observation.dailyBudgetDecimal : observation.lifetimeBudgetDecimal) === contract.expected.decimal;
  if (!matched) return Object.freeze({ version: ACTION_EXECUTION_VERIFICATION_VERSION, contractHash,
    disposition: "failed", reason: "expected_value_mismatch", transport: dispatch.state, readAfterWrite: "mismatch",
    platformReview: observation.platformReview, delivery: observation.delivery,
    rollback: Object.freeze({ disposition: "manual_recovery_required", reason: "platform_constraint" }), capabilities: caps });
  const constrained = observation.platformReview === "rejected" || observation.platformReview === "limited" || observation.delivery === "limited";
  return Object.freeze({ version: ACTION_EXECUTION_VERIFICATION_VERSION, contractHash,
    disposition: "verified", reason: "verified", transport: dispatch.state, readAfterWrite: "matched",
    platformReview: observation.platformReview, delivery: observation.delivery,
    rollback: Object.freeze(constrained
      ? { disposition: "manual_recovery_required" as const, reason: "platform_constraint" as const }
      : { disposition: "requires_new_approved_action" as const, reason: "new_human_approval_required" as const }), capabilities: caps });
}
