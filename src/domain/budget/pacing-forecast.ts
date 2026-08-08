export const BUDGET_PACING_FORECAST_VERSION = "budget-pacing-forecast/1.0.0" as const;

export type PacingSignalKind = "business_outcome" | "proxy";
export type PacingSuppressionReason =
  | "period_not_started"
  | "minimum_elapsed_not_met"
  | "stale_retrieval"
  | "insufficient_coverage"
  | "insufficient_sample"
  | "attribution_unsettled"
  | "learning_phase"
  | "cooldown_active"
  | "proxy_action_not_allowed";

export type PacingTrace = Readonly<{
  sequence: number;
  stage: "period" | "pace" | "forecast" | "signal" | "guard" | "result";
  code: string;
  disposition: "info" | "pass" | "suppress" | "cap";
  detail: string;
}>;

export type BudgetPacingInput = Readonly<{
  period: Readonly<{
    startDate: string;
    endDate: string;
    timezone: string;
  }>;
  asOfAt: string;
  amounts: Readonly<{
    currency: string;
    plannedDecimal: string;
    committedDecimal: string;
    actualDecimal: string;
    requestedCommitmentDecimal: string;
  }>;
  signal: Readonly<{
    kind: PacingSignalKind;
    metricRef: string;
    sampleSize: number;
    coverageBps: number;
    observedThroughAt: string;
    retrievedAt: string;
    learningPhase: boolean;
    lastMaterialChangeAt: string | null;
  }>;
  policy: Readonly<{
    moneyScale: number;
    moneyRounding: "down" | "up" | "half_up" | "half_even";
    minimumElapsedBps: number;
    conservativeRemainingRateBps: number;
    forecastMinimumDecimal: string;
    forecastMaximumDecimal: string;
    maximumFreshnessMinutes: number;
    minimumCoverageBps: number;
    minimumSampleSize: number;
    attributionLagMinutes: number;
    suppressDuringLearning: boolean;
    cooldownMinutes: number;
    allowProxyAction: boolean;
    maximumChangeBps: number;
    maximumChangeAbsoluteDecimal: string;
  }>;
}>;

export type BudgetPacingResult = Readonly<{
  schemaVersion: typeof BUDGET_PACING_FORECAST_VERSION;
  period: Readonly<{
    timezone: string;
    startAt: string;
    endExclusiveAt: string;
    elapsedMilliseconds: string;
    totalMilliseconds: string;
    elapsedBps: number;
  }>;
  amounts: Readonly<{
    currency: string;
    plannedDecimal: string;
    committedDecimal: string;
    actualDecimal: string;
    expectedToDateDecimal: string;
    paceVarianceDecimal: string;
    paceVarianceBps: number | null;
  }>;
  forecast: Readonly<{
    status: "available" | "period_not_started";
    linearDecimal: string | null;
    conservativeDecimal: string | null;
    minimumDecimal: string;
    maximumDecimal: string;
  }>;
  signal: Readonly<{
    kind: PacingSignalKind;
    metricRef: string;
    interpretation: "business_outcome" | "proxy_not_outcome";
  }>;
  adjustment: Readonly<{
    status: "allowed" | "capped" | "suppressed" | "no_change";
    requestedCommitmentDecimal: string;
    guardedCommitmentDecimal: string;
    guardedDeltaDecimal: string;
    suppressionReasons: readonly PacingSuppressionReason[];
    actionAuthority: "none";
  }>;
  trace: readonly PacingTrace[];
}>;

export class BudgetPacingError extends Error {
  constructor(readonly code: "invalid_contract" | "invalid_period" | "invalid_money" | "invalid_policy" | "invalid_observation") {
    super("Bütçe pacing değerlendirmesi güvenli biçimde üretilemedi");
    this.name = "BudgetPacingError";
  }
}

type ExactMoney = Readonly<{ units: bigint; scale: number }>;
type RoundingMode = BudgetPacingInput["policy"]["moneyRounding"];

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DECIMAL = /^(0|[1-9]\d{0,29})(?:\.(\d{1,18}))?$/;
const CURRENCY = /^[A-Z]{3}$/;
const REF = /^[a-z][a-z0-9_.:-]{0,127}$/;
const BPS_DENOMINATOR = 10_000n;

