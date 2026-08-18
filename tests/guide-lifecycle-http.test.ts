import { describe, expect, it, vi } from "vitest";
import { createGuideLifecycleHttpHandlers } from "@/server/guide-lifecycle-http";

const principal = { actor: { userId: "11111111-1111-4111-a111-111111111111" }, workspaceId: "22222222-2222-4222-a222-222222222222", workspaceRef: "workspace_1234567890abcdef", readerRef: "reader_local" } as const;
const request = (method: string, intent: string, body?: unknown, extra: HeadersInit = {}) => new Request("http://localhost:3000/api/guides", { method,
  headers: { cookie: "local=x", "sec-fetch-site": "same-origin", "x-reklamzeka-intent": intent, ...(body === undefined ? {} : { origin: "http://localhost:3000", "content-type": "application/json" }), ...extra },
  body: body === undefined ? undefined : JSON.stringify(body) });

describe("guide lifecycle HTTP", () => {
  it("keeps read, draft and activation principal resolution distinct and authority closed", async () => {
    const service = { list: vi.fn(async () => ({ contractVersion: "guide-lifecycle-workspace/1.0.0", items: [], authority: { canWriteMeta: false, canExecute: false, canDraft: true, canActivate: true } })), create: vi.fn(async () => ({ guideId: "x" })), mutate: vi.fn(async () => ({ accepted: true })) };
    const operations: string[] = [];
    const handlers = createGuideLifecycleHttpHandlers({ service: service as never, resolvePrincipal: async (_request, operation) => { operations.push(operation); return principal; } });
    expect((await handlers.GET(request("GET", "guide-lifecycle-read"))).status).toBe(200);
    expect((await handlers.POST(request("POST", "guide-lifecycle-create", { label: "K" }))).status).toBe(201);
    expect((await handlers.PATCH(request("PATCH", "guide-lifecycle-accept", { operation: "accept" }))).status).toBe(200);
    expect((await handlers.PATCH(request("PATCH", "guide-lifecycle-activate", { operation: "activate" }))).status).toBe(200);
    expect(operations).toEqual(["read", "draft", "draft", "activate"]);
    expect(service.mutate).toHaveBeenCalledTimes(2);
  });

  it("rejects bearer/workspace overrides, cross-origin bodies, mismatched intents and oversized input", async () => {
    const service = { list: vi.fn(), create: vi.fn(), mutate: vi.fn() };
    const handlers = createGuideLifecycleHttpHandlers({ service: service as never, resolvePrincipal: async () => principal });
    expect((await handlers.GET(request("GET", "guide-lifecycle-read", undefined, { authorization: "Bearer x" }))).status).toBe(400);
    expect((await handlers.GET(request("GET", "guide-lifecycle-read", undefined, { "x-workspace-id": principal.workspaceId }))).status).toBe(400);
    expect((await handlers.POST(request("POST", "guide-lifecycle-create", { label: "K" }, { origin: "https://evil.test" }))).status).toBe(400);
    expect((await handlers.PATCH(request("PATCH", "guide-lifecycle-activate", { operation: "pause" }))).status).toBe(400);
    expect((await handlers.POST(request("POST", "guide-lifecycle-create", { freeText: "x".repeat(17_000) }))).status).toBe(400);
    expect(service.create).not.toHaveBeenCalled(); expect(service.mutate).not.toHaveBeenCalled();
  });
});
