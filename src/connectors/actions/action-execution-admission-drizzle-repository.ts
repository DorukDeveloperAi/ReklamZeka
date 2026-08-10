import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type { ActionPlan } from "@/domain/actions/autonomy-valve";
import {
  assertValidActionExecutionAdmission,
  type ActionExecutionAdmission,
} from "@/domain/actions/action-execution-admission";
import { createMetaWriteSpec } from "@/domain/actions/meta-write-spec";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
type Executor = Pick<Database, "execute">;

export class ActionExecutionAdmissionRepositoryError extends Error {
  constructor(readonly code: "invalid_input" | "workspace_scope_mismatch" | "source_missing" | "source_corrupt" | "idempotency_conflict") {
    super(`Action execution admission persistence reddedildi: ${code}`);
    this.name = "ActionExecutionAdmissionRepositoryError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ZERO_HASH = "0".repeat(64);

type SourceRow = Readonly<{
  workspace_id: string;
  bundle_id: string;
  unit_id: string;
  unit_ref: string;
  unit_hash: string;
  entity_ref: string;
  source_hash: string;
  context_hash: string;
  action_type: string;
  action_plan_payload: ActionPlan;
  decision_event_id: string;
  approval_decision_ref: string;
  command_kind: string;
  approval_grant_id: string;
  approval_grant_ref: string;
}>;
type ExistingRow = Readonly<{ execution_ref: string; admission_hash: string; write_spec_hash: string }>;
type InsertRow = Readonly<{ id: string }>;

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => [key, stable(child)]));
  return value;
}
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function rows<T>(result: unknown): readonly T[] {
  if (!result || typeof result !== "object" || !("rows" in result) || !Array.isArray(result.rows)) {
    throw new ActionExecutionAdmissionRepositoryError("source_corrupt");
  }
  return result.rows as readonly T[];
}

/**
 * Server-private persistence of an already admission-gated, non-executable
 * attempt. It resolves every unit/decision/grant link from tenant rows again;
 * no caller identifier, Meta target, token, or transport is accepted.
 */
export class DrizzleActionExecutionAdmissionRepository {
  constructor(private readonly database: Pick<Database, "transaction">, private readonly workspaceId: string) {
    if (!UUID.test(workspaceId)) throw new ActionExecutionAdmissionRepositoryError("invalid_input");
  }

