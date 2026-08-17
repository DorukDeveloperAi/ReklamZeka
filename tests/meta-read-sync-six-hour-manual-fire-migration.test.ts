import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(new URL("../drizzle/20260817114500_meta_read_sync_six_hour_manual_fire.sql", import.meta.url), "utf8");
const journal = readFileSync(new URL("../drizzle/meta/_journal.json", import.meta.url), "utf8");

describe("P01-A six-hour/manual sync-fire migration", () => {
  it("keeps the schedule private, advances only six-hour slots, and serializes active scope leases", () => {
    expect(migration).toContain("'interval_6h'");
    expect(migration).toContain("'manual'");
    expect(migration).toContain("meta_read_sync_schedule_runs_active_scope_lease_exclusion");
    expect(migration).toContain('"workspace_id" WITH =');
    expect(migration).toContain('"connection_id" WITH =');
    expect(migration).toContain("tstzrange(\"started_at\", \"lease_until\", '[)')");
    expect(migration).toContain("CREATE EXTENSION IF NOT EXISTS btree_gist");
    expect(migration).toContain("FROM PUBLIC, anon, authenticated, service_role");
    expect(migration).not.toMatch(/CREATE\s+POLICY|GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE|ALL)|cron\.|pg_cron|http|net\./i);
  });
  it("is registered for forward migration application", () => {
    expect(journal).toContain("20260817114500_meta_read_sync_six_hour_manual_fire");
  });
});
