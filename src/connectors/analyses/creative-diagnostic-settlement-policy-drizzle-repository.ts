import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { createCreativeDiagnosticSettlementPolicy, type CreativeDiagnosticSettlementPolicy } from "@/analyses/creative-diagnostic-settlement-policy";
import { advanceCreativeDiagnosticSettlementPolicy } from "@/analyses/creative-diagnostic-settlement-policy-lifecycle";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
type Row = Readonly<Record<string, unknown>>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REF = /^creative_settlement_[a-f0-9]{24}$/;

export class CreativeDiagnosticSettlementPolicyRepositoryError extends Error {
  constructor(readonly code: "invalid_input" | "not_found" | "forbidden" | "conflict" | "corrupt_store") {
    super(`Creative diagnostic settlement policy rejected: ${code}`);
    this.name = "CreativeDiagnosticSettlementPolicyRepositoryError";
  }
}
function fail(code: CreativeDiagnosticSettlementPolicyRepositoryError["code"]): never { throw new CreativeDiagnosticSettlementPolicyRepositoryError(code); }
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
function iso(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail("invalid_input");
  return value;
}
function reconstruct(row: Readonly<{ revision: unknown; policy_hash: unknown; previous_hash: unknown; state: unknown; settlement_lag_days: unknown; payload: unknown }>): CreativeDiagnosticSettlementPolicy {
  if (!row.payload || typeof row.payload !== "object" || Array.isArray(row.payload) || typeof row.revision !== "number"
    || typeof row.policy_hash !== "string" || (row.previous_hash !== null && typeof row.previous_hash !== "string")
    || typeof row.state !== "string" || typeof row.settlement_lag_days !== "number") fail("corrupt_store");
  const payload = row.payload as Record<string, unknown>;
  let policy: CreativeDiagnosticSettlementPolicy;
  try { policy = createCreativeDiagnosticSettlementPolicy({
    policyRef: payload.policyRef as string, revision: payload.revision as number, previousHash: payload.previousHash as string | null,
    state: payload.state as "draft" | "published" | "retired", settlementLagDays: payload.settlementLagDays as number,
  }); } catch { fail("corrupt_store"); }
  if (policy.revision !== row.revision || policy.policyHash !== row.policy_hash || policy.previousHash !== row.previous_hash
    || policy.state !== row.state || policy.settlementLagDays !== row.settlement_lag_days
    || JSON.stringify(stable(payload)) !== JSON.stringify(stable(policy))) fail("corrupt_store");
  return policy;
}

export type PrivateCreativeDiagnosticSettlementPolicyCommand = Readonly<{
  policy: Omit<CreativeDiagnosticSettlementPolicy, "contractVersion" | "policyHash">;
}>;
const capabilities = Object.freeze({ canPublish: false as const, canApprove: false as const, canExecute: false as const, canWriteMeta: false as const, canAccessNetwork: false as const });

/** Server-private settlement-policy ledger; it exposes no action, approval, or transport capability. */
export class DrizzleCreativeDiagnosticSettlementPolicyRepository {
  constructor(private readonly database: Database) {}

  async loadCurrentPublished(input: Readonly<{ workspaceId: string; policyRef: string }>): Promise<CreativeDiagnosticSettlementPolicy> {
    if (!UUID.test(input.workspaceId) || !REF.test(input.policyRef)) fail("invalid_input");
    const found = rows<{ revision: unknown; policy_hash: unknown; previous_hash: unknown; state: unknown; settlement_lag_days: unknown; payload: unknown }>(await this.database.execute(sql`
      select revision.revision, revision.policy_hash, revision.previous_hash, revision.state, revision.settlement_lag_days, revision.payload
      from creative_diagnostic_settlement_policies head
      join creative_diagnostic_settlement_policy_revisions revision on revision.workspace_id = head.workspace_id
        and revision.policy_id = head.id and revision.revision = head.current_revision and revision.policy_hash = head.current_policy_hash
      where head.workspace_id = ${input.workspaceId}::uuid and head.policy_ref = ${input.policyRef}`));
    if (found.length !== 1) fail(found.length === 0 ? "not_found" : "corrupt_store");
    const policy = reconstruct(found[0]!);
    if (policy.state !== "published") fail("not_found");
    return policy;
  }

