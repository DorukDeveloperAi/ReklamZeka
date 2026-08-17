import { stableHash, type MetaEntityLevel } from "./types";
import {
  META_OBJECTIVE_MAPPING_VERSION,
  normalizeMetaCampaignObjective,
  type CanonicalMetaObjective,
} from "@/domain/meta/objective-mapping";
import { normalizeMetaTargetingEvidence, type CanonicalMetaTargetingSummary } from "./targeting-evidence";

export const META_INVENTORY_MATERIALIZATION_VERSION = "meta-inventory-materialization/1.0.0" as const;
export const META_INVENTORY_FIELD_CATALOG_VERSION = "meta-inventory-field-catalog/2.0.0" as const;

export type MetaInventoryMaterializedLevel = Exclude<MetaEntityLevel, "account">;
export type MetaInventoryUnknownReason =
  | "missing_field"
  | "invalid_type"
  | "invalid_value"
  | "unrequested_field"
  | "mapping_unresolved"
  | "reference_unresolved"
  | "field_not_requested";

export type MetaInventoryFieldIssue = Readonly<{
  field: string;
  reason: MetaInventoryUnknownReason;
}>;

export type MetaInventoryTrace = Readonly<{
  rawPayloadHash: string;
  sourceUpdatedAt: string | null;
  fetchedAt: string;
  sourceRevision: string;
  sourceGraphVersion: string;
  fieldCatalogVersion: string;
  provenance: Readonly<{
    materializationVersion: typeof META_INVENTORY_MATERIALIZATION_VERSION;
    sourceKind: "meta_graph_inventory";
    sourceRevision: string;
    sourcePriority: 10 | 20;
    observationRunRef: string;
    sliceRef: string;
    cursorRef: string;
  }>;
}>;

type CommonRecord = Readonly<{
  externalId: string;
  name: string;
  configuredStatus: string | null;
  effectiveStatus: string | null;
  statusIssues: readonly MetaInventoryFieldIssue[];
  unsupportedFields: readonly MetaInventoryFieldIssue[];
  trace: MetaInventoryTrace;
}>;

export type CanonicalMetaInventoryCampaign = CommonRecord & Readonly<{
  level: "campaign";
  objectiveSource: string | null;
  legacyObjectiveSource: string | null;
  canonicalObjective: CanonicalMetaObjective | null;
  objectiveMappingVersion: typeof META_OBJECTIVE_MAPPING_VERSION;
  buyingType: string | null;
  specialAdCategories: readonly string[] | null;
  dailyBudgetMinor: number | null;
  lifetimeBudgetMinor: number | null;
  campaignBudgetOptimization: true | null;
}>;

export type CanonicalMetaInventoryAdSet = CommonRecord & Readonly<{
  level: "ad_set";
  externalCampaignId: string;
  optimizationGoal: string | null;
  billingEvent: string | null;
  bidStrategy: string | null;
  bidAmountMinor: number | null;
  dailyBudgetMinor: number | null;
  lifetimeBudgetMinor: number | null;
  attributionSpec: readonly Readonly<Record<string, unknown>>[] | null;
  promotedObject: Readonly<Record<string, unknown>> | null;
  targetingSummary: CanonicalMetaTargetingSummary;
  targetingSignature: string;
}>;

export type CanonicalMetaInventoryAd = CommonRecord & Readonly<{
  level: "ad";
  externalCampaignId: string;
  externalAdSetId: string;
  externalCreativeId: string | null;
}>;

export type CanonicalMetaInventoryRecord =
  | CanonicalMetaInventoryCampaign
  | CanonicalMetaInventoryAdSet
  | CanonicalMetaInventoryAd;

export type CanonicalMetaInventoryPage = Readonly<{
  version: typeof META_INVENTORY_MATERIALIZATION_VERSION;
  workspaceId: string;
  connectionId: string;
  externalAccountId: string;
  parentRunId: string;
  sliceId: string;
  cursorId: string;
  entityLevel: MetaInventoryMaterializedLevel;
  observedAt: string;
  terminal: boolean;
  records: readonly CanonicalMetaInventoryRecord[];
  pageHash: string;
}>;

