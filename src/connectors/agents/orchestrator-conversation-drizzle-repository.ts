import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  orchestratorPageGuide,
  type OrchestratorConversationRepository,
  type OrchestratorConversationSnapshot,
  type OrchestratorMessage,
  type OrchestratorPageGuide,
} from "@/application/orchestrator-conversation";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
type Executor = Pick<Database, "execute">;
type ConversationDatabase = Pick<Database, "execute" | "transaction">;

type ConversationRow = Readonly<{ conversation_ref: string; created_at: Date | string }>;
type TurnRow = Readonly<{ provider_thread_ref: string | null; page_guide: unknown }>;
type MessageRow = Readonly<{ message_ref: string; turn_ref: string; message_number: number;
  role: string; content: string; created_at: Date | string }>;

const CONVERSATION = /^conversation_[a-f0-9]{32}$/;
const TURN = /^turn_[a-f0-9]{32}$/;
const MESSAGE = /^message_[a-f0-9]{32}$/;
const PROVIDER_THREAD = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class OrchestratorConversationRepositoryError extends Error {
  constructor(readonly code: "invalid_input" | "corrupt_store" | "conversation_unavailable") {
    super("Orchestrator conversation repository rejected");
    this.name = "OrchestratorConversationRepositoryError";
  }
}

function fail(code: OrchestratorConversationRepositoryError["code"]): never {
  throw new OrchestratorConversationRepositoryError(code);
}

function rows<T>(result: unknown): readonly T[] {
  if (!result || typeof result !== "object" || !("rows" in result) || !Array.isArray(result.rows)) fail("corrupt_store");
  return result.rows as readonly T[];
}

function iso(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) fail("corrupt_store");
  return parsed.toISOString();
}

function pageGuide(value: unknown): OrchestratorPageGuide {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("corrupt_store");
  const candidate = value as Record<string, unknown>;
  if (Object.keys(candidate).length !== 6 || typeof candidate.pageId !== "string") fail("corrupt_store");
  const canonical = orchestratorPageGuide(candidate.pageId);
  if (Object.entries(canonical).some(([key, expected]) => candidate[key] !== expected)) fail("corrupt_store");
  return canonical;
}

function message(row: MessageRow): OrchestratorMessage {
  if (!MESSAGE.test(row.message_ref) || !TURN.test(row.turn_ref)
    || !Number.isSafeInteger(row.message_number) || row.message_number < 1 || row.message_number > 2_000_000
    || (row.role !== "user" && row.role !== "assistant")
    || typeof row.content !== "string" || row.content.length < 1 || row.content.length > 30_000) fail("corrupt_store");
  return Object.freeze({ messageRef: row.message_ref, turnRef: row.turn_ref, messageNumber: row.message_number,
    role: row.role, content: row.content, createdAt: iso(row.created_at) });
}

async function snapshot(executor: Executor, scope: Readonly<{ workspaceId: string; userId: string;
  conversationRef: string }>): Promise<OrchestratorConversationSnapshot | null> {
  const conversations = rows<ConversationRow>(await executor.execute(sql`
    select conversation_ref, created_at
    from orchestrator_conversations conversation
    where conversation.workspace_id = ${scope.workspaceId}::uuid
      and conversation.user_id = ${scope.userId}::uuid
      and conversation.conversation_ref = ${scope.conversationRef}
      and not exists (
        select 1 from orchestrator_conversation_tombstones tombstone
        where tombstone.workspace_id = conversation.workspace_id
          and tombstone.conversation_ref = conversation.conversation_ref
      )
    limit 2
  `));
  if (conversations.length > 1) fail("corrupt_store");
  const conversation = conversations[0];
  if (!conversation) return null;
  if (!CONVERSATION.test(conversation.conversation_ref)) fail("corrupt_store");
  const latest = rows<TurnRow>(await executor.execute(sql`
    select provider_thread_ref, page_guide
    from orchestrator_conversation_turns
    where workspace_id = ${scope.workspaceId}::uuid and conversation_ref = ${scope.conversationRef}
    order by turn_number desc limit 1
  `))[0] ?? null;
  const latestCompleted = rows<{ provider_thread_ref: string }>(await executor.execute(sql`
    select provider_thread_ref
    from orchestrator_conversation_turns
    where workspace_id = ${scope.workspaceId}::uuid and conversation_ref = ${scope.conversationRef}
      and outcome = 'completed'
    order by turn_number desc limit 1
  `))[0]?.provider_thread_ref ?? null;
  if (latestCompleted !== null && !PROVIDER_THREAD.test(latestCompleted)) fail("corrupt_store");
  const storedMessages = rows<MessageRow>(await executor.execute(sql`
    select message_ref, turn_ref, message_number, role, content, created_at
    from orchestrator_conversation_messages
    where workspace_id = ${scope.workspaceId}::uuid and conversation_ref = ${scope.conversationRef}
    order by message_number asc limit 200
  `)).map(message);
  if (storedMessages.some((item, index) => item.messageNumber !== index + 1)) fail("corrupt_store");
  return Object.freeze({ conversationRef: conversation.conversation_ref, createdAt: iso(conversation.created_at),
    pageGuide: latest ? pageGuide(latest.page_guide) : null, providerThreadRef: latestCompleted,
    messages: Object.freeze(storedMessages) });
}

