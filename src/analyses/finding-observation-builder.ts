import { createHash } from "node:crypto";
import type { AnalysisMetric } from "@/analyses/schema";
import type {
  FindingCalculatorSpec,
  FindingObservation,
  FindingWindowRole,
} from "@/analyses/finding-calculators";
import {
  type ResolvedAnalysisTimeframe,
  validateResolvedAnalysisTimeframe,
} from "@/analyses/timeframe-resolver";
import { inspectMetaPersistenceWrite } from "@/domain/meta/data-lifecycle";
import {
  aggregateMetaMetrics,
  META_METRIC_FORMULA_CATALOG,
  MetaMetricAggregationError,
} from "@/domain/meta/insights/metric-engine";
import {
  normalizeMetaDailyInsight,
  type CanonicalMetaDailyInsight,
  type MetaInsightEntityLevel,
} from "@/domain/meta/insights/contract";

export const FINDING_OBSERVATION_BUILDER_VERSION = "finding-observation-builder/1.0.0" as const;
export const FINDING_OBSERVATION_LIMITS = Object.freeze({
  maxWindowDays: 366,
  maxQueries: 366,
  maxRowsPerQuery: 5_000,
  maxRequestedRows: 50_000,
});

export type FindingObservationMaterializationInput = Readonly<{
  workspaceId: string;
  metaConnectionId: string;
  adAccountId: string;
  entityLevel: MetaInsightEntityLevel;
  externalEntityId: string;
  attributionLabel: string;
  expectedCurrency: string | null;
  timeframe: ResolvedAnalysisTimeframe;
  spec: FindingCalculatorSpec;
  maxRowsPerQuery: number;
}>;

export type FindingObservationReadQuery = Readonly<{
  builderVersion: typeof FINDING_OBSERVATION_BUILDER_VERSION;
  queryRef: string;
  workspaceId: string;
  metaConnectionId: string;
  adAccountId: string;
  entityLevel: MetaInsightEntityLevel;
  externalEntityId: string;
  attributionLabel: string;
  expectedCurrency: string | null;
  role: FindingWindowRole;
  startDate: string;
  endDate: string;
  timezone: string;
  maxRows: number;
}>;

export type FindingObservationPlan = Readonly<{
  builderVersion: typeof FINDING_OBSERVATION_BUILDER_VERSION;
  metric: AnalysisMetric;
  queries: readonly FindingObservationReadQuery[];
  planHash: string;
}>;

export type FindingObservationReadResult = Readonly<{
  queryRef: string;
  rows: readonly CanonicalMetaDailyInsight[];
  snapshotRefs: readonly string[];
  settledThroughDate: string;
  complete: boolean;
  qualityStatus: "ready" | "degraded";
  qualityReasonCodes: readonly string[];
}>;

export type FindingObservationReadPort = Readonly<{
  read(query: FindingObservationReadQuery): Promise<FindingObservationReadResult>;
}>;

export type FindingObservationBuilderErrorCode =
  | "invalid_contract"
  | "forbidden_material"
  | "bounds_exceeded"
  | "read_contract_violation"
  | "conflicting_revision";

export class FindingObservationBuilderError extends Error {
  constructor(readonly code: FindingObservationBuilderErrorCode, message: string) {
    super(message);
    this.name = "FindingObservationBuilderError";
  }
}

const DAY_MS = 86_400_000;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactKeys(
  value: unknown,
  allowed: readonly string[],
  required: readonly string[],
  label: string,
  code: FindingObservationBuilderErrorCode = "invalid_contract",
): void {
  if (!isRecord(value)) fail(code, `${label} object olmalıdır`);
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  const missing = required.filter((key) => !(key in value));
  if (unexpected.length > 0 || missing.length > 0) fail(code, `${label} exact-key sözleşmesiyle uyuşmuyor`);
}

