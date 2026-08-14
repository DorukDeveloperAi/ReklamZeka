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
const SEMANTIC_REF = /^semantic_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const CAPABILITIES = Object.freeze({ canPublish: false as const, canApprove: false as const,
  canExecute: false as const, canWriteMeta: false as const, canSchedule: false as const,
  canCallTool: false as const, canAccessNetwork: false as const, canQuerySql: false as const });

export class PolicySemanticBindingLifecycleError extends Error {
  constructor(readonly code: "invalid_input" | "not_found" | "forbidden" | "conflict" | "corrupt_store") {
    super(`Policy semantic binding rejected: ${code}`); this.name = "PolicySemanticBindingLifecycleError";
  }
}
function fail(code: PolicySemanticBindingLifecycleError["code"]): never { throw new PolicySemanticBindingLifecycleError(code); }
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
function hash(value: unknown): string { if (typeof value !== "string" || !HASH.test(value)) fail("invalid_input"); return value; }
function ref(value: unknown, expression = REF): string { if (typeof value !== "string" || !expression.test(value)) fail("invalid_input"); return value; }
function iso(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail("invalid_input");
  return value;
}

/** A bounded, canonical JSON fact; it is descriptive evidence, never authority. */
function canonicalFact(value: unknown): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail("invalid_input");
  const serialized = JSON.stringify(stable(value));
  if (serialized.length < 2 || serialized.length > 16_000 || /\u0000/.test(serialized)
    || /"(?:authority|token|secret|authorization|approvalgranted)"\s*:/i.test(serialized)) fail("invalid_input");
  return Object.freeze(stable(value) as Record<string, unknown>);
}
function exactReplay(payload: unknown, core: Readonly<Record<string, unknown>>): boolean {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return false;
  const { revisionHash: _hash, ...existing } = payload as Record<string, unknown>;
  return JSON.stringify(stable(existing)) === JSON.stringify(stable(core));
}

export type PrivatePolicySemanticBindingCommand = Readonly<{
  policyRef: string;
  expectedPolicyVersion: number;
  expectedPolicyHash: string;
  semanticRef: string;
  expectedHeadHash: "GENESIS" | string;
  fact: Readonly<Record<string, unknown>>;
}>;

/**
 * Server-private append-only semantic evidence lifecycle. It deliberately has
 * no controller, HTTP, MCP, or action adapter: binding a fact cannot publish,
 * approve, execute, or write to Meta.
 */
export class DrizzlePolicySemanticBindingLifecycleRepository {
  constructor(private readonly database: Database) {}

