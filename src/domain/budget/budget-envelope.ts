export const BUDGET_ENVELOPE_VERSION = "budget-envelope/1.0.0" as const;

export type BudgetScopeLevel = "account" | "category" | "region" | "campaign" | "adset";
export type BudgetPeriodKind = "daily" | "calendar" | "lifetime" | "custom";
export type BudgetRoundingMode = "down" | "up" | "half_up" | "half_even";

export type BudgetScope = Readonly<{
  level: BudgetScopeLevel;
  ref: string;
}>;

export type BudgetPeriod = Readonly<{
  kind: BudgetPeriodKind;
  startDate: string;
  endDate: string;
  timezone: string;
}>;

export type BudgetRounding = Readonly<{
  scale: number;
  mode: BudgetRoundingMode;
}>;

export type BudgetEnvelopeInput = Readonly<{
  envelopeRef: string;
  scope: BudgetScope;
  period: BudgetPeriod;
  currency: string;
  rounding: BudgetRounding;
  totalDecimal: string;
  minimumDecimal: string;
  maximumDecimal: string;
  fixedDecimal: string;
  reserveDecimal: string;
}>;

export type BudgetEnvelope = Readonly<{
  schemaVersion: typeof BUDGET_ENVELOPE_VERSION;
  envelopeRef: string;
  scope: BudgetScope;
  period: BudgetPeriod;
  currency: string;
  rounding: BudgetRounding;
  totalDecimal: string;
  minimumDecimal: string;
  maximumDecimal: string;
  fixedDecimal: string;
  reserveDecimal: string;
  allocatableDecimal: string;
}>;

export type BudgetStateAmounts = Readonly<{
  plannedDecimal: string;
  committedDecimal: string;
  actualDecimal: string;
  forecastDecimal: string;
}>;

export type BudgetOwner = Readonly<{
  level: "campaign" | "adset";
  ref: string;
}>;

export type CampaignBudgetOwnership =
  | Readonly<{ mode: "CBO"; campaignRef: string }>
  | Readonly<{ mode: "ABO"; campaignRef: string; adsetRefs: readonly string[] }>;

export type ChildBudgetAllocationInput = Readonly<{
  child: Readonly<{ level: "adset"; ref: string }>;
  currency: string;
  budgetOwner: BudgetOwner;
  fixedDecimal: string;
  state: BudgetStateAmounts;
}>;

export type CampaignBudgetReconciliationInput = Readonly<{
  envelope: BudgetEnvelope;
  ownership: CampaignBudgetOwnership;
  totals: BudgetStateAmounts;
  children: readonly ChildBudgetAllocationInput[];
}>;

export type CampaignBudgetReconciliation = Readonly<{
  schemaVersion: "campaign-budget-reconciliation/1.0.0";
  status: "reconciled";
  envelope: BudgetEnvelope;
  ownership: CampaignBudgetOwnership;
  totals: BudgetStateAmounts;
  children: readonly Readonly<{
    child: Readonly<{ level: "adset"; ref: string }>;
    currency: string;
    budgetOwner: BudgetOwner;
    fixedDecimal: string;
    state: BudgetStateAmounts;
  }>[];
  variance: Readonly<{
    committedFromPlannedDecimal: string;
    actualFromPlannedDecimal: string;
    forecastFromPlannedDecimal: string;
  }>;
}>;

export type BudgetEnvelopeErrorCode =
  | "invalid_contract"
  | "invalid_currency"
  | "invalid_period"
  | "invalid_amount"
  | "invalid_envelope"
  | "currency_mismatch"
  | "duplicate_child"
  | "budget_owner_unresolved"
  | "allocation_mismatch";

export class BudgetEnvelopeError extends Error {
  constructor(readonly code: BudgetEnvelopeErrorCode) {
    super("Bütçe zarfı güvenli biçimde uzlaştırılamadı");
    this.name = "BudgetEnvelopeError";
  }
}

type ExactAmount = Readonly<{ units: bigint; scale: number }>;

const AMOUNT = /^(0|[1-9]\d{0,29})(?:\.(\d{1,18}))?$/;
const CURRENCY = /^[A-Z]{3}$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_-]{0,94}$/;
const PERIOD_KINDS = new Set<BudgetPeriodKind>(["daily", "calendar", "lifetime", "custom"]);
const ROUNDING_MODES = new Set<BudgetRoundingMode>(["down", "up", "half_up", "half_even"]);

