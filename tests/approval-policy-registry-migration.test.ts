import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(new URL("../drizzle/20260807202111_clean_bishop.sql", import.meta.url), "utf8");

describe("ApprovalPolicy definition migration boundary", () => {
  it("uses forced RLS, tenant membership policy, and zero Data API grants", () => {
    expect(migration).toContain("ALTER TABLE approval_policy_definition_revisions ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("ALTER TABLE approval_policy_definition_revisions FORCE ROW LEVEL SECURITY");
    expect(migration).toContain("CREATE POLICY approval_policy_definition_revisions_tenant_select");
    expect(migration).toContain("membership.user_id = (select auth.uid())");
    expect(migration).toContain("REVOKE ALL PRIVILEGES ON TABLE approval_policy_definition_revisions FROM PUBLIC, anon, authenticated");
    expect(migration).not.toMatch(/GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE|ALL).*approval_policy_definition_revisions/i);
  });

  it("is append-only for updates, leaves deletion to locked tombstone purge, and exposes no privileged function", () => {
    expect(migration).toContain("BEFORE UPDATE ON approval_policy_definition_revisions");
    expect(migration).not.toContain("BEFORE UPDATE OR DELETE ON approval_policy_definition_revisions");
    expect(migration).toContain("SET search_path = ''");
    expect(migration).toContain("REVOKE ALL PRIVILEGES ON FUNCTION approval_policy_definition_append_only() FROM PUBLIC, anon, authenticated");
    expect(migration).not.toMatch(/SECURITY\s+DEFINER/i);
  });

  it("pins K4 existing-post applicability, reviewed publication, exact policy, and authority-none", () => {
    expect(migration).toContain("action_type\" = 'existing_post_promotion'");
    expect(migration).toContain("risk\" = 'K4'");
    expect(migration).toContain("published_by_role\" in ('owner', 'admin')");
    expect(migration).toContain("disabled_by_role\" in ('owner', 'admin')");
    expect(migration).toContain("disabled_at\" >= \"approval_policy_definition_revisions\".\"published_at");
    expect(migration).toContain("'{previousHash}') is not distinct from \"approval_policy_definition_revisions\".\"previous_hash");
    expect(migration).toContain("'{maximumGrantLifetimeSeconds}')::integer between 1 and 86400");
    for (const capability of ["canApprove", "canGrant", "canExecute", "canWriteMeta", "canPromoteGuidance"]) {
      expect(migration).toContain(`'{authority,${capability}}' = 'false'`);
    }
  });
});
