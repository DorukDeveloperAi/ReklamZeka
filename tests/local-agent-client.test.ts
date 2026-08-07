import { describe, expect, it, vi } from "vitest";
import {
  DeterministicLocalAgentFixtureClient,
  InMemoryLocalAgentCorrelationRegistry,
  LOCAL_AGENT_SAFE_TOOLS,
  createLocalAgentSessionDescriptor,
} from "@/application/local-agent-client";

const sessionRefA = "session_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const sessionRefB = "session_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const correlationRef = "correlation_cccccccccccccccccccccccccccccccc";

function descriptor(sessionRef = sessionRefA) {
  return createLocalAgentSessionDescriptor({
    clientRef: "client_fixture",
    sessionRef,
    transport: "deterministic_fixture",
    workspaceRef: "workspace_alpha",
    sessionScopes: ["decision_room:read", "policy_bundle:read"],
    allowedTools: ["decision_room_list", "policy_bundle_read"],
  });
}

function executors() {
  return {
    decision_room_list: { execute: vi.fn(async (call) => ({
      contractVersion: "decision-room-agent-tools/1.0.0",
      observedCall: call,
      authority: { metaWrite: false, actionExecution: false },
    })) },
    policy_bundle_read: { execute: vi.fn(async (call) => ({
      contractVersion: "policy-bundle-agent-tools/1.0.0",
      observedCall: call,
      authority: { canApprove: false, canGrant: false, canExecute: false, canWriteMeta: false },
    })) },
  };
}

