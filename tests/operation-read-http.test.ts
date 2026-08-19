import { describe, expect, it, vi } from "vitest";
import { createOperationReadHttpHandler } from "@/server/operation-read-http";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const request = (url = "http://localhost/api/operations", headers: HeadersInit = {}) => new Request(url, { headers: { cookie: "local=x", "sec-fetch-site": "same-origin", "x-reklamzeka-intent": "operation-read", ...headers } });

describe("operation read HTTP boundary", () => {
  it("allows only the session-bound read contract", async () => {
    const read = vi.fn(async () => ({ state: "empty", authority: { canWriteMeta: false, canExecute: false, canApprove: false } }));
    const handler = createOperationReadHttpHandler({ service: { read } as never, workspaceId: async () => workspaceId });
    const response = await handler(request("http://localhost/api/operations?period=7d&limit=100"));
    expect(response.status).toBe(200);
    expect(read).toHaveBeenCalledWith(workspaceId, { period: "7d", limit: "100" });
    expect(response.headers.get("x-reklamzeka-meta-write")).toBe("disabled");
  });

  it("rejects malformed, cross-origin, bearer, and unauthenticated requests", async () => {
    const handler = createOperationReadHttpHandler({ service: { read: vi.fn() } as never, workspaceId: async () => null });
    expect((await handler(request("http://localhost/api/operations?unknown=x"))).status).toBe(400);
    expect((await handler(request("http://localhost/api/operations", { "sec-fetch-site": "cross-site" }))).status).toBe(400);
    expect((await handler(request("http://localhost/api/operations", { authorization: "Bearer no" }))).status).toBe(400);
    expect((await handler(request())).status).toBe(403);
  });

  it("returns a source failure without mislabeling it as invalid input", async () => {
    const handler = createOperationReadHttpHandler({ service: { read: vi.fn().mockRejectedValue(new Error("database offline")) } as never,
      workspaceId: async () => workspaceId });
    const response = await handler(request());
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("source_unavailable");
  });

  it("maps a fail-closed primary-result binding integrity rejection to unavailable", async () => {
    const handler = createOperationReadHttpHandler({ service: { read: vi.fn().mockRejectedValue(new Error("operation read rejected: primary_result_binding")) } as never,
      workspaceId: async () => workspaceId });
    const response = await handler(request());
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("source_unavailable");
  });
});
