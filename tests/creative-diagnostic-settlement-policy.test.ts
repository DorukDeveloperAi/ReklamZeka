import { describe, expect, it } from "vitest";
import { CreativeDiagnosticSettlementPolicyError, createCreativeDiagnosticSettlementPolicy, settledThroughDate } from "@/analyses/creative-diagnostic-settlement-policy";

const input = { policyRef: "creative_settlement_1234567890abcdef12345678", revision: 1, previousHash: null,
  state: "published" as const, settlementLagDays: 2 };

describe("creative diagnostic settlement policy", () => {
  it("hashes the exact published lag contract and derives timezone-bound cutoff", () => {
    const policy = createCreativeDiagnosticSettlementPolicy(input);
    expect(policy).toEqual(createCreativeDiagnosticSettlementPolicy(input));
    expect(settledThroughDate(policy, "2026-08-11T22:00:00.000Z", "Europe/Istanbul")).toBe("2026-08-10");
  });
  it("rejects implicit/default lag, unpublished policy and malformed input", () => {
    expect(() => createCreativeDiagnosticSettlementPolicy({ ...input, settlementLagDays: -1 })).toThrow(CreativeDiagnosticSettlementPolicyError);
    expect(() => createCreativeDiagnosticSettlementPolicy({ ...input, extra: true } as never)).toThrow("exact shape");
    expect(() => settledThroughDate(createCreativeDiagnosticSettlementPolicy({ ...input, state: "draft" }), "2026-08-11T22:00:00.000Z", "Europe/Istanbul")).toThrow("published");
  });
});
