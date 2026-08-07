import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WORKSPACE_TOMBSTONE_PURGE_TABLES } from "@/connectors/meta/workspace-tombstone-purge-drizzle-adapter";

const migration = readFileSync(
  new URL("../drizzle/20260807183118_wandering_patch.sql", import.meta.url),
  "utf8",
);

const registryTables = [
  "audience_preset_revisions",
  "promotion_template_revisions",
  "promotion_template_bindings",
  "promotion_template_binding_categories",
] as const;

describe("promotion template persistence boundary", () => {
  it("creates tenant-bound immutable revisions with server-private access", () => {
    for (const table of registryTables) {
      expect(migration).toContain(`CREATE TABLE "${table}"`);
      expect(migration).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      expect(migration).toContain(
        `REVOKE ALL PRIVILEGES ON TABLE "${table}" FROM PUBLIC, anon, authenticated`,
      );
      expect(migration).toContain(`CREATE TRIGGER ${table}_append_only_trigger BEFORE UPDATE ON ${table}`);
      expect(WORKSPACE_TOMBSTONE_PURGE_TABLES).toContain(table);
    }
    expect(migration).toContain(
      "REVOKE ALL PRIVILEGES ON FUNCTION promotion_registry_append_only() FROM PUBLIC, anon, authenticated",
    );
    expect(migration).toMatch(/promotion_template_revisions_no_authority[\s\S]*creative\|copy\|headline/);
    expect(migration).toMatch(/promotion_template_bindings_no_authority[\s\S]*creative\|copy\|headline/);
  });

  it("creates composite target uniqueness before every new scoped foreign key", () => {
    const ordered = [
      ["audience_preset_revisions_workspace_row_unique", "promotion_template_revisions_audience_scope_fk"],
      ["promotion_template_revisions_workspace_row_unique", "promotion_template_bindings_template_scope_fk"],
      ["promotion_template_bindings_workspace_row_unique", "promotion_template_binding_categories_binding_scope_fk"],
      ["category_definitions_workspace_id_unique", "promotion_template_binding_categories_category_scope_fk"],
      ["meta_assets_id_workspace_unique", "promotion_template_bindings_actor_scope_fk"],
    ] as const;
    for (const [targetIndex, foreignKey] of ordered) {
      expect(migration.indexOf(targetIndex)).toBeGreaterThanOrEqual(0);
      expect(migration.indexOf(targetIndex)).toBeLessThan(migration.indexOf(foreignKey));
    }
  });
});
