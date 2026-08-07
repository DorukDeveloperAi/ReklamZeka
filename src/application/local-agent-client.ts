import { APPROVAL_QUEUE_AGENT_TOOLS } from "@/application/approval-queue-agent-contract";
import { BUDGET_LAB_AGENT_TOOLS } from "@/application/budget-lab-agent-contract";
import { DECISION_ROOM_AGENT_TOOLS } from "@/application/decision-room-agent-contract";
import { EXISTING_POST_PROMOTION_AGENT_TOOLS } from
  "@/application/existing-post-promotion-preflight-agent-contract";
import { POLICY_BUNDLE_AGENT_TOOLS } from "@/application/policy-bundle-agent-contract";
import { PRACTICE_LAB_AGENT_TOOLS } from "@/application/practice-lab-agent-contract";
import { LOCAL_SESSION_SCOPES, type LocalSessionScope } from "@/security/local-session-capability";

export const LOCAL_AGENT_CLIENT_CONTRACT_VERSION = "local-agent-client/1.0.0" as const;
export const LOCAL_AGENT_TOOL_CATALOG_VERSION = "local-agent-tools/1.0.0" as const;

export const LOCAL_AGENT_SAFE_TOOLS = Object.freeze([
  ...DECISION_ROOM_AGENT_TOOLS,
  ...APPROVAL_QUEUE_AGENT_TOOLS,
  ...POLICY_BUNDLE_AGENT_TOOLS,
  ...BUDGET_LAB_AGENT_TOOLS,
  ...PRACTICE_LAB_AGENT_TOOLS,
  ...EXISTING_POST_PROMOTION_AGENT_TOOLS,
]);

export type LocalAgentToolName = (typeof LOCAL_AGENT_SAFE_TOOLS)[number]["name"];
export type LocalAgentTransport = "deterministic_fixture" | "project_stdio" | "loopback_http";

export type LocalAgentSessionDescriptor = Readonly<{
  contractVersion: typeof LOCAL_AGENT_CLIENT_CONTRACT_VERSION;
  clientRef: string;
  sessionRef: string;
  transport: LocalAgentTransport;
  workspaceRef: string;
  toolCatalogVersion: typeof LOCAL_AGENT_TOOL_CATALOG_VERSION;
  allowedTools: readonly LocalAgentToolName[];
  authority: Readonly<{
    modelExecution: false;
    humanPresence: false;
    approval: false;
    grant: false;
    execution: false;
    rawMeta: false;
    rawSql: false;
    metaWrite: false;
  }>;
}>;

export type LocalAgentFixtureCall = Readonly<{
  callRef: string;
  name: LocalAgentToolName;
  arguments: Readonly<Record<string, unknown>>;
}>;

export type LocalAgentFixtureRun = Readonly<{
  sessionRef: string;
  correlationRef: string;
  calls: readonly LocalAgentFixtureCall[];
}>;

export type LocalAgentToolExecutor = Readonly<{
  execute: (call: Readonly<{ name: LocalAgentToolName; arguments: Readonly<Record<string, unknown>> }>) => Promise<unknown>;
}>;

export type LocalAgentClientErrorCode =
  | "invalid_descriptor"
  | "invalid_run"
  | "tool_not_allowed"
  | "unsafe_tool_result"
  | "correlation_reused"
  | "cross_session_correlation";

export class LocalAgentClientError extends Error {
  constructor(readonly code: LocalAgentClientErrorCode) {
    super("Local agent client contract rejected");
    this.name = "LocalAgentClientError";
  }
}