function fail(code: FindingObservationBuilderErrorCode, message: string): never {
  throw new FindingObservationBuilderError(code, message);
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compare(left, right))
      .map(([key, child]) => [key, stable(child)]));
  }
  return value;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function unique(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort(compare));
}

function dateTime(value: string): number {
  if (!DATE_PATTERN.test(value)) fail("invalid_contract", "Geçersiz calendar date");
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) fail("invalid_contract", "Geçersiz calendar date");
  return parsed;
}

function addDays(value: string, amount: number): string {
  return new Date(dateTime(value) + amount * DAY_MS).toISOString().slice(0, 10);
}

function inclusiveDays(startDate: string, endDate: string): number {
  return Math.round((dateTime(endDate) - dateTime(startDate)) / DAY_MS) + 1;
}

function requireText(value: string, label: string): void {
  if (typeof value !== "string" || !value.trim() || value.length > 200) fail("invalid_contract", `${label} geçersiz`);
}

function assertRef(value: unknown, label: string): void {
  if (typeof value !== "string" || !REF_PATTERN.test(value)) fail("read_contract_violation", `${label} geçersiz ref`);
}

function queryRef(input: FindingObservationMaterializationInput, role: FindingWindowRole, startDate: string, endDate: string): string {
  return `observation_${digest({
    workspaceId: input.workspaceId,
    connectionId: input.metaConnectionId,
    accountId: input.adAccountId,
    entityLevel: input.entityLevel,
    entityId: input.externalEntityId,
    attributionLabel: input.attributionLabel,
    expectedCurrency: input.expectedCurrency,
    timezone: input.timeframe.timezone,
    metric: input.spec.metric,
    role,
    startDate,
    endDate,
  }).slice(0, 24)}`;
}

function windows(input: FindingObservationMaterializationInput): readonly Readonly<{
  role: FindingWindowRole;
  startDate: string;
  endDate: string;
}>[] {
  const { timeframe, spec } = input;
  if (spec.kind === "trend" || spec.kind === "anomaly") {
    return Object.freeze(Array.from({ length: timeframe.inclusiveDayCount }, (_, index) => {
      const date = addDays(timeframe.startDate, index);
      return Object.freeze({ role: "series" as const, startDate: date, endDate: date });
    }));
  }
  if (spec.kind === "period_comparison") {
    if (!timeframe.comparisonStartDate || !timeframe.comparisonEndDate) fail("invalid_contract", "Period comparison resolved comparison window gerektirir");
    return Object.freeze([
      Object.freeze({ role: "primary" as const, startDate: timeframe.startDate, endDate: timeframe.endDate }),
      Object.freeze({ role: "comparison" as const, startDate: timeframe.comparisonStartDate, endDate: timeframe.comparisonEndDate }),
    ]);
  }
  if (spec.kind === "pre_post") {
    if (timeframe.kind !== "action_relative") fail("invalid_contract", "Pre/post action_relative timeframe gerektirir");
    const preEnd = addDays(spec.actionDate, -1);
    if (timeframe.startDate > preEnd || spec.actionDate > timeframe.endDate) fail("invalid_contract", "Action date resolved timeframe dışında");
    return Object.freeze([
      Object.freeze({ role: "pre" as const, startDate: timeframe.startDate, endDate: preEnd }),
      Object.freeze({ role: "post" as const, startDate: spec.actionDate, endDate: timeframe.endDate }),
    ]);
  }
  return Object.freeze([Object.freeze({ role: "primary" as const, startDate: timeframe.startDate, endDate: timeframe.endDate })]);
}

