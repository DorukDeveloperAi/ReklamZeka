import { createHash } from "node:crypto";

import {
  ACTION_PLAN_VERSION,
  type ActionPlan,
  type ActionType,
  type TypedActionIntent,
} from "@/domain/actions/autonomy-valve";

/**
 * A typed, transport-independent representation of the only Meta mutations
 * this product may eventually execute. It deliberately contains neither a
 * Graph path, an external ID, a token, nor an execution capability.
 */
export const META_WRITE_SPEC_VERSION = "meta-write-spec/1.0.0" as const;

export type MetaWriteSpec = Readonly<{
  version: typeof META_WRITE_SPEC_VERSION;
  unitRef: string;
  unitHash: string;
  actionPlanHash: string;
  actionType: "status_pause" | "status_activate" | "budget_decrease" | "budget_increase"
    | "campaign_rename" | "adset_rename" | "ad_rename";
  target: Readonly<{
    entityLevel: "campaign" | "adset" | "ad";
    entityRef: string;
  }>;
  mutation:
    | Readonly<{ kind: "status"; desiredStatus: "ACTIVE" | "PAUSED" }>
    | Readonly<{ kind: "budget"; budgetKind: "daily" | "lifetime"; currency: string; desiredDecimal: string }>
    | Readonly<{ kind: "rename"; previousName: string; desiredName: string; namingEvidenceRef: string }>;
  requiresSeparateExecutionGrant: true;
  capabilities: Readonly<{ canExecute: false; canWriteMeta: false; canAccessRawGraph: false }>;
  specHash: string;
}>;

export class MetaWriteSpecError extends Error {
  constructor(readonly code: "invalid_input" | "invalid_plan" | "unsupported_action") {
    super(`Typed Meta write spec reddedildi: ${code}`);
    this.name = "MetaWriteSpecError";
  }
}

const HASH = /^[a-f0-9]{64}$/;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const DECIMAL = /^(0|[1-9]\d{0,29})(?:\.\d{1,12})?$/;

function fail(code: MetaWriteSpecError["code"]): never { throw new MetaWriteSpecError(code); }
function exact(value: unknown, keys: readonly string[], code: MetaWriteSpecError["code"]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype
    || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) fail(code);
}
function stable(value: unknown, seen = new Set<object>()): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") { if (!Number.isFinite(value)) fail("invalid_plan"); return value; }
  if (!value || typeof value !== "object" || seen.has(value)) fail("invalid_plan");
  seen.add(value);
  if (Array.isArray(value)) { const result = value.map((item) => stable(item, seen)); seen.delete(value); return result; }
  if (Object.getPrototypeOf(value) !== Object.prototype) fail("invalid_plan");
  const result = Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, child]) => [key, stable(child, seen)]));
  seen.delete(value);
  return result;
}
function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function ref(value: unknown, code: MetaWriteSpecError["code"]): string {
  if (typeof value !== "string" || !REF.test(value) || value.includes("*")) fail(code);
  return value;
}
function digest(value: unknown, code: MetaWriteSpecError["code"]): string {
  if (typeof value !== "string" || !HASH.test(value)) fail(code);
  return value;
}

function validatePlan(plan: ActionPlan): ActionPlan {
  exact(plan, ["schemaVersion", "actionType", "risk", "action", "effectiveAutonomy", "disposition", "reasonCodes", "trace", "budgetDelta", "capabilities", "contextHash", "planHash"], "invalid_plan");
  if (plan.schemaVersion !== ACTION_PLAN_VERSION || plan.disposition !== "approval_required" || !Array.isArray(plan.reasonCodes)
    || !Array.isArray(plan.trace)) fail("invalid_plan");
  exact(plan.capabilities, ["canExecute", "canWriteMeta", "canGrantApproval", "canAccessRawGraph"], "invalid_plan");
  if (plan.capabilities.canExecute !== false || plan.capabilities.canWriteMeta !== false
    || plan.capabilities.canGrantApproval !== false || plan.capabilities.canAccessRawGraph !== false) fail("invalid_plan");
  digest(plan.contextHash, "invalid_plan");
  const { planHash, ...core } = plan;
  if (hash(core) !== digest(planHash, "invalid_plan")) fail("invalid_plan");
  return plan;
}

