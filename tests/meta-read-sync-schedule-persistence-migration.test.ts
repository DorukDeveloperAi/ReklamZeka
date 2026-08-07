import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(new URL("../drizzle/20260807214346_meta_read_sync_schedule_persistence.sql", import.meta.url), "utf8");

describe("Meta read-sync schedule persistence migration", () => {
  it("pins DB-only active read-only bindings and tenant-composite relationships", () => {
    expect(migration).toContain('ADD COLUMN "access_mode" text DEFAULT \'read_only\' NOT NULL');
    expect(migration).toContain('"meta_connections"."access_mode" = \'read_only\'');
    expect(migration).toContain('FOREIGN KEY ("workspace_id","connection_id")');
    expect(migration).toContain('FOREIGN KEY ("workspace_id","schedule_id","connection_id")');
    expect(migration).toContain('(\"workspace_id\",\"scope_key\",\"state\",\"lease_until\")');
    expect(migration.indexOf('CREATE UNIQUE INDEX "meta_read_sync_schedules_workspace_binding_unique"'))
      .toBeLessThan(migration.indexOf('ADD CONSTRAINT "meta_read_sync_schedule_runs_workspace_schedule_fk"'));
  });

  it("enforces daily revision/timeframe, attempt cap, token and terminal lifecycle", () => {
    expect(migration).toContain('"trigger_kind" = \'daily\'');
    expect(migration).toContain('"timeframe_days" between 1 and 90');
    expect(migration).toContain('"attempt" between 1 and 5');
    expect(migration).toContain("'^lease_[a-f0-9]{32}$'");
    expect(migration).toContain('"state" = \'completed\'');
    expect(migration).toContain('"state" = \'failed\'');
    expect(migration).toContain("'rate_limited', 'transient', 'partial_result', 'sync_failed'");
  });

  it("forces RLS, revokes Data API roles and creates no public policy or cron activation", () => {
    for (const table of ["meta_read_sync_schedules", "meta_read_sync_schedule_runs"]) {
      expect(migration).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      expect(migration).toContain(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
      expect(migration).toContain(`REVOKE ALL PRIVILEGES ON TABLE ${table} FROM PUBLIC, anon, authenticated`);
    }
    expect(migration).not.toMatch(/CREATE\s+POLICY|GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE|ALL)|cron\.|pg_cron|http|net\./i);
  });
});
