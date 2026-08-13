import { describe, expect, it, vi } from "vitest";
import {
  LocalDecisionRoomBoundaryError,
  assertTrustedLocalDecisionRoomRequest,
  createLocalDecisionRoomRouteHandlers,
  localDecisionRoomConfig,
  resolveTrustedLocalPolicyBundlePrincipal,
  resolveTrustedLocalExperimentRecordPrincipal,
  resolveTrustedLocalPromotionLifecyclePrincipal,
  resolveTrustedLocalSessionIdentity,
  resolveTrustedLocalSliceRuleBudgetImpactPrincipal,
  type LocalDecisionRoomEnvironment,
} from "@/server/local-decision-room-runtime";
import {
  LOCAL_SESSION_COOKIE,
  mintLocalSessionCapability,
  verifyLocalSessionCapability,
} from "@/security/local-session-capability";

const workspaceId = "11111111-1111-4111-a111-111111111111";
const userId = "22222222-2222-4222-a222-222222222222";
const signingKey = Buffer.alloc(32, 7);

function environment(overrides: Partial<LocalDecisionRoomEnvironment> = {}): LocalDecisionRoomEnvironment {
  return {
    DATABASE_URL: "postgresql://server-only.invalid/database",
    REKLAMZEKA_LOCAL_SESSION_ENABLED: "true",
    REKLAMZEKA_LOCAL_ORIGIN: "http://localhost:3000",
    REKLAMZEKA_LOCAL_WORKSPACE_ID: workspaceId,
    REKLAMZEKA_LOCAL_WORKSPACE_REF: "workspace_local",
    REKLAMZEKA_LOCAL_USER_ID: userId,
    REKLAMZEKA_LOCAL_READER_REF: "reader_local_owner",
    REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY: signingKey.toString("base64"),
    ...overrides,
  };
}

function request(path = "/api/decision-room?view=runs", headers: Record<string, string> = {}) {
  return new Request(`http://localhost:3000${path}`, {
    headers: { Host: "localhost:3000", "Sec-Fetch-Site": "same-origin", ...headers },
  });
}

function sessionToken(overrides: Partial<{ workspaceId: string; expiresAt: number }> = {}) {
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = overrides.expiresAt ?? now + 300;
  return mintLocalSessionCapability({
    kind: "session",
    workspaceId: overrides.workspaceId ?? workspaceId,
    workspaceRef: "workspace_local",
    userId,
    readerRef: "reader_local_owner",
    osUid: process.getuid!(),
    issuedAt: Math.min(now - 1, expiresAt - 60),
    expiresAt,
  }, signingKey).token;
}

function authenticatedRequest(token = sessionToken()) {
  return request(undefined, { Cookie: `${LOCAL_SESSION_COOKIE}=${encodeURIComponent(token)}` });
}

function readDatabase(membership = true) {
  let call = 0;
  return {
    execute: vi.fn(async () => {
      call += 1;
      if (call === 1) return { rows: membership ? [{
        workspace_id: workspaceId, user_id: userId, role: "viewer", lifecycle_state: "active",
      }] : [] };
      if (call === 2) return { rows: [{ id: workspaceId }] };
      return { rows: [] };
    }),
    transaction: vi.fn(),
  };
}

