import { describe, expect, it, vi } from "vitest";
import { createGuidanceAgentHttpHandlers } from "@/server/guidance-agent-http";
import { GuidanceFacetScopeError } from "@/application/guidance-facet-scope-resolver";

const principal = { actor: { userId: "22222222-2222-4222-8222-222222222222" },
  workspaceId: "11111111-1111-4111-8111-111111111111", workspaceRef: "workspace_test", readerRef: "reader_test" } as const;
function request(path: string, method: "GET" | "POST", intent: string, body?: unknown, extras: Record<string, string> = {}) {
  return new Request(`http://localhost:3000${path}`, { method, headers: { authorization: "Bearer rzs1.test.test",
    origin: "http://localhost:3000", "sec-fetch-site": "same-origin", "x-reklamzeka-intent": intent,
    ...(body === undefined ? {} : { "content-type": "application/json" }), ...extras },
  body: body === undefined ? undefined : JSON.stringify(body) });
}
describe("Guidance agent HTTP", () => {
  it("maps the exact registry list query to the shared contract", async () => {
    const execute = vi.fn(async () => ({ ok: true }));
    const handlers = createGuidanceAgentHttpHandlers({ contract: { execute } as never, resolvePrincipal: async () => principal });
    const response = await handlers.GET(request("/api/guidance-context?view=list&status=published", "GET", "guidance-registry-list"));
    expect(response.status).toBe(200);
    expect(execute).toHaveBeenCalledWith(principal, { name: "guidance_registry_list", arguments: { status: "published" } });
  });
  it("rejects cookies, caller workspace headers and oversized/extraneous preview envelopes", async () => {
    const execute = vi.fn(); const handlers = createGuidanceAgentHttpHandlers({ contract: { execute } as never,
      resolvePrincipal: async () => principal });
    expect((await handlers.GET(request("/api/guidance-context?view=list", "GET", "guidance-registry-list", undefined,
      { cookie: "x=y" }))).status).toBe(400);
    expect((await handlers.POST(request("/api/guidance-context", "POST", "guidance-effective-preview",
      { context: {}, extra: true }, { "x-workspace-id": principal.workspaceId }))).status).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });
  it("maps stale/cross-tenant refs and missing authoritative catalogs without leaking details", async () => {
    const handlers = createGuidanceAgentHttpHandlers({ contract: { execute: vi.fn()
      .mockRejectedValueOnce(new GuidanceFacetScopeError("unknown_scope_ref"))
      .mockRejectedValueOnce(new GuidanceFacetScopeError("catalog_unavailable"))
      .mockRejectedValueOnce(new GuidanceFacetScopeError("stale_catalog")) } as never,
    resolvePrincipal: async () => principal });
    const body = { context: {} };
    const unknown = await handlers.POST(request("/api/guidance-context", "POST", "guidance-effective-preview", body));
    expect(unknown.status).toBe(400);
    expect(await unknown.json()).toEqual({ error: { code: "unknown_scope_ref",
      message: "Guidance kapsam referansı güncel katalogda bulunamadı." } });
    const unavailable = await handlers.POST(request("/api/guidance-context", "POST", "guidance-effective-preview", body));
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({ error: { code: "catalog_unavailable",
      message: "Guidance kapsam kataloğu kullanılamıyor." } });
    const stale = await handlers.POST(request("/api/guidance-context", "POST", "guidance-effective-preview", body));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ error: { code: "stale_catalog",
      message: "Guidance kapsam kataloğu değişti; yeniden listeleyin." } });
  });
});
