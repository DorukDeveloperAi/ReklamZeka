import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { EFFECTIVE_CONTEXT_POLICY_AUTHORITY_COMPONENT_REF } from "@/analyses/effective-campaign-context";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
type Row = Readonly<Record<string, unknown>>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;

export class PolicyManualLockRepositoryError extends Error {
  constructor(readonly code: "invalid_input" | "not_found" | "forbidden" | "conflict" | "invalid_transition" | "corrupt_store") {
    super(`Manual policy lock rejected: ${code}`); this.name = "PolicyManualLockRepositoryError";
  }
}
function fail(code: PolicyManualLockRepositoryError["code"]): never { throw new PolicyManualLockRepositoryError(code); }
function rows<T extends Row = Row>(value: unknown): readonly T[] {
  if (!value || typeof value !== "object" || !("rows" in value) || !Array.isArray(value.rows)) fail("corrupt_store");
  return value.rows as readonly T[];
}
function digest(value: unknown): string {
  const stable = (item: unknown): unknown => Array.isArray(item) ? item.map(stable)
    : item && typeof item === "object" ? Object.fromEntries(Object.entries(item as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)])) : item;
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}
function hash(value: unknown): string { if (typeof value !== "string" || !HASH.test(value)) fail("invalid_input"); return value; }
function ref(value: unknown, pattern = REF): string { if (typeof value !== "string" || !pattern.test(value)) fail("invalid_input"); return value; }
function iso(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail("invalid_input");
  return value;
}

export type PrivatePolicyManualLockCommand = Readonly<{
  policyRef: string;
  expectedPolicyVersion: number;
  expectedPolicyHash: string;
  lockRef: string;
  expectedHeadHash: "GENESIS" | string;
  operation: "lock" | "unlock";
  reasonCode: string;
  ownerConfirmation: Readonly<{ confirmed: true; confirmationRef: string }>;
}>;

/** Private persistence port. There is deliberately no HTTP/MCP adapter for this mutation. */
export class DrizzlePolicyManualLockRepository {
  constructor(private readonly database: Database) {}

