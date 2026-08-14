import { describe, expect, it, vi } from "vitest";
import { createSliceOperationalReadinessHttpHandler } from "@/server/slice-operational-readiness-http";

const principal = { workspaceId: "workspace", actor: { id: "user", role: "owner" } } as any;
const projection = { version: "slice-operational-readiness/1.0.0", items: [], authority: { canSave: false, canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false } };
describe("slice operational readiness HTTP", () => {
  it("accepts only a queryless session-bound GET and declares no authority", async () => {
    const list = vi.fn().mockResolvedValue(projection);
    const handler = createSliceOperationalReadinessHttpHandler({ service: { list }, resolvePrincipal: vi.fn().mockResolvedValue(principal) });
    const request = new Request("http://localhost/api/slice-operational-readiness", { headers: { cookie: "session=x", "sec-fetch-site": "same-origin", "x-reklamzeka-intent": "slice-operational-readiness-read" } });
    expect((await handler(request)).headers.get("X-ReklamZeka-Action-Authority")).toBe("none");
    expect(list).toHaveBeenCalledWith(principal);
    expect((await handler(new Request("http://localhost/api/slice-operational-readiness?candidate=x", { headers: request.headers }))).status).toBe(400);
    expect((await handler(new Request("http://localhost/api/slice-operational-readiness", { method: "POST", headers: request.headers }))).status).toBe(400);
  });
});
