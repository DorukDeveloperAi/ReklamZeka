import { stableHash } from "./types";
import {
  extractMetaActionMetrics,
  META_ACTION_CAPABILITY_CATALOG,
  META_INSIGHT_CAPABILITY_CATALOG_HASH,
  META_INSIGHT_CAPABILITY_CATALOG_VERSION,
} from "@/domain/meta/insights/capability-catalog";
import {
  META_INSIGHT_SCHEMA_VERSION,
  normalizeMetaDailyInsight,
  type CanonicalMetaDailyInsight,
  type MetaInsightEntityLevel,
  type MetaMetricValue,
} from "@/domain/meta/insights/contract";

export const META_INSIGHT_MATERIALIZATION_VERSION = "meta-insight-materialization/1.0.0" as const;

export class MetaInsightMaterializationError extends Error {
  constructor(readonly code: "invalid_scope" | "invalid_page" | "duplicate_identity") {
    super(`Meta insight materialization failed: ${code}`);
    this.name = "MetaInsightMaterializationError";
  }
}

export type CanonicalMetaInsightPage = Readonly<{
  version: typeof META_INSIGHT_MATERIALIZATION_VERSION;
  workspaceId: string;
  connectionId: string;
  adAccountId: string;
  externalAccountId: string;
  entityLevel: MetaInsightEntityLevel;
  parentRunId: string;
  sliceId: string;
  cursorId: string;
  observedAt: string;
  records: readonly CanonicalMetaDailyInsight[];
  pageHash: string;
}>;

export interface MetaInsightPagePersistencePort {
  writePage(page: CanonicalMetaInsightPage): Promise<Readonly<{ inserted: number; updated: number; unchanged: number; stale: number; pageHash: string }>>;
}

/** Runtime-to-repository boundary: raw Graph records are private and must be canonicalized by the repository. */
export type MetaInsightSourcePage = Readonly<{
  workspaceId: string;
  connectionId: string;
  externalAccountId: string;
  entityLevel: MetaInsightEntityLevel;
  parentRunId: string;
  sliceId: string;
  cursorId: string;
  observedAt: string;
  records: readonly Readonly<Record<string, unknown>>[];
}>;

export interface MetaInsightSourcePagePersistencePort {
  writeSourcePage(page: MetaInsightSourcePage): Promise<Readonly<{ inserted: number; updated: number; unchanged: number; stale: number; pageHash: string }>>;
}

const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DECIMAL = /^-?\d+(?:\.\d+)?$/;
const CURRENCY = /^[A-Z]{3}$/;

function required(value: unknown): string {
  if (typeof value !== "string" || !ID.test(value)) throw new MetaInsightMaterializationError("invalid_scope");
  return value;
}

function day(value: unknown): string {
  if (typeof value !== "string" || !DATE.test(value) || !Number.isFinite(Date.parse(`${value}T00:00:00.000Z`))) {
    throw new MetaInsightMaterializationError("invalid_page");
  }
  return value;
}

function decimal(value: unknown): string | null {
  const text = typeof value === "number" || typeof value === "string" ? String(value) : null;
  return text !== null && DECIMAL.test(text) ? text : null;
}

function minor(value: string, scale: number): number | null {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return null;
  const fraction = match[3] ?? "";
  if (fraction.length > scale && /[1-9]/.test(fraction.slice(scale))) return null;
  const numeric = Number(BigInt(`${match[1] ?? ""}${match[2]}${fraction.slice(0, scale).padEnd(scale, "0")}`));
  return Number.isSafeInteger(numeric) ? numeric : null;
}

function scalar(field: string, value: unknown, aggregation: "additive" | "non_additive", provenance: Record<string, unknown>): MetaMetricValue {
  const parsed = decimal(value);
  return parsed === null
    ? Object.freeze({ metricKey: field, aggregation, provenance, availability: { reason: "unknown" as const, detail: `${field}_absent_or_malformed` } })
    : Object.freeze({ metricKey: field, aggregation, valueDecimal: parsed, provenance });
}

function entityId(level: MetaInsightEntityLevel, record: Readonly<Record<string, unknown>>): string {
  const field = level === "campaign" ? "campaign_id" : level === "ad_set" ? "adset_id" : "ad_id";
  return required(record[field]);
}

