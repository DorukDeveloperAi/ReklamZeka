import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type {
  LocalAgentHandoffRecord,
  LocalAgentSessionRecord,
  LocalAgentSessionRepository,
} from "@/application/local-agent-session-contract";
import { LOCAL_AGENT_SAFE_TOOLS, type LocalAgentToolName, type LocalAgentTransport } from
  "@/application/local-agent-client";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
type SessionDatabase = Pick<Database, "execute" | "transaction">;

type SessionRow = Readonly<{
  workspace_id: string;
  session_ref: string;
  workspace_ref: string;
  user_id: string;
  client_ref: string;
  transport: string;
  tool_catalog_version: string;
  allowed_tools: unknown;
  started_at: Date | string;
  last_seen_at: Date | string;
  expires_at: Date | string;
}>;

type HandoffRow = Readonly<{
  handoff_ref: string;
  workspace_id: string;
  workspace_ref: string;
  creator_session_ref: string;
  target_session_ref: string;
  intent: string;
  entity_ref: string;
  timeframe_ref: string;
  context_ref: string;
  context_version: number;
  template_ref: string | null;
  correlation_ref: string;
  created_at: Date | string;
  expires_at: Date | string;
  consumed_at: Date | string | null;
}>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SESSION = /^session_[a-f0-9]{32}$/;
const HANDOFF = /^handoff_[a-f0-9]{32}$/;
const WORKSPACE_REF = /^workspace_[a-z0-9][a-z0-9_.:-]{0,86}$/;
const CLIENT_REF = /^client_[a-z0-9][a-z0-9_-]{0,86}$/;
const PUBLIC_REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,94}$/;
const CORRELATION = /^correlation_[a-f0-9]{32}$/;
const FORBIDDEN_REF = /(token|secret|prompt|raw|hash|sql|uuid|grant|approve|execute|human)/i;
const TRANSPORTS = new Set<LocalAgentTransport>(["deterministic_fixture", "project_stdio", "loopback_http"]);
const TOOLS = new Set<LocalAgentToolName>(LOCAL_AGENT_SAFE_TOOLS.map((tool) => tool.name));

export class LocalAgentSessionRepositoryError extends Error {
  constructor(readonly code: "invalid_input" | "corrupt_store") {
    super("Local agent session repository rejected");
    this.name = "LocalAgentSessionRepositoryError";
  }
}

function fail(code: "invalid_input" | "corrupt_store"): never {
  throw new LocalAgentSessionRepositoryError(code);
}

function rows<T>(result: unknown): readonly T[] {
  if (!result || typeof result !== "object" || !("rows" in result) || !Array.isArray(result.rows)) fail("corrupt_store");
  return result.rows as readonly T[];
}

function epoch(value: Date | string): number {
  const milliseconds = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(milliseconds) || milliseconds % 1000 !== 0) fail("corrupt_store");
  return milliseconds / 1000;
}

function publicRef(value: unknown): value is string {
  return typeof value === "string" && PUBLIC_REF.test(value) && !FORBIDDEN_REF.test(value);
}

function sessionRecord(row: SessionRow): LocalAgentSessionRecord {
  if (!UUID.test(row.workspace_id) || !UUID.test(row.user_id) || !SESSION.test(row.session_ref)
    || !WORKSPACE_REF.test(row.workspace_ref) || !CLIENT_REF.test(row.client_ref)
    || !TRANSPORTS.has(row.transport as LocalAgentTransport)
    || row.tool_catalog_version !== "local-agent-tools/1.0.0"
    || !Array.isArray(row.allowed_tools) || row.allowed_tools.length < 1 || row.allowed_tools.length > TOOLS.size
    || new Set(row.allowed_tools).size !== row.allowed_tools.length
    || row.allowed_tools.some((tool) => typeof tool !== "string" || !TOOLS.has(tool as LocalAgentToolName))) fail("corrupt_store");
  const startedAt = epoch(row.started_at); const lastSeenAt = epoch(row.last_seen_at); const expiresAt = epoch(row.expires_at);
  if (lastSeenAt < startedAt || lastSeenAt >= expiresAt || expiresAt > startedAt + 28_800) fail("corrupt_store");
  return Object.freeze({
    sessionRef: row.session_ref, workspaceId: row.workspace_id.toLowerCase(), workspaceRef: row.workspace_ref,
    userId: row.user_id.toLowerCase(), clientRef: row.client_ref, transport: row.transport as LocalAgentTransport,
    toolCatalogVersion: "local-agent-tools/1.0.0", allowedTools: Object.freeze([...row.allowed_tools] as LocalAgentToolName[]),
    startedAt, lastSeenAt, expiresAt,
  });
}

