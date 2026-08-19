import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "drizzle/20260817133000_canonical_slice_registry.sql"), "utf8");
const before = (first: string, second: string) => { expect(migration.indexOf(first)).toBeGreaterThanOrEqual(0); expect(migration.indexOf(first)).toBeLessThan(migration.indexOf(second)); };

describe("P03 canonical slice registry migration contract", () => {
  it("creates composite unique keys before the foreign keys that reference them", () => {
    before('CREATE UNIQUE INDEX "slices_workspace_identity_market_unique"', 'ADD CONSTRAINT "slice_revisions_slice_market_scope_fk"');
    before('CREATE UNIQUE INDEX "slice_revisions_workspace_row_unique"', 'ADD CONSTRAINT "slices_current_published_revision_scope_fk"');
    before('CREATE UNIQUE INDEX "slice_revision_predicates_workspace_row_unique"', 'ADD CONSTRAINT "slice_revision_predicate_values_predicate_scope_fk"');
    before('CREATE UNIQUE INDEX "slice_resolution_snapshots_workspace_row_unique"', 'ADD CONSTRAINT "slice_resolution_snapshot_members_snapshot_scope_fk"');
  });

  it("keeps the canonical market and immutable/RLS boundary in the migration", () => {
    expect(migration).toContain('slice_ref');
    expect(migration).toContain("value.key IN ('yerli', 'yabanci')");
    expect(migration).toContain('slices are append-only; only head advancement and tombstoning are allowed');
    for (const table of ["slices", "slice_revisions", "slice_revision_predicates", "slice_revision_predicate_values", "slice_revision_overrides", "slice_resolution_snapshots", "slice_resolution_snapshot_members"]) {
      expect(migration).toContain(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
    }
    expect(migration).toContain('FROM PUBLIC, anon, authenticated, service_role');
  });
});
