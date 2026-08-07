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
    expect(WORKSPACE_TOMBSTONE_PURGE_TABLES).toHaveLength(45);
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
    expect(deletes).toHaveLength(45);
    expect(deletes.findIndex((statement) => statement.includes("delete from meta_daily_insight_metrics")))
      .toBeLessThan(deletes.findIndex((statement) => statement.includes("delete from meta_daily_insights where")));
    expect(deletes.findIndex((statement) => statement.includes("delete from meta_ad_creative_bindings")))
      .toBeLessThan(deletes.findIndex((statement) => statement.includes("delete from meta_creatives where")));
    expect(deletes.findIndex((statement) => statement.includes("delete from meta_change_events")))
      .toBeLessThan(deletes.findIndex((statement) => statement.includes("delete from meta_change_snapshots")));
    expect(deletes.findIndex((statement) => statement.includes("delete from category_assignments")))
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
    expect(deletes.findIndex((statement) => statement.includes("delete from decision_ledger_records")))
      .toBeLessThan(deletes.findIndex((statement) => statement.includes("delete from effective_campaign_contexts")));
    expect(deletes.findIndex((statement) => statement.includes("delete from decision_room_inbox_reads")))
      .toBeLessThan(deletes.findIndex((statement) => statement.includes("delete from decision_room_inbox_items")));
    expect(deletes.findIndex((statement) => statement.includes("delete from decision_room_inbox_items")))
      .toBeLessThan(deletes.findIndex((statement) => statement.includes("delete from decision_room_runs")));
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
