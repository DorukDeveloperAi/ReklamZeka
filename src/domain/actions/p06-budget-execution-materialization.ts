import { assertValidActionExecutionAdmission, type ActionExecutionAdmission } from "@/domain/actions/action-execution-admission";
import type { ActionPlan } from "@/domain/actions/autonomy-valve";
import { createMetaWriteSpec } from "@/domain/actions/meta-write-spec";
import { p06ExecutionV2Digest, type P06ExecutionV2Value } from "@/domain/actions/p06-execution-v2";

export const P06_BUDGET_EXECUTION_MATERIALIZATION_VERSION = "p06-budget-execution-materialization/1.0.0" as const;
const HASH = /^[a-f0-9]{64}$/;
const SUPPORTED_TWO_DECIMAL_CURRENCIES = new Set(["TRY", "USD", "EUR", "GBP"]);

export class P06BudgetExecutionMaterializationError extends Error {
  constructor(readonly code: "invalid_input" | "unsupported_currency" | "admission_mismatch") {
    super(`P06 budget execution materialization rejected: ${code}`);
  }
}
function fail(code: P06BudgetExecutionMaterializationError["code"]): never { throw new P06BudgetExecutionMaterializationError(code); }

/** Exact, Number-free conversion for the explicitly supported Meta two-decimal currencies. */
export function p06BudgetDecimalToMinor(decimal: string, currency: string): number {
  if (!SUPPORTED_TWO_DECIMAL_CURRENCIES.has(currency) || !/^(0|[1-9]\d{0,13})(?:\.\d{1,2})?$/.test(decimal)) {
    fail(SUPPORTED_TWO_DECIMAL_CURRENCIES.has(currency) ? "invalid_input" : "unsupported_currency");
  }
  const [whole, fraction = ""] = decimal.split(".");
  const value = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, "0"));
  if (value < 1n || value > BigInt(Number.MAX_SAFE_INTEGER)) fail("invalid_input");
  return Number(value);
}

export type P06BudgetExecutionMaterialization = Readonly<{
  version: typeof P06_BUDGET_EXECUTION_MATERIALIZATION_VERSION;
  route: "guide_budget_human_approved";
  workspaceRef: string;
  accountRef: string;
  entityRef: string;
  action: "budget_decrease" | "budget_increase";
  budgetKind: "daily" | "lifetime";
  currency: string;
  expectedBefore: P06ExecutionV2Value;
  desired: P06ExecutionV2Value;
  admissionHash: string;
  writeSpecHash: string;
  actionPlanHash: string;
  contextHash: string;
  materializationHash: string;
  authority: Readonly<{ canExecute: false; canWriteMeta: false; canDispatchNetwork: false }>;
}>;

/**
 * Converts already-persisted admission evidence into a durable request seed.
 * It grants no execution authority: the repository must still bind the exact
 * attempt/unit/decision/grant rows and dispatch must re-run the Guide gate.
 */
export function createP06BudgetExecutionMaterialization(input: Readonly<{
  admission: ActionExecutionAdmission;
  actionPlan: ActionPlan;
  unitHash: string;
  workspaceRef: string;
  accountRef: string;
  currentStatus: "ACTIVE" | "PAUSED";
}>): P06BudgetExecutionMaterialization {
  if (!input || typeof input !== "object" || !HASH.test(input.unitHash)) fail("invalid_input");
  try { assertValidActionExecutionAdmission(input.admission); } catch { fail("invalid_input"); }
  const expectedSpec = (() => { try { return createMetaWriteSpec({ unitRef: input.admission.unitRef, unitHash: input.unitHash, actionPlan: input.actionPlan }); }
    catch { return fail("invalid_input"); } })();
  const mutation = expectedSpec.mutation, action = expectedSpec.actionType, admittedMutation = input.admission.writeSpec.mutation;
  if (action !== "budget_decrease" && action !== "budget_increase") fail("admission_mismatch");
  if (mutation.kind !== "budget") fail("admission_mismatch");
  if (admittedMutation.kind !== "budget") fail("admission_mismatch");
  if (input.actionPlan.action.kind !== "budget_change") fail("admission_mismatch");
  const planAction = input.actionPlan.action;
  if (input.admission.writeSpec.specHash !== expectedSpec.specHash || input.admission.writeSpec.actionPlanHash !== input.actionPlan.planHash
    || input.admission.writeSpec.target.entityRef !== expectedSpec.target.entityRef
    || admittedMutation.budgetKind !== mutation.budgetKind || admittedMutation.currency !== mutation.currency
    || admittedMutation.desiredDecimal !== mutation.desiredDecimal) fail("admission_mismatch");
  if (planAction.beforeDecimal === mutation.desiredDecimal
    || planAction.afterDecimal !== mutation.desiredDecimal || planAction.currency !== mutation.currency
    || planAction.budgetKind !== mutation.budgetKind || planAction.entity.ref !== expectedSpec.target.entityRef
    || input.workspaceRef.length > 128 || input.accountRef.length > 128) fail("admission_mismatch");
  const before = p06BudgetDecimalToMinor(planAction.beforeDecimal, mutation.currency);
  const after = p06BudgetDecimalToMinor(mutation.desiredDecimal, mutation.currency);
  if ((action === "budget_decrease" ? after >= before : after <= before)) fail("admission_mismatch");
  const core = Object.freeze({ version: P06_BUDGET_EXECUTION_MATERIALIZATION_VERSION,
    route: "guide_budget_human_approved" as const, workspaceRef: input.workspaceRef, accountRef: input.accountRef,
    entityRef: expectedSpec.target.entityRef, action, budgetKind: mutation.budgetKind, currency: mutation.currency,
    expectedBefore: Object.freeze({ status: input.currentStatus, budgetMinor: before }),
    desired: Object.freeze({ status: input.currentStatus, budgetMinor: after }), admissionHash: input.admission.admissionHash,
    writeSpecHash: expectedSpec.specHash, actionPlanHash: input.actionPlan.planHash, contextHash: input.actionPlan.contextHash,
    authority: Object.freeze({ canExecute: false as const, canWriteMeta: false as const, canDispatchNetwork: false as const }) });
  return Object.freeze({ ...core, materializationHash: p06ExecutionV2Digest(core) });
}
