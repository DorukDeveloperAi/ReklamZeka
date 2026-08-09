import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(new URL("../drizzle/20260809220203_promotion_template_authoring_lifecycle.sql",
  import.meta.url), "utf8");

describe("promotion authoring lifecycle migration", () => {
  it("creates separate preset/template authoring tables with private append-only posture", () => {
    for (const table of ["audience_preset_authoring_revisions", "promotion_template_authoring_revisions"]) {
      expect(migration).toContain(`CREATE TABLE "${table}"`);
      expect(migration).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      expect(migration).toContain(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
      expect(migration).toMatch(new RegExp(`REVOKE ALL PRIVILEGES ON TABLE "${table}"[\\s\\S]*service_role`));
      expect(migration).toContain(`BEFORE UPDATE ON ${table}`);
    }
    expect(migration).toContain("promotion_authoring_revision_guard");
    expect(migration).toContain("promotion_authoring_preset_not_published");
    expect(migration).toContain("promotion_authoring_invalid_lineage");
    expect(migration).toContain("'promotion_registry'");
  });

  it("stores draft material without published state/time and requires explicit published payload columns", () => {
    expect(migration).toContain("audience-preset-draft-material/1.0.0");
    expect(migration).toContain("not (\"audience_preset_authoring_revisions\".\"preset_payload\" ? 'publishedAt')");
    expect(migration).toContain("published_preset_payload");
    expect(migration).toContain("published_template_payload");
    expect(migration).toContain("published_binding_payload");
  });
});