const CLIENT_REF = /^client_[a-z0-9][a-z0-9_-]{0,86}$/;
const SESSION_REF = /^session_[a-f0-9]{32}$/;
const WORKSPACE_REF = /^workspace_[a-z0-9][a-z0-9_-]{0,86}$/;
const CORRELATION_REF = /^correlation_[a-f0-9]{32}$/;
const CALL_REF = /^call_[a-f0-9]{16}$/;
const TRANSPORTS = new Set<LocalAgentTransport>(["deterministic_fixture", "project_stdio", "loopback_http"]);
const SAFE_TOOL_NAMES = new Set<LocalAgentToolName>(LOCAL_AGENT_SAFE_TOOLS.map((tool) => tool.name));
const scopes = (...values: LocalSessionScope[]): readonly LocalSessionScope[] => Object.freeze(values);
const TOOL_SCOPES: Readonly<Record<LocalAgentToolName, readonly LocalSessionScope[]>> = Object.freeze({
  decision_room_list: scopes("decision_room:read"),
  decision_room_mark_inbox_read: scopes("decision_room:mark_read"),
  approval_queue_list: scopes("approval_queue:read"),
  approval_queue_get: scopes("approval_queue:read"),
  policy_bundle_read: scopes("policy_bundle:read"),
  budget_lab_list: scopes("budget_lab:read"),
  budget_lab_get: scopes("budget_lab:read"),
  budget_lab_dry_run: scopes("budget_lab:draft"),
  budget_lab_save_draft: scopes("budget_lab:draft"),
  practice_lab_list: scopes("practice_lab:read"),
  practice_lab_get: scopes("practice_lab:read"),
  practice_lab_prepare_draft: scopes("practice_lab:read"),
  existing_post_promotion_preflight: scopes("promotion_preflight:read"),
});
const FORBIDDEN_TOOL_NAME = /(^|_)(approve|grant|execute|human_presence|raw_meta|raw_sql|write_meta)(_|$)/i;
const FORBIDDEN_RESULT_KEYS = new Set([
  "accesstoken", "metaaccesstoken", "secret", "databaseurl", "rawsql", "rawmeta", "humanpresencegrant",
]);
const CLOSED_AUTHORITY_KEYS = new Set([
  "canapprove", "canreject", "canrequestchanges", "cangrant", "canexecute", "canwritemeta", "canpersist",
  "cangeneratecreative", "cancreatepolicy", "canpromoteguidance", "metawrite", "actionexecution",
  "humanpresence", "modelexecution", "approval", "grant", "execution", "rawmeta", "rawsql",
]);
const AUTHORITY = Object.freeze({
  modelExecution: false as const,
  humanPresence: false as const,
  approval: false as const,
  grant: false as const,
  execution: false as const,
  rawMeta: false as const,
  rawSql: false as const,
  metaWrite: false as const,
});

function fail(code: LocalAgentClientErrorCode): never {
  throw new LocalAgentClientError(code);
}

function exact(value: unknown, keys: readonly string[], code: LocalAgentClientErrorCode): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) fail(code);
}

function closedAuthority(value: unknown): value is typeof AUTHORITY {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(AUTHORITY);
  return Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key))
    && keys.every((key) => (value as Record<string, unknown>)[key] === false);
}

function normalizedKey(key: string): string {
  return key.replace(/[^a-z]/gi, "").toLowerCase();
}

function assertSafeToolResult(value: unknown, seen = new Set<object>()): void {
  if (value === null || ["string", "number", "boolean"].includes(typeof value)) return;
  if (typeof value !== "object") fail("unsafe_tool_result");
  if (seen.has(value)) fail("unsafe_tool_result");
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((item) => assertSafeToolResult(item, seen));
    seen.delete(value);
    return;
  }
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    fail("unsafe_tool_result");
  }
  for (const [key, child] of Object.entries(value)) {
    const normalized = normalizedKey(key);
    if (FORBIDDEN_RESULT_KEYS.has(normalized)) fail("unsafe_tool_result");
    if (CLOSED_AUTHORITY_KEYS.has(normalized) && child !== false) fail("unsafe_tool_result");
    assertSafeToolResult(child, seen);
  }
  seen.delete(value);
}

export function createLocalAgentSessionDescriptor(input: Readonly<{
  clientRef: string;
  sessionRef: string;
  transport: LocalAgentTransport;
  workspaceRef: string;
  sessionScopes: readonly LocalSessionScope[];
  allowedTools: readonly LocalAgentToolName[];
}>): LocalAgentSessionDescriptor {
  exact(input, ["clientRef", "sessionRef", "transport", "workspaceRef", "sessionScopes", "allowedTools"], "invalid_descriptor");
  const sessionScopes = new Set(input.sessionScopes);
  if (typeof input.clientRef !== "string" || !CLIENT_REF.test(input.clientRef)
    || typeof input.sessionRef !== "string" || !SESSION_REF.test(input.sessionRef)
    || typeof input.transport !== "string" || !TRANSPORTS.has(input.transport)
    || typeof input.workspaceRef !== "string" || !WORKSPACE_REF.test(input.workspaceRef)
    || !Array.isArray(input.sessionScopes) || input.sessionScopes.length < 1
    || sessionScopes.size !== input.sessionScopes.length
    || input.sessionScopes.some((scope) => !LOCAL_SESSION_SCOPES.includes(scope))
    || !Array.isArray(input.allowedTools) || input.allowedTools.length < 1
    || input.allowedTools.length > SAFE_TOOL_NAMES.size
    || new Set(input.allowedTools).size !== input.allowedTools.length
    || input.allowedTools.some((name) => typeof name !== "string"
      || !SAFE_TOOL_NAMES.has(name as LocalAgentToolName) || FORBIDDEN_TOOL_NAME.test(name)
      || TOOL_SCOPES[name as LocalAgentToolName]?.some((scope) => !sessionScopes.has(scope)))) {
    fail("invalid_descriptor");
  }
  return Object.freeze({
    contractVersion: LOCAL_AGENT_CLIENT_CONTRACT_VERSION,
    clientRef: input.clientRef,
    sessionRef: input.sessionRef,
    transport: input.transport,
    workspaceRef: input.workspaceRef,
    toolCatalogVersion: LOCAL_AGENT_TOOL_CATALOG_VERSION,
    allowedTools: Object.freeze([...input.allowedTools]),
    authority: AUTHORITY,
  });
}