function handoffRecord(row: HandoffRow): LocalAgentHandoffRecord {
  if (!HANDOFF.test(row.handoff_ref) || !UUID.test(row.workspace_id) || !WORKSPACE_REF.test(row.workspace_ref)
    || !SESSION.test(row.creator_session_ref) || !SESSION.test(row.target_session_ref)
    || (row.intent !== "analysis" && row.intent !== "existing_post_promotion")
    || !publicRef(row.entity_ref) || !publicRef(row.timeframe_ref) || !publicRef(row.context_ref)
    || (row.template_ref !== null && !publicRef(row.template_ref)) || !CORRELATION.test(row.correlation_ref)
    || !Number.isSafeInteger(row.context_version) || row.context_version < 1 || row.context_version > 1_000_000
    || row.intent === "analysis" && row.template_ref !== null
    || row.intent === "existing_post_promotion" && row.template_ref === null) fail("corrupt_store");
  const createdAt = epoch(row.created_at); const expiresAt = epoch(row.expires_at);
  const consumedAt = row.consumed_at === null ? null : epoch(row.consumed_at);
  if (expiresAt < createdAt + 15 || expiresAt > createdAt + 120
    || consumedAt !== null && (consumedAt < createdAt || consumedAt >= expiresAt)) fail("corrupt_store");
  return Object.freeze({
    handoffRef: row.handoff_ref, workspaceId: row.workspace_id.toLowerCase(), workspaceRef: row.workspace_ref,
    creatorSessionRef: row.creator_session_ref, targetSessionRef: row.target_session_ref,
    context: Object.freeze({ intent: row.intent, entityRef: row.entity_ref, timeframeRef: row.timeframe_ref,
      contextRef: row.context_ref, contextVersion: row.context_version, templateRef: row.template_ref,
      correlationRef: row.correlation_ref }),
    createdAt, expiresAt, consumedAt,
  });
}

function sameSession(left: LocalAgentSessionRecord, right: LocalAgentSessionRecord): boolean {
  return left.sessionRef === right.sessionRef && left.workspaceId === right.workspaceId
    && left.workspaceRef === right.workspaceRef && left.userId === right.userId
    && left.clientRef === right.clientRef && left.transport === right.transport
    && left.toolCatalogVersion === right.toolCatalogVersion
    && JSON.stringify(left.allowedTools) === JSON.stringify(right.allowedTools)
    && left.startedAt === right.startedAt && left.lastSeenAt === right.lastSeenAt
    && left.expiresAt === right.expiresAt;
}

function sameHandoff(left: LocalAgentHandoffRecord, right: LocalAgentHandoffRecord): boolean {
  return left.handoffRef === right.handoffRef && left.workspaceId === right.workspaceId
    && left.workspaceRef === right.workspaceRef && left.creatorSessionRef === right.creatorSessionRef
    && left.targetSessionRef === right.targetSessionRef && left.context.intent === right.context.intent
    && left.context.entityRef === right.context.entityRef && left.context.timeframeRef === right.context.timeframeRef
    && left.context.contextRef === right.context.contextRef && left.context.contextVersion === right.context.contextVersion
    && left.context.templateRef === right.context.templateRef && left.context.correlationRef === right.context.correlationRef
    && left.createdAt === right.createdAt && left.expiresAt === right.expiresAt && left.consumedAt === right.consumedAt;
}

const SESSION_COLUMNS = sql`workspace_id, session_ref, workspace_ref, user_id, client_ref, transport,
  tool_catalog_version, allowed_tools, started_at, last_seen_at, expires_at`;
const HANDOFF_COLUMNS = sql`handoff_ref, workspace_id, workspace_ref, creator_session_ref, target_session_ref,
  intent, entity_ref, timeframe_ref, context_ref, context_version, template_ref, correlation_ref,
  created_at, expires_at, consumed_at`;

/** Server-private adapter; all mutations are tenant-scoped and short. */
export class DrizzleLocalAgentSessionRepository implements LocalAgentSessionRepository {
  constructor(private readonly database: SessionDatabase) {}

