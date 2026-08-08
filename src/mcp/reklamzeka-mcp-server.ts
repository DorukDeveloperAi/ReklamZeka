import { McpServer, type ToolAnnotations } from "@modelcontextprotocol/server";
import { LOCAL_AGENT_SAFE_TOOLS } from "@/application/local-agent-client";
import { LocalMcpHttpBridge, LocalMcpHttpBridgeError } from "@/mcp/local-http-bridge";
import type { PrivateLocalMcpRuntime } from "@/mcp/private-local-environment";
import { MCP_TOOL_SCHEMAS, type ReklamZekaMcpToolName } from "@/mcp/tool-schemas";

export const REKLAMZEKA_MCP_VERSION = "reklamzeka-local-mcp/1.0.0" as const;
export const COORDINATION_TOOL_NAMES = Object.freeze([
  "register_agent_session", "heartbeat_agent_session", "get_handoff_context",
] as const);
export const REKLAMZEKA_MCP_TOOL_NAMES = Object.freeze(Object.keys(MCP_TOOL_SCHEMAS) as ReklamZekaMcpToolName[]);

const SAFE_NAMES = LOCAL_AGENT_SAFE_TOOLS.map((tool) => tool.name);
const EXPECTED = [...COORDINATION_TOOL_NAMES, ...SAFE_NAMES];
if (REKLAMZEKA_MCP_TOOL_NAMES.length !== 18
  || JSON.stringify(REKLAMZEKA_MCP_TOOL_NAMES) !== JSON.stringify(EXPECTED)
  || new Set(REKLAMZEKA_MCP_TOOL_NAMES).size !== REKLAMZEKA_MCP_TOOL_NAMES.length) {
  throw new Error("ReklamZeka MCP catalog rejected");
}

const DESCRIPTIONS = new Map<string, string>([
  ["register_agent_session", "Register this OS-UID-bound local MCP session for coordination only."],
  ["heartbeat_agent_session", "Refresh the last-seen time of this local MCP coordination session without extending expiry."],
  ["get_handoff_context", "Consume one short-lived ref-only Dashboard handoff addressed to this registered session."],
  ...LOCAL_AGENT_SAFE_TOOLS.map((tool) => [tool.name, tool.description] as const),
]);
const READ_ONLY = new Set<ReklamZekaMcpToolName>([
  "decision_room_list", "approval_queue_list", "approval_queue_get", "policy_bundle_read",
  "budget_lab_list", "budget_lab_get", "budget_lab_dry_run", "practice_lab_list",
  "practice_lab_get", "practice_lab_prepare_draft", "guidance_registry_list", "guidance_effective_preview",
  "existing_post_promotion_preflight",
]);
const IDEMPOTENT = new Set<ReklamZekaMcpToolName>([
  "register_agent_session", "heartbeat_agent_session", "decision_room_mark_inbox_read", "budget_lab_save_draft",
  ...READ_ONLY,
]);
const REQUIRES_INTERACTION = new Set<ReklamZekaMcpToolName>([
  "decision_room_mark_inbox_read", "budget_lab_save_draft",
]);

export function annotations(name: ReklamZekaMcpToolName): ToolAnnotations {
  return Object.freeze({
    readOnlyHint: READ_ONLY.has(name),
    destructiveHint: name === "get_handoff_context",
    idempotentHint: IDEMPOTENT.has(name),
    openWorldHint: false,
  });
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new LocalMcpHttpBridgeError("unsafe_response");
  return value as Record<string, unknown>;
}

export function createReklamZekaMcpServer(input: Readonly<{
  runtime: PrivateLocalMcpRuntime;
  bridge?: LocalMcpHttpBridge;
}>): McpServer {
  const bridge = input.bridge ?? new LocalMcpHttpBridge(input.runtime);
  const server = new McpServer({ name: "reklamzeka-local", version: REKLAMZEKA_MCP_VERSION },
    { capabilities: { tools: {} } });
  for (const name of REKLAMZEKA_MCP_TOOL_NAMES) {
    server.registerTool(name, {
      description: DESCRIPTIONS.get(name)!,
      inputSchema: MCP_TOOL_SCHEMAS[name],
      annotations: annotations(name),
      ...(REQUIRES_INTERACTION.has(name)
        ? { _meta: { "anthropic/requiresUserInteraction": true } }
        : {}),
    }, async (args: Record<string, unknown>) => {
      try {
        const result = object(await bridge.execute(name, args as Readonly<Record<string, unknown>>));
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }], structuredContent: result };
      } catch {
        return { isError: true, content: [{ type: "text" as const,
          text: "Yerel ReklamZeka aracı güvenli biçimde tamamlanamadı." }] };
      }
    });
  }
  return server;
}
