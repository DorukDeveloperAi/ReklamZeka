import { createHash } from "node:crypto";
import type { AnalysisMetric } from "@/analyses/schema";
import {
  type ResolvedAnalysisTimeframe,
  validateResolvedAnalysisTimeframe,
} from "@/analyses/timeframe-resolver";
import { inspectMetaPersistenceWrite } from "@/domain/meta/data-lifecycle";
import {
  META_METRIC_FORMULA_CATALOG,
  META_METRIC_FORMULA_CATALOG_VERSION,
  type MetaMetricAggregationResult,
  type MetaMetricUnknownReason,
} from "@/domain/meta/insights/metric-engine";

export const DETERMINISTIC_FINDING_CALCULATOR_VERSION = "deterministic-finding-calculators/1.0.0" as const;

export type FindingEntityType = "campaign" | "ad_set" | "ad";
export type FindingWindowRole = "primary" | "comparison" | "series" | "pre" | "post";
export type FindingState = "finding" | "clear" | "insufficient_data" | "settling";
export type FindingReasonCode =
  | "condition_met"
  | "condition_not_met"
  | "metric_missing"
  | `metric_${MetaMetricUnknownReason}`
  | "minimum_sample_not_met"
  | "minimum_points_not_met"
  | "window_settling"
  | "data_quality_degraded"
  | "timeframe_mismatch"
  | "comparison_unavailable"
  | "invalid_metric_result"
  | "invalid_configuration"
  | "zero_baseline"
  | "zero_variance_baseline";

export type FindingObservation = Readonly<{
  observationRef: string;
  role: FindingWindowRole;
  startDate: string;
  endDate: string;
  timezone: string;
  sampleSize: number;
  settled: boolean;
  qualityStatus: "ready" | "degraded";
  qualityReasonCodes: readonly string[];
  metricResult: MetaMetricAggregationResult;
  snapshotRefs: readonly string[];
}>;

type Direction = "increase" | "decrease" | "either";
type ComparisonBase = Readonly<{
  metric: AnalysisMetric;
  direction: Direction;
  minimumRelativeChange: number;
  minimumSample: number;
}>;

export type FindingCalculatorSpec =
  | (ComparisonBase & Readonly<{ kind: "trend"; minimumPoints: number }>)
  | Readonly<{ kind: "anomaly"; metric: AnalysisMetric; minimumAbsoluteZScore: number; minimumBaselinePoints: number; minimumSample: number }>
  | Readonly<{ kind: "pacing"; metric: "spendMinor"; plannedTotalDecimal: string; elapsedFraction: number; toleranceFraction: number; direction: Direction; minimumSample: number }>
  | Readonly<{ kind: "threshold"; metric: AnalysisMetric; operator: "gt" | "gte" | "lt" | "lte"; thresholdDecimal: string; minimumSample: number }>
  | (ComparisonBase & Readonly<{ kind: "period_comparison" }>)
  | (ComparisonBase & Readonly<{ kind: "pre_post"; actionDate: string; minimumSettledPostDays: number }>);

export type DeterministicFindingInput = Readonly<{
  entityRef: string;
  entityType: FindingEntityType;
  parentEntityRef: string | null;
  hierarchyPathRefs: readonly string[];
  driverEvidenceRefs: readonly string[];
  timeframe: ResolvedAnalysisTimeframe;
  spec: FindingCalculatorSpec;
  observations: readonly FindingObservation[];
}>;

export type FindingEvidence = Readonly<{
  entityRef: string;
  entityType: FindingEntityType;
  parentEntityRef: string | null;
  hierarchyPathRefs: readonly string[];
  driverEvidenceRefs: readonly string[];
  metric: AnalysisMetric;
  aggregation: "additive" | "non_additive" | "derived";
  timezone: string;
  primaryWindow: Readonly<{ startDate: string; endDate: string }>;
  comparisonWindow: Readonly<{ startDate: string; endDate: string }> | null;
  observationRefs: readonly string[];
  snapshotRefs: readonly string[];
  metricResultHashes: readonly string[];
  observedValueDecimal: string | null;
  baselineValueDecimal: string | null;
  effectValueDecimal: string | null;
  sampleSizes: readonly number[];
  qualityReasonCodes: readonly string[];
}>;