  async append(input: Readonly<{ workspaceId: string; workspaceRef: string; actorId: string; actorRef: string;
    role: "owner" | "admin"; occurredAt: string; command: PrivatePolicyManualLockCommand }>) {
    const command = input.command;
    if (!UUID.test(input.workspaceId) || !UUID.test(input.actorId) || !REF.test(input.workspaceRef) || !REF.test(input.actorRef)
      || !["owner", "admin"].includes(input.role) || !Number.isSafeInteger(command.expectedPolicyVersion)
      || command.expectedPolicyVersion < 1 || command.expectedPolicyVersion > 1_000_000
      || !["lock", "unlock"].includes(command.operation) || !/^[a-z][a-z0-9_]{2,63}$/.test(command.reasonCode)
      || !command.ownerConfirmation || command.ownerConfirmation.confirmed !== true
      || !/^confirmation_[a-z0-9][a-z0-9_.:-]{0,126}$/.test(command.ownerConfirmation.confirmationRef)) fail("invalid_input");
    ref(command.policyRef); ref(command.lockRef, /^manual_lock_[a-z0-9][a-z0-9_.:-]{0,126}$/);
    hash(command.expectedPolicyHash); if (command.expectedHeadHash !== "GENESIS") hash(command.expectedHeadHash); iso(input.occurredAt);

    return this.database.transaction(async (transaction) => {
      const tx = transaction as unknown as Database;
      if (rows(await tx.execute(sql`select id from workspaces where id = ${input.workspaceId}::uuid
        and lifecycle_state = 'active' for update`)).length !== 1) fail("not_found");
      const membership = rows<{ role: unknown }>(await tx.execute(sql`select role::text from memberships
        where workspace_id = ${input.workspaceId}::uuid and user_id = ${input.actorId}::uuid limit 2`));
      if (membership.length !== 1 || membership[0]!.role !== input.role) fail("forbidden");
      const policies = rows<{ id: unknown; workspace_ref: unknown; policy_version: unknown; canonical_hash: unknown; status: unknown }>(
        await tx.execute(sql`select id::text, workspace_ref, policy_version, canonical_hash, status
          from strict_instruction_policy_revisions where workspace_id = ${input.workspaceId}::uuid
            and policy_ref = ${command.policyRef} order by policy_version desc limit 2 for update`),
      );
      if (policies.length !== 1) fail(policies.length === 0 ? "not_found" : "corrupt_store");
      const policy = policies[0]!;
      if (policy.workspace_ref !== input.workspaceRef || Number(policy.policy_version) !== command.expectedPolicyVersion
        || policy.canonical_hash !== command.expectedPolicyHash || policy.status !== "published" || typeof policy.id !== "string" || !UUID.test(policy.id)) fail("conflict");
      const heads = rows<{ sequence: unknown; revision_hash: unknown; operation: unknown }>(await tx.execute(sql`
        select sequence, revision_hash, operation from policy_manual_lock_revisions
        where workspace_id = ${input.workspaceId}::uuid and policy_revision_id = ${policy.id}::uuid and lock_ref = ${command.lockRef}
        order by sequence desc limit 2 for update`));
      if (heads.length > 1) fail("corrupt_store");
      const head = heads[0]; const previousHash = head ? String(head.revision_hash) : "GENESIS";
      if (previousHash !== command.expectedHeadHash) fail("conflict");
      if (head && (!Number.isSafeInteger(Number(head.sequence)) || !HASH.test(previousHash))) fail("corrupt_store");
      if (command.operation === "lock" ? head?.operation === "lock" : head?.operation !== "lock") fail("invalid_transition");
      const sequence = head ? Number(head.sequence) + 1 : 1;
      const revisionCore = Object.freeze({ version: "policy-manual-lock/1.0.0", workspaceRef: input.workspaceRef,
        lockRef: command.lockRef, policyRef: command.policyRef, policyVersion: command.expectedPolicyVersion,
        policyHash: command.expectedPolicyHash, sequence, previousRevisionHash: head ? previousHash : null,
        operation: command.operation, reasonCode: command.reasonCode, actor: { ref: input.actorRef, role: input.role },
        confirmationRef: command.ownerConfirmation.confirmationRef, recordedAt: input.occurredAt,
        authority: { canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false } });
      const revisionHash = digest(revisionCore);
      const payload = Object.freeze({ ...revisionCore, revisionHash });
      await tx.execute(sql`insert into policy_manual_lock_revisions (id, workspace_id, policy_revision_id, lock_ref,
        sequence, previous_revision_hash, revision_hash, operation, actor_ref, actor_role, reason_code, payload, recorded_at)
        values (${randomUUID()}::uuid, ${input.workspaceId}::uuid, ${policy.id}::uuid, ${command.lockRef}, ${sequence},
          ${head ? previousHash : null}, ${revisionHash}, ${command.operation}, ${input.actorRef}, ${input.role},
          ${command.reasonCode}, ${JSON.stringify(payload)}::jsonb, ${input.occurredAt}::timestamptz)`);
      const invalidation = Object.freeze({ workspaceId: input.workspaceId, componentType: "policy_authority",
        componentRef: EFFECTIVE_CONTEXT_POLICY_AUTHORITY_COMPONENT_REF, componentVersion: command.expectedPolicyHash,
        scopeKind: "workspace_component", entityType: null, entityRef: null, reasonCode: "source_changed", observedAt: input.occurredAt,
        lockRef: command.lockRef, revisionHash });
      await tx.execute(sql`insert into effective_campaign_context_invalidations (workspace_id, event_hash, component_type,
        component_ref, component_version, scope_kind, entity_type, entity_ref, reason_code, observed_at)
        values (${input.workspaceId}::uuid, ${digest(invalidation)}, 'policy_authority',
          ${EFFECTIVE_CONTEXT_POLICY_AUTHORITY_COMPONENT_REF}, ${command.expectedPolicyHash}, 'workspace_component',
          null, null, 'source_changed', ${input.occurredAt}::timestamptz) on conflict (workspace_id, event_hash) do nothing`);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`audit:${input.workspaceId}`}, 0))`);
      const previousAuditHash = String(rows<{ event_hash: unknown }>(await tx.execute(sql`select event_hash from audit_events
        where workspace_id = ${input.workspaceId}::uuid order by occurred_at desc, created_at desc, id desc limit 1`))[0]?.event_hash ?? "GENESIS");
      const event = Object.freeze({ id: randomUUID(), workspaceId: input.workspaceId, actorId: input.actorId,
        action: `policy_manual_lock.${command.operation}`, resourceType: "strict_instruction_policy", resourceId: command.policyRef,
        metadata: { lockRef: command.lockRef, sequence, revisionHash, confirmationRef: command.ownerConfirmation.confirmationRef },
        previousHash: previousAuditHash, occurredAt: input.occurredAt });
      await tx.execute(sql`insert into audit_events (id, workspace_id, actor_id, action, resource_type, resource_id,
        metadata, previous_hash, event_hash, occurred_at) values (${event.id}::uuid, ${event.workspaceId}::uuid,
          ${event.actorId}::uuid, ${event.action}, ${event.resourceType}, ${event.resourceId},
          ${JSON.stringify(event.metadata)}::jsonb, ${event.previousHash}, ${digest(event)}, ${event.occurredAt}::timestamptz)`);
      return Object.freeze({ lockRef: command.lockRef, sequence, revisionHash, operation: command.operation,
        capabilities: Object.freeze({ canPublish: false as const, canApprove: false as const, canExecute: false as const, canWriteMeta: false as const }) });
    });
  }
}
