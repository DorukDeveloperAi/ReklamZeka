import { describe, expect, it, vi } from "vitest";

import { LOCAL_SESSION_COOKIE, mintLocalSessionCapability } from "@/security/local-session-capability";
import {
  localDecisionRoomConfig,
  resolveTrustedLocalApprovalDecisionPrincipal,
  type LocalDecisionRoomEnvironment,
} from "@/server/local-decision-room-runtime";

const origin = "http://localhost:3000";
const workspaceId = "11111111-1111-4111-a111-111111111111";
const userId = "22222222-2222-4222-a222-222222222222";
const signingKey = Buffer.alloc(32, 31);

function config() {
  const environment: LocalDecisionRoomEnvironment = {
    DATABASE_URL: "postgresql://server-only.invalid/database",
    REKLAMZEKA_LOCAL_SESSION_ENABLED: "true",
    REKLAMZEKA_LOCAL_ORIGIN: origin,
    REKLAMZEKA_LOCAL_WORKSPACE_ID: workspaceId,
    REKLAMZEKA_LOCAL_WORKSPACE_REF: "workspace_local",
    REKLAMZEKA_LOCAL_USER_ID: userId,
    REKLAMZEKA_LOCAL_READER_REF: "actor_owner",
    REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY: signingKey.toString("base64"),
  };
  return localDecisionRoomConfig(environment)!;
}

function token(issuedAt: number, expiresAt: number) {
  return mintLocalSessionCapability({
    kind: "session", workspaceId, workspaceRef: "workspace_local", userId, readerRef: "actor_owner",
    osUid: process.getuid!(), issuedAt, expiresAt,
  }, signingKey).token;
}

function request(value: string, credential: "cookie" | "bearer" = "cookie") {
  return new Request(`${origin}/api/approval-queue`, { method: "POST", headers: {
    Host: "localhost:3000", Origin: origin, "Sec-Fetch-Site": "same-origin",
    "X-ReklamZeka-Intent": "approval-queue-approve",
    ...(credential === "cookie" ? { Cookie: `${LOCAL_SESSION_COOKIE}=${encodeURIComponent(value)}` } : { Authorization: `Bearer ${value}` }),
  } });
}

describe("local approval decision principal boundary", () => {
  it("requires the separate decide scope and re-reads active membership on every request", async () => {
    const now = Math.floor(Date.now() / 1_000);
    const minted = token(now - 1, now + 300);
    const database = { execute: vi.fn(async () => ({ rows: [{
      workspace_id: workspaceId, user_id: userId, role: "owner", lifecycle_state: "active",
    }] })) };
    const first = await resolveTrustedLocalApprovalDecisionPrincipal({ request: request(minted), database: database as never, config: config() });
    const second = await resolveTrustedLocalApprovalDecisionPrincipal({ request: request(minted), database: database as never, config: config() });
    expect(first.membership.role).toBe("owner");
    expect(second.principal.workspaceId).toBe(workspaceId);
    expect(database.execute).toHaveBeenCalledTimes(2);
  });

  it("rejects bearer credentials, stale capabilities, proxy hops, and inactive membership", async () => {
    const now = Math.floor(Date.now() / 1_000);
    const current = token(now - 1, now + 300);
    const database = { execute: vi.fn(async () => ({ rows: [{
      workspace_id: workspaceId, user_id: userId, role: "owner", lifecycle_state: "active",
    }] })) };
    await expect(resolveTrustedLocalApprovalDecisionPrincipal({ request: request(current, "bearer"), database: database as never, config: config() }))
      .rejects.toThrow();
    const proxied = request(current);
    proxied.headers.set("X-Forwarded-For", "127.0.0.1");
    await expect(resolveTrustedLocalApprovalDecisionPrincipal({ request: proxied, database: database as never, config: config() }))
      .rejects.toThrow();
    const stale = token(now - 600, now - 1);
    await expect(resolveTrustedLocalApprovalDecisionPrincipal({ request: request(stale), database: database as never, config: config() }))
      .rejects.toThrow();

    const inactive = { execute: vi.fn(async () => ({ rows: [] })) };
    await expect(resolveTrustedLocalApprovalDecisionPrincipal({ request: request(current), database: inactive as never, config: config() }))
      .rejects.toThrow();
  });
});