  async append(input: Readonly<{ workspaceId: string; workspaceRef: string; actorId: string; actorRef: string;
    role: "owner" | "admin"; occurredAt: string; command: PrivatePolicySemanticBindingCommand }>) {
    const command = input.command;
    if (!UUID.test(input.workspaceId) || !UUID.test(input.actorId) || !["owner", "admin"].includes(input.role)
      || !Number.isSafeInteger(command.expectedPolicyVersion) || command.expectedPolicyVersion < 1
      || command.expectedPolicyVersion > 1_000_000) fail("invalid_input");
    ref(input.workspaceRef); ref(input.actorRef); ref(command.policyRef); ref(command.semanticRef, SEMANTIC_REF);
    hash(command.expectedPolicyHash); if (command.expectedHeadHash !== "GENESIS") hash(command.expectedHeadHash);
    iso(input.occurredAt); const fact = canonicalFact(command.fact);

    return this.database.transaction(async (transaction) => {
      const tx = transaction as unknown as Database;
      if (rows(await tx.execute(sql`select id from workspaces where id = ${input.workspaceId}::uuid
        and lifecycle_state = 'active' for update`)).length !== 1) fail("not_found");
      const membership = rows<{ role: unknown }>(await tx.execute(sql`select role::text from memberships
        where workspace_id = ${input.workspaceId}::uuid and user_id = ${input.actorId}::uuid for update`));
      if (membership.length !== 1 || membership[0]!.role !== input.role) fail("forbidden");
      const policies = rows<{ id: unknown; workspace_ref: unknown; policy_version: unknown; canonical_hash: unknown; status: unknown }>(
        await tx.execute(sql`select id::text, workspace_ref, policy_version, canonical_hash, status
          from strict_instruction_policy_revisions where workspace_id = ${input.workspaceId}::uuid
            and policy_ref = ${command.policyRef} and policy_version = ${command.expectedPolicyVersion}
          limit 2 for update`),
      );
      if (policies.length !== 1) fail(policies.length === 0 ? "not_found" : "corrupt_store");
      const policy = policies[0]!;
      if (policy.workspace_ref !== input.workspaceRef || policy.canonical_hash !== command.expectedPolicyHash
        || policy.status !== "published" || typeof policy.id !== "string" || !UUID.test(policy.id)) fail("conflict");
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`policy-semantic:${input.workspaceId}:${policy.id}:${command.semanticRef}`}, 0))`);
      const heads = rows<{ revision: unknown; revision_hash: unknown; payload: unknown }>(await tx.execute(sql`
        select revision, revision_hash, payload from policy_semantic_binding_revisions
        where workspace_id = ${input.workspaceId}::uuid and policy_revision_id = ${policy.id}::uuid
          and semantic_ref = ${command.semanticRef} order by revision desc limit 1 for update`));
      const head = heads[0];
      if (head && (!Number.isSafeInteger(Number(head.revision)) || Number(head.revision) < 1 || !HASH.test(String(head.revision_hash)))) fail("corrupt_store");
      const previousHash = head ? String(head.revision_hash) : "GENESIS";
      const revision = head ? Number(head.revision) + 1 : 1;
      const core = Object.freeze({ schemaVersion: "policy-semantic-binding/1.0.0", workspaceRef: input.workspaceRef,
        policyRef: command.policyRef, policyVersion: command.expectedPolicyVersion, policyHash: command.expectedPolicyHash,
        semanticRef: command.semanticRef, revision, previousRevisionHash: head ? previousHash : null, fact,
        actor: Object.freeze({ ref: input.actorRef, role: input.role }), recordedAt: input.occurredAt, authority: CAPABILITIES });
      if (previousHash !== command.expectedHeadHash) {
        // Retries are idempotent only when the latest immutable fact is exactly this command.
        if (head && exactReplay(head.payload, Object.freeze({ ...core, revision: Number(head.revision),
          previousRevisionHash: command.expectedHeadHash === "GENESIS" ? null : command.expectedHeadHash }))) {
          return Object.freeze({ semanticRef: command.semanticRef, revision: Number(head.revision), revisionHash: previousHash,
            replayed: true as const, capabilities: CAPABILITIES });
        }
        fail("conflict");
      }
      const revisionHash = digest(core); const payload = Object.freeze({ ...core, revisionHash });
      await tx.execute(sql`insert into policy_semantic_binding_revisions (id, workspace_id, policy_revision_id, semantic_ref,
        revision, previous_revision_hash, revision_hash, payload, recorded_at) values (${randomUUID()}::uuid,
        ${input.workspaceId}::uuid, ${policy.id}::uuid, ${command.semanticRef}, ${revision},
        ${head ? previousHash : null}, ${revisionHash}, ${JSON.stringify(payload)}::jsonb, ${input.occurredAt}::timestamptz)`);
      await invalidatePersistedPolicyAuthorityContexts({ executor: tx, workspaceId: input.workspaceId,
        observedAt: input.occurredAt, changeRef: revisionHash });
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`audit:${input.workspaceId}`}, 0))`);
      const previousAuditHash = String(rows<{ event_hash: unknown }>(await tx.execute(sql`select event_hash from audit_events
        where workspace_id = ${input.workspaceId}::uuid order by occurred_at desc, created_at desc, id desc limit 1`))[0]?.event_hash ?? "GENESIS");
      const event = Object.freeze({ id: randomUUID(), workspaceId: input.workspaceId, actorId: input.actorId,
        action: "policy_semantic_binding.append", resourceType: "strict_instruction_policy", resourceId: command.policyRef,
        metadata: Object.freeze({ semanticRef: command.semanticRef, revision, revisionHash, policyVersion: command.expectedPolicyVersion }),
        previousHash: previousAuditHash, occurredAt: input.occurredAt });
      await tx.execute(sql`insert into audit_events (id, workspace_id, actor_id, action, resource_type, resource_id,
        metadata, previous_hash, event_hash, occurred_at) values (${event.id}::uuid, ${event.workspaceId}::uuid,
        ${event.actorId}::uuid, ${event.action}, ${event.resourceType}, ${event.resourceId}, ${JSON.stringify(event.metadata)}::jsonb,
        ${event.previousHash}, ${digest(event)}, ${event.occurredAt}::timestamptz)`);
      return Object.freeze({ semanticRef: command.semanticRef, revision, revisionHash, replayed: false as const, capabilities: CAPABILITIES });
    });
  }
}
