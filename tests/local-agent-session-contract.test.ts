import { describe, expect, it } from "vitest";
import {
  LocalAgentSessionLifecycleService,
  type LocalAgentHandoffRecord,
  type LocalAgentSessionRecord,
  type LocalAgentSessionRepository,
} from "@/application/local-agent-session-contract";
import { createLocalAgentSessionDescriptor } from "@/application/local-agent-client";
import { LOCAL_SESSION_RUNTIME_SCOPES, type LocalSessionClaims } from "@/security/local-session-capability";

const workspaceA = "11111111-1111-4111-a111-111111111111";
const workspaceB = "22222222-2222-4222-a222-222222222222";
const userA = "33333333-3333-4333-a333-333333333333";
const userB = "44444444-4444-4444-a444-444444444444";
const sessionA = "session_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const sessionB = "session_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const sessionC = "session_cccccccccccccccccccccccccccccccc";
const handoffRef = "handoff_dddddddddddddddddddddddddddddddd";

function claims(input: Readonly<{ workspaceId?: string; workspaceRef?: string; userId?: string; sessionRef?: string;
  issuedAt?: number; expiresAt?: number }> = {}): LocalSessionClaims {
  return Object.freeze({
    version: 1, kind: "session", sessionRef: input.sessionRef ?? sessionA, nonce: "e".repeat(64),
    workspaceId: input.workspaceId ?? workspaceA, workspaceRef: input.workspaceRef ?? "workspace_alpha",
    userId: input.userId ?? userA, readerRef: "reader_owner",
    scopes: LOCAL_SESSION_RUNTIME_SCOPES,
    issuedAt: input.issuedAt ?? 1_799_999_990, expiresAt: input.expiresAt ?? 1_800_000_300, osUid: 501,
  });
}

function descriptor(value: LocalSessionClaims) {
  return createLocalAgentSessionDescriptor({
    clientRef: "client_local", sessionRef: value.sessionRef, transport: "deterministic_fixture",
    workspaceRef: value.workspaceRef, sessionScopes: value.scopes,
    allowedTools: ["decision_room_list", "policy_bundle_read", "existing_post_promotion_preflight"],
  });
}

function repository(): LocalAgentSessionRepository & Readonly<{
  sessions: Map<string, LocalAgentSessionRecord>; handoffs: Map<string, LocalAgentHandoffRecord>;
}> {
  const sessions = new Map<string, LocalAgentSessionRecord>();
  const handoffs = new Map<string, LocalAgentHandoffRecord>();
  const key = (workspaceId: string, sessionRef: string) => `${workspaceId}:${sessionRef}`;
  return {
    sessions, handoffs,
    register: async (record) => {
      const recordKey = key(record.workspaceId, record.sessionRef);
      const existing = sessions.get(recordKey);
      if (!existing) { sessions.set(recordKey, record); return "inserted"; }
      return JSON.stringify(existing) === JSON.stringify(record) ? "unchanged" : "conflict";
    },
    heartbeat: async (input) => {
      const recordKey = key(input.workspaceId, input.sessionRef);
      const current = sessions.get(recordKey);
      if (!current) return "missing";
      if (input.at < current.lastSeenAt) return "clock_regression";
      const next = Object.freeze({ ...current, lastSeenAt: input.at });
      sessions.set(recordKey, next);
      return next;
    },
    findSession: async (input) => sessions.get(key(input.workspaceId, input.sessionRef)) ?? null,
    createHandoff: async (record) => {
      if (handoffs.has(record.handoffRef)) return "conflict";
      handoffs.set(record.handoffRef, record);
      return "inserted";
    },
    consumeHandoff: async (input) => {
      const current = handoffs.get(input.handoffRef);
      if (!current) return { status: "missing" };
      if (current.workspaceId !== input.workspaceId || current.targetSessionRef !== input.sessionRef) return { status: "scope_rejected" };
      if (current.expiresAt <= input.at) return { status: "expired" };
      if (current.consumedAt !== null) return { status: "already_consumed" };
      const consumed = Object.freeze({ ...current, consumedAt: input.at });
      handoffs.set(input.handoffRef, consumed);
      return { status: "consumed", record: consumed };
    },
  };
}

function context(intent: "analysis" | "existing_post_promotion" = "analysis") {
  return Object.freeze({
    intent,
    entityRef: "campaign_public",
    timeframeRef: "timeframe_last_7d",
    contextRef: "context_frozen",
    contextVersion: 3,
    templateRef: intent === "analysis" ? null : "template_promotion",
    correlationRef: "correlation_ffffffffffffffffffffffffffffffff",
  });
}

