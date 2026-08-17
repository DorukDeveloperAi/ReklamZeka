import { createHash } from "node:crypto";

import type { BudgetExpression, GuideMarket } from "@/domain/guides/guide-revision";

/**
 * The v2 extension is deliberately separate from the persisted guide contract.
 * It is a pure evaluator: no repository, action staging, or execution authority
 * is reachable from this module.
 */
export const GUIDE_BUDGET_DRY_RUN_VERSION = "guide-budget-dry-run/2.0.0" as const;
export const GUIDE_BUDGET_MONEY_ROUNDING = "half_even/1" as const;

export type BudgetScopeLayer = "market" | "organization_campaign" | "geo_targeting_platform" | "campaign_ad_set";
export type BudgetFreshness = "fresh" | "stale" | "missing";

export type GuideBudgetExpressionV2 =
  | Readonly<{ kind: "scope_budget"; scopeRef: string }>
  | Readonly<{ kind: "money"; amountDecimal: string; currency: string }>
  | Readonly<{ kind: "multiply"; operands: readonly [GuideBudgetExpressionV2, Readonly<{ kind: "decimal"; value: string }>] }>
  | Readonly<{ kind: "max" | "min"; operands: readonly [GuideBudgetExpressionV2, GuideBudgetExpressionV2] }>;

/** Existing v1 Guide BudgetExpression remains an accepted input. */
export type CompatibleGuideBudgetExpression = BudgetExpression | GuideBudgetExpressionV2;

export type BudgetScopeEvidence = Readonly<{
  scopeLayer: BudgetScopeLayer;
  scopeRef: string;
  market: GuideMarket;
  currency: string;
  budgetOwnerRef: string;
  budgetOwnerKind: "campaign" | "adset";
  currentBudgetDecimal: string | null;
  freshness: BudgetFreshness;
  observedAt: string | null;
  evidenceHash: string;
}>;

export type GuideBudgetDryRunConstraint = Readonly<{
  guideRef: string;
  action: "budget_increase" | "budget_decrease";
  allowed: boolean;
  requiresHumanApproval: boolean;
  maximumAbsoluteDeltaDecimal: string | null;
  maximumRelativeDeltaBasisPoints: number | null;
  parentCeilingDecimal: string | null;
}>;

export type GuideBudgetDryRunInput = Readonly<{
  targetScopeRef: string;
  market: GuideMarket;
  currency: string;
  targetCurrentBudgetDecimal: string | null;
  expression: CompatibleGuideBudgetExpression;
  scopeEvidence: readonly BudgetScopeEvidence[];
  constraints: readonly GuideBudgetDryRunConstraint[];
}>;

export type GuideBudgetDryRun = Readonly<{
  version: typeof GUIDE_BUDGET_DRY_RUN_VERSION;
  moneyRounding: typeof GUIDE_BUDGET_MONEY_ROUNDING;
  status: "ready" | "held";
  targetScopeRef: string;
  market: GuideMarket;
  currency: string;
  currentBudgetDecimal: string | null;
  evaluatedBudgetDecimal: string | null;
  requestedDeltaDecimal: string | null;
  effectiveMaximumAbsoluteDeltaDecimal: string | null;
  effectiveMaximumRelativeDeltaBasisPoints: number | null;
  effectiveParentCeilingDecimal: string | null;
  effectiveRequiresHumanApproval: boolean;
  effectiveBudgetOwner: Readonly<{ budgetOwnerRef: string; budgetOwnerKind: "campaign" | "adset" }> | null;
  ownerEvidence: readonly Readonly<{
    budgetOwnerRef: string;
    budgetOwnerKind: "campaign" | "adset";
    currentBudgetDecimal: string | null;
    scopeRefs: readonly string[];
    evidenceHashes: readonly string[];
  }> [];
  holdReasons: readonly string[];
  evidenceHash: string;
  dryRunHash: string;
  authority: Readonly<{
    writeOperations: 0;
    canWriteMeta: false;
    canExecute: false;
    canApprove: false;
    canPersist: false;
  }>;
}>;

export class GuideBudgetDryRunError extends Error {
  constructor(readonly code: "invalid_input" | "invalid_expression") {
    super(code);
    this.name = "GuideBudgetDryRunError";
  }
}

