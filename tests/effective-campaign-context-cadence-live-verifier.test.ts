import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("effective campaign context cadence live verifier", () => {
  it("keeps the evidence-bound cadence acceptance path tenant-bound and rollback-only", () => {
    const verifier = readFileSync("scripts/verify-effective-campaign-context-postgres.ts", "utf8");
    expect(verifier).toContain("DrizzleDecisionCadenceProfileRepository");
    expect(verifier).toContain('mode: "evidence_bound"');
    expect(verifier).toContain("cadenceSchemaAccepted");
    expect(verifier).toContain("evidenceBoundContextPersisted");
    expect(verifier).toContain("missingCadenceEvidenceBlocked");
    expect(verifier).toContain("tamperedCadenceEvidenceBlocked");
    expect(verifier).toContain("cadenceSupersedeInvalidationExact");
    expect(verifier).toContain("cadenceRlsAndGrants");
    expect(verifier).toContain("throw rollback");
    expect(verifier).toContain("temporaryRowsCommitted");
    expect(verifier).toContain("writeNetworkCalls: 0");
  });

  it("requires an exact immutable cadence row before evidence-bound persistence", () => {
    const repository = readFileSync("src/connectors/analyses/effective-campaign-context-drizzle-repository.ts", "utf8");
    expect(repository).toContain("assertCadenceEvidence");
    expect(repository).toContain("decision_cadence_profile_revisions");
    expect(repository).toContain("profile_version = ${context.cadenceEvidence.profileVersion}");
    expect(repository).toContain("profile_hash = ${context.cadenceEvidence.profileHash}");
    expect(repository).toContain("await assertCadenceEvidence(transaction, context, mirror)");
  });
});