export class DrizzleOrchestratorConversationRepository implements OrchestratorConversationRepository {
  constructor(private readonly database: ConversationDatabase) {}

  async current(scope: Readonly<{ workspaceId: string; userId: string }>) {
    const found = rows<ConversationRow>(await this.database.execute(sql`
      select conversation.conversation_ref, conversation.created_at
      from orchestrator_conversations conversation
      join workspaces workspace on workspace.id = conversation.workspace_id and workspace.lifecycle_state = 'active'
      where conversation.workspace_id = ${scope.workspaceId}::uuid and conversation.user_id = ${scope.userId}::uuid
        and not exists (select 1 from orchestrator_conversation_tombstones tombstone
          where tombstone.workspace_id = conversation.workspace_id
            and tombstone.conversation_ref = conversation.conversation_ref)
      order by conversation.created_at desc, conversation.conversation_ref asc limit 1
    `))[0];
    return found ? snapshot(this.database, { ...scope, conversationRef: found.conversation_ref }) : null;
  }

  async create(scope: Readonly<{ workspaceId: string; userId: string; conversationRef: string; createdAt: string }>) {
    if (!CONVERSATION.test(scope.conversationRef) || !Number.isFinite(Date.parse(scope.createdAt))) fail("invalid_input");
    return this.database.transaction(async (transaction) => {
      const membership = rows<{ user_id: string }>(await transaction.execute(sql`
        select membership.user_id from memberships membership
        join workspaces workspace on workspace.id = membership.workspace_id
        where membership.workspace_id = ${scope.workspaceId}::uuid and membership.user_id = ${scope.userId}::uuid
          and workspace.lifecycle_state = 'active'
        for update of membership
      `));
      if (membership.length !== 1) fail("conversation_unavailable");
      const existing = rows<ConversationRow>(await transaction.execute(sql`
        select conversation.conversation_ref, conversation.created_at
        from orchestrator_conversations conversation
        where conversation.workspace_id = ${scope.workspaceId}::uuid and conversation.user_id = ${scope.userId}::uuid
          and not exists (select 1 from orchestrator_conversation_tombstones tombstone
            where tombstone.workspace_id = conversation.workspace_id
              and tombstone.conversation_ref = conversation.conversation_ref)
        order by conversation.created_at desc, conversation.conversation_ref asc limit 1
      `))[0];
      const conversationRef = existing?.conversation_ref ?? scope.conversationRef;
      if (!existing) await transaction.execute(sql`
        insert into orchestrator_conversations (workspace_id, user_id, conversation_ref, created_at)
        values (${scope.workspaceId}::uuid, ${scope.userId}::uuid, ${scope.conversationRef}, ${scope.createdAt}::timestamptz)
      `);
      const result = await snapshot(transaction as Executor, { workspaceId: scope.workspaceId,
        userId: scope.userId, conversationRef });
      if (!result) fail("conversation_unavailable");
      return result;
    });
  }

