import { describe, expect, it, vi } from "vitest";
import { createOrchestratorConversationHttpHandlers } from "@/server/orchestrator-conversation-http";
import type { LocalDecisionRoomConfig } from "@/server/local-decision-room-runtime";

const origin = "http://localhost:3000";
const workspaceId = "11111111-1111-4111-a111-111111111111";
const userId = "22222222-2222-4222-a222-222222222222";
const config = { origin } as LocalDecisionRoomConfig;

function request(method: "GET" | "POST", intent: string, body?: unknown,
  overrides: Record<string, string> = {}) {
  const serialized = body === undefined ? undefined : JSON.stringify(body);
  return new Request(`${origin}/api/orchestrator-conversation`, { method, headers: {
    Host: "localhost:3000", "X-ReklamZeka-Intent": intent, Cookie: "__Host-rzka_local_session=opaque",
    ...(method === "POST" ? { Origin: origin, "Sec-Fetch-Site": "same-origin",
      "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(serialized!)) } : {}),
    ...overrides,
  }, body: serialized });
}

describe("Orchestrator conversation HTTP boundary", () => {
  it("binds read/send to the trusted cookie identity and exact three-field body", async () => {
    const current = vi.fn(async () => ({ contractVersion: "orchestrator-conversation/1.0.0", conversation: null }));
    const send = vi.fn(async () => ({ contractVersion: "orchestrator-conversation/1.0.0",
      conversation: { conversationRef: "conversation_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", messages: [] } }));
    const resolveIdentity = vi.fn(async () => ({ claims: { workspaceId, userId } }));
    const handlers = createOrchestratorConversationHttpHandlers({ service: { current, send } as never,
      config, resolveIdentity });
    expect((await handlers.GET(request("GET", "orchestrator-conversation-read"))).status).toBe(200);
    const response = await handlers.POST(request("POST", "orchestrator-conversation-send",
      { conversationRef: null, pageId: "budgets", message: "Bütçe kuralı öner" }));
    expect(response.status).toBe(201);
    expect(send).toHaveBeenCalledWith({ workspaceId, userId, conversationRef: null,
      pageId: "budgets", message: "Bütçe kuralı öner" });
    expect(resolveIdentity).toHaveBeenCalledTimes(2);
  });

  it("rejects cross-origin, wrong intent, extended bodies and oversized input before identity/model work", async () => {
    const send = vi.fn();
    const resolveIdentity = vi.fn();
    const handlers = createOrchestratorConversationHttpHandlers({ service: { current: vi.fn(), send } as never,
      config, resolveIdentity });
    const invalid = [
      request("POST", "wrong", { conversationRef: null, pageId: "rules", message: "x" }),
      request("POST", "orchestrator-conversation-send", { conversationRef: null, pageId: "rules", message: "x" },
        { Origin: "http://evil.example" }),
      request("POST", "orchestrator-conversation-send",
        { conversationRef: null, pageId: "rules", message: "x", approval: true }),
      request("POST", "orchestrator-conversation-send",
        { conversationRef: null, pageId: "rules", message: "x".repeat(13_600) }),
    ];
    for (const candidate of invalid) expect((await handlers.POST(candidate)).status).toBe(400);
    expect(resolveIdentity).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("returns only a completed response and exposes no incremental pseudo-stream", async () => {
    let release!: () => void;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const send = vi.fn(async () => { await pending; return { contractVersion: "orchestrator-conversation/1.0.0",
      conversation: { conversationRef: "conversation_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", messages: [] } }; });
    const handlers = createOrchestratorConversationHttpHandlers({ service: { current: vi.fn(), send } as never,
      config, resolveIdentity: async () => ({ claims: { workspaceId, userId } }) });
    let settled = false;
    const response = handlers.POST(request("POST", "orchestrator-conversation-send",
      { conversationRef: null, pageId: "today", message: "Durumu açıkla" })).then((value) => {
      settled = true; return value;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    expect((await response).headers.get("content-type")).toBe("application/json; charset=utf-8");
  });
});
