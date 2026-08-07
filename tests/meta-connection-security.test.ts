import { describe, expect, it, vi } from "vitest";
import { AuthorizationError, type WorkspaceMembership } from "@/security/authorization";
import { AppendOnlyAuditLog } from "@/security/audit";
import { ConnectorError } from "@/connectors/contract";
import { InMemoryMetaConnectionRepository } from "@/connectors/meta/connection-repository";
import { MetaConnectionLifecycleError, MetaConnectionService } from "@/connectors/meta/connection-service";
import { inspectMetaConnection } from "@/connectors/meta/doctor";
import { MetaGraphClient, type MetaFetch } from "@/connectors/meta/graph-client";
import {
  EnvironmentMetaSecretRepository,
  InMemoryMetaSecretRepository,
  MetaSecretAccessError,
} from "@/connectors/meta/secret-repository";

const fixtureToken = "fixture-sensitive-meta-token";
const principalId = "1234567890123456";
const memberships: readonly WorkspaceMembership[] = [
  { userId: "admin-a", workspaceId: "workspace-a", role: "admin" },
  { userId: "viewer-a", workspaceId: "workspace-a", role: "viewer" },
  { userId: "admin-b", workspaceId: "workspace-b", role: "admin" },
];

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function doctorFetch(): MetaFetch {
  return vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = new URL(input);
    expect(init?.method).toBe("GET");
    expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${fixtureToken}`);
    expect(url.pathname.startsWith("/v23.0/")).toBe(true);
    if (url.pathname.endsWith("/debug_token")) {
      return json({
        data: {
          is_valid: true,
          scopes: ["pages_manage_ads", "pages_show_list", "ads_management", "ads_read"],
          expires_at: 1_790_154_955,
          data_access_expires_at: 1_792_747_755,
        },
      });
    }
    if (url.pathname.endsWith("/me/adaccounts")) {
      return json({ data: [{ id: "act_123" }], summary: { total_count: 5 } });
    }
    if (url.pathname.endsWith("/me")) return json({ id: principalId, name: "Fixture Principal" });
    return json({ error: {} }, 404);
  });
}

describe("Meta token doctor", () => {
  it("separates granted management scopes from enabled read-only capabilities", async () => {
    const snapshot = await inspectMetaConnection({
      token: fixtureToken,
      fetchImpl: doctorFetch(),
      now: () => new Date("2026-08-07T09:00:00.000Z"),
    });

    expect(snapshot).toMatchObject({
      graphApiVersion: "v23.0",
      tokenStatus: "valid",
      expiryStatus: "healthy",
      expiresAt: "2026-09-23T09:15:55.000Z",
      accessibleAdAccountCount: 5,
      principal: { id: principalId, name: "Fixture Principal" },
    });
    expect(snapshot.capabilities.find((item) => item.capability === "accounts.read"))
      .toMatchObject({ granted: true, verified: true, enabled: true });
    expect(snapshot.capabilities.find((item) => item.capability === "ads.write"))
      .toMatchObject({ granted: true, verified: false, enabled: false });
    expect(JSON.stringify(snapshot)).not.toContain(fixtureToken);
  });

  it("fails closed for an expired token even when Meta marks it valid", async () => {
    const fetchImpl: MetaFetch = vi.fn(async (input) => {
      const url = new URL(input);
      if (url.pathname.endsWith("/debug_token")) return json({ data: { is_valid: true, scopes: ["ads_read"], expires_at: 1_700_000_000 } });
      if (url.pathname.endsWith("/me/adaccounts")) return json({ data: [] });
      return json({ id: principalId });
    });
    await expect(inspectMetaConnection({
      token: fixtureToken,
      fetchImpl,
      now: () => new Date("2026-08-07T09:00:00.000Z"),
    })).rejects.toMatchObject({ code: "authentication" });
  });

  it("redacts native transport failures that contain request credentials", async () => {
    const client = new MetaGraphClient(fixtureToken, vi.fn(async () => {
      throw new Error(`request failed with Bearer ${fixtureToken}`);
    }));
    const error = await client.get("/me").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConnectorError);
    expect(String(error)).not.toContain(fixtureToken);
    expect(error).toMatchObject({ code: "transient", retryable: true });
  });
});

describe("Meta connection lifecycle boundary", () => {
  function setup(fetchImpl: MetaFetch = doctorFetch()) {
    const secrets = new InMemoryMetaSecretRepository();
    const connections = new InMemoryMetaConnectionRepository();
    const audit = new AppendOnlyAuditLog();
    const service = new MetaConnectionService({
      memberships,
      connections,
      secrets,
      audit,
      fetchImpl,
      now: () => new Date("2026-08-07T09:00:00.000Z"),
    });
    return { secrets, connections, audit, service };
  }

  it("keeps secret references and exact external IDs out of public connection payloads", async () => {
    const { secrets, service, audit } = setup();
    const connectionId = "connection-a";
    const secretReference = secrets.store({ workspaceId: "workspace-a", connectionId }, fixtureToken);
    const registered = await service.register({
      actor: { userId: "admin-a" },
      workspaceId: "workspace-a",
      connectionId,
      displayName: "Ana Meta bağlantısı",
      secretReference,
    });
    expect(JSON.stringify(registered)).not.toContain(secretReference.id);
    expect(registered).toMatchObject({ accessMode: "read_only", status: "active", secretConfigured: true });

    const checked = await service.doctor({ userId: "admin-a" }, "workspace-a", connectionId);
    const serialized = JSON.stringify(checked);
    expect(checked.capabilitySnapshot?.principal.id).toBe("1234…3456");
    expect(serialized).not.toContain(principalId);
    expect(serialized).not.toContain(fixtureToken);
    expect(serialized).not.toContain(secretReference.id);
    expect(audit.list("workspace-a").at(-1)?.metadata).toMatchObject({ writeOperations: 0, managementGranted: true });
    expect(JSON.stringify(audit.list("workspace-a"))).not.toContain(fixtureToken);
  });

  it("rejects cross-workspace, non-manager and wrong-scope secret access", async () => {
    const { secrets, service } = setup();
    const connectionId = "connection-a";
    const reference = secrets.store({ workspaceId: "workspace-a", connectionId }, fixtureToken);
    await service.register({ actor: { userId: "admin-a" }, workspaceId: "workspace-a", connectionId, displayName: "A", secretReference: reference });

    await expect(service.doctor({ userId: "admin-a" }, "workspace-b", connectionId)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(service.disconnect({ userId: "viewer-a" }, "workspace-a", connectionId)).rejects.toBeInstanceOf(AuthorizationError);
    await expect(secrets.resolve(reference, { workspaceId: "workspace-b", connectionId })).rejects.toBeInstanceOf(MetaSecretAccessError);

    const wrongScopeReference = secrets.store({ workspaceId: "workspace-b", connectionId: "connection-cross" }, fixtureToken);
    await expect(service.register({
      actor: { userId: "admin-a" },
      workspaceId: "workspace-a",
      connectionId: "connection-cross",
      displayName: "Cross",
      secretReference: wrongScopeReference,
    })).rejects.toBeInstanceOf(MetaSecretAccessError);
  });

  it("does not allow registration to overwrite an existing connection", async () => {
    const { secrets, service } = setup();
    const connectionId = "connection-duplicate";
    const first = secrets.store({ workspaceId: "workspace-a", connectionId }, fixtureToken);
    await service.register({ actor: { userId: "admin-a" }, workspaceId: "workspace-a", connectionId, displayName: "Original", secretReference: first });
    const second = secrets.store({ workspaceId: "workspace-a", connectionId }, "replacement-token");
    await expect(service.register({ actor: { userId: "admin-a" }, workspaceId: "workspace-a", connectionId, displayName: "Replacement", secretReference: second }))
      .rejects.toBeInstanceOf(MetaConnectionLifecycleError);
    expect((await service.list({ userId: "viewer-a" }, "workspace-a"))[0]?.displayName).toBe("Original");
  });

  it("disables local secret use on disconnect and performs no upstream revocation", async () => {
    const { secrets, service, audit } = setup();
    const connectionId = "connection-disconnect";
    const reference = secrets.store({ workspaceId: "workspace-a", connectionId }, fixtureToken);
    await service.register({ actor: { userId: "admin-a" }, workspaceId: "workspace-a", connectionId, displayName: "A", secretReference: reference });
    const disconnected = await service.disconnect({ userId: "admin-a" }, "workspace-a", connectionId);

    expect(disconnected).toMatchObject({ status: "disconnected", secretConfigured: false });
    await expect(secrets.resolve(reference, { workspaceId: "workspace-a", connectionId })).rejects.toBeInstanceOf(MetaSecretAccessError);
    await expect(service.doctor({ userId: "admin-a" }, "workspace-a", connectionId)).rejects.toBeInstanceOf(MetaConnectionLifecycleError);
    expect(audit.list("workspace-a").at(-1)?.metadata).toMatchObject({ secretUsable: false, upstreamTokenInvalidated: false, writeOperations: 0 });
  });

  it("destroys a revoked local reference without pretending to call Meta's writer surface", async () => {
    const { secrets, service } = setup();
    const connectionId = "connection-revoke";
    const reference = secrets.store({ workspaceId: "workspace-a", connectionId }, fixtureToken);
    await service.register({ actor: { userId: "admin-a" }, workspaceId: "workspace-a", connectionId, displayName: "A", secretReference: reference });
    const result = await service.revoke({ userId: "admin-a" }, "workspace-a", connectionId);
    expect(result).toMatchObject({ upstreamTokenInvalidated: false, reason: "read_only_boundary", connection: { status: "revoked" } });
    await expect(secrets.resolve(reference, { workspaceId: "workspace-a", connectionId })).rejects.toBeInstanceOf(MetaSecretAccessError);
  });

  it("allows a disconnected reference to be destroyed by a later local revoke", async () => {
    const { secrets, service } = setup();
    const connectionId = "connection-disconnect-then-revoke";
    const reference = secrets.store({ workspaceId: "workspace-a", connectionId }, fixtureToken);
    await service.register({ actor: { userId: "admin-a" }, workspaceId: "workspace-a", connectionId, displayName: "A", secretReference: reference });
    await service.disconnect({ userId: "admin-a" }, "workspace-a", connectionId);
    const result = await service.revoke({ userId: "admin-a" }, "workspace-a", connectionId);
    expect(result.connection.status).toBe("revoked");
    await expect(secrets.resolve(reference, { workspaceId: "workspace-a", connectionId })).rejects.toBeInstanceOf(MetaSecretAccessError);
  });

  it("parks an authentication failure as invalid and blocks repeated doctor calls", async () => {
    const fetchImpl: MetaFetch = vi.fn(async () => json({ data: { is_valid: false } }));
    const { secrets, connections, service, audit } = setup(fetchImpl);
    const connectionId = "connection-invalid";
    const reference = secrets.store({ workspaceId: "workspace-a", connectionId }, fixtureToken);
    await service.register({ actor: { userId: "admin-a" }, workspaceId: "workspace-a", connectionId, displayName: "A", secretReference: reference });

    await expect(service.doctor({ userId: "admin-a" }, "workspace-a", connectionId)).rejects.toMatchObject({ code: "authentication" });
    expect((await connections.find("workspace-a", connectionId)).status).toBe("invalid");
    expect(audit.list("workspace-a").at(-1)?.metadata).toMatchObject({ tokenStatus: "invalid", writeOperations: 0 });
    await expect(service.doctor({ userId: "admin-a" }, "workspace-a", connectionId)).rejects.toBeInstanceOf(MetaConnectionLifecycleError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("transitional environment secret reference", () => {
  it("resolves the current environment value without copying it into the reference", async () => {
    const environment: Record<string, string | undefined> = { META_ACCESS_TOKEN: "token-v1" };
    const secrets = new EnvironmentMetaSecretRepository(environment);
    const scope = { workspaceId: "workspace-a", connectionId: "connection-a" };
    const reference = secrets.reference(scope);
    expect(JSON.stringify(reference)).not.toContain("token-v1");
    await expect(secrets.resolve(reference, scope)).resolves.toBe("token-v1");
    environment.META_ACCESS_TOKEN = "token-v2";
    await expect(secrets.resolve(reference, scope)).resolves.toBe("token-v2");
  });
});
