import { getTableName, isTable } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import {
  DrizzleWorkspaceTombstonePurgePort,
  WORKSPACE_TOMBSTONE_PURGE_TABLES,
} from "@/connectors/meta/workspace-tombstone-purge-drizzle-adapter";
import * as schema from "@/db/schema";

const workspaceId = "00000000-0000-0000-0000-000000000001";

function inspectionRows(nonEmpty = false) {
  return [...WORKSPACE_TOMBSTONE_PURGE_TABLES]
    .sort()
    .map((table_name, index) => ({
      table_name,
      row_count: nonEmpty && index === 0 ? 1 : 0,
      row_revision: nonEmpty && index === 0 ? "changed" : "empty",
    }));
}

describe("explicit workspace tombstone purge adapter", () => {
  it("inspects the complete non-audit allowlist without catalog-derived table names", async () => {
    const dialect = new PgDialect();
    let rendered = "";
    const executor = {
      execute: vi.fn(async (query: Parameters<PgDialect["sqlToQuery"]>[0]) => {
        rendered = dialect.sqlToQuery(query).sql;
        return { rows: inspectionRows(true) };
      }),
    };
    const port = new DrizzleWorkspaceTombstonePurgePort();
    const evidence = await port.inspect(executor as never, workspaceId);

    expect(evidence.candidateCount).toBe(1);
    expect(evidence.revision).toMatch(/^[a-f0-9]{64}$/);
    expect(WORKSPACE_TOMBSTONE_PURGE_TABLES).toHaveLength(120);
    const allSchemaTables = Object.values(schema)
      .flatMap((value) => isTable(value) ? [getTableName(value)] : [])
      .sort();
    const protectedTables = ["audit_events", "meta_connections", "users", "workspaces"];
    expect([...WORKSPACE_TOMBSTONE_PURGE_TABLES].sort()).toEqual(
      allSchemaTables.filter((table) => !protectedTables.includes(table)),
    );
    for (const table of WORKSPACE_TOMBSTONE_PURGE_TABLES) expect(rendered).toContain(`from ${table}`);
    expect(rendered).not.toMatch(/pg_catalog|information_schema/);
    expect(rendered).not.toMatch(/from (?:workspaces|audit_events|users|meta_connections)(?:\s|$)/);
  });

  it("fails closed on a changed revision before issuing any delete", async () => {
    const executor = { execute: vi.fn(async () => ({ rows: inspectionRows(true) })) };
    const port = new DrizzleWorkspaceTombstonePurgePort();

    await expect(port.purge(executor as never, {
      workspaceId,
      expectedRevision: "stale",
    })).rejects.toMatchObject({ code: "revision_changed" });
    expect(executor.execute).toHaveBeenCalledOnce();
  });

  it("deletes every allowed table in FK-safe order and verifies zero survivors", async () => {
    const dialect = new PgDialect();
    const statements: string[] = [];
    let inspectCalls = 0;
    const executor = {
      execute: vi.fn(async (query: Parameters<PgDialect["sqlToQuery"]>[0]) => {
        const statement = dialect.sqlToQuery(query).sql;
        statements.push(statement);
        if (statement.includes("union all select 'data_sources'")) {
          inspectCalls += 1;
          return { rows: inspectionRows(false) };
        }
        return { rows: [{ count: 0 }] };
      }),
    };
    const port = new DrizzleWorkspaceTombstonePurgePort();
    const evidence = await port.inspect(executor as never, workspaceId);
    const result = await port.purge(executor as never, { workspaceId, expectedRevision: evidence.revision });

    expect(result).toEqual({ purgedRowCount: 0, membershipCount: 0 });
    expect(inspectCalls).toBe(3);
    const deletes = statements.filter((statement) => statement.includes("delete from"));
    expect(deletes).toHaveLength(120);
    expect(deletes.findIndex((statement) => statement.includes("delete from candidate_preview_binding_invalidations")))
      .toBeLessThan(deletes.findIndex((statement) => statement.includes("delete from candidate_preview_binding_heads")));
    expect(deletes.findIndex((statement) => statement.includes("delete from candidate_preview_binding_heads")))
      .toBeLessThan(deletes.findIndex((statement) => statement.includes("delete from candidate_preview_binding_revisions")));
    expect(deletes.findIndex((statement) => statement.includes("delete from candidate_preview_binding_revisions")))
      .toBeLessThan(deletes.findIndex((statement) => statement.includes("delete from progressive_formalization_revisions")));
    expect(deletes.findIndex((statement) => statement.includes("delete from candidate_preview_binding_revisions")))
      .toBeLessThan(deletes.findIndex((statement) => statement.includes("delete from strict_instruction_policy_revisions")));
    expect(deletes.findIndex((statement) => statement.includes("delete from candidate_preview_binding_revisions")))
      .toBeLessThan(deletes.findIndex((statement) => statement.includes("delete from guidance_sets")));
    expect(deletes.findIndex((statement) => statement.includes("delete from candidate_preview_binding_revisions")))
      .toBeLessThan(deletes.findIndex((statement) => statement.includes("delete from tenant_authority_snapshots")));
    expect(deletes.findIndex((statement) => statement.includes("delete from action_execution_events")))
      .toBeLessThan(deletes.findIndex((statement) => statement.includes("delete from action_execution_attempts")));
    expect(deletes.findIndex((statement) => statement.includes("delete from action_execution_attempts")))
      .toBeLessThan(deletes.findIndex((statement) => statement.includes("delete from action_approval_evidence_grants")));
    expect(deletes.findIndex((statement) => statement.includes("delete from guidance_analysis_run_bindings")))
      .toBeLessThan(deletes.findIndex((statement) => statement.includes("delete from decision_room_runs")));
    expect(deletes.findIndex((statement) => statement.includes("delete from strict_instruction_policy_revisions")))
      .toBeLessThan(deletes.findIndex((statement) => statement.includes("delete from instruction_policy_raw_provenance")));
    expect(deletes.findIndex((statement) => statement.includes("delete from local_agent_handoffs")))
      .toBeLessThan(deletes.findIndex((statement) => statement.includes("delete from local_agent_sessions")));
    expect(deletes.findIndex((statement) => statement.includes("delete from local_agent_sessions")))
      .toBeLessThan(deletes.findIndex((statement) => statement.includes("delete from memberships")));
    expect(deletes.findIndex((statement) => statement.includes("delete from action_proposal_dependencies")))
      .toBeLessThan(deletes.findIndex((statement) => statement.includes("delete from action_proposal_units")));
    expect(deletes.findIndex((statement) => statement.includes("delete from action_proposal_units")))
      .toBeLessThan(deletes.findIndex((statement) => statement.includes("delete from action_proposal_bundles")));
    expect(deletes.findIndex((statement) => statement.includes("delete from action_proposal_bundles")))
      .toBeLessThan(deletes.findIndex((statement) => statement.includes("delete from action_approval_policy_snapshots")));
    expect(deletes.findIndex((statement) => statement.includes("delete from action_approval_policy_snapshots")))
      .toBeLessThan(deletes.findIndex((statement) => statement.includes("delete from approval_policy_definition_revisions")));
    expect(deletes.findIndex((statement) => statement.includes("delete from meta_affected_geo_snapshot_items")))
      .toBeLessThan(deletes.findIndex((statement) => statement.includes("delete from meta_affected_geo_snapshots")));
    expect(deletes.findIndex((statement) => statement.includes("delete from meta_affected_geo_snapshot_location_types")))
      .toBeLessThan(deletes.findIndex((statement) => statement.includes("delete from meta_affected_geo_snapshots")));
    expect(deletes.findIndex((statement) => statement.includes("delete from meta_affected_geo_snapshots")))
      .toBeLessThan(deletes.findIndex((statement) => statement.includes("delete from meta_ad_sets")));
    expect(deletes.findIndex((statement) => statement.includes("delete from meta_read_sync_schedule_runs")))
      .toBeLessThan(deletes.findIndex((statement) => statement.includes("delete from meta_read_sync_schedules")));
    expect(deletes.findIndex((statement) => statement.includes("delete from promotion_template_binding_categories")))
      .toBeLessThan(deletes.findIndex((statement) => statement.includes("delete from promotion_template_bindings")));
    expect(deletes.findIndex((statement) => statement.includes("delete from promotion_template_bindings")))
      .toBeLessThan(deletes.findIndex((statement) => statement.includes("delete from promotion_template_revisions")));
    expect(deletes.findIndex((statement) => statement.includes("delete from promotion_template_revisions")))
      .toBeLessThan(deletes.findIndex((statement) => statement.includes("delete from audience_preset_revisions")));
    expect(deletes.findIndex((statement) => statement.includes("delete from promotion_template_binding_categories")))
      .toBeLessThan(deletes.findIndex((statement) => statement.includes("delete from category_definitions")));
    expect(deletes.findIndex((statement) => statement.includes("delete from meta_daily_insight_metrics")))
      .toBeLessThan(deletes.findIndex((statement) => statement.includes("delete from meta_daily_insights where")));
    expect(deletes.findIndex((statement) => statement.includes("delete from deterministic_feature_snapshot_sources")))
      .toBeLessThan(deletes.findIndex((statement) => statement.includes("delete from deterministic_feature_snapshots")));
    expect(deletes.findIndex((statement) => statement.includes("delete from deterministic_feature_snapshot_invalidations")))
      .toBeLessThan(deletes.findIndex((statement) => statement.includes("delete from deterministic_feature_snapshot_sources")));
    expect(deletes.findIndex((statement) => statement.includes("delete from deterministic_window_snapshot_features")))
      .toBeLessThan(deletes.findIndex((statement) => statement.includes("delete from deterministic_window_snapshots")));
    expect(deletes.findIndex((statement) => statement.includes("delete from deterministic_window_snapshots")))
      .toBeLessThan(deletes.findIndex((statement) => statement.includes("delete from deterministic_feature_snapshots")));
    expect(deletes.findIndex((statement) => statement.includes("delete from deterministic_feature_snapshots")))
      .toBeLessThan(deletes.findIndex((statement) => statement.includes("delete from meta_daily_insights where")));
    expect(deletes.findIndex((statement) => statement.includes("delete from meta_ad_creative_bindings")))
      .toBeLessThan(deletes.findIndex((statement) => statement.includes("delete from meta_creatives where")));
    expect(deletes.findIndex((statement) => statement.includes("delete from meta_change_events")))
      .toBeLessThan(deletes.findIndex((statement) => statement.includes("delete from meta_change_snapshots")));
    expect(deletes.findIndex((statement) => statement.includes("delete from category_assignments")))
      .toBeLessThan(deletes.findIndex((statement) => statement.includes("delete from category_definitions")));
    expect(deletes.findIndex((statement) => statement.includes("delete from category_profile_revisions")))
      .toBeLessThan(deletes.findIndex((statement) => statement.includes("delete from category_definitions")));
    expect(deletes.findIndex((statement) => statement.includes("delete from guidance_bindings")))
      .toBeLessThan(deletes.findIndex((statement) => statement.includes("delete from guidance_cards")));
    expect(deletes.findIndex((statement) => statement.includes("delete from guidance_sets")))
      .toBeLessThan(deletes.findIndex((statement) => statement.includes("delete from guidance_cards")));
    expect(deletes.findIndex((statement) => statement.includes("delete from guidance_cards")))
      .toBeLessThan(deletes.findIndex((statement) => statement.includes("delete from guidance_sources")));
    expect(deletes.findIndex((statement) => statement.includes("delete from advised_practice_events")))
      .toBeLessThan(deletes.findIndex((statement) => statement.includes("delete from advised_practice_definitions")));
    expect(deletes.findIndex((statement) => statement.includes("delete from effective_campaign_context_invalidations")))
      .toBeLessThan(deletes.findIndex((statement) => statement.includes("delete from effective_campaign_contexts")));
    expect(deletes.findIndex((statement) => statement.includes("delete from effective_campaign_context_components")))
      .toBeLessThan(deletes.findIndex((statement) => statement.includes("delete from effective_campaign_contexts")));
    expect(deletes.findIndex((statement) => statement.includes("delete from effective_campaign_policy_composition_items")))
      .toBeLessThan(deletes.findIndex((statement) => statement.includes("delete from effective_campaign_policy_compositions")));
    expect(deletes.findIndex((statement) => statement.includes("delete from effective_campaign_policy_compositions")))
      .toBeLessThan(deletes.findIndex((statement) => statement.includes("delete from effective_campaign_contexts")));
    expect(deletes.findIndex((statement) => statement.includes("delete from decision_ledger_records")))
      .toBeLessThan(deletes.findIndex((statement) => statement.includes("delete from effective_campaign_contexts")));
    expect(deletes.findIndex((statement) => statement.includes("delete from budget_proposal_alternatives")))
      .toBeLessThan(deletes.findIndex((statement) => statement.includes("delete from budget_proposal_versions")));
    expect(deletes.findIndex((statement) => statement.includes("delete from budget_proposal_versions")))
      .toBeLessThan(deletes.findIndex((statement) => statement.includes("delete from effective_campaign_contexts")));
    expect(deletes.findIndex((statement) => statement.includes("delete from decision_room_inbox_reads")))
      .toBeLessThan(deletes.findIndex((statement) => statement.includes("delete from decision_room_inbox_items")));
    expect(deletes.findIndex((statement) => statement.includes("delete from decision_room_inbox_items")))
      .toBeLessThan(deletes.findIndex((statement) => statement.includes("delete from decision_room_runs")));
    expect(deletes.findIndex((statement) => statement.includes("delete from decision_room_run_analysis_assets")))
      .toBeLessThan(deletes.findIndex((statement) => statement.includes("delete from decision_room_runs")));
    expect(deletes.findIndex((statement) => statement.includes("delete from decision_room_schedule_analysis_bindings")))
      .toBeLessThan(deletes.findIndex((statement) => statement.includes("delete from decision_room_schedules")));
    expect(deletes.findIndex((statement) => statement.includes("delete from analysis_template_definitions")))
      .toBeLessThan(deletes.findIndex((statement) => statement.includes("delete from effective_campaign_contexts")));
    expect(deletes.findIndex((statement) => statement.includes("delete from analysis_template_definitions")))
      .toBeLessThan(deletes.findIndex((statement) => statement.includes("delete from analysis_timeframe_definitions")));
    expect(deletes.findIndex((statement) => statement.includes("delete from decision_room_runs")))
      .toBeLessThan(deletes.findIndex((statement) => statement.includes("delete from decision_room_schedules")));
    expect(deletes.findIndex((statement) => statement.includes("delete from decision_room_schedules")))
      .toBeLessThan(deletes.findIndex((statement) => statement.includes("delete from ad_campaigns")));
    expect(deletes.findIndex((statement) => statement.includes("delete from category_definitions")))
      .toBeLessThan(deletes.findIndex((statement) => statement.includes("delete from category_dimensions")));
    expect(deletes.findIndex((statement) => statement.includes("delete from category_assignments")))
      .toBeLessThan(deletes.findIndex((statement) => statement.includes("delete from ad_campaigns")));
    expect(deletes.at(-1)).toContain("memberships");
    expect(deletes.join("\n")).not.toMatch(/delete from (?:workspaces|audit_events|users|meta_connections)(?:\s|$)/);
  });
});
