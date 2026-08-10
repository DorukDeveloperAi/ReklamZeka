import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type {
  FindingObservationReadPort,
  FindingObservationReadQuery,
  FindingObservationReadResult,
} from "@/analyses/finding-observation-builder";
import {
  FINDING_OBSERVATION_BUILDER_VERSION,
  FINDING_OBSERVATION_LIMITS,
} from "@/analyses/finding-observation-builder";
import * as schema from "@/db/schema";
import { inspectMetaPersistenceWrite } from "@/domain/meta/data-lifecycle";
import {
  META_INSIGHT_SCHEMA_VERSION,
  normalizeMetaDailyInsight,
  type CanonicalMetaDailyInsight,
  type MetaFieldAvailability,
  type MetaMetricValue,
} from "@/domain/meta/insights/contract";

type Database = Pick<NodePgDatabase<typeof schema>, "execute">;

export const FINDING_OBSERVATION_SETTLEMENT_POLICY_VERSION = "finding-observation-settlement-policy/1.0.0" as const;

export type FindingObservationSettlementDecision = Readonly<{
  policyVersion: typeof FINDING_OBSERVATION_SETTLEMENT_POLICY_VERSION;
  policyRef: string;
  /** Explicit clock evidence supplied by the application; the adapter never reads wall-clock time. */
  evaluatedAsOf: string;
  /** Latest business day whose attribution/conversion window is considered final. */
  settledThroughDate: string;
}>;

export type FindingObservationSettlementPolicy = Readonly<{
  resolve(query: FindingObservationReadQuery): Promise<FindingObservationSettlementDecision>;
}>;

/**
 * Server-private L1 identity evidence for the L2 writer.  The public
 * observation contract deliberately exposes only the opaque snapshot ref;
 * this companion record lets a later immutable feature manifest bind that
 * ref to the tenant-owned canonical row without leaking database ids into a
 * finding, context, or model input.
 */
export type FindingObservationFeatureSourceItem = Readonly<{
  dailyInsightId: string;
  snapshotRef: string;
  contentHash: string;
}>;

export type FindingObservationFeatureSourceRead = Readonly<{
  read: FindingObservationReadResult;
  sourceManifest: readonly FindingObservationFeatureSourceItem[];
}>;

export type FindingObservationReadAdapterErrorCode =
  | "invalid_query"
  | "persistence_failure"
  | "integrity_violation"
  | "forbidden_material"
  | "settlement_policy_missing";

export class FindingObservationReadAdapterError extends Error {
  constructor(readonly code: FindingObservationReadAdapterErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "FindingObservationReadAdapterError";
  }
}

type RawMetric = Readonly<{
  metricKey: unknown;
  actionType: unknown;
  aggregation: unknown;
  valueDecimal: unknown;
  valueMinor: unknown;
  valueJson: unknown;
  currency: unknown;
  provenance: unknown;
  availability: unknown;
  sourceRevision: unknown;
  sourcePayloadHash: unknown;
}>;

type RawInsight = Readonly<{
  internalId: unknown;
  workspaceId: unknown;
  metaConnectionId: unknown;
  adAccountId: unknown;
  entityLevel: unknown;
  externalEntityId: unknown;
  dateStart: unknown;
  dateStop: unknown;
  attributionLabel: unknown;
  attributionWindow: unknown;
  currency: unknown;
  timezone: unknown;
  fieldAvailability: unknown;
  sourceRevision: unknown;
  sourcePayloadHash: unknown;
  sourceUpdatedAt: unknown;
  metricProvenance: unknown;
  sliceStatus: unknown;
  sliceCompletedAt: unknown;
  runStatus: unknown;
  runFinishedAt: unknown;
  metrics: unknown;
}>;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

function fail(code: FindingObservationReadAdapterErrorCode, message: string, cause?: unknown): never {
  throw new FindingObservationReadAdapterError(code, message, cause === undefined ? undefined : { cause });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function dateMs(value: string): number {
  if (!DATE_PATTERN.test(value)) fail("invalid_query", "Observation tarihi ISO calendar day olmalıdır");
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString().slice(0, 10) !== value) {
    fail("invalid_query", "Observation tarihi geçersiz");
  }
  return parsed;
}

function previousDay(value: string): string {
  return new Date(dateMs(value) - DAY_MS).toISOString().slice(0, 10);
}

function addDay(value: string): string {
  return new Date(dateMs(value) + DAY_MS).toISOString().slice(0, 10);
}