  async register(record: LocalAgentSessionRecord): Promise<"inserted" | "unchanged" | "conflict"> {
    if (!UUID.test(record.workspaceId) || !SESSION.test(record.sessionRef)) fail("invalid_input");
    return this.database.transaction(async (transaction) => {
      const active = rows<{ id: string }>(await transaction.execute(sql`
        select id from workspaces where id = ${record.workspaceId}::uuid and lifecycle_state = 'active'
        limit 2 for update
      `));
      if (active.length !== 1 || !UUID.test(active[0]!.id)) return "conflict" as const;
      const inserted = rows<SessionRow>(await transaction.execute(sql`
        insert into local_agent_sessions (
          workspace_id, session_ref, workspace_ref, user_id, client_ref, transport,
          tool_catalog_version, allowed_tools, started_at, last_seen_at, expires_at, updated_at
        ) values (
          ${record.workspaceId}::uuid, ${record.sessionRef}, ${record.workspaceRef}, ${record.userId}::uuid,
          ${record.clientRef}, ${record.transport}, ${record.toolCatalogVersion}, ${JSON.stringify(record.allowedTools)}::jsonb,
          ${new Date(record.startedAt * 1000)}::timestamptz, ${new Date(record.lastSeenAt * 1000)}::timestamptz,
          ${new Date(record.expiresAt * 1000)}::timestamptz, ${new Date(record.lastSeenAt * 1000)}::timestamptz
        ) on conflict (workspace_id, session_ref) do nothing
        returning ${SESSION_COLUMNS}
      `));
      if (inserted.length > 1) fail("corrupt_store");
      if (inserted[0]) {
        if (!sameSession(sessionRecord(inserted[0]), record)) fail("corrupt_store");
        return "inserted";
      }
      const existing = rows<SessionRow>(await transaction.execute(sql`
        select ${SESSION_COLUMNS} from local_agent_sessions
        where workspace_id = ${record.workspaceId}::uuid and session_ref = ${record.sessionRef}
        limit 2
      `));
      if (existing.length !== 1) fail("corrupt_store");
      return sameSession(sessionRecord(existing[0]!), record) ? "unchanged" : "conflict";
    });
  }

  async heartbeat(input: Readonly<{ workspaceId: string; sessionRef: string; at: number }>): Promise<LocalAgentSessionRecord | "missing" | "clock_regression"> {
    if (!UUID.test(input.workspaceId) || !SESSION.test(input.sessionRef) || !Number.isSafeInteger(input.at)) fail("invalid_input");
    return this.database.transaction(async (transaction) => {
      const updated = rows<SessionRow>(await transaction.execute(sql`
        update local_agent_sessions set last_seen_at = ${new Date(input.at * 1000)}::timestamptz,
          updated_at = ${new Date(input.at * 1000)}::timestamptz
        where workspace_id = ${input.workspaceId}::uuid and session_ref = ${input.sessionRef}
          and last_seen_at <= ${new Date(input.at * 1000)}::timestamptz
          and expires_at > ${new Date(input.at * 1000)}::timestamptz
        returning ${SESSION_COLUMNS}
      `));
      if (updated.length > 1) fail("corrupt_store");
      if (updated[0]) return sessionRecord(updated[0]);
      const existing = rows<SessionRow>(await transaction.execute(sql`
        select ${SESSION_COLUMNS} from local_agent_sessions
        where workspace_id = ${input.workspaceId}::uuid and session_ref = ${input.sessionRef}
        limit 2
      `));
      if (existing.length === 0) return "missing";
      if (existing.length !== 1) fail("corrupt_store");
      const current = sessionRecord(existing[0]!);
      return current.lastSeenAt > input.at ? "clock_regression" : current;
    });
  }

  async findSession(input: Readonly<{ workspaceId: string; sessionRef: string }>): Promise<LocalAgentSessionRecord | null> {
    if (!UUID.test(input.workspaceId) || !SESSION.test(input.sessionRef)) fail("invalid_input");
    const stored = rows<SessionRow>(await this.database.execute(sql`
      select ${SESSION_COLUMNS} from local_agent_sessions
      where workspace_id = ${input.workspaceId}::uuid and session_ref = ${input.sessionRef}
      limit 2
    `));
    if (stored.length > 1) fail("corrupt_store");
    return stored[0] ? sessionRecord(stored[0]) : null;
  }