export type DeterministicFinding = Readonly<{
  calculatorVersion: typeof DETERMINISTIC_FINDING_CALCULATOR_VERSION;
  findingRef: string;
  inputHash: string;
  kind: FindingCalculatorSpec["kind"];
  state: FindingState;
  reasonCode: FindingReasonCode;
  evidence: FindingEvidence;
}>;

export type DeterministicFindingErrorCode =
  | "invalid_contract"
  | "forbidden_material"
  | "invalid_metric_result";

export class DeterministicFindingCalculatorError extends Error {
  constructor(readonly code: DeterministicFindingErrorCode, message: string) {
    super(message);
    this.name = "DeterministicFindingCalculatorError";
  }
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DECIMAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;
const REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const DAY_MS = 86_400_000;

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compare(left, right))
      .map(([key, child]) => [key, stableValue(child)]));
  }
  return value;
}

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exact(value: unknown, keys: readonly string[], label: string): void {
  if (!isRecord(value)) fail("invalid_contract", `${label} object olmalıdır`);
  const unexpected = Object.keys(value).filter((key) => !keys.includes(key));
  if (unexpected.length > 0) fail("invalid_contract", `${label} bilinmeyen alan taşıyor: ${unexpected.join(", ")}`);
  const missing = keys.filter((key) => !(key in value));
  if (missing.length > 0) fail("invalid_contract", `${label} eksik alan taşıyor: ${missing.join(", ")}`);
}

function fail(code: DeterministicFindingErrorCode, message: string): never {
  throw new DeterministicFindingCalculatorError(code, message);
}

function assertRef(value: unknown, label: string): asserts value is string {
  if (typeof value !== "string" || !REF_PATTERN.test(value)) fail("invalid_contract", `${label} geçersiz ref`);
}

function parseDate(value: string): number {
  if (!DATE_PATTERN.test(value)) fail("invalid_contract", "Geçersiz takvim tarihi");
  const time = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value) fail("invalid_contract", "Geçersiz takvim tarihi");
  return time;
}

function days(startDate: string, endDate: string): number {
  return Math.round((parseDate(endDate) - parseDate(startDate)) / DAY_MS) + 1;
}

function decimal(value: unknown, code: DeterministicFindingErrorCode = "invalid_contract"): number {
  if (typeof value !== "string") fail(code, "Decimal string olmalıdır");
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match || !DECIMAL_PATTERN.test(value)) fail(code, "Geçersiz decimal değer");
  const fraction = match[3] ?? "";
  if (fraction.length > 12) fail(code, "Decimal desteklenen 12 basamak hassasiyetini aşıyor");
  const coefficient = BigInt(`${match[1] ?? ""}${match[2]}${fraction}`);
  if (coefficient > BigInt(Number.MAX_SAFE_INTEGER) || coefficient < BigInt(Number.MIN_SAFE_INTEGER)) {
    fail(code, "Decimal güvenli hesaplama aralığı dışında");
  }
  const parsed = Number(coefficient) / 10 ** fraction.length;
  if (!Number.isFinite(parsed) || Math.abs(parsed) > Number.MAX_SAFE_INTEGER) fail(code, "Decimal güvenli hesaplama aralığı dışında");
  return parsed;
}

function format(value: number): string {
  if (!Number.isFinite(value)) fail("invalid_contract", "Hesaplanan değer sonlu değil");
  const rounded = Math.round((value + Number.EPSILON) * 1e12) / 1e12;
  return Object.is(rounded, -0) ? "0" : rounded.toString();
}

function authenticate(result: MetaMetricAggregationResult): boolean {
  return result.catalogVersion === META_METRIC_FORMULA_CATALOG_VERSION
    && hash({ catalogVersion: result.catalogVersion, metrics: result.metrics }) === result.resultHash;
}

