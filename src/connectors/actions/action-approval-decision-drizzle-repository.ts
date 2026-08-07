import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import {
  ACTION_APPROVAL_LIFECYCLE_VERSION,
  assertValidApprovalLifecycle,
  decideActionUnit,
  type ActionApprovalGrant,
  type ActionBundle,
  type ApprovalAuditEventIntent,
  type ApprovalDecisionCommand,
  type ApprovalLifecycle,
  type ApprovalUnitState,
  type ResolvedApprovalPolicy,
  type UnitFreshness,
} from "@/domain/actions/approval-lifecycle";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
type DecisionDatabase = Pick<Database, "execute" | "transaction">;
type DecisionExecutor = Pick<Database, "execute">;

export class ActionApprovalDecisionRepositoryError extends Error {
  constructor(readonly code:
    | "invalid_input"
    | "workspace_scope_mismatch"
    | "proposal_missing"
    | "idempotency_conflict"
    | "decision_conflict"
    | "corrupt_store") {
    super(`Action approval decision persistence reddedildi: ${code}`);
    this.name = "ActionApprovalDecisionRepositoryError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, child]) => [key, stable(child)]));
  }
  return value;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function resultRows<T>(result: unknown): readonly T[] {
  if (!result || typeof result !== "object" || !("rows" in result) || !Array.isArray(result.rows)) {
    throw new ActionApprovalDecisionRepositoryError("corrupt_store");
  }
  return result.rows as readonly T[];
}

function instant(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new ActionApprovalDecisionRepositoryError("corrupt_store");
  return date.toISOString();
}

type LockRow = Readonly<{ bundle_id: string; unit_id: string }>;
type SeedRow = Readonly<{
  lifecycle_hash: string;
  trace_hash: string;
  bundle_payload: ActionBundle;
  policy_payload: ResolvedApprovalPolicy;
  unit_payloads: readonly ActionBundle["units"][number][];
  initial_event_ref: string;
  initial_sequence: number;
  initial_previous_hash: string;
  initial_event_hash: string;
  initial_event_type: "lifecycle_initialized";
  initial_occurred_at: Date | string;
  initial_reason_code: string;
}>;
type StoredDecisionRow = Readonly<{
  id: string;
  unit_id: string;
  unit_ref: string;
  unit_hash: string;
  ordinal: number;
  command_ref: string;
  command_hash: string;
  lifecycle_before_hash: string;
  lifecycle_after_hash: string;
  trace_after_hash: string;
  command_payload: ApprovalDecisionCommand;
  event_payloads: readonly ApprovalAuditEventIntent[];
}>;
type StoredGrantRow = Readonly<{
  command_ref: string;
  grant_hash: string;
  grant_payload: ActionApprovalGrant;
}>;

function initialLifecycle(row: SeedRow): ApprovalLifecycle {
  if (!Array.isArray(row.unit_payloads) || digest(row.unit_payloads) !== digest(row.bundle_payload.units)) {
    throw new ActionApprovalDecisionRepositoryError("corrupt_store");
  }
  const event: ApprovalAuditEventIntent = {
    version: ACTION_APPROVAL_LIFECYCLE_VERSION,
    eventRef: row.initial_event_ref,
    sequence: Number(row.initial_sequence),
    previousHash: row.initial_previous_hash,
    eventType: row.initial_event_type,
    bundleRef: row.bundle_payload.bundleRef,
    unitRef: null,
    unitHash: null,
    actorRef: null,
    occurredAt: instant(row.initial_occurred_at),
    reasonCode: row.initial_reason_code,
    eventHash: row.initial_event_hash,
    persistRequested: true,
    persisted: false,
    executionAuthority: "none",
  };
  const units: readonly ApprovalUnitState[] = row.bundle_payload.units.map((unit) => ({
    unitRef: unit.unitRef,
    unitHash: unit.unitHash,
    state: "awaiting_approval",
    decisionRef: null,
    decisionActor: null,
    decidedAt: null,
    reasonCode: null,
    grant: null,
  }));
  const lifecycle: ApprovalLifecycle = {
    version: ACTION_APPROVAL_LIFECYCLE_VERSION,
    bundle: row.bundle_payload,
    policy: row.policy_payload,
    units,
    trace: [event],
    traceHash: row.trace_hash,
    executionAuthority: "none",
  };
  try {
    assertValidApprovalLifecycle(lifecycle);
  } catch {
    throw new ActionApprovalDecisionRepositoryError("corrupt_store");
  }
  if (digest(lifecycle) !== row.lifecycle_hash) throw new ActionApprovalDecisionRepositoryError("corrupt_store");
  return lifecycle;
}

function replay(
  seed: ApprovalLifecycle,
  decisions: readonly StoredDecisionRow[],
  grants: readonly StoredGrantRow[],
): ApprovalLifecycle {
  let lifecycle = seed;
  const grantByCommand = new Map(grants.map((grant) => [grant.command_ref, grant]));
  if (grantByCommand.size !== grants.length) throw new ActionApprovalDecisionRepositoryError("corrupt_store");
  for (const [index, stored] of decisions.entries()) {
    if (stored.ordinal !== index + 1 || stored.command_ref !== stored.command_payload.commandRef
      || stored.unit_ref !== stored.command_payload.unitRef || digest(stored.command_payload) !== stored.command_hash
      || digest(lifecycle) !== stored.lifecycle_before_hash) {
      throw new ActionApprovalDecisionRepositoryError("corrupt_store");
    }
    const definition = lifecycle.bundle.units.find((unit) => unit.unitRef === stored.unit_ref);
    if (!definition || definition.unitHash !== stored.unit_hash) {
      throw new ActionApprovalDecisionRepositoryError("corrupt_store");
    }
    let transition;
    try {
      transition = decideActionUnit(lifecycle, stored.command_payload);
      assertValidApprovalLifecycle(transition.lifecycle);
    } catch {
      throw new ActionApprovalDecisionRepositoryError("corrupt_store");
    }
    if (digest(transition.lifecycle) !== stored.lifecycle_after_hash
      || transition.lifecycle.traceHash !== stored.trace_after_hash
      || digest(transition.auditEventIntents) !== digest(stored.event_payloads)
      || transition.executionAuthority !== "none" || transition.executionPerformed !== false) {
      throw new ActionApprovalDecisionRepositoryError("corrupt_store");
    }
    const state = transition.lifecycle.units.find((unit) => unit.unitRef === stored.unit_ref);
    const storedGrant = grantByCommand.get(stored.command_ref);
    if (stored.command_payload.kind === "approve") {
      if (!state?.grant || !storedGrant || storedGrant.grant_hash !== state.grant.grantHash
        || digest(storedGrant.grant_payload) !== digest(state.grant)) {
        throw new ActionApprovalDecisionRepositoryError("corrupt_store");
      }
      grantByCommand.delete(stored.command_ref);
    } else if (state?.grant || storedGrant) {
      throw new ActionApprovalDecisionRepositoryError("corrupt_store");
    }
    lifecycle = transition.lifecycle;
  }
  if (grantByCommand.size !== 0) throw new ActionApprovalDecisionRepositoryError("corrupt_store");
  return lifecycle;
}

function freshnessOf(lifecycle: ApprovalLifecycle): readonly UnitFreshness[] {
  return lifecycle.bundle.units.map((unit) => Object.freeze({
    unitRef: unit.unitRef,
    planRevision: unit.plan.revision,
    planHash: unit.plan.planHash,
    sourceHash: unit.sourceHash,
    contextHash: unit.contextHash,
    specHash: unit.specHash,
  }));
}

async function loadLifecycle(
  executor: DecisionExecutor,
  workspaceId: string,
  bundleId: string,
): Promise<Readonly<{ lifecycle: ApprovalLifecycle; decisions: readonly StoredDecisionRow[] }>> {
  const seeds = resultRows<SeedRow>(await executor.execute(sql`
    select b.lifecycle_hash, b.trace_hash, b.bundle_payload, p.policy_payload,
      coalesce(jsonb_agg(u.unit_payload order by u.ordinal), '[]'::jsonb) as unit_payloads,
      i.event_ref as initial_event_ref, i.sequence as initial_sequence,
      i.previous_hash as initial_previous_hash, i.event_hash as initial_event_hash,
      i.event_type as initial_event_type, i.occurred_at as initial_occurred_at,
      i.reason_code as initial_reason_code
    from action_proposal_bundles b
    join action_approval_policy_snapshots p
      on p.workspace_id = b.workspace_id and p.id = b.policy_snapshot_id
    join action_proposal_units u
      on u.workspace_id = b.workspace_id and u.bundle_id = b.id
    join action_proposal_initial_events i
      on i.workspace_id = b.workspace_id and i.bundle_id = b.id
    where b.workspace_id = ${workspaceId}::uuid and b.id = ${bundleId}::uuid
    group by b.id, b.lifecycle_hash, b.trace_hash, b.bundle_payload, p.policy_payload,
      i.event_ref, i.sequence, i.previous_hash, i.event_hash, i.event_type, i.occurred_at, i.reason_code
  `));
  if (seeds.length !== 1) throw new ActionApprovalDecisionRepositoryError("corrupt_store");
  const decisions = resultRows<StoredDecisionRow>(await executor.execute(sql`
    select id, unit_id, unit_ref, unit_hash, ordinal, command_ref, command_hash,
      lifecycle_before_hash, lifecycle_after_hash, trace_after_hash, command_payload, event_payloads
    from action_approval_decision_events
    where workspace_id = ${workspaceId}::uuid and bundle_id = ${bundleId}::uuid
    order by ordinal
  `));
  const grants = resultRows<StoredGrantRow>(await executor.execute(sql`
    select d.command_ref, g.grant_hash, g.grant_payload
    from action_approval_evidence_grants g
    join action_approval_decision_events d
      on d.workspace_id = g.workspace_id and d.id = g.decision_event_id
    where g.workspace_id = ${workspaceId}::uuid and g.bundle_id = ${bundleId}::uuid
    order by d.ordinal
  `));
  return Object.freeze({ lifecycle: replay(initialLifecycle(seeds[0]!), decisions, grants), decisions });
}

/**
 * Server-only decision persistence. It replays every prior command under lock,
 * appends one immutable decision and, for approve only, non-executable evidence.
 */
export class DrizzleActionApprovalDecisionRepository {
  constructor(private readonly database: DecisionDatabase, private readonly workspaceId: string) {
    if (!UUID.test(workspaceId)) throw new ActionApprovalDecisionRepositoryError("invalid_input");
  }