function localCalendarDate(instant: string, timezone: string): string {
  const parsed = new Date(instant);
  if (!Number.isFinite(parsed.getTime())) fail("settlement_policy_missing", "Settlement evaluatedAsOf geçersiz");
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(parsed);
    const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const date = `${value.year}-${value.month}-${value.day}`;
    if (!DATE_PATTERN.test(date)) fail("settlement_policy_missing", "Settlement timezone günü çözümlenemedi");
    return date;
  } catch (error) {
    if (error instanceof FindingObservationReadAdapterError) throw error;
    fail("settlement_policy_missing", "Settlement timezone geçersiz", error);
  }
}

async function resolveSettlementPolicy(
  policy: FindingObservationSettlementPolicy | undefined,
  query: FindingObservationReadQuery,
): Promise<string> {
  if (!policy || typeof policy.resolve !== "function") {
    fail("settlement_policy_missing", "Deterministic settlement policy zorunludur");
  }
  let decision: FindingObservationSettlementDecision;
  try {
    decision = await policy.resolve(Object.freeze({ ...query }));
  } catch (error) {
    if (error instanceof FindingObservationReadAdapterError) throw error;
    fail("settlement_policy_missing", "Settlement policy çözümlenemedi", error);
  }
  const keys = ["policyVersion", "policyRef", "evaluatedAsOf", "settledThroughDate"];
  if (!isRecord(decision) || Object.keys(decision).length !== keys.length
    || Object.keys(decision).some((key) => !keys.includes(key))
    || decision.policyVersion !== FINDING_OBSERVATION_SETTLEMENT_POLICY_VERSION
    || typeof decision.policyRef !== "string" || !REF_PATTERN.test(decision.policyRef)
    || typeof decision.evaluatedAsOf !== "string"
    || typeof decision.settledThroughDate !== "string"
    || !inspectMetaPersistenceWrite(decision).compliant || containsControlMaterial(decision)) {
    fail("settlement_policy_missing", "Settlement policy exact-key sözleşmesi geçersiz");
  }
  let cutoffMs: number;
  try {
    cutoffMs = dateMs(decision.settledThroughDate);
  } catch {
    fail("settlement_policy_missing", "Settlement cutoff calendar day olmalıdır");
  }
  const evaluatedDate = localCalendarDate(decision.evaluatedAsOf, query.timezone);
  if (cutoffMs > dateMs(evaluatedDate)) {
    fail("settlement_policy_missing", "Settlement cutoff evaluatedAsOf sonrasına taşamaz");
  }
  // A policy may be portfolio-wide and extend past this query. The effective
  // cutoff is query-bound so no out-of-window finality is claimed.
  return decision.settledThroughDate > query.endDate ? query.endDate : decision.settledThroughDate;
}

function validateQuery(query: FindingObservationReadQuery): void {
  if (!isRecord(query)) fail("invalid_query", "Observation query object olmalıdır");
  const keys = [
    "builderVersion", "queryRef", "workspaceId", "metaConnectionId", "adAccountId", "entityLevel",
    "externalEntityId", "attributionLabel", "expectedCurrency", "role", "startDate", "endDate",
    "timezone", "maxRows",
  ];
  if (Object.keys(query).length !== keys.length || Object.keys(query).some((key) => !keys.includes(key))) {
    fail("invalid_query", "Observation query exact-key sözleşmesiyle uyuşmuyor");
  }
  if (query.builderVersion !== FINDING_OBSERVATION_BUILDER_VERSION
    || !REF_PATTERN.test(query.queryRef)
    || !UUID_PATTERN.test(query.workspaceId)
    || !UUID_PATTERN.test(query.metaConnectionId)
    || !UUID_PATTERN.test(query.adAccountId)
    || !["campaign", "ad_set", "ad"].includes(query.entityLevel)
    || !["primary", "comparison", "series", "pre", "post"].includes(query.role)
    || !query.externalEntityId.trim() || query.externalEntityId.length > 200
    || !query.attributionLabel.trim() || query.attributionLabel.length > 200
    || !query.timezone.trim() || query.timezone.length > 100
    || (query.expectedCurrency !== null && !/^[A-Z]{3}$/.test(query.expectedCurrency))
    || !Number.isSafeInteger(query.maxRows) || query.maxRows < 1
    || query.maxRows > FINDING_OBSERVATION_LIMITS.maxRowsPerQuery) {
    fail("invalid_query", "Observation query kapsamı veya sınırı geçersiz");
  }
  const days = Math.round((dateMs(query.endDate) - dateMs(query.startDate)) / DAY_MS) + 1;
  if (days < 1 || days > FINDING_OBSERVATION_LIMITS.maxWindowDays) {
    fail("invalid_query", "Observation query tarih aralığı sınır dışında");
  }
  if (!inspectMetaPersistenceWrite(query).compliant || containsControlMaterial(query)) {
    fail("forbidden_material", "Observation query raw, secret, prompt veya authority materyali taşıyamaz");
  }
}