describe("vendor-agnostic local agent client/session contract", () => {
  it("publishes one safe catalog without model, provider, human-presence, raw-data, or execution tools", () => {
    const names = LOCAL_AGENT_SAFE_TOOLS.map((tool) => tool.name);
    expect(names).toEqual([
      "decision_room_list", "decision_room_mark_inbox_read", "approval_queue_list", "approval_queue_get",
      "policy_bundle_read",
      "budget_lab_list", "budget_lab_get", "budget_lab_dry_run", "budget_lab_save_draft",
      "practice_lab_list", "practice_lab_get", "practice_lab_prepare_draft",
      "existing_post_promotion_preflight",
    ]);
    expect(new Set(names).size).toBe(names.length);
    expect(names.join("|")).not.toMatch(/(^|_)(approve|grant|execute|human_presence|raw_meta|raw_sql|write_meta)(_|$)/i);
    expect(JSON.stringify(LOCAL_AGENT_SAFE_TOOLS)).not.toMatch(/OPENAI_API_KEY|ANTHROPIC_API_KEY|api\.openai\.com|api\.anthropic\.com/i);
  });

  it("creates a strict vendor-neutral descriptor with all dangerous authority closed", () => {
    expect(descriptor()).toEqual({
      contractVersion: "local-agent-client/1.0.0",
      clientRef: "client_fixture",
      sessionRef: sessionRefA,
      transport: "deterministic_fixture",
      workspaceRef: "workspace_alpha",
      toolCatalogVersion: "local-agent-tools/1.0.0",
      allowedTools: ["decision_room_list", "policy_bundle_read"],
      authority: {
        modelExecution: false, humanPresence: false, approval: false, grant: false,
        execution: false, rawMeta: false, rawSql: false, metaWrite: false,
      },
    });
  });

  it("orchestrates deterministic tool calls in order and preserves one session correlation", async () => {
    const tools = executors();
    const client = new DeterministicLocalAgentFixtureClient(descriptor(), tools);
    const result = await client.run({
      sessionRef: sessionRefA,
      correlationRef,
      calls: [
        { callRef: "call_1111111111111111", name: "decision_room_list", arguments: { view: "runs" } },
        { callRef: "call_2222222222222222", name: "policy_bundle_read", arguments: {} },
      ],
    });
    expect(result).toMatchObject({
      clientRef: "client_fixture", sessionRef: sessionRefA, correlationRef,
      results: [
        { callRef: "call_1111111111111111", name: "decision_room_list" },
        { callRef: "call_2222222222222222", name: "policy_bundle_read" },
      ],
      authority: { modelExecution: false, humanPresence: false, approval: false, grant: false,
        execution: false, rawMeta: false, rawSql: false, metaWrite: false },
    });
    expect(tools.decision_room_list.execute).toHaveBeenCalledWith({ name: "decision_room_list", arguments: { view: "runs" } });
    expect(tools.policy_bundle_read.execute).toHaveBeenCalledWith({ name: "policy_bundle_read", arguments: {} });
    expect(tools.decision_room_list.execute.mock.invocationCallOrder[0])
      .toBeLessThan(tools.policy_bundle_read.execute.mock.invocationCallOrder[0]!);
  });

  it("rejects descriptor capability, provider/model/prompt, and unknown-tool injection", async () => {
    for (const injected of [
      { ...descriptor(), allowedTools: ["decision_room_list", "approve_action"] },
      { clientRef: "client_fixture", sessionRef: sessionRefA, transport: "deterministic_fixture",
        workspaceRef: "workspace_alpha", sessionScopes: ["decision_room:read"], allowedTools: ["decision_room_list"], model: "vendor-model" },
      { clientRef: "client_fixture", sessionRef: sessionRefA, transport: "deterministic_fixture",
        workspaceRef: "workspace_alpha", sessionScopes: ["decision_room:read"], allowedTools: ["decision_room_list"], prompt: "do work" },
      { clientRef: "client_fixture", sessionRef: sessionRefA, transport: "deterministic_fixture",
        workspaceRef: "workspace_alpha", sessionScopes: ["decision_room:read"], allowedTools: ["decision_room_list"], canExecute: true },
      { clientRef: "client_fixture", sessionRef: sessionRefA, transport: "deterministic_fixture",
        workspaceRef: "workspace_alpha", sessionScopes: ["policy_bundle:read"], allowedTools: ["decision_room_list"] },
      { clientRef: "client_fixture", sessionRef: sessionRefA, transport: "deterministic_fixture",
        workspaceRef: "workspace_alpha", sessionScopes: ["decision_room:read", "execute:anything"],
        allowedTools: ["decision_room_list"] },
    ]) expect(() => createLocalAgentSessionDescriptor(injected as never)).toThrowError(expect.objectContaining({ code: "invalid_descriptor" }));

    const client = new DeterministicLocalAgentFixtureClient(descriptor(), executors());
    await expect(client.run({ sessionRef: sessionRefA, correlationRef, calls: [{
      callRef: "call_1111111111111111", name: "execute_action", arguments: {},
    }] } as never)).rejects.toMatchObject({ code: "invalid_run" });
    await expect(client.run({ sessionRef: sessionRefA, correlationRef, calls: [{
      callRef: "call_1111111111111111", name: "decision_room_list", arguments: {}, canApprove: true,
    }] } as never)).rejects.toMatchObject({ code: "invalid_run" });
  });

  it("rejects missing/injected executors and unsafe authority or raw material in results", async () => {
    expect(() => new DeterministicLocalAgentFixtureClient(descriptor(), {
      decision_room_list: executors().decision_room_list,
    })).toThrowError(expect.objectContaining({ code: "invalid_descriptor" }));
    expect(() => new DeterministicLocalAgentFixtureClient(descriptor(), {
      ...executors(), execute_action: { execute: vi.fn() },
    } as never)).toThrowError(expect.objectContaining({ code: "invalid_descriptor" }));

    for (const unsafe of [
      { authority: { canExecute: true } },
      { authority: { canReject: true } },
      { humanPresenceGrant: "forged" },
      { nested: { rawSql: "select * from private" } },
      new Date("2026-08-08T12:00:00.000Z"),
    ]) {
      const client = new DeterministicLocalAgentFixtureClient(createLocalAgentSessionDescriptor({
        clientRef: "client_fixture", sessionRef: sessionRefA, transport: "deterministic_fixture",
        workspaceRef: "workspace_alpha", sessionScopes: ["decision_room:read"], allowedTools: ["decision_room_list"],
      }), { decision_room_list: { execute: vi.fn(async () => unsafe) } });
      await expect(client.run({ sessionRef: sessionRefA, correlationRef, calls: [{
        callRef: "call_1111111111111111", name: "decision_room_list", arguments: {},
      }] })).rejects.toMatchObject({ code: "unsafe_tool_result" });
    }
  });

  it("binds correlations to one session and rejects replay or cross-session reuse", async () => {
    const correlations = new InMemoryLocalAgentCorrelationRegistry();
    const clientA = new DeterministicLocalAgentFixtureClient(descriptor(sessionRefA), executors(), correlations);
    const clientB = new DeterministicLocalAgentFixtureClient(descriptor(sessionRefB), executors(), correlations);
    const run = (client: DeterministicLocalAgentFixtureClient, sessionRef: string) => client.run({
      sessionRef, correlationRef, calls: [{ callRef: "call_1111111111111111", name: "decision_room_list", arguments: {} }],
    });
    await expect(run(clientA, sessionRefA)).resolves.toMatchObject({ sessionRef: sessionRefA, correlationRef });
    await expect(run(clientA, sessionRefA)).rejects.toMatchObject({ code: "correlation_reused" });
    await expect(run(clientB, sessionRefB)).rejects.toMatchObject({ code: "cross_session_correlation" });
    await expect(run(clientB, sessionRefA)).rejects.toMatchObject({ code: "invalid_run" });
  });
});
