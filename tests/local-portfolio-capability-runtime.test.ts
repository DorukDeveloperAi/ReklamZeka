import { describe, expect, it, vi } from "vitest";
import { createLocalPortfolioCapabilityRouteHandler } from "@/server/local-portfolio-capability-runtime";
import { localDecisionRoomConfig } from "@/server/local-decision-room-runtime";
import { LOCAL_SESSION_COOKIE, mintLocalSessionCapability } from "@/security/local-session-capability";

const config = localDecisionRoomConfig({
  DATABASE_URL: "postgresql://server-only.invalid/database",
  REKLAMZEKA_LOCAL_SESSION_ENABLED: "true",
  REKLAMZEKA_LOCAL_ORIGIN: "http://localhost:3000",
  REKLAMZEKA_LOCAL_WORKSPACE_ID: "11111111-1111-4111-a111-111111111111",
  REKLAMZEKA_LOCAL_WORKSPACE_REF: "workspace_local",
  REKLAMZEKA_LOCAL_USER_ID: "22222222-2222-4222-a222-222222222222",
  REKLAMZEKA_LOCAL_READER_REF: "reader_local_owner",
  REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY: Buffer.alloc(32, 7).toString("base64"),
})!;
const key = Buffer.alloc(32, 7);
const token = mintLocalSessionCapability({ kind: "session", workspaceId: config.workspaceId, workspaceRef: config.workspaceRef,
  userId: config.userId, readerRef: config.readerRef, osUid: process.getuid?.() ?? 0,
  issuedAt: Math.floor(Date.now() / 1000) - 1, expiresAt: Math.floor(Date.now() / 1000) + 60 }, key).token;

function request(cookie = false, path = "/api/meta/portfolio-capability") {
  return new Request(`http://localhost:3000${path}`, { headers: {
    Host: "localhost:3000", "Sec-Fetch-Site": "same-origin", ...(cookie ? { Cookie: `${LOCAL_SESSION_COOKIE}=${token}` } : {}),
  } });
}

describe("local portfolio capability runtime", () => {
  it("requires a same-origin local session before reading the database", async () => {
    const database = { execute: vi.fn(), select: vi.fn(), transaction: vi.fn() };
    const response = await createLocalPortfolioCapabilityRouteHandler({ database: database as never, config })(request());
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: { code: "local_session_required", message: "Portföy kapsamı için yerel dashboard oturumunu bağlayın." } });
    expect(response.headers.get("x-reklamzeka-action-authority")).toBe("none");
    expect(database.execute).not.toHaveBeenCalled();
  });

  it("returns only the repository's public-safe read model", async () => {
    const database = { execute: vi.fn().mockResolvedValue({ rows: [{ workspace_id: config.workspaceId, user_id: config.userId, role: "owner", lifecycle_state: "active" }] }), select: vi.fn(), transaction: vi.fn() };
    const load = vi.fn().mockResolvedValue({ version: "meta-portfolio-capability/1.0.0", connections: [], accounts: [] });
    const response = await createLocalPortfolioCapabilityRouteHandler({ database: database as never, config, repository: { load } })(request(true));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ version: "meta-portfolio-capability/1.0.0", connections: [], accounts: [] });
    expect(load).toHaveBeenCalledWith(config.workspaceId);
    expect(response.headers.get("x-reklamzeka-access-mode")).toBe("read-only");
    expect(response.headers.get("x-reklamzeka-action-authority")).toBe("none");
  });

  it("rejects query parameters without loading capability data", async () => {
    const database = { execute: vi.fn().mockResolvedValue({ rows: [{ workspace_id: config.workspaceId, user_id: config.userId, role: "owner", lifecycle_state: "active" }] }), select: vi.fn(), transaction: vi.fn() };
    const load = vi.fn();
    const response = await createLocalPortfolioCapabilityRouteHandler({ database: database as never, config, repository: { load } })(request(true, "/api/meta/portfolio-capability?workspaceId=other"));
    expect(response.status).toBe(400);
    expect(load).not.toHaveBeenCalled();
  });
});