describe("local Decision Room principal boundary", () => {
  it("reuses the exact cookie/bearer capability and active-membership binding for agent coordination", async () => {
    const config = localDecisionRoomConfig(environment())!;
    const token = sessionToken();
    const cookie = request("/api/local-agent-sessions", {
      Cookie: `${LOCAL_SESSION_COOKIE}=${encodeURIComponent(token)}`,
    });
    await expect(resolveTrustedLocalSessionIdentity({ request: cookie, database: readDatabase() as never,
      config, credential: "cookie" })).resolves.toMatchObject({
      claims: { workspaceId, userId, kind: "session" }, membership: { workspaceId, userId, role: "viewer" },
    });
    await expect(resolveTrustedLocalSessionIdentity({ request: cookie, database: readDatabase() as never,
      config, credential: "bearer" })).rejects.toBeInstanceOf(LocalDecisionRoomBoundaryError);
    const bearer = request("/api/local-agent-sessions", { Authorization: `Bearer ${token}` });
    await expect(resolveTrustedLocalSessionIdentity({ request: bearer, database: readDatabase(false) as never,
      config, credential: "bearer" })).rejects.toBeInstanceOf(LocalDecisionRoomBoundaryError);
  });

  it("allows bearer only for policy-bundle reads and keeps policy mutations cookie-only", async () => {
    const config = localDecisionRoomConfig(environment())!;
    const token = sessionToken();
    const bearer = request("/api/policy-bundles", {
      Authorization: `Bearer ${token}`, "X-ReklamZeka-Intent": "policy-bundle-read",
    });
    await expect(resolveTrustedLocalPolicyBundlePrincipal({ request: bearer, database: readDatabase() as never,
      config, requiredScope: "policy_bundle:read" })).resolves.toMatchObject({
      membership: { workspaceId, userId, role: "viewer" },
    });
    await expect(resolveTrustedLocalPolicyBundlePrincipal({ request: bearer, database: readDatabase() as never,
      config, requiredScope: "policy_bundle:draft" })).rejects.toBeInstanceOf(LocalDecisionRoomBoundaryError);
  });

  it("binds lifecycle read, draft and publish to exact dedicated cookie scope and intent", async () => {
    const config = localDecisionRoomConfig(environment())!;
    const token = sessionToken();
    const lifecycle = (intent: string, mode: "cookie" | "bearer" = "cookie") => request(
      "/api/promotion-template-authoring",
      { "X-ReklamZeka-Intent": intent, Origin: "http://localhost:3000",
        ...(mode === "cookie" ? { Cookie: `${LOCAL_SESSION_COOKIE}=${encodeURIComponent(token)}` }
          : { Authorization: `Bearer ${token}` }) },
    );
    for (const [scope, intent] of [
      ["promotion_lifecycle:read", "promotion-template-lifecycle-read"],
      ["promotion_lifecycle:draft", "promotion-template-lifecycle-draft"],
      ["promotion_lifecycle:publish", "promotion-template-lifecycle-publish"],
    ] as const) {
      await expect(resolveTrustedLocalPromotionLifecyclePrincipal({ request: lifecycle(intent),
        database: readDatabase() as never, config, requiredScope: scope })).resolves.toMatchObject({
        membership: { workspaceId, userId, role: "viewer" },
      });
    }
    await expect(resolveTrustedLocalPromotionLifecyclePrincipal({
      request: lifecycle("promotion-template-lifecycle-publish"), database: readDatabase() as never,
      config, requiredScope: "promotion_lifecycle:draft",
    })).rejects.toBeInstanceOf(LocalDecisionRoomBoundaryError);
    await expect(resolveTrustedLocalPromotionLifecyclePrincipal({
      request: lifecycle("promotion-template-lifecycle-publish", "bearer"), database: readDatabase() as never,
      config, requiredScope: "promotion_lifecycle:publish",
    })).rejects.toBeInstanceOf(LocalDecisionRoomBoundaryError);
  });

  it("binds experiment evidence to its publish-intent allowlist while retaining cookie scope", async () => {
    const config = localDecisionRoomConfig(environment())!;
    const token = sessionToken();
    const experiment = request("/api/experiment-records", {
      Cookie: `${LOCAL_SESSION_COOKIE}=${encodeURIComponent(token)}`,
      Origin: "http://localhost:3000", "X-ReklamZeka-Intent": "experiment-record-mutate",
    });
    await expect(resolveTrustedLocalExperimentRecordPrincipal({ request: experiment,
      database: readDatabase() as never, config })).resolves.toMatchObject({
      membership: { workspaceId, userId, role: "viewer" },
    });
  });

  it("binds Slice Rule impact preview/save only to their exact cookie intents", async () => {
    const config = localDecisionRoomConfig(environment())!;
    const token = sessionToken();
    const impact = (mode: "cookie" | "bearer", intent = "slice-rule-budget-impact-preview") => request(
      "/api/slice-rule-workspace", { Origin: "http://localhost:3000", "X-ReklamZeka-Intent": intent,
        ...(mode === "cookie" ? { Cookie: `${LOCAL_SESSION_COOKIE}=${encodeURIComponent(token)}` }
          : { Authorization: `Bearer ${token}` }) });
    await expect(resolveTrustedLocalSliceRuleBudgetImpactPrincipal({ request: impact("cookie"),
      database: readDatabase() as never, config })).resolves.toMatchObject({
      membership: { workspaceId, userId, role: "viewer" },
    });
    await expect(resolveTrustedLocalSliceRuleBudgetImpactPrincipal({ request: impact("cookie", "slice-rule-budget-impact-save"),
      database: readDatabase() as never, config })).resolves.toMatchObject({
      membership: { workspaceId, userId, role: "viewer" },
    });
    await expect(resolveTrustedLocalSliceRuleBudgetImpactPrincipal({ request: impact("bearer"),
      database: readDatabase() as never, config })).rejects.toBeInstanceOf(LocalDecisionRoomBoundaryError);
    await expect(resolveTrustedLocalSliceRuleBudgetImpactPrincipal({ request: impact("cookie", "slice-rule-workspace-save"),
      database: readDatabase() as never, config })).rejects.toBeInstanceOf(LocalDecisionRoomBoundaryError);
  });

  it("is disabled unless all server-only bindings are explicitly enabled", () => {
    expect(localDecisionRoomConfig(environment({ REKLAMZEKA_LOCAL_SESSION_ENABLED: "false" }))).toBeNull();
    expect(localDecisionRoomConfig(environment({ DATABASE_URL: "" }))).toBeNull();
    expect(() => localDecisionRoomConfig(environment({ REKLAMZEKA_LOCAL_ORIGIN: "http://0.0.0.0:3000" })))
      .toThrow(LocalDecisionRoomBoundaryError);
    expect(() => localDecisionRoomConfig(environment({ REKLAMZEKA_LOCAL_ORIGIN: "http://127.0.0.1:3000" })))
      .toThrow(LocalDecisionRoomBoundaryError);
    expect(localDecisionRoomConfig(environment({ REKLAMZEKA_LOCAL_ORIGIN: "https://127.0.0.1:3000" }))?.origin)
      .toBe("https://127.0.0.1:3000");
    expect(() => localDecisionRoomConfig(environment({ REKLAMZEKA_LOCAL_WORKSPACE_ID: "workspace_from_query" })))
      .toThrow(LocalDecisionRoomBoundaryError);
  });

  it("rejects host spoofing, proxy claims, cross-site reads, and replayable PATCH requests", () => {
    const config = localDecisionRoomConfig(environment())!;
    expect(() => assertTrustedLocalDecisionRoomRequest(request(), config, "read")).not.toThrow();
    expect(() => assertTrustedLocalDecisionRoomRequest(request(undefined, {
      "X-Forwarded-For": "::1", "X-Forwarded-Host": "localhost:3000",
      "X-Forwarded-Port": "3000", "X-Forwarded-Proto": "http",
    }), config, "read")).not.toThrow();
    expect(() => assertTrustedLocalDecisionRoomRequest(request(undefined, { Host: "evil.example" }), config, "read"))
      .toThrow(LocalDecisionRoomBoundaryError);
    expect(() => assertTrustedLocalDecisionRoomRequest(request(undefined, { "X-Forwarded-For": "127.0.0.1" }), config, "read"))
      .toThrow(LocalDecisionRoomBoundaryError);
    expect(() => assertTrustedLocalDecisionRoomRequest(request(undefined, {
      Origin: "https://evil.example", "Sec-Fetch-Site": "cross-site",
    }), config, "read")).toThrow(LocalDecisionRoomBoundaryError);
    expect(() => assertTrustedLocalDecisionRoomRequest(request("/api/decision-room", {
      Origin: "http://localhost:3000",
    }), config, "mark_read")).toThrow(LocalDecisionRoomBoundaryError);
    expect(() => assertTrustedLocalDecisionRoomRequest(request("/api/decision-room", {
      Origin: "http://localhost:3000", "X-ReklamZeka-Intent": "mark-inbox-read",
    }), config, "mark_read")).not.toThrow();
    expect(() => assertTrustedLocalDecisionRoomRequest(request("/api/policy-bundles", {
      Origin: "http://localhost:3000", "X-ReklamZeka-Intent": "policy-bundle-confirm-human-presence",
    }), config, "publish")).not.toThrow();
    expect(() => assertTrustedLocalDecisionRoomRequest(request("/api/policy-bundles", {
      Origin: "http://localhost:3000", "X-ReklamZeka-Intent": "policy-bundle-create-draft",
    }), config, "publish")).toThrow(LocalDecisionRoomBoundaryError);
    expect(() => assertTrustedLocalDecisionRoomRequest(request("/api/category-authoring", {
      Origin: "http://localhost:3000", "X-ReklamZeka-Intent": "category-authoring-mutate",
    }), config, "publish")).not.toThrow();
    expect(() => assertTrustedLocalDecisionRoomRequest(request("/api/starter-category-adoption", {
      Origin: "http://localhost:3000", "X-ReklamZeka-Intent": "starter-category-adoption-confirm",
    }), config, "publish")).not.toThrow();
    expect(() => assertTrustedLocalDecisionRoomRequest(request("/api/instruction-policies", {
      Origin: "http://localhost:3000", "X-ReklamZeka-Intent": "instruction-policy-mutate",
    }), config, "draft")).not.toThrow();
    expect(() => assertTrustedLocalDecisionRoomRequest(request("/api/instruction-policies", {
      Origin: "http://localhost:3000", "X-ReklamZeka-Intent": "instruction-policy-mutate",
    }), config, "publish")).not.toThrow();
    expect(() => assertTrustedLocalDecisionRoomRequest(request("/api/progressive-formalization", {
      Origin: "http://localhost:3000", "X-ReklamZeka-Intent": "progressive-formalization-mutate",
    }), config, "draft")).not.toThrow();
    expect(() => assertTrustedLocalDecisionRoomRequest(request("/api/progressive-formalization", {
      Origin: "http://localhost:3000", "X-ReklamZeka-Intent": "progressive-formalization-mutate",
    }), config, "publish")).not.toThrow();
    expect(() => assertTrustedLocalDecisionRoomRequest(request("/api/guidance-studio", {
      Origin: "http://localhost:3000", "X-ReklamZeka-Intent": "guidance-set-create",
    }), config, "draft")).not.toThrow();
    expect(() => assertTrustedLocalDecisionRoomRequest(request("/api/guidance-studio", {
      Origin: "http://localhost:3000", "X-ReklamZeka-Intent": "guidance-set-review",
    }), config, "publish")).not.toThrow();
    expect(() => assertTrustedLocalDecisionRoomRequest(request("/api/guidance-studio", {
      Origin: "http://localhost:3000", "X-ReklamZeka-Intent": "guidance-set-publish",
    }), config, "publish")).toThrow(LocalDecisionRoomBoundaryError);
  });

  it("binds the fixed principal to a current DB membership and exposes no private IDs", async () => {
    const database = readDatabase();
    const handlers = createLocalDecisionRoomRouteHandlers({
      database: database as never,
      config: localDecisionRoomConfig(environment())!,
    });
    const response = await handlers.GET(authenticatedRequest());
    expect(response.status).toBe(200);
    const serialized = JSON.stringify(await response.json());
    expect(serialized).toContain('"view":"runs"');
    expect(serialized).toContain('"actionExecution":false');
    expect(serialized).not.toContain(workspaceId);
    expect(serialized).not.toContain(userId);
    expect(serialized).not.toContain("server-only.invalid");
    expect(database.execute).toHaveBeenCalledTimes(3);
  });

  it("fails closed before repository reads when membership is absent or revoked", async () => {
    const database = readDatabase(false);
    const handlers = createLocalDecisionRoomRouteHandlers({
      database: database as never,
      config: localDecisionRoomConfig(environment())!,
    });
    const response = await handlers.GET(authenticatedRequest());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: {
        code: "source_not_configured",
        message: "Decision Room çalışma alanı ve kimlik bağlama katmanı henüz etkin değil.",
      },
    });
    expect(database.execute).toHaveBeenCalledTimes(1);
  });

  it("rejects expired, tampered, cross-workspace, wrong-scope, and dual credentials", async () => {
    const config = localDecisionRoomConfig(environment())!;
    const now = Math.floor(Date.now() / 1000);
    const expired = sessionToken({ expiresAt: now - 1 });
    expect(() => verifyLocalSessionCapability({
      token: expired, key: signingKey, now, osUid: process.getuid!(),
      requiredScope: "decision_room:read", expected: config,
    })).toThrow();
    const valid = sessionToken();
    expect(() => verifyLocalSessionCapability({
      token: `${valid.slice(0, -1)}x`, key: signingKey, now, osUid: process.getuid!(),
      requiredScope: "decision_room:read", expected: config,
    })).toThrow();
    const [prefix, payload, signature] = valid.split(".");
    const decodedSignature = Buffer.from(signature!, "base64url");
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    const lastIndex = alphabet.indexOf(signature!.at(-1)!);
    const nonCanonicalLast = alphabet[(lastIndex & 0b111100) | ((lastIndex + 1) & 0b000011)]!;
    const nonCanonical = `${prefix}.${payload}.${signature!.slice(0, -1)}${nonCanonicalLast}`;
    expect(Buffer.from(nonCanonicalLast === signature!.at(-1) ? signature! : `${signature!.slice(0, -1)}${nonCanonicalLast}`, "base64url"))
      .toEqual(decodedSignature);
    expect(() => verifyLocalSessionCapability({
      token: nonCanonical, key: signingKey, now, osUid: process.getuid!(),
      requiredScope: "decision_room:read", expected: config,
    })).toThrow();
    expect(() => verifyLocalSessionCapability({
      token: sessionToken({ workspaceId: "33333333-3333-4333-a333-333333333333" }),
      key: signingKey, now, osUid: process.getuid!(), requiredScope: "decision_room:read", expected: config,
    })).toThrow();
    expect(() => verifyLocalSessionCapability({
      token: valid, key: signingKey, now, osUid: process.getuid!() + 1,
      requiredScope: "decision_room:read", expected: config,
    })).toThrow();
    const bootstrap = mintLocalSessionCapability({
      kind: "bootstrap", workspaceId, workspaceRef: "workspace_local", userId,
      readerRef: "reader_local_owner", osUid: process.getuid!(), issuedAt: now, expiresAt: now + 60,
    }, signingKey).token;
    expect(() => verifyLocalSessionCapability({
      token: bootstrap, key: signingKey, now, osUid: process.getuid!(),
      requiredScope: "decision_room:read", expected: config,
    })).toThrow();

    const database = readDatabase();
    const handlers = createLocalDecisionRoomRouteHandlers({ database: database as never, config });
    const response = await handlers.GET(request(undefined, {
      Cookie: `${LOCAL_SESSION_COOKIE}=${valid}`, Authorization: `Bearer ${valid}`,
    }));
    expect(response.status).toBe(503);
    expect(database.execute).not.toHaveBeenCalled();
  });
});
