import { createHash } from "node:crypto";
import "server-only";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { META_ACTION_CAPABILITY_CATALOG, META_INSIGHT_CAPABILITY_CATALOG_HASH } from "@/domain/meta/insights/capability-catalog";
import {
  PRIMARY_RESULT_ACTION_CATALOG_VERSION,
  type PrimaryResultActionCatalog,
  type PrimaryResultCanonicalCatalogEvidence,
  type TrustedPrimaryResultActionCatalog,
} from "@/domain/operations/primary-result";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const CANONICAL_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const CLOSED_ACTION_TYPES = new Set(META_ACTION_CAPABILITY_CATALOG
  .filter((item) => item.container === "actions" && item.outputKind === "decimal")
  .map((item) => item.actionType));
type Database = NodePgDatabase<typeof schema>;
type CanonicalActionRow = Readonly<{
  action_type: unknown; daily_insight_id: unknown;
  insight_source_payload_hash: unknown; insight_source_revision: unknown;
  metric_source_payload_hash: unknown; metric_source_revision: unknown;
  observed_at: unknown;
}>;
type ValidRow = Readonly<{
  actionType: string; dailyInsightId: string;
  insightSourcePayloadHash: string; insightSourceRevision: string;
  metricSourcePayloadHash: string; metricSourceRevision: string; observedAt: string;
}>;

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, stable(item)]));
  return value;
}
function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function sorted<T extends Record<string, string>>(rows: readonly T[]): readonly T[] { return [...rows].sort((left, right) => JSON.stringify(stable(left)).localeCompare(JSON.stringify(stable(right)))); }
function evidenceHash(input: Readonly<{ workspaceId: string; actionTypes: readonly string[]; observedThrough: string; sourceSnapshotHash: string; manifestHash: string }>): string { return hash({ workspaceId: input.workspaceId, actionTypes: [...input.actionTypes].sort(), observedThrough: input.observedThrough, sourceSnapshotHash: input.sourceSnapshotHash, manifestHash: input.manifestHash }); }
function fail(): never { throw new Error("primary result rejected: trusted_catalog_artifact"); }
function nonemptyString(value: unknown): string | null { return typeof value === "string" && value.length > 0 ? value : null; }
function canonicalIso(value: unknown): string | null { const date = value instanceof Date ? value : typeof value === "string" ? new Date(value) : null; return date && Number.isFinite(date.getTime()) ? date.toISOString() : null; }
function validRow(row: CanonicalActionRow): ValidRow | null {
  const candidate = { actionType: nonemptyString(row.action_type), dailyInsightId: nonemptyString(row.daily_insight_id), insightSourcePayloadHash: nonemptyString(row.insight_source_payload_hash), insightSourceRevision: nonemptyString(row.insight_source_revision), metricSourcePayloadHash: nonemptyString(row.metric_source_payload_hash), metricSourceRevision: nonemptyString(row.metric_source_revision), observedAt: canonicalIso(row.observed_at) };
  return candidate.actionType && CLOSED_ACTION_TYPES.has(candidate.actionType) && candidate.dailyInsightId && candidate.insightSourcePayloadHash && candidate.insightSourceRevision && candidate.metricSourcePayloadHash && candidate.metricSourceRevision && candidate.observedAt ? candidate as ValidRow : null;
}

// Identity stays private to this server-only authority. A copied, frozen
// catalog is not trusted merely because it has the same structural hash.
const trustedCatalogIdentities = new WeakSet<object>();

export function isTrustedPrimaryResultActionCatalog(value: unknown): value is TrustedPrimaryResultActionCatalog {
  return Boolean(value && typeof value === "object" && trustedCatalogIdentities.has(value));
}

