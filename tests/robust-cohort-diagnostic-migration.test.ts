import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WORKSPACE_TOMBSTONE_PURGE_TABLES } from "@/connectors/meta/workspace-tombstone-purge-drizzle-adapter";

const migration = readFileSync("drizzle/20260811161831_little_dexter_bennett.sql", "utf8");

describe("robust cohort diagnostic asset migration", () => {
  it("is tenant-bound, private, append-only and structurally advisory-only", () => {
    expect(migration).toContain('CREATE TABLE "robust_cohort_diagnostic_assets"');
    expect(migration).toContain("robust_cohort_diagnostic_assets_target_scope_fk");
    expect(migration).toContain('ALTER TABLE "robust_cohort_diagnostic_assets" ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('ALTER TABLE "robust_cohort_diagnostic_assets" FORCE ROW LEVEL SECURITY');
    expect(migration).toContain('REVOKE ALL PRIVILEGES ON TABLE "robust_cohort_diagnostic_assets" FROM PUBLIC, anon, authenticated, service_role');
    expect(migration).toContain("robust_cohort_diagnostic_asset_append_only");
    expect(migration).toContain("lifecycle_state = 'tombstoning'");
    expect(migration).toContain('"canAccessNetwork":false');
  });

  it("is purged before its frozen-evidence parent", () => {
    expect(WORKSPACE_TOMBSTONE_PURGE_TABLES).toContain("robust_cohort_diagnostic_assets");
    const source = readFileSync("src/connectors/meta/workspace-tombstone-purge-drizzle-adapter.ts", "utf8");
    expect(source.indexOf("delete from robust_cohort_diagnostic_assets")).toBeLessThan(source.indexOf("delete from frozen_diagnostic_evidence"));
  });
});
