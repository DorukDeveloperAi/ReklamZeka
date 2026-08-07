import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../drizzle/20260807194045_tiresome_sugar_man.sql", import.meta.url),
  "utf8",
);

describe("Autonomy Rule Registry migration security", () => {
  it("enables forced RLS with a tenant membership policy while API roles retain zero grants", () => {
    expect(migration).toContain("ALTER TABLE autonomy_rule_revisions ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("ALTER TABLE autonomy_rule_revisions FORCE ROW LEVEL SECURITY");
    expect(migration).toContain("CREATE POLICY autonomy_rule_revisions_tenant_select");
    expect(migration).toContain("membership.user_id = (select auth.uid())");
    expect(migration).toContain("REVOKE ALL PRIVILEGES ON TABLE autonomy_rule_revisions FROM PUBLIC, anon, authenticated");
    expect(migration).not.toMatch(/GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE|ALL).*autonomy_rule_revisions/i);
  });

  it("blocks updates, reserves delete for the locked tombstone path, and exposes no privileged function", () => {
    expect(migration).toContain("BEFORE UPDATE ON autonomy_rule_revisions");
    expect(migration).not.toContain("BEFORE UPDATE OR DELETE ON autonomy_rule_revisions");
    expect(migration).toContain("SET search_path = ''");
    expect(migration).toContain("REVOKE ALL PRIVILEGES ON FUNCTION autonomy_rule_registry_append_only() FROM PUBLIC, anon, authenticated");
    expect(migration).not.toMatch(/SECURITY\s+DEFINER/i);
  });

  it("persists normalized evidence with exact authority-none and owner/admin publication constraints", () => {
    expect(migration).toContain("published_by_role\" in ('owner', 'admin')");
    expect(migration).toContain("'{authority,canExecute}' = 'false'");
    expect(migration).toContain("'{authority,canWriteMeta}' = 'false'");
    expect(migration).toContain("'{authority,canGrantApproval}' = 'false'");
    expect(migration).toContain("'{authority,canPromoteGuidance}' = 'false'");
    expect(migration).toContain("source_guidance_refs");
    expect(migration).toContain("publication_decision_ref");
    expect(migration).toContain("canonical_hash");
  });
});
