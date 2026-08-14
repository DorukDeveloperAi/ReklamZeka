import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import {
  OrchestratorAdapterError,
  OrchestratorConversationService,
  orchestratorPageGuide,
  type OrchestratorConversationRepository,
  type OrchestratorConversationSnapshot,
} from "@/application/orchestrator-conversation";
import { LocalCodexExecAdapter, localCodexExecConfig, normalizeCodexJsonl } from
  "@/server/local-codex-exec-adapter";

const workspaceId = "11111111-1111-4111-a111-111111111111";
const userId = "22222222-2222-4222-a222-222222222222";
const threadRef = "33333333-3333-4333-a333-333333333333";

function memoryRepository() {
  let snapshot: OrchestratorConversationSnapshot | null = null;
  const appendTurn = vi.fn(async (input: Parameters<OrchestratorConversationRepository["appendTurn"]>[0]) => {
    const before = snapshot!;
    const first = before.messages.length + 1;
    const messages = [...before.messages, { messageRef: input.userMessageRef, turnRef: input.turnRef,
      messageNumber: first, role: "user" as const, content: input.userContent, createdAt: input.createdAt }];
    if (input.assistantMessageRef && input.assistantContent) messages.push({ messageRef: input.assistantMessageRef,
      turnRef: input.turnRef, messageNumber: first + 1, role: "assistant", content: input.assistantContent,
      createdAt: input.createdAt });
    snapshot = Object.freeze({ ...before, pageGuide: input.pageGuide,
      providerThreadRef: input.providerThreadRef ?? before.providerThreadRef, messages: Object.freeze(messages) });
    return snapshot;
  });
  const repository: OrchestratorConversationRepository = {
    current: vi.fn(async () => snapshot),
    create: vi.fn(async (input) => {
      snapshot ??= Object.freeze({ conversationRef: input.conversationRef, createdAt: input.createdAt,
        pageGuide: null, providerThreadRef: null, messages: Object.freeze([]) });
      return snapshot;
    }),
    find: vi.fn(async (input) => snapshot?.conversationRef === input.conversationRef ? snapshot : null),
    appendTurn,
  };
  return { repository, appendTurn, snapshot: () => snapshot };
}

