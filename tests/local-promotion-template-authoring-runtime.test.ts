import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { LOCAL_SESSION_COOKIE, mintLocalSessionCapability } from "@/security/local-session-capability";
import { localDecisionRoomConfig } from "@/server/local-decision-room-runtime";
import { createLocalPromotionTemplateAuthoringHandlers } from "@/server/local-promotion-template-authoring-runtime";

const signingKey = randomBytes(32);
const workspaceId = "11111111-1111-4111-a111-111111111111";
const userId = "22222222-2222-4222-a222-222222222222";
const origin = "http://localhost:3000";
const config = localDecisionRoomConfig({
  DATABASE_URL: "postgresql://local.invalid/reklamzeka",
  REKLAMZEKA_LOCAL_SESSION_ENABLED: "true",
  REKLAMZEKA_LOCAL_ORIGIN: origin,
  REKLAMZEKA_LOCAL_WORKSPACE_ID: workspaceId,
  REKLAMZEKA_LOCAL_WORKSPACE_REF: "workspace_local",
  REKLAMZEKA_LOCAL_USER_ID: userId,
  REKLAMZEKA_LOCAL_READER_REF: "reader_local",
  REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY: signingKey.toString("base64"),
})!;

function token() {
  const now = Math.floor(Date.now() / 1000);
  return mintLocalSessionCapability({ kind: "session", workspaceId, workspaceRef: "workspace_local", userId,
    readerRef: "reader_local", osUid: process.getuid!(), issuedAt: now, expiresAt: now + 300 }, signingKey).token;
}

function request(method: "GET" | "POST", credential: "cookie" | "bearer" = "cookie") {
  const session = token();
  return new Request(`${origin}/api/promotion-template-authoring`, { method, headers: {
    Host: "localhost:3000", ...(method === "POST" ? { Origin: origin, "Content-Type": "application/json" } : {}),
    "Sec-Fetch-Site": "same-origin", "X-ReklamZeka-Intent": method === "GET"
      ? "promotion-template-authoring-read" : "promotion-template-authoring-dry-run",
    ...(credential === "cookie" ? { Cookie: `${LOCAL_SESSION_COOKIE}=${encodeURIComponent(session)}` }
      : { Authorization: `Bearer ${session}` }),
  }, ...(method === "POST" ? { body: JSON.stringify({ selection: { scopeRef: null, postType: null, instruction: null } }) } : {}) });
}

function lifecycleRequest() {
  return new Request(`${origin}/api/promotion-template-authoring`, { headers: { Host: "localhost:3000",
    "Sec-Fetch-Site": "same-origin", Cookie: `${LOCAL_SESSION_COOKIE}=${encodeURIComponent(token())}`,
    "X-ReklamZeka-Intent": "promotion-template-lifecycle-read" } });
}

describe("local PromotionTemplate authoring runtime", () => {
  it("binds the cookie principal and dedicated catalog read scope before returning a source-backed catalog", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [{ workspace_id: workspaceId, user_id: userId, role: "analyst", lifecycle_state: "active" }] })
      .mockResolvedValueOnce({ rows: [] });
    const response = await createLocalPromotionTemplateAuthoringHandlers({ database: { execute } as never, config }).GET(request("GET"));
    expect(response.status).toBe(200);
    expect(response.headers.get("x-reklamzeka-access-mode")).toBe("promotion-template-dry-run");
    await expect(response.json()).resolves.toMatchObject({ role: "analyst", catalog: { scopes: [] },
      capabilities: { canDryRun: true, canPersistDraft: false, canPublish: false, canWriteMeta: false } });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("lets analyst ask unresolved questions but denies viewer before catalog storage", async () => {
    const analystExecute = vi.fn()
      .mockResolvedValueOnce({ rows: [{ workspace_id: workspaceId, user_id: userId, role: "analyst", lifecycle_state: "active" }] })
      .mockResolvedValueOnce({ rows: [] });
    const analyst = await createLocalPromotionTemplateAuthoringHandlers({ database: { execute: analystExecute } as never, config })
      .POST(request("POST"));
    expect(analyst.status).toBe(200);
    await expect(analyst.json()).resolves.toMatchObject({ result: { status: "unresolved", publishReady: false,
      recommendation: null, dryRunOnly: true } });

    const viewerExecute = vi.fn().mockResolvedValueOnce({ rows: [{ workspace_id: workspaceId, user_id: userId,
      role: "viewer", lifecycle_state: "active" }] });
    const viewer = await createLocalPromotionTemplateAuthoringHandlers({ database: { execute: viewerExecute } as never, config })
      .POST(request("POST"));
    expect(viewer.status).toBe(403);
    expect(viewerExecute).toHaveBeenCalledTimes(1);
  });

  it("rejects bearer credentials before membership or catalog storage", async () => {
    const execute = vi.fn();
    const response = await createLocalPromotionTemplateAuthoringHandlers({ database: { execute } as never, config })
      .GET(request("GET", "bearer"));
    expect(response.status).toBe(400);
    expect(execute).not.toHaveBeenCalled();
  });

  it("binds lifecycle reads to the cookie session and returns only an empty bounded OCC summary", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [{ workspace_id: workspaceId, user_id: userId, role: "analyst", lifecycle_state: "active" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });
    const response = await createLocalPromotionTemplateAuthoringHandlers({ database: { execute } as never, config })
      .GET(lifecycleRequest());
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({ contractVersion: "promotion-template-lifecycle-service/1.0.0",
      presetCurrent: [], templateCurrent: [], authority: { canDraft: true, canPublish: false, canWriteMeta: false } });
    expect(JSON.stringify(payload)).not.toContain("targeting");
    expect(execute).toHaveBeenCalledTimes(3);
  });
});
