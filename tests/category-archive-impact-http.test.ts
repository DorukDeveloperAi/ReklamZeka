import { describe, expect, it, vi } from "vitest";
import { categoryArchiveImpactSessionRequiredResponse, createCategoryArchiveImpactHttpHandler } from "@/server/category-archive-impact-http";

const principal = { actor: { userId: "22222222-2222-4222-8222-222222222222" },
  workspaceId: "11111111-1111-4111-8111-111111111111", workspaceRef: "workspace_test", readerRef: "reader_test" } as const;
const ref = "dimension_1234567890abcdef12345678";
function request(targetRef = ref, extras: Record<string, string> = {}) {
  return new Request(`http://localhost:3000/api/category-archive-impact?view=archive-impact&targetRef=${targetRef}`,
    { headers: { cookie: "session=test", "sec-fetch-site": "same-origin",
      "x-reklamzeka-intent": "category-archive-impact-preview", ...extras } });
}
describe("category archive impact HTTP boundary", () => {
  it("returns session requirement without archive authority", async () => {
    const response = categoryArchiveImpactSessionRequiredResponse();
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ authority: { canArchive: false, canWriteMeta: false } });
  });
  it("accepts only an exact public-ref preview and never raw UUID/workspace injection", async () => {
    const service = { preview: vi.fn(async () => ({ archiveAllowed: false })) };
    const handler = createCategoryArchiveImpactHttpHandler({ service: service as never, resolvePrincipal: async () => principal });
    expect((await handler(request())).status).toBe(200);
    expect((await handler(request("11111111-1111-4111-8111-111111111111"))).status).toBe(400);
    expect((await handler(request(ref, { "x-workspace-id": principal.workspaceId }))).status).toBe(400);
    expect((await handler(new Request(`${request().url}&extra=1`, { headers: request().headers }))).status).toBe(400);
  });
  it("returns a non-enumerating not-found response", async () => {
    const handler = createCategoryArchiveImpactHttpHandler({ service: { preview: vi.fn(async () => null) } as never,
      resolvePrincipal: async () => principal });
    const response = await handler(request()); expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "not_found" }, authority: { canArchive: false } });
  });
});
