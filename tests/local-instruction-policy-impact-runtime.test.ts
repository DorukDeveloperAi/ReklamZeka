import { describe, expect, it, vi } from "vitest";
import { GET, dynamic, runtime } from "@/app/api/instruction-policy-impact/route";
import { createLocalInstructionPolicyImpactHandler } from "@/server/local-instruction-policy-impact-runtime";
import { localDecisionRoomConfig } from "@/server/local-decision-room-runtime";
import { LOCAL_SESSION_COOKIE, mintLocalSessionCapability } from "@/security/local-session-capability";

const workspaceId = "11111111-1111-4111-8111-111111111111"; const userId = "22222222-2222-4222-8222-222222222222";
const signingKey = Buffer.alloc(32, 17);
function config() { return localDecisionRoomConfig({ DATABASE_URL: "postgresql://server-only.invalid/database",
  REKLAMZEKA_LOCAL_SESSION_ENABLED: "true", REKLAMZEKA_LOCAL_ORIGIN: "http://localhost:3000",
  REKLAMZEKA_LOCAL_WORKSPACE_ID: workspaceId, REKLAMZEKA_LOCAL_WORKSPACE_REF: "workspace_test",
  REKLAMZEKA_LOCAL_USER_ID: userId, REKLAMZEKA_LOCAL_READER_REF: "actor_viewer",
  REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY: signingKey.toString("base64") })!; }
function token() { const now = Math.floor(Date.now() / 1_000); return mintLocalSessionCapability({ kind: "session",
  workspaceId, workspaceRef: "workspace_test", userId, readerRef: "actor_viewer", osUid: process.getuid!(),
  issuedAt: now - 1, expiresAt: now + 300 }, signingKey).token; }

describe("local instruction policy impact runtime and route", () => {
  it("keeps the route dynamic/node and returns a public-safe unconfigured response without a request", async () => {
    expect(dynamic).toBe("force-dynamic"); expect(runtime).toBe("nodejs");
    const response = await GET(); expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ authority: { canPublish: false, canExecute: false, canWriteMeta: false } });
  });

  it("rejects a malformed local capability before any database read", async () => {
    const database = { execute: vi.fn() };
    const request = new Request("http://localhost:3000/api/instruction-policy-impact?view=dependency-impact&policyRef=policy_health&operation=archive",
      { headers: { Host: "localhost:3000", Cookie: `${LOCAL_SESSION_COOKIE}=invalid`, "Sec-Fetch-Site": "same-origin",
        "X-ReklamZeka-Intent": "instruction-policy-impact-preview" } });
    const response = await createLocalInstructionPolicyImpactHandler({ database: database as never, config: config() })(request);
    expect(response.status).toBe(401); expect(await response.json()).toMatchObject({ error: { code: "local_session_required" },
      authority: { canArchive: false, canExecute: false, canWriteMeta: false } });
    expect(database.execute).not.toHaveBeenCalled();
  });

  it("accepts a valid signed read cookie through the local boundary before repository scope denial", async () => {
    const results = [{ rows: [{ workspace_id: workspaceId, user_id: userId, role: "viewer",
      lifecycle_state: "active" }] }, { rows: [] }];
    const database = { execute: vi.fn(async () => results.shift()) };
    const request = new Request("http://localhost:3000/api/instruction-policy-impact?view=dependency-impact&policyRef=policy_health&operation=archive",
      { headers: { Host: "localhost:3000", Cookie: `${LOCAL_SESSION_COOKIE}=${encodeURIComponent(token())}`,
        "Sec-Fetch-Site": "same-origin", "X-ReklamZeka-Intent": "instruction-policy-impact-preview" } });
    const response = await createLocalInstructionPolicyImpactHandler({ database: database as never, config: config() })(request);
    expect(response.status).toBe(403); expect(await response.json()).toMatchObject({ error: { code: "forbidden" },
      authority: { canArchive: false, canExecute: false, canWriteMeta: false } });
    expect(database.execute).toHaveBeenCalledTimes(2);
  });
});