export class MetaInventoryMaterializationError extends Error {
  constructor(readonly code: "invalid_scope" | "invalid_page" | "duplicate_identity", message: string) {
    super(message);
    this.name = "MetaInventoryMaterializationError";
  }
}

const ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const STATUS = /^[A-Z][A-Z0-9_]{0,63}$/;
const FIELD = /^[a-z][a-z0-9_]{0,63}$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9./_-]{0,127}$/;
const KNOWN_FIELDS: Readonly<Record<MetaInventoryMaterializedLevel, readonly string[]>> = Object.freeze({
  campaign: Object.freeze(["id", "name", "status", "effective_status", "objective", "buying_type", "special_ad_categories", "daily_budget", "lifetime_budget", "updated_time"]),
  ad_set: Object.freeze(["id", "name", "status", "effective_status", "campaign_id", "optimization_goal", "billing_event", "bid_strategy", "bid_amount", "daily_budget", "lifetime_budget", "attribution_spec", "promoted_object", "targeting", "updated_time"]),
  ad: Object.freeze(["id", "name", "status", "effective_status", "campaign_id", "adset_id", "creative", "updated_time"]),
});

function required(value: string, label: string, pattern: RegExp = ID): string {
  if (!pattern.test(value)) throw new MetaInventoryMaterializationError("invalid_scope", `${label} geçersiz`);
  return value;
}

function record(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new MetaInventoryMaterializationError("invalid_page", "Inventory kaydı nesne olmalıdır");
  }
  return value as Readonly<Record<string, unknown>>;
}

function issue(target: MetaInventoryFieldIssue[], field: string, reason: MetaInventoryUnknownReason): void {
  target.push(Object.freeze({ field, reason }));
}

function externalId(value: unknown, field: string): string {
  if (typeof value !== "string" || !ID.test(value)) {
    throw new MetaInventoryMaterializationError("invalid_page", `${field} canonical external ID içermiyor`);
  }
  return value;
}

function name(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > 512) {
    throw new MetaInventoryMaterializationError("invalid_page", "Inventory adı zorunlu ve sınırlı olmalıdır");
  }
  return value;
}

function optionalText(raw: Readonly<Record<string, unknown>>, field: string, issues: MetaInventoryFieldIssue[], pattern?: RegExp): string | null {
  if (!Object.hasOwn(raw, field)) { issue(issues, field, "missing_field"); return null; }
  const value = raw[field];
  if (value === null) return null;
  if (typeof value !== "string") { issue(issues, field, "invalid_type"); return null; }
  if (value.length === 0 || value.length > 256 || pattern && !pattern.test(value)) {
    issue(issues, field, "invalid_value"); return null;
  }
  return value;
}

function amount(raw: Readonly<Record<string, unknown>>, field: string, issues: MetaInventoryFieldIssue[]): number | null {
  if (!Object.hasOwn(raw, field)) { issue(issues, field, "missing_field"); return null; }
  const value = raw[field];
  if (value === null) return null;
  const text = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : typeof value === "string" ? value : "";
  if (!/^(0|[1-9]\d{0,15})$/.test(text)) { issue(issues, field, "invalid_value"); return null; }
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed)) { issue(issues, field, "invalid_value"); return null; }
  return parsed;
}

function instant(raw: Readonly<Record<string, unknown>>, issues: MetaInventoryFieldIssue[]): string | null {
  if (!Object.hasOwn(raw, "updated_time")) { issue(issues, "updated_time", "missing_field"); return null; }
  const value = raw.updated_time;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    issue(issues, "updated_time", typeof value === "string" ? "invalid_value" : "invalid_type");
    return null;
  }
  return new Date(value).toISOString();
}

function stringArray(raw: Readonly<Record<string, unknown>>, field: string, issues: MetaInventoryFieldIssue[]): readonly string[] | null {
  if (!Object.hasOwn(raw, field)) { issue(issues, field, "missing_field"); return null; }
  const value = raw[field];
  if (!Array.isArray(value) || value.length > 100 || value.some((entry) => typeof entry !== "string" || !STATUS.test(entry))) {
    issue(issues, field, "invalid_type"); return null;
  }
  return Object.freeze([...new Set(value)].sort());
}

