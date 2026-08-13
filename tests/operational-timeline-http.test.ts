import { describe, expect, it } from "vitest";
import { createOperationalTimelineHttpHandler } from "@/server/operational-timeline-http";

const principal = { actor: { userId: "11111111-1111-4111-8111-111111111111" }, workspaceId: "22222222-2222-4222-8222-222222222222", workspaceRef: "workspace_demo", readerRef: "reader_demo" } as const;
function request(headers: Record<string, string> = {}) { return new Request("http://localhost/api/operational-timeline", { headers: { cookie: "rz=token", "sec-fetch-site": "same-origin", ...headers } }); }
describe("operational timeline HTTP", () => {
  it("accepts a cookie-bound same-origin GET without requiring an Origin header", async () => {
    const handler = createOperationalTimelineHttpHandler({ service: { list: async () => ({ contractVersion: "operational-timeline/1.0.0", items: [], authority: { readOnly: true, canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false, canEnableAutomation: false } }) } as never, resolvePrincipal: async () => principal });
    const response = await handler(request());
    expect(response.status).toBe(200); expect(response.headers.get("x-reklamzeka-action-authority")).toBe("none");
  });
  it("rejects bearer and cross-site requests", async () => {
    const handler = createOperationalTimelineHttpHandler({ service: { list: async () => null } as never, resolvePrincipal: async () => principal });
    expect((await handler(request({ authorization: "Bearer no", "sec-fetch-site": "same-origin" }))).status).toBe(400);
    expect((await handler(request({ "sec-fetch-site": "cross-site" }))).status).toBe(400);
  });
});
