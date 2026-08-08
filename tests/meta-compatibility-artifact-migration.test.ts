import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { WORKSPACE_TOMBSTONE_PURGE_TABLES } from "@/connectors/meta/workspace-tombstone-purge-drizzle-adapter";
import { metaCompatibilityArtifactRevisions } from "@/db/schema";

const migration = readFileSync(new URL("../drizzle/20260807200116_petite_madame_hydra.sql", import.meta.url), "utf8");

describe("Meta compatibility artifact migration security", () => {
  it("uses one generic versioned table for all five typed dimensions without seeding mappings or outcomes", () => {
    expect(metaCompatibilityArtifactRevisions).toBeDefined();
    for (const dimension of ["destination", "optimization", "placement", "special_category", "tracking"]) {
      expect(migration).toContain(`'${dimension}'`);
    }
    expect(migration).toContain("artifact_kind\" in ('mapping', 'evidence')");
    expect(migration).toContain("state\" in ('draft', 'reviewed', 'published', 'tombstoned')");
    expect(migration).not.toMatch(/insert\s+into\s+meta_compatibility_artifact_revisions/i);
  });

  it("forces RLS, revokes API access and grants no table capability", () => {
    expect(migration).toContain("ALTER TABLE meta_compatibility_artifact_revisions ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("ALTER TABLE meta_compatibility_artifact_revisions FORCE ROW LEVEL SECURITY");
    expect(migration).toContain("CREATE POLICY meta_compatibility_artifact_revisions_tenant_select");
    expect(migration).toContain("membership.user_id = (select auth.uid())");
    expect(migration).toContain("REVOKE ALL PRIVILEGES ON TABLE meta_compatibility_artifact_revisions FROM PUBLIC, anon, authenticated");
    expect(migration).not.toMatch(/GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE|ALL).*meta_compatibility_artifact_revisions/i);
  });

  it("blocks mutation while reserving DELETE for the locked workspace tombstone purge path", () => {
    expect(migration).toContain("BEFORE UPDATE ON meta_compatibility_artifact_revisions");
    expect(migration).not.toContain("BEFORE UPDATE OR DELETE ON meta_compatibility_artifact_revisions");
    expect(migration).toContain("SET search_path = ''");
    expect(migration).toContain("REVOKE ALL PRIVILEGES ON FUNCTION meta_compatibility_artifact_append_only() FROM PUBLIC, anon, authenticated");
    expect(migration).not.toMatch(/SECURITY\s+DEFINER/i);
    expect(WORKSPACE_TOMBSTONE_PURGE_TABLES).toContain("meta_compatibility_artifact_revisions");
  });

  it("keeps reviewed and published lifecycle distinct and encodes authority-none", () => {
    expect(migration).toContain("state\" = 'reviewed'");
    expect(migration).toContain("state\" = 'published'");
    expect(migration).toContain("review_by");
    for (const capability of ["canExecute", "canWriteMeta", "canGrantApproval", "canCreatePolicy", "canPromoteGuidance"]) {
      expect(migration).toContain(`{authority,${capability}}' = 'false'`);
    }
  });
});
