import { chmodSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InMemoryTransport, LATEST_PROTOCOL_VERSION, type JSONRPCMessage } from "@modelcontextprotocol/server";
import { describe, expect, it, vi } from "vitest";
import { LocalMcpHttpBridge } from "@/mcp/local-http-bridge";
import { loadPrivateLocalMcpRuntime } from "@/mcp/private-local-environment";
import { annotations, createReklamZekaMcpServer, REKLAMZEKA_MCP_TOOL_NAMES } from
  "@/mcp/reklamzeka-mcp-server";
import type { PrivateLocalMcpRuntime } from "@/mcp/private-local-environment";

const token = "rzs1.private-capability.private-signature";
const workspaceId = "11111111-1111-4111-a111-111111111111";
const userId = "22222222-2222-4222-a222-222222222222";
const origin = "http://localhost:3000";
const runtime = Object.freeze({ origin, token, claims: Object.freeze({}) }) as unknown as PrivateLocalMcpRuntime;

function envText(extra = "") {
  return [
    "REKLAMZEKA_LOCAL_SESSION_ENABLED=true",
    `REKLAMZEKA_LOCAL_ORIGIN=${origin}`,
    `REKLAMZEKA_LOCAL_WORKSPACE_ID=${workspaceId}`,
    "REKLAMZEKA_LOCAL_WORKSPACE_REF=workspace_alpha",
    `REKLAMZEKA_LOCAL_USER_ID=${userId}`,
    "REKLAMZEKA_LOCAL_READER_REF=reader_owner",
    `REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY=${Buffer.alloc(32, 7).toString("base64")}`,
    extra,
  ].join("\n");
}

describe("private local MCP environment", () => {
  it("reads a private owner file, ignores unrelated values, and mints an OS-bound in-memory session", () => {
    const directory = mkdtempSync(join(tmpdir(), "rzka-mcp-"));
    const path = join(directory, ".env.local");
    writeFileSync(path, envText("META_ACCESS_TOKEN=this-must-never-be-parsed"), { mode: 0o600 });
    const result = loadPrivateLocalMcpRuntime({ path, now: 1_800_000_000,
      osUid: typeof process.getuid === "function" ? process.getuid() : 501 });
    expect(result.origin).toBe(origin);
    expect(result.claims).toMatchObject({ kind: "session", workspaceId, userId,
      issuedAt: 1_800_000_000, expiresAt: 1_800_028_800 });
    expect(result.token).toMatch(/^rzs1\./);
    expect(JSON.stringify(result)).not.toContain("this-must-never-be-parsed");
  });

  it("rejects permissive files and symlinks", () => {
    const directory = mkdtempSync(join(tmpdir(), "rzka-mcp-"));
    const source = join(directory, "source.env");
    const link = join(directory, ".env.local");
    writeFileSync(source, envText(), { mode: 0o600 });
    symlinkSync(source, link);
    expect(() => loadPrivateLocalMcpRuntime({ path: link })).toThrowError("Private local MCP environment rejected");
    const open = join(directory, "open.env");
    writeFileSync(open, envText(), { mode: 0o600 }); chmodSync(open, 0o644);
    expect(() => loadPrivateLocalMcpRuntime({ path: open })).toThrowError("Private local MCP environment rejected");
  });
});

