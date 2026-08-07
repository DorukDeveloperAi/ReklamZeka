import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type {
  WorkspaceTombstonePurgeEvidence,
  WorkspaceTombstonePurgePort,
} from "@/connectors/meta/workspace-tombstone-drizzle-service";
import { WorkspaceTombstoneError } from "@/connectors/meta/workspace-tombstone-drizzle-service";
import * as schema from "@/db/schema";

type ReklamZekaDatabase = NodePgDatabase<typeof schema>;
type DrizzleExecutor = Pick<ReklamZekaDatabase, "execute">;

type InspectionRow = Readonly<{
  table_name: string;
  row_count: number | string;
  row_revision: string;
}>;

type DeleteCountRow = Readonly<{ count: number | string }>;

/**
 * Complete, explicit allowlist of workspace-owned rows that may be destroyed.
 * It intentionally excludes workspaces, audit_events, users and meta_connections.
 */
export const WORKSPACE_TOMBSTONE_PURGE_TABLES = Object.freeze([
  "memberships",
  "data_sources",
  "ad_accounts",
  "ad_campaigns",
  "meta_ad_sets",
  "category_dimensions",
  "category_definitions",
  "category_assignments",
  "guidance_sources",
  "guidance_cards",
  "guidance_bindings",
  "guidance_sets",
  "advised_practice_definitions",
  "advised_practice_events",
  "effective_campaign_contexts",
  "effective_campaign_context_components",
  "effective_campaign_context_invalidations",
  "budget_proposal_versions",
  "budget_proposal_alternatives",
  "action_approval_policy_snapshots",
  "action_proposal_bundles",
  "action_proposal_units",
  "action_proposal_dependencies",
  "action_proposal_initial_events",
  "action_approval_decision_events",
  "action_approval_evidence_grants",
  "analysis_timeframe_definitions",
  "analysis_template_definitions",
  "decision_ledger_records",
  "decision_room_schedules",
  "decision_room_runs",
  "decision_room_schedule_analysis_bindings",
  "decision_room_run_analysis_assets",
  "decision_room_inbox_items",
  "decision_room_inbox_reads",
  "meta_assets",
  "meta_posts",
  "meta_change_snapshots",
  "meta_change_events",
  "meta_creatives",
  "meta_ads",
  "meta_asset_edges",
  "meta_asset_discoveries",
  "meta_ad_creative_bindings",
  "meta_portfolio_sync_runs",
  "meta_sync_streams",
  "meta_sync_runs",
  "meta_sync_slices",
  "meta_sync_record_ledger",
  "meta_daily_insights",
  "meta_daily_insight_metrics",
  "daily_ad_metrics",
  "sync_runs",
  "connection_secrets",
  "insights",
  "insight_feedback",
  "report_shares",
  "operational_events",
] as const);

function resultRows<T>(result: unknown): readonly T[] {
  if (!result || typeof result !== "object" || !("rows" in result) || !Array.isArray(result.rows)) {
    throw new WorkspaceTombstoneError("workspace_unavailable");
  }
  return result.rows as readonly T[];
}

function safeCount(value: number | string | undefined): number {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new WorkspaceTombstoneError("workspace_unavailable");
  }
  return count;
}

function revisionOf(rows: readonly InspectionRow[]): string {
  return createHash("sha256")
    .update(JSON.stringify(rows.map((row) => [row.table_name, safeCount(row.row_count), row.row_revision])))
    .digest("hex");
}

async function deleteCount(executor: DrizzleExecutor, statement: ReturnType<typeof sql>): Promise<number> {
  const row = resultRows<DeleteCountRow>(await executor.execute(statement))[0];
  return safeCount(row?.count);
}

/**
 * Destructive implementation used only inside DrizzleWorkspaceTombstoneStore's
 * serializable, locked caller transaction. No table name is catalog-derived.
 */