function safeJson(value: unknown, depth = 0): unknown {
  if (depth > 8) throw new Error("depth");
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.length > 2_000) throw new Error("string");
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("number");
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 100) throw new Error("array");
    return value.map((entry) => safeJson(entry, depth + 1));
  }
  if (!value || typeof value !== "object") throw new Error("type");
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 100) throw new Error("object");
  const result: Record<string, unknown> = {};
  for (const [key, child] of entries.sort(([left], [right]) => left.localeCompare(right))) {
    if (!FIELD.test(key) || /(token|secret|authorization|raw[_-]?(payload|request|response|json))/i.test(key)) throw new Error("key");
    result[key] = safeJson(child, depth + 1);
  }
  return result;
}

function objectField(raw: Readonly<Record<string, unknown>>, field: string, issues: MetaInventoryFieldIssue[]): Readonly<Record<string, unknown>> | null {
  if (!Object.hasOwn(raw, field)) { issue(issues, field, "missing_field"); return null; }
  if (raw[field] === null) return null;
  try {
    const value = safeJson(raw[field]);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("shape");
    return Object.freeze(value as Record<string, unknown>);
  } catch {
    issue(issues, field, "invalid_type"); return null;
  }
}

function objectArray(raw: Readonly<Record<string, unknown>>, field: string, issues: MetaInventoryFieldIssue[]): readonly Readonly<Record<string, unknown>>[] | null {
  if (!Object.hasOwn(raw, field)) { issue(issues, field, "missing_field"); return null; }
  if (!Array.isArray(raw[field])) { issue(issues, field, "invalid_type"); return null; }
  try {
    const value = safeJson(raw[field]);
    if (!Array.isArray(value) || value.some((entry) => !entry || typeof entry !== "object" || Array.isArray(entry))) throw new Error("shape");
    return Object.freeze(value.map((entry) => Object.freeze(entry as Record<string, unknown>)));
  } catch {
    issue(issues, field, "invalid_type"); return null;
  }
}

function trace(input: ParseMetaInventoryPageInput, raw: Readonly<Record<string, unknown>>, issues: MetaInventoryFieldIssue[]): MetaInventoryTrace {
  const sourceUpdatedAt = instant(raw, issues);
  const sourceRevision = sourceUpdatedAt ?? input.observedAt;
  const sourcePriority = sourceUpdatedAt === null ? 10 as const : 20 as const;
  return Object.freeze({
    rawPayloadHash: stableHash(raw), sourceUpdatedAt, fetchedAt: input.observedAt, sourceRevision,
    sourceGraphVersion: input.sourceGraphVersion, fieldCatalogVersion: input.fieldCatalogVersion,
    provenance: Object.freeze({
      materializationVersion: META_INVENTORY_MATERIALIZATION_VERSION,
      sourceKind: "meta_graph_inventory", sourceRevision, sourcePriority,
      observationRunRef: input.parentRunId, sliceRef: input.sliceId, cursorRef: input.cursorId,
    }),
  });
}

function common(input: ParseMetaInventoryPageInput, raw: Readonly<Record<string, unknown>>, issues: MetaInventoryFieldIssue[]): CommonRecord {
  const unsupported = [...issues];
  for (const key of Object.keys(raw)) if (!KNOWN_FIELDS[input.entityLevel].includes(key)) issue(unsupported, key, "unrequested_field");
  const configuredStatus = optionalText(raw, "status", unsupported, STATUS);
  const effectiveStatus = optionalText(raw, "effective_status", unsupported, STATUS);
  const sourceTrace = trace(input, raw, unsupported);
  const statusIssues = unsupported.filter((entry) => entry.field === "status" || entry.field === "effective_status");
  return Object.freeze({
    externalId: externalId(raw.id, "id"), name: name(raw.name), configuredStatus, effectiveStatus,
    statusIssues: Object.freeze(statusIssues), unsupportedFields: Object.freeze(unsupported),
    trace: sourceTrace,
  });
}