function availableMetric(observation: FindingObservation, metric: AnalysisMetric): Readonly<{
  value: number;
  valueDecimal: string;
}> | FindingReasonCode {
  if (!authenticate(observation.metricResult)) return "invalid_metric_result";
  const item = observation.metricResult.metrics.find((candidate) => candidate.metric === metric);
  if (!item) return "metric_missing";
  if (item.status === "unknown") return `metric_${item.reason}`;
  return { value: decimal(item.valueDecimal, "invalid_metric_result"), valueDecimal: item.valueDecimal };
}

function validateSpec(spec: FindingCalculatorSpec): void {
  exact(spec, [
    "kind", "metric", "minimumSample", "direction", "minimumRelativeChange", "minimumPoints",
    "minimumAbsoluteZScore", "minimumBaselinePoints", "plannedTotalDecimal", "elapsedFraction",
    "toleranceFraction", "operator", "thresholdDecimal", "actionDate", "minimumSettledPostDays",
  ].filter((key) => key in spec), "spec");
  const common = ["kind", "metric", "minimumSample"];
  const keys: Record<FindingCalculatorSpec["kind"], readonly string[]> = {
    trend: [...common, "direction", "minimumRelativeChange", "minimumPoints"],
    anomaly: [...common, "minimumAbsoluteZScore", "minimumBaselinePoints"],
    pacing: [...common, "plannedTotalDecimal", "elapsedFraction", "toleranceFraction", "direction"],
    threshold: [...common, "operator", "thresholdDecimal"],
    period_comparison: [...common, "direction", "minimumRelativeChange"],
    pre_post: [...common, "direction", "minimumRelativeChange", "actionDate", "minimumSettledPostDays"],
  };
  if (typeof spec.kind !== "string" || !(spec.kind in keys)) fail("invalid_contract", "Bilinmeyen calculator kind");
  exact(spec, keys[spec.kind]!, "spec");
  if (!Number.isSafeInteger(spec.minimumSample) || spec.minimumSample < 1) fail("invalid_contract", "minimumSample pozitif tam sayı olmalıdır");
  if (typeof spec.metric !== "string" || !(spec.metric in META_METRIC_FORMULA_CATALOG)) fail("invalid_contract", "Bilinmeyen metrik");
  if (spec.kind === "trend") {
    if (!["increase", "decrease", "either"].includes(spec.direction) || !Number.isSafeInteger(spec.minimumPoints) || spec.minimumPoints < 2 || !Number.isFinite(spec.minimumRelativeChange) || spec.minimumRelativeChange < 0) fail("invalid_contract", "Trend konfigürasyonu geçersiz");
  } else if (spec.kind === "anomaly") {
    if (!Number.isSafeInteger(spec.minimumBaselinePoints) || spec.minimumBaselinePoints < 2 || !Number.isFinite(spec.minimumAbsoluteZScore) || spec.minimumAbsoluteZScore <= 0) fail("invalid_contract", "Anomaly konfigürasyonu geçersiz");
  } else if (spec.kind === "pacing") {
    decimal(spec.plannedTotalDecimal);
    if (spec.metric !== "spendMinor" || !["increase", "decrease", "either"].includes(spec.direction) || decimal(spec.plannedTotalDecimal) <= 0 || !Number.isFinite(spec.elapsedFraction) || spec.elapsedFraction < 0 || spec.elapsedFraction > 1 || !Number.isFinite(spec.toleranceFraction) || spec.toleranceFraction < 0) fail("invalid_contract", "Pacing konfigürasyonu geçersiz");
  } else if (spec.kind === "threshold") {
    if (!["gt", "gte", "lt", "lte"].includes(spec.operator)) fail("invalid_contract", "Threshold operator geçersiz");
    decimal(spec.thresholdDecimal);
  } else {
    if (!["increase", "decrease", "either"].includes(spec.direction) || !Number.isFinite(spec.minimumRelativeChange) || spec.minimumRelativeChange < 0) fail("invalid_contract", "minimumRelativeChange negatif olamaz");
    if (spec.kind === "pre_post") {
      parseDate(spec.actionDate);
      if (!Number.isInteger(spec.minimumSettledPostDays) || spec.minimumSettledPostDays < 1) fail("invalid_contract", "minimumSettledPostDays pozitif tam sayı olmalıdır");
    }
  }
}