/**
 * Canonicalizes the narrow Graph insight field set requested by the v23 capability catalog.
 * Any malformed identity, date, money value, or duplicate entity/day is rejected before persistence.
 */
export function parseMetaInsightPage(input: Readonly<{
  workspaceId: string;
  connectionId: string;
  adAccountId: string;
  externalAccountId: string;
  entityLevel: MetaInsightEntityLevel;
  parentRunId: string;
  sliceId: string;
  cursorId: string;
  observedAt: string;
  currency: string;
  timezone: string;
  minorUnitScale: number;
  records: readonly Readonly<Record<string, unknown>>[];
}>): CanonicalMetaInsightPage {
  const workspaceId = required(input.workspaceId); const connectionId = required(input.connectionId);
  const adAccountId = required(input.adAccountId); const externalAccountId = required(input.externalAccountId);
  const parentRunId = required(input.parentRunId); const sliceId = required(input.sliceId); const cursorId = required(input.cursorId);
  if (!Number.isFinite(Date.parse(input.observedAt)) || !CURRENCY.test(input.currency) || !input.timezone.trim()
    || !Number.isInteger(input.minorUnitScale) || input.minorUnitScale < 0 || input.minorUnitScale > 4
    || !["campaign", "ad_set", "ad"].includes(input.entityLevel) || !Array.isArray(input.records) || input.records.length > 1_000) {
    throw new MetaInsightMaterializationError("invalid_scope");
  }
  const records = input.records.map((raw) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || required(raw.account_id) !== externalAccountId) {
      throw new MetaInsightMaterializationError("invalid_page");
    }
    const provenance = Object.freeze({ materializationVersion: META_INSIGHT_MATERIALIZATION_VERSION,
      capabilityCatalogVersion: META_INSIGHT_CAPABILITY_CATALOG_VERSION, capabilityCatalogHash: META_INSIGHT_CAPABILITY_CATALOG_HASH,
      graphApiVersion: "v23.0", observationRunRef: parentRunId, sliceRef: sliceId, cursorRef: cursorId });
    const spend = decimal(raw.spend);
    const spendMetric: MetaMetricValue = spend === null || minor(spend, input.minorUnitScale) === null
      ? Object.freeze({ metricKey: "spend", aggregation: "additive", provenance, availability: { reason: "unknown" as const, detail: "spend_absent_or_scale_invalid" } })
      : Object.freeze({ metricKey: "spend", aggregation: "additive", valueMinor: minor(spend, input.minorUnitScale)!, currency: input.currency, provenance });
    const metrics = [spendMetric,
      scalar("impressions", raw.impressions, "additive", provenance), scalar("reach", raw.reach, "non_additive", provenance),
      scalar("clicks", raw.clicks, "additive", provenance),
      ...extractMetaActionMetrics({ contracts: META_ACTION_CAPABILITY_CATALOG, actions: raw.actions, actionValues: raw.action_values,
        currency: input.currency, minorUnitScale: input.minorUnitScale }),
    ];
    const sourcePayloadHash = `sha256:${stableHash(raw)}`;
    return normalizeMetaDailyInsight({ schemaVersion: META_INSIGHT_SCHEMA_VERSION, workspaceId, metaConnectionId: connectionId,
      adAccountId, entityLevel: input.entityLevel, externalEntityId: entityId(input.entityLevel, raw),
      dateStart: day(raw.date_start), dateStop: day(raw.date_stop), attributionLabel: "account_default", currency: input.currency,
      timezone: input.timezone, sourceRevision: input.observedAt, sourcePayloadHash, metricProvenance: provenance, metrics });
  }).sort((left, right) => left.identity.localeCompare(right.identity));
  if (new Set(records.map((record) => record.identity)).size !== records.length) throw new MetaInsightMaterializationError("duplicate_identity");
  const base = { version: META_INSIGHT_MATERIALIZATION_VERSION, workspaceId, connectionId, adAccountId, externalAccountId,
    entityLevel: input.entityLevel, parentRunId, sliceId, cursorId, observedAt: new Date(input.observedAt).toISOString(), records: Object.freeze(records) };
  return Object.freeze({ ...base, pageHash: stableHash(base) });
}
