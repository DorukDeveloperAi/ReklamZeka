import { describe, expect, it, vi } from "vitest";
import { createCategoryInventoryHttpHandler, categoryInventorySessionRequiredResponse } from "@/server/category-inventory-http";

const principal = { actor: { userId: "22222222-2222-4222-8222-222222222222" },
  workspaceId: "11111111-1111-4111-8111-111111111111", workspaceRef: "workspace_test", readerRef: "reader_test" } as const;
function request(intent = "category-inventory-read", extras: Record<string, string> = {}) {
  return new Request("http://localhost:3000/api/category-inventory", { headers: { cookie: "session=test",
    "sec-fetch-site": "same-origin", "x-reklamzeka-intent": intent, ...extras } });
}

describe("Category inventory HTTP boundary", () => {
  it("exposes a redacted session requirement with no authority", async () => {
    const response = categoryInventorySessionRequiredResponse();
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "local_session_required" },
      authority: { canAssign: false, canWriteMeta: false, canAuthorizeAction: false } });
  });

  it("accepts only exact cookie-bound same-origin reads", async () => {
    const service = { list: vi.fn(async () => ({ dimensions: [] })) };
    const handler = createCategoryInventoryHttpHandler({ service: service as never, resolvePrincipal: async () => principal });
    expect((await handler(request())).status).toBe(200);
    expect((await handler(request("wrong"))).status).toBe(400);
    expect((await handler(request("category-inventory-read", { authorization: "Bearer bad" }))).status).toBe(400);
    expect((await handler(new Request("http://localhost:3000/api/category-inventory?workspace=other", {
      headers: { cookie: "session=test", "sec-fetch-site": "same-origin",
        "x-reklamzeka-intent": "category-inventory-read" } }))).status).toBe(400);
  });
});