function validateInput(input: DeterministicFindingInput): void {
  if (!inspectMetaPersistenceWrite(input).compliant) fail("forbidden_material", "Finding girdisi yasak ham veri veya kimlik bilgisi taşıyor");
  exact(input, ["entityRef", "entityType", "parentEntityRef", "hierarchyPathRefs", "driverEvidenceRefs", "timeframe", "spec", "observations"], "input");
  assertRef(input.entityRef, "entityRef");
  if (!["campaign", "ad_set", "ad"].includes(input.entityType)) fail("invalid_contract", "entityType geçersiz");
  if (input.entityType === "campaign" && input.parentEntityRef !== null) fail("invalid_contract", "Campaign parent taşıyamaz");
  if (input.entityType !== "campaign") assertRef(input.parentEntityRef, "parentEntityRef");
  if (!Array.isArray(input.hierarchyPathRefs) || !Array.isArray(input.driverEvidenceRefs) || !Array.isArray(input.observations)) fail("invalid_contract", "Ref ve observation koleksiyonları array olmalıdır");
  input.hierarchyPathRefs.forEach((ref) => assertRef(ref, "hierarchyPathRef"));
  input.driverEvidenceRefs.forEach((ref) => assertRef(ref, "driverEvidenceRef"));
  if (!isRecord(input.timeframe)) fail("invalid_contract", "timeframe object olmalıdır");
  try {
    validateResolvedAnalysisTimeframe(input.timeframe);
  } catch {
    fail("invalid_contract", "Resolved timeframe runtime şekli veya bağları geçersiz");
  }
  if (!isRecord(input.spec)) fail("invalid_contract", "spec object olmalıdır");
  validateSpec(input.spec);
  const allowedRoles: Readonly<Record<FindingCalculatorSpec["kind"], readonly FindingWindowRole[]>> = {
    threshold: ["primary"],
    pacing: ["primary"],
    period_comparison: ["primary", "comparison"],
    pre_post: ["pre", "post"],
    trend: ["series"],
    anomaly: ["series"],
  };
  const observationRefs = new Set<string>();
  const roleCounts = new Map<FindingWindowRole, number>();
  const seriesDates = new Set<string>();
  for (const observation of input.observations) {
    exact(observation, ["observationRef", "role", "startDate", "endDate", "timezone", "sampleSize", "settled", "qualityStatus", "qualityReasonCodes", "metricResult", "snapshotRefs"], "observation");
    assertRef(observation.observationRef, "observationRef");
    if (observationRefs.has(observation.observationRef)) fail("invalid_contract", "observationRef tekrar edemez");
    observationRefs.add(observation.observationRef);
    if (!["primary", "comparison", "series", "pre", "post"].includes(observation.role)) fail("invalid_contract", "Observation role geçersiz");
    if (!allowedRoles[input.spec.kind].includes(observation.role)) fail("invalid_contract", "Calculator kind için observation role geçersiz");
    roleCounts.set(observation.role, (roleCounts.get(observation.role) ?? 0) + 1);
    if (observation.role !== "series" && roleCounts.get(observation.role)! > 1) fail("invalid_contract", "Tekil observation role tekrar edemez");
    if (typeof observation.startDate !== "string" || typeof observation.endDate !== "string" || typeof observation.timezone !== "string") fail("invalid_contract", "Observation tarih ve timezone alanları string olmalıdır");
    parseDate(observation.startDate);
    parseDate(observation.endDate);
    if (observation.startDate > observation.endDate) fail("invalid_contract", "Observation tarih sırası geçersiz");
    if (observation.role === "series") {
      if (seriesDates.has(observation.startDate)) fail("invalid_contract", "Series aynı başlangıç tarihi için birden çok nokta taşıyamaz");
      seriesDates.add(observation.startDate);
    }
    if (!Number.isSafeInteger(observation.sampleSize) || observation.sampleSize < 0) fail("invalid_contract", "sampleSize geçersiz");
    if (typeof observation.settled !== "boolean" || !["ready", "degraded"].includes(observation.qualityStatus)) fail("invalid_contract", "Observation quality geçersiz");
    if (!Array.isArray(observation.qualityReasonCodes) || !Array.isArray(observation.snapshotRefs)) fail("invalid_contract", "Observation reason ve snapshot koleksiyonları array olmalıdır");
    observation.qualityReasonCodes.forEach((reason: unknown) => assertRef(reason, "qualityReasonCode"));
    observation.snapshotRefs.forEach((ref: unknown) => assertRef(ref, "snapshotRef"));
    exact(observation.metricResult, ["catalogVersion", "metrics", "resultHash"], "metricResult");
    if (!Array.isArray(observation.metricResult.metrics) || typeof observation.metricResult.resultHash !== "string" || !/^[a-f0-9]{64}$/.test(observation.metricResult.resultHash)) fail("invalid_metric_result", "Metric result runtime şekli geçersiz");
    for (const item of observation.metricResult.metrics) {
      if (!isRecord(item) || typeof item.metric !== "string" || !(item.metric in META_METRIC_FORMULA_CATALOG)
        || !["available", "unknown"].includes(String(item.status)) || !isRecord(item.provenance)) {
        fail("invalid_metric_result", "Metric item runtime şekli geçersiz");
      }
      if (item.status === "available") decimal(item.valueDecimal, "invalid_metric_result");
    }
    if (!authenticate(observation.metricResult)) fail("invalid_metric_result", "Metric result hash doğrulanamadı");
  }
}

