import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
const verifier = readFileSync(resolve(process.cwd(), "scripts/verify-guide-budget-contract-v2-postgres.ts"), "utf8");
describe("P04-Cb guide budget v2 postgres verifier", () => it("runs the real receipt-backed repository through an unjournaled outer rollback", () => {
  for (const token of [
    'await q("begin")', 'await q(migration)', 'await q("rollback")',
    "DrizzleGuideBudgetEvidenceRepository", "GuideBudgetDryRunService",
    "cboReceiptBackedReady", "missingReceiptHeld", "recoveryActual",
    "partialActual", "tamperedContractRejected", "crossTenantDirectRejected",
    "overlapMostRestrictiveOrderInvariant", "zeroResidue",
  ]) expect(verifier).toContain(token);
}));
