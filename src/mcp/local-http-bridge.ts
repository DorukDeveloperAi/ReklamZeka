import { assertLocalAgentSafeToolResult, LOCAL_AGENT_SAFE_TOOLS } from "@/application/local-agent-client";
import type { PrivateLocalMcpRuntime } from "@/mcp/private-local-environment";
import type { ReklamZekaMcpToolName } from "@/mcp/tool-schemas";

const MAX_RESPONSE_BYTES = 2_000_000;
const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i;
const TOKEN = /\brzs1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/;
const DESCRIPTOR = Object.freeze({ clientRef: "client_reklamzeka_mcp", transport: "project_stdio" as const,
  allowedTools: Object.freeze(LOCAL_AGENT_SAFE_TOOLS.map((tool) => tool.name)) });

export class LocalMcpHttpBridgeError extends Error {
  constructor(readonly code: "local_api_rejected" | "unsafe_response") {
    super("Local MCP HTTP bridge rejected"); this.name = "LocalMcpHttpBridgeError";
  }
}
function fail(code: LocalMcpHttpBridgeError["code"]): never { throw new LocalMcpHttpBridgeError(code); }

function publicResult(value: unknown, seen = new Set<object>()): void {
  if (typeof value === "string") { if (UUID.test(value) || TOKEN.test(value)) fail("unsafe_response"); return; }
  if (value === null || typeof value === "number" || typeof value === "boolean") return;
  if (typeof value !== "object" || seen.has(value)) fail("unsafe_response");
  seen.add(value);
  if (Array.isArray(value)) value.forEach((item) => publicResult(item, seen));
  else for (const [key, child] of Object.entries(value)) {
    if (/(token|secret|databaseurl|signingkey|workspaceid|userid)/i.test(key)) fail("unsafe_response");
    publicResult(child, seen);
  }
  seen.delete(value);
}

function query(path: string, values: Readonly<Record<string, unknown>>): string {
  const url = new URL(path, "http://localhost");
  for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== null) url.searchParams.set(key, String(value));
  return `${url.pathname}${url.search}`;
}

type RequestSpec = Readonly<{ path: string; method: "GET" | "POST" | "PATCH"; intent: string; body?: unknown }>;

function requestFor(name: ReklamZekaMcpToolName, args: Readonly<Record<string, unknown>>): RequestSpec {
  switch (name) {
    case "register_agent_session": return { path: "/api/local-agent-sessions", method: "POST",
      intent: "local-agent-session-register", body: DESCRIPTOR };
    case "heartbeat_agent_session": return { path: "/api/local-agent-sessions", method: "PATCH",
      intent: "local-agent-session-heartbeat", body: DESCRIPTOR };
    case "get_handoff_context": return { path: "/api/local-agent-handoffs", method: "PATCH",
      intent: "local-agent-handoff-consume", body: { ...DESCRIPTOR, handoffRef: args.handoffRef } };
    case "decision_room_list": return { path: query("/api/decision-room", args), method: "GET", intent: "decision-room-list" };
    case "decision_room_mark_inbox_read": return { path: "/api/decision-room", method: "PATCH",
      intent: "mark-inbox-read", body: { notificationRef: args.notificationRef } };
    case "approval_queue_list": return { path: query("/api/approval-queue", { view: "list", ...args }),
      method: "GET", intent: "approval-queue-list" };
    case "approval_queue_get": return { path: query("/api/approval-queue", { view: "detail", ...args }),
      method: "GET", intent: "approval-queue-get" };
    case "policy_bundle_read": return { path: "/api/policy-bundles", method: "GET", intent: "policy-bundle-read" };
    case "budget_lab_list": return { path: query("/api/budget-lab", { view: "list", ...args }),
      method: "GET", intent: "budget-lab-list" };
    case "budget_lab_get": return { path: query("/api/budget-lab", { view: "detail", ...args }),
      method: "GET", intent: "budget-lab-get" };
    case "budget_lab_dry_run": return { path: "/api/budget-lab", method: "POST",
      intent: "budget-lab-dry-run", body: args };
    case "budget_lab_save_draft": return { path: "/api/budget-lab", method: "POST",
      intent: "budget-lab-save-draft", body: args };
    case "practice_lab_list": return { path: query("/api/practice-lab", { view: "list", ...args }),
      method: "GET", intent: "practice-lab-list" };
    case "practice_lab_get": return { path: query("/api/practice-lab", { view: "detail", ...args }),
      method: "GET", intent: "practice-lab-get" };
    case "practice_lab_prepare_draft": return { path: query("/api/practice-lab", { view: "draft", ...args }),
      method: "GET", intent: "practice-lab-prepare-draft" };
    case "existing_post_promotion_preflight": return { path: "/api/existing-post-promotion-preflight", method: "POST",
      intent: "existing-post-promotion-preflight", body: { selection: args } };
  }
}

export type LocalMcpFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class LocalMcpHttpBridge {
  constructor(private readonly runtime: PrivateLocalMcpRuntime, private readonly fetcher: LocalMcpFetch = fetch) {}

  async execute(name: ReklamZekaMcpToolName, args: Readonly<Record<string, unknown>>): Promise<unknown> {
    const spec = requestFor(name, args);
    const textBody = spec.body === undefined ? undefined : JSON.stringify(spec.body);
    let response: Response;
    try {
      response = await this.fetcher(new URL(spec.path, this.runtime.origin), {
        method: spec.method,
        headers: {
          Authorization: `Bearer ${this.runtime.token}`,
          Origin: this.runtime.origin,
          "Sec-Fetch-Site": "same-origin",
          "X-ReklamZeka-Intent": spec.intent,
          ...(textBody === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: textBody,
        redirect: "error",
        cache: "no-store",
      });
    } catch { return fail("local_api_rejected"); }
    const declared = response.headers.get("content-length");
    if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) fail("unsafe_response");
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) fail("unsafe_response");
    if (!response.ok) fail("local_api_rejected");
    let result: unknown;
    try { result = JSON.parse(text) as unknown; } catch { return fail("unsafe_response"); }
    assertLocalAgentSafeToolResult(result);
    publicResult(result);
    if (name === "register_agent_session") {
      const source = result as { outcome?: unknown; session?: { expiresAt?: unknown } };
      return Object.freeze({ status: "registered", outcome: source.outcome, expiresAt: source.session?.expiresAt });
    }
    if (name === "heartbeat_agent_session") {
      const source = result as { session?: { lastSeenAt?: unknown; expiresAt?: unknown } };
      return Object.freeze({ status: "active", lastSeenAt: source.session?.lastSeenAt, expiresAt: source.session?.expiresAt });
    }
    if (name === "get_handoff_context") {
      const source = result as { handoff?: { context?: unknown; expiresAt?: unknown } };
      return Object.freeze({ context: source.handoff?.context, expiresAt: source.handoff?.expiresAt });
    }
    return result;
  }
}