function mutationFor(actionType: ActionType, action: TypedActionIntent): MetaWriteSpec["mutation"] {
  if (actionType === "status_pause" || actionType === "status_activate") {
    const expected = actionType === "status_pause"
      ? { fromStatus: "ACTIVE" as const, toStatus: "PAUSED" as const }
      : { fromStatus: "PAUSED" as const, toStatus: "ACTIVE" as const };
    if (action.kind !== "status_change" || !["campaign", "adset", "ad"].includes(action.entity.level)
      || action.fromStatus !== expected.fromStatus || action.toStatus !== expected.toStatus) fail("invalid_plan");
    return Object.freeze({ kind: "status", desiredStatus: action.toStatus });
  }
  if (actionType === "budget_decrease" || actionType === "budget_increase") {
    if (action.kind !== "budget_change" || !["campaign", "adset"].includes(action.entity.level)
      || action.budgetOwnerRef !== action.entity.ref || !DECIMAL.test(action.beforeDecimal) || !DECIMAL.test(action.afterDecimal)
      || !/^[A-Z]{3}$/.test(action.currency)) fail("invalid_plan");
    const decimal = (value: string) => {
      const [whole, fraction = ""] = value.split(".");
      return { coefficient: BigInt(`${whole}${fraction}`), scale: fraction.length };
    };
    const before = decimal(action.beforeDecimal); const after = decimal(action.afterDecimal);
    const scale = Math.max(before.scale, after.scale);
    const beforeValue = before.coefficient * 10n ** BigInt(scale - before.scale);
    const afterValue = after.coefficient * 10n ** BigInt(scale - after.scale);
    if ((actionType === "budget_decrease" && afterValue >= beforeValue)
      || (actionType === "budget_increase" && afterValue <= beforeValue)) fail("invalid_plan");
    return Object.freeze({ kind: "budget", budgetKind: action.budgetKind, currency: action.currency, desiredDecimal: action.afterDecimal });
  }
  if (actionType === "campaign_rename" || actionType === "adset_rename" || actionType === "ad_rename") {
    const level = actionType === "campaign_rename" ? "campaign" : actionType === "adset_rename" ? "adset" : "ad";
    if (action.kind !== "rename" || action.entity.level !== level || action.beforeName === action.afterName
      || action.beforeName !== action.beforeName.trim() || action.afterName !== action.afterName.trim()
      || action.beforeName.length < 1 || action.beforeName.length > 255 || action.afterName.length < 1
      || action.afterName.length > 255 || /[\u0000-\u001f\u007f]/.test(action.beforeName + action.afterName)) fail("invalid_plan");
    return Object.freeze({ kind: "rename", previousName: action.beforeName, desiredName: action.afterName,
      namingEvidenceRef: ref(action.namingEvidenceRef, "invalid_plan") });
  }
  fail("unsupported_action");
}

/**
 * Produces a transport-neutral candidate only. An executor must later resolve
 * the opaque entity reference, re-check persisted freshness/approval, and
 * obtain a separate single-use human execution grant before any network call.
 */
export function createMetaWriteSpec(input: Readonly<{ unitRef: string; unitHash: string; actionPlan: ActionPlan }>): MetaWriteSpec {
  exact(input, ["unitRef", "unitHash", "actionPlan"], "invalid_input");
  const unitRef = ref(input.unitRef, "invalid_input");
  const unitHash = digest(input.unitHash, "invalid_input");
  const actionPlan = validatePlan(input.actionPlan);
  const supported = ["status_pause", "status_activate", "budget_decrease", "budget_increase",
    "campaign_rename", "adset_rename", "ad_rename"] as const;
  if (!supported.includes(actionPlan.actionType as (typeof supported)[number])) fail("unsupported_action");
  const actionType = actionPlan.actionType as (typeof supported)[number];
  const target = Object.freeze({ entityLevel: actionPlan.action.entity.level, entityRef: ref(actionPlan.action.entity.ref, "invalid_plan") });
  const mutation = mutationFor(actionType, actionPlan.action);
  const core = Object.freeze({
    version: META_WRITE_SPEC_VERSION,
    unitRef,
    unitHash,
    actionPlanHash: actionPlan.planHash,
    actionType,
    target,
    mutation,
    requiresSeparateExecutionGrant: true as const,
    capabilities: Object.freeze({ canExecute: false as const, canWriteMeta: false as const, canAccessRawGraph: false as const }),
  });
  return Object.freeze({ ...core, specHash: hash(core) });
}
