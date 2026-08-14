import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const tag = "20260811193306_conscious_james_howlett";
const fkTag = "20260811194043_colorful_guardian";
const migration = readFileSync(`drizzle/${tag}.sql`, "utf8");
const fkMigration = readFileSync(`drizzle/${fkTag}.sql`, "utf8");

describe("normalization workbench migration", () => {
  it("creates an append-only source/card/set-pinned draft table", () => {
    expect(migration).toContain('CREATE TABLE "normalization_workbench_revisions"');
    for (const value of ["set_scope_fk", "workspace_ref_revision_unique",
      "normalization_workbench_revisions_payload_exact", "normalization_workbench_revisions_no_forbidden_material"]) {
      expect(migration).toContain(value);
    }
    expect(fkMigration).toContain("guidance_sources_workspace_row_unique");
    expect(fkMigration).toContain("guidance_cards_workspace_row_unique");
    expect(fkMigration).toContain("source_scope_fk");
    expect(fkMigration).toContain("card_scope_fk");
    expect(migration).toContain("strictPolicy");
    expect(migration).toContain("canPromotePolicy");
    expect(migration).toContain("impactSummary,status");
  });

  it("forces RLS, revokes public roles and only permits deletion during tombstoning", () => {
    expect(migration).toContain('ALTER TABLE "normalization_workbench_revisions" ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('ALTER TABLE "normalization_workbench_revisions" FORCE ROW LEVEL SECURITY');
    expect(migration).toContain('REVOKE ALL PRIVILEGES ON TABLE "normalization_workbench_revisions" FROM PUBLIC, anon, authenticated, service_role');
    expect(migration).toContain("normalization_workbench_revision_guard");
    expect(migration).toContain("lifecycle_state = 'tombstoning'");
    expect(migration).toContain("normalization_workbench_revision_immutable");
  });

  it("has a generated journal entry and snapshot", () => {
    const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: { tag: string }[] };
    expect(journal.entries.some((entry) => entry.tag === tag)).toBe(true);
    expect(journal.entries.some((entry) => entry.tag === fkTag)).toBe(true);
    expect(existsSync("drizzle/meta/20260811193306_snapshot.json")).toBe(true);
    expect(existsSync("drizzle/meta/20260811194043_snapshot.json")).toBe(true);
  });
});