  find(scope: Readonly<{ workspaceId: string; userId: string; conversationRef: string }>) {
    if (!CONVERSATION.test(scope.conversationRef)) fail("invalid_input");
    return snapshot(this.database, scope);
  }

  async appendTurn(input: Parameters<OrchestratorConversationRepository["appendTurn"]>[0]) {
    if (!CONVERSATION.test(input.conversationRef) || !TURN.test(input.turnRef)
      || !MESSAGE.test(input.userMessageRef) || (input.assistantMessageRef !== null && !MESSAGE.test(input.assistantMessageRef))
      || !Number.isFinite(Date.parse(input.createdAt))) fail("invalid_input");
    return this.database.transaction(async (transaction) => {
      const locked = rows<{ conversation_ref: string }>(await transaction.execute(sql`
        select conversation.conversation_ref from orchestrator_conversations conversation
        join workspaces workspace on workspace.id = conversation.workspace_id and workspace.lifecycle_state = 'active'
        where conversation.workspace_id = ${input.workspaceId}::uuid
          and conversation.user_id = ${input.userId}::uuid
          and conversation.conversation_ref = ${input.conversationRef}
          and not exists (select 1 from orchestrator_conversation_tombstones tombstone
            where tombstone.workspace_id = conversation.workspace_id
              and tombstone.conversation_ref = conversation.conversation_ref)
        for update of conversation
      `));
      if (locked.length !== 1) fail("conversation_unavailable");
      const counters = rows<{ turn_number: number; message_number: number }>(await transaction.execute(sql`
        select
          coalesce((select max(turn_number) from orchestrator_conversation_turns
            where workspace_id = ${input.workspaceId}::uuid and conversation_ref = ${input.conversationRef}), 0)::int + 1 as turn_number,
          coalesce((select max(message_number) from orchestrator_conversation_messages
            where workspace_id = ${input.workspaceId}::uuid and conversation_ref = ${input.conversationRef}), 0)::int + 1 as message_number
      `))[0];
      if (!counters) fail("corrupt_store");
      await transaction.execute(sql`
        insert into orchestrator_conversation_turns (
          workspace_id, conversation_ref, turn_ref, turn_number, provider, provider_thread_ref,
          outcome, failure_code, page_guide, profile_snapshot, manifest_snapshots, skill_catalog_binding_hash, created_at
        ) values (
          ${input.workspaceId}::uuid, ${input.conversationRef}, ${input.turnRef}, ${counters.turn_number},
          'codex_cli', ${input.providerThreadRef}, ${input.outcome}, ${input.failureCode},
          ${JSON.stringify(input.pageGuide)}::jsonb, ${JSON.stringify(input.skillCatalogBinding.profile)}::jsonb,
          ${JSON.stringify(input.skillCatalogBinding.manifests)}::jsonb, ${input.skillCatalogBinding.bindingHash}, ${input.createdAt}::timestamptz
        )
      `);
      await transaction.execute(sql`
        insert into orchestrator_conversation_messages (
          workspace_id, conversation_ref, turn_ref, message_ref, message_number, role, content, created_at
        ) values (${input.workspaceId}::uuid, ${input.conversationRef}, ${input.turnRef},
          ${input.userMessageRef}, ${counters.message_number}, 'user', ${input.userContent}, ${input.createdAt}::timestamptz)
      `);
      if (input.outcome === "completed") {
        if (!input.assistantMessageRef || !input.assistantContent) fail("invalid_input");
        await transaction.execute(sql`
          insert into orchestrator_conversation_messages (
            workspace_id, conversation_ref, turn_ref, message_ref, message_number, role, content, created_at
          ) values (${input.workspaceId}::uuid, ${input.conversationRef}, ${input.turnRef},
            ${input.assistantMessageRef}, ${counters.message_number + 1}, 'assistant', ${input.assistantContent},
            ${input.createdAt}::timestamptz)
        `);
      }
      const result = await snapshot(transaction as Executor, { workspaceId: input.workspaceId,
        userId: input.userId, conversationRef: input.conversationRef });
      if (!result) fail("conversation_unavailable");
      return result;
    });
  }
}