function fail(code: BudgetPacingError["code"]): never {
  throw new BudgetPacingError(code);
}

function exactKeys(value: unknown, keys: readonly string[], code: BudgetPacingError["code"]): void {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(code);
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) fail(code);
}

function assertInteger(value: unknown, minimum: number, maximum: number, code: BudgetPacingError["code"]): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) fail(code);
  return value as number;
}

function parseInstant(value: unknown): number {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) fail("invalid_observation");
  const epoch = Date.parse(value);
  if (!Number.isSafeInteger(epoch)) fail("invalid_observation");
  return epoch;
}

function calendarDate(value: unknown): Readonly<{ year: number; month: number; day: number; source: string }> {
  if (typeof value !== "string") fail("invalid_period");
  const match = DATE.exec(value);
  if (!match) fail("invalid_period");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) fail("invalid_period");
  return { year, month, day, source: value };
}

function nextDate(date: Readonly<{ year: number; month: number; day: number }>): Readonly<{ year: number; month: number; day: number }> {
  const next = new Date(Date.UTC(date.year, date.month - 1, date.day + 1));
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
}

function localParts(epoch: number, timezone: string): readonly number[] {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(epoch);
  const read = (kind: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === kind)?.value);
  return [read("year"), read("month"), read("day"), read("hour"), read("minute"), read("second")];
}

function zonedMidnight(date: Readonly<{ year: number; month: number; day: number }>, timezone: string): number {
  const desired = Date.UTC(date.year, date.month - 1, date.day);
  let candidate = desired;
  for (let index = 0; index < 3; index += 1) {
    const [year, month, day, hour, minute, second] = localParts(candidate, timezone);
    candidate += desired - Date.UTC(year!, month! - 1, day!, hour!, minute!, second!);
  }
  const [year, month, day, hour, minute, second] = localParts(candidate, timezone);
  if (year !== date.year || month !== date.month || day !== date.day || hour !== 0 || minute !== 0 || second !== 0) fail("invalid_period");
  return candidate;
}

function powerOfTen(scale: number): bigint {
  return 10n ** BigInt(scale);
}

function roundDivision(numerator: bigint, denominator: bigint, mode: RoundingMode): bigint {
  if (denominator <= 0n || numerator < 0n) fail("invalid_money");
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder === 0n || mode === "down") return quotient;
  if (mode === "up") return quotient + 1n;
  const doubled = remainder * 2n;
  if (doubled > denominator || (doubled === denominator && (mode === "half_up" || quotient % 2n !== 0n))) return quotient + 1n;
  return quotient;
}

function parseMoney(value: unknown, scale: number, mode: RoundingMode): ExactMoney {
  if (typeof value !== "string") fail("invalid_money");
  const match = DECIMAL.exec(value);
  if (!match) fail("invalid_money");
  const fraction = match[2] ?? "";
  let units = BigInt(`${match[1]}${fraction}`);
  if (fraction.length < scale) units *= powerOfTen(scale - fraction.length);
  if (fraction.length > scale) units = roundDivision(units, powerOfTen(fraction.length - scale), mode);
  return { units, scale };
}

function formatMoney(units: bigint, scale: number): string {
  const negative = units < 0n;
  const absolute = negative ? -units : units;
  if (scale === 0) return `${negative ? "-" : ""}${absolute}`;
  const padded = absolute.toString().padStart(scale + 1, "0");
  return `${negative ? "-" : ""}${padded.slice(0, -scale)}.${padded.slice(-scale)}`;
}

function clamp(value: bigint, minimum: bigint, maximum: bigint): bigint {
  return value < minimum ? minimum : value > maximum ? maximum : value;
}

function signedBps(numerator: bigint, denominator: bigint): number | null {
  if (denominator === 0n) return null;
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  const result = roundDivision(absolute * BPS_DENOMINATOR, denominator, "half_up");
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) fail("invalid_money");
  return Number(negative ? -result : result);
}

