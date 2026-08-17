import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { WORKSPACE_TOMBSTONE_PURGE_TABLES } from "@/connectors/meta/workspace-tombstone-purge-drizzle-adapter";

const migration = readFileSync("drizzle/20260817160000_data_health_finding_development_log_ledger.sql", "utf8");
const schema = readFileSync("src/db/schema.ts", "utf8");
const repository = readFileSync("src/connectors/meta/data-health-finding-development-log-drizzle-repository.ts", "utf8");

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
    expect(migration).toContain("finding_heads_workspace_event_fk_idx");
    expect(migration).toContain("development_log_heads_workspace_event_fk_idx");
    expect(migration).toContain("finding_heads_workspace_eligible_scope_idx");
    expect(migration).toContain("scope_ref text NOT NULL");
    expect(migration).toContain("octet_length(observation_payload::text)<=16878");
    expect(migration).toContain("CONSTRAINT development_log_heads_contract CHECK");
    expect(schema).toContain("octet_length(${table.observationPayload}::text) <= 16878");
    expect(schema).toContain('check("development_log_heads_contract"');
  });

  it("loads only the current report account scopes, never the entire retained-head table", () => {
    expect(repository).toContain("eligibleDataHealthScopeRefs");
    expect(repository).toContain("scope_ref in (${eligibleValues})");
    expect(repository).toContain("META_DATA_HEALTH_MAX_RETAINED_FINDING_HEADS");
  });

  it("keeps immutable event history, exact-only heads, and proposed-only agent work", () => {
    expect(migration).toContain("finding_lifecycle_event_append_only_guard");
    expect(migration).toContain("finding_head_exact_advance_guard");
    expect(migration).toContain("development_log_event_append_only_guard");
    expect(migration).toContain("development_log_head_exact_advance_guard");
    expect(migration).toContain("category='data' and state='proposed' and event_type='proposed'");
    expect(migration).toContain("NEW.actor_kind='system'");
    expect(migration).toContain("NEW.actor_kind='agent' AND NEW.event_type='proposed' AND NEW.state='proposed'");
    expect(migration).toContain("BEFORE INSERT OR UPDATE OR DELETE ON development_log_events");
    expect(migration).toContain("finding head requires exact next lifecycle transition");
    expect(migration).toContain("REVOKE ALL PRIVILEGES ON TABLE finding_lifecycle_events,finding_heads,development_log_events,development_log_heads FROM PUBLIC, anon, authenticated, service_role");
  });

  it("purges derived heads before immutable evidence only during the existing workspace tombstone flow", () => {
    const start = WORKSPACE_TOMBSTONE_PURGE_TABLES.indexOf("development_log_heads");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(WORKSPACE_TOMBSTONE_PURGE_TABLES.slice(start, start + 4)).toEqual([
      "development_log_heads", "development_log_events", "finding_heads", "finding_lifecycle_events",
    ]);
    expect(migration).toContain("lifecycle_state='tombstoning'");
  });
});