  async listActiveSessions(input: Readonly<{
    workspaceId: string; userId: string; at: number; limit: number;
  }>): Promise<readonly LocalAgentSessionRecord[]> {
    if (!UUID.test(input.workspaceId) || !UUID.test(input.userId) || !Number.isSafeInteger(input.at)
      || !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 20) fail("invalid_input");
    const stored = rows<SessionRow>(await this.database.execute(sql`
      select ${SESSION_COLUMNS} from local_agent_sessions session
      join workspaces workspace on workspace.id = session.workspace_id and workspace.lifecycle_state = 'active'
      where session.workspace_id = ${input.workspaceId}::uuid and session.user_id = ${input.userId}::uuid
        and session.expires_at > ${new Date(input.at * 1000)}::timestamptz
      order by session.last_seen_at desc, session.session_ref asc
      limit ${input.limit}
    `));
    if (stored.length > input.limit) fail("corrupt_store");
    return Object.freeze(stored.map(sessionRecord));
  }

  async createHandoff(record: LocalAgentHandoffRecord): Promise<"inserted" | "conflict"> {
    if (!UUID.test(record.workspaceId) || !HANDOFF.test(record.handoffRef)) fail("invalid_input");
    const inserted = rows<HandoffRow>(await this.database.execute(sql`
      insert into local_agent_handoffs (
        workspace_id, handoff_ref, workspace_ref, creator_session_ref, target_session_ref, intent,
        entity_ref, timeframe_ref, context_ref, context_version, template_ref, correlation_ref,
        created_at, expires_at, consumed_at
      ) values (
        ${record.workspaceId}::uuid, ${record.handoffRef}, ${record.workspaceRef}, ${record.creatorSessionRef},
        ${record.targetSessionRef}, ${record.context.intent}, ${record.context.entityRef}, ${record.context.timeframeRef},
        ${record.context.contextRef}, ${record.context.contextVersion}, ${record.context.templateRef},
        ${record.context.correlationRef}, ${new Date(record.createdAt * 1000)}::timestamptz,
        ${new Date(record.expiresAt * 1000)}::timestamptz, null
      ) on conflict (workspace_id, handoff_ref) do nothing
      returning ${HANDOFF_COLUMNS}
    `));
    if (inserted.length > 1) fail("corrupt_store");
    if (!inserted[0]) return "conflict";
    if (!sameHandoff(handoffRecord(inserted[0]), record)) fail("corrupt_store");
    return "inserted";
  }

  async consumeHandoff(input: Readonly<{ workspaceId: string; sessionRef: string; handoffRef: string; at: number }>) {
    if (!UUID.test(input.workspaceId) || !SESSION.test(input.sessionRef) || !HANDOFF.test(input.handoffRef)
      || !Number.isSafeInteger(input.at)) fail("invalid_input");
    return this.database.transaction(async (transaction) => {
      // Exactly one concurrent caller can satisfy consumed_at IS NULL after the row lock is acquired.
      const consumed = rows<HandoffRow>(await transaction.execute(sql`
        update local_agent_handoffs set consumed_at = ${new Date(input.at * 1000)}::timestamptz
        where workspace_id = ${input.workspaceId}::uuid and handoff_ref = ${input.handoffRef}
          and target_session_ref = ${input.sessionRef} and consumed_at is null
          and created_at <= ${new Date(input.at * 1000)}::timestamptz
          and expires_at > ${new Date(input.at * 1000)}::timestamptz
        returning ${HANDOFF_COLUMNS}
      `));
      if (consumed.length > 1) fail("corrupt_store");
      if (consumed[0]) return Object.freeze({ status: "consumed" as const, record: handoffRecord(consumed[0]) });
      const stored = rows<HandoffRow>(await transaction.execute(sql`
        select ${HANDOFF_COLUMNS} from local_agent_handoffs
        where workspace_id = ${input.workspaceId}::uuid and handoff_ref = ${input.handoffRef}
        limit 2
      `));
      if (stored.length === 0) return Object.freeze({ status: "missing" as const });
      if (stored.length !== 1) fail("corrupt_store");
      const current = handoffRecord(stored[0]!);
      if (current.targetSessionRef !== input.sessionRef) return Object.freeze({ status: "scope_rejected" as const });
      if (current.consumedAt !== null) return Object.freeze({ status: "already_consumed" as const });
      if (current.expiresAt <= input.at) return Object.freeze({ status: "expired" as const });
      return Object.freeze({ status: "scope_rejected" as const });
    });
  }
}
