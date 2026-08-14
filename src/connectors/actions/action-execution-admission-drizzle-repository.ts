import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type { ActionPlan } from "@/domain/actions/autonomy-valve";
import {
  assertValidActionExecutionAdmission,
  type ActionExecutionAdmission,
} from "@/domain/actions/action-execution-admission";
import { createMetaWriteSpec } from "@/domain/actions/meta-write-spec";
import { assessMetaWriteEligibility, type MetaWriteEligibilitySnapshot } from "@/domain/actions/meta-write-eligibility";
import { appendActionPreparationGateSnapshot, evaluateUnifiedActionPreparationGateForUnit, UnifiedActionPreparationGateError } from "@/connectors/campaigns/unified-action-preparation-gate";
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
  unit_payload: unknown;
  account_ref: string;
  campaign_ref: string | null;
  ad_set_ref: string | null;
  ad_ref: string | null;
  campaign_configured_status: string | null;
  campaign_effective_status: string | null;
  ad_set_configured_status: string | null;
  ad_set_effective_status: string | null;
  target_configured_status: string | null;
  target_effective_status: string | null;
  campaign_budget_optimization: boolean | null;
  source_snapshot_hash: string | null;
  source_snapshot_captured_at: string | null;
  database_now: string;
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

const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const HASH = /^[a-f0-9]{64}$/;
type MirrorStatus = "ACTIVE" | "PAUSED" | "UNKNOWN";

function status(value: unknown): MirrorStatus {
  return value === "ACTIVE" || value === "PAUSED" ? value : "UNKNOWN";
}
function iso(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new ActionExecutionAdmissionRepositoryError("source_corrupt");
  }
  return value;
}
function unitWorkspaceRef(value: unknown, source: SourceRow): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ActionExecutionAdmissionRepositoryError("source_corrupt");
  const candidate = value as { scope?: unknown };
  const scope = candidate.scope;
  if (!scope || typeof scope !== "object" || Array.isArray(scope)) throw new ActionExecutionAdmissionRepositoryError("source_corrupt");
  const record = scope as Record<string, unknown>;
  if (Object.keys(record).length !== 4 || typeof record.workspaceRef !== "string" || !REF.test(record.workspaceRef)
    || record.accountRef !== source.account_ref || record.entityRef !== source.entity_ref || record.actionType !== source.action_type) {
    throw new ActionExecutionAdmissionRepositoryError("source_corrupt");
  }
  return record.workspaceRef;
}

