import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("A10 cohort normal-sync PostgreSQL verifier", () => {
  it("limits direct seeding to identity roots and cleans normal sync output through the lifecycle", () => {
    const root = readFileSync("scripts/support/a10-cohort-root-scope-fixture.ts", "utf8");
    const verifier = readFileSync("scripts/verify-a10-cohort-normal-sync-postgres.ts", "utf8");
    expect(root).toContain("materializeA10CohortRootScopeFixture");
    expect(root).not.toContain("schema.adCampaigns");
    expect(root).not.toContain("schema.metaAdSets");
    expect(root).not.toContain("schema.metaDailyInsights");
    expect(root).not.toContain("schema.metaSyncRuns");
    expect(root).not.toContain("schema.metaChangeSnapshots");
    expect(verifier).toContain("materializeA10CohortSyncFixture");
    expect(verifier).toContain("WorkspaceTombstoneService");
    expect(verifier).toContain("cleanupVerified");
    expect(verifier).toContain("temporaryRowsCommitted: true");
  });
});
