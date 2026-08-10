import { describe, expect, it, vi } from "vitest";
import { createBusinessOutcomeReadHttpHandler } from "@/server/business-outcome-read-http";

const principal = { actor: { userId: "11111111-1111-4111-8111-111111111111" }, workspaceId: "22222222-2222-4222-8222-222222222222", workspaceRef: "workspace_primary", readerRef: "reader_primary" } as const;
function request(path = "?entityRef=campaign_primary&limit=25") { return new Request(`http://localhost:3000/api/business-outcomes${path}`, { headers: { host: "localhost:3000", cookie: "__Host-rzka_local_session=capability", origin: "http://localhost:3000", "sec-fetch-site": "same-origin", "x-reklamzeka-intent": "business-outcome-read" } }); }
describe("business outcome read HTTP", () => {
  it("allows only cookie-scoped GET reads and keeps action authority false", async () => {
    const list = vi.fn(async () => ({ items: [], nextCursor: null, capabilities: { canExecuteWrite: false } }));
    const GET = createBusinessOutcomeReadHttpHandler({ service: { list } as never, resolvePrincipal: async () => principal });
    const response = await GET(request());
    expect(response.status).toBe(200); expect(response.headers.get("X-ReklamZeka-Access-Mode")).toBe("business-outcome-read"); expect(response.headers.get("X-ReklamZeka-Action-Authority")).toBe("none");
    expect(list).toHaveBeenCalledWith(principal, { entityRef: "campaign_primary", limit: 25, cursor: undefined });
  });
  it("rejects writes, forwarded identity and unknown query fields", async () => {
    const list = vi.fn(); const GET = createBusinessOutcomeReadHttpHandler({ service: { list } as never, resolvePrincipal: async () => principal });
    const forged = new Request("http://localhost:3000/api/business-outcomes?workspaceId=forged", { method: "POST", headers: { cookie: "x", origin: "http://localhost:3000", "sec-fetch-site": "same-origin", "x-reklamzeka-intent": "business-outcome-read", forwarded: "forged" } });
    expect((await GET(forged)).status).toBe(400); expect(list).not.toHaveBeenCalled();
  });
});
