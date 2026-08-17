import { createHash } from "node:crypto";

import type { GuideMarket } from "@/domain/guides/guide-revision";
import type { GuideAction } from "@/domain/guides/guide-revision";
import type { GuideBudgetExpressionV2 } from "@/domain/guides/guide-budget-dry-run";
import type { GuideNumericCap, GuideRestriction } from "@/domain/guides/effective-guide-overlap";

/**
 * Persisted companion contract for budget-capable Guide revisions.  It is
 * deliberately additive: a v1 Guide revision stays readable and cannot be
 * silently reinterpreted as v2.
 */
export const GUIDE_BUDGET_CONTRACT_V2 = "guide-budget-contract/2.0.0" as const;

export type GuideBudgetContractV2Draft = Readonly<{
  guideRevisionHash: string;
  market: GuideMarket;
  currency: "TRY";
  targetScopeRef: string;
  expression: GuideBudgetExpressionV2;
  maximumEvidenceAgeSeconds: number;
  /** Complete, hashed inputs to P06's effective-overlap resolver. */
  overlapEnvelope: Readonly<{
    restrictionsComplete: true;
    actionAllowlist: readonly ("budget_increase"|"budget_decrease")[];
    restrictions: readonly GuideRestriction[];
    numericCaps: readonly GuideNumericCap[];
    unresolvedConflictRefs: readonly string[];
  }>;
}>;

export type GuideBudgetContractV2 = Readonly<GuideBudgetContractV2Draft & {
  schemaVersion: typeof GUIDE_BUDGET_CONTRACT_V2;
  contractHash: string;
}>;

export class GuideBudgetContractV2Error extends Error {
  constructor(readonly code: "invalid_input") { super(code); this.name = "GuideBudgetContractV2Error"; }
}

const HASH = /^[a-f0-9]{64}$/;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const DECIMAL = /^(?:0|[1-9]\d{0,29})(?:\.\d{1,18})?$/;
const ACTIONS: readonly GuideAction[] = ["status_pause", "status_activate", "budget_decrease", "budget_increase", "campaign_rename", "adset_rename", "ad_rename"];
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)])) : value;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
const fail = (): never => { throw new GuideBudgetContractV2Error("invalid_input"); };

function refs(value: unknown, maximum: number): readonly string[] {
  if (!Array.isArray(value) || value.length > maximum || value.some((item) => typeof item !== "string" || !REF.test(item))) return fail();
  const output = [...value].sort(); if (new Set(output).size !== output.length) return fail(); return Object.freeze(output);
}
function actionList(value: unknown, allowEmpty = true): readonly GuideAction[] {
  if (!Array.isArray(value) || value.length > ACTIONS.length || value.some((item) => typeof item !== "string" || !ACTIONS.includes(item as GuideAction))) return fail();
  const output = [...value].sort() as GuideAction[]; if ((!allowEmpty && output.length === 0) || new Set(output).size !== output.length) return fail(); return Object.freeze(output);
}
function restrictions(value: unknown): readonly GuideRestriction[] {
  if (!Array.isArray(value) || value.length > 1_000) return fail();
  const output = value.map((item): GuideRestriction => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return fail(); const row = item as Record<string, unknown>;
    if ((row.kind === "deny" || row.kind === "manual_lock") && Object.keys(row).sort().join("|") === "actions|kind|restrictionRef") return Object.freeze({ restrictionRef: refs([row.restrictionRef], 1)[0]!, kind: row.kind, actions: actionList(row.actions, false) });
    if (row.kind === "protection" && Object.keys(row).sort().join("|") === "actions|disposition|kind|restrictionRef" && (row.disposition === "deny" || row.disposition === "human_approval")) return Object.freeze({ restrictionRef: refs([row.restrictionRef], 1)[0]!, kind: "protection", disposition: row.disposition, actions: actionList(row.actions, false) });
    return fail();
  }).sort((left, right) => left.restrictionRef.localeCompare(right.restrictionRef));
  if (new Set(output.map((item) => item.restrictionRef)).size !== output.length) return fail(); return Object.freeze(output);
}
function numericCaps(value: unknown): readonly GuideNumericCap[] {
  if (!Array.isArray(value) || value.length > 1_000) return fail();
  const output = value.map((item): GuideNumericCap => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return fail(); const row = item as Record<string, unknown>;
    if (Object.keys(row).sort().join("|") !== "action|capRef|currency|kind|value" || !Number.isSafeInteger(row.value) || (row.value as number) < 0) return fail();
    const action = actionList([row.action], false)[0]!, capRef = refs([row.capRef], 1)[0]!, numberValue = row.value as number;
    if (row.kind === "maximum_actions_per_run" && numberValue >= 1 && numberValue <= 10_000 && row.currency === null) return Object.freeze({ capRef, action, kind: row.kind, value: numberValue, currency: null });
    if (row.kind === "maximum_absolute_budget_delta_minor" && (action === "budget_increase" || action === "budget_decrease") && row.currency === "TRY") return Object.freeze({ capRef, action, kind: row.kind, value: numberValue, currency: "TRY" });
    if (row.kind === "maximum_relative_budget_delta_basis_points" && (action === "budget_increase" || action === "budget_decrease") && numberValue <= 1_000_000 && row.currency === null) return Object.freeze({ capRef, action, kind: row.kind, value: numberValue, currency: null });
    return fail();
  }).sort((left, right) => left.capRef.localeCompare(right.capRef));
  if (new Set(output.map((item) => item.capRef)).size !== output.length) return fail(); return Object.freeze(output);
}