/** Kept private: no caller can register arbitrary structural catalog material. */
function materializeTrustedPrimaryResultCatalog(input: Readonly<{
  workspaceId: string;
  observedActionTypes: readonly string[];
  observedThrough: string;
  sourceSnapshotHash: string;
  manifestHash: string;
}>): Readonly<{ catalog: TrustedPrimaryResultActionCatalog; canonicalEvidence: PrimaryResultCanonicalCatalogEvidence }> {
  if (!input || typeof input !== "object" || Object.keys(input).sort().join("|") !== ["workspaceId", "observedActionTypes", "observedThrough", "sourceSnapshotHash", "manifestHash"].sort().join("|") || typeof input.workspaceId !== "string" || !UUID.test(input.workspaceId) || !Array.isArray(input.observedActionTypes) || !input.observedActionTypes.length || typeof input.observedThrough !== "string" || !CANONICAL_ISO.test(input.observedThrough) || new Date(input.observedThrough).toISOString() !== input.observedThrough || typeof input.sourceSnapshotHash !== "string" || !HASH.test(input.sourceSnapshotHash) || typeof input.manifestHash !== "string" || !HASH.test(input.manifestHash)) fail();
  const actionTypes = [...new Set(input.observedActionTypes)].sort();
  if (actionTypes.length !== input.observedActionTypes.length || actionTypes.some((actionType) => typeof actionType !== "string" || !CLOSED_ACTION_TYPES.has(actionType))) fail();
  const material = { workspaceId: input.workspaceId, actionTypes, observedThrough: input.observedThrough, sourceSnapshotHash: input.sourceSnapshotHash, manifestHash: input.manifestHash } as const;
  const canonicalEvidence = Object.freeze({ ...material, canonicalEvidenceHash: evidenceHash(material) });
  const provenance = Object.freeze({ source: "meta_insights" as const, field: "actions" as const, breakdown: "action_type" as const, extraction: "exact_action_type_only" as const, observedThrough: input.observedThrough, sourceSnapshotHash: input.sourceSnapshotHash, manifestHash: input.manifestHash, canonicalEvidenceHash: canonicalEvidence.canonicalEvidenceHash });
  const catalog: PrimaryResultActionCatalog = Object.freeze({ version: PRIMARY_RESULT_ACTION_CATALOG_VERSION, workspaceId: input.workspaceId, actionTypes: Object.freeze(actionTypes), provenance, catalogHash: hash({ version: PRIMARY_RESULT_ACTION_CATALOG_VERSION, workspaceId: input.workspaceId, actionTypes, provenance }) });
  trustedCatalogIdentities.add(catalog);
  return Object.freeze({ catalog: catalog as TrustedPrimaryResultActionCatalog, canonicalEvidence });
}

/**
 * Concrete server-only authority. It accepts only a workspace ID; every action
 * selector and every provenance hash comes from the canonical Meta database.
 */
export class DrizzlePrimaryResultActionCatalogAdapter {
  constructor(private readonly database: Pick<Database, "transaction">) {}

  async load(workspaceId: string) {
    if (!UUID.test(workspaceId)) throw new Error("primary result rejected: catalog_workspace");
    return this.database.transaction(async (transaction) => {
      await transaction.execute(sql`set local transaction isolation level repeatable read`);
      await transaction.execute(sql`set local transaction read only`);
      const result = await transaction.execute(sql`
        select metric.action_type, insight.id::text as daily_insight_id,
          insight.source_payload_hash as insight_source_payload_hash,
          insight.source_revision as insight_source_revision,
          metric.source_payload_hash as metric_source_payload_hash,
          metric.source_revision as metric_source_revision,
          greatest(insight.last_seen_at, metric.last_seen_at) as observed_at
        from meta_daily_insights insight
        join meta_daily_insight_metrics metric on metric.daily_insight_id = insight.id
        where insight.workspace_id = ${workspaceId}::uuid
          and metric.metric_key = 'actions'
          and metric.action_type <> ''
      `) as { rows: CanonicalActionRow[] };
      const rows = result.rows.map(validRow).filter((row): row is ValidRow => row !== null);
      if (!rows.length) return null;
      const actionTypes = [...new Set(rows.map((row) => row.actionType))].sort();
      const observedThrough = rows.map((row) => row.observedAt).sort().at(-1)!;
      const sourceSnapshotHash = hash(sorted(rows.map(({ actionType, dailyInsightId, insightSourcePayloadHash, metricSourcePayloadHash }) => ({ actionType, dailyInsightId, insightSourcePayloadHash, metricSourcePayloadHash }))));
      const manifestHash = hash({ capabilityCatalogHash: META_INSIGHT_CAPABILITY_CATALOG_HASH, rows: sorted(rows.map(({ actionType, dailyInsightId, insightSourceRevision, metricSourceRevision }) => ({ actionType, dailyInsightId, insightSourceRevision, metricSourceRevision }))) });
      return materializeTrustedPrimaryResultCatalog({ workspaceId, observedActionTypes: actionTypes, observedThrough, sourceSnapshotHash, manifestHash });
    });
  }
}
