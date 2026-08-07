import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createLocalExistingPostPromotionPreflightRouteHandler } from "@/server/local-existing-post-promotion-preflight-runtime";
import { localDecisionRoomConfig } from "@/server/local-decision-room-runtime";
import { LOCAL_SESSION_COOKIE, mintLocalSessionCapability } from "@/security/local-session-capability";

const key = randomBytes(32); const workspaceId = "11111111-1111-4111-a111-111111111111";
const userId = "22222222-2222-4222-a222-222222222222";
const config = localDecisionRoomConfig({ DATABASE_URL: "postgresql://local.invalid/db", REKLAMZEKA_LOCAL_SESSION_ENABLED: "true",
  REKLAMZEKA_LOCAL_ORIGIN: "http://localhost:3000", REKLAMZEKA_LOCAL_WORKSPACE_ID: workspaceId,
  REKLAMZEKA_LOCAL_WORKSPACE_REF: "workspace_local", REKLAMZEKA_LOCAL_USER_ID: userId,
  REKLAMZEKA_LOCAL_READER_REF: "reader_local", REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY: key.toString("base64") })!;
const selection = { accountRef: "account_primary", adSetRef: "adset_primary", actorRef: "actor_primary", postRef: "post_primary",
  promotionTemplateRef: "template_primary", audiencePresetRef: "audience_primary", budgetPlanRef: "budget_primary",
  timeframeRef: "timeframe_primary", objectiveRef: "objective_primary", internalCategoryRef: "category_primary" };

function token() { const now = Math.floor(Date.now() / 1000); return mintLocalSessionCapability({ kind: "session", workspaceId,
  workspaceRef: "workspace_local", userId, readerRef: "reader_local", osUid: process.getuid!(), issuedAt: now, expiresAt: now + 300 }, key).token; }
function request(kind: "cookie" | "bearer") { const value = token(); const body = JSON.stringify({ selection }); return new Request(
  "http://localhost:3000/api/existing-post-promotion-preflight", { method: "POST", body, headers: { Host: "localhost:3000",
    Origin: "http://localhost:3000", "Sec-Fetch-Site": "same-origin", "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(body)),
    "X-ReklamZeka-Intent": "existing-post-promotion-preflight", ...(kind === "cookie"
      ? { Cookie: `${LOCAL_SESSION_COOKIE}=${encodeURIComponent(value)}` } : { Authorization: `Bearer ${value}` }) } }); }

describe("local existing-post preflight runtime", () => {
  it("uses the dedicated cookie scope and reaches the real empty repository", async () => {
    const execute = vi.fn().mockResolvedValueOnce({ rows: [{ workspace_id: workspaceId, user_id: userId, role: "viewer", lifecycle_state: "active" }] })
      .mockResolvedValueOnce({ rows: [] });
    const response = await createLocalExistingPostPromotionPreflightRouteHandler({ database: { execute } as never, config })(request("cookie"));
    expect(response.status).toBe(404); expect(execute).toHaveBeenCalledTimes(2);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "not_found" }, authority: { canExecute: false, canWriteMeta: false } });
  });
  it("rejects bearer before database access", async () => {
    const execute = vi.fn(); const response = await createLocalExistingPostPromotionPreflightRouteHandler({ database: { execute } as never, config })(request("bearer"));
    expect(response.status).toBe(503); expect(execute).not.toHaveBeenCalled();
  });
});
