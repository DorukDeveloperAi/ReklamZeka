import { describe, expect, it, vi } from "vitest";
import { createLocalCategoryAuthoringHandlers } from "@/server/local-category-authoring-runtime";
import { localDecisionRoomConfig } from "@/server/local-decision-room-runtime";
import { LOCAL_SESSION_COOKIE, mintLocalSessionCapability } from "@/security/local-session-capability";

const workspaceId = "11111111-1111-4111-a111-111111111111";
const userId = "22222222-2222-4222-a222-222222222222";
const signingKey = Buffer.alloc(32, 9);

function config() {
  return localDecisionRoomConfig({
    DATABASE_URL: "postgresql://server-only.invalid/database",
    REKLAMZEKA_LOCAL_SESSION_ENABLED: "true",
    REKLAMZEKA_LOCAL_ORIGIN: "http://localhost:3000",
    REKLAMZEKA_LOCAL_WORKSPACE_ID: workspaceId,
    REKLAMZEKA_LOCAL_WORKSPACE_REF: "workspace_category_test",
    REKLAMZEKA_LOCAL_USER_ID: userId,
    REKLAMZEKA_LOCAL_READER_REF: "reader_category_test",
    REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY: signingKey.toString("base64"),
  })!;
}

function token() {
  const now = Math.floor(Date.now() / 1000);
  return mintLocalSessionCapability({ kind: "session", workspaceId,
    workspaceRef: "workspace_category_test", userId, readerRef: "reader_category_test",
    osUid: process.getuid!(), issuedAt: now - 1, expiresAt: now + 300 }, signingKey).token;
}

function request(session = token()) {
  return new Request("http://localhost:3000/api/category-authoring", { method: "POST",
    headers: { Host: "localhost:3000", Cookie: `${LOCAL_SESSION_COOKIE}=${encodeURIComponent(session)}`,
      Origin: "http://localhost:3000", "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json",
      "X-ReklamZeka-Intent": "category-authoring-mutate" },
    body: JSON.stringify({ command: { operation: "create_dimension", key: "service_line", name: "Hizmet",
      description: null, cardinality: "single", allowedEntityLevels: ["campaign"],
      expectedRegistryHash: "a".repeat(64) } }) });
}

describe("local category authoring runtime", () => {
  it("binds the cookie capability but still denies analyst publication before repository mutation", async () => {
    const database = { execute: vi.fn(async () => ({ rows: [{ workspace_id: workspaceId, user_id: userId,
      role: "analyst", lifecycle_state: "active" }] })), transaction: vi.fn() };
    const response = await createLocalCategoryAuthoringHandlers({ database: database as never, config: config() })
      .POST(request());
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "forbidden" },
      authority: { canAuthorizeAction: false, canWriteMeta: false } });
    expect(database.execute).toHaveBeenCalledTimes(1);
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it("returns a redacted session requirement for a malformed capability", async () => {
    const database = { execute: vi.fn(), transaction: vi.fn() };
    const response = await createLocalCategoryAuthoringHandlers({ database: database as never, config: config() })
      .POST(request("invalid"));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "local_session_required" },
      authority: { canAuthorizeAction: false, canWriteMeta: false } });
    expect(database.execute).not.toHaveBeenCalled();
  });
});
