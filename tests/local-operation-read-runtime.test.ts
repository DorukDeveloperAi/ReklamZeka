import { describe, expect, it, vi } from "vitest";
import { createLocalOperationReadHandler } from "@/server/local-operation-read-runtime";
import { localDecisionRoomConfig } from "@/server/local-decision-room-runtime";

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
function request(input: Readonly<{ cookie?: string; headers?: HeadersInit; path?: string }> = {}) {
  return new Request(`http://localhost:3000${input.path ?? "/api/operations"}`, {
    headers: {
      Host: "localhost:3000",
      "Sec-Fetch-Site": "same-origin",
      "X-ReklamZeka-Intent": "operation-read",
      ...(input.cookie === undefined ? {} : { Cookie: input.cookie }),
      ...input.headers,
    },
  });
}

describe("local operation read runtime", () => {
  it("reads the configured local workspace without a browser capability", async () => {
    const database = { execute: vi.fn().mockResolvedValue({ rows: [{ workspace_id: config.workspaceId, user_id: config.userId,
      role: "owner", lifecycle_state: "active" }] }), transaction: vi.fn().mockRejectedValue(new Error("database offline")) };
    const response = await createLocalOperationReadHandler({ database: database as never, config })(request());
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("source_unavailable");
    expect(response.headers.get("x-reklamzeka-access-mode")).toBe("read-only");
    expect(response.headers.get("x-reklamzeka-action-authority")).toBe("none");
    expect(response.headers.get("x-reklamzeka-meta-write")).toBe("disabled");
    expect(database.execute).toHaveBeenCalledTimes(1);
    expect(database.transaction).toHaveBeenCalledTimes(1);
  });

  it("does not let a stale browser cookie prevent configured passive reads", async () => {
    const database = { execute: vi.fn().mockResolvedValue({ rows: [] }), transaction: vi.fn() };
    const response = await createLocalOperationReadHandler({ database: database as never, config })(
      request({ cookie: "reklamzeka_local_session=stale" }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "forbidden" } });
    expect(database.execute).toHaveBeenCalledTimes(1);
  });

  it("keeps malformed method, query, and security headers as invalid input", async () => {
    const database = { execute: vi.fn(), transaction: vi.fn() };
    const handler = createLocalOperationReadHandler({ database: database as never, config });
    expect((await handler(request({ path: "/api/operations?workspaceId=other" }))).status).toBe(400);
    expect((await handler(request({ headers: { "Sec-Fetch-Site": "cross-site" } }))).status).toBe(400);
    expect((await handler(new Request("http://localhost:3000/api/operations", { method: "POST", headers: {
      Host: "localhost:3000", "Sec-Fetch-Site": "same-origin", "X-ReklamZeka-Intent": "operation-read",
    } }))).status).toBe(400);
    expect(database.execute).not.toHaveBeenCalled();
  });

  it("returns forbidden for a valid session that cannot bind a workspace principal", async () => {
    const database = { execute: vi.fn().mockResolvedValue({ rows: [] }), transaction: vi.fn() };
    const response = await createLocalOperationReadHandler({ database: database as never, config })(
      request(),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: { code: "forbidden" } });
  });

  it("returns unavailable for an actual source failure after a valid request", async () => {
    const database = { execute: vi.fn().mockRejectedValue(new Error("database offline")), transaction: vi.fn() };
    const response = await createLocalOperationReadHandler({ database: database as never, config })(
      request(),
    );
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("source_unavailable");
  });
});
