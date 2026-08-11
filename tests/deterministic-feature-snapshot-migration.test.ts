import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WORKSPACE_TOMBSTONE_PURGE_TABLES } from "@/connectors/meta/workspace-tombstone-purge-drizzle-adapter";

const migration = readFileSync("drizzle/20260810181555_lean_wendell_rand.sql", "utf8");
const scopeTargetMigration = readFileSync("drizzle/20260807134751_handy_nekra.sql", "utf8");

describe("deterministic feature snapshot migration", () => {
  it("keeps tenant-scoped L2 headers and exact L1 source rows private and immutable", () => {
    for (const table of ["deterministic_feature_snapshots", "deterministic_feature_snapshot_sources"]) {
      expect(migration).toContain(`CREATE TABLE \"${table}\"`);
      expect(migration).toContain(`ALTER TABLE \"${table}\" ENABLE ROW LEVEL SECURITY`);
      expect(migration).toContain(`ALTER TABLE \"${table}\" FORCE ROW LEVEL SECURITY`);
      expect(WORKSPACE_TOMBSTONE_PURGE_TABLES).toContain(table);
    }
    expect(migration).toContain("deterministic_feature_snapshot_sources_insight_scope_fk");
    expect(migration).toContain("meta_daily_insights_workspace_id_unique");
    expect(migration).toContain("deterministic_feature_snapshot_guard");
    expect(migration).toContain("lifecycle_state = 'tombstoning'");
    expect(migration).toContain("REVOKE ALL PRIVILEGES ON TABLE \"deterministic_feature_snapshots\"");
  });

  it("adds an append-only, tenant-scoped L1 change journal without rewriting historical features", () => {
    const invalidationMigration = readFileSync("drizzle/20260810182741_clumsy_tombstone.sql", "utf8");
    expect(invalidationMigration).toContain('CREATE TABLE "deterministic_feature_snapshot_invalidations"');
    expect(invalidationMigration).toContain("deterministic_feature_snapshot_invalidations_feature_scope_fk");
    expect(invalidationMigration).toContain("deterministic_feature_snapshot_invalidations_insight_scope_fk");
    expect(invalidationMigration).toContain('ALTER TABLE "deterministic_feature_snapshot_invalidations" ENABLE ROW LEVEL SECURITY');
    expect(invalidationMigration).toContain('ALTER TABLE "deterministic_feature_snapshot_invalidations" FORCE ROW LEVEL SECURITY');
    expect(invalidationMigration).toContain("deterministic_feature_snapshot_invalidation_guard");
    expect(invalidationMigration).toContain("lifecycle_state = 'tombstoning'");
    expect(WORKSPACE_TOMBSTONE_PURGE_TABLES).toContain("deterministic_feature_snapshot_invalidations");
  });

  it("creates every composite foreign-key target before the corresponding foreign key", () => {
    for (const [target, foreignKey] of [
      ["meta_connections_workspace_id_unique", "deterministic_feature_snapshots_connection_scope_fk"],
      ["ad_accounts_workspace_id_unique", "deterministic_feature_snapshots_account_scope_fk"],
    ]) {
      expect(scopeTargetMigration.indexOf(target)).toBeGreaterThanOrEqual(0);
      expect(migration.indexOf(foreignKey)).toBeGreaterThanOrEqual(0);
    }

    for (const [target, foreignKey] of [
      ["meta_daily_insights_workspace_id_unique", "deterministic_feature_snapshot_sources_insight_scope_fk"],
      ["deterministic_feature_snapshots_workspace_id_unique", "deterministic_feature_snapshot_sources_feature_scope_fk"],
    ]) {
      expect(migration.indexOf(target)).toBeGreaterThanOrEqual(0);
      expect(migration.indexOf(foreignKey)).toBeGreaterThan(migration.indexOf(target));
    }
  });
});
