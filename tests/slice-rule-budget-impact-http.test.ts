import { describe, expect, it, vi } from "vitest";

import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import { createSliceRuleBudgetImpactHttpHandler } from "@/server/slice-rule-budget-impact-http";

const principal = { workspaceId: "11111111-1111-4111-8111-111111111111",
  workspaceRef: "workspace_local", readerRef: "reader_local",
  actor: { userId: "22222222-2222-4222-8222-222222222222" } } satisfies TrustedDecisionRoomPrincipal;
const command = { seriesRef: "slice_rule.ftr.ar", expectedDraftRef: `slice_rule_draft_${"a".repeat(20)}`,
  expectedDraftHash: "a".repeat(64), expectedScope: { market: "international", serviceRef: "service_ftr",
    campaignFamilyRef: "campaign_family_intensive_ftr" }, budgetCommand: { scope: {
      adAccountId: "33333333-3333-4333-8333-333333333333",
      campaignId: "44444444-4444-4444-8444-444444444444", contextHash: "a".repeat(64) } } };

function request(body: unknown, intent = "slice-rule-budget-impact-preview") {
  return new Request("http://localhost:3000/api/slice-rule-workspace", { method: "POST",
    headers: { cookie: "session=bound", origin: "http://localhost:3000", "sec-fetch-site": "same-origin",
      "content-type": "application/json", "x-reklamzeka-intent": intent }, body: JSON.stringify(body) });
}

describe("Slice Rule Budget impact HTTP boundary", () => {
  it("derives tenant and actor server-side and preserves closed authority headers", async () => {
    const preview = vi.fn(async () => ({ contractVersion: "slice-rule-budget-impact/1.0.0" }));
    const response = await createSliceRuleBudgetImpactHttpHandler({ service: { preview } as never,
      resolvePrincipal: async () => principal })(request({ command }));
    expect(response.status).toBe(200);
    expect(response.headers.get("X-ReklamZeka-Action-Authority")).toBe("none");
    expect(response.headers.get("X-ReklamZeka-Meta-Write")).toBe("disabled");
    expect(preview).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: principal.workspaceId,
      actorId: principal.actor.userId, expectedDraftHash: command.expectedDraftHash }));
  });

  it("rejects non same-origin or wrong-intent requests before service invocation", async () => {
    const preview = vi.fn();
    const handler = createSliceRuleBudgetImpactHttpHandler({ service: { preview } as never,
      resolvePrincipal: async () => principal });
    expect((await handler(request({ command }, "slice-rule-workspace-save"))).status).toBe(400);
    expect(preview).not.toHaveBeenCalled();
  });
});
