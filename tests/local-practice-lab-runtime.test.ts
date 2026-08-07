import { describe, expect, it, vi } from "vitest";
import { createLocalPracticeLabRouteHandler } from "@/server/local-practice-lab-runtime";
import { localDecisionRoomConfig, type LocalDecisionRoomEnvironment } from "@/server/local-decision-room-runtime";
import { LOCAL_SESSION_COOKIE, mintLocalSessionCapability } from "@/security/local-session-capability";

const workspaceId = "11111111-1111-4111-a111-111111111111";
const userId = "22222222-2222-4222-a222-222222222222";
const signingKey = Buffer.alloc(32, 9);

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

function request(token: string) {
  return new Request("http://localhost:3000/api/practice-lab?view=list&limit=25", {
    headers: {
      Host: "localhost:3000",
      "Sec-Fetch-Site": "same-origin",
      Cookie: `${LOCAL_SESSION_COOKIE}=${encodeURIComponent(token)}`,
    },
  });
}

function token() {
  const now = Math.floor(Date.now() / 1000);
  return mintLocalSessionCapability({
    kind: "session", workspaceId, workspaceRef: "workspace_local", userId,
    readerRef: "reader_local_owner", osUid: process.getuid!(), issuedAt: now - 1, expiresAt: now + 300,
  }, signingKey).token;
}

describe("local Practice Lab route", () => {
  it("reuses the canonical local principal and returns a real empty tenant read", async () => {
    const minted = token();
    const now = Math.floor(Date.now() / 1000);
    const claims = mintLocalSessionCapability({
      kind: "session", workspaceId, workspaceRef: "workspace_local", userId,
      readerRef: "reader_local_owner", osUid: process.getuid!(), issuedAt: now, expiresAt: now + 300,
    }, signingKey).claims;
    expect(claims.scopes).toEqual(["approval_queue:decide", "approval_queue:read", "budget_lab:draft", "budget_lab:read", "decision_room:mark_read", "decision_room:read", "practice_lab:read"]);
    const transaction = vi.fn(async (callback: (tx: unknown) => Promise<unknown>) => callback({
      execute: vi.fn()
        .mockResolvedValueOnce({ rows: [{ id: workspaceId }] })
        .mockResolvedValueOnce({ rows: [] }),
    }));
    const database = {
      execute: vi.fn(async () => ({ rows: [{
        workspace_id: workspaceId, user_id: userId, role: "viewer", lifecycle_state: "active",
      }] })),
      transaction,
    };
    const handler = createLocalPracticeLabRouteHandler({
      database: database as never,
      config: localDecisionRoomConfig(environment())!,
    });
    const response = await handler(request(minted));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      result: { view: "list", items: [], authority: { canExecuteWrite: false } },
      authority: { persistence: false, policyPromotion: false, automation: false, metaWrite: false, actionExecution: false },
    });
    expect(response.headers.get("x-reklamzeka-access-mode")).toBe("read-draft-ephemeral");
    expect(response.headers.get("x-reklamzeka-action-authority")).toBe("none");
    expect(database.execute).toHaveBeenCalledTimes(1);
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("fails closed before DB access for an invalid capability", async () => {
    const database = { execute: vi.fn(), transaction: vi.fn() };
    const handler = createLocalPracticeLabRouteHandler({
      database: database as never,
      config: localDecisionRoomConfig(environment())!,
    });
    const valid = token();
    const response = await handler(request(`${valid.slice(0, -1)}${valid.endsWith("x") ? "y" : "x"}`));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: {
        code: "source_not_configured",
        message: "Practice Lab çalışma alanı ve yerel kimlik bağlama katmanı henüz etkin değil.",
      },
    });
    expect(database.execute).not.toHaveBeenCalled();
  });
});
