import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const verifier = readFileSync("scripts/verify-data-health-ledger-postgres.ts", "utf8");
describe("P01-E outer rollback verifier contract", () => {
  it("uses an explicit post-apply boundary and outer rollback verification", () => {
    for (const token of ["migration_not_applied", 'client.query("begin")', 'client.query("rollback")', "zeroResidue", "healthyFirstUnchanged", "dataApiGrantsRevoked", "noRlsPolicies", "requiredFkIndexes", "preApplyConcurrencySkipped", "postApplyConcurrencyVerified", '"55P03"']) expect(verifier).toContain(token);
  });
});