  async admit(input: Readonly<{ workspaceId: string; admission: ActionExecutionAdmission }>): Promise<Readonly<{
    outcome: "inserted" | "unchanged";
    executionRef: string;
    admissionHash: string;
    capabilities: Readonly<{ canExecute: false; canWriteMeta: false; canDispatchNetwork: false }>;
  }>> {
    if (input.workspaceId !== this.workspaceId) throw new ActionExecutionAdmissionRepositoryError("workspace_scope_mismatch");
    try { assertValidActionExecutionAdmission(input.admission); } catch { throw new ActionExecutionAdmissionRepositoryError("invalid_input"); }
    return this.database.transaction(async (transaction) => {
      const sources = rows<SourceRow>(await transaction.execute(sql`
        select w.id as workspace_id, u.bundle_id, u.id as unit_id, u.unit_ref, u.unit_hash, u.entity_ref,
          u.source_hash, u.context_hash, u.action_type, u.action_plan_payload,
          d.id as decision_event_id, d.command_ref as approval_decision_ref, d.command_kind,
          g.id as approval_grant_id, g.grant_ref as approval_grant_ref
        from workspaces w
        join action_proposal_units u on u.workspace_id = w.id
        join action_approval_decision_events d
          on d.workspace_id = u.workspace_id and d.bundle_id = u.bundle_id and d.unit_id = u.id
        join action_approval_evidence_grants g
          on g.workspace_id = d.workspace_id and g.decision_event_id = d.id and g.unit_id = u.id
        where w.id = ${this.workspaceId}::uuid and w.lifecycle_state = 'active'
          and u.unit_ref = ${input.admission.unitRef}
          and d.command_ref = ${input.admission.approvalDecisionRef}
          and d.command_kind = 'approve'
          and g.grant_ref = ${input.admission.approvalGrantRef}
        limit 2 for update of w, u, d, g
      `));
      if (sources.length === 0) throw new ActionExecutionAdmissionRepositoryError("source_missing");
      if (sources.length !== 1) throw new ActionExecutionAdmissionRepositoryError("source_corrupt");
      const source = sources[0]!;
      let expectedSpec;
      try {
        expectedSpec = createMetaWriteSpec({ unitRef: source.unit_ref, unitHash: source.unit_hash, actionPlan: source.action_plan_payload });
      } catch { throw new ActionExecutionAdmissionRepositoryError("source_corrupt"); }
      if (source.action_plan_payload.planHash !== source.source_hash || source.action_plan_payload.contextHash !== source.context_hash
        || source.action_plan_payload.actionType !== source.action_type || source.action_plan_payload.action.entity.ref !== source.entity_ref
        || input.admission.writeSpec.specHash !== expectedSpec.specHash
        || digest(input.admission.writeSpec) !== digest(expectedSpec)) {
        throw new ActionExecutionAdmissionRepositoryError("source_corrupt");
      }
      const idempotencyKey = digest({ version: "action-execution-attempt/1.0.0", workspaceId: this.workspaceId, approvalDecisionRef: source.approval_decision_ref });
      const executionRef = `action_execution_${idempotencyKey.slice(0, 20)}`;
      const existing = rows<ExistingRow>(await transaction.execute(sql`
        select execution_ref, admission_hash, write_spec_hash
        from action_execution_attempts
        where workspace_id = ${this.workspaceId}::uuid and idempotency_key = ${idempotencyKey}
        limit 2 for update
      `));
      if (existing.length > 1) throw new ActionExecutionAdmissionRepositoryError("source_corrupt");
      if (existing.length === 1) {
        const row = existing[0]!;
        if (row.execution_ref !== executionRef || row.admission_hash !== input.admission.admissionHash || row.write_spec_hash !== expectedSpec.specHash) {
          throw new ActionExecutionAdmissionRepositoryError("idempotency_conflict");
        }
        return Object.freeze({ outcome: "unchanged" as const, executionRef, admissionHash: input.admission.admissionHash,
          capabilities: Object.freeze({ canExecute: false as const, canWriteMeta: false as const, canDispatchNetwork: false as const }) });
      }
      const inserted = rows<InsertRow>(await transaction.execute(sql`
        insert into action_execution_attempts (
          workspace_id, bundle_id, unit_id, decision_event_id, approval_grant_id,
          execution_ref, unit_ref, approval_decision_ref, idempotency_key, admission_hash, write_spec_hash, admission_payload
        ) values (
          ${this.workspaceId}::uuid, ${source.bundle_id}::uuid, ${source.unit_id}::uuid,
          ${source.decision_event_id}::uuid, ${source.approval_grant_id}::uuid,
          ${executionRef}, ${source.unit_ref}, ${source.approval_decision_ref}, ${idempotencyKey},
          ${input.admission.admissionHash}, ${expectedSpec.specHash}, ${JSON.stringify(input.admission)}::jsonb
        ) returning id
      `));
      if (inserted.length !== 1 || !UUID.test(inserted[0]!.id)) throw new ActionExecutionAdmissionRepositoryError("source_corrupt");
      const eventRef = `action_execution_event_${digest({ executionRef, type: "admitted" }).slice(0, 20)}`;
      const eventPayload = Object.freeze({ version: "action-execution-event/1.0.0", executionRef,
        admissionHash: input.admission.admissionHash, executionAuthority: "none" as const, networkDispatched: false as const });
      const eventHash = digest({ executionRef, sequence: 1, eventRef, previousHash: ZERO_HASH, eventType: "admitted", occurredAt: input.admission.evaluatedAt, eventPayload });
      await transaction.execute(sql`
        insert into action_execution_events (
          workspace_id, execution_attempt_id, sequence, event_ref, previous_hash, event_hash, event_type, occurred_at, event_payload
        ) values (
          ${this.workspaceId}::uuid, ${inserted[0]!.id}::uuid, 1, ${eventRef}, ${ZERO_HASH}, ${eventHash}, 'admitted',
          ${input.admission.evaluatedAt}::timestamptz, ${JSON.stringify(eventPayload)}::jsonb
        )
      `);
      return Object.freeze({ outcome: "inserted" as const, executionRef, admissionHash: input.admission.admissionHash,
        capabilities: Object.freeze({ canExecute: false as const, canWriteMeta: false as const, canDispatchNetwork: false as const }) });
    });
  }
}
