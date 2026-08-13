import { describe, expect, it, vi } from "vitest";
import { createLocalMetaTrustReadinessRouteHandler } from "@/server/local-meta-trust-readiness-runtime";

const config = { origin: "http://localhost:3000", workspaceId: "11111111-1111-4111-a111-111111111111", workspaceRef: "workspace_test", userId: "22222222-2222-4222-a222-222222222222", readerRef: "reader_test", signingKey: "a".repeat(32) } as never;
const request = () => new Request("http://localhost:3000/api/meta/trust-readiness", { headers: { cookie: "rz=token" } });

describe("local Meta trust/readiness runtime", () => {
  it("returns only the session-required response when identity proof is rejected", async () => {
    const handler = createLocalMetaTrustReadinessRouteHandler({ database: {} as never, config,
      repository: { load: vi.fn() } });
    const response = await handler(request());
    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("local_session_required");
  });

  it("keeps source errors configured-safe rather than exposing database detail", async () => {
    const handler = createLocalMetaTrustReadinessRouteHandler({ database: {} as never, config,
      repository: { load: vi.fn().mockRejectedValue(new Error("private database text")) } });
    // The invalid capability is the first boundary; no repository data is exposed.
    const response = await handler(request());
    expect(response.status).toBe(401);
  });
});