function harness() {
  let now = 1_800_000_000;
  const store = repository();
  const service = new LocalAgentSessionLifecycleService(store, () => new Date(now * 1000), () => handoffRef);
  return { store, service, now: () => now, setNow: (value: number) => { now = value; } };
}

async function register(h: ReturnType<typeof harness>, value: LocalSessionClaims) {
  return h.service.register({ claims: value, descriptor: descriptor(value) });
}

describe("local AgentSession and DashboardHandoff lifecycle", () => {
  it("registers an exactly bound verified session and returns only public coordination state", async () => {
    const h = harness();
    const value = claims();
    const result = await register(h, value);
    expect(result).toEqual({
      contractVersion: "local-agent-session-lifecycle/1.0.0", outcome: "inserted",
      session: { clientRef: "client_local", sessionRef: sessionA, transport: "deterministic_fixture",
        workspaceRef: "workspace_alpha", startedAt: "2027-01-15T08:00:00.000Z",
        lastSeenAt: "2027-01-15T08:00:00.000Z", expiresAt: "2027-01-15T08:05:00.000Z" },
      authority: { sessionCoordination: true, businessMutation: false, modelExecution: false,
        humanPresence: false, approval: false, grant: false, execution: false,
        rawMeta: false, rawSql: false, metaWrite: false },
    });
    const serialized = JSON.stringify(result);
    for (const privateValue of [workspaceA, userA, value.nonce]) expect(serialized).not.toContain(privateValue);
    expect(serialized).not.toMatch(/token|secret|hash/i);
    expect(result.authority).toMatchObject({ businessMutation: false, modelExecution: false,
      humanPresence: false, approval: false, grant: false, execution: false, rawMeta: false, rawSql: false, metaWrite: false });
  });

  it("rejects workspace, time, authority, provider/model/prompt, and tool injection", async () => {
    const h = harness();
    const value = claims();
    const bound = descriptor(value);
    for (const input of [
      { claims: value, descriptor: bound, workspaceId: workspaceB },
      { claims: value, descriptor: bound, at: h.now() },
      { claims: value, descriptor: bound, authority: { applicationWrite: true } },
    ]) await expect(h.service.register(input as never)).rejects.toMatchObject({ code: "invalid_input" });
    for (const injected of [
      { ...bound, provider: "provider" }, { ...bound, model: "model" }, { ...bound, prompt: "instructions" },
      { ...bound, allowedTools: [...bound.allowedTools, "execute_action"] },
    ]) await expect(h.service.register({ claims: value, descriptor: injected as never }))
      .rejects.toMatchObject({ code: "invalid_input" });
    await expect(h.service.register({ claims: { ...value, scopes: ["decision_room:read"] } as never,
      descriptor: bound })).rejects.toMatchObject({ code: "invalid_input" });
    const foreignDescriptor = descriptor({ ...value, workspaceRef: "workspace_foreign" });
    await expect(h.service.register({ claims: value, descriptor: foreignDescriptor })).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("uses only the server clock for monotonic heartbeat and never extends capability expiry", async () => {
    const h = harness();
    const value = claims();
    await register(h, value);
    h.setNow(h.now() + 20);
    const heartbeat = await h.service.heartbeat({ claims: value, descriptor: descriptor(value) });
    expect(heartbeat.session.lastSeenAt).toBe("2027-01-15T08:00:20.000Z");
    expect(heartbeat.session.expiresAt).toBe("2027-01-15T08:05:00.000Z");
    h.setNow(h.now() - 10);
    await expect(h.service.heartbeat({ claims: value, descriptor: descriptor(value) }))
      .rejects.toMatchObject({ code: "clock_regression" });
    await expect(h.service.heartbeat({ claims: value, descriptor: descriptor(value), at: h.now() } as never))
      .rejects.toMatchObject({ code: "invalid_input" });
    h.setNow(value.expiresAt);
    await expect(h.service.heartbeat({ claims: value, descriptor: descriptor(value) }))
      .rejects.toMatchObject({ code: "session_expired" });
  });

  it("creates a bounded ref-only handoff for an active session and caps it at session expiry", async () => {
    const h = harness();
    const creator = claims();
    const target = claims({ sessionRef: sessionB, expiresAt: h.now() + 40 });
    await register(h, creator); await register(h, target);
    const result = await h.service.createHandoff({ claims: creator, descriptor: descriptor(creator),
      targetSessionRef: sessionB, context: context("existing_post_promotion"), ttlSeconds: 120 });
    expect(result.handoff).toEqual({ handoffRef, targetSessionRef: sessionB,
      context: context("existing_post_promotion"), createdAt: "2027-01-15T08:00:00.000Z",
      expiresAt: "2027-01-15T08:00:40.000Z" });
    expect(JSON.stringify(result)).not.toMatch(new RegExp(`${workspaceA}|${userA}|${userB}`));
    await expect(h.service.createHandoff({ claims: creator, descriptor: descriptor(creator), targetSessionRef: sessionB,
      context: { ...context(), entityRef: "raw_payload_private" }, ttlSeconds: 30 })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(h.service.createHandoff({ claims: creator, descriptor: descriptor(creator), targetSessionRef: sessionB,
      context: context(), ttlSeconds: 121 })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(h.service.createHandoff({ claims: creator, descriptor: descriptor(creator), targetSessionRef: sessionB,
      context: context(), ttlSeconds: 30, createdAt: h.now() } as never)).rejects.toMatchObject({ code: "invalid_input" });
    const readOnlyTarget = claims({ sessionRef: sessionC });
    await h.service.register({ claims: readOnlyTarget, descriptor: createLocalAgentSessionDescriptor({
      clientRef: "client_local", sessionRef: sessionC, transport: "deterministic_fixture",
      workspaceRef: readOnlyTarget.workspaceRef, sessionScopes: readOnlyTarget.scopes,
      allowedTools: ["decision_room_list"],
    }) });
    await expect(h.service.createHandoff({ claims: creator, descriptor: descriptor(creator), targetSessionRef: sessionC,
      context: context("existing_post_promotion"), ttlSeconds: 30 })).rejects.toMatchObject({ code: "handoff_scope_rejected" });
    const otherUser = claims({ sessionRef: "session_11111111111111111111111111111111", userId: userB });
    await register(h, otherUser);
    await expect(h.service.createHandoff({ claims: creator, descriptor: descriptor(creator),
      targetSessionRef: otherUser.sessionRef, context: context(), ttlSeconds: 30 }))
      .rejects.toMatchObject({ code: "handoff_scope_rejected" });
  });

  it("consumes once and rejects replay, wrong session, foreign workspace, and expiry", async () => {
    const h = harness();
    const creator = claims();
    const target = claims({ sessionRef: sessionB });
    const foreign = claims({ workspaceId: workspaceB, workspaceRef: "workspace_beta", sessionRef: sessionC, userId: userB });
    await register(h, creator); await register(h, target); await register(h, foreign);
    await h.service.createHandoff({ claims: creator, descriptor: descriptor(creator), targetSessionRef: sessionB,
      context: context(), ttlSeconds: 15 });
    await expect(h.service.consumeHandoff({ claims: creator, descriptor: descriptor(creator), handoffRef }))
      .rejects.toMatchObject({ code: "handoff_scope_rejected" });
    await expect(h.service.consumeHandoff({ claims: foreign, descriptor: descriptor(foreign), handoffRef }))
      .rejects.toMatchObject({ code: "handoff_scope_rejected" });
    await expect(h.service.consumeHandoff({ claims: target, descriptor: descriptor(target), handoffRef }))
      .resolves.toMatchObject({ handoff: { handoffRef, targetSessionRef: sessionB } });
    await expect(h.service.consumeHandoff({ claims: target, descriptor: descriptor(target), handoffRef }))
      .rejects.toMatchObject({ code: "handoff_consumed" });

    const second = "handoff_11111111111111111111111111111111";
    const expiryService = new LocalAgentSessionLifecycleService(h.store, () => new Date(h.now() * 1000), () => second);
    await expiryService.createHandoff({ claims: creator, descriptor: descriptor(creator), targetSessionRef: sessionB,
      context: context(), ttlSeconds: 15 });
    h.setNow(h.now() + 15);
    await expect(expiryService.consumeHandoff({ claims: target, descriptor: descriptor(target), handoffRef: second }))
      .rejects.toMatchObject({ code: "handoff_expired" });
  });

  it("allows exactly one winner when the same handoff is consumed concurrently", async () => {
    const h = harness();
    const creator = claims();
    const target = claims({ sessionRef: sessionB });
    await register(h, creator); await register(h, target);
    await h.service.createHandoff({ claims: creator, descriptor: descriptor(creator), targetSessionRef: sessionB,
      context: context(), ttlSeconds: 30 });
    const attempts = await Promise.allSettled([
      h.service.consumeHandoff({ claims: target, descriptor: descriptor(target), handoffRef }),
      h.service.consumeHandoff({ claims: target, descriptor: descriptor(target), handoffRef }),
    ]);
    expect(attempts.filter((item) => item.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((item) => item.status === "rejected")).toHaveLength(1);
    expect(attempts.find((item) => item.status === "rejected")).toMatchObject({ reason: { code: "handoff_consumed" } });
  });
});
