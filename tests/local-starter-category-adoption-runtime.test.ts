import { describe, expect, it, vi } from "vitest";

import { createLocalStarterCategoryAdoptionHandlers } from "@/server/local-starter-category-adoption-runtime";
import { localDecisionRoomConfig } from "@/server/local-decision-room-runtime";
import { LOCAL_SESSION_COOKIE, mintLocalSessionCapability } from "@/security/local-session-capability";

const workspaceId = "11111111-1111-4111-a111-111111111111";
const userId = "22222222-2222-4222-a222-222222222222";
const signingKey = Buffer.alloc(32, 23);
function config() { return localDecisionRoomConfig({ DATABASE_URL: "postgresql://server-only.invalid/database",
  REKLAMZEKA_LOCAL_SESSION_ENABLED: "true", REKLAMZEKA_LOCAL_ORIGIN: "http://localhost:3000",
  REKLAMZEKA_LOCAL_WORKSPACE_ID: workspaceId, REKLAMZEKA_LOCAL_WORKSPACE_REF: "workspace_starter_test",
  REKLAMZEKA_LOCAL_USER_ID: userId, REKLAMZEKA_LOCAL_READER_REF: "actor_starter_test",
  REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY: signingKey.toString("base64") })!; }
function token() { const now = Math.floor(Date.now() / 1_000); return mintLocalSessionCapability({ kind: "session",
  workspaceId, workspaceRef: "workspace_starter_test", userId, readerRef: "actor_starter_test",
  osUid: process.getuid!(), issuedAt: now - 1, expiresAt: now + 300 }, signingKey).token; }
function request(session = token()) { return new Request("http://localhost:3000/api/starter-category-adoption", {
  method: "POST", headers: { Host: "localhost:3000",
    Cookie: `${LOCAL_SESSION_COOKIE}=${encodeURIComponent(session)}`, Origin: "http://localhost:3000",
    "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json",
    "X-ReklamZeka-Intent": "starter-category-adoption-confirm" }, body: JSON.stringify({
      planHash: "a".repeat(64), expectedRegistryHash: "b".repeat(64), expectedProfileRegistryHash: "c".repeat(64),
      targetRefs: ["dimension_safe"], confirmation: "adopt_starter_category_playbook",
      acknowledgedPendingOwnerConfiguration: true,
    }) }); }

describe("local starter category adoption runtime", () => {
  it("binds the publish-scoped cookie but denies analyst before the adoption transaction", async () => {
    const database = { execute: vi.fn(async () => ({ rows: [{ workspace_id: workspaceId, user_id: userId,
      role: "analyst", lifecycle_state: "active" }] })), transaction: vi.fn() };
    const response = await createLocalStarterCategoryAdoptionHandlers({ database: database as never,
      config: config() }).POST(request());
    expect(response.status).toBe(403); expect(await response.json()).toMatchObject({ error: { code: "forbidden" },
      authority: { canAuthorizeAction: false, canWriteMeta: false } });
    expect(database.execute).toHaveBeenCalledTimes(1); expect(database.transaction).not.toHaveBeenCalled();
  });

  it("rejects malformed capability before principal or inventory reads", async () => {
    const database = { execute: vi.fn(), transaction: vi.fn() };
    const response = await createLocalStarterCategoryAdoptionHandlers({ database: database as never,
      config: config() }).POST(request("invalid"));
    expect(response.status).toBe(401); expect(await response.json()).toMatchObject({
      error: { code: "local_session_required" }, authority: { canAuthorizeAction: false, canWriteMeta: false } });
    expect(database.execute).not.toHaveBeenCalled(); expect(database.transaction).not.toHaveBeenCalled();
  });
});