function validateInput(input: FindingObservationMaterializationInput): void {
  exactKeys(input, [
    "workspaceId", "metaConnectionId", "adAccountId", "entityLevel", "externalEntityId",
    "attributionLabel", "expectedCurrency", "timeframe", "spec", "maxRowsPerQuery",
  ], [
    "workspaceId", "metaConnectionId", "adAccountId", "entityLevel", "externalEntityId",
    "attributionLabel", "expectedCurrency", "timeframe", "spec", "maxRowsPerQuery",
  ], "materialization input");
  if (!inspectMetaPersistenceWrite(input).compliant) fail("forbidden_material", "Materialization input raw payload veya secret taşıyamaz");
  for (const [value, label] of [
    [input.workspaceId, "workspaceId"], [input.metaConnectionId, "metaConnectionId"],
    [input.adAccountId, "adAccountId"], [input.externalEntityId, "externalEntityId"],
    [input.attributionLabel, "attributionLabel"],
  ] as const) requireText(value, label);
  if (!["campaign", "ad_set", "ad"].includes(input.entityLevel)) fail("invalid_contract", "entityLevel geçersiz");
  if (input.expectedCurrency !== null && (typeof input.expectedCurrency !== "string" || !/^[A-Z]{3}$/.test(input.expectedCurrency))) fail("invalid_contract", "expectedCurrency ISO kodu olmalıdır");
  if (!input.timeframe || typeof input.timeframe !== "object" || Array.isArray(input.timeframe)) fail("invalid_contract", "timeframe object olmalıdır");
  try { validateResolvedAnalysisTimeframe(input.timeframe); } catch { fail("invalid_contract", "Resolved timeframe geçersiz"); }
  if (!input.spec || typeof input.spec !== "object" || Array.isArray(input.spec)
    || !["trend", "anomaly", "pacing", "threshold", "period_comparison", "pre_post"].includes(input.spec.kind)
    || typeof input.spec.metric !== "string" || !(input.spec.metric in META_METRIC_FORMULA_CATALOG)) fail("invalid_contract", "Calculator spec geçersiz");
  const specKeys: Readonly<Record<FindingCalculatorSpec["kind"], readonly string[]>> = {
    trend: ["kind", "metric", "direction", "minimumRelativeChange", "minimumPoints", "minimumSample"],
    anomaly: ["kind", "metric", "minimumAbsoluteZScore", "minimumBaselinePoints", "minimumSample"],
    pacing: ["kind", "metric", "plannedTotalDecimal", "elapsedFraction", "toleranceFraction", "direction", "minimumSample"],
    threshold: ["kind", "metric", "operator", "thresholdDecimal", "minimumSample"],
    period_comparison: ["kind", "metric", "direction", "minimumRelativeChange", "minimumSample"],
    pre_post: ["kind", "metric", "direction", "minimumRelativeChange", "minimumSample", "actionDate", "minimumSettledPostDays"],
  };
  exactKeys(input.spec, specKeys[input.spec.kind], specKeys[input.spec.kind], "calculator spec");
  if (!Number.isSafeInteger(input.maxRowsPerQuery) || input.maxRowsPerQuery < 1 || input.maxRowsPerQuery > FINDING_OBSERVATION_LIMITS.maxRowsPerQuery) fail("bounds_exceeded", "maxRowsPerQuery sınır dışında");
  if (input.timeframe.inclusiveDayCount > FINDING_OBSERVATION_LIMITS.maxWindowDays) fail("bounds_exceeded", "Timeframe gün sınırını aşıyor");
}

