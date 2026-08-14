import { describe, expect, it, vi } from "vitest";
import { createCampaignClassificationReviewHttpHandler } from "@/server/campaign-classification-review-http";
const principal = { workspaceId: "workspace", actor: { id: "user", role: "owner" } } as any;
const projection = { version: "campaign-classification-review/1.0.0", entries: [], summary: { campaigns: 0, reviewRequired: 0 }, authority: { canAssign: false, canPublish: false, canAuthorizeAction: false, canWriteMeta: false } };
describe("campaign classification review HTTP", () => {
  it("is queryless, session-bound GET-only and declares no action authority", async () => {
    const list = vi.fn().mockResolvedValue(projection); const handler = createCampaignClassificationReviewHttpHandler({ service: { list }, resolvePrincipal: vi.fn().mockResolvedValue(principal) });
    const request = new Request("http://localhost/api/campaign-classification-review", { headers: { cookie: "session=x", "sec-fetch-site": "same-origin", "x-reklamzeka-intent": "campaign-classification-review-read" } });
    const response = await handler(request); expect(response.status).toBe(200); expect(response.headers.get("X-ReklamZeka-Action-Authority")).toBe("none"); expect(list).toHaveBeenCalledWith(principal);
    expect((await handler(new Request("http://localhost/api/campaign-classification-review?campaign=x", { headers: request.headers }))).status).toBe(400);
    expect((await handler(new Request("http://localhost/api/campaign-classification-review", { method: "POST", headers: request.headers }))).status).toBe(400);
  });
});
