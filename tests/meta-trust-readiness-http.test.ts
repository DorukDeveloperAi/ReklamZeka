import { describe, expect, it, vi } from "vitest";
import { createMetaTrustReadinessHttpHandler } from "@/server/meta-trust-readiness-http";

const report = Object.freeze({ version: "meta-trust-readiness-read/1.0.0", reports: [], authority: {
  actionAuthority: "none" as const, canPublish: false as const, canApprove: false as const,
  canExecute: false as const, canWriteMeta: false as const,
} });
function request(path = "/api/meta/trust-readiness") { return new Request(`http://localhost${path}`); }

describe("Meta trust/readiness HTTP boundary", () => {
  it("only permits queryless GET and returns the canonical read-only envelope", async () => {
    const load = vi.fn().mockResolvedValue(report);
    const handler = createMetaTrustReadinessHttpHandler({ load, workspaceId: vi.fn().mockResolvedValue("workspace") });
    const response = await handler(request());
    expect(response.status).toBe(200);
    expect(load).toHaveBeenCalledWith("workspace");
    expect(response.headers.get("X-ReklamZeka-Meta-Network")).toBe("disabled");
    expect(await response.json()).toEqual(report);
  });

  it("rejects query, mutation, and absent principal without loading evidence", async () => {
    const load = vi.fn().mockResolvedValue(report);
    const handler = createMetaTrustReadinessHttpHandler({ load, workspaceId: vi.fn().mockResolvedValue(null) });
    expect((await handler(request("/api/meta/trust-readiness?account=x"))).status).toBe(400);
    expect((await handler(new Request("http://localhost/api/meta/trust-readiness", { method: "POST" }))).status).toBe(400);
    expect((await handler(request())).status).toBe(403);
    expect(load).not.toHaveBeenCalled();
  });
});
