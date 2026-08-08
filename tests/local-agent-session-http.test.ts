import { describe, expect, it, vi } from "vitest";
import { LocalAgentSessionLifecycleError } from "@/application/local-agent-session-contract";
import type { LocalSessionClaims } from "@/security/local-session-capability";
import { LOCAL_SESSION_RUNTIME_SCOPES } from "@/security/local-session-capability";
import { createLocalAgentHandoffHttpHandlers } from "@/server/local-agent-handoff-http";
import { createLocalAgentSessionHttpHandlers } from "@/server/local-agent-session-http";

const origin = "http://localhost:3000";
const claims: LocalSessionClaims = Object.freeze({
  version: 1, kind: "session", sessionRef: "session_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", nonce: "e".repeat(64),
  workspaceId: "11111111-1111-4111-a111-111111111111", workspaceRef: "workspace_alpha",
  userId: "22222222-2222-4222-a222-222222222222", readerRef: "reader_owner",
  scopes: LOCAL_SESSION_RUNTIME_SCOPES, issuedAt: 1_800_000_000, expiresAt: 1_800_000_300, osUid: 501,
});
const client = Object.freeze({ clientRef: "client_codex", transport: "project_stdio" as const,
  allowedTools: Object.freeze(["decision_room_list"] as const) });
const closedAuthority = Object.freeze({ sessionCoordination: true, businessMutation: false, modelExecution: false,
  humanPresence: false, approval: false, grant: false, execution: false, rawMeta: false, rawSql: false, metaWrite: false });

