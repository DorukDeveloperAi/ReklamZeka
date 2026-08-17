import { describe, expect, it, vi } from "vitest";
import { createLocalScopeReportHandler } from "@/server/local-scope-report-runtime";
import { localDecisionRoomConfig } from "@/server/local-decision-room-runtime";
import { LOCAL_SESSION_COOKIE, mintLocalSessionCapability } from "@/security/local-session-capability";

const config = localDecisionRoomConfig({ DATABASE_URL: "postgresql://server-only.invalid/database", REKLAMZEKA_LOCAL_SESSION_ENABLED: "true",
  REKLAMZEKA_LOCAL_ORIGIN: "http://localhost:3000", REKLAMZEKA_LOCAL_WORKSPACE_ID: "11111111-1111-4111-a111-111111111111",
  REKLAMZEKA_LOCAL_WORKSPACE_REF: "workspace_local", REKLAMZEKA_LOCAL_USER_ID: "22222222-2222-4222-a222-222222222222",
  REKLAMZEKA_LOCAL_READER_REF: "reader_local_owner", REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY: Buffer.alloc(32, 7).toString("base64") })!;
const token = mintLocalSessionCapability({ kind: "session", workspaceId: config.workspaceId, workspaceRef: config.workspaceRef, userId: config.userId,
  readerRef: config.readerRef, osUid: process.getuid?.() ?? 0, issuedAt: Math.floor(Date.now() / 1000) - 1, expiresAt: Math.floor(Date.now() / 1000) + 60 }, Buffer.alloc(32, 7)).token;
const request = (input: Readonly<{ cookie?: string; headers?: HeadersInit; path?: string }> = {}) => new Request(`http://localhost:3000${input.path ?? "/api/scope-report?slice=slice_yerli&start=2026-08-01&end=2026-08-02"}`, { headers: {
  Host: "localhost:3000", "Sec-Fetch-Site": "same-origin", "X-ReklamZeka-Intent": "scope-report-read", ...(input.cookie === undefined ? {} : { Cookie: input.cookie }), ...input.headers } });

describe("local scope report runtime", () => {
  it("rejects unauthenticated or malformed input before database work", async () => {
    const database = { execute: vi.fn(), transaction: vi.fn() };
    const handler = createLocalScopeReportHandler({ database: database as never, config });
    expect((await handler(request())).status).toBe(401);
    expect((await handler(request({ path: "/api/scope-report?workspaceId=other", cookie: `${LOCAL_SESSION_COOKIE}=${token}` }))).status).toBe(400);
    expect((await handler(request({ headers: { "Sec-Fetch-Site": "cross-site" }, cookie: `${LOCAL_SESSION_COOKIE}=${token}` }))).status).toBe(400);
    expect(database.execute).not.toHaveBeenCalled();
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it("does not turn an unbound valid session into an arbitrary workspace read", async () => {
    const database = { execute: vi.fn().mockResolvedValue({ rows: [] }), transaction: vi.fn() };
    const response = await createLocalScopeReportHandler({ database: database as never, config })(request({ cookie: `${LOCAL_SESSION_COOKIE}=${token}` }));
    expect(response.status).toBe(403);
    expect(response.headers.get("x-reklamzeka-meta-write")).toBe("disabled");
  });
});
