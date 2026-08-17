import { createHash } from "node:crypto";
import "server-only";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { META_ACTION_CAPABILITY_CATALOG, META_INSIGHT_CAPABILITY_CATALOG_HASH } from "@/domain/meta/insights/capability-catalog";
import { materializeTrustedPrimaryResultCatalog } from "@/domain/operations/internal/trusted-primary-result-catalog";

type Database = NodePgDatabase<typeof schema>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTION_TYPES = new Set(META_ACTION_CAPABILITY_CATALOG
  .filter((item) => item.container === "actions" && item.outputKind === "decimal")
  .map((item) => item.actionType));

type CanonicalActionRow = Readonly<{
  action_type: unknown;
  daily_insight_id: unknown;
  insight_source_payload_hash: unknown;
  insight_source_revision: unknown;
  metric_source_payload_hash: unknown;
  metric_source_revision: unknown;
  observed_at: unknown;
}>;
type ValidRow = Readonly<{
  actionType: string; dailyInsightId: string;
  insightSourcePayloadHash: string; insightSourceRevision: string;
  metricSourcePayloadHash: string; metricSourceRevision: string;
  observedAt: string;
}>;

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, stable(item)]));
  return value;
}
function hash(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function sorted<T extends Record<string, string>>(rows: readonly T[]): readonly T[] {
  return [...rows].sort((left, right) => JSON.stringify(stable(left)).localeCompare(JSON.stringify(stable(right))));
}
function nonemptyString(value: unknown): string | null { return typeof value === "string" && value.length > 0 ? value : null; }
function canonicalIso(value: unknown): string | null {
  const date = value instanceof Date ? value : typeof value === "string" ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
}
function validRow(row: CanonicalActionRow): ValidRow | null {
  const candidate = {
    actionType: nonemptyString(row.action_type), dailyInsightId: nonemptyString(row.daily_insight_id),
    insightSourcePayloadHash: nonemptyString(row.insight_source_payload_hash), insightSourceRevision: nonemptyString(row.insight_source_revision),
    metricSourcePayloadHash: nonemptyString(row.metric_source_payload_hash), metricSourceRevision: nonemptyString(row.metric_source_revision), observedAt: canonicalIso(row.observed_at),
  };
  return candidate.actionType && ACTION_TYPES.has(candidate.actionType) && candidate.dailyInsightId
    && candidate.insightSourcePayloadHash && candidate.insightSourceRevision
    && candidate.metricSourcePayloadHash && candidate.metricSourceRevision && candidate.observedAt
    ? candidate as ValidRow : null;
}

/**
 * Server-only catalog authority. Its public input is only a workspace UUID;
 * action types, source hashes, and freshness are derived from a tenant-scoped
 * canonical Meta query and cannot be supplied by an HTTP caller.
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
