import { describe, expect, it, vi } from "vitest";
import { CategoryProfileLifecycleError } from "@/application/category-profile-lifecycle-service";
import { createCategoryProfileLifecycleHttpHandlers } from "@/server/category-profile-lifecycle-http";

const principal = { actor: { userId: "22222222-2222-4222-8222-222222222222" },
  workspaceId: "11111111-1111-4111-8111-111111111111", workspaceRef: "workspace_test",
  readerRef: "actor_owner" } as const;
function request(method: "GET" | "POST", body?: unknown, extra: Record<string, string> = {}) {
  return new Request("http://localhost:3000/api/category-profiles", { method,
    body: body === undefined ? undefined : JSON.stringify(body), headers: { cookie: "__Host-rzka_local_session=opaque",
      "sec-fetch-site": "same-origin", "x-reklamzeka-intent": method === "GET" ? "category-profile-read" : "category-profile-mutate",
      ...(method === "POST" ? { origin: "http://localhost:3000", "content-type": "application/json" } : {}), ...extra } });
}
function setup(mutate = vi.fn(async () => ({ state: { registryHash: "b".repeat(64), definitions: [] },
  profile: {}, auditAppended: true, invalidationsAppended: 1 }))) {
  const service = { inspect: vi.fn(async () => ({ contractVersion: "category-profile-lifecycle/1.0.0",
    registryHash: "a".repeat(64), definitions: [], authority: {} })), mutate };
  return { service, http: createCategoryProfileLifecycleHttpHandlers({ service: service as never,
    resolvePrincipal: vi.fn(async () => principal) }) };
}

describe("CategoryProfile lifecycle HTTP", () => {
  it("serves the tenant-bound catalog through cookie-only same-origin GET", async () => {
    const { service, http } = setup(); const response = await http.GET(request("GET"));
    expect(response.status).toBe(200); expect(response.headers.get("x-reklamzeka-meta-write")).toBe("disabled");
    expect(service.inspect).toHaveBeenCalledWith(principal);
    expect((await http.GET(request("GET", undefined, { authorization: "Bearer forged" }))).status).toBe(400);
  });

  it("accepts only the exact OCC lifecycle envelope and rejects actor/workspace/owner injection", async () => {
    const command = { operation: "publish", profileRef: "category_profile_test", expectedVersion: 2,
      expectedProfileHash: "b".repeat(64), expectedRegistryHash: "a".repeat(64), reasonCode: "owner_publish" };
    const { service, http } = setup(); expect((await http.POST(request("POST", { command }))).status).toBe(200);
    expect(service.mutate).toHaveBeenCalledWith(principal, command);
    for (const injected of [{ ownerRef: "actor_forged" }, { workspaceRef: "workspace_forged" },
      { actorRef: "actor_forged" }, { canAuthorizeAction: true }]) {
      expect((await http.POST(request("POST", { command: { ...command, ...injected } }))).status).toBe(400);
    }
    expect((await http.POST(request("POST", { command }, { origin: "https://forged.invalid" }))).status).toBe(400);
  });

  it("maps OCC and lifecycle conflicts without leaking internal identity", async () => {
    const command = { operation: "archive", profileRef: "category_profile_test", expectedVersion: 2,
      expectedProfileHash: "b".repeat(64), expectedRegistryHash: "a".repeat(64), reasonCode: "owner_archive" };
    for (const code of ["conflict", "invalid_transition"] as const) {
      const response = await setup(vi.fn(async () => { throw new CategoryProfileLifecycleError(code); })).http
        .POST(request("POST", { command }));
      expect(response.status).toBe(409); const payload = await response.json();
      expect(JSON.stringify(payload)).not.toContain(principal.workspaceId);
      expect(payload.authority).toEqual({ canPublishPolicy: false, canAuthorizeAction: false,
        canExecute: false, canWriteMeta: false });
    }
  });
});
