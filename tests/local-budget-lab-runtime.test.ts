import { describe, expect, it, vi } from "vitest";
import { createLocalBudgetLabPostHandler, createLocalBudgetLabRouteHandler } from "@/server/local-budget-lab-runtime";
import { localDecisionRoomConfig, type LocalDecisionRoomEnvironment } from "@/server/local-decision-room-runtime";
import { LOCAL_SESSION_COOKIE, mintLocalSessionCapability } from "@/security/local-session-capability";

const workspaceId = "11111111-1111-4111-a111-111111111111";
const userId = "22222222-2222-4222-a222-222222222222";
const signingKey = Buffer.alloc(32, 17);

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
  return new Request("http://localhost:3000/api/budget-lab?view=list&limit=25", { headers: {
    Host: "localhost:3000", "Sec-Fetch-Site": "same-origin", Cookie: `${LOCAL_SESSION_COOKIE}=${encodeURIComponent(value)}`,
  } });
}

function postRequest(value: string, intent = "budget-lab-save-draft") {
  return new Request("http://localhost:3000/api/budget-lab", { method: "POST", headers: {
    Host: "localhost:3000", Origin: "http://localhost:3000", "Sec-Fetch-Site": "same-origin",
    "Content-Type": "application/json", "X-ReklamZeka-Intent": intent,
    Cookie: `${LOCAL_SESSION_COOKIE}=${encodeURIComponent(value)}`,
  }, body: JSON.stringify({ command: {} }) });
}

describe("local Budget Lab route", () => {
  it("requires its separate read scope and returns a real empty tenant result", async () => {
    const minted = token();
    const builder = { from: vi.fn(), where: vi.fn(), orderBy: vi.fn(), limit: vi.fn(async () => []) };
    builder.from.mockReturnValue(builder); builder.where.mockReturnValue(builder); builder.orderBy.mockReturnValue(builder);
    let calls = 0;
    const database = {
      execute: vi.fn(async () => calls++ === 0 ? { rows: [{ workspace_id: workspaceId, user_id: userId, role: "viewer", lifecycle_state: "active" }] } : { rows: [{ id: workspaceId }] }),
      select: vi.fn(() => builder), transaction: vi.fn(),
    };
    const handler = createLocalBudgetLabRouteHandler({ database: database as never, config: localDecisionRoomConfig(environment())! });
    const response = await handler(request(minted));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ result: { view: "list", items: [], authority: { canExecute: false, canWriteMeta: false } }, authority: { draft: false, approval: false, execution: false, metaWrite: false } });
    expect(response.headers.get("x-reklamzeka-access-mode")).toBe("read-only");
    expect(database.execute).toHaveBeenCalledTimes(2);
    expect(database.select).toHaveBeenCalledTimes(1);
  });

  it("rejects a damaged capability before any DB access", async () => {
    const database = { execute: vi.fn(), select: vi.fn(), transaction: vi.fn() };
    const handler = createLocalBudgetLabRouteHandler({ database: database as never, config: localDecisionRoomConfig(environment())! });
    const valid = token();
    const damaged = `${valid.slice(0, -1)}${valid.endsWith("x") ? "y" : "x"}`;
    expect((await handler(request(damaged))).status).toBe(503);
    expect(database.execute).not.toHaveBeenCalled();
    expect(database.select).not.toHaveBeenCalled();
  });

  it("uses a separate draft scope, enforces same-origin, and denies viewers before proposal access", async () => {
    const minted = token();
    const claims = mintLocalSessionCapability({ kind: "session", workspaceId, workspaceRef: "workspace_local", userId,
      readerRef: "reader_local_owner", osUid: process.getuid!(), issuedAt: Math.floor(Date.now() / 1000) - 1,
      expiresAt: Math.floor(Date.now() / 1000) + 300 }, signingKey).claims;
    expect(claims.scopes[0]).toBe("budget_lab:draft");
    const database = { execute: vi.fn(async () => ({ rows: [{ workspace_id: workspaceId, user_id: userId, role: "viewer", lifecycle_state: "active" }] })), select: vi.fn(), transaction: vi.fn() };
    const POST = createLocalBudgetLabPostHandler({ database: database as never, config: localDecisionRoomConfig(environment())! });
    expect((await POST(postRequest(minted))).status).toBe(403);
    expect(database.select).not.toHaveBeenCalled();
    expect(database.transaction).not.toHaveBeenCalled();

    const untrusted = postRequest(minted);
    untrusted.headers.set("Origin", "http://evil.invalid");
    expect((await POST(untrusted)).status).toBe(503);
  });
});
