import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WORKSPACE_TOMBSTONE_PURGE_TABLES } from "@/connectors/meta/workspace-tombstone-purge-drizzle-adapter";

const migration = readFileSync("drizzle/20260818000300_p06_execution_persistence.sql", "utf8");
const tables = [
  "p06_execution_runs",
  "p06_execution_events",
  "p06_execution_heads",
  "p06_execution_observations",
  "p06_execution_gate_snapshots",
  "p06_rollback_proposals",
] as const;

describe("P06 execution persistence PRE migration", () => {
  it("keeps a separate v2 ledger with closed RLS and no client grants", () => {
    for (const table of tables) {
      expect(migration).toContain(`CREATE TABLE ${table}`);
      expect(migration).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      expect(migration).toContain(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
      expect(WORKSPACE_TOMBSTONE_PURGE_TABLES).toContain(table);
    }
    expect(migration).not.toContain("CREATE POLICY");
    expect(migration).toContain("FROM PUBLIC,anon,authenticated,service_role");
  });

  it("binds only exact human approval evidence and keeps rollback separately approved", () => {
    expect(migration).toContain("d.command_kind IS DISTINCT FROM 'approve'");
    expect(migration).toContain("g.capability IS DISTINCT FROM 'approval_evidence_only'");
    expect(migration).toContain("g.can_execute IS DISTINCT FROM false");
    expect(migration).toContain("requires_new_human_approval=true");
    expect(migration).toContain("route='human_approved'");
  });

  it("persists the exact ten-step trace beside lease/reclaim evidence", () => {
    for (const step of ["lease", "idempotency", "current_meta_read", "expected_before", "typed_mutation", "raw", "already_applied_no_second_write", "ambiguous_read_before_retry", "immutable_terminal", "release"]) {
      expect(migration).toContain(`'${step}'`);
    }
    expect(migration).toContain("'lease_claimed','lease_reclaimed','trace','lease_released'");
    expect(migration).toContain("p06 execution head requires exact next event CAS");
  });

  it("purges all children before the execution identity and action binding", () => {
    const positions = [
      "p06_rollback_proposals",
      "p06_execution_observations",
      "p06_execution_gate_snapshots",
      "p06_execution_heads",
      "p06_execution_events",
      "p06_execution_runs",
      "guide_run_action_bindings",
    ].map((table) => WORKSPACE_TOMBSTONE_PURGE_TABLES.indexOf(table as never));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });
});