function normalizedKey(value: string): string {
  return value.replace(/[^a-z0-9]/gi, "").toLowerCase();
}

function containsControlMaterial(value: unknown, visited = new WeakSet<object>()): boolean {
  if (!value || typeof value !== "object") return false;
  if (visited.has(value)) return false;
  visited.add(value);
  if (Array.isArray(value)) return value.some((item) => containsControlMaterial(item, visited));
  return Object.entries(value as Record<string, unknown>).some(([key, child]) => {
    const normalized = normalizedKey(key);
    return normalized.includes("prompt") || normalized.includes("authority")
      || normalized.includes("instruction") || containsControlMaterial(child, visited);
  });
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) fail("integrity_violation", `${label} geçersiz`);
  return value;
}

function nullableText(value: unknown, label: string): string | undefined {
  if (value === null || value === undefined) return undefined;
  return text(value, label);
}

function jsonRecord(value: unknown, label: string): Readonly<Record<string, unknown>> {
  if (!isRecord(value)) fail("integrity_violation", `${label} JSON object olmalıdır`);
  return value;
}

function availabilityMap(value: unknown): Readonly<Record<string, MetaFieldAvailability>> {
  const source = jsonRecord(value, "fieldAvailability");
  for (const [field, availability] of Object.entries(source)) {
    if (!field || !isRecord(availability) || Object.keys(availability).some((key) => !["reason", "detail"].includes(key))
      || !["unsupported", "permission_missing", "unknown"].includes(String(availability.reason))
      || (availability.detail !== undefined && typeof availability.detail !== "string")) {
      fail("integrity_violation", "fieldAvailability sözleşmesi geçersiz");
    }
  }
  return source as Readonly<Record<string, MetaFieldAvailability>>;
}

function iso(value: unknown, label: string): string | undefined {
  if (value === null || value === undefined) return undefined;
  const candidate = value instanceof Date ? value : new Date(text(value, label));
  if (!Number.isFinite(candidate.getTime())) fail("integrity_violation", `${label} geçersiz timestamp`);
  return candidate.toISOString();
}

function metricFromRaw(raw: RawMetric, sourceRevision: string, sourcePayloadHash: string): MetaMetricValue {
  if (!isRecord(raw)) fail("integrity_violation", "Metric row object olmalıdır");
  if (raw.sourceRevision !== sourceRevision || raw.sourcePayloadHash !== sourcePayloadHash) {
    fail("integrity_violation", "Insight ve metric source revision/hash uyuşmuyor");
  }
  const metricKey = text(raw.metricKey, "metricKey");
  const actionType = raw.actionType === "" || raw.actionType === null ? undefined : text(raw.actionType, "actionType");
  if (!["additive", "non_additive", "derived"].includes(String(raw.aggregation))) {
    fail("integrity_violation", "Metric aggregation geçersiz");
  }
  const valueDecimal = nullableText(raw.valueDecimal, "valueDecimal");
  let valueMinor: number | undefined;
  if (raw.valueMinor !== null && raw.valueMinor !== undefined) {
    const parsed = typeof raw.valueMinor === "number" ? raw.valueMinor : Number(raw.valueMinor);
    if (!Number.isSafeInteger(parsed)) fail("integrity_violation", "valueMinor güvenli tam sayı olmalıdır");
    valueMinor = parsed;
  }
  const valueJson = raw.valueJson === null || raw.valueJson === undefined
    ? undefined : jsonRecord(raw.valueJson, "valueJson");
  let availability: MetaFieldAvailability | undefined;
  if (isRecord(raw.availability) && Object.keys(raw.availability).length > 0) {
    const allowed = ["reason", "detail"];
    if (Object.keys(raw.availability).some((key) => !allowed.includes(key))
      || !["unsupported", "permission_missing", "unknown"].includes(String(raw.availability.reason))
      || (raw.availability.detail !== undefined && typeof raw.availability.detail !== "string")) {
      fail("integrity_violation", "Metric availability sözleşmesi geçersiz");
    }
    availability = raw.availability as MetaFieldAvailability;
  } else if (raw.availability !== null && raw.availability !== undefined && !isRecord(raw.availability)) {
    fail("integrity_violation", "Metric availability object olmalıdır");
  }
  return {
    metricKey,
    ...(actionType === undefined ? {} : { actionType }),
    aggregation: raw.aggregation as MetaMetricValue["aggregation"],
    ...(valueDecimal === undefined ? {} : { valueDecimal }),
    ...(valueMinor === undefined ? {} : { valueMinor }),
    ...(valueJson === undefined ? {} : { valueJson }),
    ...(raw.currency === null || raw.currency === undefined ? {} : { currency: text(raw.currency, "metric currency") }),
    provenance: jsonRecord(raw.provenance, "metric provenance"),
    ...(availability === undefined ? {} : { availability }),
  };
}