function fail(code: BudgetEnvelopeErrorCode): never {
  throw new BudgetEnvelopeError(code);
}

function exactKeys(value: unknown, allowed: readonly string[]): void {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    fail("invalid_contract");
  }
  const keys = Object.keys(value);
  if (keys.length !== allowed.length || keys.some((key) => !allowed.includes(key))) fail("invalid_contract");
}

function reference(value: unknown): string {
  if (typeof value !== "string" || !REF.test(value)) fail("invalid_contract");
  return value;
}

function currency(value: unknown): string {
  if (typeof value !== "string" || !CURRENCY.test(value)) fail("invalid_currency");
  return value;
}

function powerOfTen(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}

function parseAndQuantize(value: unknown, rounding: BudgetRounding): ExactAmount {
  if (typeof value !== "string") fail("invalid_amount");
  const match = AMOUNT.exec(value);
  if (!match) fail("invalid_amount");

  const fraction = match[2] ?? "";
  let units = BigInt(`${match[1]}${fraction}`);
  const sourceScale = fraction.length;
  if (sourceScale < rounding.scale) {
    units *= powerOfTen(rounding.scale - sourceScale);
  } else if (sourceScale > rounding.scale) {
    const divisor = powerOfTen(sourceScale - rounding.scale);
    const quotient = units / divisor;
    const remainder = units % divisor;
    const twiceRemainder = remainder * 2n;
    const increment = rounding.mode === "up"
      ? remainder > 0n
      : rounding.mode === "half_up"
        ? twiceRemainder >= divisor
        : rounding.mode === "half_even"
          ? twiceRemainder > divisor || (twiceRemainder === divisor && quotient % 2n !== 0n)
          : false;
    units = quotient + (increment ? 1n : 0n);
  }
  return { units, scale: rounding.scale };
}

function formatUnits(units: bigint, scale: number): string {
  const negative = units < 0n;
  const absolute = negative ? -units : units;
  if (scale === 0) return `${negative ? "-" : ""}${absolute}`;
  const padded = absolute.toString().padStart(scale + 1, "0");
  const integer = padded.slice(0, -scale);
  const fraction = padded.slice(-scale);
  return `${negative ? "-" : ""}${integer}.${fraction}`;
}

function amount(value: unknown, rounding: BudgetRounding): Readonly<{ units: bigint; decimal: string }> {
  const parsed = parseAndQuantize(value, rounding);
  return { units: parsed.units, decimal: formatUnits(parsed.units, parsed.scale) };
}

function validateRounding(value: unknown): BudgetRounding {
  exactKeys(value, ["scale", "mode"]);
  const candidate = value as Record<string, unknown>;
  if (!Number.isInteger(candidate.scale) || (candidate.scale as number) < 0 || (candidate.scale as number) > 12) {
    fail("invalid_contract");
  }
  if (!ROUNDING_MODES.has(candidate.mode as BudgetRoundingMode)) fail("invalid_contract");
  return Object.freeze({ scale: candidate.scale as number, mode: candidate.mode as BudgetRoundingMode });
}

function validCalendarDate(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const match = DATE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}

function validatePeriod(value: unknown): BudgetPeriod {
  exactKeys(value, ["kind", "startDate", "endDate", "timezone"]);
  const candidate = value as Record<string, unknown>;
  if (!PERIOD_KINDS.has(candidate.kind as BudgetPeriodKind)) fail("invalid_period");
  if (!validCalendarDate(candidate.startDate) || !validCalendarDate(candidate.endDate) || candidate.endDate < candidate.startDate) {
    fail("invalid_period");
  }
  if (typeof candidate.timezone !== "string" || !candidate.timezone || candidate.timezone.length > 100) fail("invalid_period");
  try {
    new Intl.DateTimeFormat("en", { timeZone: candidate.timezone }).format(0);
  } catch {
    fail("invalid_period");
  }
  return Object.freeze({
    kind: candidate.kind as BudgetPeriodKind,
    startDate: candidate.startDate,
    endDate: candidate.endDate,
    timezone: candidate.timezone,
  });
}

function validateScope(value: unknown): BudgetScope {
  exactKeys(value, ["level", "ref"]);
  const candidate = value as Record<string, unknown>;
  if (!["account", "category", "region", "campaign", "adset"].includes(candidate.level as string)) fail("invalid_contract");
  return Object.freeze({ level: candidate.level as BudgetScopeLevel, ref: reference(candidate.ref) });
}