function qualityReason(observations: readonly FindingObservation[], minimumSample: number): FindingReasonCode | null {
  if (observations.some((item) => !item.settled)) return "window_settling";
  if (observations.some((item) => item.qualityStatus === "degraded")) return "data_quality_degraded";
  if (observations.some((item) => item.sampleSize < minimumSample)) return "minimum_sample_not_met";
  return null;
}

function directionMatches(value: number, minimum: number, direction: Direction): boolean {
  if (direction === "increase") return value >= minimum;
  if (direction === "decrease") return value <= -minimum;
  return Math.abs(value) >= minimum;
}

function primaryBinding(observation: FindingObservation, timeframe: ResolvedAnalysisTimeframe): boolean {
  return observation.timezone === timeframe.timezone
    && observation.startDate === timeframe.startDate
    && observation.endDate === timeframe.endDate;
}

function comparisonBinding(observation: FindingObservation, timeframe: ResolvedAnalysisTimeframe): boolean {
  return timeframe.comparisonPolicy !== "none"
    && observation.timezone === timeframe.timezone
    && observation.startDate === timeframe.comparisonStartDate
    && observation.endDate === timeframe.comparisonEndDate;
}

type Evaluation = Readonly<{
  state: FindingState;
  reasonCode: FindingReasonCode;
  observed: string | null;
  baseline: string | null;
  effect: string | null;
  used: readonly FindingObservation[];
}>;

function stopped(reasonCode: FindingReasonCode, used: readonly FindingObservation[]): Evaluation {
  return { state: reasonCode === "window_settling" ? "settling" : "insufficient_data", reasonCode, observed: null, baseline: null, effect: null, used };
}

function result(matched: boolean, observed: string, baseline: string | null, effect: string | null, used: readonly FindingObservation[]): Evaluation {
  return { state: matched ? "finding" : "clear", reasonCode: matched ? "condition_met" : "condition_not_met", observed, baseline, effect, used };
}

function compareWindows(input: DeterministicFindingInput, left: FindingObservation | undefined, right: FindingObservation | undefined): Evaluation {
  if (!left || !right) return stopped("comparison_unavailable", [left, right].filter(Boolean) as FindingObservation[]);
  const used = [left, right];
  const issue = qualityReason(used, input.spec.minimumSample);
  if (issue) return stopped(issue, used);
  const observed = availableMetric(left, input.spec.metric);
  const baseline = availableMetric(right, input.spec.metric);
  if (typeof observed === "string") return stopped(observed, used);
  if (typeof baseline === "string") return stopped(baseline, used);
  if (baseline.value === 0) return stopped("zero_baseline", used);
  const effect = (observed.value - baseline.value) / Math.abs(baseline.value);
  const spec = input.spec as Extract<FindingCalculatorSpec, { kind: "period_comparison" | "pre_post" }>;
  return result(directionMatches(effect, spec.minimumRelativeChange, spec.direction), observed.valueDecimal, baseline.valueDecimal, format(effect), used);
}