function parseRecord(input: ParseMetaInventoryPageInput, rawValue: unknown): CanonicalMetaInventoryRecord {
  const raw = record(rawValue);
  const issues: MetaInventoryFieldIssue[] = [];
  const base = common(input, raw, issues);
  if (input.entityLevel === "campaign") {
    const unsupported = [...base.unsupportedFields];
    const objectiveSource = optionalText(raw, "objective", unsupported, STATUS);
    const objectiveMapping = normalizeMetaCampaignObjective(objectiveSource);
    if (objectiveMapping.status === "uncertain") issue(unsupported, "canonical_objective", "mapping_unresolved");
    const dailyBudgetMinor = amount(raw, "daily_budget", unsupported);
    const lifetimeBudgetMinor = amount(raw, "lifetime_budget", unsupported);
    const buyingType = optionalText(raw, "buying_type", unsupported, STATUS);
    const specialAdCategories = stringArray(raw, "special_ad_categories", unsupported);
    return Object.freeze({
      ...base, level: "campaign", unsupportedFields: Object.freeze(unsupported), objectiveSource,
      legacyObjectiveSource: objectiveMapping.sourceKind === "legacy" ? objectiveSource : null,
      canonicalObjective: objectiveMapping.canonicalObjective,
      objectiveMappingVersion: META_OBJECTIVE_MAPPING_VERSION,
      buyingType, specialAdCategories,
      dailyBudgetMinor, lifetimeBudgetMinor,
      campaignBudgetOptimization: dailyBudgetMinor !== null || lifetimeBudgetMinor !== null ? true : null,
    });
  }
  if (input.entityLevel === "ad_set") {
    const unsupported = [...base.unsupportedFields];
    const externalCampaignId = externalId(raw.campaign_id, "campaign_id");
    const optimizationGoal = optionalText(raw, "optimization_goal", unsupported, STATUS);
    const billingEvent = optionalText(raw, "billing_event", unsupported, STATUS);
    const bidStrategy = optionalText(raw, "bid_strategy", unsupported, STATUS);
    const bidAmountMinor = amount(raw, "bid_amount", unsupported);
    const dailyBudgetMinor = amount(raw, "daily_budget", unsupported);
    const lifetimeBudgetMinor = amount(raw, "lifetime_budget", unsupported);
    const attributionSpec = objectArray(raw, "attribution_spec", unsupported);
    const promotedObject = objectField(raw, "promoted_object", unsupported);
    let targetingEvidence;
    try {
      targetingEvidence = normalizeMetaTargetingEvidence({ fieldPresent: Object.hasOwn(raw, "targeting"), targeting: raw.targeting,
        scope: { workspaceId: input.workspaceId, externalAccountId: input.externalAccountId } });
    } catch {
      throw new MetaInventoryMaterializationError("invalid_page", "Ad set targeting kanıtı güvenli biçimde normalize edilemedi");
    }
    return Object.freeze({
      ...base, level: "ad_set", unsupportedFields: Object.freeze(unsupported),
      externalCampaignId, optimizationGoal, billingEvent, bidStrategy,
      bidAmountMinor, dailyBudgetMinor, lifetimeBudgetMinor, attributionSpec, promotedObject,
      targetingSummary: targetingEvidence.summary, targetingSignature: targetingEvidence.signature,
    });
  }
  const unsupported = [...base.unsupportedFields];
  issue(unsupported, "tracking_specs", "field_not_requested");
  let externalCreativeId: string | null = null;
  if (!Object.hasOwn(raw, "creative")) issue(unsupported, "creative", "missing_field");
  else if (raw.creative !== null) {
    if (!raw.creative || typeof raw.creative !== "object" || Array.isArray(raw.creative)) {
      issue(unsupported, "creative", "invalid_type");
    } else {
      const creative = raw.creative as Readonly<Record<string, unknown>>;
      try { externalCreativeId = externalId(creative.id, "creative.id"); }
      catch { issue(unsupported, "creative", "invalid_value"); }
      for (const key of Object.keys(creative)) if (key !== "id") issue(unsupported, `creative.${key}`, "unrequested_field");
    }
  }
  return Object.freeze({
    ...base, level: "ad", unsupportedFields: Object.freeze(unsupported),
    externalCampaignId: externalId(raw.campaign_id, "campaign_id"),
    externalAdSetId: externalId(raw.adset_id, "adset_id"), externalCreativeId,
  });
}

