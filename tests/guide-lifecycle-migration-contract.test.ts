import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(resolve(process.cwd(), "drizzle/20260817143000_canonical_guide_lifecycle.sql"), "utf8");
const before = (first: string, second: string) => {
  expect(migration.indexOf(first)).toBeGreaterThanOrEqual(0);
  expect(migration.indexOf(first)).toBeLessThan(migration.indexOf(second));
};

describe("P04 canonical guide lifecycle migration", () => {
  it("declares tenant composite indexes before their dependent foreign keys", () => {
    before("CREATE UNIQUE INDEX guides_workspace_slice_market_unique", "ADD CONSTRAINT guide_revisions_guide_market_scope_fk");
    before("CREATE UNIQUE INDEX guide_revisions_workspace_guide_row_unique", "ADD CONSTRAINT guide_heads_latest_revision_scope_fk");
    before("CREATE UNIQUE INDEX guide_revisions_workspace_guide_row_unique", "ADD CONSTRAINT guide_activation_outbox_revision_scope_fk");
  });

  it("keeps user acceptance, human-only rename and private persistence boundaries", () => {
    expect(migration).toContain("guide_interpretation_acceptances");
    expect(migration).toContain("latest_revision_id");
    expect(migration).toContain("guide head only permits exact next draft, accepted latest activation, or pause");
    expect(migration).toContain("not (action like '%_rename') or authority = 'human_approval'");
    for (const table of ["guides", "guide_revisions", "guide_revision_actions", "guide_revision_budget_refs", "guide_interpretation_acceptances", "guide_heads", "guide_lifecycle_events", "guide_activation_outbox"]) {
      expect(migration).toContain(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
    }
    expect(migration).toContain("FROM PUBLIC, anon, authenticated, service_role");
  });
});
