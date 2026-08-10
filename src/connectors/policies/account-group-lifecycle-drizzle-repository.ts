import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { invalidatePersistedPolicyAuthorityContexts } from "@/connectors/policies/policy-authority-context-invalidation";

type Database = NodePgDatabase<typeof schema>;
type Row = Readonly<Record<string, unknown>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const GROUP_REF = /^account_group_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const CAPABILITIES = Object.freeze({ canPublish: false as const, canApprove: false as const,
  canExecute: false as const, canWriteMeta: false as const, canSchedule: false as const,
  canCallTool: false as const, canAccessNetwork: false as const, canQuerySql: false as const });

export class AccountGroupLifecycleError extends Error {
  constructor(readonly code: "invalid_input" | "not_found" | "forbidden" | "conflict" | "invalid_transition" | "corrupt_store") {
    super(`Account group lifecycle rejected: ${code}`); this.name = "AccountGroupLifecycleError";
  }
}

function fail(code: AccountGroupLifecycleError["code"]): never { throw new AccountGroupLifecycleError(code); }
function rows<T extends Row = Row>(value: unknown): readonly T[] {
  if (!value || typeof value !== "object" || !("rows" in value) || !Array.isArray(value.rows)) fail("corrupt_store");
  return value.rows as readonly T[];
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, stable(child)]));
  return value;
}
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function ref(value: unknown, expression = REF): string { if (typeof value !== "string" || !expression.test(value)) fail("invalid_input"); return value; }
function hash(value: unknown): string { if (typeof value !== "string" || !HASH.test(value)) fail("invalid_input"); return value; }
function iso(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail("invalid_input");
  return value;
}
function accountRefs(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length > 250) fail("invalid_input");
  const values = value.map((entry) => ref(entry));
  const ordered = [...values].sort();
  if (new Set(ordered).size !== ordered.length) fail("invalid_input");
  return Object.freeze(ordered);
}
function exactReplay(payload: unknown, core: Readonly<Record<string, unknown>>): boolean {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const { revisionHash: _revisionHash, ...existing } = payload as Record<string, unknown>;
  return JSON.stringify(stable(existing)) === JSON.stringify(stable(core));
}

export type PrivateAccountGroupLifecycleCommand = Readonly<{
  operation: "create_active" | "revise_active" | "archive";
  groupRef: string;
  expectedHeadHash: "GENESIS" | string;
  accountRefs: readonly string[];
}>;

/**
 * Server-private account-group ledger writer. Its only effect is immutable
 * scope evidence: it has no HTTP, MCP, Meta, approval, or action boundary.
 */
export class DrizzleAccountGroupLifecycleRepository {
  constructor(private readonly database: Database) {}

