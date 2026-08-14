import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WORKSPACE_TOMBSTONE_PURGE_TABLES } from
  "@/connectors/meta/workspace-tombstone-purge-drizzle-adapter";

const migration = readFileSync("drizzle/20260813123350_majestic_george_stacy.sql", "utf8");

describe("Orchestrator conversation ledger migration", () => {
  it("creates conversation/turn/message/tombstone storage with tenant-leftmost indexes", () => {
    for (const table of ["orchestrator_conversations", "orchestrator_conversation_turns",
      "orchestrator_conversation_messages", "orchestrator_conversation_tombstones"]) {
      expect(migration).toContain(`CREATE TABLE \"${table}\"`);
      expect(migration).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      expect(migration).toContain(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
      expect(migration).toContain(`REVOKE ALL PRIVILEGES ON TABLE ${table} FROM PUBLIC, anon, authenticated, service_role`);
      expect(migration).toContain(`CREATE TRIGGER ${table}_immutable`);
      expect(WORKSPACE_TOMBSTONE_PURGE_TABLES).toContain(table);
    }
    expect(migration).toContain("orchestrator_conversation_messages_sequence_unique");
    expect(migration).toContain("orchestrator_conversation_tombstones_conversation_unique");
  });

  it("installs referenced unique indexes before composite foreign keys and permits only tombstone purge deletion", () => {
    expect(migration.indexOf("orchestrator_conversation_turns_workspace_conversation_ref_unique"))
      .toBeLessThan(migration.indexOf("orchestrator_conversation_messages_workspace_turn_fk"));
    expect(migration.indexOf("orchestrator_conversations_workspace_ref_unique"))
      .toBeLessThan(migration.indexOf("orchestrator_conversation_turns_workspace_conversation_fk"));
    expect(migration).toContain("lifecycle_state = 'tombstoning'");
    expect(migration).toContain("orchestrator conversation ledger is append-only");
    expect(migration).toContain("SECURITY INVOKER SET search_path = ''");
    expect(migration).not.toMatch(/security definer/i);
  });
});