export class DrizzleWorkspaceTombstonePurgePort implements WorkspaceTombstonePurgePort {
  async inspect(executor: DrizzleExecutor, workspaceId: string): Promise<WorkspaceTombstonePurgeEvidence> {
    if (!workspaceId) throw new WorkspaceTombstoneError("invalid_input");

    const inspected = resultRows<InspectionRow>(await executor.execute(sql`
      select 'memberships' as table_name, count(*)::int as row_count,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5('')) as row_revision
      from memberships where workspace_id = ${workspaceId}::uuid
      union all select 'data_sources', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from data_sources where workspace_id = ${workspaceId}::uuid
      union all select 'ad_accounts', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from ad_accounts where workspace_id = ${workspaceId}::uuid
      union all select 'ad_campaigns', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from ad_campaigns where workspace_id = ${workspaceId}::uuid
      union all select 'meta_ad_sets', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from meta_ad_sets where workspace_id = ${workspaceId}::uuid
      union all select 'category_dimensions', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from category_dimensions where workspace_id = ${workspaceId}::uuid
      union all select 'category_definitions', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from category_definitions where workspace_id = ${workspaceId}::uuid
      union all select 'category_assignments', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from category_assignments where workspace_id = ${workspaceId}::uuid
      union all select 'guidance_sources', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from guidance_sources where workspace_id = ${workspaceId}::uuid
      union all select 'guidance_cards', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from guidance_cards where workspace_id = ${workspaceId}::uuid
      union all select 'guidance_bindings', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from guidance_bindings where workspace_id = ${workspaceId}::uuid
      union all select 'guidance_sets', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from guidance_sets where workspace_id = ${workspaceId}::uuid
      union all select 'advised_practice_definitions', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from advised_practice_definitions where workspace_id = ${workspaceId}::uuid
      union all select 'advised_practice_events', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from advised_practice_events where workspace_id = ${workspaceId}::uuid
      union all select 'effective_campaign_contexts', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from effective_campaign_contexts where workspace_id = ${workspaceId}::uuid
      union all select 'effective_campaign_context_components', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from effective_campaign_context_components where workspace_id = ${workspaceId}::uuid
      union all select 'effective_campaign_context_invalidations', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from effective_campaign_context_invalidations where workspace_id = ${workspaceId}::uuid
      union all select 'budget_proposal_versions', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from budget_proposal_versions where workspace_id = ${workspaceId}::uuid
      union all select 'budget_proposal_alternatives', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from budget_proposal_alternatives where workspace_id = ${workspaceId}::uuid
      union all select 'action_approval_policy_snapshots', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from action_approval_policy_snapshots where workspace_id = ${workspaceId}::uuid
      union all select 'action_proposal_bundles', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from action_proposal_bundles where workspace_id = ${workspaceId}::uuid
      union all select 'action_proposal_units', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from action_proposal_units where workspace_id = ${workspaceId}::uuid
      union all select 'action_proposal_dependencies', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from action_proposal_dependencies where workspace_id = ${workspaceId}::uuid
      union all select 'action_proposal_initial_events', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from action_proposal_initial_events where workspace_id = ${workspaceId}::uuid
      union all select 'action_approval_decision_events', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from action_approval_decision_events where workspace_id = ${workspaceId}::uuid
      union all select 'action_approval_evidence_grants', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from action_approval_evidence_grants where workspace_id = ${workspaceId}::uuid
      union all select 'analysis_timeframe_definitions', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from analysis_timeframe_definitions where workspace_id = ${workspaceId}::uuid
      union all select 'analysis_template_definitions', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from analysis_template_definitions where workspace_id = ${workspaceId}::uuid
      union all select 'decision_ledger_records', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from decision_ledger_records where workspace_id = ${workspaceId}::uuid
      union all select 'decision_room_schedules', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from decision_room_schedules where workspace_id = ${workspaceId}::uuid
      union all select 'decision_room_runs', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from decision_room_runs where workspace_id = ${workspaceId}::uuid
      union all select 'decision_room_schedule_analysis_bindings', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from decision_room_schedule_analysis_bindings where workspace_id = ${workspaceId}::uuid
      union all select 'decision_room_run_analysis_assets', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from decision_room_run_analysis_assets where workspace_id = ${workspaceId}::uuid
      union all select 'decision_room_inbox_items', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from decision_room_inbox_items where workspace_id = ${workspaceId}::uuid
      union all select 'decision_room_inbox_reads', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from decision_room_inbox_reads where workspace_id = ${workspaceId}::uuid
      union all select 'meta_assets', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from meta_assets where workspace_id = ${workspaceId}::uuid
      union all select 'meta_posts', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from meta_posts where workspace_id = ${workspaceId}::uuid
      union all select 'meta_change_snapshots', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from meta_change_snapshots where workspace_id = ${workspaceId}::uuid
      union all select 'meta_change_events', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from meta_change_events where workspace_id = ${workspaceId}::uuid
      union all select 'meta_creatives', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from meta_creatives where workspace_id = ${workspaceId}::uuid
      union all select 'meta_ads', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from meta_ads where workspace_id = ${workspaceId}::uuid
      union all select 'meta_asset_edges', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from meta_asset_edges where workspace_id = ${workspaceId}::uuid
      union all select 'meta_asset_discoveries', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from meta_asset_discoveries where workspace_id = ${workspaceId}::uuid
      union all select 'meta_ad_creative_bindings', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from meta_ad_creative_bindings where workspace_id = ${workspaceId}::uuid
      union all select 'meta_portfolio_sync_runs', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from meta_portfolio_sync_runs where workspace_id = ${workspaceId}::uuid
      union all select 'meta_sync_streams', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from meta_sync_streams where workspace_id = ${workspaceId}::uuid
      union all select 'meta_sync_runs', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from meta_sync_runs where workspace_id = ${workspaceId}::uuid
      union all select 'meta_sync_slices', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from meta_sync_slices where workspace_id = ${workspaceId}::uuid
      union all select 'meta_sync_record_ledger', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from meta_sync_record_ledger where workspace_id = ${workspaceId}::uuid
      union all select 'meta_daily_insights', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from meta_daily_insights where workspace_id = ${workspaceId}::uuid
      union all select 'meta_daily_insight_metrics', count(*)::int,
        coalesce(md5(string_agg(metric.id::text || ':' || metric.xmin::text || ':' || metric.ctid::text, ',' order by metric.id)), md5(''))
      from meta_daily_insight_metrics metric
      join meta_daily_insights insight on insight.id = metric.daily_insight_id
      where insight.workspace_id = ${workspaceId}::uuid
      union all select 'daily_ad_metrics', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from daily_ad_metrics where workspace_id = ${workspaceId}::uuid
      union all select 'sync_runs', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from sync_runs where workspace_id = ${workspaceId}::uuid
      union all select 'connection_secrets', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from connection_secrets where workspace_id = ${workspaceId}::uuid
      union all select 'insights', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from insights where workspace_id = ${workspaceId}::uuid
      union all select 'insight_feedback', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from insight_feedback where workspace_id = ${workspaceId}::uuid
      union all select 'report_shares', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from report_shares where workspace_id = ${workspaceId}::uuid
      union all select 'operational_events', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from operational_events where workspace_id = ${workspaceId}::uuid
      order by table_name
    `));

    if (inspected.length !== WORKSPACE_TOMBSTONE_PURGE_TABLES.length) {
      throw new WorkspaceTombstoneError("workspace_unavailable");
    }
    const names = new Set(inspected.map((row) => row.table_name));
    if (WORKSPACE_TOMBSTONE_PURGE_TABLES.some((table) => !names.has(table))) {
      throw new WorkspaceTombstoneError("workspace_unavailable");
    }
    return Object.freeze({
      revision: revisionOf(inspected),
      candidateCount: inspected.reduce((sum, row) => sum + safeCount(row.row_count), 0),
    });
  }

