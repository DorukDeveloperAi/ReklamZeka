import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { categoryDefinitionPublicRef } from "@/domain/categories/public-reference";
import { invalidatePersistedPolicyAuthorityContexts } from "@/connectors/policies/policy-authority-context-invalidation";

type Database = NodePgDatabase<typeof schema>;
type Row = Readonly<Record<string, unknown>>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const TOPIC_REF = /^topic_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const CAPABILITIES = Object.freeze({ canPublish: false as const, canApprove: false as const,
  canExecute: false as const, canWriteMeta: false as const, canSchedule: false as const,
  canCallTool: false as const, canAccessNetwork: false as const, canQuerySql: false as const });

export class AuthorityTopicLifecycleError extends Error {
  constructor(readonly code: "invalid_input" | "not_found" | "forbidden" | "conflict" | "invalid_transition" | "corrupt_store") {
    super(`Authority topic lifecycle rejected: ${code}`); this.name = "AuthorityTopicLifecycleError";
  }
}
function fail(code: AuthorityTopicLifecycleError["code"]): never { throw new AuthorityTopicLifecycleError(code); }
function rows<T extends Row = Row>(value: unknown): readonly T[] {
  if (!value || typeof value !== "object" || !("rows" in value) || !Array.isArray(value.rows)) fail("corrupt_store");
  return value.rows as readonly T[];
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)]));
  return value;
}
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function ref(value: unknown, expression = REF): string { if (typeof value !== "string" || !expression.test(value)) fail("invalid_input"); return value; }
function hash(value: unknown): string { if (typeof value !== "string" || !HASH.test(value)) fail("invalid_input"); return value; }
function iso(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail("invalid_input");
  return value;
}
function categoryRefs(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > 250) fail("invalid_input");
  const ordered = value.map((entry) => ref(entry)).sort();
  if (new Set(ordered).size !== ordered.length || ordered.some((entry) => !entry.startsWith("category_"))) fail("invalid_input");
  return Object.freeze(ordered);
}
function exactReplay(payload: unknown, core: Readonly<Record<string, unknown>>): boolean {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const { revisionHash: _revisionHash, ...existing } = payload as Record<string, unknown>;
  return JSON.stringify(stable(existing)) === JSON.stringify(stable(core));
}

export type PrivateAuthorityTopicLifecycleCommand = Readonly<{
  operation: "create_active" | "revise_active" | "archive";
  topicRef: string;
  expectedHeadHash: "GENESIS" | string;
  categoryRefs: readonly string[];
}>;

/**
 * Server-private, append-only topic authority ledger. Category references are
 * resolved only from active tenant-local category rows and persisted as exact
 * immutable revision bindings. It cannot publish, approve, call Meta, or act.
 */
export class DrizzleAuthorityTopicLifecycleRepository {
  constructor(private readonly database: Database) {}

