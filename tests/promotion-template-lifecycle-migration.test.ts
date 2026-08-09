import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(new URL("../drizzle/20260809220203_promotion_template_authoring_lifecycle.sql",
  import.meta.url), "utf8");
const hardening = readFileSync(new URL("../drizzle/20260809222726_promotion_authoring_constraint_hardening.sql",
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
    expect(hardening).toMatch(/preset_payload"::text \|\| coalesce\("audience_preset_authoring_revisions"\."published_preset_payload"::text/);
    expect(hardening).toContain("#>> '{workspaceRef}' = \"audience_preset_authoring_revisions\".\"workspace_ref\"");
    expect(hardening).toContain("#>> '{presetRef}' = \"audience_preset_authoring_revisions\".\"preset_ref\"");
    expect(hardening).toContain("#>> '{audiencePreset,presetHash}' = \"promotion_template_authoring_revisions\".\"preset_hash\"");
    expect(hardening).toContain("#>> '{template,templateHash}' = \"promotion_template_authoring_revisions\".\"published_template_hash\"");
    expect(hardening).toContain("published_preset_payload\" - 'version' - 'state' - 'publishedAt' - 'presetHash'");
    expect(hardening).toContain("preset_payload\" - 'version' - 'authority' - 'materialHash'");
    expect(hardening).toContain("published_template_payload\" - 'version' - 'state' - 'publishedAt' - 'templateHash'");
    expect(hardening).toContain("published_binding_payload\" - 'version' - 'effectiveFrom' - 'expiresAt' - 'bindingHash' - 'template'");
    expect(hardening).toMatch(/canWriteMeta\|canGrantApproval\).*true/);
    expect(hardening).toContain("DROP CONSTRAINT \"audience_preset_authoring_payload_exact\"");
    expect(hardening).toMatch(/status" = 'archived'[\s\S]*published_template_payload" #>> '\{version\}' = 'promotion-template\/1\.0\.0'/);
    expect(hardening).toMatch(/status" = 'archived'[\s\S]*published_binding_payload" #>> '\{version\}' = 'promotion-template-binding\/1\.0\.0'/);
    expect(hardening).toMatch(/status" = 'archived'[\s\S]*published_binding_payload" \? 'effectiveFrom'/);
    expect(hardening).toContain("CREATE FUNCTION promotion_authoring_revision_immutable()");
    expect(hardening).toContain("BEFORE UPDATE OR DELETE ON audience_preset_authoring_revisions");
    expect(hardening).toContain("BEFORE UPDATE OR DELETE ON promotion_template_authoring_revisions");
    expect(hardening).toContain("lifecycle_state = 'tombstoning'");
    expect(hardening).toMatch(/REVOKE ALL PRIVILEGES ON FUNCTION promotion_authoring_revision_immutable\(\)[\s\S]*service_role/);
    expect(hardening).not.toContain("NOT VALID");
  });
});