export class InMemoryLocalAgentCorrelationRegistry {
  readonly #claims = new Map<string, string>();

  claim(sessionRef: string, correlationRef: string): void {
    const claimedBy = this.#claims.get(correlationRef);
    if (claimedBy === undefined) {
      this.#claims.set(correlationRef, sessionRef);
      return;
    }
    fail(claimedBy === sessionRef ? "correlation_reused" : "cross_session_correlation");
  }
}

/**
 * Modelsiz conformance fixture'ı. It accepts an already-bound session and
 * deterministic tool executors; it has no prompt, provider, model, network,
 * approval, human-presence, raw-data, or execution adapter.
 */
export class DeterministicLocalAgentFixtureClient {
  readonly #allowedTools: Set<LocalAgentToolName>;

  constructor(
    readonly session: LocalAgentSessionDescriptor,
    private readonly executors: Readonly<Partial<Record<LocalAgentToolName, LocalAgentToolExecutor>>>,
    private readonly correlations = new InMemoryLocalAgentCorrelationRegistry(),
  ) {
    exact(session, ["contractVersion", "clientRef", "sessionRef", "transport", "workspaceRef", "toolCatalogVersion", "allowedTools", "authority"], "invalid_descriptor");
    if (session.contractVersion !== LOCAL_AGENT_CLIENT_CONTRACT_VERSION
      || session.toolCatalogVersion !== LOCAL_AGENT_TOOL_CATALOG_VERSION
      || session.transport !== "deterministic_fixture"
      || !closedAuthority(session.authority)) fail("invalid_descriptor");
    this.#allowedTools = new Set(session.allowedTools);
    const executorNames = Object.keys(executors);
    if (executorNames.length !== this.#allowedTools.size
      || executorNames.some((name) => !this.#allowedTools.has(name as LocalAgentToolName))
      || [...this.#allowedTools].some((name) => !executors[name] || typeof executors[name]?.execute !== "function")) {
      fail("invalid_descriptor");
    }
  }

  async run(input: LocalAgentFixtureRun): Promise<Readonly<{
    contractVersion: typeof LOCAL_AGENT_CLIENT_CONTRACT_VERSION;
    clientRef: string;
    sessionRef: string;
    correlationRef: string;
    results: readonly Readonly<{ callRef: string; name: LocalAgentToolName; result: unknown }>[];
    authority: typeof AUTHORITY;
  }>> {
    exact(input, ["sessionRef", "correlationRef", "calls"], "invalid_run");
    if (input.sessionRef !== this.session.sessionRef
      || typeof input.correlationRef !== "string" || !CORRELATION_REF.test(input.correlationRef)
      || !Array.isArray(input.calls) || input.calls.length < 1 || input.calls.length > 32) fail("invalid_run");
    const callRefs = new Set<string>();
    for (const call of input.calls) {
      exact(call, ["callRef", "name", "arguments"], "invalid_run");
      const toolName = call.name as LocalAgentToolName;
      if (typeof call.callRef !== "string" || !CALL_REF.test(call.callRef) || callRefs.has(call.callRef)
        || typeof call.name !== "string" || !this.#allowedTools.has(toolName)
        || !call.arguments || typeof call.arguments !== "object" || Array.isArray(call.arguments)) fail("invalid_run");
      callRefs.add(call.callRef);
    }
    this.correlations.claim(this.session.sessionRef, input.correlationRef);
    const results = [];
    for (const call of input.calls) {
      const toolName = call.name as LocalAgentToolName;
      const result = await this.executors[toolName]!.execute(Object.freeze({ name: toolName, arguments: call.arguments }));
      assertSafeToolResult(result);
      results.push(Object.freeze({ callRef: call.callRef as string, name: toolName, result }));
    }
    return Object.freeze({
      contractVersion: LOCAL_AGENT_CLIENT_CONTRACT_VERSION,
      clientRef: this.session.clientRef,
      sessionRef: this.session.sessionRef,
      correlationRef: input.correlationRef,
      results: Object.freeze(results),
      authority: AUTHORITY,
    });
  }
}