  async mutate(input: Readonly<{ workspaceId: string; workspaceRef: string; actorId: string; actorRef: string;
    role: "owner" | "admin"; occurredAt: string; command: PrivateAccountGroupLifecycleCommand }>) {
    const command = input.command;
    if (!UUID.test(input.workspaceId) || !UUID.test(input.actorId) || !["owner", "admin"].includes(input.role)
      || !["create_active", "revise_active", "archive"].includes(command.operation)) fail("invalid_input");
    ref(input.workspaceRef); ref(input.actorRef); ref(command.groupRef, GROUP_REF);
    if (command.expectedHeadHash !== "GENESIS") hash(command.expectedHeadHash);
    const requestedAccounts = accountRefs(command.accountRefs); iso(input.occurredAt);
    if ((command.operation === "archive") !== (requestedAccounts.length === 0)) fail("invalid_input");

    return this.database.transaction(async (transaction) => {
      const tx = transaction as unknown as Database;
      if (rows(await tx.execute(sql`select id from workspaces where id = ${input.workspaceId}::uuid
        and lifecycle_state = 'active' for update`)).length !== 1) fail("not_found");
      const membership = rows<{ role: unknown }>(await tx.execute(sql`select role::text from memberships
        where workspace_id = ${input.workspaceId}::uuid and user_id = ${input.actorId}::uuid for update`));
      if (membership.length !== 1 || membership[0]!.role !== input.role) fail("forbidden");
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`account-group:${input.workspaceId}:${command.groupRef}`}, 0))`);

      const heads = rows<{ id: unknown; current_revision: unknown; current_revision_hash: unknown }>(await tx.execute(sql`
        select id::text, current_revision, current_revision_hash from account_groups
        where workspace_id = ${input.workspaceId}::uuid and group_ref = ${command.groupRef} for update`));
      if (heads.length > 1) fail("corrupt_store");
      const head = heads[0];
      if (head !== undefined && (typeof head.id !== "string" || !UUID.test(head.id))) fail("corrupt_store");
      const currentRevision = head === undefined ? 0 : Number(head.current_revision);
      const currentHash = head === undefined ? "GENESIS" : head.current_revision_hash === null ? "GENESIS" : String(head.current_revision_hash);
      if (!Number.isSafeInteger(currentRevision) || currentRevision < 0 || (currentRevision === 0) !== (currentHash === "GENESIS")
        || (currentHash !== "GENESIS" && !HASH.test(currentHash))) fail("corrupt_store");

      const existing = head === undefined ? undefined : rows<{ id: unknown; status: unknown; revision_hash: unknown; payload: unknown }>(await tx.execute(sql`
        select id::text, status, revision_hash, payload from account_group_revisions where workspace_id = ${input.workspaceId}::uuid
          and account_group_id = ${String(head.id)}::uuid and revision = ${currentRevision} and revision_hash = ${currentHash} limit 2 for update`));
      if (existing && existing.length !== 1) fail("corrupt_store");
      if (existing && (typeof existing[0]!.id !== "string" || !UUID.test(existing[0]!.id)
        || !["active", "archived"].includes(String(existing[0]!.status)))) fail("corrupt_store");
      const replayStatus = command.operation === "archive" ? "archived" as const : "active" as const;
      if (currentHash !== command.expectedHeadHash) {
        const replayCore = Object.freeze({ schemaVersion: "account-group/1.0.0", workspaceRef: input.workspaceRef,
          groupRef: command.groupRef, revision: currentRevision,
          previousRevisionHash: command.expectedHeadHash === "GENESIS" ? null : command.expectedHeadHash,
          status: replayStatus, accountRefs: requestedAccounts,
          actor: Object.freeze({ ref: input.actorRef, role: input.role }), recordedAt: input.occurredAt, authority: CAPABILITIES });
        if (existing && exactReplay(existing[0]!.payload, replayCore)) {
          return Object.freeze({ groupRef: command.groupRef, revision: currentRevision, revisionHash: currentHash,
            status: replayStatus, replayed: true as const, capabilities: CAPABILITIES });
        }
        fail("conflict");
      }
      if (command.operation === "create_active" ? head !== undefined : head === undefined) fail("invalid_transition");
      if (command.operation !== "create_active" && existing![0]!.status !== "active") fail("invalid_transition");

      const accountRows = requestedAccounts.length === 0 ? [] : rows<{ id: unknown; external_account_id: unknown }>(await tx.execute(sql`
        select id::text, external_account_id from ad_accounts where workspace_id = ${input.workspaceId}::uuid
          and disappeared_at is null and external_account_id = any(${requestedAccounts}::text[]) for update`));
      const resolved = new Map<string, string>();
      for (const account of accountRows) {
        if (typeof account.id !== "string" || !UUID.test(account.id) || typeof account.external_account_id !== "string"
          || !requestedAccounts.includes(account.external_account_id) || resolved.has(account.external_account_id)) fail("corrupt_store");
        resolved.set(account.external_account_id, account.id);
      }
      if (resolved.size !== requestedAccounts.length) fail("not_found");

      const revision = currentRevision + 1;
      const previousRevisionHash = currentRevision === 0 ? null : currentHash;
      const status = command.operation === "archive" ? "archived" as const : "active" as const;
      const core = Object.freeze({ schemaVersion: "account-group/1.0.0", workspaceRef: input.workspaceRef,
        groupRef: command.groupRef, revision, previousRevisionHash, status, accountRefs: requestedAccounts,
        actor: Object.freeze({ ref: input.actorRef, role: input.role }), recordedAt: input.occurredAt, authority: CAPABILITIES });
      const revisionHash = digest(core); const payload = Object.freeze({ ...core, revisionHash });
      const groupId = head === undefined ? randomUUID() : String(head.id);
      const revisionId = randomUUID();
      if (head === undefined) await tx.execute(sql`insert into account_groups (id, workspace_id, group_ref)
        values (${groupId}::uuid, ${input.workspaceId}::uuid, ${command.groupRef})`);
      await tx.execute(sql`insert into account_group_revisions (id, workspace_id, account_group_id, group_ref, revision,
        previous_revision_hash, revision_hash, status, payload, recorded_at) values (${revisionId}::uuid,
        ${input.workspaceId}::uuid, ${groupId}::uuid, ${command.groupRef}, ${revision}, ${previousRevisionHash},
        ${revisionHash}, ${status}, ${JSON.stringify(payload)}::jsonb, ${input.occurredAt}::timestamptz)`);
      for (const accountRef of requestedAccounts) {
        const adAccountId = resolved.get(accountRef); if (!adAccountId) fail("corrupt_store");
        const bindingCore = Object.freeze({ schemaVersion: "account-group-binding/1.0.0", workspaceRef: input.workspaceRef,
          groupRef: command.groupRef, groupRevision: revision, groupRevisionHash: revisionHash, accountRef });
        const bindingHash = digest(bindingCore);
        await tx.execute(sql`insert into account_group_account_bindings (id, workspace_id, account_group_revision_id, ad_account_id,
          binding_ref, binding_hash) values (${randomUUID()}::uuid, ${input.workspaceId}::uuid, ${revisionId}::uuid,
          ${adAccountId}::uuid, ${`account_group_binding_${digest({ groupRef: command.groupRef, revision, accountRef }).slice(0, 24)}`}, ${bindingHash})`);
      }
      const advanced = rows(await tx.execute(sql`update account_groups set current_revision = ${revision}, current_revision_hash = ${revisionHash}
        where workspace_id = ${input.workspaceId}::uuid and id = ${groupId}::uuid and current_revision = ${currentRevision}
          and (${currentRevision} = 0 or current_revision_hash = ${currentHash}) returning id`));
      if (advanced.length !== 1) fail(advanced.length === 0 ? "conflict" : "corrupt_store");
      await invalidatePersistedPolicyAuthorityContexts({ executor: tx, workspaceId: input.workspaceId,
        observedAt: input.occurredAt, changeRef: revisionHash });
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`audit:${input.workspaceId}`}, 0))`);
      const previousAuditHash = String(rows<{ event_hash: unknown }>(await tx.execute(sql`select event_hash from audit_events
        where workspace_id = ${input.workspaceId}::uuid order by occurred_at desc, created_at desc, id desc limit 1`))[0]?.event_hash ?? "GENESIS");
      const event = Object.freeze({ id: randomUUID(), workspaceId: input.workspaceId, actorId: input.actorId,
        action: `account_group.${command.operation}`, resourceType: "account_group", resourceId: command.groupRef,
        metadata: Object.freeze({ revision, revisionHash, status, accountRefs: requestedAccounts }), previousHash: previousAuditHash,
        occurredAt: input.occurredAt });
      await tx.execute(sql`insert into audit_events (id, workspace_id, actor_id, action, resource_type, resource_id,
        metadata, previous_hash, event_hash, occurred_at) values (${event.id}::uuid, ${event.workspaceId}::uuid,
        ${event.actorId}::uuid, ${event.action}, ${event.resourceType}, ${event.resourceId}, ${JSON.stringify(event.metadata)}::jsonb,
        ${event.previousHash}, ${digest(event)}, ${event.occurredAt}::timestamptz)`);
      return Object.freeze({ groupRef: command.groupRef, revision, revisionHash, status, replayed: false as const,
        capabilities: CAPABILITIES });
    });
  }
}