/** Builds the execution-time status/budget proof exclusively from the current persisted Meta mirror. */
function currentMirrorSnapshot(source: SourceRow, spec: ReturnType<typeof createMetaWriteSpec>): MetaWriteEligibilitySnapshot {
  const capturedAt = iso(source.database_now);
  const sourceCapturedAt = iso(source.source_snapshot_captured_at);
  if (!source.source_snapshot_hash || !HASH.test(source.source_snapshot_hash) || Date.parse(sourceCapturedAt) > Date.parse(capturedAt)
    || !REF.test(source.account_ref)) throw new ActionExecutionAdmissionRepositoryError("source_corrupt");
  const targetSource = spec.target.entityLevel === "campaign"
    ? { ref: source.campaign_ref, configuredStatus: source.campaign_configured_status, effectiveStatus: source.campaign_effective_status }
    : spec.target.entityLevel === "adset"
      ? { ref: source.ad_set_ref, configuredStatus: source.ad_set_configured_status, effectiveStatus: source.ad_set_effective_status }
      : { ref: source.ad_ref, configuredStatus: source.target_configured_status, effectiveStatus: source.target_effective_status };
  if (targetSource.ref !== source.entity_ref) throw new ActionExecutionAdmissionRepositoryError("source_corrupt");
  const target = Object.freeze({
    entityLevel: spec.target.entityLevel,
    entityRef: source.entity_ref,
    configuredStatus: status(targetSource.configuredStatus),
    effectiveStatus: status(targetSource.effectiveStatus),
    budgetOwnerRef: spec.target.entityLevel === "campaign"
      ? source.campaign_budget_optimization === true ? source.entity_ref : null
      : spec.target.entityLevel === "adset"
        ? source.campaign_budget_optimization === false ? source.entity_ref : null
        : null,
  });
  const ancestors = spec.target.entityLevel === "campaign" ? []
    : spec.target.entityLevel === "adset" ? [Object.freeze({ entityLevel: "campaign" as const, entityRef: source.campaign_ref!,
      configuredStatus: status(source.campaign_configured_status), effectiveStatus: status(source.campaign_effective_status) })]
      : [Object.freeze({ entityLevel: "campaign" as const, entityRef: source.campaign_ref!,
        configuredStatus: status(source.campaign_configured_status), effectiveStatus: status(source.campaign_effective_status) }),
      Object.freeze({ entityLevel: "adset" as const, entityRef: source.ad_set_ref!,
        configuredStatus: status(source.ad_set_configured_status), effectiveStatus: status(source.ad_set_effective_status) })];
  if (ancestors.some((ancestor) => !REF.test(ancestor.entityRef))) throw new ActionExecutionAdmissionRepositoryError("source_corrupt");
  return Object.freeze({ workspaceRef: unitWorkspaceRef(source.unit_payload, source), accountRef: source.account_ref, capturedAt,
    target, ancestors: Object.freeze(ancestors), sourceSnapshotHash: source.source_snapshot_hash });
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
    outcome: "inserted" | "unchanged" | "blocked";
    executionRef: string;
    admissionHash: string;
    capabilities: Readonly<{ canExecute: false; canWriteMeta: false; canDispatchNetwork: false }>;
  }>> {
    if (input.workspaceId !== this.workspaceId) throw new ActionExecutionAdmissionRepositoryError("workspace_scope_mismatch");
    try { assertValidActionExecutionAdmission(input.admission); } catch { throw new ActionExecutionAdmissionRepositoryError("invalid_input"); }
    return this.database.transaction(async (transaction) => {
      const sources = rows<SourceRow>(await transaction.execute(sql`
        select w.id as workspace_id, u.bundle_id, u.id as unit_id, u.unit_ref, u.unit_hash, u.entity_ref,
          u.source_hash, u.context_hash, u.action_type, u.action_plan_payload, u.unit_payload, u.account_ref,
          campaign.external_campaign_id as campaign_ref, ad_set.external_ad_set_id as ad_set_ref, ad.external_ad_id as ad_ref,
          ad.configured_status as target_configured_status, ad.effective_status as target_effective_status,
          campaign.configured_status as campaign_configured_status, campaign.effective_status as campaign_effective_status,
          ad_set.configured_status as ad_set_configured_status, ad_set.effective_status as ad_set_effective_status,
          campaign.campaign_budget_optimization, snapshot.snapshot_hash as source_snapshot_hash,
          to_char(snapshot.captured_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as source_snapshot_captured_at,
          to_char(transaction_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as database_now,
          d.id as decision_event_id, d.command_ref as approval_decision_ref, d.command_kind,
          g.id as approval_grant_id, g.grant_ref as approval_grant_ref
        from workspaces w
        join action_proposal_units u on u.workspace_id = w.id
        join action_approval_decision_events d
          on d.workspace_id = u.workspace_id and d.bundle_id = u.bundle_id and d.unit_id = u.id
        join action_approval_evidence_grants g
          on g.workspace_id = d.workspace_id and g.decision_event_id = d.id and g.unit_id = u.id
        join ad_accounts account on account.workspace_id = u.workspace_id and account.id = u.ad_account_id
          and account.external_account_id = u.account_ref and account.disappeared_at is null
        join data_sources data_source on data_source.workspace_id = account.workspace_id and data_source.id = account.data_source_id
        join meta_connections connection on connection.workspace_id = data_source.workspace_id and connection.id = data_source.meta_connection_id
          and connection.status = 'active' and connection.disconnected_at is null and connection.revoked_at is null
        left join ad_campaigns campaign on campaign.workspace_id = u.workspace_id and campaign.id = u.campaign_id
          and campaign.ad_account_id = account.id and campaign.disappeared_at is null
        left join meta_ad_sets ad_set on ad_set.workspace_id = u.workspace_id and ad_set.id = u.ad_set_id
          and ad_set.ad_account_id = account.id and ad_set.campaign_id = campaign.id and ad_set.disappeared_at is null
        left join meta_ads ad on ad.workspace_id = u.workspace_id and ad.id = u.ad_id and ad.ad_account_id = account.id
          and ad.campaign_id = campaign.id and ad.ad_set_id = ad_set.id and ad.disappeared_at is null
        join lateral (
          select candidate.* from meta_change_snapshots candidate
          where candidate.workspace_id = u.workspace_id and candidate.meta_connection_id = connection.id
            and candidate.ad_account_id = account.id and candidate.captured_at <= transaction_timestamp()
          order by candidate.captured_at desc, candidate.persisted_at desc, candidate.id desc limit 1
        ) snapshot on true
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
      const gateBindings = rows<{ selection_id: string }>(await transaction.execute(sql`
        select selection_id from slice_rule_budget_action_unit_bindings
        where workspace_id = ${this.workspaceId}::uuid and action_proposal_unit_id = ${source.unit_id}::uuid limit 2
      `));
      if (gateBindings.length > 1) throw new ActionExecutionAdmissionRepositoryError("source_corrupt");
      if (gateBindings.length === 1) {
        const evaluatedAt = iso(source.database_now);
        try {
          const gate = await evaluateUnifiedActionPreparationGateForUnit(transaction as never, {
            workspaceId: this.workspaceId, actionProposalUnitId: source.unit_id, stage: "admission", evaluatedAt,
          });
          await appendActionPreparationGateSnapshot(transaction as never, { workspaceId: this.workspaceId,
            selectionId: null, actionProposalUnitId: source.unit_id, result: gate, evaluatedAt });
          if (!gate.admissionEnabled) {
            return Object.freeze({ outcome: "blocked" as const, executionRef: `action_execution_${"0".repeat(20)}`,
              admissionHash: input.admission.admissionHash,
              capabilities: Object.freeze({ canExecute: false as const, canWriteMeta: false as const, canDispatchNetwork: false as const }) });
          }
        } catch (error) {
          if (error instanceof UnifiedActionPreparationGateError) throw new ActionExecutionAdmissionRepositoryError("source_missing");
          throw error;
        }
      }
      let mirrorEligibility;
      try {
        mirrorEligibility = assessMetaWriteEligibility({ writeSpec: expectedSpec, snapshot: currentMirrorSnapshot(source, expectedSpec) });
      } catch (error) {
        if (error instanceof ActionExecutionAdmissionRepositoryError) throw error;
        throw new ActionExecutionAdmissionRepositoryError("source_corrupt");
      }
      if (mirrorEligibility.disposition !== "eligible_for_separate_human_execution"
        || input.admission.eligibilitySnapshotHash !== mirrorEligibility.snapshotHash
        || input.admission.eligibilityHash !== mirrorEligibility.eligibilityHash) {
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
