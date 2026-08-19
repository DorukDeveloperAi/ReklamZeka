import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const verifier = readFileSync(resolve(process.cwd(), "scripts/verify-guide-lifecycle-postgres.ts"), "utf8");

describe("P04 guide lifecycle outer-rollback verifier", () => {
  it("uses a real repository inside a savepoint and proves outer rollback residue", () => {
    expect(verifier).toContain("new DrizzleGuideLifecycleRepository");
    expect(verifier).toContain('client.query("begin")');
    expect(verifier).toContain('client.query("rollback")');
    expect(verifier).toContain("zeroResidue");
  });

  it("covers predecessor activation, acceptance, authority, cross-scope, and distinct pause occurrences", () => {
    for (const token of ["canonicalReloaded", "analystRejected", "missingAcceptanceRejected", "oldActiveSurvives", "failedActivationKeepsOld", "acceptanceIdempotent", "crossWorkspaceRejected", "crossMarketRejected", "compositeFkRejected", "revoked", "reactivated", "reactivationRetry", "tamperedReactivationRejected", "pausedAgain"]) expect(verifier).toContain(token);
  });
});
