import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("Decision Room dry-run PostgreSQL verifier", () => {
  it("derives L1, L2 and L3 through their normal repository boundaries", () => {
    const source = readFileSync("scripts/verify-decision-room-dry-run-postgres.ts", "utf8");
    for (const boundary of [
      "materializeCurrentEffectiveAnalysisContextSourceFixture",
      "DrizzleFindingObservationReadPort",
      "buildFindingObservations",
      "DrizzleDeterministicFeatureSnapshotRepository",
      "createDrizzleEffectiveAnalysisContextComposer",
      "createDrizzleTimeframeBoundAnalysisContextComposer",
    ]) expect(source).toContain(boundary);
    expect(source).not.toContain("buildEffectiveCampaignContext");
    expect(source).not.toContain("new DrizzleEffectiveCampaignContextRepository");
  });

  it("keeps the acceptance proof advisory-only and rollback-scoped", () => {
    const source = readFileSync("scripts/verify-decision-room-dry-run-postgres.ts", "utf8");
    for (const assertion of [
      "exactEvidenceRefs", "replayIdempotent", "crossTenantRejected", "tamperRejected", "staleL1Rejected",
      "persistedRun", "persistedLedger", "persistedInbox", "metaNetworkCalls === 0", "metaWriteCalls === 0",
      "throw rollback",
    ]) expect(source).toContain(assertion);
  });
});
