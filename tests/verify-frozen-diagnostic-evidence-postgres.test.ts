import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("frozen diagnostic evidence PostgreSQL verifier", () => {
  it("uses the normal closed-world fixture and proves the private sidecar boundaries", () => {
    const source = readFileSync("scripts/verify-frozen-diagnostic-evidence-postgres.ts", "utf8");
    expect(source).toContain('from "./support/current-effective-analysis-context-source-fixture"');
    expect(source).toContain("await materializeCurrentEffectiveAnalysisContextSourceFixture(tx)");
    expect(source).toContain("createDrizzleEffectiveAnalysisContextComposer({ database: tx }).composeAndSave(fixture.request)");
    expect(source).toContain("new DrizzleFrozenDiagnosticEvidenceRepository().saveInTransaction");
    expect(source).toContain("frozen_diagnostic_evidence_outer_rollback");
    expect(source).toContain("new DrizzleWorkspaceTombstonePurgePort()");
    expect(source).toContain("relforcerowsecurity");
    expect(source).toContain("has_table_privilege('service_role'");
    expect(source).toContain("actionOrNetworkCalls");
    expect(source).not.toContain("insert into frozen_diagnostic_evidence");
    expect(source).not.toContain("insert into tenant_authority_snapshots");
  });
});
