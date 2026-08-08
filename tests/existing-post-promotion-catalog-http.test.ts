import { describe, expect, it, vi } from "vitest";

import { ExistingPostPromotionCatalogService } from "@/application/existing-post-promotion-catalog";
import { createExistingPostPromotionCatalogHttpHandler } from "@/server/existing-post-promotion-catalog-http";

const origin = "http://localhost:3000";
const workspaceId = "11111111-1111-4111-a111-111111111111";
const principal = { actor: { userId: "user_owner" }, workspaceId, workspaceRef: "workspace_local", readerRef: "reader_owner" } as const;
const empty = { accounts: [], actors: [], posts: [], adSets: [], templates: [], audiencePresets: [], internalCategories: [], objectives: [], budgetPlans: [], timeframes: [] } as const;

function request(extra: Record<string, string> = {}) {
  return new Request(`${origin}/api/existing-post-promotion-preflight`, { headers: {
    Host: "localhost:3000", "Sec-Fetch-Site": "same-origin", Cookie: "__Host-rzka_local_session=opaque",
    "X-ReklamZeka-Intent": "existing-post-promotion-catalog-read", ...extra,
  } });
}

function harness() {
  const repository = { list: vi.fn(async () => empty) };
  const service = new ExistingPostPromotionCatalogService(repository, [{ userId: principal.actor.userId, workspaceId, role: "viewer" }]);
  const resolvePrincipal = vi.fn(async () => principal);
  return { repository, resolvePrincipal, GET: createExistingPostPromotionCatalogHttpHandler({ service, origin, resolvePrincipal }) };
}

describe("existing-post promotion guided catalog HTTP", () => {
  it("returns a tenant-bound public empty catalog with all action authority false", async () => {
    const api = harness(); const response = await api.GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("x-reklamzeka-access-mode")).toBe("read-only-catalog");
    expect(response.headers.get("x-reklamzeka-action-authority")).toBe("none");
    expect(api.repository.list).toHaveBeenCalledWith({ workspaceId });
    expect(await response.json()).toMatchObject({ catalog: empty, authority: {
      readOnly: true, canPersist: false, canApprove: false, canExecute: false, canWriteMeta: false, canGenerateCreative: false,
    } });
  });

  it("rejects bearer, proxy, missing cookie, caller workspace and wrong intent before principal resolution", async () => {
    const api = harness();
    for (const candidate of [request({ Authorization: "Bearer secret" }), request({ "X-Forwarded-For": "127.0.0.1" }),
      request({ Cookie: "" }), request({ "X-Workspace-Id": workspaceId }), request({ "X-ReklamZeka-Intent": "write" })]) {
      expect((await api.GET(candidate)).status).toBe(400);
    }
    expect(api.resolvePrincipal).not.toHaveBeenCalled();
    expect(api.repository.list).not.toHaveBeenCalled();
  });
});
