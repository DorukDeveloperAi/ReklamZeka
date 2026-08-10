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
  "local_agent_handoffs",
  "local_agent_sessions",
  "memberships",
  "data_sources",
  "ad_accounts",
  "ad_campaigns",
  "meta_ad_sets",
  "meta_affected_geo_snapshots",
  "meta_affected_geo_snapshot_items",
  "meta_affected_geo_snapshot_location_types",
  "meta_read_sync_schedules",
  "meta_read_sync_schedule_runs",
  "category_dimensions",
  "category_definitions",
  "category_assignments",
  "category_profile_revisions",
  "instruction_policy_raw_provenance",
  "strict_instruction_policy_revisions",
  "tenant_authority_snapshots",
  "tenant_authority_snapshot_heads",
  "account_groups",
  "account_group_revisions",
  "account_group_account_bindings",
  "policy_authority_catalog_revisions",
  "policy_authority_catalogs",
  "policy_authority_bindings",
  "policy_manual_lock_revisions",
  "authority_topics",
  "authority_topic_revisions",
  "category_topic_bindings",
  "policy_semantic_binding_revisions",
  "decision_cadence_profile_revisions",
  "progressive_formalization_revisions",
  "guidance_sources",
  "guidance_cards",
  "guidance_bindings",
  "guidance_sets",
  "autonomy_rule_revisions",
  "action_guardrail_policy_revisions",
  "approval_policy_definition_revisions",
  "meta_compatibility_artifact_revisions",
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
  "action_proposal_unit_frozen_contexts",
  "action_proposal_dependencies",
  "action_proposal_initial_events",
  "action_approval_decision_events",
  "action_approval_evidence_grants",
  "audience_preset_revisions",
  "audience_preset_authoring_revisions",
  "promotion_template_revisions",
  "promotion_template_authoring_revisions",
  "promotion_template_bindings",
  "promotion_template_binding_categories",
  "analysis_timeframe_definitions",
  "analysis_template_definitions",
  "decision_ledger_records",
  "decision_room_schedules",
  "decision_room_runs",
  "decision_room_schedule_analysis_bindings",
  "decision_room_run_analysis_assets",
  "guidance_analysis_run_bindings",
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
      union all select 'meta_affected_geo_snapshots', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from meta_affected_geo_snapshots where workspace_id = ${workspaceId}::uuid
      union all select 'meta_affected_geo_snapshot_items', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from meta_affected_geo_snapshot_items where workspace_id = ${workspaceId}::uuid
      union all select 'meta_affected_geo_snapshot_location_types', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from meta_affected_geo_snapshot_location_types where workspace_id = ${workspaceId}::uuid
      union all select 'meta_read_sync_schedules', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from meta_read_sync_schedules where workspace_id = ${workspaceId}::uuid
      union all select 'meta_read_sync_schedule_runs', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from meta_read_sync_schedule_runs where workspace_id = ${workspaceId}::uuid
      union all select 'category_dimensions', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from category_dimensions where workspace_id = ${workspaceId}::uuid
      union all select 'category_definitions', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from category_definitions where workspace_id = ${workspaceId}::uuid
      union all select 'category_assignments', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from category_assignments where workspace_id = ${workspaceId}::uuid
      union all select 'category_profile_revisions', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from category_profile_revisions where workspace_id = ${workspaceId}::uuid
      union all select 'instruction_policy_raw_provenance', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from instruction_policy_raw_provenance where workspace_id = ${workspaceId}::uuid
      union all select 'strict_instruction_policy_revisions', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from strict_instruction_policy_revisions where workspace_id = ${workspaceId}::uuid
      union all select 'progressive_formalization_revisions', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from progressive_formalization_revisions where workspace_id = ${workspaceId}::uuid
      union all select 'tenant_authority_snapshots', count(*)::int, coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5('')) from tenant_authority_snapshots where workspace_id = ${workspaceId}::uuid
      union all select 'tenant_authority_snapshot_heads', count(*)::int, coalesce(md5(string_agg(workspace_id::text || ':' || xmin::text || ':' || ctid::text, ',' order by workspace_id)), md5('')) from tenant_authority_snapshot_heads where workspace_id = ${workspaceId}::uuid
      union all select 'account_groups', count(*)::int, coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5('')) from account_groups where workspace_id = ${workspaceId}::uuid
      union all select 'account_group_revisions', count(*)::int, coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5('')) from account_group_revisions where workspace_id = ${workspaceId}::uuid
      union all select 'account_group_account_bindings', count(*)::int, coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5('')) from account_group_account_bindings where workspace_id = ${workspaceId}::uuid
      union all select 'policy_authority_catalog_revisions', count(*)::int, coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5('')) from policy_authority_catalog_revisions where workspace_id = ${workspaceId}::uuid
      union all select 'policy_authority_catalogs', count(*)::int, coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5('')) from policy_authority_catalogs where workspace_id = ${workspaceId}::uuid
      union all select 'policy_authority_bindings', count(*)::int, coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5('')) from policy_authority_bindings where workspace_id = ${workspaceId}::uuid
      union all select 'policy_manual_lock_revisions', count(*)::int, coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5('')) from policy_manual_lock_revisions where workspace_id = ${workspaceId}::uuid
      union all select 'authority_topics', count(*)::int, coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5('')) from authority_topics where workspace_id = ${workspaceId}::uuid
      union all select 'authority_topic_revisions', count(*)::int, coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5('')) from authority_topic_revisions where workspace_id = ${workspaceId}::uuid
      union all select 'category_topic_bindings', count(*)::int, coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5('')) from category_topic_bindings where workspace_id = ${workspaceId}::uuid
      union all select 'policy_semantic_binding_revisions', count(*)::int, coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5('')) from policy_semantic_binding_revisions where workspace_id = ${workspaceId}::uuid
      union all select 'decision_cadence_profile_revisions', count(*)::int, coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5('')) from decision_cadence_profile_revisions where workspace_id = ${workspaceId}::uuid
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
      union all select 'autonomy_rule_revisions', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from autonomy_rule_revisions where workspace_id = ${workspaceId}::uuid
      union all select 'action_guardrail_policy_revisions', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from action_guardrail_policy_revisions where workspace_id = ${workspaceId}::uuid
      union all select 'approval_policy_definition_revisions', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from approval_policy_definition_revisions where workspace_id = ${workspaceId}::uuid
      union all select 'meta_compatibility_artifact_revisions', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from meta_compatibility_artifact_revisions where workspace_id = ${workspaceId}::uuid
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
      union all select 'action_proposal_unit_frozen_contexts', count(*)::int, coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5('')) from action_proposal_unit_frozen_contexts where workspace_id = ${workspaceId}::uuid
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
      union all select 'audience_preset_authoring_revisions', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from audience_preset_authoring_revisions where workspace_id = ${workspaceId}::uuid
      union all select 'promotion_template_authoring_revisions', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from promotion_template_authoring_revisions where workspace_id = ${workspaceId}::uuid
      union all select 'audience_preset_revisions', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from audience_preset_revisions where workspace_id = ${workspaceId}::uuid
      union all select 'promotion_template_revisions', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from promotion_template_revisions where workspace_id = ${workspaceId}::uuid
      union all select 'promotion_template_bindings', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from promotion_template_bindings where workspace_id = ${workspaceId}::uuid
      union all select 'promotion_template_binding_categories', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from promotion_template_binding_categories where workspace_id = ${workspaceId}::uuid
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
      union all select 'guidance_analysis_run_bindings', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from guidance_analysis_run_bindings where workspace_id = ${workspaceId}::uuid
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
      union all select 'local_agent_handoffs', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from local_agent_handoffs where workspace_id = ${workspaceId}::uuid
      union all select 'local_agent_sessions', count(*)::int,
        coalesce(md5(string_agg(id::text || ':' || xmin::text || ':' || ctid::text, ',' order by id)), md5(''))
      from local_agent_sessions where workspace_id = ${workspaceId}::uuid
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
    await remove(sql`with removed as (delete from progressive_formalization_revisions where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from strict_instruction_policy_revisions where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from instruction_policy_raw_provenance where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from autonomy_rule_revisions where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from action_guardrail_policy_revisions where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from meta_compatibility_artifact_revisions where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from action_approval_evidence_grants where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from action_approval_decision_events where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from action_proposal_dependencies where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from action_proposal_initial_events where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from action_proposal_units where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from action_proposal_bundles where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from action_approval_policy_snapshots where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from approval_policy_definition_revisions where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from promotion_template_authoring_revisions where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from audience_preset_authoring_revisions where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from promotion_template_binding_categories where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from promotion_template_bindings where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from promotion_template_revisions where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from audience_preset_revisions where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
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
    await remove(sql`with removed as (delete from guidance_analysis_run_bindings where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from decision_room_schedule_analysis_bindings where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from decision_room_runs where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from decision_room_schedules where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from decision_ledger_records where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from decision_cadence_profile_revisions where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from budget_proposal_alternatives where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from budget_proposal_versions where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from analysis_template_definitions where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from analysis_timeframe_definitions where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from action_proposal_unit_frozen_contexts where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from policy_semantic_binding_revisions where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from category_topic_bindings where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from authority_topic_revisions where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from authority_topics where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from policy_authority_bindings where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from policy_manual_lock_revisions where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from policy_authority_catalog_revisions where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from policy_authority_catalogs where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from tenant_authority_snapshot_heads where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from tenant_authority_snapshots where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from account_group_account_bindings where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from account_group_revisions where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from account_groups where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from effective_campaign_context_invalidations where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from effective_campaign_context_components where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from effective_campaign_contexts where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from category_assignments where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from category_profile_revisions where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from category_definitions where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from category_dimensions where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from meta_affected_geo_snapshot_items where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from meta_affected_geo_snapshot_location_types where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from meta_affected_geo_snapshots where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from meta_read_sync_schedule_runs where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from meta_read_sync_schedules where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from meta_ad_sets where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from ad_campaigns where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from meta_assets where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from ad_accounts where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from data_sources where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from insight_feedback where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from insights where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from report_shares where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from operational_events where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from local_agent_handoffs where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    await remove(sql`with removed as (delete from local_agent_sessions where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);
    const membershipCount = await remove(sql`with removed as (delete from memberships where workspace_id = ${input.workspaceId}::uuid returning 1) select count(*)::int as count from removed`);

    if (purgedRowCount !== before.candidateCount) {
      throw new WorkspaceTombstoneError("revision_changed");
    }
    const after = await this.inspect(executor, input.workspaceId);
    if (after.candidateCount !== 0) throw new WorkspaceTombstoneError("revision_changed");
    return Object.freeze({ purgedRowCount, membershipCount });
  }
}
