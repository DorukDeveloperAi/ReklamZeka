import { describe, expect, it, vi } from "vitest";
import { CategoryAuthoringError } from "@/application/category-authoring-service";
import { createCategoryAuthoringHttpHandlers } from "@/server/category-authoring-http";

const principal = { actor: { userId: "22222222-2222-4222-8222-222222222222" },
  workspaceId: "11111111-1111-4111-8111-111111111111", workspaceRef: "workspace_test", readerRef: "reader_test" } as const;
function request(method: "GET" | "POST", body?: unknown, headers: Record<string, string> = {}) {
  return new Request("http://127.0.0.1:3000/api/category-authoring", { method,
    body: body === undefined ? undefined : JSON.stringify(body), headers: {
      cookie: "__Host-rzka_local_session=opaque", "sec-fetch-site": "same-origin",
      "x-reklamzeka-intent": method === "GET" ? "category-authoring-read" : "category-authoring-mutate",
      ...(method === "POST" ? { origin: "http://127.0.0.1:3000", "content-type": "application/json" } : {}), ...headers,
    } });
}
function handlers(overrides: Record<string, unknown> = {}) {
  const service = { inspect: vi.fn(async () => ({ contractVersion: "category-authoring/1.0.0",
    registryHash: "a".repeat(64), dimensions: [], assignments: [], authority: { canCreate: true } })),
  mutate: vi.fn(async () => ({ contractVersion: "category-authoring/1.0.0", state: { registryHash: "b".repeat(64),
    dimensions: [], assignments: [] }, auditAppended: true, invalidationsAppended: 0 })), ...overrides };
  return { service, http: createCategoryAuthoringHttpHandlers({ service: service as never,
    resolvePrincipal: vi.fn(async () => principal) }) };
}

describe("category authoring HTTP", () => {
  it("serves cookie-only same-origin state without action authority", async () => {
    const { http } = handlers(); const response = await http.GET(request("GET"));
    expect(response.status).toBe(200); expect(response.headers.get("x-reklamzeka-meta-write")).toBe("disabled");
    expect(await response.json()).toMatchObject({ registryHash: "a".repeat(64) });
  });

  it("accepts an exact owner mutation envelope", async () => {
    const { service, http } = handlers();
    const command = { operation: "archive_dimension", dimensionRef: "dimension_1234567890abcdef12345678",
      expectedVersion: 1, expectedRegistryHash: "a".repeat(64), expectedImpactHash: "b".repeat(64) };
    const response = await http.POST(request("POST", { command }));
    expect(response.status).toBe(200); expect(service.mutate).toHaveBeenCalledWith(principal, command);
    expect(await response.json()).toMatchObject({ auditAppended: true });
  });

  it("rejects unknown fields, bearer mixing, query state and malformed JSON before mutation", async () => {
    const { service, http } = handlers(); const command = { operation: "archive_dimension",
      dimensionRef: "dimension_1234567890abcdef12345678", expectedVersion: 1,
      expectedRegistryHash: "a".repeat(64), expectedImpactHash: "b".repeat(64), workspaceId: principal.workspaceId };
    expect((await http.POST(request("POST", { command }))).status).toBe(400);
    expect((await http.GET(request("GET", undefined, { authorization: "Bearer forged" }))).status).toBe(400);
    const queried = new Request("http://127.0.0.1:3000/api/category-authoring?workspace=forged", { headers: {
      cookie: "x", "sec-fetch-site": "same-origin", "x-reklamzeka-intent": "category-authoring-read" } });
    expect((await http.GET(queried)).status).toBe(400); expect(service.mutate).not.toHaveBeenCalled();
    expect((await http.POST(request("POST", { command: { operation: "create_assignment" } }))).status).toBe(400);
  });

  it("maps stale and dependency guards without leaking internals", async () => {
    const command = { operation: "archive_dimension", dimensionRef: "dimension_1234567890abcdef12345678",
      expectedVersion: 1, expectedRegistryHash: "a".repeat(64), expectedImpactHash: "b".repeat(64) };
    for (const [code, status] of [["conflict", 409], ["dependency_blocked", 409], ["manual_lock", 409]] as const) {
      const { http } = handlers({ mutate: vi.fn(async () => { throw new CategoryAuthoringError(code); }) });
      const response = await http.POST(request("POST", { command })); const payload = await response.json();
      expect(response.status).toBe(status); expect(JSON.stringify(payload)).not.toContain(principal.workspaceId);
      expect(payload.authority).toEqual({ canAuthorizeAction: false, canWriteMeta: false });
    }
  });
});
