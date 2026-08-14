import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("drizzle/20260813155844_ordinary_stryfe.sql", "utf8");

describe("slice rule budget proposal provenance migration", () => {
  it("keeps the cross-ledger edge tenant-bound, private and append-only", () => {
    expect(migration).toContain('CREATE TABLE "slice_rule_budget_proposal_bindings"');
    expect(migration).toContain('"slice_rule_budget_proposal_bindings_draft_scope_fk"');
    expect(migration).toContain('"slice_rule_budget_proposal_bindings_proposal_scope_fk"');
    expect(migration).toContain('ALTER TABLE "slice_rule_budget_proposal_bindings" FORCE ROW LEVEL SECURITY');
    expect(migration).toContain('REVOKE ALL PRIVILEGES ON TABLE "slice_rule_budget_proposal_bindings" FROM PUBLIC, anon, authenticated, service_role');
    expect(migration).toContain('slice_rule_budget_proposal_binding_append_only_guard');
    expect(migration).toContain("lifecycle_state = 'tombstoning'");
  });

  it("requires an exact advisory-only payload rather than silently granting an action", () => {
    expect(migration).toContain('"recommendationOnly": true, "canPublish": false, "canApprove": false');
    expect(migration).toContain('"canExecute": false, "canWriteMeta": false, "canEnableAutomation": false');
    expect(migration).toContain('slice_rule_budget_proposal_bindings_exact_unique');
  });
});