export function buildFindingObservationPlan(input: FindingObservationMaterializationInput): FindingObservationPlan {
  validateInput(input);
  const plannedWindows = windows(input);
  if (plannedWindows.length > FINDING_OBSERVATION_LIMITS.maxQueries
    || plannedWindows.length * input.maxRowsPerQuery > FINDING_OBSERVATION_LIMITS.maxRequestedRows) {
    fail("bounds_exceeded", "Observation query plan sınırları aşıyor");
  }
  const queries = plannedWindows.map((window): FindingObservationReadQuery => Object.freeze({
    builderVersion: FINDING_OBSERVATION_BUILDER_VERSION,
    queryRef: queryRef(input, window.role, window.startDate, window.endDate),
    workspaceId: input.workspaceId,
    metaConnectionId: input.metaConnectionId,
    adAccountId: input.adAccountId,
    entityLevel: input.entityLevel,
    externalEntityId: input.externalEntityId,
    attributionLabel: input.attributionLabel,
    expectedCurrency: input.expectedCurrency,
    role: window.role,
    startDate: window.startDate,
    endDate: window.endDate,
    timezone: input.timeframe.timezone,
    maxRows: input.maxRowsPerQuery,
  }));
  const envelope = { builderVersion: FINDING_OBSERVATION_BUILDER_VERSION, metric: input.spec.metric, queries };
  return Object.freeze({ ...envelope, queries: Object.freeze(queries), planHash: digest(envelope) });
}

function authenticateRow(row: CanonicalMetaDailyInsight): boolean {
  if (!row || typeof row !== "object" || Array.isArray(row)) return false;
  const rowKeys = [
    "schemaVersion", "workspaceId", "metaConnectionId", "adAccountId", "entityLevel", "externalEntityId",
    "dateStart", "dateStop", "attributionLabel", "attributionWindow", "currency", "timezone",
    "fieldAvailability", "sourceRevision", "sourcePayloadHash", "sourceUpdatedAt", "metricProvenance",
    "metrics", "identity", "contentHash",
  ];
  if (Object.keys(row).some((key) => !rowKeys.includes(key)) || !Array.isArray(row.metrics)) return false;
  const metricKeys = ["metricKey", "actionType", "aggregation", "valueDecimal", "valueMinor", "valueJson", "currency", "provenance", "availability"];
  if (row.metrics.some((metric) => !isRecord(metric) || Object.keys(metric).some((key) => !metricKeys.includes(key)))) return false;
  const { identity, contentHash, ...source } = row;
  try {
    const normalized = normalizeMetaDailyInsight(source);
    return normalized.identity === identity && normalized.contentHash === contentHash;
  } catch {
    return false;
  }
}

function validateRead(query: FindingObservationReadQuery, read: FindingObservationReadResult): void {
  exactKeys(read, ["queryRef", "rows", "snapshotRefs", "settledThroughDate", "complete", "qualityStatus", "qualityReasonCodes"], ["queryRef", "rows", "snapshotRefs", "settledThroughDate", "complete", "qualityStatus", "qualityReasonCodes"], "read result", "read_contract_violation");
  if (read.queryRef !== query.queryRef) fail("read_contract_violation", "Read sonucu queryRef ile uyuşmuyor");
  if (!Array.isArray(read.rows) || !Array.isArray(read.snapshotRefs) || !Array.isArray(read.qualityReasonCodes)) fail("read_contract_violation", "Read koleksiyonları geçersiz");
  if (read.rows.length > query.maxRows) fail("read_contract_violation", "Read satır sınırını aştı");
  if (typeof read.complete !== "boolean" || !["ready", "degraded"].includes(read.qualityStatus)) fail("read_contract_violation", "Read quality alanları geçersiz");
  if (typeof read.settledThroughDate !== "string") fail("read_contract_violation", "settledThroughDate string olmalıdır");
  try { dateTime(read.settledThroughDate); } catch { fail("read_contract_violation", "settledThroughDate geçersiz"); }
  if (read.snapshotRefs.length === 0) fail("read_contract_violation", "Her read sonucu snapshotRef taşımalıdır");
  read.snapshotRefs.forEach((ref: unknown) => assertRef(ref, "snapshotRef"));
  read.qualityReasonCodes.forEach((ref: unknown) => assertRef(ref, "qualityReasonCode"));
  for (const row of read.rows as readonly CanonicalMetaDailyInsight[]) {
    if (!authenticateRow(row)) fail("read_contract_violation", "Canonical row hash doğrulanamadı");
    if (row.workspaceId !== query.workspaceId || row.metaConnectionId !== query.metaConnectionId
      || row.adAccountId !== query.adAccountId || row.entityLevel !== query.entityLevel
      || row.externalEntityId !== query.externalEntityId || row.attributionLabel !== query.attributionLabel
      || row.dateStart < query.startDate || row.dateStop > query.endDate) {
      fail("read_contract_violation", "Canonical row query scope dışında");
    }
  }
}