  async append(input: Readonly<{ workspaceId: string; actorId: string; actorRef: string; role: "owner" | "admin"; occurredAt: string; command: PrivateCreativeDiagnosticSettlementPolicyCommand; }>): Promise<Readonly<{ policy: CreativeDiagnosticSettlementPolicy; replayed: boolean; capabilities: typeof capabilities }>> {
    if (!UUID.test(input.workspaceId) || !UUID.test(input.actorId) || !["owner", "admin"].includes(input.role) || typeof input.actorRef !== "string" || !input.actorRef.trim()) fail("invalid_input");
    const occurredAt = iso(input.occurredAt);
    let supplied: CreativeDiagnosticSettlementPolicy;
    try { supplied = createCreativeDiagnosticSettlementPolicy(input.command.policy); } catch { fail("invalid_input"); }
    return this.database.transaction(async (transaction) => {
      const tx = transaction as unknown as Database;
      if (rows(await tx.execute(sql`select id from workspaces where id = ${input.workspaceId}::uuid and lifecycle_state = 'active' for update`)).length !== 1) fail("not_found");
      const membership = rows<{ role: unknown }>(await tx.execute(sql`select role::text from memberships where workspace_id = ${input.workspaceId}::uuid and user_id = ${input.actorId}::uuid for update`));
      if (membership.length !== 1 || membership[0]!.role !== input.role) fail("forbidden");
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`creative-diagnostic-settlement:${input.workspaceId}:${supplied.policyRef}`}, 0))`);
      const heads = rows<{ id: unknown; current_revision: unknown; current_policy_hash: unknown }>(await tx.execute(sql`
        select id, current_revision, current_policy_hash from creative_diagnostic_settlement_policies
        where workspace_id = ${input.workspaceId}::uuid and policy_ref = ${supplied.policyRef} for update`));
      if (heads.length > 1) fail("corrupt_store");
      const head = heads[0] ?? null;
      if (head && (!UUID.test(String(head.id)) || !Number.isSafeInteger(head.current_revision) || head.current_revision === 0 && head.current_policy_hash !== null)) fail("corrupt_store");
      const previousRows = rows<{ revision: unknown; policy_hash: unknown; previous_hash: unknown; state: unknown; settlement_lag_days: unknown; payload: unknown }>(await tx.execute(sql`
        select revision, policy_hash, previous_hash, state, settlement_lag_days, payload
        from creative_diagnostic_settlement_policy_revisions where workspace_id = ${input.workspaceId}::uuid and policy_ref = ${supplied.policyRef}
        order by revision desc limit 2 for update`));
      if (previousRows.length > 2) fail("corrupt_store");
      const previous = previousRows[0] ? reconstruct(previousRows[0]) : null;
      const predecessor = previousRows[1] ? reconstruct(previousRows[1]) : null;
      if (previous && predecessor && (previous.revision !== predecessor.revision + 1 || previous.previousHash !== predecessor.policyHash)) fail("corrupt_store");
      if ((head === null) !== (previous === null) || (head && previous && (head.current_revision !== previous.revision || head.current_policy_hash !== previous.policyHash))) fail("corrupt_store");
      if (previous && JSON.stringify(stable(previous)) === JSON.stringify(stable(supplied))) return Object.freeze({ policy: previous, replayed: true, capabilities });
      let policy: CreativeDiagnosticSettlementPolicy;
      try { policy = advanceCreativeDiagnosticSettlementPolicy({ previous, next: input.command.policy }); } catch { fail("conflict"); }
      const policyId = head ? String(head.id) : randomUUID();
      if (!head) await tx.execute(sql`insert into creative_diagnostic_settlement_policies (id, workspace_id, policy_ref, current_revision, current_policy_hash)
        values (${policyId}::uuid, ${input.workspaceId}::uuid, ${policy.policyRef}, 0, null)`);
      await tx.execute(sql`insert into creative_diagnostic_settlement_policy_revisions
        (id, workspace_id, policy_id, policy_ref, revision, previous_hash, policy_hash, state, settlement_lag_days, payload, recorded_at)
        values (${randomUUID()}::uuid, ${input.workspaceId}::uuid, ${policyId}::uuid, ${policy.policyRef}, ${policy.revision}, ${policy.previousHash}, ${policy.policyHash}, ${policy.state}, ${policy.settlementLagDays}, ${JSON.stringify(policy)}::jsonb, ${occurredAt}::timestamptz)`);
      await tx.execute(sql`update creative_diagnostic_settlement_policies set current_revision = ${policy.revision}, current_policy_hash = ${policy.policyHash}
        where workspace_id = ${input.workspaceId}::uuid and id = ${policyId}::uuid and current_revision = ${previous?.revision ?? 0} and current_policy_hash is not distinct from ${previous?.policyHash ?? null}`);
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`audit:${input.workspaceId}`}, 0))`);
      const previousAuditHash = String(rows<{ event_hash: unknown }>(await tx.execute(sql`select event_hash from audit_events where workspace_id = ${input.workspaceId}::uuid order by occurred_at desc, created_at desc, id desc limit 1`))[0]?.event_hash ?? "GENESIS");
      const event = Object.freeze({ id: randomUUID(), workspaceId: input.workspaceId, actorId: input.actorId, action: "creative_diagnostic_settlement_policy.append", resourceType: "creative_diagnostic_settlement_policy", resourceId: policy.policyRef, metadata: Object.freeze({ revision: policy.revision, policyHash: policy.policyHash, state: policy.state, actorRef: input.actorRef }), previousHash: previousAuditHash, occurredAt });
      await tx.execute(sql`insert into audit_events (id, workspace_id, actor_id, action, resource_type, resource_id, metadata, previous_hash, event_hash, occurred_at)
        values (${event.id}::uuid, ${event.workspaceId}::uuid, ${event.actorId}::uuid, ${event.action}, ${event.resourceType}, ${event.resourceId}, ${JSON.stringify(event.metadata)}::jsonb, ${event.previousHash}, ${digest(event)}, ${event.occurredAt}::timestamptz)`);
      return Object.freeze({ policy, replayed: false, capabilities });
    });
  }
}
