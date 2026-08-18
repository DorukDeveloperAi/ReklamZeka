import { describe, expect, it, vi } from "vitest";
import { createLocalScopeReportSavedHandlers } from "@/server/local-scope-report-saved-runtime";
import { localDecisionRoomConfig } from "@/server/local-decision-room-runtime";
import {
  LOCAL_SESSION_COOKIE,
  mintLocalSessionCapability,
} from "@/security/local-session-capability";

const key = Buffer.alloc(32, 9);
const config = localDecisionRoomConfig({
  DATABASE_URL: "postgresql://server-only.invalid/database",
  REKLAMZEKA_LOCAL_SESSION_ENABLED: "true",
  REKLAMZEKA_LOCAL_ORIGIN: "http://localhost:3000",
  REKLAMZEKA_LOCAL_WORKSPACE_ID: "11111111-1111-4111-a111-111111111111",
  REKLAMZEKA_LOCAL_WORKSPACE_REF: "workspace_local",
  REKLAMZEKA_LOCAL_USER_ID: "22222222-2222-4222-a222-222222222222",
  REKLAMZEKA_LOCAL_READER_REF: "reader_local_owner",
  REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY: key.toString("base64"),
})!;
const now = Math.floor(Date.now() / 1000);
const token = mintLocalSessionCapability(
  {
    kind: "session",
    workspaceId: config.workspaceId,
    workspaceRef: config.workspaceRef,
    userId: config.userId,
    readerRef: config.readerRef,
    osUid: process.getuid?.() ?? 0,
    issuedAt: now - 1,
    expiresAt: now + 60,
  },
  key,
).token;
const request = (path = "/api/scope-report-saved", headers: HeadersInit = {}) =>
  new Request(`http://localhost:3000${path}`, {
    headers: {
      host: "localhost:3000",
      cookie: `${LOCAL_SESSION_COOKIE}=${token}`,
      "sec-fetch-site": "same-origin",
      "x-reklamzeka-intent": "scope-report-saved-list",
      ...headers,
    },
  });

describe("local saved scope report runtime", () => {
  it("rejects malformed and cross-site requests before database work", async () => {
    const database = { execute: vi.fn(), transaction: vi.fn() };
    const handlers = createLocalScopeReportSavedHandlers({
      database: database as never,
      config,
    });
    expect(
      (await handlers.GET(request("/api/scope-report-saved?workspaceId=other")))
        .status,
    ).toBe(400);
    expect(
      (
        await handlers.GET(
          request("/api/scope-report-saved", {
            "sec-fetch-site": "cross-site",
          }),
        )
      ).status,
    ).toBe(400);
    expect(database.execute).not.toHaveBeenCalled();
  });

  it("does not turn a valid cookie into an arbitrary tenant binding", async () => {
    const database = {
      execute: vi.fn().mockResolvedValue({ rows: [] }),
      transaction: vi.fn(),
    };
    const response = await createLocalScopeReportSavedHandlers({
      database: database as never,
      config,
    }).GET(request());
    expect(response.status).toBe(403);
    expect(response.headers.get("x-reklamzeka-meta-write")).toBe("disabled");
    expect(database.transaction).not.toHaveBeenCalled();
  });
});
