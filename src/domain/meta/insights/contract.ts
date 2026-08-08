import { createHash } from "node:crypto";

export const META_INSIGHT_SCHEMA_VERSION = 1 as const;

export const META_SYNC_STREAMS = ["inventory", "creative", "insights"] as const;
export type MetaSyncStream = (typeof META_SYNC_STREAMS)[number];

export const META_SYNC_RUN_STATUSES = [
  "pending", "running", "partial", "completed", "failed", "cancelled",
] as const;
export type MetaSyncRunStatus = (typeof META_SYNC_RUN_STATUSES)[number];

export const META_INSIGHT_ENTITY_LEVELS = ["campaign", "ad_set", "ad"] as const;
export type MetaInsightEntityLevel = (typeof META_INSIGHT_ENTITY_LEVELS)[number];

/**
 * Additive values are only safe to sum across disjoint time/entity grains.
 * Non-additive values (notably reach) must be re-queried or kept at source grain.
 * Derived values are formulas and must retain their formula/version provenance.
 */
export const META_METRIC_AGGREGATIONS = ["additive", "non_additive", "derived"] as const;
export type MetaMetricAggregation = (typeof META_METRIC_AGGREGATIONS)[number];

export type MetaFieldAvailability = Readonly<{
  reason: "unsupported" | "permission_missing" | "unknown";
  detail?: string;
}>;

export type MetaMetricValue = Readonly<{
  metricKey: string;
  actionType?: string;
  aggregation: MetaMetricAggregation;
  /** Decimal text avoids precision loss for counts/rates returned by Graph. */
  valueDecimal?: string;
  /** Monetary values use the account's minor unit, never floating point. */
  valueMinor?: number;
  valueJson?: Readonly<Record<string, unknown>>;
  currency?: string;
  provenance: Readonly<Record<string, unknown>>;
  availability?: MetaFieldAvailability;
}>;

export type MetaDailyInsightInput = Readonly<{
  schemaVersion: typeof META_INSIGHT_SCHEMA_VERSION;
  workspaceId: string;
  metaConnectionId: string;
  adAccountId: string;
  entityLevel: MetaInsightEntityLevel;
  externalEntityId: string;
  dateStart: string;
  dateStop: string;
  attributionLabel: string;
  attributionWindow?: Readonly<Record<string, unknown>>;
  currency?: string;
  timezone?: string;
  fieldAvailability?: Readonly<Record<string, MetaFieldAvailability>>;
  sourceRevision: string;
  sourcePayloadHash: string;
  sourceUpdatedAt?: string;
  metricProvenance: Readonly<Record<string, unknown>>;
  metrics: readonly MetaMetricValue[];
}>;

export type CanonicalMetaDailyInsight = MetaDailyInsightInput & Readonly<{
  identity: string;
  contentHash: string;
}>;

export class MetaInsightValidationError extends Error {
  constructor(
    readonly code: "invalid_insight" | "invalid_metric" | "duplicate_metric" | "ad_level_budget_not_supported",
    message: string,
  ) {
    super(message);
    this.name = "MetaInsightValidationError";
  }
}

function required(value: string | undefined, label: string): string {
  if (!value?.trim()) throw new MetaInsightValidationError("invalid_insight", `${label} zorunludur`);
  return value;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, stableValue(item)]));
  }
  return value;
}

export function metaDailyInsightIdentity(input: Pick<MetaDailyInsightInput,
  "workspaceId" | "adAccountId" | "entityLevel" | "externalEntityId" | "dateStart" | "dateStop" | "attributionLabel"
>): string {
  return [
    input.workspaceId, input.adAccountId, input.entityLevel, input.externalEntityId,
    input.dateStart, input.dateStop, input.attributionLabel,
  ].join(":");
}

function assertDate(value: string, label: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00.000Z`))) {
    throw new MetaInsightValidationError("invalid_insight", `${label} ISO günü olmalıdır`);
  }
}

function validateMetric(metric: MetaMetricValue): void {
  if (!metric.metricKey.trim()) throw new MetaInsightValidationError("invalid_metric", "Metric key zorunludur");
  const valueCount = Number(metric.valueDecimal !== undefined) + Number(metric.valueMinor !== undefined) + Number(metric.valueJson !== undefined);
  if (valueCount > 1 || (valueCount === 0 && !metric.availability)) {
    throw new MetaInsightValidationError("invalid_metric", "Metric tek bir değer veya sebepli availability taşımalıdır");
  }
  if (metric.valueDecimal !== undefined && !/^-?\d+(\.\d+)?$/.test(metric.valueDecimal)) {
    throw new MetaInsightValidationError("invalid_metric", "Ondalık metric değeri decimal metin olmalıdır");
  }
  if (metric.valueMinor !== undefined && !Number.isSafeInteger(metric.valueMinor)) {
    throw new MetaInsightValidationError("invalid_metric", "Minor currency değeri güvenli tam sayı olmalıdır");
  }
  if (metric.aggregation === "derived" && !metric.provenance.formulaVersion) {
    throw new MetaInsightValidationError("invalid_metric", "Derived metric formulaVersion provenance taşımalıdır");
  }
}

export function normalizeMetaDailyInsight(input: MetaDailyInsightInput): CanonicalMetaDailyInsight {
  if (input.schemaVersion !== META_INSIGHT_SCHEMA_VERSION) {
    throw new MetaInsightValidationError("invalid_insight", "Desteklenmeyen insight şema sürümü");
  }
  required(input.workspaceId, "Workspace ID");
  required(input.metaConnectionId, "Meta connection ID");
  required(input.adAccountId, "Ad account ID");
  required(input.externalEntityId, "External entity ID");
  required(input.attributionLabel, "Attribution etiketi");
  required(input.sourceRevision, "Source revision");
  required(input.sourcePayloadHash, "Source payload hash");
  assertDate(input.dateStart, "dateStart");
  assertDate(input.dateStop, "dateStop");
  if (input.dateStart > input.dateStop) throw new MetaInsightValidationError("invalid_insight", "dateStart dateStop'tan sonra olamaz");
  if (input.sourceUpdatedAt && !Number.isFinite(Date.parse(input.sourceUpdatedAt))) {
    throw new MetaInsightValidationError("invalid_insight", "sourceUpdatedAt geçerli bir zaman olmalıdır");
  }
  if (input.entityLevel === "ad" && input.metrics.some((metric) => /budget/i.test(metric.metricKey))) {
    throw new MetaInsightValidationError("ad_level_budget_not_supported", "Ad-level insight budget metriği saklanamaz");
  }

  const metricKeys = new Set<string>();
  for (const metric of input.metrics) {
    validateMetric(metric);
    const key = `${metric.metricKey}:${metric.actionType ?? ""}`;
    if (metricKeys.has(key)) throw new MetaInsightValidationError("duplicate_metric", `Tekrarlanan metric: ${key}`);
    metricKeys.add(key);
  }
  const normalized = stableValue({
    ...input,
    metrics: [...input.metrics].sort((a, b) => `${a.metricKey}:${a.actionType ?? ""}`.localeCompare(`${b.metricKey}:${b.actionType ?? ""}`)),
  }) as MetaDailyInsightInput;
  const identity = metaDailyInsightIdentity(normalized);
  const contentHash = createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
  return { ...normalized, identity, contentHash };
}