  async purge(executor: DrizzleExecutor, input: Readonly<{
    workspaceId: string;
    expectedRevision: string;
  }>): Promise<Readonly<{ purgedRowCount: number; membershipCount: number }>> {
    if (!input.workspaceId || !input.expectedRevision) {
      throw new WorkspaceTombstoneError("invalid_input");
    }
    const before = await this.inspect(executor, input.workspaceId);
    if (before.revision !== input.expectedRevision) {
      throw new WorkspaceTombstoneError("revision_changed");
    }

    let purgedRowCount = 0;
    const remove = async (statement: ReturnType<typeof sql>) => {
      const count = await deleteCount(executor, statement);
      purgedRowCount += count;
      return count;
    };

    // Children first. This ordering is stable to minimize lock-order deadlocks.
    await remove(sql`with removed as (delete from action_approval_evidence_grants where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from action_approval_decision_events where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from action_proposal_dependencies where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from action_proposal_initial_events where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from action_proposal_units where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from action_proposal_bundles where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from action_approval_policy_snapshots where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (
      delete from meta_daily_insight_metrics where daily_insight_id in (
        select id from meta_daily_insights where workspace_id = ${input.workspaceId}::uuid
      ) returning 1
    ) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from meta_ad_creative_bindings where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from meta_ads where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from meta_creatives where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from meta_change_events where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from meta_change_snapshots where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from meta_posts where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from meta_asset_edges where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from meta_asset_discoveries where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from meta_sync_record_ledger where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from meta_daily_insights where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from meta_sync_slices where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from meta_sync_runs where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from meta_sync_streams where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from meta_portfolio_sync_runs where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from connection_secrets where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from daily_ad_metrics where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from sync_runs where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from guidance_bindings where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from guidance_sets where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from guidance_cards where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from guidance_sources where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from advised_practice_events where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from advised_practice_definitions where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from decision_room_inbox_reads where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from decision_room_inbox_items where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from decision_room_run_analysis_assets where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from decision_room_schedule_analysis_bindings where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from decision_room_runs where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from decision_room_schedules where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from decision_ledger_records where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from budget_proposal_alternatives where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from budget_proposal_versions where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from analysis_template_definitions where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from analysis_timeframe_definitions where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from effective_campaign_context_invalidations where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from effective_campaign_context_components where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from effective_campaign_contexts where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from category_assignments where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from category_definitions where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from category_dimensions where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from meta_ad_sets where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from ad_campaigns where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from meta_assets where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from ad_accounts where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from data_sources where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from insight_feedback where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from insights where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from report_shares where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from operational_events where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    const membershipCount = await remove(sql`with removed as (delete from memberships where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);

    if (purgedRowCount !== before.candidateCount) {
      throw new WorkspaceTombstoneError("revision_changed");
    }
    const after = await this.inspect(executor, input.workspaceId);
    if (after.candidateCount !== 0) throw new WorkspaceTombstoneError("revision_changed");
    return Object.freeze({ purgedRowCount, membershipCount });
  }
}