  async loadForDecision(input: Readonly<{ workspaceId: string; unitRef: string }>): Promise<Readonly<{
    lifecycle: ApprovalLifecycle;
    freshness: readonly UnitFreshness[];
  }> | null> {
    if (input.workspaceId !== this.workspaceId || typeof input.unitRef !== "string") {
      throw new ActionApprovalDecisionRepositoryError("workspace_scope_mismatch");
    }
    const found = resultRows<LockRow>(await this.database.execute(sql`
      select b.id as bundle_id, u.id as unit_id
      from action_proposal_units u
      join action_proposal_bundles b on b.workspace_id = u.workspace_id and b.id = u.bundle_id
      join workspaces w on w.id = u.workspace_id and w.lifecycle_state = 'active'
      where u.workspace_id = ${this.workspaceId}::uuid and u.unit_ref = ${input.unitRef}
      limit 2
    `));
    if (found.length === 0) return null;
    if (found.length !== 1) throw new ActionApprovalDecisionRepositoryError("corrupt_store");
    const loaded = await loadLifecycle(this.database, this.workspaceId, found[0]!.bundle_id);
    return Object.freeze({ lifecycle: loaded.lifecycle, freshness: freshnessOf(loaded.lifecycle) });
  }

  async decideAtomically(input: Readonly<{
    workspaceId: string;
    unitRef: string;
    expectedTraceHash: string;
    buildCommand(snapshot: Readonly<{
      lifecycle: ApprovalLifecycle;
      freshness: readonly UnitFreshness[];
    }>): Promise<ApprovalDecisionCommand>;
  }>): Promise<Readonly<{
    outcome: "inserted" | "unchanged";
    lifecycle: ApprovalLifecycle;
    lifecycleHash: string;
    traceHash: string;
    executionAuthority: "none";
    executionPerformed: false;
  }>> {
    if (!input || typeof input !== "object" || input.workspaceId !== this.workspaceId
      || typeof input.unitRef !== "string" || typeof input.expectedTraceHash !== "string"
      || typeof input.buildCommand !== "function") {
      throw new ActionApprovalDecisionRepositoryError("invalid_input");
    }
    return this.database.transaction(async (transaction) => {
      const workspace = resultRows<{ id: string }>(await transaction.execute(sql`
        select id from workspaces
        where id = ${this.workspaceId}::uuid and lifecycle_state = 'active'
        limit 1 for update
      `));
      if (workspace.length !== 1) throw new ActionApprovalDecisionRepositoryError("workspace_scope_mismatch");

      const locked = resultRows<LockRow>(await transaction.execute(sql`
        select b.id as bundle_id, u.id as unit_id
        from action_proposal_units u
        join action_proposal_bundles b on b.workspace_id = u.workspace_id and b.id = u.bundle_id
        where u.workspace_id = ${this.workspaceId}::uuid and u.unit_ref = ${input.unitRef}
        limit 2 for update of b, u
      `));
      if (locked.length === 0) throw new ActionApprovalDecisionRepositoryError("proposal_missing");
      if (locked.length !== 1) throw new ActionApprovalDecisionRepositoryError("corrupt_store");
      const { bundle_id: bundleId, unit_id: unitId } = locked[0]!;

      const loaded = await loadLifecycle(transaction, this.workspaceId, bundleId);
      const { lifecycle, decisions } = loaded;
      if (lifecycle.traceHash !== input.expectedTraceHash) {
        throw new ActionApprovalDecisionRepositoryError("decision_conflict");
      }
      const command = await input.buildCommand(Object.freeze({
        lifecycle,
        freshness: freshnessOf(lifecycle),
      }));
      if (!command || typeof command !== "object" || command.unitRef !== input.unitRef) {
        throw new ActionApprovalDecisionRepositoryError("invalid_input");
      }
      const commandHash = digest(command);

      const sameRef = decisions.find((decision) => decision.command_ref === command.commandRef);
      if (sameRef) {
        if (sameRef.command_hash !== commandHash || sameRef.unit_ref !== command.unitRef) {
          throw new ActionApprovalDecisionRepositoryError("idempotency_conflict");
        }
        return Object.freeze({
          outcome: "unchanged" as const,
          lifecycle,
          lifecycleHash: digest(lifecycle),
          traceHash: lifecycle.traceHash,
          executionAuthority: "none" as const,
          executionPerformed: false as const,
        });
      }

      let transition;
      try {
        transition = decideActionUnit(lifecycle, command);
        assertValidApprovalLifecycle(transition.lifecycle);
      } catch (error) {
        if (error instanceof Error) throw error;
        throw new ActionApprovalDecisionRepositoryError("decision_conflict");
      }
      const definition = lifecycle.bundle.units.find((unit) => unit.unitRef === command.unitRef);
      const state = transition.lifecycle.units.find((unit) => unit.unitRef === command.unitRef);
      if (!definition || !state || transition.executionAuthority !== "none" || transition.executionPerformed !== false) {
        throw new ActionApprovalDecisionRepositoryError("decision_conflict");
      }
      const beforeHash = digest(lifecycle);
      const afterHash = digest(transition.lifecycle);
      const inserted = resultRows<{ id: string }>(await transaction.execute(sql`
        insert into action_approval_decision_events (
          workspace_id, bundle_id, unit_id, ordinal, command_ref, command_kind, unit_ref, unit_hash,
          actor_ref, actor_role, decided_at, reason_code, command_hash, freshness_hash,
          lifecycle_before_hash, lifecycle_after_hash, trace_after_hash, command_payload, event_payloads,
          execution_authority, execution_performed
        ) values (
          ${this.workspaceId}::uuid, ${bundleId}::uuid, ${unitId}::uuid, ${decisions.length + 1},
          ${command.commandRef}, ${command.kind}, ${command.unitRef}, ${definition.unitHash},
          ${command.actor.actorRef}, ${command.actor.role}, ${command.decidedAt}::timestamptz, ${command.reasonCode},
          ${commandHash}, ${digest(command.freshness)}, ${beforeHash}, ${afterHash}, ${transition.lifecycle.traceHash},
          ${JSON.stringify(command)}::jsonb, ${JSON.stringify(transition.auditEventIntents)}::jsonb, 'none', false
        ) returning id
      `));
      if (inserted.length !== 1) throw new ActionApprovalDecisionRepositoryError("corrupt_store");

      if (command.kind === "approve") {
        const grant = state.grant;
        if (!grant || grant.canExecute !== false || grant.capability !== "approval_evidence_only"
          || grant.consumedAt !== null || grant.consumedBy !== null) {
          throw new ActionApprovalDecisionRepositoryError("decision_conflict");
        }
        const stored = resultRows<{ id: string }>(await transaction.execute(sql`
          insert into action_approval_evidence_grants (
            workspace_id, bundle_id, unit_id, decision_event_id, grant_ref, unit_ref, unit_hash,
            scope_hash, plan_ref, plan_revision, plan_hash, approver_ref, approver_role,
            approved_at, expires_at, grant_hash, grant_payload, capability, can_execute
          ) values (
            ${this.workspaceId}::uuid, ${bundleId}::uuid, ${unitId}::uuid, ${inserted[0]!.id}::uuid,
            ${grant.grantRef}, ${grant.unitRef}, ${grant.unitHash}, ${grant.scopeHash}, ${grant.planRef},
            ${grant.planRevision}, ${grant.planHash}, ${grant.approver.actorRef}, ${grant.approver.role},
            ${grant.approvedAt}::timestamptz, ${grant.expiresAt}::timestamptz, ${grant.grantHash},
            ${JSON.stringify(grant)}::jsonb, 'approval_evidence_only', false
          ) returning id
        `));
        if (stored.length !== 1) throw new ActionApprovalDecisionRepositoryError("corrupt_store");
      } else if (state.grant !== null) {
        throw new ActionApprovalDecisionRepositoryError("decision_conflict");
      }

      return Object.freeze({
        outcome: "inserted" as const,
        lifecycle: transition.lifecycle,
        lifecycleHash: afterHash,
        traceHash: transition.lifecycle.traceHash,
        executionAuthority: "none" as const,
        executionPerformed: false as const,
      });
    });
  }
}
