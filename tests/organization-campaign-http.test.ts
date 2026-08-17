import { describe, expect, it } from "vitest";
import { createOrganizationCampaignHttpHandlers } from "@/server/organization-campaign-http";

const principal = { workspaceId: "w", actor: { userId: "u" }, readerRef: "reader" } as any;
function request(method: string, body?: unknown) { return new Request("http://localhost/api/organization-campaigns", { method, headers: { cookie: "session=x", "sec-fetch-site": "same-origin", "x-reklamzeka-intent": method === "GET" ? "organization-campaign-read" : "organization-campaign-mutate", ...(method === "POST" ? { origin: "http://localhost", "content-type": "application/json" } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) }); }
describe("organization campaign HTTP boundary", () => {
  it("rejects malformed commands before service mutation", async () => {
    let called = false; const handlers = createOrganizationCampaignHttpHandlers({ service: { inspect: async () => ({}), create: async () => { called = true; }, assign: async () => { called = true; } } as any, resolvePrincipal: async () => principal });
    const response = await handlers.POST(request("POST", { command: { operation: "create", label: "x", market: "domestic" } }));
    expect(response.status).toBe(400); expect(called).toBe(false);
  });
  it("uses cookie/session authority and preserves zero Meta-write headers", async () => {
    const handlers = createOrganizationCampaignHttpHandlers({ service: { inspect: async () => ({ organizationCampaigns: [], unassignedCampaigns: [], authority: { canAssign: false, canWriteMeta: false, canAuthorizeAction: false } }), create: async () => ({}), assign: async () => ({}) } as any, resolvePrincipal: async () => principal });
    const response = await handlers.GET(request("GET"));
    expect(response.status).toBe(200); expect(response.headers.get("x-reklamzeka-meta-write")).toBe("disabled");
    expect(JSON.stringify(await response.json())).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
  });
});
