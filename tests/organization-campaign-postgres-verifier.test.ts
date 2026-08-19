import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
const source = readFileSync("scripts/verify-organization-campaign-postgres.ts", "utf8");
describe("organization campaign postgres verifier", () => it("is bounded and DNS-explicit", () => {
  expect(source).toContain("connectionTimeoutMillis: 5_000"); expect(source).toContain("statement_timeout: 5_000");
  expect(source).toContain("external_dns_unavailable"); expect(source).toContain("organization_campaign_migration_not_applied");
  expect(source).toContain("organization_campaign_acceptance_assertion_failed");
  expect(source).toContain("savepoint expected_error"); expect(source).toContain("rollback to savepoint expected_error");
  expect(source).toContain("missingMarketRejected"); expect(source).toContain("conflictingMarketRejected");
  expect(source).toContain("crossMarketRejected"); expect(source).toContain("crossTenantRejected");
  expect(source).toContain("rlsForcedAndDataApiDark"); expect(source).toContain("zeroResidue"); expect(source).toContain("rollback");
}));
