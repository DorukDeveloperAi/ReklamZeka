import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  AuthorizationError,
  authorizeWorkspace,
  can,
  type WorkspaceAction,
  type WorkspaceMembership,
  type WorkspaceRole,
} from "@/security/authorization";
import { AppendOnlyAuditLog } from "@/security/audit";
import {
  assertReadOnlyScopes,
  decryptSecret,
  encryptSecret,
  publicConnectionPayload,
  redactSecrets,
} from "@/security/secrets";
import { WorkspaceDataService } from "@/server/workspace-data-service";

const memberships: readonly WorkspaceMembership[] = [
  { userId: "owner-a", workspaceId: "workspace-a", role: "owner" },
  { userId: "admin-a", workspaceId: "workspace-a", role: "admin" },
  { userId: "analyst-a", workspaceId: "workspace-a", role: "analyst" },
  { userId: "viewer-a", workspaceId: "workspace-a", role: "viewer" },
  { userId: "owner-b", workspaceId: "workspace-b", role: "owner" },
];

describe("workspace authorization boundary", () => {
  it("enforces the role/action matrix", () => {
    const actions: readonly WorkspaceAction[] = [
      "workspace:manage", "member:manage", "connection:manage", "data:read",
      "sync:run", "insight:feedback", "report:share",
      "budget:draft",
    ];
    const expected: Record<WorkspaceRole, readonly WorkspaceAction[]> = {
      owner: actions,
      admin: actions.filter((action) => action !== "workspace:manage"),
      analyst: ["data:read", "sync:run", "insight:feedback", "report:share", "budget:draft"],
      viewer: ["data:read"],
    };
    for (const role of Object.keys(expected) as WorkspaceRole[]) {
      for (const action of actions) expect(can(role, action)).toBe(expected[role].includes(action));
    }
  });

  it("fails closed for non-members and cross-tenant access", () => {
    expect(() => authorizeWorkspace({ userId: "owner-a" }, "workspace-b", "data:read", memberships))
      .toThrow(AuthorizationError);
    expect(() => authorizeWorkspace({ userId: "unknown" }, "workspace-a", "data:read", memberships))
      .toThrow(AuthorizationError);
  });

  it("filters resources by the authorized workspace at the server boundary", () => {
    const audit = new AppendOnlyAuditLog();
    const service = new WorkspaceDataService(memberships, [
      { id: "source-a", workspaceId: "workspace-a", name: "A" },
      { id: "source-b", workspaceId: "workspace-b", name: "B" },
    ], audit);
    expect(service.list({ userId: "viewer-a" }, "workspace-a").map((item) => item.id)).toEqual(["source-a"]);
    expect(() => service.list({ userId: "viewer-a" }, "workspace-b")).toThrow(AuthorizationError);
    expect(() => service.startSync({ userId: "viewer-a" }, "workspace-a", "source-a", "2026-08-06T12:00:00Z"))
      .toThrow(AuthorizationError);
    service.startSync({ userId: "analyst-a" }, "workspace-a", "source-a", "2026-08-06T12:00:00Z");
    expect(audit.list("workspace-a")[0]?.action).toBe("sync.started");
  });
});

describe("connection secret boundary", () => {
  it("encrypts at rest and excludes secret material from public payloads", () => {
    const key = randomBytes(32);
    const plaintext = "fixture-super-secret-token";
    const encrypted = encryptSecret(plaintext, key, 3);
    expect(JSON.stringify(encrypted)).not.toContain(plaintext);
    expect(decryptSecret(encrypted, key)).toBe(plaintext);
    expect(publicConnectionPayload({
      id: "connection-a",
      platform: "meta_ads",
      displayName: "Ana hesap",
      secret: encrypted,
    })).toEqual({ id: "connection-a", platform: "meta_ads", displayName: "Ana hesap" });
  });

  it("rejects write scopes and redacts known secrets from logs and errors", () => {
    expect(() => assertReadOnlyScopes(["ads_read", "offline_access"])).not.toThrow();
    expect(() => assertReadOnlyScopes(["ads_management"])).toThrow(/izin verilmeyen OAuth scope/);
    const secret = "token-123";
    expect(redactSecrets(new Error(`upstream rejected ${secret}`), [secret])).toBe(
      "Error: upstream rejected [REDACTED]",
    );
    expect(redactSecrets({ authorization: `Bearer ${secret}` }, [secret])).not.toContain(secret);
  });
});

describe("append-only audit boundary", () => {
  it("records actor/time/resource and protects the internal hash chain from returned mutations", () => {
    const log = new AppendOnlyAuditLog();
    const first = log.append({
      workspaceId: "workspace-a",
      actorId: "admin-a",
      action: "connection.created",
      resourceType: "data_source",
      resourceId: "source-a",
      occurredAt: "2026-08-06T12:00:00Z",
      metadata: { platform: "meta_ads" },
    });
    log.append({
      workspaceId: "workspace-a",
      actorId: "analyst-a",
      action: "sync.completed",
      resourceType: "sync_run",
      resourceId: "sync-a",
      occurredAt: "2026-08-06T12:05:00Z",
      metadata: { rows: 42 },
    });
    (first as { actorId: string }).actorId = "tampered";
    expect(log.list("workspace-a")[0]?.actorId).toBe("admin-a");
    expect(log.list("workspace-a")[1]?.previousHash).toBe(log.list("workspace-a")[0]?.eventHash);
    expect(log.verifyIntegrity()).toBe(true);
  });
});
