import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("drizzle/20260811170212_lush_madrox.sql", "utf8");
describe("creative diagnostic settlement policy migration", () => {
  it("is forward-only, tenant-scoped, RLS-forced and immutable outside tombstoning", () => {
    for (const table of ["creative_diagnostic_settlement_policies", "creative_diagnostic_settlement_policy_revisions"]) {
      expect(migration).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      expect(migration).toContain(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
    }
    expect(migration).toContain("REVOKE ALL PRIVILEGES ON TABLE \"creative_diagnostic_settlement_policies\", \"creative_diagnostic_settlement_policy_revisions\" FROM PUBLIC, anon, authenticated, service_role");
    expect(migration).toContain("creative_diagnostic_settlement_policy_head_occ_conflict");
    expect(migration).toContain("creative_diagnostic_settlement_policy_chain_conflict");
    expect(migration).toContain("settlement_policy_hash");
  });
});