describe("local MCP HTTP bridge", () => {
  it("maps all 18 exact tools to the existing bearer endpoints and never returns coordination identity", async () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetcher = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
      calls.push({ url: String(input), init });
      const path = new URL(String(input)).pathname;
      const payload = path.endsWith("local-agent-sessions")
        ? init.method === "POST" ? { outcome: "inserted", session: { workspaceRef: "workspace_alpha",
          sessionRef: "session_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", expiresAt: "2027-01-15T08:05:00.000Z" } }
          : { session: { lastSeenAt: "2027-01-15T08:01:00.000Z", expiresAt: "2027-01-15T08:05:00.000Z" } }
        : path.endsWith("local-agent-handoffs") ? { handoff: { context: { intent: "analysis",
          entityRef: "campaign_public" }, expiresAt: "2027-01-15T08:02:00.000Z" } }
          : { contractVersion: "safe/1.0.0", result: {}, authority: { approval: false,
            execution: false, metaWrite: false } };
      return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const bridge = new LocalMcpHttpBridge(runtime, fetcher);
    const minimal: Record<string, Record<string, unknown>> = {
      get_handoff_context: { handoffRef: "handoff_cccccccccccccccccccccccccccccccc" },
      decision_room_list: { view: "inbox" }, decision_room_mark_inbox_read: { notificationRef: "notification_public" },
      approval_queue_get: { unitRef: "action_unit_aaaaaaaaaaaaaaaaaaaa" }, budget_lab_get: { seriesRef: "series_public" },
      budget_lab_dry_run: { command: {} }, budget_lab_save_draft: { command: {} },
      practice_lab_get: { practiceRef: "practice_public" }, practice_lab_prepare_draft: { practiceRef: "practice_public" },
      guidance_registry_list: { status: "published" },
      guidance_effective_preview: { accountRef: "account_public", accountGroupRefs: [], objective: null,
        funnel: null, optimization: null, internalCategoryRefs: ["category_public"], lifecycle: null,
        promotionTemplateRefs: [],
        entity: { type: "campaign", ref: "campaign_public" }, topics: ["budget"], requiredTopics: [],
        evaluatedAt: "2027-01-15T08:00:00.000Z", timeframe: { ref: "timeframe_public", kind: "rolling" },
        budget: { maxCards: 10, maxSources: 10, maxCharacters: 20_000 } },
      existing_post_promotion_preflight: { accountRef: "account_public" },
    };
    const outputs = [];
    for (const name of REKLAMZEKA_MCP_TOOL_NAMES) outputs.push(await bridge.execute(name, minimal[name] ?? {}));
    expect(calls).toHaveLength(18);
    expect(calls.every((call) => new Headers(call.init.headers).get("authorization") === `Bearer ${token}`)).toBe(true);
    expect(calls.map((call) => new URL(call.url).pathname)).toEqual(expect.arrayContaining([
      "/api/local-agent-sessions", "/api/local-agent-handoffs", "/api/decision-room", "/api/approval-queue",
      "/api/policy-bundles", "/api/budget-lab", "/api/practice-lab", "/api/existing-post-promotion-preflight",
      "/api/guidance-context",
    ]));
    const guidanceList = calls.find((call) => new URL(call.url).searchParams.get("view") === "list"
      && new URL(call.url).pathname === "/api/guidance-context");
    expect(guidanceList).toBeDefined();
    expect(new URL(guidanceList!.url).searchParams.get("status")).toBe("published");
    expect(new Headers(guidanceList!.init.headers).get("x-reklamzeka-intent")).toBe("guidance-registry-list");
    const guidancePreview = calls.find((call) => new URL(call.url).pathname === "/api/guidance-context"
      && call.init.method === "POST");
    expect(new Headers(guidancePreview!.init.headers).get("x-reklamzeka-intent")).toBe("guidance-effective-preview");
    expect(JSON.parse(String(guidancePreview!.init.body))).toEqual({ context: minimal.guidance_effective_preview });
    expect(outputs[0]).toEqual({ status: "registered", outcome: "inserted", expiresAt: "2027-01-15T08:05:00.000Z" });
    expect(JSON.stringify(outputs.slice(0, 3))).not.toMatch(/workspace_alpha|session_[a-f0-9]+|rzs1\./);
  });

  it("fails closed on a rejected local endpoint and unsafe UUID output", async () => {
    const rejected = new LocalMcpHttpBridge(runtime, async () => new Response(JSON.stringify({ error: {
      code: "source_not_configured" } }), { status: 503 }));
    await expect(rejected.execute("policy_bundle_read", {})).rejects.toMatchObject({ code: "local_api_rejected" });
    const unsafe = new LocalMcpHttpBridge(runtime, async () => new Response(JSON.stringify({ result: { workspaceId } }), { status: 200 }));
    await expect(unsafe.execute("decision_room_list", { view: "runs" })).rejects.toMatchObject({ code: "unsafe_response" });
  });
});

async function receive(transport: InMemoryTransport, predicate: (message: JSONRPCMessage) => boolean): Promise<JSONRPCMessage> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("protocol timeout")), 2_000);
    transport.onmessage = (message) => { if (predicate(message)) { clearTimeout(timeout); resolve(message); } };
  });
}

