import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as getBootstrapStatus } from "@/app/api/meta/bootstrap-status/route";
import { AppendOnlyAuditLog } from "@/security/audit";
import { InMemoryMetaConnectionRepository } from "@/connectors/meta/connection-repository";
import { MetaConnectionLifecycleError, MetaConnectionService } from "@/connectors/meta/connection-service";
import { InMemoryMetaSecretRepository } from "@/connectors/meta/secret-repository";
import { inspectMetaBootstrapPreflight } from "@/connectors/meta/bootstrap-preflight";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Meta bootstrap/doctor preflight", () => {
  it("reports rotation_required without reading the token value", () => {
    const environment = { META_TOKEN_SECURITY_STATUS: "temporary_exposed" } as Record<string, string | undefined>;
    Object.defineProperty(environment, "META_ACCESS_TOKEN", {
      configurable: true,
      enumerable: true,
      get: () => { throw new Error("secret value must not be read"); },
    });

    expect(inspectMetaBootstrapPreflight(environment)).toMatchObject({
      readiness: "blocked",
      blocker: "rotation_required",
      securityStatus: "temporary_exposed",
      secretBindingConfigured: true,
      doctorExecuted: false,
      bootstrapExecuted: false,
      networkCalls: 0,
      writeOperations: 0,
    });
  });

  it("reports configured only after an explicit secure status and binding presence", () => {
    expect(inspectMetaBootstrapPreflight({
      META_TOKEN_SECURITY_STATUS: "rotated",
      META_ACCESS_TOKEN: "not-read-by-preflight",
    })).toMatchObject({ readiness: "configured", blocker: null, securityStatus: "secure" });
    expect(inspectMetaBootstrapPreflight({ META_TOKEN_SECURITY_STATUS: "rotated" }))
      .toMatchObject({ readiness: "blocked", blocker: "secret_binding_missing" });
    expect(inspectMetaBootstrapPreflight({}))
      .toMatchObject({ readiness: "blocked", blocker: "explicit_security_status_required" });
  });

  it("keeps the public status response redacted, non-cached and network-free", async () => {
    const previousStatus = process.env.META_TOKEN_SECURITY_STATUS;
    const previousToken = process.env.META_ACCESS_TOKEN;
    process.env.META_TOKEN_SECURITY_STATUS = "temporary_exposed";
    process.env.META_ACCESS_TOKEN = "fixture-sensitive-token";
    const network = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network must remain unreachable"));
    try {
      const response = getBootstrapStatus();
      const body = await response.text();
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(body).toContain("rotation_required");
      expect(body).not.toContain("fixture-sensitive-token");
      expect(network).not.toHaveBeenCalled();
    } finally {
      if (previousStatus === undefined) delete process.env.META_TOKEN_SECURITY_STATUS;
      else process.env.META_TOKEN_SECURITY_STATUS = previousStatus;
      if (previousToken === undefined) delete process.env.META_ACCESS_TOKEN;
      else process.env.META_ACCESS_TOKEN = previousToken;
    }
  });

  it("blocks connection doctor before secret resolution or Graph transport", async () => {
    const connections = new InMemoryMetaConnectionRepository();
    const secrets = new InMemoryMetaSecretRepository();
    const fetchImpl = vi.fn();
    const service = new MetaConnectionService({
      memberships: [{ userId: "admin-a", workspaceId: "workspace-a", role: "admin" }],
      connections,
      secrets,
      audit: new AppendOnlyAuditLog(),
      fetchImpl,
      tokenSecurityStatus: () => "temporary_exposed",
    });
    const connectionId = "connection-a";
    const reference = secrets.store({ workspaceId: "workspace-a", connectionId }, "fixture-sensitive-token");
    await service.register({
      actor: { userId: "admin-a" }, workspaceId: "workspace-a", connectionId,
      displayName: "Ana Meta bağlantısı", secretReference: reference,
    });
    const resolve = vi.spyOn(secrets, "resolve");

    await expect(service.doctor({ userId: "admin-a" }, "workspace-a", connectionId))
      .rejects.toMatchObject({
        constructor: MetaConnectionLifecycleError,
        publicMessage: "Meta bağlantısı güvenlik nedeniyle kapalı; token rotasyonu ve güvenli binding doğrulaması gerekiyor",
      });
    expect(resolve).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