export function quantizeBudgetAmount(value: string, rounding: BudgetRounding): string {
  const normalizedRounding = validateRounding(rounding);
  return amount(value, normalizedRounding).decimal;
}

export function createBudgetEnvelope(input: BudgetEnvelopeInput): BudgetEnvelope {
  exactKeys(input, [
    "envelopeRef", "scope", "period", "currency", "rounding", "totalDecimal",
    "minimumDecimal", "maximumDecimal", "fixedDecimal", "reserveDecimal",
  ]);
  const rounding = validateRounding(input.rounding);
  const total = amount(input.totalDecimal, rounding);
  const minimum = amount(input.minimumDecimal, rounding);
  const maximum = amount(input.maximumDecimal, rounding);
  const fixed = amount(input.fixedDecimal, rounding);
  const reserve = amount(input.reserveDecimal, rounding);
  if (minimum.units > maximum.units || total.units < minimum.units || total.units > maximum.units) fail("invalid_envelope");
  if (reserve.units > total.units) fail("invalid_envelope");
  const allocatable = total.units - reserve.units;
  if (fixed.units > allocatable) fail("invalid_envelope");

  return Object.freeze({
    schemaVersion: BUDGET_ENVELOPE_VERSION,
    envelopeRef: reference(input.envelopeRef),
    scope: validateScope(input.scope),
    period: validatePeriod(input.period),
    currency: currency(input.currency),
    rounding,
    totalDecimal: total.decimal,
    minimumDecimal: minimum.decimal,
    maximumDecimal: maximum.decimal,
    fixedDecimal: fixed.decimal,
    reserveDecimal: reserve.decimal,
    allocatableDecimal: formatUnits(allocatable, rounding.scale),
  });
}

function normalizeState(value: unknown, rounding: BudgetRounding): Readonly<{ state: BudgetStateAmounts; units: readonly bigint[] }> {
  exactKeys(value, ["plannedDecimal", "committedDecimal", "actualDecimal", "forecastDecimal"]);
  const candidate = value as Record<string, unknown>;
  const planned = amount(candidate.plannedDecimal, rounding);
  const committed = amount(candidate.committedDecimal, rounding);
  const actual = amount(candidate.actualDecimal, rounding);
  const forecast = amount(candidate.forecastDecimal, rounding);
  return {
    state: Object.freeze({
      plannedDecimal: planned.decimal,
      committedDecimal: committed.decimal,
      actualDecimal: actual.decimal,
      forecastDecimal: forecast.decimal,
    }),
    units: [planned.units, committed.units, actual.units, forecast.units],
  };
}

function validateOwnership(value: unknown): CampaignBudgetOwnership {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("invalid_contract");
  const candidate = value as Record<string, unknown>;
  if (candidate.mode === "CBO") {
    exactKeys(value, ["mode", "campaignRef"]);
    return Object.freeze({ mode: "CBO", campaignRef: reference(candidate.campaignRef) });
  }
  if (candidate.mode === "ABO") {
    exactKeys(value, ["mode", "campaignRef", "adsetRefs"]);
    if (!Array.isArray(candidate.adsetRefs) || candidate.adsetRefs.length === 0) fail("budget_owner_unresolved");
    const refs = candidate.adsetRefs.map(reference);
    if (new Set(refs).size !== refs.length) fail("budget_owner_unresolved");
    return Object.freeze({ mode: "ABO", campaignRef: reference(candidate.campaignRef), adsetRefs: Object.freeze([...refs].sort()) });
  }
  fail("budget_owner_unresolved");
}

function validateEnvelope(value: unknown): BudgetEnvelope {
  exactKeys(value, [
    "schemaVersion", "envelopeRef", "scope", "period", "currency", "rounding", "totalDecimal",
    "minimumDecimal", "maximumDecimal", "fixedDecimal", "reserveDecimal", "allocatableDecimal",
  ]);
  const candidate = value as Record<string, unknown>;
  if (candidate.schemaVersion !== BUDGET_ENVELOPE_VERSION) fail("invalid_contract");
  const normalized = createBudgetEnvelope({
    envelopeRef: candidate.envelopeRef as string,
    scope: candidate.scope as BudgetScope,
    period: candidate.period as BudgetPeriod,
    currency: candidate.currency as string,
    rounding: candidate.rounding as BudgetRounding,
    totalDecimal: candidate.totalDecimal as string,
    minimumDecimal: candidate.minimumDecimal as string,
    maximumDecimal: candidate.maximumDecimal as string,
    fixedDecimal: candidate.fixedDecimal as string,
    reserveDecimal: candidate.reserveDecimal as string,
  });
  const canonicalFields: readonly (keyof BudgetEnvelope)[] = [
    "envelopeRef", "currency", "totalDecimal", "minimumDecimal", "maximumDecimal",
    "fixedDecimal", "reserveDecimal", "allocatableDecimal",
  ];
  if (canonicalFields.some((field) => candidate[field] !== normalized[field])) fail("invalid_envelope");
  return normalized;
}