function expression(value: unknown, depth = 0): GuideBudgetExpressionV2 {
  if (depth > 20 || !value || typeof value !== "object" || Array.isArray(value)) return fail();
  const row = value as Record<string, unknown>;
  const keys = Object.keys(row).sort();
  if (row.kind === "scope_budget" && keys.join("|") === "kind|scopeRef" && typeof row.scopeRef === "string" && REF.test(row.scopeRef)) return Object.freeze({ kind: "scope_budget", scopeRef: row.scopeRef });
  if (row.kind === "money" && keys.join("|") === "amountDecimal|currency|kind" && typeof row.amountDecimal === "string" && DECIMAL.test(row.amountDecimal) && row.currency === "TRY") return Object.freeze({ kind: "money", amountDecimal: row.amountDecimal, currency: "TRY" });
  if ((row.kind === "max" || row.kind === "min") && keys.join("|") === "kind|operands" && Array.isArray(row.operands) && row.operands.length === 2) {
    const operands: readonly [GuideBudgetExpressionV2, GuideBudgetExpressionV2] = [expression(row.operands[0], depth + 1), expression(row.operands[1], depth + 1)];
    return Object.freeze({ kind: row.kind, operands });
  }
  if (row.kind === "multiply" && keys.join("|") === "kind|operands" && Array.isArray(row.operands) && row.operands.length === 2) {
    const scalar = row.operands[1];
    if (!scalar || typeof scalar !== "object" || Array.isArray(scalar) || Object.keys(scalar).sort().join("|") !== "kind|value" || (scalar as { kind?: unknown }).kind !== "decimal" || typeof (scalar as { value?: unknown }).value !== "string" || !DECIMAL.test((scalar as { value: string }).value)) return fail();
    const operands: readonly [GuideBudgetExpressionV2, Readonly<{ kind: "decimal"; value: string }>]
      = [expression(row.operands[0], depth + 1), Object.freeze({ kind: "decimal" as const, value: (scalar as { value: string }).value })];
    return Object.freeze({ kind: "multiply", operands });
  }
  return fail();
}

export function createGuideBudgetContractV2(value: GuideBudgetContractV2Draft): GuideBudgetContractV2 {
  if (!value || typeof value !== "object" || Object.keys(value).sort().join("|") !== "currency|expression|guideRevisionHash|market|maximumEvidenceAgeSeconds|overlapEnvelope|targetScopeRef"
    || !HASH.test(value.guideRevisionHash) || (value.market !== "yerli" && value.market !== "yabanci") || value.currency !== "TRY"
    || !REF.test(value.targetScopeRef) || !Number.isSafeInteger(value.maximumEvidenceAgeSeconds) || value.maximumEvidenceAgeSeconds < 1 || value.maximumEvidenceAgeSeconds > 31_536_000) return fail();
  const envelope=value.overlapEnvelope; if(!envelope||typeof envelope!=="object"||Array.isArray(envelope)||Object.keys(envelope).sort().join("|")!=="actionAllowlist|numericCaps|restrictions|restrictionsComplete|unresolvedConflictRefs"||envelope.restrictionsComplete!==true) return fail();
  const budgetActions = actionList(envelope.actionAllowlist).filter((item): item is "budget_increase" | "budget_decrease" => item === "budget_increase" || item === "budget_decrease");
  if (budgetActions.length !== envelope.actionAllowlist.length) return fail();
  const normalized = Object.freeze({ guideRevisionHash: value.guideRevisionHash, market: value.market, currency: "TRY" as const, targetScopeRef: value.targetScopeRef, expression: expression(value.expression), maximumEvidenceAgeSeconds: value.maximumEvidenceAgeSeconds, overlapEnvelope:Object.freeze({restrictionsComplete:true as const,actionAllowlist:Object.freeze(budgetActions),restrictions:restrictions(envelope.restrictions),numericCaps:numericCaps(envelope.numericCaps),unresolvedConflictRefs:refs(envelope.unresolvedConflictRefs,256)}) });
  return Object.freeze({ ...normalized, schemaVersion: GUIDE_BUDGET_CONTRACT_V2, contractHash: digest({ schemaVersion: GUIDE_BUDGET_CONTRACT_V2, ...normalized }) });
}

export function verifyGuideBudgetContractV2(value: GuideBudgetContractV2): boolean {
  try {
    const { schemaVersion, contractHash, ...draft } = value;
    return schemaVersion === GUIDE_BUDGET_CONTRACT_V2 && createGuideBudgetContractV2(draft).contractHash === contractHash;
  } catch { return false; }
}