const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const CURRENCY = /^[A-Z]{3}$/;
const DECIMAL = /^(?:0|[1-9]\d{0,29})(?:\.\d{1,18})?$/;
const RATIO = /^(?:0|[1-9]\d{0,29})(?:\.\d{1,18})?$/;
const SCALE = 18;
const FACTOR = 10n ** BigInt(SCALE);
const MAX_UNITS = 10n ** 48n - 1n;
const MAX_EXPRESSION_DEPTH = 20;
const MAX_EXPRESSION_NODES = 100;
const AUTHORITY = Object.freeze({ writeOperations: 0 as const, canWriteMeta: false as const, canExecute: false as const, canApprove: false as const, canPersist: false as const });

function fail(code: GuideBudgetDryRunError["code"]): never { throw new GuideBudgetDryRunError(code); }
function compare(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }
function stable(value: unknown): unknown {
  if (typeof value === "bigint") return `${value}n`;
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => compare(a, b)).map(([key, item]) => [key, stable(item)]));
  return value;
}
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function ref(value: unknown): string { if (typeof value !== "string" || !REF.test(value)) fail("invalid_input"); return value; }
function currency(value: unknown): string { if (typeof value !== "string" || !CURRENCY.test(value)) fail("invalid_input"); return value; }
function decimal(value: unknown, ratio = false): bigint {
  if (typeof value !== "string" || !(ratio ? RATIO : DECIMAL).test(value)) fail("invalid_input");
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > SCALE) fail("invalid_input");
  return BigInt(`${whole}${fraction.padEnd(SCALE, "0")}`);
}
function render(value: bigint): string {
  const negative = value < 0n; const absolute = negative ? -value : value;
  const whole = absolute / FACTOR; const fraction = (absolute % FACTOR).toString().padStart(SCALE, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${fraction ? `${whole}.${fraction}` : whole}`;
}
function bounded(value: bigint): bigint { if (value < 0n || value > MAX_UNITS) fail("invalid_expression"); return value; }
function divideHalfEven(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator; const remainder = numerator % denominator; const doubled = remainder * 2n;
  return quotient + (doubled > denominator || doubled === denominator && quotient % 2n !== 0n ? 1n : 0n);
}
function multiplyDecimal(value: bigint, ratio: bigint): bigint { return bounded(divideHalfEven(value * ratio, FACTOR)); }
function currencyMinorExponent(value: string): number {
  // v3 workspace currency is TRY. Keep this mapping explicit rather than
  // guessing an exponent from a locale or a floating-point formatter.
  if (value !== "TRY") fail("invalid_input");
  return 2;
}
function roundCurrency(value: bigint, currencyCode: string): bigint {
  const exponent = currencyMinorExponent(currencyCode); const divisor = 10n ** BigInt(SCALE - exponent);
  const negative = value < 0n; const rounded = divideHalfEven(negative ? -value : value, divisor) * divisor;
  return negative ? -rounded : rounded;
}
function ensureMarket(value: unknown): GuideMarket { if (value !== "yerli" && value !== "yabanci") fail("invalid_input"); return value; }
function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) fail("invalid_input");
}
function scopeReference(layer: BudgetScopeLayer, value: unknown): string {
  const result = ref(value);
  const valid = layer === "market" ? result.startsWith("market_")
    : layer === "organization_campaign" ? result.startsWith("organization_campaign_")
      : layer === "geo_targeting_platform" ? result.startsWith("slice_")
        : result.startsWith("campaign_") || result.startsWith("adset_") || result.startsWith("ad_set_");
  if (!valid) fail("invalid_input");
  return result;
}
function ownerReference(kind: "campaign" | "adset", value: unknown): string {
  const result = ref(value);
  if (kind === "adset" ? !(result.startsWith("adset_") || result.startsWith("ad_set_")) : !result.startsWith("campaign_")) fail("invalid_input");
  return result;
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const item of Object.values(value as Record<string, unknown>)) deepFreeze(item);
    Object.freeze(value);
  }
  return value;
}

function v1Expression(value: CompatibleGuideBudgetExpression): value is BudgetExpression {
  return value.kind === "current_budget" || (value.kind === "money" && "amountMinor" in value);
}

function validateExpression(value: unknown, depth = 0, nodes = { value: 0 }): CompatibleGuideBudgetExpression {
  if (depth > MAX_EXPRESSION_DEPTH || ++nodes.value > MAX_EXPRESSION_NODES) return fail("invalid_expression");
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("invalid_expression");
  const candidate = value as Record<string, unknown>;
  if (candidate.kind === "current_budget") {
    exact(candidate, ["kind", "scope"]);
    if (candidate.scope !== "related_organization_campaign" && candidate.scope !== "canonical_budget_owner") return fail("invalid_expression");
    return candidate as unknown as BudgetExpression;
  }
  if (candidate.kind === "scope_budget") { exact(candidate, ["kind", "scopeRef"]); ref(candidate.scopeRef); return candidate as unknown as GuideBudgetExpressionV2; }
  if (candidate.kind === "money") {
    if ("amountMinor" in candidate) { exact(candidate, ["kind", "amountMinor", "currency"]); if (!Number.isSafeInteger(candidate.amountMinor) || (candidate.amountMinor as number) < 0 || candidate.currency !== "TRY") return fail("invalid_expression"); return candidate as unknown as BudgetExpression; }
    exact(candidate, ["kind", "amountDecimal", "currency"]); decimal(candidate.amountDecimal); currency(candidate.currency); return candidate as unknown as GuideBudgetExpressionV2;
  }
  if (candidate.kind === "multiply") {
    exact(candidate, ["kind", "operands"]); if (!Array.isArray(candidate.operands) || candidate.operands.length !== 2) return fail("invalid_expression");
    const base = validateExpression(candidate.operands[0], depth + 1, nodes); const scalar = candidate.operands[1];
    if (!scalar || typeof scalar !== "object" || Array.isArray(scalar)) return fail("invalid_expression");
    const scalarCandidate = scalar as Record<string, unknown>; exact(scalarCandidate, ["kind", "value"]); if (scalarCandidate.kind !== "decimal") return fail("invalid_expression"); decimal(scalarCandidate.value, true);
    return Object.freeze({ kind: "multiply" as const, operands: [base, Object.freeze({ kind: "decimal" as const, value: scalarCandidate.value as string })] }) as unknown as CompatibleGuideBudgetExpression;
  }
  if (candidate.kind === "max" || candidate.kind === "min") {
    exact(candidate, ["kind", "operands"]); if (!Array.isArray(candidate.operands) || candidate.operands.length !== 2) return fail("invalid_expression");
    return Object.freeze({ kind: candidate.kind, operands: [validateExpression(candidate.operands[0], depth + 1, nodes), validateExpression(candidate.operands[1], depth + 1, nodes)] }) as unknown as CompatibleGuideBudgetExpression;
  }
  return fail("invalid_expression");
}

function evaluateExpression(
  expression: CompatibleGuideBudgetExpression,
  evidenceByScope: ReadonlyMap<string, bigint>,
  canonicalOwnerBudget: bigint | null,
  relatedOrganizationBudget: bigint | null,
  expectedCurrency: string,
): bigint | null {
  if (v1Expression(expression)) {
    if (expression.kind === "current_budget") return expression.scope === "canonical_budget_owner" ? canonicalOwnerBudget : relatedOrganizationBudget;
    if (expression.kind === "money") return expression.currency === expectedCurrency ? bounded(BigInt(expression.amountMinor) * FACTOR / 100n) : null;
    if (expression.kind === "multiply") { const base = evaluateExpression(expression.operands[0], evidenceByScope, canonicalOwnerBudget, relatedOrganizationBudget, expectedCurrency); return base === null ? null : multiplyDecimal(base, decimal(expression.operands[1].value, true)); }
    const left = evaluateExpression(expression.operands[0], evidenceByScope, canonicalOwnerBudget, relatedOrganizationBudget, expectedCurrency);
    const right = evaluateExpression(expression.operands[1], evidenceByScope, canonicalOwnerBudget, relatedOrganizationBudget, expectedCurrency);
    return left === null || right === null ? null : expression.kind === "max" ? (left > right ? left : right) : (left < right ? left : right);
  }
  if (expression.kind === "scope_budget") return evidenceByScope.get(ref(expression.scopeRef)) ?? null;
  if (expression.kind === "money") return expression.currency === expectedCurrency ? bounded(decimal(expression.amountDecimal)) : null;
  if (expression.kind === "multiply") { const base = evaluateExpression(expression.operands[0], evidenceByScope, canonicalOwnerBudget, relatedOrganizationBudget, expectedCurrency); return base === null ? null : multiplyDecimal(base, decimal(expression.operands[1].value, true)); }
  const left = evaluateExpression(expression.operands[0], evidenceByScope, canonicalOwnerBudget, relatedOrganizationBudget, expectedCurrency);
  const right = evaluateExpression(expression.operands[1], evidenceByScope, canonicalOwnerBudget, relatedOrganizationBudget, expectedCurrency);
  return left === null || right === null ? null : expression.kind === "max" ? (left > right ? left : right) : (left < right ? left : right);
}

/**
 * Computes a deterministic, evidence-only budget interpretation. Any missing,
 * stale, cross-market/currency, ownership, ceiling, or overlap conflict is a
 * hold; callers cannot use this return value to persist or execute anything.
 */
export function dryRunGuideBudget(input: GuideBudgetDryRunInput): GuideBudgetDryRun {
  exact(input, ["targetScopeRef", "market", "currency", "targetCurrentBudgetDecimal", "expression", "scopeEvidence", "constraints"]);
  const targetScopeRef = ref(input.targetScopeRef); const market = ensureMarket(input.market); const targetCurrency = currency(input.currency);
  const expression = validateExpression(input.expression);
  const currentBudget = input.targetCurrentBudgetDecimal === null ? null : roundCurrency(decimal(input.targetCurrentBudgetDecimal), targetCurrency);
  if (!Array.isArray(input.scopeEvidence) || !Array.isArray(input.constraints) || input.scopeEvidence.length > 10_000 || input.constraints.length > 1_000) fail("invalid_input");
  const hold = new Set<string>();
  const normalizedEvidence = input.scopeEvidence.map((row) => {
    exact(row, ["scopeLayer", "scopeRef", "market", "currency", "budgetOwnerRef", "budgetOwnerKind", "currentBudgetDecimal", "freshness", "observedAt", "evidenceHash"]);
    const candidate = row as BudgetScopeEvidence;
    if (!["market", "organization_campaign", "geo_targeting_platform", "campaign_ad_set"].includes(candidate.scopeLayer) || !["campaign", "adset"].includes(candidate.budgetOwnerKind) || !["fresh", "stale", "missing"].includes(candidate.freshness) || !/^[a-f0-9]{64}$/.test(candidate.evidenceHash)) fail("invalid_input");
    if (candidate.market !== "yerli" && candidate.market !== "yabanci") fail("invalid_input");
    if (candidate.observedAt !== null && (typeof candidate.observedAt !== "string" || !Number.isFinite(Date.parse(candidate.observedAt)) || new Date(candidate.observedAt).toISOString() !== candidate.observedAt)) fail("invalid_input");
    const value = candidate.currentBudgetDecimal === null ? null : roundCurrency(decimal(candidate.currentBudgetDecimal), targetCurrency);
    if (candidate.freshness === "fresh" && (value === null || candidate.observedAt === null)
      || candidate.freshness === "stale" && (value === null || candidate.observedAt === null)
      || candidate.freshness === "missing" && (value !== null || candidate.observedAt !== null)) fail("invalid_input");
    if (candidate.market !== market) hold.add(`market_boundary:${candidate.scopeRef}`);
    if (currency(candidate.currency) !== targetCurrency) hold.add(`currency_mismatch:${candidate.scopeRef}`);
    if (candidate.freshness !== "fresh" || value === null) hold.add(`data_${candidate.freshness}:${candidate.scopeRef}`);
    return Object.freeze({ ...candidate, scopeRef: scopeReference(candidate.scopeLayer, candidate.scopeRef), budgetOwnerRef: ownerReference(candidate.budgetOwnerKind, candidate.budgetOwnerRef), current: value });
  }).sort((a, b) => compare(a.scopeRef, b.scopeRef) || compare(a.evidenceHash, b.evidenceHash));
  if (new Set(normalizedEvidence.map((row) => `${row.scopeRef}:${row.evidenceHash}`)).size !== normalizedEvidence.length) fail("invalid_input");
  const scopeCounts = new Map<string, number>();
  for (const row of normalizedEvidence) scopeCounts.set(row.scopeRef, (scopeCounts.get(row.scopeRef) ?? 0) + 1);
  for (const [scopeRef, count] of scopeCounts) if (count > 1) hold.add(`ambiguous_scope_evidence:${scopeRef}`);
  if (normalizedEvidence.filter((row) => row.scopeLayer === "organization_campaign" && row.market === market && row.currency === targetCurrency).length !== 1) hold.add("ambiguous_organization_campaign_scope");
  const evidenceByScope = new Map<string, bigint>();
  for (const row of normalizedEvidence) {
    if (row.current === null || row.market !== market || row.currency !== targetCurrency) continue;
    const existing = evidenceByScope.get(row.scopeRef);
    if (existing !== undefined && existing !== row.current) hold.add(`conflicting_scope_evidence:${row.scopeRef}`);
    else evidenceByScope.set(row.scopeRef, row.current);
  }
  type NormalizedEvidence = (typeof normalizedEvidence)[number];
  const trustedEvidence = normalizedEvidence.filter((row) => row.market === market && row.currency === targetCurrency);
  const byOwner = new Map<string, NormalizedEvidence[]>();
  for (const row of trustedEvidence) byOwner.set(row.budgetOwnerRef, [...(byOwner.get(row.budgetOwnerRef) ?? []), row]);
  const ownerEvidence = Object.freeze([...byOwner.entries()].sort(([a], [b]) => compare(a, b)).map(([budgetOwnerRef, rows]) => {
    const values = [...new Set(rows.map((row) => row.current?.toString()).filter((value): value is string => value !== undefined))];
    if (values.length > 1) hold.add(`conflicting_owner_budget:${budgetOwnerRef}`);
    return Object.freeze({ budgetOwnerRef, budgetOwnerKind: rows[0]!.budgetOwnerKind, currentBudgetDecimal: values.length === 1 ? render(BigInt(values[0]!)) : null, scopeRefs: Object.freeze([...new Set(rows.map((row) => row.scopeRef))].sort(compare)), evidenceHashes: Object.freeze(rows.map((row) => row.evidenceHash).sort(compare)) });
  }));
  const targetEvidence = trustedEvidence.filter((row) => row.scopeRef === targetScopeRef);
  const canonicalOwnerBudget = targetEvidence.length === 1 ? targetEvidence[0]!.current : null;
  const effectiveBudgetOwner = targetEvidence.length === 1
    ? Object.freeze({ budgetOwnerRef: targetEvidence[0]!.budgetOwnerRef, budgetOwnerKind: targetEvidence[0]!.budgetOwnerKind })
    : null;
  const relatedOrganizationBudget = trustedEvidence.find((row) => row.scopeLayer === "organization_campaign")?.current ?? null;
  if (currentBudget === null) hold.add("target_current_budget_missing");
  if (targetEvidence.length !== 1 || canonicalOwnerBudget === null || targetEvidence[0]!.freshness !== "fresh") hold.add("target_owner_evidence_missing");
  if (currentBudget !== null && canonicalOwnerBudget !== null && currentBudget !== canonicalOwnerBudget) hold.add("target_current_budget_evidence_conflict");
  const evaluated = evaluateExpression(expression, evidenceByScope, canonicalOwnerBudget, relatedOrganizationBudget, targetCurrency);
  if (evaluated === null) hold.add("expression_reference_unresolved_or_currency_mismatch");

  const roundedEvaluated = evaluated === null ? null : roundCurrency(evaluated, targetCurrency);
  const roundedCurrent = currentBudget;
  const requestedDelta: bigint | null = roundedEvaluated === null || roundedCurrent === null ? null : roundedEvaluated - roundedCurrent;
  const actionDirection: GuideBudgetDryRunConstraint["action"] | null = requestedDelta === null || requestedDelta === 0n ? null
    : requestedDelta > 0n ? "budget_increase" : "budget_decrease";
  const constraints = input.constraints.map((item) => {
    exact(item, ["guideRef", "action", "allowed", "requiresHumanApproval", "maximumAbsoluteDeltaDecimal", "maximumRelativeDeltaBasisPoints", "parentCeilingDecimal"]);
    const candidate = item as GuideBudgetDryRunConstraint;
    if (!REF.test(candidate.guideRef) || !["budget_increase", "budget_decrease"].includes(candidate.action) || typeof candidate.allowed !== "boolean" || typeof candidate.requiresHumanApproval !== "boolean" || candidate.maximumRelativeDeltaBasisPoints !== null && (!Number.isSafeInteger(candidate.maximumRelativeDeltaBasisPoints) || candidate.maximumRelativeDeltaBasisPoints < 0 || candidate.maximumRelativeDeltaBasisPoints > 1_000_000)) fail("invalid_input");
    const absolute = candidate.maximumAbsoluteDeltaDecimal === null ? null : roundCurrency(decimal(candidate.maximumAbsoluteDeltaDecimal), targetCurrency);
    const ceiling = candidate.parentCeilingDecimal === null ? null : roundCurrency(decimal(candidate.parentCeilingDecimal), targetCurrency);
    return Object.freeze({ ...candidate, maximumAbsolute: absolute, parentCeiling: ceiling });
  }).sort((a, b) => compare(a.guideRef, b.guideRef) || compare(a.action, b.action));
  const effectiveConstraints = actionDirection === null ? [] : constraints.filter((item) => item.action === actionDirection);
  let maxAbsolute: bigint | null = null; let maxRelative: number | null = null; let parentCeiling: bigint | null = null; let human = false;
  for (const item of effectiveConstraints) {
    if (!item.allowed) hold.add(`overlap_action_denied:${item.guideRef}`);
    human ||= item.requiresHumanApproval;
    if (item.maximumAbsolute !== null && (maxAbsolute === null || item.maximumAbsolute < maxAbsolute)) maxAbsolute = item.maximumAbsolute;
    if (item.maximumRelativeDeltaBasisPoints !== null && (maxRelative === null || item.maximumRelativeDeltaBasisPoints < maxRelative)) maxRelative = item.maximumRelativeDeltaBasisPoints;
    if (item.parentCeiling !== null && (parentCeiling === null || item.parentCeiling < parentCeiling)) parentCeiling = item.parentCeiling;
  }
  if (requestedDelta !== null) {
    const magnitude = requestedDelta < 0n ? -requestedDelta : requestedDelta;
    if (maxAbsolute !== null && magnitude > maxAbsolute) hold.add("maximum_absolute_delta_exceeded");
    if (maxRelative !== null && currentBudget === 0n && magnitude > 0n) hold.add("maximum_relative_delta_zero_baseline");
    if (maxRelative !== null && currentBudget !== null && currentBudget > 0n && magnitude * 10_000n > currentBudget * BigInt(maxRelative)) hold.add("maximum_relative_delta_exceeded");
    if (parentCeiling !== null && roundedEvaluated! > parentCeiling) hold.add("parent_ceiling_exceeded");
  }
  const evidenceHash = digest({ targetScopeRef, market, currency: targetCurrency, currentBudget, expression, scopeEvidence: normalizedEvidence.map(({ current, ...row }) => ({ ...row, current })), constraints });
  const core = { version: GUIDE_BUDGET_DRY_RUN_VERSION, moneyRounding: GUIDE_BUDGET_MONEY_ROUNDING, status: hold.size ? "held" as const : "ready" as const, targetScopeRef, market, currency: targetCurrency, currentBudgetDecimal: roundedCurrent === null ? null : render(roundedCurrent), evaluatedBudgetDecimal: roundedEvaluated === null ? null : render(roundedEvaluated), requestedDeltaDecimal: requestedDelta === null ? null : render(requestedDelta), effectiveMaximumAbsoluteDeltaDecimal: maxAbsolute === null ? null : render(maxAbsolute), effectiveMaximumRelativeDeltaBasisPoints: maxRelative, effectiveParentCeilingDecimal: parentCeiling === null ? null : render(parentCeiling), effectiveRequiresHumanApproval: human, effectiveBudgetOwner, ownerEvidence, holdReasons: Object.freeze([...hold].sort(compare)), evidenceHash, authority: AUTHORITY };
  return deepFreeze({ ...core, dryRunHash: digest(core) });
}