export function reconcileCampaignBudget(input: CampaignBudgetReconciliationInput): CampaignBudgetReconciliation {
  exactKeys(input, ["envelope", "ownership", "totals", "children"]);
  const envelope = validateEnvelope(input.envelope);
  const ownership = validateOwnership(input.ownership);
  if (envelope.scope.level !== "campaign" || envelope.scope.ref !== ownership.campaignRef) fail("budget_owner_unresolved");
  if (!Array.isArray(input.children) || input.children.length === 0) fail("allocation_mismatch");

  const totals = normalizeState(input.totals, envelope.rounding);
  const allocatable = amount(envelope.allocatableDecimal, envelope.rounding);
  if (totals.units[0] !== allocatable.units) fail("allocation_mismatch");

  const seen = new Set<string>();
  const sums = [0n, 0n, 0n, 0n];
  let fixedSum = 0n;
  const normalizedChildren = input.children.map((child) => {
    exactKeys(child, ["child", "currency", "budgetOwner", "fixedDecimal", "state"]);
    exactKeys(child.child, ["level", "ref"]);
    exactKeys(child.budgetOwner, ["level", "ref"]);
    if (child.child.level !== "adset") fail("budget_owner_unresolved");
    const childRef = reference(child.child.ref);
    if (seen.has(childRef)) fail("duplicate_child");
    seen.add(childRef);
    if (currency(child.currency) !== envelope.currency) fail("currency_mismatch");

    const ownerRef = reference(child.budgetOwner.ref);
    if (ownership.mode === "CBO") {
      if (child.budgetOwner.level !== "campaign" || ownerRef !== ownership.campaignRef) fail("budget_owner_unresolved");
    } else if (child.budgetOwner.level !== "adset" || ownerRef !== childRef || !ownership.adsetRefs.includes(childRef)) {
      fail("budget_owner_unresolved");
    }

    const fixed = amount(child.fixedDecimal, envelope.rounding);
    const state = normalizeState(child.state, envelope.rounding);
    if (fixed.units > state.units[0]!) fail("invalid_envelope");
    fixedSum += fixed.units;
    state.units.forEach((value, index) => { sums[index] = sums[index]! + value; });
    return Object.freeze({
      child: Object.freeze({ level: "adset" as const, ref: childRef }),
      currency: envelope.currency,
      budgetOwner: Object.freeze({ level: child.budgetOwner.level, ref: ownerRef }),
      fixedDecimal: fixed.decimal,
      state: state.state,
    });
  });

  if (ownership.mode === "ABO") {
    const expected = new Set(ownership.adsetRefs);
    if (seen.size !== expected.size || [...seen].some((item) => !expected.has(item))) fail("budget_owner_unresolved");
  }
  if (fixedSum !== amount(envelope.fixedDecimal, envelope.rounding).units) fail("allocation_mismatch");
  if (sums.some((sum, index) => sum !== totals.units[index])) fail("allocation_mismatch");

  normalizedChildren.sort((left, right) => left.child.ref < right.child.ref ? -1 : left.child.ref > right.child.ref ? 1 : 0);
  const planned = totals.units[0]!;
  return Object.freeze({
    schemaVersion: "campaign-budget-reconciliation/1.0.0",
    status: "reconciled",
    envelope,
    ownership,
    totals: totals.state,
    children: Object.freeze(normalizedChildren),
    variance: Object.freeze({
      committedFromPlannedDecimal: formatUnits(totals.units[1]! - planned, envelope.rounding.scale),
      actualFromPlannedDecimal: formatUnits(totals.units[2]! - planned, envelope.rounding.scale),
      forecastFromPlannedDecimal: formatUnits(totals.units[3]! - planned, envelope.rounding.scale),
    }),
  });
}
