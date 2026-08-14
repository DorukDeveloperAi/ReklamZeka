import { describe, expect, it, vi } from "vitest";
import { createLocalMetaReadMirrorRouteHandler } from "@/server/local-meta-read-mirror-runtime";
import { localDecisionRoomConfig } from "@/server/local-decision-room-runtime";
import { LOCAL_SESSION_COOKIE, mintLocalSessionCapability } from "@/security/local-session-capability";

const config = localDecisionRoomConfig({
  DATABASE_URL: "postgresql://server-only.invalid/database", REKLAMZEKA_LOCAL_SESSION_ENABLED: "true",
  REKLAMZEKA_LOCAL_ORIGIN: "http://localhost:3000", REKLAMZEKA_LOCAL_WORKSPACE_ID: "11111111-1111-4111-a111-111111111111",
  REKLAMZEKA_LOCAL_WORKSPACE_REF: "workspace_local", REKLAMZEKA_LOCAL_USER_ID: "22222222-2222-4222-a222-222222222222",
  REKLAMZEKA_LOCAL_READER_REF: "reader_local_owner", REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY: Buffer.alloc(32, 7).toString("base64"),
})!;
const token = mintLocalSessionCapability({ kind: "session", workspaceId: config.workspaceId, workspaceRef: config.workspaceRef,
  userId: config.userId, readerRef: config.readerRef, osUid: process.getuid?.() ?? 0,
  issuedAt: Math.floor(Date.now() / 1000) - 1, expiresAt: Math.floor(Date.now() / 1000) + 60 }, Buffer.alloc(32, 7)).token;

function request(cookie = false, path = "/api/meta/read-mirror") {
  return new Request(`http://localhost:3000${path}`, { headers: { Host: "localhost:3000", "Sec-Fetch-Site": "same-origin",
    ...(cookie ? { Cookie: `${LOCAL_SESSION_COOKIE}=${token}` } : {}) } });
}

describe("local Meta read mirror runtime", () => {
  it("requires the session before any canonical DB read", async () => {
    const database = { execute: vi.fn(), transaction: vi.fn() };
    const response = await createLocalMetaReadMirrorRouteHandler({ database: database as never, config })(request());
    expect(response.status).toBe(401);
    expect(database.execute).not.toHaveBeenCalled();
    expect(database.transaction).not.toHaveBeenCalled();
    expect(response.headers.get("x-reklamzeka-action-authority")).toBe("none");
    expect(response.headers.get("x-reklamzeka-meta-network")).toBe("disabled");
  });

  it("returns the repository projection for the session-bound workspace", async () => {
    const database = { execute: vi.fn().mockResolvedValue({ rows: [{ workspace_id: config.workspaceId, user_id: config.userId,
      role: "owner", lifecycle_state: "active" }] }), transaction: vi.fn() };
    const projection = { version: "meta-read-mirror-projection/1.0.0", sourceState: "empty", observedAt: "2026-08-13T12:00:00.000Z",
      latestCanonicalObservationAt: null, freshnessAgeMinutes: null, freshnessThresholdMinutes: 1440,
      reasonCodes: ["canonical_hierarchy_empty"], summary: { connections: 1, accounts: 1, campaigns: 0, adSets: 0, ads: 0, creatives: 0, posts: 0 },
      authority: { actionAuthority: "none", canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false }, connections: [] } as const;
    const load = vi.fn().mockResolvedValue(projection);
    const response = await createLocalMetaReadMirrorRouteHandler({ database: database as never, config, repository: { load } })(request(true));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ...projection, source: { kind: "canonical_meta_mirror", state: "empty",
      reasonCodes: ["canonical_hierarchy_empty"] } });
    expect(load).toHaveBeenCalledWith(config.workspaceId);
    expect(response.headers.get("x-reklamzeka-access-mode")).toBe("read-only");
    expect(response.headers.get("x-reklamzeka-action-authority")).toBe("none");
    expect(response.headers.get("x-reklamzeka-meta-network")).toBe("disabled");
  });

  it("rejects caller-selected workspace scope before repository load", async () => {
    const database = { execute: vi.fn().mockResolvedValue({ rows: [{ workspace_id: config.workspaceId, user_id: config.userId,
      role: "owner", lifecycle_state: "active" }] }), transaction: vi.fn() };
    const load = vi.fn();
    const response = await createLocalMetaReadMirrorRouteHandler({ database: database as never, config, repository: { load } })(
      request(true, "/api/meta/read-mirror?workspaceId=other"));
    expect(response.status).toBe(400);
    expect(load).not.toHaveBeenCalled();
  });
});
