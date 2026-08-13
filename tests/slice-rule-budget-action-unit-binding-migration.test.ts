import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("slice rule budget ActionUnit provenance migration", () => {
  it("keeps the selection-to-ActionUnit edge tenant-bound, append-only, and private", async () => {
    const migration = await readFile(resolve("drizzle/20260813173741_broad_mister_sinister.sql"), "utf8");
    expect(migration).toContain('CREATE TABLE "slice_rule_budget_action_unit_bindings"');
    expect(migration).toContain('slice_rule_budget_action_unit_bindings_selection_scope_fk');
    expect(migration).toContain('slice_rule_budget_action_unit_bindings_unit_scope_fk');
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('FORCE ROW LEVEL SECURITY');
    expect(migration).toContain('slice_rule_budget_action_unit_binding_append_only_guard');
    expect(migration).toContain('REVOKE ALL PRIVILEGES ON TABLE "slice_rule_budget_action_unit_bindings" FROM PUBLIC, anon, authenticated, service_role');
  });
});
