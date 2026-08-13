import { describe, expect, it, vi } from "vitest";
import { createTemporalRecommendationHttpHandler } from "@/server/temporal-recommendation-http";

const command = { frozenContextRef: "a".repeat(64), ruleSeriesRef: "series_demo", windowRef: "window_demo" };
function request(method: "GET" | "POST", body?: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/temporal-recommendations", { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { cookie: "rz=token", "sec-fetch-site": "same-origin", ...(body === undefined ? {} : { "content-type": "application/json", "x-reklamzeka-intent": "temporal-recommendation-evaluate" }), ...headers } });
}
describe("temporal recommendation HTTP", () => {
  it("reads only through a cookie-bound same-origin request", async () => {
    const list = vi.fn().mockResolvedValue([]);
    const handlers = createTemporalRecommendationHttpHandler({ service: { list, evaluate: vi.fn() }, resolvePrincipal: vi.fn() });
    const response = await handlers.GET(request("GET"));
    expect(response.status).toBe(200); expect(response.headers.get("x-reklamzeka-action-authority")).toBe("none"); expect(list).toHaveBeenCalledOnce();
  });
  it("evaluates only server-resolved reference commands", async () => {
    const evaluate = vi.fn().mockResolvedValue({ contractVersion: "temporal-recommendation/1.0.0" });
    const handlers = createTemporalRecommendationHttpHandler({ service: { list: vi.fn(), evaluate }, resolvePrincipal: vi.fn() });
    expect((await handlers.POST(request("POST", command))).status).toBe(200); expect(evaluate).toHaveBeenCalledWith(command);
    expect((await handlers.POST(request("POST", { ...command, spend: 1 }))).status).toBe(400);
  });
  it("rejects bearer and cross-site commands", async () => {
    const handlers = createTemporalRecommendationHttpHandler({ service: { list: vi.fn(), evaluate: vi.fn() }, resolvePrincipal: vi.fn() });
    expect((await handlers.POST(request("POST", command, { authorization: "Bearer no" }))).status).toBe(400);
    expect((await handlers.POST(request("POST", command, { "sec-fetch-site": "cross-site" }))).status).toBe(400);
  });
});