function evaluate(input: DeterministicFindingInput): Evaluation {
  const { spec, observations, timeframe } = input;
  if (observations.some((item) => item.timezone !== timeframe.timezone)) return stopped("timeframe_mismatch", observations);

  if (spec.kind === "threshold") {
    const primary = observations.find((item) => item.role === "primary");
    if (!primary || !primaryBinding(primary, timeframe)) return stopped("timeframe_mismatch", primary ? [primary] : []);
    const issue = qualityReason([primary], spec.minimumSample);
    if (issue) return stopped(issue, [primary]);
    const metric = availableMetric(primary, spec.metric);
    if (typeof metric === "string") return stopped(metric, [primary]);
    const threshold = decimal(spec.thresholdDecimal);
    const matched = spec.operator === "gt" ? metric.value > threshold
      : spec.operator === "gte" ? metric.value >= threshold
        : spec.operator === "lt" ? metric.value < threshold : metric.value <= threshold;
    return result(matched, metric.valueDecimal, spec.thresholdDecimal, format(metric.value - threshold), [primary]);
  }

  if (spec.kind === "pacing") {
    const primary = observations.find((item) => item.role === "primary");
    if (!primary || !primaryBinding(primary, timeframe)) return stopped("timeframe_mismatch", primary ? [primary] : []);
    if (META_METRIC_FORMULA_CATALOG[spec.metric].aggregation !== "additive") return stopped("invalid_configuration", [primary]);
    if (spec.elapsedFraction === 0) return stopped("window_settling", [primary]);
    const issue = qualityReason([primary], spec.minimumSample);
    if (issue) return stopped(issue, [primary]);
    const metric = availableMetric(primary, spec.metric);
    if (typeof metric === "string") return stopped(metric, [primary]);
    const expected = decimal(spec.plannedTotalDecimal) * spec.elapsedFraction;
    const effect = (metric.value - expected) / expected;
    return result(directionMatches(effect, spec.toleranceFraction, spec.direction), metric.valueDecimal, format(expected), format(effect), [primary]);
  }

  if (spec.kind === "period_comparison") {
    const primary = observations.find((item) => item.role === "primary");
    const comparison = observations.find((item) => item.role === "comparison");
    if (!primary || !comparison || !primaryBinding(primary, timeframe) || !comparisonBinding(comparison, timeframe)) {
      return stopped(timeframe.comparisonPolicy === "none" ? "comparison_unavailable" : "timeframe_mismatch", [primary, comparison].filter(Boolean) as FindingObservation[]);
    }
    return compareWindows(input, primary, comparison);
  }

  if (spec.kind === "pre_post") {
    const pre = observations.find((item) => item.role === "pre");
    const post = observations.find((item) => item.role === "post");
    if (!pre || !post) return stopped("comparison_unavailable", [pre, post].filter(Boolean) as FindingObservation[]);
    const expectedPreEnd = new Date(parseDate(spec.actionDate) - DAY_MS).toISOString().slice(0, 10);
    if (timeframe.kind !== "action_relative" || pre.startDate !== timeframe.startDate || pre.endDate !== expectedPreEnd
      || post.startDate !== spec.actionDate || post.endDate !== timeframe.endDate) return stopped("timeframe_mismatch", [pre, post]);
    if (days(post.startDate, post.endDate) < spec.minimumSettledPostDays) return stopped("window_settling", [pre, post]);
    return compareWindows(input, post, pre);
  }

  const series = observations.filter((item) => item.role === "series").sort((left, right) => compare(left.startDate, right.startDate));
  if (series.some((item) => item.startDate !== item.endDate || item.startDate < timeframe.startDate || item.endDate > timeframe.endDate)) {
    return stopped("timeframe_mismatch", series);
  }
  const issue = qualityReason(series, spec.minimumSample);
  if (issue) return stopped(issue, series);
  const required = spec.kind === "trend" ? spec.minimumPoints : spec.minimumBaselinePoints + 1;
  if (series.length < required) return stopped("minimum_points_not_met", series);
  const values: Array<Readonly<{ decimal: string; value: number }>> = [];
  for (const observation of series) {
    const metric = availableMetric(observation, spec.metric);
    if (typeof metric === "string") return stopped(metric, series);
    values.push({ decimal: metric.valueDecimal, value: metric.value });
  }

  if (spec.kind === "trend") {
    const first = values[0]!;
    const last = values.at(-1)!;
    if (first.value === 0) return stopped("zero_baseline", series);
    const effect = (last.value - first.value) / Math.abs(first.value);
    return result(directionMatches(effect, spec.minimumRelativeChange, spec.direction), last.decimal, first.decimal, format(effect), series);
  }

  const current = values.at(-1)!;
  const baseline = values.slice(0, -1);
  const mean = baseline.reduce((sum, item) => sum + item.value, 0) / baseline.length;
  const variance = baseline.reduce((sum, item) => sum + (item.value - mean) ** 2, 0) / baseline.length;
  if (variance === 0) return stopped("zero_variance_baseline", series);
  const zScore = (current.value - mean) / Math.sqrt(variance);
  return result(Math.abs(zScore) >= spec.minimumAbsoluteZScore, current.decimal, format(mean), format(zScore), series);
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort(compare));
}