describe("persistent Orchestrator conversation", () => {
  it("keeps one vendor-neutral conversation while each turn freezes its source page guide", async () => {
    const source = memoryRepository();
    const execute = vi.fn(async (input: { providerThreadRef: string | null }) => ({ providerThreadRef: threadRef,
      finalResponse: input.providerThreadRef ? "Bütçe kuralı taslağı" : "İlk analiz" }));
    let refCounter = 0;
    const service = new OrchestratorConversationService(source.repository, { execute },
      () => new Date("2026-08-13T09:00:00.000Z"), (kind) => `${kind}_${(++refCounter).toString(16).padStart(32, "0")}`);
    const first = await service.send({ workspaceId, userId, conversationRef: null,
      pageId: "analysis", message: "Düşüşü açıkla" });
    const second = await service.send({ workspaceId, userId,
      conversationRef: first.conversation.conversationRef, pageId: "budgets", message: "Taslak kural öner" });
    expect(first.conversation.conversationRef).toBe(second.conversation.conversationRef);
    expect(second.conversation.messages.map((message) => message.content))
      .toEqual(["Düşüşü açıkla", "İlk analiz", "Taslak kural öner", "Bütçe kuralı taslağı"]);
    expect(execute).toHaveBeenNthCalledWith(1, expect.objectContaining({ providerThreadRef: null }));
    expect(execute).toHaveBeenNthCalledWith(2, expect.objectContaining({ providerThreadRef: threadRef }));
    expect(source.appendTurn.mock.calls[1]![0].pageGuide).toEqual(orchestratorPageGuide("budgets"));
    expect(source.appendTurn.mock.calls[1]![0].pageGuide.recordPath).toContain("budget proposal");
  });

  it("accepts the consolidated Settings source guide without widening authority", () => {
    expect(orchestratorPageGuide("settings")).toMatchObject({
      pageId: "settings",
      pageLabel: "Ayarlar",
      recordPath: "Meta readiness / category registry / promotion template lifecycle",
    });
  });

  it("rejects secret material and records adapter failures without inventing an assistant response", async () => {
    const source = memoryRepository();
    const service = new OrchestratorConversationService(source.repository, {
      execute: async () => { throw new OrchestratorAdapterError("adapter_timeout"); },
    });
    await expect(service.send({ workspaceId, userId, conversationRef: null, pageId: "rules",
      message: "access_token=abcdefghijklmnopqrstuvwxyz0123456789" })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(service.send({ workspaceId, userId, conversationRef: null, pageId: "rules",
      message: "Bir kural taslağı hazırla" })).rejects.toMatchObject({ code: "adapter_timeout" });
    expect(source.appendTurn).toHaveBeenCalledWith(expect.objectContaining({ outcome: "failed",
      failureCode: "adapter_timeout", assistantContent: null, providerThreadRef: null }));
  });

  it("never reclassifies a ledger failure as a model failure or retries the same turn", async () => {
    const source = memoryRepository();
    const appendTurn = vi.fn(async () => { throw new Error("database_failed"); });
    const repository = { ...source.repository, appendTurn };
    const service = new OrchestratorConversationService(repository, { execute: async () => ({
      providerThreadRef: threadRef, finalResponse: "Yanıt",
    }) });
    await expect(service.send({ workspaceId, userId, conversationRef: null, pageId: "today",
      message: "Durumu açıkla" })).rejects.toThrow("database_failed");
    expect(appendTurn).toHaveBeenCalledTimes(1);
  });
});

describe("safe local Codex exec adapter", () => {
  it("normalizes only the final agent message and preserves the exact thread id", () => {
    const output = [
      JSON.stringify({ type: "thread.started", thread_id: threadRef }),
      JSON.stringify({ type: "item.completed", item: { type: "command_execution", command: "secret", output: "ignored" } }),
      JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Ara cevap" } }),
      JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Nihai cevap" } }),
    ].join("\n");
    expect(normalizeCodexJsonl(output, null)).toEqual({ providerThreadRef: threadRef, finalResponse: "Nihai cevap" });
    expect(() => normalizeCodexJsonl(output, "44444444-4444-4444-a444-444444444444"))
      .toThrowError(OrchestratorAdapterError);
  });

  it("uses a fixed executable/cwd, shell=false, read-only sandbox and an allowlisted environment", async () => {
    const calls: unknown[][] = [];
    const fakeSpawn = ((executable: string, args: readonly string[], options: unknown) => {
      calls.push([executable, args, options]);
      const child = new EventEmitter() as EventEmitter & { stdin: PassThrough; stdout: PassThrough;
        stderr: PassThrough; kill: ReturnType<typeof vi.fn> };
      child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
      child.kill = vi.fn();
      queueMicrotask(() => {
        child.stdout.write(`${JSON.stringify({ type: "thread.started", thread_id: threadRef })}\n`);
        child.stdout.write(`${JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Güvenli cevap" } })}\n`);
        child.emit("close", 0, null);
      });
      return child;
    }) as never;
    const config = localCodexExecConfig({ REKLAMZEKA_ORCHESTRATOR_CODEX_ENABLED: "true",
      REKLAMZEKA_CODEX_EXECUTABLE: "/bin/echo", REKLAMZEKA_CODEX_WORKSPACE_ROOT: "/tmp",
      HOME: "/safe-home", DATABASE_URL: "must-not-leak", META_ACCESS_TOKEN: "must-not-leak" }, "/ignored")!;
    expect(config.environment).toEqual({ HOME: "/safe-home" });
    await expect(new LocalCodexExecAdapter(config, fakeSpawn).execute({ providerThreadRef: null,
      prompt: "Salt okunur analiz" })).resolves.toEqual({ providerThreadRef: threadRef, finalResponse: "Güvenli cevap" });
    expect(calls[0]![0]).toBe("/bin/echo");
    expect(calls[0]![1]).toEqual(expect.arrayContaining(["exec", "--json", "--sandbox", "read-only", "--cd", "/tmp", "-"]));
    expect(calls[0]![2]).toMatchObject({ cwd: "/tmp", shell: false, env: { HOME: "/safe-home" } });
  });
});
