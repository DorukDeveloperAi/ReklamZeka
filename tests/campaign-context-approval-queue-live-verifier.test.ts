import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("campaign-context / Approval Queue live verifier", () => {
  it("uses local authenticated HTTP handlers, never prints a capability, and always rolls back", () => {
    const verifier = readFileSync("scripts/verify-campaign-context-approval-queue-live.ts", "utf8");
    expect(verifier).toContain("process.loadEnvFile(\".env.local\")");
    expect(verifier).toContain("mintLocalSessionCapability");
    expect(verifier).toContain("createLocalCampaignContextRouteHandler");
    expect(verifier).toContain("createLocalApprovalQueueRouteHandler");
    expect(verifier).toContain("throw rollback");
    expect(verifier).toContain("await pool.end()");
    expect(verifier).toContain("metaWriteCalls: 0");
    expect(verifier).not.toContain("console.log(token");
  });

  it("derives one queue-compatible campaign alias from a persisted Context response", () => {
    const verifier = readFileSync("scripts/verify-campaign-context-approval-queue-live.ts", "utf8");
    expect(verifier).toContain("digest(campaign_ref, 'sha256')");
    expect(verifier).toContain("approvalQueueCampaignRef");
    expect(verifier).toContain("/^entity_[a-f0-9]{16}$/");
    expect(verifier).toContain("no_valid_campaign_context");
    expect(verifier).toContain("campaign_context_alias_unavailable");
    expect(verifier).toContain("sharedCampaignScopeSupported");
  });
});
