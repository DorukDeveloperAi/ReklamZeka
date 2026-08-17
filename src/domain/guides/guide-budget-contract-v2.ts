import { createHash } from "node:crypto";

import type { GuideMarket } from "@/domain/guides/guide-revision";
import type { GuideBudgetExpressionV2 } from "@/domain/guides/guide-budget-dry-run";

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
  overlapEnvelope: Readonly<{ restrictionsComplete: true; actionAllowlist: readonly ("budget_increase"|"budget_decrease")[]; unresolvedConflictRefs: readonly string[] }>;
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
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable)
  : value && typeof value === "object" ? Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, stable(item)])) : value;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
const fail = (): never => { throw new GuideBudgetContractV2Error("invalid_input"); };

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
  const envelope=value.overlapEnvelope; if(!envelope||envelope.restrictionsComplete!==true||!Array.isArray(envelope.actionAllowlist)||!Array.isArray(envelope.unresolvedConflictRefs)||envelope.actionAllowlist.some(x=>x!=="budget_increase"&&x!=="budget_decrease")||envelope.unresolvedConflictRefs.some(x=>typeof x!=="string"||!REF.test(x))) return fail();
  const normalized = Object.freeze({ guideRevisionHash: value.guideRevisionHash, market: value.market, currency: "TRY" as const, targetScopeRef: value.targetScopeRef, expression: expression(value.expression), maximumEvidenceAgeSeconds: value.maximumEvidenceAgeSeconds, overlapEnvelope:Object.freeze({restrictionsComplete:true as const,actionAllowlist:Object.freeze([...new Set(envelope.actionAllowlist)].sort()),unresolvedConflictRefs:Object.freeze([...new Set(envelope.unresolvedConflictRefs)].sort())}) });
  return Object.freeze({ ...normalized, schemaVersion: GUIDE_BUDGET_CONTRACT_V2, contractHash: digest({ schemaVersion: GUIDE_BUDGET_CONTRACT_V2, ...normalized }) });
}

export function verifyGuideBudgetContractV2(value: GuideBudgetContractV2): boolean {
  try {
    const { schemaVersion, contractHash, ...draft } = value;
    return schemaVersion === GUIDE_BUDGET_CONTRACT_V2 && createGuideBudgetContractV2(draft).contractHash === contractHash;
  } catch { return false; }
}
