import { createHash } from "node:crypto";

import type { ActionPlan } from "@/domain/actions/autonomy-valve";

export const P06_LIMITED_AUTONOMY_ADMISSION_VERSION = "p06-limited-autonomy-admission/1.0.0" as const;
const HASH = /^[a-f0-9]{64}$/;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;

export class P06LimitedAutonomyAdmissionError extends Error {
  constructor(readonly code: "invalid_input" | "ineligible_plan" | "quota_exhausted") {
    super(`Limited autonomy admission rejected: ${code}`);
    this.name = "P06LimitedAutonomyAdmissionError";
  }
}

const fail = (code: P06LimitedAutonomyAdmissionError["code"]): never => { throw new P06LimitedAutonomyAdmissionError(code); };
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, child]) => [key, stable(child)])) : value;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
const freeze = <T>(value: T): T => { if (value && typeof value === "object" && !Object.isFrozen(value)) {
  Object.freeze(value); Object.values(value as Record<string, unknown>).forEach(freeze);
} return value; };
const ref = (value: string) => REF.test(value) ? value : fail("invalid_input");
const hash = (value: string) => HASH.test(value) ? value : fail("invalid_input");
const instant = (value: string) => Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value ? value : fail("invalid_input");

export type P06LimitedAutonomyAdmission = Readonly<{
  payload: Readonly<Record<string, unknown>>;
  admissionHash: string;
  authority: Readonly<{ canApprove: false; canExecute: false; canWriteMeta: false; canDispatchNetwork: false }>;
}>;

export function createP06LimitedAutonomyAdmission(input: Readonly<{
  memberRef: string; membershipHash: string; entityRef: string; accountRef: string; campaignRef: string;
  actionPlan: ActionPlan; contextHash: string; effectiveGuideSetHash: string; resolutionHash: string;
  dataHealthReportHash: string; protectionHash: string; autonomyEvidenceHash: string;
  maximumActionsPerRun: number; actionsAlreadyReserved: number; admittedAt: string; expiresAt: string;
}>): P06LimitedAutonomyAdmission {
  const admittedAt = instant(input.admittedAt), expiresAt = instant(input.expiresAt);
  if (!Number.isSafeInteger(input.maximumActionsPerRun) || input.maximumActionsPerRun < 1 || input.maximumActionsPerRun > 1_000_000
    || !Number.isSafeInteger(input.actionsAlreadyReserved) || input.actionsAlreadyReserved < 0) fail("invalid_input");
  if (input.actionsAlreadyReserved >= input.maximumActionsPerRun) fail("quota_exhausted");
  if (Date.parse(expiresAt) <= Date.parse(admittedAt) || Date.parse(expiresAt) > Date.parse(admittedAt) + 3_600_000) fail("invalid_input");
  const action = input.actionPlan.actionType;
  const actionIntent = input.actionPlan.action;
  if (action !== "status_pause"
    || input.actionPlan.disposition !== "policy_limited_candidate" || input.actionPlan.effectiveAutonomy !== "policy_limited"
    || input.actionPlan.capabilities.canExecute || input.actionPlan.capabilities.canWriteMeta || input.actionPlan.capabilities.canGrantApproval
    || actionIntent.kind !== "status_change" || actionIntent.entity.level !== "adset") fail("ineligible_plan");
  if (actionIntent.kind !== "status_change") fail("ineligible_plan");
  const statusIntent = actionIntent as Extract<ActionPlan["action"], { kind: "status_change" }>;
  const expectedStatus = statusIntent.fromStatus, desiredStatus = statusIntent.toStatus;
  if (expectedStatus !== "ACTIVE" || desiredStatus !== "PAUSED") fail("ineligible_plan");
  if (statusIntent.entity.ref !== input.entityRef || input.actionPlan.contextHash !== input.contextHash) fail("ineligible_plan");
  const authority = Object.freeze({ canApprove: false as const, canExecute: false as const, canWriteMeta: false as const, canDispatchNetwork: false as const });
  const core = {
    version: P06_LIMITED_AUTONOMY_ADMISSION_VERSION,
    memberRef: ref(input.memberRef), membershipHash: hash(input.membershipHash), entityRef: ref(input.entityRef),
    accountRef: ref(input.accountRef), campaignRef: ref(input.campaignRef), action, expectedStatus, desiredStatus,
    contextHash: hash(input.contextHash), effectiveGuideSetHash: hash(input.effectiveGuideSetHash), resolutionHash: hash(input.resolutionHash),
    dataHealthReportHash: hash(input.dataHealthReportHash), protectionHash: hash(input.protectionHash),
    autonomyEvidenceHash: hash(input.autonomyEvidenceHash), actionPlanHash: hash(input.actionPlan.planHash),
    maximumActionsPerRun: input.maximumActionsPerRun, quotaOrdinal: input.actionsAlreadyReserved + 1,
    admittedAt, expiresAt, authority,
  };
  const admissionHash = digest(core);
  return freeze({ payload: { ...core, admissionHash }, admissionHash, authority });
}
