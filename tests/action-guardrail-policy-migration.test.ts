import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(new URL("../drizzle/20260807205905_action_guardrail_policy.sql", import.meta.url), "utf8");

describe("ActionGuardrailPolicy migration boundary", () => {
  it("is tenant-bound, forced-RLS, Data API revoked, and update-append-only", () => {
    expect(migration).toContain('REFERENCES "public"."workspaces"("id") ON DELETE cascade');
    expect(migration).toContain("ALTER TABLE action_guardrail_policy_revisions ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("ALTER TABLE action_guardrail_policy_revisions FORCE ROW LEVEL SECURITY");
    expect(migration).toContain("REVOKE ALL PRIVILEGES ON TABLE action_guardrail_policy_revisions FROM PUBLIC, anon, authenticated");
    expect(migration).toContain("BEFORE UPDATE ON action_guardrail_policy_revisions");
    expect(migration).toContain("SET search_path = ''");
    expect(migration).toContain("REVOKE ALL PRIVILEGES ON FUNCTION action_guardrail_policy_append_only() FROM PUBLIC, anon, authenticated");
    expect(migration).not.toMatch(/SECURITY\s+DEFINER|GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE|ALL).*action_guardrail_policy_revisions/i);
  });

  it("pins exact lifecycle, selector, provenance and authority-none contracts", () => {
    expect(migration).toContain("action-guardrail-policy/1.0.0");
    expect(migration).toContain("default_disposition\" = 'allow_if_no_matching_deny'");
    expect(migration).toContain("published_by_role\" in ('owner', 'admin')");
    expect(migration).toContain("disabled_by_role\" in ('owner', 'admin')");
    expect(migration).toContain("disabled_at\" >= \"action_guardrail_policy_revisions\".\"published_at");
    expect(migration).toContain("sourceGuidanceRefs");
    for (const capability of ["canApprove", "canExecute", "canWriteMeta", "canGrantApproval", "canPromoteGuidance"]) {
      expect(migration).toContain(`'{authority,${capability}}' = 'false'`);
    }
  });

  it("has tenant-leftmost identity, chain, hash and resolver indexes", () => {
    expect(migration).toContain('(\"workspace_id\",\"policy_ref\",\"revision\")');
    expect(migration).toContain('(\"workspace_id\",\"canonical_hash\")');
    expect(migration).toContain('(\"workspace_id\",\"state\",\"policy_ref\",\"revision\")');
  });
});