export type ParseMetaInventoryPageInput = Readonly<{
  workspaceId: string;
  connectionId: string;
  externalAccountId: string;
  parentRunId: string;
  sliceId: string;
  cursorId: string;
  entityLevel: MetaInventoryMaterializedLevel;
  observedAt: string;
  sourceGraphVersion: string;
  fieldCatalogVersion: string;
  terminal: boolean;
  records: readonly Readonly<Record<string, unknown>>[];
}>;

export function parseMetaInventoryPage(input: ParseMetaInventoryPageInput): CanonicalMetaInventoryPage {
  required(input.workspaceId, "workspaceId");
  required(input.connectionId, "connectionId");
  required(input.externalAccountId, "externalAccountId");
  required(input.parentRunId, "parentRunId");
  required(input.sliceId, "sliceId", /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,511}$/);
  if (!/^[a-f0-9]{64}$/.test(input.cursorId)) throw new MetaInventoryMaterializationError("invalid_scope", "cursorId geçersiz");
  if (!["campaign", "ad_set", "ad"].includes(input.entityLevel)
    || !Number.isFinite(Date.parse(input.observedAt))
    || !VERSION.test(input.sourceGraphVersion) || input.fieldCatalogVersion !== META_INVENTORY_FIELD_CATALOG_VERSION
    || !Array.isArray(input.records) || input.records.length > 1_000) {
    throw new MetaInventoryMaterializationError("invalid_page", "Inventory sayfa kontratı geçersiz");
  }
  const records = input.records.map((entry) => parseRecord(input, entry));
  if (new Set(records.map((entry) => entry.externalId)).size !== records.length) {
    throw new MetaInventoryMaterializationError("duplicate_identity", "Inventory sayfası tekrarlı external ID içeriyor");
  }
  const base = Object.freeze({
    version: META_INVENTORY_MATERIALIZATION_VERSION,
    workspaceId: input.workspaceId, connectionId: input.connectionId,
    externalAccountId: input.externalAccountId, parentRunId: input.parentRunId,
    sliceId: input.sliceId, cursorId: input.cursorId, entityLevel: input.entityLevel,
    observedAt: new Date(input.observedAt).toISOString(), terminal: input.terminal,
    records: Object.freeze(records),
  });
  return Object.freeze({ ...base, pageHash: stableHash(base) });
}

export type MetaInventoryWriteSummary = Readonly<{
  inserted: number;
  updated: number;
  unchanged: number;
  stale: number;
  disappeared: number;
  pageHash: string;
}>;

export interface MetaInventoryPagePersistencePort {
  /** The optional second argument is server-private source material and must never be retained or projected. */
  writePage(page: CanonicalMetaInventoryPage, privateSource?: unknown): Promise<MetaInventoryWriteSummary>;
}

export type MetaInventoryCanonicalVersion = Readonly<{
  sourceRevision: string;
  sourcePriority: number;
  payloadHash: string;
}>;

export type MetaInventoryCanonicalWriteOutcome = "inserted" | "updated" | "unchanged" | "stale";

function compareSourceRevision(left: string, right: string): number {
  const leftNumber = Number(left);
  const rightNumber = Number(right);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) return leftNumber - rightNumber;
  return left.localeCompare(right);
}

/** Higher source authority wins before revision recency is considered. */
export function classifyMetaInventoryCanonicalDelta(
  current: MetaInventoryCanonicalVersion | null,
  incoming: MetaInventoryCanonicalVersion,
): MetaInventoryCanonicalWriteOutcome {
  if (!current) return "inserted";
  if (incoming.sourcePriority < current.sourcePriority) return "stale";
  if (incoming.sourcePriority > current.sourcePriority) {
    return incoming.payloadHash === current.payloadHash ? "unchanged" : "updated";
  }
  if (compareSourceRevision(incoming.sourceRevision, current.sourceRevision) < 0) return "stale";
  return incoming.payloadHash === current.payloadHash ? "unchanged" : "updated";
}