function request(path: string, method: string, intent: string, mode: "cookie" | "bearer", body?: unknown,
  extra: Record<string, string> = {}) {
  const text = body === undefined ? undefined : JSON.stringify(body);
  return new Request(`${origin}${path}`, { method, headers: {
    Host: "localhost:3000", "X-ReklamZeka-Intent": intent,
    ...(mode === "cookie" ? { Cookie: "__Host-rzka_local_session=opaque", Origin: origin,
      "Sec-Fetch-Site": "same-origin" } : { Authorization: "Bearer opaque" }),
    ...(text === undefined ? {} : { "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(text)) }),
    ...extra,
  }, body: text });
}

function harness() {
  const register = vi.fn(async () => ({ contractVersion: "local-agent-session-lifecycle/1.0.0",
    outcome: "inserted", session: { sessionRef: claims.sessionRef }, authority: closedAuthority }));
  const heartbeat = vi.fn(async () => ({ contractVersion: "local-agent-session-lifecycle/1.0.0",
    session: { sessionRef: claims.sessionRef }, authority: closedAuthority }));
  const listActiveSessions = vi.fn(async () => ({ contractVersion: "local-agent-session-lifecycle/1.0.0",
    sessions: [{ clientRef: "client_codex", sessionRef: claims.sessionRef, transport: "project_stdio" }], authority: closedAuthority }));
  const createHandoff = vi.fn(async () => ({ contractVersion: "local-agent-session-lifecycle/1.0.0",
    handoff: { handoffRef: "handoff_cccccccccccccccccccccccccccccccc" }, authority: closedAuthority }));
  const consumeHandoff = vi.fn(async () => ({ contractVersion: "local-agent-session-lifecycle/1.0.0",
    handoff: { handoffRef: "handoff_cccccccccccccccccccccccccccccccc" }, authority: closedAuthority }));
  const resolveIdentity = vi.fn(async () => ({ claims }));
  return { register, heartbeat, listActiveSessions, createHandoff, consumeHandoff, resolveIdentity,
    sessions: createLocalAgentSessionHttpHandlers({ service: { register, heartbeat, listActiveSessions } as never,
      origin, resolveIdentity }),
    handoffs: createLocalAgentHandoffHttpHandlers({ service: { createHandoff, consumeHandoff } as never,
      origin, resolveIdentity }) };
}

describe("local agent session and handoff HTTP boundaries", () => {
  it("lists active sessions with cookie only and a server-canonical dashboard descriptor", async () => {
    const api = harness();
    const response = await api.sessions.GET(request("/api/local-agent-sessions", "GET", "local-agent-sessions-read", "cookie"));
    expect(response.status).toBe(200);
    expect(api.resolveIdentity).toHaveBeenCalledWith(expect.any(Request), "cookie");
    expect(api.listActiveSessions).toHaveBeenCalledWith({ claims,
      descriptor: expect.objectContaining({ clientRef: "client_dashboard", sessionRef: claims.sessionRef,
        workspaceRef: claims.workspaceRef, transport: "loopback_http",
        allowedTools: ["decision_room_list"] }) });
    expect(JSON.stringify(await response.json())).not.toContain(claims.workspaceId);
  });

  it("creates dashboard sessions without accepting a descriptor and registers CLI sessions without authority fields", async () => {
    const api = harness();
    api.heartbeat.mockRejectedValueOnce(new LocalAgentSessionLifecycleError("session_missing"));
    const dashboard = await api.sessions.POST(request("/api/local-agent-sessions", "POST",
      "local-agent-session-create", "cookie", {}));
    expect(dashboard.status).toBe(201);
    expect(api.register).toHaveBeenLastCalledWith({ claims,
      descriptor: expect.objectContaining({ clientRef: "client_dashboard", transport: "loopback_http" }) });
    const resumed = await api.sessions.POST(request("/api/local-agent-sessions", "POST",
      "local-agent-session-create", "cookie", {}));
    expect(resumed.status).toBe(200);
    expect(api.register).toHaveBeenCalledTimes(1);
    const cli = await api.sessions.POST(request("/api/local-agent-sessions", "POST",
      "local-agent-session-register", "bearer", client));
    expect(cli.status).toBe(201);
    expect(api.register).toHaveBeenLastCalledWith({ claims,
      descriptor: expect.objectContaining({ clientRef: "client_codex", transport: "project_stdio",
        allowedTools: ["decision_room_list"] }) });
    for (const injected of [{ ...client, authority: {} }, { ...client, model: "x" },
      { ...client, workspaceId: claims.workspaceId }, { ...client, allowedTools: ["execute_action"] }]) {
      expect((await api.sessions.POST(request("/api/local-agent-sessions", "POST",
        "local-agent-session-register", "bearer", injected))).status).toBe(400);
    }
  });

  it("heartbeats and consumes only with bearer, while handoff creation is cookie-only", async () => {
    const api = harness();
    expect((await api.sessions.PATCH(request("/api/local-agent-sessions", "PATCH",
      "local-agent-session-heartbeat", "bearer", client))).status).toBe(200);
    const context = { intent: "analysis", entityRef: "campaign_public", timeframeRef: "timeframe_last_7d",
      contextRef: "context_frozen", contextVersion: 1, templateRef: null,
      correlationRef: "correlation_dddddddddddddddddddddddddddddddd" };
    const created = await api.handoffs.POST(request("/api/local-agent-handoffs", "POST",
      "local-agent-handoff-create", "cookie", { targetSessionRef: "session_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        context, ttlSeconds: 30 }));
    expect(created.status).toBe(201);
    expect(api.createHandoff).toHaveBeenCalledWith(expect.objectContaining({ claims,
      descriptor: expect.objectContaining({ clientRef: "client_dashboard" }), context }));
    const consumed = await api.handoffs.PATCH(request("/api/local-agent-handoffs", "PATCH",
      "local-agent-handoff-consume", "bearer", { ...client,
        handoffRef: "handoff_cccccccccccccccccccccccccccccccc" }));
    expect(consumed.status).toBe(200);
    expect(api.consumeHandoff).toHaveBeenCalledWith(expect.objectContaining({ claims,
      handoffRef: "handoff_cccccccccccccccccccccccccccccccc",
      descriptor: expect.objectContaining({ clientRef: "client_codex" }) }));
  });

  it("rejects credential inversion, proxy/tenant injection, wrong intent, extended JSON and bodies over 2KB", async () => {
    const api = harness();
    const invalid = [
      api.sessions.POST(request("/api/local-agent-sessions", "POST", "local-agent-session-create", "bearer", {})),
      api.sessions.PATCH(request("/api/local-agent-sessions", "PATCH", "local-agent-session-heartbeat", "cookie", client)),
      api.handoffs.POST(request("/api/local-agent-handoffs", "POST", "local-agent-handoff-create", "bearer", {})),
      api.sessions.POST(request("/api/local-agent-sessions", "POST", "local-agent-session-register", "bearer", client,
        { "X-Forwarded-For": "127.0.0.1" })),
      api.sessions.POST(request("/api/local-agent-sessions", "POST", "local-agent-session-register", "bearer", client,
        { "X-Workspace-Id": claims.workspaceId })),
      api.sessions.POST(request("/api/local-agent-sessions", "POST", "wrong", "bearer", client)),
      api.sessions.POST(request("/api/local-agent-sessions", "POST", "local-agent-session-register", "bearer",
        { ...client, prompt: "x".repeat(2_100) })),
    ];
    for (const response of await Promise.all(invalid)) expect(response.status).toBe(400);
    expect(api.resolveIdentity).not.toHaveBeenCalled();
    expect(api.register).not.toHaveBeenCalled();
    expect(api.heartbeat).not.toHaveBeenCalled();
    expect(api.createHandoff).not.toHaveBeenCalled();
  });
});
