import { describe, expect, it, vi } from "vitest";

import { createLocalApprovalQueueRouteHandler } from "@/server/local-approval-queue-runtime";
import {
  localDecisionRoomConfig,
  type LocalDecisionRoomEnvironment,
} from "@/server/local-decision-room-runtime";
import { LOCAL_SESSION_COOKIE, mintLocalSessionCapability } from "@/security/local-session-capability";

const workspaceId = "11111111-1111-4111-a111-111111111111";
const userId = "22222222-2222-4222-a222-222222222222";
const signingKey = Buffer.alloc(32, 23);

function environment(): LocalDecisionRoomEnvironment {
  return {
    DATABASE_URL: "postgresql://server-only.invalid/database",
    REKLAMZEKA_LOCAL_SESSION_ENABLED: "true",
    REKLAMZEKA_LOCAL_ORIGIN: "http://localhost:3000",
    REKLAMZEKA_LOCAL_WORKSPACE_ID: workspaceId,
    REKLAMZEKA_LOCAL_WORKSPACE_REF: "workspace_local",
    REKLAMZEKA_LOCAL_USER_ID: userId,
    REKLAMZEKA_LOCAL_READER_REF: "reader_local_viewer",
    REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY: signingKey.toString("base64"),
  };
}

function token() {
  const now = Math.floor(Date.now() / 1000);
  return mintLocalSessionCapability({
    kind: "session",
    workspaceId,
    workspaceRef: "workspace_local",
    userId,
    readerRef: "reader_local_viewer",
    osUid: process.getuid!(),
    issuedAt: now - 1,
    expiresAt: now + 300,
  }, signingKey).token;
}

function request(value: string, headers: Record<string, string> = {}) {
  return new Request("http://localhost:3000/api/approval-queue?view=list&limit=25", {
    headers: {
      Host: "localhost:3000",
      "Sec-Fetch-Site": "same-origin",
      Cookie: `${LOCAL_SESSION_COOKIE}=${encodeURIComponent(value)}`,
      ...headers,
    },
  });
}

describe("local Approval Queue route", () => {
  it("requires the dedicated read scope and returns an empty tenant-bound queue", async () => {
    let calls = 0;
    const database = { execute: vi.fn(async () => calls++ === 0
      ? { rows: [{ workspace_id: workspaceId, user_id: userId, role: "viewer", lifecycle_state: "active" }] }
      : { rows: [] }) };
    const handler = createLocalApprovalQueueRouteHandler({
      database: database as never,
      config: localDecisionRoomConfig(environment())!,
    });
    const response = await handler(request(token()));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      result: { view: "list", items: [], authority: {
        readOnly: true, canApprove: false, canReject: false, canRequestChanges: false,
        canGrant: false, canExecute: false, canWriteMeta: false,
      } },
      authority: {
        readOnly: true, canApprove: false, canReject: false, canRequestChanges: false,
        canGrant: false, canExecute: false, canWriteMeta: false,
      },
    });
    expect(database.execute).toHaveBeenCalledTimes(2);
  });

  it("reports damaged or non-local capabilities as session-required before database access", async () => {
    const database = { execute: vi.fn() };
    const handler = createLocalApprovalQueueRouteHandler({
      database: database as never,
      config: localDecisionRoomConfig(environment())!,
    });
    const valid = token();
    const damaged = `${valid.slice(0, -1)}${valid.endsWith("x") ? "y" : "x"}`;
    const damagedResponse = await handler(request(damaged));
    expect(damagedResponse.status).toBe(401);
    expect(await damagedResponse.json()).toMatchObject({ error: { code: "local_session_required" } });
    expect((await handler(request(valid, { "X-Forwarded-For": "127.0.0.1" }))).status).toBe(401);
    expect(database.execute).not.toHaveBeenCalled();
  });
});