describe("MCP v2 protocol conformance", () => {
  it("negotiates, exposes exactly 18 strict tools, preserves annotations, and dispatches a call", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ outcome: "inserted",
      session: { expiresAt: "2027-01-15T08:05:00.000Z" } }), { status: 200 }));
    const server = createReklamZekaMcpServer({ runtime, bridge: new LocalMcpHttpBridge(runtime, fetcher) });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await clientTransport.start(); await server.connect(serverTransport);
    const initialized = receive(clientTransport, (message) => "id" in message && message.id === 1);
    await clientTransport.send({ jsonrpc: "2.0", id: 1, method: "initialize", params: {
      protocolVersion: LATEST_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "test", version: "1.0.0" },
    } });
    expect(await initialized).toMatchObject({ result: { serverInfo: { name: "reklamzeka-local" } } });
    await clientTransport.send({ jsonrpc: "2.0", method: "notifications/initialized" });
    const listed = receive(clientTransport, (message) => "id" in message && message.id === 2);
    await clientTransport.send({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const listMessage = await listed as unknown as { result: { tools: { name: string; inputSchema: Record<string, unknown>;
      annotations: Record<string, unknown>; _meta?: Record<string, unknown> }[] } };
    expect(listMessage.result.tools.map((tool) => tool.name)).toEqual(REKLAMZEKA_MCP_TOOL_NAMES);
    expect(listMessage.result.tools).toHaveLength(18);
    expect(listMessage.result.tools.every((tool) => tool.inputSchema.additionalProperties === false)).toBe(true);
    expect(listMessage.result.tools.find((tool) => tool.name === "get_handoff_context")?.annotations)
      .toMatchObject({ readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false });
    expect(annotations("budget_lab_save_draft")).toMatchObject({ readOnlyHint: false, destructiveHint: false, idempotentHint: true });
    expect(annotations("guidance_registry_list")).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true });
    expect(annotations("guidance_effective_preview")).toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true });
    expect(listMessage.result.tools.filter((tool) => tool._meta?.["anthropic/requiresUserInteraction"] === true)
      .map((tool) => tool.name)).toEqual(["decision_room_mark_inbox_read", "budget_lab_save_draft"]);
    const called = receive(clientTransport, (message) => "id" in message && message.id === 3);
    await clientTransport.send({ jsonrpc: "2.0", id: 3, method: "tools/call", params: {
      name: "register_agent_session", arguments: {},
    } });
    expect(await called).toMatchObject({ result: { structuredContent: { status: "registered" } } });
    const wire = JSON.stringify(await called);
    expect(wire).not.toMatch(/rzs1\.|11111111-1111|22222222-2222|workspace_alpha|localhost:3000/);
    await clientTransport.close(); await server.close();
  });

  it("keeps the project Codex config secret-free and allowlists the exact server catalog", () => {
    const config = readFileSync(new URL("../.codex/config.toml", import.meta.url), "utf8");
    const enabledBlock = /enabled_tools\s*=\s*\[([\s\S]*?)\]/.exec(config)?.[1] ?? "";
    const configured = [...enabledBlock.matchAll(/"([a-z0-9_]+)"/g)].map((match) => match[1]);
    expect(configured).toEqual(REKLAMZEKA_MCP_TOOL_NAMES);
    expect(config).toContain('default_tools_approval_mode = "writes"');
    expect(config).not.toMatch(/META_ACCESS_TOKEN|DATABASE_URL|SIGNING_KEY|env_vars|\[mcp_servers\.reklamzeka\.env\]/);
    for (const name of ["register_agent_session", "heartbeat_agent_session", "get_handoff_context"]) {
      expect(config).toContain(`[mcp_servers.reklamzeka.tools.${name}]\napproval_mode = "auto"`);
    }
  });

  it("keeps Claude project config secret-free and auto-allows only coordination/read tools", () => {
    const config = JSON.parse(readFileSync(new URL("../.mcp.json", import.meta.url), "utf8")) as {
      mcpServers: { reklamzeka: { type: string; command: string; args: string[]; timeout: number } };
    };
    expect(config.mcpServers.reklamzeka).toEqual({
      type: "stdio", command: "node",
      args: ["--import", "tsx", "${CLAUDE_PROJECT_DIR:-.}/scripts/reklamzeka-mcp.ts"], timeout: 60_000,
    });
    const settings = JSON.parse(readFileSync(new URL("../.claude/settings.json", import.meta.url), "utf8")) as {
      permissions: { allow: string[] };
    };
    const allowed = settings.permissions.allow.map((name) => name.replace("mcp__reklamzeka__", ""));
    expect(allowed).toEqual(REKLAMZEKA_MCP_TOOL_NAMES.filter((name) =>
      !["decision_room_mark_inbox_read", "budget_lab_save_draft"].includes(name)));
    expect(JSON.stringify({ config, settings })).not.toMatch(/META_ACCESS_TOKEN|DATABASE_URL|SIGNING_KEY|rzs1\./);
  });
});
