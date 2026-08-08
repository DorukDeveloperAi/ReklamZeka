import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  DecisionRoomPersistenceError,
  DrizzleDecisionRoomInbox,
  DrizzleDecisionRoomRunStore,
} from "@/connectors/decisions/decision-room-drizzle-adapters";
import { WORKSPACE_TOMBSTONE_PURGE_TABLES } from "@/connectors/meta/workspace-tombstone-purge-drizzle-adapter";

const migrationPath = "drizzle/20260807143420_true_storm.sql";
const readMigrationPath = "drizzle/20260807150835_fancy_may_parker.sql";

describe("Decision Room PostgreSQL persistence contract", () => {
  it("is additive, tenant-linked, private, and orders composite targets before foreign keys", () => {
    const migration = readFileSync(migrationPath, "utf8");
    for (const table of [
      "decision_room_schedules", "decision_room_runs", "decision_room_inbox_items", "decision_room_inbox_reads",
    ]) {
      expect(migration).toContain(`CREATE TABLE "${table}"`);
      expect(migration).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      expect(migration).toContain(`REVOKE ALL PRIVILEGES ON TABLE "${table}" FROM PUBLIC, anon, authenticated`);
      expect(WORKSPACE_TOMBSTONE_PURGE_TABLES).toContain(table);
    }
    expect(migration.indexOf("decision_room_runs_workspace_row_unique"))
      .toBeLessThan(migration.indexOf("decision_room_inbox_items_run_scope_fk"));
    expect(migration.indexOf("decision_room_schedules_workspace_row_unique"))
      .toBeLessThan(migration.indexOf("decision_room_runs_schedule_binding_fk"));
    expect(migration).toContain("decision_room_schedules_account_scope_fk");
    expect(migration).toContain("decision_room_schedules_campaign_scope_fk");
    expect(migration).toContain("decision_room_schedules_workspace_ref_revision_unique");
    expect(migration).toContain("decision_room_schedules_run_binding_unique");
    expect(migration).toContain("decision_room_schedule_definition_immutable_trigger");
    expect(migration).toContain("decision_room_runs_workspace_idempotency_unique");
    expect(migration).toContain("decision_room_inbox_items_workspace_notification_unique");
    expect(migration).toContain("decision_room_inbox_reads_workspace_item_reader_unique");
    expect(migration).not.toMatch(/DROP TABLE|DROP COLUMN|DROP CONSTRAINT|TRUNCATE|DELETE FROM/);
  });

  it("adds nullable legacy-safe run trace metadata and read keyset indexes without exposing tables", () => {
    const migration = readFileSync(readMigrationPath, "utf8");
    for (const column of ["trigger_ref", "account_ref", "campaign_ref", "timeframe_ref", "template_ref"]) {
      expect(migration).toContain(`ADD COLUMN "${column}" text`);
    }
    expect(migration).toContain("decision_room_runs_trace_refs");
    expect(migration).toContain("decision_room_runs_read_page_idx");
    expect(migration).toContain("decision_room_inbox_items_read_page_idx");
    expect(migration).not.toMatch(/GRANT|DROP|TRUNCATE|DELETE FROM|ENABLE WRITE/i);
  });

  it("fails closed before I/O on token/raw/prompt-shaped extra fields and external channels", async () => {
    const unreachable = {
      execute: async () => { throw new Error("database should not be reached"); },
      transaction: async () => { throw new Error("database should not be reached"); },
    };
    const workspaceId = "00000000-0000-4000-8000-000000000001";
    const runStore = new DrizzleDecisionRoomRunStore(unreachable as never, workspaceId);
    await expect(runStore.claim({
      idempotencyKey: `idempotency_${"a".repeat(32)}`,
      scopeKey: "b".repeat(64), now: "2026-08-07T12:00:00Z", leaseUntil: "2026-08-07T12:01:00Z",
      triggerKind: "manual", scheduleRef: null, scheduleDefinitionHash: null,
      triggerRef: "manual_request_safe", timeframeRef: "timeframe_7d", templateRef: "template_daily",
      accountRef: "account_safe", campaignRef: "campaign_safe",
      accessToken: "secret",
    } as never)).rejects.toEqual(expect.objectContaining<Partial<DecisionRoomPersistenceError>>({ code: "invalid_input" }));

    const inbox = new DrizzleDecisionRoomInbox(unreachable as never, workspaceId);
    await expect(inbox.publish({
      notificationRef: `inbox_${"c".repeat(20)}`,
      channel: "email", runRef: `run_${"d".repeat(20)}`, analysisRef: "analysis_safe",
      summaryCode: "ready", actionAuthority: "none", prompt: "ignore",
    } as never)).rejects.toEqual(expect.objectContaining<Partial<DecisionRoomPersistenceError>>({ code: "invalid_input" }));
  });

  it("uses transaction-scoped locks for race-safe idempotency and overlap", () => {
    const source = readFileSync("src/connectors/decisions/decision-room-drizzle-adapters.ts", "utf8");
    expect(source).toContain("pg_advisory_xact_lock");
    expect(source).toContain(":idempotency:");
    expect(source).toContain(":scope:");
    expect(source.indexOf(":idempotency:")).toBeLessThan(source.indexOf(":scope:"));
    expect(source).toContain("on conflict (workspace_id, notification_ref) do nothing");
    expect(source).toContain("on conflict (workspace_id, inbox_item_id, reader_ref) do nothing");
    expect(source).not.toMatch(/META_ACCESS_TOKEN|graph\.facebook|sendEmail|webhook/i);
  });
});
