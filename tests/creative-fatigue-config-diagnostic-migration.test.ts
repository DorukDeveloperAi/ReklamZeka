import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "drizzle/20260811164104_cooing_drax.sql"), "utf8");
const tables = ["creative_diagnostic_definition_revisions", "meta_creative_config_snapshots", "meta_creative_window_insight_snapshots", "creative_fatigue_config_diagnostic_assets"] as const;

describe("creative fatigue/config diagnostic migration", () => {
  it("keeps every new tenant table RLS-forced, revoked and append-only", () => {
    for (const table of tables) {
      expect(migration).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      expect(migration).toContain(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
      expect(migration).toContain(`CREATE TRIGGER ${table}_append_only BEFORE UPDATE OR DELETE ON "${table}"`);
    }
    expect(migration).toContain("REVOKE ALL PRIVILEGES ON TABLE \"creative_diagnostic_definition_revisions\", \"meta_creative_config_snapshots\", \"meta_creative_window_insight_snapshots\", \"creative_fatigue_config_diagnostic_assets\" FROM PUBLIC, anon, authenticated, service_role");
  });
  it("creates composite target keys before the first scoped foreign key", () => {
    for (const index of ["creative_diagnostic_definition_revisions_workspace_id_unique", "meta_creative_config_snapshots_workspace_id_unique", "meta_creative_window_insight_snapshots_workspace_id_unique"] as const) {
      expect(migration.indexOf(index)).toBeLessThan(migration.indexOf("creative_fatigue_config_diagnostic_assets_definition_scope_fk"));
    }
  });
});
