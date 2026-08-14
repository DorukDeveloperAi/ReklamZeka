import { describe, expect, it, vi } from "vitest";
import { createSliceScopeCandidatesHttpHandler } from "@/server/slice-scope-candidates-http";
const principal = { workspaceId: "workspace", actor: { id: "user", role: "owner" } } as any;
const projection = { version: "slice-scope-candidates/1.0.0", candidates: [], authority: { canSave: false, canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false } };
describe("slice scope candidates HTTP", () => {
  it("accepts only a same-origin queryless session-bound GET and exposes no authority", async () => {
    const list = vi.fn().mockResolvedValue(projection); const handler = createSliceScopeCandidatesHttpHandler({ service: { list }, resolvePrincipal: vi.fn().mockResolvedValue(principal) });
    const request = new Request("http://localhost/api/slice-scope-candidates", { headers: { cookie: "session=x", "sec-fetch-site": "same-origin", "x-reklamzeka-intent": "slice-scope-candidates-read" } });
    const response = await handler(request); expect(response.status).toBe(200); expect(response.headers.get("X-ReklamZeka-Action-Authority")).toBe("none"); expect(list).toHaveBeenCalledWith(principal);
    expect((await handler(new Request("http://localhost/api/slice-scope-candidates?x=1", { headers: request.headers }))).status).toBe(400);
    expect((await handler(new Request("http://localhost/api/slice-scope-candidates", { method: "POST", headers: request.headers }))).status).toBe(400);
  });
});