export function buildFindingObservations(input: Readonly<{
  plan: FindingObservationPlan;
  reads: readonly FindingObservationReadResult[];
}>): readonly FindingObservation[] {
  exactKeys(input, ["plan", "reads"], ["plan", "reads"], "observation build input");
  if (!input.plan || !Array.isArray(input.reads)) fail("invalid_contract", "Observation build input geçersiz");
  if (!inspectMetaPersistenceWrite(input).compliant) fail("forbidden_material", "Observation read material raw payload veya secret taşıyamaz");
  exactKeys(input.plan, ["builderVersion", "metric", "queries", "planHash"], ["builderVersion", "metric", "queries", "planHash"], "observation plan");
  const expectedHash = digest({ builderVersion: input.plan.builderVersion, metric: input.plan.metric, queries: input.plan.queries });
  if (input.plan.builderVersion !== FINDING_OBSERVATION_BUILDER_VERSION || input.plan.planHash !== expectedHash || !Array.isArray(input.plan.queries)) fail("invalid_contract", "Observation plan doğrulanamadı");
  if (typeof input.plan.metric !== "string" || !(input.plan.metric in META_METRIC_FORMULA_CATALOG) || input.plan.queries.length < 1
    || input.plan.queries.length > FINDING_OBSERVATION_LIMITS.maxQueries) fail("bounds_exceeded", "Observation plan metric/query sınırı geçersiz");
  const planQueryRefs = new Set<string>();
  let requestedRows = 0;
  let commonScope: string | null = null;
  for (const query of input.plan.queries) {
    exactKeys(query, [
      "builderVersion", "queryRef", "workspaceId", "metaConnectionId", "adAccountId", "entityLevel",
      "externalEntityId", "attributionLabel", "expectedCurrency", "role", "startDate", "endDate",
      "timezone", "maxRows",
    ], [
      "builderVersion", "queryRef", "workspaceId", "metaConnectionId", "adAccountId", "entityLevel",
      "externalEntityId", "attributionLabel", "expectedCurrency", "role", "startDate", "endDate",
      "timezone", "maxRows",
    ], "observation query");
    if (query.builderVersion !== FINDING_OBSERVATION_BUILDER_VERSION
      || typeof query.queryRef !== "string" || !REF_PATTERN.test(query.queryRef)
      || !["primary", "comparison", "series", "pre", "post"].includes(query.role)
      || !["campaign", "ad_set", "ad"].includes(query.entityLevel)
      || typeof query.timezone !== "string" || !query.timezone || query.timezone.length > 100
      || typeof query.workspaceId !== "string" || !query.workspaceId.trim() || query.workspaceId.length > 200
      || typeof query.metaConnectionId !== "string" || !query.metaConnectionId.trim() || query.metaConnectionId.length > 200
      || typeof query.adAccountId !== "string" || !query.adAccountId.trim() || query.adAccountId.length > 200
      || typeof query.externalEntityId !== "string" || !query.externalEntityId.trim() || query.externalEntityId.length > 200
      || typeof query.attributionLabel !== "string" || !query.attributionLabel.trim() || query.attributionLabel.length > 200
      || (query.expectedCurrency !== null && (typeof query.expectedCurrency !== "string" || !/^[A-Z]{3}$/.test(query.expectedCurrency)))
      || typeof query.startDate !== "string" || typeof query.endDate !== "string"
      || !Number.isSafeInteger(query.maxRows) || query.maxRows < 1 || query.maxRows > FINDING_OBSERVATION_LIMITS.maxRowsPerQuery
      || inclusiveDays(query.startDate, query.endDate) < 1 || inclusiveDays(query.startDate, query.endDate) > FINDING_OBSERVATION_LIMITS.maxWindowDays) {
      fail("bounds_exceeded", "Observation query runtime şekli veya sınırı geçersiz");
    }
    const scope = JSON.stringify([query.workspaceId, query.metaConnectionId, query.adAccountId, query.entityLevel, query.externalEntityId, query.attributionLabel, query.expectedCurrency, query.timezone]);
    if (commonScope !== null && scope !== commonScope) fail("invalid_contract", "Plan query scope alanları tutarlı olmalıdır");
    commonScope = scope;
    if (planQueryRefs.has(query.queryRef)) fail("invalid_contract", "Plan queryRef tekrar edemez");
    planQueryRefs.add(query.queryRef);
    requestedRows += query.maxRows;
  }
  if (requestedRows > FINDING_OBSERVATION_LIMITS.maxRequestedRows) fail("bounds_exceeded", "Plan toplam satır sınırını aşıyor");
  if (input.reads.length !== input.plan.queries.length) fail("read_contract_violation", "Her query için tam bir read sonucu zorunludur");
  const byRef = new Map(input.reads.map((read) => [read?.queryRef, read]));
  if (byRef.size !== input.reads.length) fail("read_contract_violation", "Read queryRef tekrar edemez");

  return Object.freeze(input.plan.queries.map((query): FindingObservation => {
    const read = byRef.get(query.queryRef);
    if (!read) fail("read_contract_violation", "Query read sonucu eksik");
    validateRead(query, read);
    const canonicalRows = read.rows as readonly CanonicalMetaDailyInsight[];
    const timezoneReasons = canonicalRows.some((row: CanonicalMetaDailyInsight) => !row.timezone)
      ? ["timezone_missing"]
      : canonicalRows.some((row: CanonicalMetaDailyInsight) => row.timezone !== query.timezone) ? ["timezone_mismatch"] : [];
    const currencyReasons = query.expectedCurrency && canonicalRows.some((row: CanonicalMetaDailyInsight) => row.currency !== query.expectedCurrency)
      ? ["currency_mismatch"] : [];
    const qualityReasonCodes = unique([
      ...read.qualityReasonCodes,
      ...timezoneReasons,
      ...currencyReasons,
      ...(!read.complete ? ["read_incomplete"] : []),
    ]);
    const qualityStatus = read.qualityStatus === "degraded" || qualityReasonCodes.length > 0 ? "degraded" : "ready";
    let metricResult;
    try {
      metricResult = aggregateMetaMetrics({ rows: canonicalRows, metrics: [input.plan.metric] });
    } catch (error) {
      if (error instanceof MetaMetricAggregationError && error.code === "conflicting_revision") fail("conflicting_revision", "Canonical revision çakışması");
      throw error;
    }
    return Object.freeze({
      observationRef: query.queryRef,
      role: query.role,
      startDate: query.startDate,
      endDate: query.endDate,
      timezone: query.timezone,
      sampleSize: new Set(canonicalRows.map((row: CanonicalMetaDailyInsight) => row.identity)).size,
      settled: read.complete && query.endDate <= read.settledThroughDate,
      qualityStatus,
      qualityReasonCodes,
      metricResult,
      snapshotRefs: unique(read.snapshotRefs),
    });
  }));
}

export async function materializeFindingObservations(
  input: FindingObservationMaterializationInput,
  port: FindingObservationReadPort,
): Promise<readonly FindingObservation[]> {
  if (!port || typeof port.read !== "function") fail("invalid_contract", "Finding observation read port zorunludur");
  const plan = buildFindingObservationPlan(input);
  const reads = await Promise.all(plan.queries.map((query) => port.read(query)));
  return buildFindingObservations({ plan, reads });
}