  async mutate(input: Readonly<{ workspaceId: string; workspaceRef: string; actorId: string; actorRef: string;
    role: "owner" | "admin"; occurredAt: string; command: PrivateAuthorityTopicLifecycleCommand }>) {
    const command = input.command;
    if (!UUID.test(input.workspaceId) || !UUID.test(input.actorId) || !["owner", "admin"].includes(input.role)
      || !["create_active", "revise_active", "archive"].includes(command.operation)) fail("invalid_input");
    ref(input.workspaceRef); ref(input.actorRef); ref(command.topicRef, TOPIC_REF);
    if (command.expectedHeadHash !== "GENESIS") hash(command.expectedHeadHash);
    const requestedCategories = categoryRefs(command.categoryRefs); iso(input.occurredAt);
    // Category linkage is optional authority evidence. Archival is the only
    // transition that must explicitly clear it; a topic may safely exist
    // without a category bridge for account- or policy-scoped use.
    if (command.operation === "archive" && requestedCategories.length !== 0) fail("invalid_input");

    return this.database.transaction(async (transaction) => {
      const tx = transaction as unknown as Database;
      if (rows(await tx.execute(sql`select id from workspaces where id = ${input.workspaceId}::uuid
        and lifecycle_state = 'active' for update`)).length !== 1) fail("not_found");
      const membership = rows<{ role: unknown }>(await tx.execute(sql`select role::text from memberships
        where workspace_id = ${input.workspaceId}::uuid and user_id = ${input.actorId}::uuid for update`));
      if (membership.length !== 1 || membership[0]!.role !== input.role) fail("forbidden");
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`authority-topic:${input.workspaceId}:${command.topicRef}`}, 0))`);

      const heads = rows<{ id: unknown; current_revision: unknown; current_revision_hash: unknown }>(await tx.execute(sql`
        select id::text, current_revision, current_revision_hash from authority_topics
        where workspace_id = ${input.workspaceId}::uuid and topic_ref = ${command.topicRef} for update`));
      if (heads.length > 1) fail("corrupt_store");
      const head = heads[0];
      if (head && (typeof head.id !== "string" || !UUID.test(head.id))) fail("corrupt_store");
      const currentRevision = head ? Number(head.current_revision) : 0;
      const currentHash = !head || head.current_revision_hash === null ? "GENESIS" : String(head.current_revision_hash);
      if (!Number.isSafeInteger(currentRevision) || currentRevision < 0 || (currentRevision === 0) !== (currentHash === "GENESIS")
        || (currentHash !== "GENESIS" && !HASH.test(currentHash))) fail("corrupt_store");
      const existing = !head ? undefined : rows<{ id: unknown; status: unknown; revision_hash: unknown; payload: unknown }>(await tx.execute(sql`
        select id::text, status, revision_hash, payload from authority_topic_revisions
        where workspace_id = ${input.workspaceId}::uuid and topic_id = ${String(head.id)}::uuid
          and revision = ${currentRevision} and revision_hash = ${currentHash} limit 2 for update`));
      if (existing && existing.length !== 1) fail("corrupt_store");
      if (existing && (typeof existing[0]!.id !== "string" || !UUID.test(existing[0]!.id)
        || !["active", "archived"].includes(String(existing[0]!.status)))) fail("corrupt_store");
      const status = command.operation === "archive" ? "archived" as const : "active" as const;
      if (currentHash !== command.expectedHeadHash) {
        const replayCore = Object.freeze({ schemaVersion: "authority-topic/1.0.0", workspaceRef: input.workspaceRef,
          topicRef: command.topicRef, revision: currentRevision,
          previousRevisionHash: command.expectedHeadHash === "GENESIS" ? null : command.expectedHeadHash,
          status, categoryRefs: requestedCategories, actor: Object.freeze({ ref: input.actorRef, role: input.role }),
          recordedAt: input.occurredAt, authority: CAPABILITIES });
        if (existing && exactReplay(existing[0]!.payload, replayCore)) return Object.freeze({ topicRef: command.topicRef,
          revision: currentRevision, revisionHash: currentHash, status, replayed: true as const, capabilities: CAPABILITIES });
        fail("conflict");
      }
      if (command.operation === "create_active" ? Boolean(head) : !head) fail("invalid_transition");
      if (command.operation !== "create_active" && existing![0]!.status !== "active") fail("invalid_transition");

      // Resolve public refs first, then lock only the selected active rows. Locking
      // every category in a workspace would make an unrelated archive contend.
      const categoryCandidates = requestedCategories.length === 0 ? [] : rows<{ id: unknown; dimension_key: unknown; definition_key: unknown }>(await tx.execute(sql`
        select definition.id::text, dimension.key as dimension_key, definition.key as definition_key
        from category_definitions definition join category_dimensions dimension
          on dimension.workspace_id = definition.workspace_id and dimension.id = definition.dimension_id
        where definition.workspace_id = ${input.workspaceId}::uuid and definition.archived_at is null
          and dimension.archived_at is null`));
      const resolved = new Map<string, string>();
      for (const category of categoryCandidates) {
        if (typeof category.id !== "string" || !UUID.test(category.id) || typeof category.dimension_key !== "string"
          || typeof category.definition_key !== "string") fail("corrupt_store");
        let publicRef: string;
        try { publicRef = categoryDefinitionPublicRef(category.dimension_key, category.definition_key); } catch { fail("corrupt_store"); }
        if (requestedCategories.includes(publicRef) && (resolved.has(publicRef) || !UUID.test(category.id))) fail("corrupt_store");
        if (requestedCategories.includes(publicRef)) resolved.set(publicRef, category.id);
      }
      if (resolved.size !== requestedCategories.length) fail("not_found");
      const categoryIds = [...resolved.values()];
      if (categoryIds.length > 0) {
        const locked = rows<{ id: unknown }>(await tx.execute(sql`
          select definition.id::text from category_definitions definition join category_dimensions dimension
            on dimension.workspace_id = definition.workspace_id and dimension.id = definition.dimension_id
          where definition.workspace_id = ${input.workspaceId}::uuid and definition.id = any(${categoryIds}::uuid[])
            and definition.archived_at is null and dimension.archived_at is null for update`));
        if (locked.length !== categoryIds.length || new Set(locked.map((row) => String(row.id))).size !== categoryIds.length
          || locked.some((row) => typeof row.id !== "string" || !categoryIds.includes(row.id))) fail("conflict");
      }

      const revision = currentRevision + 1; const previousRevisionHash = currentRevision === 0 ? null : currentHash;
      const core = Object.freeze({ schemaVersion: "authority-topic/1.0.0", workspaceRef: input.workspaceRef,
        topicRef: command.topicRef, revision, previousRevisionHash, status, categoryRefs: requestedCategories,
        actor: Object.freeze({ ref: input.actorRef, role: input.role }), recordedAt: input.occurredAt, authority: CAPABILITIES });
      const revisionHash = digest(core); const payload = Object.freeze({ ...core, revisionHash });
      const topicId = head ? String(head.id) : randomUUID(); const revisionId = randomUUID();
      if (!head) await tx.execute(sql`insert into authority_topics (id, workspace_id, topic_ref)
        values (${topicId}::uuid, ${input.workspaceId}::uuid, ${command.topicRef})`);
      await tx.execute(sql`insert into authority_topic_revisions (id, workspace_id, topic_id, topic_ref, revision,
        previous_revision_hash, revision_hash, status, payload, recorded_at) values (${revisionId}::uuid,
        ${input.workspaceId}::uuid, ${topicId}::uuid, ${command.topicRef}, ${revision}, ${previousRevisionHash},
        ${revisionHash}, ${status}, ${JSON.stringify(payload)}::jsonb, ${input.occurredAt}::timestamptz)`);
      for (const categoryRef of requestedCategories) {
        const categoryId = resolved.get(categoryRef); if (!categoryId) fail("corrupt_store");
        const bindingCore = Object.freeze({ schemaVersion: "category-topic-binding/1.0.0", workspaceRef: input.workspaceRef,
          categoryRef, topicRef: command.topicRef, topicRevision: revision, topicRevisionHash: revisionHash });
        await tx.execute(sql`insert into category_topic_bindings (id, workspace_id, category_definition_id, topic_revision_id,
          binding_ref, binding_hash) values (${randomUUID()}::uuid, ${input.workspaceId}::uuid, ${categoryId}::uuid,
          ${revisionId}::uuid, ${`category_topic_binding_${digest({ categoryRef, revision, topicRef: command.topicRef }).slice(0, 24)}`},
          ${digest(bindingCore)})`);
      }
      const advanced = rows(await tx.execute(sql`update authority_topics set current_revision = ${revision}, current_revision_hash = ${revisionHash}
        where workspace_id = ${input.workspaceId}::uuid and id = ${topicId}::uuid and current_revision = ${currentRevision}
          and (${currentRevision} = 0 or current_revision_hash = ${currentHash}) returning id`));
      if (advanced.length !== 1) fail(advanced.length === 0 ? "conflict" : "corrupt_store");
      await invalidatePersistedPolicyAuthorityContexts({ executor: tx, workspaceId: input.workspaceId,
        observedAt: input.occurredAt, changeRef: revisionHash });
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`audit:${input.workspaceId}`}, 0))`);
      const previousAuditHash = String(rows<{ event_hash: unknown }>(await tx.execute(sql`select event_hash from audit_events
        where workspace_id = ${input.workspaceId}::uuid order by occurred_at desc, created_at desc, id desc limit 1`))[0]?.event_hash ?? "GENESIS");
      const event = Object.freeze({ id: randomUUID(), workspaceId: input.workspaceId, actorId: input.actorId,
        action: `authority_topic.${command.operation}`, resourceType: "authority_topic", resourceId: command.topicRef,
        metadata: Object.freeze({ revision, revisionHash, status, categoryRefs: requestedCategories }), previousHash: previousAuditHash,
        occurredAt: input.occurredAt });
      await tx.execute(sql`insert into audit_events (id, workspace_id, actor_id, action, resource_type, resource_id,
        metadata, previous_hash, event_hash, occurred_at) values (${event.id}::uuid, ${event.workspaceId}::uuid,
        ${event.actorId}::uuid, ${event.action}, ${event.resourceType}, ${event.resourceId}, ${JSON.stringify(event.metadata)}::jsonb,
        ${event.previousHash}, ${digest(event)}, ${event.occurredAt}::timestamptz)`);
      return Object.freeze({ topicRef: command.topicRef, revision, revisionHash, status, replayed: false as const,
        capabilities: CAPABILITIES });
    });
  }
}
