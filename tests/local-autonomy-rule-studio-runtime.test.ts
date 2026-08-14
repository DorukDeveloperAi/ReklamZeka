import { describe, expect, it, vi } from "vitest";
import { createLocalAutonomyRuleStudioHandlers } from "@/server/local-autonomy-rule-studio-runtime";
import { localDecisionRoomConfig, type LocalDecisionRoomEnvironment } from "@/server/local-decision-room-runtime";
import { LOCAL_SESSION_COOKIE, mintLocalSessionCapability } from "@/security/local-session-capability";

const workspaceId = "11111111-1111-4111-a111-111111111111";
const userId = "22222222-2222-4222-a222-222222222222";
const signingKey = Buffer.alloc(32, 29);

function environment(): LocalDecisionRoomEnvironment {
  return {
    DATABASE_URL: "postgresql://server-only.invalid/database",
    REKLAMZEKA_LOCAL_SESSION_ENABLED: "true",
    REKLAMZEKA_LOCAL_ORIGIN: "http://localhost:3000",
    REKLAMZEKA_LOCAL_WORKSPACE_ID: workspaceId,
    REKLAMZEKA_LOCAL_WORKSPACE_REF: "workspace_local",
    REKLAMZEKA_LOCAL_USER_ID: userId,
    REKLAMZEKA_LOCAL_READER_REF: "reader_local_owner",
    REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY: signingKey.toString("base64"),
  };
}

function token() {
  const now = Math.floor(Date.now() / 1000);
  return mintLocalSessionCapability({ kind: "session", workspaceId, workspaceRef: "workspace_local", userId,
    readerRef: "reader_local_owner", osUid: process.getuid!(), issuedAt: now - 1, expiresAt: now + 300 }, signingKey).token;
}

function request(value: string) {
  return new Request("http://localhost:3000/api/autonomy-rules", { headers: {
    Host: "localhost:3000", "Sec-Fetch-Site": "same-origin", "X-ReklamZeka-Intent": "autonomy-rules-read",
    Cookie: `${LOCAL_SESSION_COOKIE}=${encodeURIComponent(value)}`,
  } });
}

describe("local Autonomy Rule Studio route", () => {
  it("reports a damaged capability as session-required before database access", async () => {
    const database = { execute: vi.fn(), transaction: vi.fn() };
    const handlers = createLocalAutonomyRuleStudioHandlers({
      database: database as never,
      config: localDecisionRoomConfig(environment())!,
    });
    const valid = token();
    const damaged = `${valid.slice(0, -1)}${valid.endsWith("x") ? "y" : "x"}`;
    const response = await handlers.GET(request(damaged));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code: "local_session_required" },
      authority: { canPublish: false, canExecute: false, canWriteMeta: false } });
    expect(database.execute).not.toHaveBeenCalled();
    expect(database.transaction).not.toHaveBeenCalled();
  });
});
