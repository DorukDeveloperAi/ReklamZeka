import { describe, expect, it, vi } from "vitest";

import { createSliceRulePortfolioLinksHttpHandler } from "@/server/slice-rule-portfolio-links-http";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const principal = { workspaceId, actor: { userId: "10000000-0000-4000-8000-000000000001" } } as never;
const request = (headers: Record<string, string> = {}) => new Request("https://app.example/api/slice-rule-portfolio-links", { headers: { cookie: "session=1", "sec-fetch-site": "same-origin", "x-reklamzeka-intent": "slice-rule-portfolio-links-read", ...headers } });

describe("Slice Rule portfolio links HTTP", () => {
  it("reads only the trusted tenant and emits public-safe, closed evidence", async () => {
    const repository = { list: vi.fn(async () => [{ campaignRef: "campaign_aaaaaaaaaaaaaaaaaaaaaaaa", rule: { seriesRef: "slice_rule.demo", revision: 2, kind: "targeting_budget_preservation" }, source: { state: "bound" as const, boundAt: "2026-08-15T10:00:00.000Z" }, decision: null }]) };
    const handler = createSliceRulePortfolioLinksHttpHandler({ repository: repository as never, resolvePrincipal: async () => principal });
    const response = await handler(request());
    expect(response.status).toBe(200);
    expect(repository.list).toHaveBeenCalledWith(workspaceId);
    expect(await response.json()).toMatchObject({ contractVersion: "slice-rule-portfolio-links/1.0.0", links: [{ campaignRef: "campaign_aaaaaaaaaaaaaaaaaaaaaaaa", decision: null }], authority: { canExecute: false, canWriteMeta: false } });
    expect(response.headers.get("X-ReklamZeka-Meta-Write")).toBe("disabled");
  });

  it("fails closed before repository access when the request carries a caller workspace selector", async () => {
    const repository = { list: vi.fn() };
    const handler = createSliceRulePortfolioLinksHttpHandler({ repository: repository as never, resolvePrincipal: async () => principal });
    const response = await handler(request({ "x-workspace-id": "attacker" }));
    expect(response.status).toBe(503);
    expect(repository.list).not.toHaveBeenCalled();
  });
});