function canonicalFromRaw(raw: RawInsight): Readonly<{
  row: CanonicalMetaDailyInsight;
  internalId: string;
  syncSettled: boolean;
}> {
  if (!isRecord(raw) || !Array.isArray(raw.metrics)) fail("integrity_violation", "Insight result shape geçersiz");
  if (!UUID_PATTERN.test(text(raw.internalId, "internalId"))
    || !["campaign", "ad_set", "ad"].includes(String(raw.entityLevel))) {
    fail("integrity_violation", "Insight identity veya entity level geçersiz");
  }
  const sourceRevision = text(raw.sourceRevision, "sourceRevision");
  const sourcePayloadHash = text(raw.sourcePayloadHash, "sourcePayloadHash");
  const metrics = (raw.metrics as readonly RawMetric[]).map((metric) => metricFromRaw(metric, sourceRevision, sourcePayloadHash));
  const sourceUpdatedAt = iso(raw.sourceUpdatedAt, "sourceUpdatedAt");
  let row: CanonicalMetaDailyInsight;
  try {
    row = normalizeMetaDailyInsight({
      schemaVersion: META_INSIGHT_SCHEMA_VERSION,
      workspaceId: text(raw.workspaceId, "workspaceId"),
      metaConnectionId: text(raw.metaConnectionId, "metaConnectionId"),
      adAccountId: text(raw.adAccountId, "adAccountId"),
      entityLevel: raw.entityLevel as CanonicalMetaDailyInsight["entityLevel"],
      externalEntityId: text(raw.externalEntityId, "externalEntityId"),
      dateStart: text(raw.dateStart, "dateStart"),
      dateStop: text(raw.dateStop, "dateStop"),
      attributionLabel: text(raw.attributionLabel, "attributionLabel"),
      ...(raw.attributionWindow === null || raw.attributionWindow === undefined
        ? {} : { attributionWindow: jsonRecord(raw.attributionWindow, "attributionWindow") }),
      ...(raw.currency === null || raw.currency === undefined ? {} : { currency: text(raw.currency, "currency") }),
      ...(raw.timezone === null || raw.timezone === undefined ? {} : { timezone: text(raw.timezone, "timezone") }),
      fieldAvailability: availabilityMap(raw.fieldAvailability),
      sourceRevision,
      sourcePayloadHash,
      ...(sourceUpdatedAt === undefined ? {} : { sourceUpdatedAt }),
      metricProvenance: jsonRecord(raw.metricProvenance, "metricProvenance"),
      metrics,
    });
  } catch (error) {
    if (error instanceof FindingObservationReadAdapterError) throw error;
    fail("integrity_violation", "Persisted canonical insight sözleşmesi geçersiz", error);
  }
  if (!inspectMetaPersistenceWrite(row).compliant || containsControlMaterial(row)) {
    fail("forbidden_material", "Canonical insight raw, secret, prompt veya authority materyali taşıyor");
  }
  return Object.freeze({
    row: Object.freeze(row),
    internalId: raw.internalId as string,
    syncSettled: raw.sliceStatus === "completed" && raw.runStatus === "completed"
      && iso(raw.sliceCompletedAt, "sliceCompletedAt") !== undefined
      && iso(raw.runFinishedAt, "runFinishedAt") !== undefined,
  });
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function rowsOf(result: unknown): readonly RawInsight[] {
  if (!result || typeof result !== "object" || !("rows" in result) || !Array.isArray(result.rows)) {
    fail("persistence_failure", "PostgreSQL result rows alınamadı");
  }
  return result.rows as readonly RawInsight[];
}

function quality(input: Readonly<{
  query: FindingObservationReadQuery;
  rows: readonly ReturnType<typeof canonicalFromRaw>[];
  truncated: boolean;
  policyCutoffDate: string;
}>): Readonly<{ reasons: readonly string[]; settledThroughDate: string }> {
  const reasons = new Set<string>();
  if (input.truncated) reasons.add("row_limit_reached");
  if (input.rows.length === 0) reasons.add("no_data");
  if (input.rows.some(({ row }) => row.dateStart !== row.dateStop)) reasons.add("non_daily_grain");
  if (input.rows.some(({ row }) => row.metrics.length === 0)) reasons.add("metrics_missing");
  if (input.rows.some(({ row }) => Object.keys(row.fieldAvailability ?? {}).length > 0)) reasons.add("field_availability_gap");
  if (input.rows.some(({ row }) => row.metrics.some((metric) => metric.availability !== undefined))) reasons.add("metric_availability_gap");
  if (input.rows.some((row) => !row.syncSettled)) reasons.add("unsettled_sync_evidence");

  const byDay = new Map(input.rows
    .filter(({ row }) => row.dateStart === row.dateStop)
    .map((item) => [item.row.dateStart, item] as const));
  let cursor = input.query.startDate;
  let settledThroughDate = previousDay(input.query.startDate);
  while (cursor <= input.query.endDate) {
    const candidate = byDay.get(cursor);
    if (!candidate?.syncSettled) break;
    settledThroughDate = cursor;
    cursor = addDay(cursor);
  }
  if (cursor <= input.query.endDate) reasons.add("calendar_coverage_gap");
  if (input.policyCutoffDate < input.query.endDate) reasons.add("attribution_settlement_lag");
  if (input.policyCutoffDate < settledThroughDate) settledThroughDate = input.policyCutoffDate;
  return Object.freeze({ reasons: Object.freeze([...reasons].sort()), settledThroughDate });
}

/**
 * Tenant-bound, read-only projection from the canonical Meta insight mirror.
 * The SQL uses a bounded CTE before metric aggregation so the cap applies to
 * canonical insight rows, not to the number of child metric rows. Sync
 * completion proves mirror coverage only; the injected policy separately
 * proves attribution-window finality. Returned row count/sampleSize is a
 * canonical row identity count, never an inferred event or conversion sample.
 */
export class DrizzleFindingObservationReadPort implements FindingObservationReadPort {
  constructor(
    private readonly database: Database,
    private readonly settlementPolicy?: FindingObservationSettlementPolicy,
  ) {}

  async read(query: FindingObservationReadQuery): Promise<FindingObservationReadResult> {
    return (await this.readForFeatureSnapshot(query)).read;
  }

  /**
   * Deliberately not part of FindingObservationReadPort: callers composing
   * public findings cannot receive database identifiers.  The future L2
   * persistence adapter is the sole intended consumer.
   */
  async readForFeatureSnapshot(query: FindingObservationReadQuery): Promise<FindingObservationFeatureSourceRead> {
    validateQuery(query);
    // Resolve and authenticate policy evidence before any database access.
    const policyCutoffDate = await resolveSettlementPolicy(this.settlementPolicy, query);
    try {
      const expectedCurrency = query.expectedCurrency;
      const result = await this.database.execute(sql`
        with bounded as (
          select insight.*
          from ${schema.metaDailyInsights} insight
          inner join ${schema.adAccounts} account
            on account.id = insight.ad_account_id
            and account.workspace_id = insight.workspace_id
          inner join ${schema.dataSources} source
            on source.id = account.data_source_id
            and source.workspace_id = insight.workspace_id
            and source.meta_connection_id = insight.meta_connection_id
          inner join ${schema.metaConnections} connection
            on connection.id = insight.meta_connection_id
            and connection.workspace_id = insight.workspace_id
          where insight.workspace_id = ${query.workspaceId}::uuid
            and insight.meta_connection_id = ${query.metaConnectionId}::uuid
            and insight.ad_account_id = ${query.adAccountId}::uuid
            and insight.entity_level = ${query.entityLevel}::meta_insight_entity_level
            and insight.external_entity_id = ${query.externalEntityId}
            and insight.attribution_label = ${query.attributionLabel}
            and insight.date_start >= ${query.startDate}::date
            and insight.date_stop <= ${query.endDate}::date
            and insight.timezone = ${query.timezone}
            and account.timezone = ${query.timezone}
            and (${expectedCurrency}::text is null or (
              insight.currency = ${expectedCurrency} and account.currency = ${expectedCurrency}
            ))
          order by insight.date_start asc, insight.date_stop asc, insight.id asc
          limit ${query.maxRows + 1}
        )
        select
          bounded.id::text as "internalId",
          bounded.workspace_id::text as "workspaceId",
          bounded.meta_connection_id::text as "metaConnectionId",
          bounded.ad_account_id::text as "adAccountId",
          bounded.entity_level as "entityLevel",
          bounded.external_entity_id as "externalEntityId",
          bounded.date_start::text as "dateStart",
          bounded.date_stop::text as "dateStop",
          bounded.attribution_label as "attributionLabel",
          bounded.attribution_window as "attributionWindow",
          bounded.currency,
          bounded.timezone,
          bounded.field_availability as "fieldAvailability",
          bounded.source_revision as "sourceRevision",
          bounded.source_payload_hash as "sourcePayloadHash",
          bounded.source_updated_at as "sourceUpdatedAt",
          bounded.metric_provenance as "metricProvenance",
          slice.status as "sliceStatus",
          slice.completed_at as "sliceCompletedAt",
          run.status as "runStatus",
          run.finished_at as "runFinishedAt",
          coalesce(metric_rows.metrics, '[]'::jsonb) as metrics
        from bounded
        left join ${schema.metaSyncSlices} slice
          on slice.id = bounded.sync_slice_id
          and slice.workspace_id = bounded.workspace_id
          and slice.meta_connection_id = bounded.meta_connection_id
          and slice.ad_account_id = bounded.ad_account_id
        left join ${schema.metaSyncRuns} run
          on run.id = bounded.sync_run_id
          and run.id = slice.run_id
          and run.workspace_id = bounded.workspace_id
          and run.meta_connection_id = bounded.meta_connection_id
          and run.ad_account_id = bounded.ad_account_id
        left join lateral (
          select jsonb_agg(jsonb_build_object(
            'metricKey', metric.metric_key,
            'actionType', metric.action_type,
            'aggregation', metric.aggregation,
            'valueDecimal', metric.value_decimal,
            'valueMinor', metric.value_minor,
            'valueJson', metric.value_json,
            'currency', metric.currency,
            'provenance', metric.provenance,
            'availability', metric.availability,
            'sourceRevision', metric.source_revision,
            'sourcePayloadHash', metric.source_payload_hash
          ) order by metric.metric_key asc, metric.action_type asc) as metrics
          from ${schema.metaDailyInsightMetrics} metric
          where metric.daily_insight_id = bounded.id
        ) metric_rows on true
        order by bounded.date_start asc, bounded.date_stop asc, bounded.id asc
      `);
      const rawRows = rowsOf(result);
      const truncated = rawRows.length > query.maxRows;
      const canonical = rawRows.slice(0, query.maxRows).map(canonicalFromRaw);
      const assessment = quality({ query, rows: canonical, truncated, policyCutoffDate });
      const sourceManifest = canonical.map(({ row, internalId }) => Object.freeze({
        dailyInsightId: internalId,
        snapshotRef: `snapshot_${digest(`${internalId}:${row.contentHash}`).slice(0, 32)}`,
        contentHash: row.contentHash,
      }));
      const snapshotRefs = sourceManifest.length > 0
        ? sourceManifest.map(({ snapshotRef }) => snapshotRef)
        : [`snapshot_empty_${digest(JSON.stringify(query)).slice(0, 24)}`];
      const read = Object.freeze({
        queryRef: query.queryRef,
        rows: Object.freeze(canonical.map(({ row }) => row)),
        snapshotRefs: Object.freeze([...new Set(snapshotRefs)].sort()),
        settledThroughDate: assessment.settledThroughDate,
        complete: !truncated,
        qualityStatus: assessment.reasons.length === 0 ? "ready" : "degraded",
        qualityReasonCodes: assessment.reasons,
      });
      return Object.freeze({
        read,
        sourceManifest: Object.freeze([...sourceManifest].sort((left, right) => left.snapshotRef.localeCompare(right.snapshotRef))),
      });
    } catch (error) {
      if (error instanceof FindingObservationReadAdapterError) throw error;
      fail("persistence_failure", "Canonical insight read başarısız", error);
    }
  }
}
