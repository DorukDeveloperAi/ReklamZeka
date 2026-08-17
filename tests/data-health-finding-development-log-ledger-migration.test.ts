import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { WORKSPACE_TOMBSTONE_PURGE_TABLES } from "@/connectors/meta/workspace-tombstone-purge-drizzle-adapter";

const migration = readFileSync("drizzle/20260817160000_data_health_finding_development_log_ledger.sql", "utf8");

describe("P01-E data-health Finding and Development Log ledger preflight", () => {
  it("has four server-private tenant-scoped tables and required indexes", () => {
    for (const table of ["finding_lifecycle_events", "finding_heads", "development_log_events", "development_log_heads"]) {
      expect(migration).toContain(`CREATE TABLE ${table}`);
      expect(migration).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      expect(migration).toContain(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
    }
    expect(migration).toContain("finding_heads_event_scope_fk");
    expect(migration).toContain("development_log_events_finding_event_scope_fk");
    expect(migration).toContain("development_log_heads_event_scope_fk");
    expect(migration).toContain("finding_lifecycle_events_workspace_fingerprint_sequence_unique");
  });

  it("keeps immutable event history, exact-only heads, and proposed-only system work", () => {
    expect(migration).toContain("finding_lifecycle_event_append_only_guard");
    expect(migration).toContain("finding_head_exact_advance_guard");
    expect(migration).toContain("development_log_event_append_only_guard");
    expect(migration).toContain("development_log_head_exact_advance_guard");
    expect(migration).toContain("category='data' and state='proposed' and event_type='proposed'");
    expect(migration).toContain("actor_kind in ('system','agent')");
    expect(migration).toContain("REVOKE ALL PRIVILEGES ON TABLE finding_lifecycle_events,finding_heads,development_log_events,development_log_heads FROM PUBLIC, anon, authenticated, service_role");
  });

  it("purges derived heads before immutable evidence only during the existing workspace tombstone flow", () => {
    expect(WORKSPACE_TOMBSTONE_PURGE_TABLES.slice(0, 4)).toEqual([
      "development_log_heads", "development_log_events", "finding_heads", "finding_lifecycle_events",
    ]);
    expect(migration).toContain("lifecycle_state='tombstoning'");
  });
});