export function calculateDeterministicFinding(input: DeterministicFindingInput): DeterministicFinding {
  validateInput(input);
  const inputHash = hash({
    ...input,
    hierarchyPathRefs: uniqueSorted(input.hierarchyPathRefs),
    driverEvidenceRefs: uniqueSorted(input.driverEvidenceRefs),
    observations: [...input.observations]
      .sort((left, right) => compare(left.observationRef, right.observationRef))
      .map((observation) => ({
        ...observation,
        qualityReasonCodes: uniqueSorted(observation.qualityReasonCodes),
        snapshotRefs: uniqueSorted(observation.snapshotRefs),
      })),
  });
  const evaluated = evaluate(input);
  const used = evaluated.used;
  const evidence: FindingEvidence = Object.freeze({
    entityRef: input.entityRef,
    entityType: input.entityType,
    parentEntityRef: input.parentEntityRef,
    hierarchyPathRefs: uniqueSorted(input.hierarchyPathRefs),
    driverEvidenceRefs: uniqueSorted(input.driverEvidenceRefs),
    metric: input.spec.metric,
    aggregation: META_METRIC_FORMULA_CATALOG[input.spec.metric].aggregation,
    timezone: input.timeframe.timezone,
    primaryWindow: Object.freeze({ startDate: input.timeframe.startDate, endDate: input.timeframe.endDate }),
    comparisonWindow: input.timeframe.comparisonStartDate && input.timeframe.comparisonEndDate
      ? Object.freeze({ startDate: input.timeframe.comparisonStartDate, endDate: input.timeframe.comparisonEndDate }) : null,
    observationRefs: uniqueSorted(used.map((item) => item.observationRef)),
    snapshotRefs: uniqueSorted(used.flatMap((item) => item.snapshotRefs)),
    metricResultHashes: uniqueSorted(used.map((item) => item.metricResult.resultHash)),
    observedValueDecimal: evaluated.observed,
    baselineValueDecimal: evaluated.baseline,
    effectValueDecimal: evaluated.effect,
    sampleSizes: Object.freeze(used.map((item) => item.sampleSize)),
    qualityReasonCodes: uniqueSorted(used.flatMap((item) => item.qualityReasonCodes)),
  });
  const findingRef = `finding_${hash({ inputHash, state: evaluated.state, reasonCode: evaluated.reasonCode, evidence }).slice(0, 24)}`;
  return Object.freeze({
    calculatorVersion: DETERMINISTIC_FINDING_CALCULATOR_VERSION,
    findingRef,
    inputHash,
    kind: input.spec.kind,
    state: evaluated.state,
    reasonCode: evaluated.reasonCode,
    evidence,
  });
}
