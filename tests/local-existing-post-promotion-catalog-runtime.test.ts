import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { createLocalExistingPostPromotionCatalogRouteHandler } from "@/server/local-existing-post-promotion-catalog-runtime";
import { localDecisionRoomConfig } from "@/server/local-decision-room-runtime";
import { LOCAL_SESSION_COOKIE, mintLocalSessionCapability } from "@/security/local-session-capability";

const signingKey = randomBytes(32);
const workspaceId = "11111111-1111-4111-a111-111111111111";
const userId = "22222222-2222-4222-a222-222222222222";
const config = localDecisionRoomConfig({
  DATABASE_URL: "postgresql://local.invalid/reklamzeka",
  REKLAMZEKA_LOCAL_SESSION_ENABLED: "true",
  REKLAMZEKA_LOCAL_ORIGIN: "http://localhost:3000",
  REKLAMZEKA_LOCAL_WORKSPACE_ID: workspaceId,
  REKLAMZEKA_LOCAL_WORKSPACE_REF: "workspace_local",
  REKLAMZEKA_LOCAL_USER_ID: userId,
  REKLAMZEKA_LOCAL_READER_REF: "reader_local",
  REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY: signingKey.toString("base64"),
})!;

function token() {
  const now = Math.floor(Date.now() / 1000);
  return mintLocalSessionCapability({ kind: "session", workspaceId, workspaceRef: "workspace_local",
    userId, readerRef: "reader_local", osUid: process.getuid!(), issuedAt: now, expiresAt: now + 300 }, signingKey).token;
}

function request(credential: "cookie" | "bearer" = "cookie") {
  const value = token();
  return new Request("http://localhost:3000/api/existing-post-promotion-preflight", { headers: {
    Host: "localhost:3000", Origin: "http://localhost:3000", "Sec-Fetch-Site": "same-origin",
    "X-ReklamZeka-Intent": "existing-post-promotion-catalog-read",
    ...(credential === "cookie" ? { Cookie: `${LOCAL_SESSION_COOKIE}=${encodeURIComponent(value)}` }
      : { Authorization: `Bearer ${value}` }),
  } });
}

describe("local existing-post promotion catalog runtime", () => {
  it("binds the dedicated read scope and returns a real source-backed empty tenant catalog", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [{ workspace_id: workspaceId, user_id: userId, role: "viewer", lifecycle_state: "active" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const response = await createLocalExistingPostPromotionCatalogRouteHandler({ database: { execute } as never, config })(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("x-reklamzeka-access-mode")).toBe("read-only-catalog");
    await expect(response.json()).resolves.toMatchObject({ catalog: { accounts: [], actors: [], posts: [], adSets: [], templates: [] },
      authority: { readOnly: true, canPersist: false, canExecute: false, canWriteMeta: false } });
    expect(execute).toHaveBeenCalledTimes(4);
  });

  it("rejects bearer credentials before membership or catalog storage is touched", async () => {
    const execute = vi.fn();
    const response = await createLocalExistingPostPromotionCatalogRouteHandler({ database: { execute } as never, config })(request("bearer"));
    expect(response.status).toBe(503);
    expect(execute).not.toHaveBeenCalled();
  });

  it("distinguishes a missing dashboard session from an unconfigured source", async () => {
    const execute = vi.fn();
    const response = await createLocalExistingPostPromotionCatalogRouteHandler({ database: { execute } as never, config })(
      new Request("http://localhost:3000/api/existing-post-promotion-preflight", { headers: {
        Host: "localhost:3000", Origin: "http://localhost:3000", "Sec-Fetch-Site": "same-origin",
        "X-ReklamZeka-Intent": "existing-post-promotion-catalog-read",
      } }),
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "local_session_required" } });
    expect(execute).not.toHaveBeenCalled();
  });
});