/**
 * Pure advisory pacing and forecast evaluation. No strategy defaults, writes,
 * persistence, Meta calls, or execution authority are present in this boundary.
 */
export function evaluateBudgetPacing(input: BudgetPacingInput): BudgetPacingResult {
  exactKeys(input, ["period", "asOfAt", "amounts", "signal", "policy"], "invalid_contract");
  exactKeys(input.period, ["startDate", "endDate", "timezone"], "invalid_contract");
  exactKeys(input.amounts, ["currency", "plannedDecimal", "committedDecimal", "actualDecimal", "requestedCommitmentDecimal"], "invalid_contract");
  exactKeys(input.signal, ["kind", "metricRef", "sampleSize", "coverageBps", "observedThroughAt", "retrievedAt", "learningPhase", "lastMaterialChangeAt"], "invalid_contract");
  exactKeys(input.policy, [
    "moneyScale", "moneyRounding", "minimumElapsedBps", "conservativeRemainingRateBps",
    "forecastMinimumDecimal", "forecastMaximumDecimal", "maximumFreshnessMinutes",
    "minimumCoverageBps", "minimumSampleSize", "attributionLagMinutes", "suppressDuringLearning",
    "cooldownMinutes", "allowProxyAction", "maximumChangeBps", "maximumChangeAbsoluteDecimal",
  ], "invalid_contract");

  const policy = input.policy;
  const scale = assertInteger(policy.moneyScale, 0, 12, "invalid_policy");
  if (!["down", "up", "half_up", "half_even"].includes(policy.moneyRounding)) fail("invalid_policy");
  const integerPolicies = [
    [policy.minimumElapsedBps, 0, 10_000], [policy.conservativeRemainingRateBps, 0, 10_000],
    [policy.maximumFreshnessMinutes, 0, 525_600], [policy.minimumCoverageBps, 0, 10_000],
    [policy.minimumSampleSize, 0, Number.MAX_SAFE_INTEGER], [policy.attributionLagMinutes, 0, 525_600],
    [policy.cooldownMinutes, 0, 525_600], [policy.maximumChangeBps, 0, 10_000],
  ] as const;
  integerPolicies.forEach(([value, minimum, maximum]) => assertInteger(value, minimum, maximum, "invalid_policy"));
  if (typeof policy.suppressDuringLearning !== "boolean" || typeof policy.allowProxyAction !== "boolean") fail("invalid_policy");

  const startDate = calendarDate(input.period.startDate);
  const endDate = calendarDate(input.period.endDate);
  if (endDate.source < startDate.source || typeof input.period.timezone !== "string" || !input.period.timezone) fail("invalid_period");
  try {
    new Intl.DateTimeFormat("en", { timeZone: input.period.timezone }).format(0);
  } catch {
    fail("invalid_period");
  }
  const startAt = zonedMidnight(startDate, input.period.timezone);
  const endAt = zonedMidnight(nextDate(endDate), input.period.timezone);
  const asOfAt = parseInstant(input.asOfAt);
  if (asOfAt > endAt || endAt <= startAt) fail("invalid_period");
  const elapsed = BigInt(Math.max(0, asOfAt - startAt));
  const total = BigInt(endAt - startAt);
  const elapsedBps = Number((elapsed * BPS_DENOMINATOR) / total);

  if (!CURRENCY.test(input.amounts.currency)) fail("invalid_money");
  const planned = parseMoney(input.amounts.plannedDecimal, scale, policy.moneyRounding);
  const committed = parseMoney(input.amounts.committedDecimal, scale, policy.moneyRounding);
  const actual = parseMoney(input.amounts.actualDecimal, scale, policy.moneyRounding);
  const requested = parseMoney(input.amounts.requestedCommitmentDecimal, scale, policy.moneyRounding);
  const forecastMinimum = parseMoney(policy.forecastMinimumDecimal, scale, policy.moneyRounding);
  const forecastMaximum = parseMoney(policy.forecastMaximumDecimal, scale, policy.moneyRounding);
  const maximumAbsoluteChange = parseMoney(policy.maximumChangeAbsoluteDecimal, scale, policy.moneyRounding);
  if (forecastMinimum.units > forecastMaximum.units) fail("invalid_policy");

  const expected = roundDivision(planned.units * elapsed, total, policy.moneyRounding);
  const variance = actual.units - expected;
  const trace: PacingTrace[] = [];
  const addTrace = (stage: PacingTrace["stage"], code: string, disposition: PacingTrace["disposition"], detail: string) => {
    trace.push({ sequence: trace.length + 1, stage, code, disposition, detail });
  };
  addTrace("period", "elapsed_calculated", "info", `elapsed_bps=${elapsedBps};timezone=${input.period.timezone}`);
  addTrace("pace", "variance_calculated", "info", `pace_variance_bps=${signedBps(variance, expected) ?? "not_applicable"}`);

  let linear: bigint | null = null;
  let conservative: bigint | null = null;
  if (elapsed > 0n) {
    linear = clamp(roundDivision(actual.units * total, elapsed, policy.moneyRounding), forecastMinimum.units, forecastMaximum.units);
    const projectedRemaining = linear > actual.units ? linear - actual.units : 0n;
    conservative = clamp(
      actual.units + roundDivision(projectedRemaining * BigInt(policy.conservativeRemainingRateBps), BPS_DENOMINATOR, policy.moneyRounding),
      forecastMinimum.units,
      forecastMaximum.units,
    );
    addTrace("forecast", "bounded_forecasts_calculated", "info", "linear_and_conservative_forecasts_bounded");
  } else {
    addTrace("forecast", "period_not_started", "suppress", "forecast_requires_positive_elapsed_time");
  }

  if (!["business_outcome", "proxy"].includes(input.signal.kind) || !REF.test(input.signal.metricRef)) fail("invalid_observation");
  const sampleSize = assertInteger(input.signal.sampleSize, 0, Number.MAX_SAFE_INTEGER, "invalid_observation");
  const coverageBps = assertInteger(input.signal.coverageBps, 0, 10_000, "invalid_observation");
  if (typeof input.signal.learningPhase !== "boolean") fail("invalid_observation");
  const observedThroughAt = parseInstant(input.signal.observedThroughAt);
  const retrievedAt = parseInstant(input.signal.retrievedAt);
  if (observedThroughAt > retrievedAt || retrievedAt > asOfAt) fail("invalid_observation");
  const lastMaterialChangeAt = input.signal.lastMaterialChangeAt === null ? null : parseInstant(input.signal.lastMaterialChangeAt);
  if (lastMaterialChangeAt !== null && lastMaterialChangeAt > asOfAt) fail("invalid_observation");
  addTrace("signal", input.signal.kind === "business_outcome" ? "business_outcome_signal" : "proxy_signal_not_outcome", "info", `metric_ref=${input.signal.metricRef}`);

  const suppressions: PacingSuppressionReason[] = [];
  const suppressWhen = (condition: boolean, reason: PacingSuppressionReason, detail: string) => {
    if (condition) {
      suppressions.push(reason);
      addTrace("guard", reason, "suppress", detail);
    } else {
      addTrace("guard", `${reason}_passed`, "pass", detail);
    }
  };
  suppressWhen(elapsed === 0n, "period_not_started", "positive_elapsed_required");
  suppressWhen(elapsedBps < policy.minimumElapsedBps, "minimum_elapsed_not_met", `minimum_elapsed_bps=${policy.minimumElapsedBps}`);
  suppressWhen(asOfAt - retrievedAt > policy.maximumFreshnessMinutes * 60_000, "stale_retrieval", `maximum_freshness_minutes=${policy.maximumFreshnessMinutes}`);
  suppressWhen(coverageBps < policy.minimumCoverageBps, "insufficient_coverage", `minimum_coverage_bps=${policy.minimumCoverageBps}`);
  suppressWhen(sampleSize < policy.minimumSampleSize, "insufficient_sample", `minimum_sample_size=${policy.minimumSampleSize}`);
  suppressWhen(
    input.signal.kind === "business_outcome" && asOfAt - observedThroughAt < policy.attributionLagMinutes * 60_000,
    "attribution_unsettled",
    `attribution_lag_minutes=${policy.attributionLagMinutes}`,
  );
  suppressWhen(policy.suppressDuringLearning && input.signal.learningPhase, "learning_phase", `suppression_enabled=${policy.suppressDuringLearning}`);
  suppressWhen(
    lastMaterialChangeAt !== null && asOfAt - lastMaterialChangeAt < policy.cooldownMinutes * 60_000,
    "cooldown_active",
    `cooldown_minutes=${policy.cooldownMinutes}`,
  );
  suppressWhen(input.signal.kind === "proxy" && !policy.allowProxyAction, "proxy_action_not_allowed", `allow_proxy_action=${policy.allowProxyAction}`);

  const requestedDelta = requested.units - committed.units;
  const percentLimit = roundDivision(committed.units * BigInt(policy.maximumChangeBps), BPS_DENOMINATOR, "down");
  const changeLimit = percentLimit < maximumAbsoluteChange.units ? percentLimit : maximumAbsoluteChange.units;
  let guarded = requested.units;
  let status: BudgetPacingResult["adjustment"]["status"] = requestedDelta === 0n ? "no_change" : "allowed";
  if (suppressions.length > 0) {
    guarded = committed.units;
    status = "suppressed";
    addTrace("result", "adjustment_suppressed", "suppress", `suppression_count=${suppressions.length}`);
  } else if (requestedDelta > changeLimit) {
    guarded = committed.units + changeLimit;
    status = "capped";
    addTrace("guard", "maximum_increase_applied", "cap", `maximum_change_bps=${policy.maximumChangeBps}`);
  } else if (requestedDelta < -changeLimit) {
    guarded = committed.units - changeLimit;
    status = "capped";
    addTrace("guard", "maximum_decrease_applied", "cap", `maximum_change_bps=${policy.maximumChangeBps}`);
  } else {
    addTrace("guard", "maximum_change_passed", "pass", `maximum_change_bps=${policy.maximumChangeBps}`);
  }
  if (status !== "suppressed") addTrace("result", status === "capped" ? "adjustment_capped" : status === "no_change" ? "no_change" : "adjustment_allowed", status === "capped" ? "cap" : "pass", "action_authority=none");

  return Object.freeze({
    schemaVersion: BUDGET_PACING_FORECAST_VERSION,
    period: Object.freeze({
      timezone: input.period.timezone,
      startAt: new Date(startAt).toISOString(),
      endExclusiveAt: new Date(endAt).toISOString(),
      elapsedMilliseconds: elapsed.toString(),
      totalMilliseconds: total.toString(),
      elapsedBps,
    }),
    amounts: Object.freeze({
      currency: input.amounts.currency,
      plannedDecimal: formatMoney(planned.units, scale),
      committedDecimal: formatMoney(committed.units, scale),
      actualDecimal: formatMoney(actual.units, scale),
      expectedToDateDecimal: formatMoney(expected, scale),
      paceVarianceDecimal: formatMoney(variance, scale),
      paceVarianceBps: signedBps(variance, expected),
    }),
    forecast: Object.freeze({
      status: elapsed === 0n ? "period_not_started" : "available",
      linearDecimal: linear === null ? null : formatMoney(linear, scale),
      conservativeDecimal: conservative === null ? null : formatMoney(conservative, scale),
      minimumDecimal: formatMoney(forecastMinimum.units, scale),
      maximumDecimal: formatMoney(forecastMaximum.units, scale),
    }),
    signal: Object.freeze({
      kind: input.signal.kind,
      metricRef: input.signal.metricRef,
      interpretation: input.signal.kind === "business_outcome" ? "business_outcome" : "proxy_not_outcome",
    }),
    adjustment: Object.freeze({
      status,
      requestedCommitmentDecimal: formatMoney(requested.units, scale),
      guardedCommitmentDecimal: formatMoney(guarded, scale),
      guardedDeltaDecimal: formatMoney(guarded - committed.units, scale),
      suppressionReasons: Object.freeze([...suppressions]),
      actionAuthority: "none",
    }),
    trace: Object.freeze(trace.map((item) => Object.freeze(item))),
  });
}
