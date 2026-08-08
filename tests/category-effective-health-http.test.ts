import { describe, expect, it, vi } from "vitest";
import { EffectiveCategoryHealthScanError } from "@/application/category-effective-health-scanner";
import { createCategoryEffectiveHealthHttpHandler,
  categoryEffectiveHealthSessionRequiredResponse } from "@/server/category-effective-health-http";

const principal = { actor: { userId: "22222222-2222-4222-8222-222222222222" },
  workspaceId: "11111111-1111-4111-8111-111111111111", workspaceRef: "workspace_test", readerRef: "reader_test" } as const;
function request(intent = "category-effective-health-read", extras: Record<string, string> = {}) {
  return new Request("http://localhost:3000/api/category-effective-health", { headers: { cookie: "session=test",
    "sec-fetch-site": "same-origin", "x-reklamzeka-intent": intent, ...extras } });
}

describe("Category effective health HTTP boundary", () => {
  it("requires the local session without granting authority", async () => {
    const response = categoryEffectiveHealthSessionRequiredResponse();
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "local_session_required" }, status: "incomplete",
      authority: { canAssign: false, canWriteMeta: false, canAuthorizeAction: false } });
  });

  it("accepts only exact cookie-bound same-origin reads", async () => {
    const service = { inspect: vi.fn(async () => ({ status: "complete" })) };
    const handler = createCategoryEffectiveHealthHttpHandler({ service: service as never, resolvePrincipal: async () => principal });
    expect((await handler(request())).status).toBe(200);
    expect((await handler(request("wrong"))).status).toBe(400);
    expect((await handler(request("category-effective-health-read", { authorization: "Bearer bad" }))).status).toBe(400);
    expect((await handler(new Request("http://localhost:3000/api/category-effective-health?workspace=other", { headers: {
      cookie: "session=test", "sec-fetch-site": "same-origin", "x-reklamzeka-intent": "category-effective-health-read" } }))).status).toBe(400);
  });

  it("fails closed and redacts material when capacity is exceeded", async () => {
    const service = { inspect: vi.fn(async () => { throw new EffectiveCategoryHealthScanError("capacity_exceeded", "hierarchy_paths"); }) };
    const handler = createCategoryEffectiveHealthHttpHandler({ service: service as never, resolvePrincipal: async () => principal });
    const response = await handler(request());
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { code: "capacity_exceeded" }, status: "incomplete",
      authority: { canAssign: false, canWriteMeta: false } });
  });
});
