import { describe, expect, it, vi } from "vitest";
import { createGuidanceStudioHttpHandlers, guidanceStudioSessionRequiredResponse } from "@/server/guidance-studio-http";

const principal = { actor: { userId: "22222222-2222-4222-8222-222222222222" },
  workspaceId: "11111111-1111-4111-8111-111111111111", workspaceRef: "workspace_test", readerRef: "reader_test" } as const;
const snapshot = { contractVersion: "guidance-studio/1.2.0", items: [], sets: [], categories: [], registryHash: "a".repeat(64),
  authority: { canDraft: true, canPublish: true, canReview: true, canArchive: true, canWriteMeta: false,
    canAuthorizeAction: false, canEnforcePolicy: false } } as const;
function request(method: string, intent: string, body?: unknown, extras: Record<string, string> = {}) {
  return new Request("http://localhost:3000/api/guidance-studio", { method, headers: {
    cookie: "session=test", "sec-fetch-site": "same-origin", "x-reklamzeka-intent": intent,
    ...(body === undefined ? {} : { origin: "http://localhost:3000", "content-type": "application/json" }), ...extras,
  }, body: body === undefined ? undefined : JSON.stringify(body) });
}

describe("Guidance Studio HTTP boundary", () => {
  it("returns a redacted no-authority session bootstrap requirement", async () => {
    const response = guidanceStudioSessionRequiredResponse();
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "local_session_required" },
      authority: { canWriteMeta: false, canAuthorizeAction: false, canEnforcePolicy: false } });
  });
  it("reads only with the exact cookie intent", async () => {
    const service = { list: vi.fn(async () => snapshot), createDraft: vi.fn(), mutate: vi.fn() };
    const handlers = createGuidanceStudioHttpHandlers({ service: service as never, resolvePrincipal: async () => principal });
    expect((await handlers.GET(request("GET", "guidance-studio-read"))).status).toBe(200);
    expect((await handlers.GET(request("GET", "wrong"))).status).toBe(400);
    expect((await handlers.GET(request("GET", "guidance-studio-read", undefined, { authorization: "Bearer bad" }))).status).toBe(400);
  });

  it("rejects excess keys and mismatched mutation intent/operation", async () => {
    const service = { list: vi.fn(), createDraft: vi.fn(), mutate: vi.fn() };
    const handlers = createGuidanceStudioHttpHandlers({ service: service as never, resolvePrincipal: async () => principal });
    const common = { cardRef: "guidance_1234567890abcdef12345678", expectedVersion: 1,
      expectedRegistryHash: "a".repeat(64), operation: "publish" };
    expect((await handlers.PATCH(request("PATCH", "guidance-studio-archive", common))).status).toBe(400);
    expect((await handlers.PATCH(request("PATCH", "guidance-studio-publish", { ...common, surprise: true }))).status).toBe(400);
    expect(service.mutate).not.toHaveBeenCalled();
  });

  it("never returns action or Meta write authority on errors", async () => {
    const handlers = createGuidanceStudioHttpHandlers({ service: { list: vi.fn(async () => { throw new Error("secret"); }),
      createDraft: vi.fn(), mutate: vi.fn() } as never, resolvePrincipal: async () => principal });
    const response = await handlers.GET(request("GET", "guidance-studio-read"));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ authority: { canWriteMeta: false, canAuthorizeAction: false, canEnforcePolicy: false } });
  });

  it("routes exact set create/revise/review/archive envelopes without accepting caller scope", async () => {
    const service = { list: vi.fn(), createDraft: vi.fn(), mutate: vi.fn(),
      createSetDraft: vi.fn(async () => ({ set: {}, registryHash: "b".repeat(64) })),
      mutateSet: vi.fn(async () => ({ set: {}, registryHash: "c".repeat(64) })) };
    const handlers = createGuidanceStudioHttpHandlers({ service: service as never,
      resolvePrincipal: async () => principal });
    const cardRef = "guidance_1234567890abcdef12345678";
    expect((await handlers.POST(request("POST", "guidance-set-create", { name: "Sıralı set",
      orderedCardRefs: [cardRef], expectedRegistryHash: "a".repeat(64) }))).status).toBe(201);
    expect(service.createSetDraft).toHaveBeenCalledWith(principal, { name: "Sıralı set",
      orderedCardRefs: [cardRef], expectedRegistryHash: "a".repeat(64) });
    const common = { setRef: "guidance_set_1234567890abcdef12345678", expectedVersion: 1,
      expectedRegistryHash: "b".repeat(64) };
    for (const operation of ["review", "archive"] as const) {
      expect((await handlers.PATCH(request("PATCH", `guidance-set-${operation}`, { ...common, operation }))).status).toBe(200);
    }
    expect((await handlers.PATCH(request("PATCH", "guidance-set-revise", { ...common, operation: "revise",
      name: "Güncel set", orderedCardRefs: [cardRef] }))).status).toBe(200);
    expect((await handlers.POST(request("POST", "guidance-set-create", { name: "Sızma", orderedCardRefs: [cardRef],
      expectedRegistryHash: "a".repeat(64), actorId: principal.actor.userId }))).status).toBe(400);
  });
});
