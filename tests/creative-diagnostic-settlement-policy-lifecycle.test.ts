import { describe, expect, it } from "vitest";
import { createCreativeDiagnosticSettlementPolicy } from "@/analyses/creative-diagnostic-settlement-policy";
import { advanceCreativeDiagnosticSettlementPolicy, CreativeDiagnosticSettlementPolicyLifecycleError } from "@/analyses/creative-diagnostic-settlement-policy-lifecycle";

const genesis = Object.freeze({ policyRef: "creative_settlement_1234567890abcdef12345678", revision: 1, previousHash: null, state: "draft" as const, settlementLagDays: 3 });

describe("advanceCreativeDiagnosticSettlementPolicy", () => {
  it("creates a contiguous immutable revision and prevents reopening a published or retired policy", () => {
    const first = advanceCreativeDiagnosticSettlementPolicy({ previous: null, next: genesis });
    const published = advanceCreativeDiagnosticSettlementPolicy({ previous: first, next: { ...genesis, revision: 2, previousHash: first.policyHash, state: "published" } });
    expect(published.state).toBe("published");
    expect(() => advanceCreativeDiagnosticSettlementPolicy({ previous: published, next: { ...genesis, revision: 3, previousHash: published.policyHash, state: "draft" } })).toThrow(CreativeDiagnosticSettlementPolicyLifecycleError);
  });

  it("rejects stale revision/hash before the database append", () => {
    const first = createCreativeDiagnosticSettlementPolicy(genesis);
    expect(() => advanceCreativeDiagnosticSettlementPolicy({ previous: first, next: { ...genesis, revision: 2, previousHash: null, state: "published" } })).toThrow("revision_conflict");
  });
});
