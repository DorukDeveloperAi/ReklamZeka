import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import {
  P06_EXECUTION_V2_STEPS,
  type P06ExecutionV2Action,
  type P06ExecutionV2Outcome,
  type P06ExecutionV2Receipt,
  type P06ExecutionV2Request,
  type P06ExecutionV2RollbackProposal,
  type P06ExecutionV2TraceEntry,
} from "@/domain/actions/p06-execution-v2";
import { createP06BudgetExecutionMaterialization } from "@/domain/actions/p06-budget-execution-materialization";
import type { ActionExecutionAdmission } from "@/domain/actions/action-execution-admission";
import type { ActionPlan } from "@/domain/actions/autonomy-valve";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
type Executor = Pick<Database, "execute">;
type Row = Record<string, unknown>;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const PHASES = [
  "staging",
  "admission",
  "post_claim",
  "pre_dispatch",
  "read_after_write",
] as const;

export class P06ExecutionRepositoryError extends Error {
  constructor(
    readonly code: "invalid_input" | "not_found" | "conflict" | "corrupt_store",
  ) {
    super(`P06 execution persistence rejected: ${code}`);
  }
}
function fail(code: P06ExecutionRepositoryError["code"]): never {
  throw new P06ExecutionRepositoryError(code);
}
function rows(value: unknown): readonly Row[] {
  if (!value || typeof value !== "object" || !("rows" in value))
    fail("corrupt_store");
  const resultRows = (value as { rows?: unknown }).rows;
  if (!Array.isArray(resultRows)) fail("corrupt_store");
  return resultRows as readonly Row[];
}
function one(values: readonly Row[]): Row | null {
  if (values.length > 1) fail("corrupt_store");
  return values[0] ?? null;
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, stable(child)]),
    );
  if (
    typeof value === "number" &&
    (!Number.isSafeInteger(value) || !Number.isFinite(value))
  )
    fail("invalid_input");
  return value;
}
function digest(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(stable(value)))
    .digest("hex");
}
function instant(value: string): string {
  if (
    !ISO.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    fail("invalid_input");
  return value;
}
function hash(value: string): string {
  if (!HASH.test(value)) fail("invalid_input");
  return value;
}

export type P06ExecutionGateSeed = Readonly<{
  phase: (typeof PHASES)[number];
  enabled: boolean;
  allowlistHash: string;
  capturedAt: string;
  expiresAt: string;
}>;

export type P06ExecutionIdentity = Readonly<{
  workspaceId: string;
  executionRunId: string;
  executionRef: string;
  requestHash: string;
  idempotencyKey: string;
  request: Omit<P06ExecutionV2Request, "leaseTokenHash" | "fenceHash">;
}>;

function initialGates(input: readonly P06ExecutionGateSeed[], evaluatedAt: string) {
  if (input.length !== 2) fail("invalid_input");
  const normalized = PHASES.slice(0, 2).map((phase, index) => {
    const gate = input[index];
    if (!gate || gate.phase !== phase || typeof gate.enabled !== "boolean" || !HASH.test(gate.allowlistHash)
      || Date.parse(instant(gate.capturedAt)) > Date.parse(evaluatedAt)
      || Date.parse(instant(gate.expiresAt)) <= Date.parse(evaluatedAt)
      || index > 0 && Date.parse(gate.capturedAt) <= Date.parse(input[index - 1]!.capturedAt)) fail("invalid_input");
    const core = { version: "p06-execution-gate/1.0.0", phase, sequence: index + 1, leaseEpoch: 0,
      enabled: gate.enabled, allowlistHash: gate.allowlistHash, capturedAt: gate.capturedAt, expiresAt: gate.expiresAt };
    return { ...core, snapshotHash: digest(core) };
  });
  return Object.freeze({ normalized: Object.freeze(normalized), gateSetHash: digest(normalized.map((gate) => ({ phase: gate.phase, allowlistHash: gate.allowlistHash }))) });
}

export type P06ExecutionWorkerSnapshot = Readonly<{
  workspaceId: string;
  executionRunId: string;
  executionRef: string;
  idempotencyKey: string;
  route:
    | "human_approved"
    | "guide_budget_human_approved"
    | "human_rename_approved"
    | "limited_autonomy_status";
  request: Omit<P06ExecutionV2Request, "leaseTokenHash" | "fenceHash">;
  head: Readonly<{
    state:
      | "pending"
      | "claimed"
      | "running"
      | "succeeded"
      | "verification_failed"
      | "held";
    sequence: number;
    traceSequence: number;
    headEventHash: string | null;
    leaseTokenHash: string | null;
    fenceHash: string | null;
    leaseEpoch: number;
    leaseExpiresAt: string | null;
    terminalHash: string | null;
  }>;
  traces: readonly Readonly<{
    eventHash: string;
    traceSequence: number;
    step: (typeof P06_EXECUTION_V2_STEPS)[number];
    outcome: P06ExecutionV2TraceEntry["outcome"];
    receiptHash: string;
    receiptCore: Readonly<Record<string, unknown>>;
    occurredAt: string;
  }>[];
  observations: readonly Readonly<{
    observationId: string;
    eventHash: string;
    kind:
      "read_before" | "write_receipt" | "read_after" | "ambiguous_retry_read";
    metadataHash: string;
    rawHash: string;
    observedValue: Readonly<Record<string, unknown>>;
    observedAt: string;
  }>[];
  gates: readonly Readonly<{
    phase: (typeof PHASES)[number];
    sequence: number;
    leaseEpoch: number;
    snapshotHash: string;
    receiptHash: string;
    allowlistHash: string;
    enabled: boolean;
    capturedAt: string;
    expiresAt: string;
  }>[];
}>;

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    fail("corrupt_store");
  return value as Record<string, unknown>;
}
function executionValue(
  value: unknown,
): Readonly<{ status: "ACTIVE" | "PAUSED"; budgetMinor: number | null; name: string | null }> {
  const source = record(value);
  if (
    (source.status !== "ACTIVE" && source.status !== "PAUSED") ||
    (source.budgetMinor !== null &&
      (!Number.isSafeInteger(source.budgetMinor) ||
        Number(source.budgetMinor) < 0)) ||
    (source.name !== undefined && source.name !== null &&
      (typeof source.name !== "string" || source.name !== source.name.trim() ||
        source.name.length < 1 || source.name.length > 255 || /[\u0000-\u001f\u007f]/.test(source.name)))
  )
    fail("corrupt_store");
  return Object.freeze({
    status: source.status,
    budgetMinor:
      source.budgetMinor === null ? null : Number(source.budgetMinor),
    name: source.name === undefined || source.name === null ? null : source.name,
  });
}

/**
 * Server-private persistence boundary. It never owns a Meta client and cannot
 * dispatch a write. Creation derives the writable identity from the persisted
 * ActionUnit and binds one approved decision/grant plus all five gate seeds.
 */
export class DrizzleP06ExecutionRepository {
  constructor(
    private readonly database: Pick<Database, "execute" | "transaction">,
  ) {}

  async loadForWorker(
    executionRef: string,
  ): Promise<P06ExecutionWorkerSnapshot> {
    if (!/^p06_execution_[a-f0-9]{24}$/.test(executionRef))
      fail("invalid_input");
    return this.database.transaction(async (tx) => {
      const run = one(
        rows(
          await tx.execute(sql`select r.id::text run_id,r.workspace_id::text,r.execution_ref,r.idempotency_key,r.request_payload,r.route,
        h.state,h.sequence,h.trace_sequence,h.head_event_hash,h.lease_token_hash,h.fence_hash,h.lease_epoch,
        case when h.lease_expires_at is null then null else to_char(h.lease_expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end lease_expires_at,h.terminal_hash
        from p06_execution_runs r join p06_execution_heads h on h.workspace_id=r.workspace_id and h.execution_run_id=r.id
        join workspaces w on w.id=r.workspace_id and w.lifecycle_state='active' where r.execution_ref=${executionRef} for share of r,h,w limit 2`),
        ),
      );
      if (
        !run ||
        typeof run.run_id !== "string" ||
        typeof run.workspace_id !== "string" ||
        typeof run.idempotency_key !== "string" ||
        !["human_approved", "guide_budget_human_approved", "human_rename_approved", "limited_autonomy_status"].includes(String(run.route))
      )
        fail("not_found");
      const payload = record(run.request_payload);
      const action = payload.action;
      if (
        !["status_pause", "status_activate", "budget_decrease", "budget_increase", "campaign_rename", "adset_rename", "ad_rename"].includes(String(action)) ||
        payload.executionRef !== executionRef ||
        payload.idempotencyKey !== run.idempotency_key ||
        typeof payload.workspaceRef !== "string" ||
        typeof payload.accountRef !== "string" ||
        typeof payload.entityRef !== "string" ||
        typeof payload.evaluatedAt !== "string"
      )
        fail("corrupt_store");
      const budgetAction = action === "budget_decrease" || action === "budget_increase";
      if (budgetAction ? (payload.budgetKind !== "daily" && payload.budgetKind !== "lifetime") || typeof payload.currency !== "string" || !/^[A-Z]{3}$/.test(payload.currency)
        : payload.budgetKind != null || payload.currency != null) fail("corrupt_store");
      const request = Object.freeze({
        executionRef,
        workspaceRef: payload.workspaceRef,
        accountRef: payload.accountRef,
        entityRef: payload.entityRef,
        action: action as P06ExecutionV2Action,
        ...(budgetAction ? { budgetKind: payload.budgetKind as "daily" | "lifetime", currency: payload.currency as string }
          : { budgetKind: null, currency: null }),
        expectedBefore: executionValue(payload.expectedBefore),
        desired: executionValue(payload.desired),
        evaluatedAt: instant(payload.evaluatedAt),
      });
      const traceRows = rows(
        await tx.execute(sql`select e.event_hash,e.trace_sequence,e.step,e.outcome,e.receipt_hash,e.payload->'receiptCore' receipt_core,
        to_char(e.occurred_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') occurred_at
        from p06_execution_events e where e.workspace_id=${run.workspace_id}::uuid and e.execution_run_id=${run.run_id}::uuid and e.event_kind='trace' order by e.trace_sequence`),
      );
      const traces = traceRows.map((entry) => {
        const traceSequence = Number(entry.trace_sequence);
        const step = entry.step;
        const outcome = entry.outcome;
        if (
          !Number.isInteger(traceSequence) ||
          traceSequence < 1 ||
          traceSequence > 10 ||
          step !== P06_EXECUTION_V2_STEPS[traceSequence - 1] ||
          !["ok", "skipped", "held", "ambiguous", "already_applied"].includes(
            String(outcome),
          ) ||
          typeof entry.event_hash !== "string" ||
          !HASH.test(entry.event_hash) ||
          typeof entry.receipt_hash !== "string" ||
          !HASH.test(entry.receipt_hash) ||
          typeof entry.occurred_at !== "string"
        )
          fail("corrupt_store");
        return Object.freeze({
          eventHash: entry.event_hash,
          traceSequence,
          step: step as (typeof P06_EXECUTION_V2_STEPS)[number],
          outcome: outcome as P06ExecutionV2TraceEntry["outcome"],
          receiptHash: entry.receipt_hash,
          receiptCore: Object.freeze(record(entry.receipt_core)),
          occurredAt: instant(entry.occurred_at),
        });
      });
      const observationRows = rows(
        await tx.execute(sql`select o.id::text observation_id,e.event_hash,o.kind,o.metadata_hash,o.raw_hash,o.observed_value,
        to_char(o.observed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') observed_at
        from p06_execution_observations o join p06_execution_events e on e.workspace_id=o.workspace_id and e.id=o.event_id
        where o.workspace_id=${run.workspace_id}::uuid and o.execution_run_id=${run.run_id}::uuid order by o.observed_at,o.id`),
      );
      const observations = observationRows.map((entry) => {
        if (
          typeof entry.observation_id !== "string" ||
          typeof entry.event_hash !== "string" ||
          !HASH.test(entry.event_hash) ||
          ![
            "read_before",
            "write_receipt",
            "read_after",
            "ambiguous_retry_read",
          ].includes(String(entry.kind)) ||
          typeof entry.metadata_hash !== "string" ||
          !HASH.test(entry.metadata_hash) ||
          typeof entry.raw_hash !== "string" ||
          !HASH.test(entry.raw_hash) ||
          typeof entry.observed_at !== "string"
        )
          fail("corrupt_store");
        return Object.freeze({
          observationId: entry.observation_id,
          eventHash: entry.event_hash,
          kind: entry.kind as P06ExecutionWorkerSnapshot["observations"][number]["kind"],
          metadataHash: entry.metadata_hash,
          rawHash: entry.raw_hash,
          observedValue: Object.freeze(record(entry.observed_value)),
          observedAt: instant(entry.observed_at),
        });
      });
      const gateRows = rows(
        await tx.execute(sql`select phase,sequence,lease_epoch,snapshot_hash,receipt_hash,allowlist_hash,enabled,
        to_char(captured_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') captured_at,
        to_char(expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') expires_at
        from p06_execution_gate_snapshots where workspace_id=${run.workspace_id}::uuid and execution_run_id=${run.run_id}::uuid order by sequence`),
      );
      const gates = gateRows.map((entry) => {
        const sequence = Number(entry.sequence);
        const phase = entry.phase;
        if (
          !Number.isInteger(sequence) ||
          sequence < 1 ||
          sequence > 5 ||
          phase !== PHASES[sequence - 1] ||
          typeof entry.snapshot_hash !== "string" ||
          !HASH.test(entry.snapshot_hash) ||
          typeof entry.receipt_hash !== "string" ||
          !HASH.test(entry.receipt_hash) ||
          typeof entry.allowlist_hash !== "string" ||
          !HASH.test(entry.allowlist_hash) ||
          typeof entry.enabled !== "boolean" ||
          typeof entry.captured_at !== "string" ||
          typeof entry.expires_at !== "string"
        )
          fail("corrupt_store");
        const leaseEpoch = Number(entry.lease_epoch);
        if (!Number.isSafeInteger(leaseEpoch) || leaseEpoch < 0)
          fail("corrupt_store");
        return Object.freeze({
          phase: phase as (typeof PHASES)[number],
          sequence,
          leaseEpoch,
          snapshotHash: entry.snapshot_hash,
          receiptHash: entry.receipt_hash,
          allowlistHash: entry.allowlist_hash,
          enabled: entry.enabled,
          capturedAt: instant(entry.captured_at),
          expiresAt: instant(entry.expires_at),
        });
      });
      const state = run.state;
      const headSequence = Number(run.sequence);
      const traceSequence = Number(run.trace_sequence);
      const leaseEpoch = Number(run.lease_epoch);
      if (
        ![
          "pending",
          "claimed",
          "running",
          "succeeded",
          "verification_failed",
          "held",
        ].includes(String(state)) ||
        !Number.isSafeInteger(headSequence) ||
        headSequence < 0 ||
        !Number.isSafeInteger(traceSequence) ||
        traceSequence < 0 ||
        traceSequence > 10 ||
        !Number.isSafeInteger(leaseEpoch) ||
        leaseEpoch < 0
      )
        fail("corrupt_store");
      return Object.freeze({
        workspaceId: run.workspace_id,
        executionRunId: run.run_id,
        executionRef,
        idempotencyKey: run.idempotency_key,
        route: run.route as P06ExecutionWorkerSnapshot["route"],
        request,
        head: Object.freeze({
          state: state as P06ExecutionWorkerSnapshot["head"]["state"],
          sequence: headSequence,
          traceSequence,
          headEventHash:
            typeof run.head_event_hash === "string"
              ? run.head_event_hash
              : null,
          leaseTokenHash:
            typeof run.lease_token_hash === "string"
              ? run.lease_token_hash
              : null,
          fenceHash: typeof run.fence_hash === "string" ? run.fence_hash : null,
          leaseEpoch,
          leaseExpiresAt:
            typeof run.lease_expires_at === "string"
              ? instant(run.lease_expires_at)
              : null,
          terminalHash:
            typeof run.terminal_hash === "string" ? run.terminal_hash : null,
        }),
        traces: Object.freeze(traces),
        observations: Object.freeze(observations),
        gates: Object.freeze(gates),
      });
    });
  }

  async createHumanApproved(
    input: Readonly<{
      workspaceId: string;
      guideRunActionBindingId: string;
      decisionEventId: string;
      approvalGrantId: string;
      evaluatedAt: string;
      gates: readonly P06ExecutionGateSeed[];
    }>,
  ): Promise<P06ExecutionIdentity> {
    if (
      !UUID.test(input.workspaceId) ||
      !UUID.test(input.guideRunActionBindingId) ||
      !UUID.test(input.decisionEventId) ||
      !UUID.test(input.approvalGrantId) ||
      input.gates.length !== 2
    )
      fail("invalid_input");
    const evaluatedAt = instant(input.evaluatedAt);
    const { normalized: normalizedGates, gateSetHash } = initialGates(input.gates, evaluatedAt);
    return this.database.transaction(async (tx) => {
      const source = one(
        rows(
          await tx.execute(
            sql`select b.id::text binding_id,b.proposal_bundle_id::text bundle_id,b.action_unit_id::text unit_id,b.action_unit_hash,b.proposal_hash,b.effective_guide_set_hash,b.resolution_hash,u.context_hash,u.account_ref,u.entity_ref,u.action_type,u.action_plan_payload,bundle.workspace_ref,p.policy_hash,g.grant_hash from guide_run_action_bindings b join action_proposal_units u on u.workspace_id=b.workspace_id and u.id=b.action_unit_id join action_proposal_bundles bundle on bundle.workspace_id=b.workspace_id and bundle.id=b.proposal_bundle_id join action_approval_policy_snapshots p on p.workspace_id=bundle.workspace_id and p.id=bundle.policy_snapshot_id join action_approval_decision_events d on d.workspace_id=b.workspace_id and d.id=${input.decisionEventId}::uuid and d.bundle_id=b.proposal_bundle_id and d.unit_id=b.action_unit_id and d.command_kind='approve' join action_approval_evidence_grants g on g.workspace_id=b.workspace_id and g.id=${input.approvalGrantId}::uuid and g.decision_event_id=d.id and g.bundle_id=b.proposal_bundle_id and g.unit_id=b.action_unit_id and g.expires_at>${evaluatedAt}::timestamptz where b.workspace_id=${input.workspaceId}::uuid and b.id=${input.guideRunActionBindingId}::uuid for share of b,u,bundle,p,d,g limit 2`,
          ),
        ),
      );
      if (!source) fail("not_found");
      const actionPlan = source.action_plan_payload as {
        action?: { kind?: unknown; fromStatus?: unknown; toStatus?: unknown };
      };
      const action = source.action_type;
      if (
        (action !== "status_pause" && action !== "status_activate") ||
        actionPlan?.action?.kind !== "status_change"
      )
        fail("invalid_input");
      if (!actionPlan.action) fail("corrupt_store");
      const expectedStatus = action === "status_pause" ? "ACTIVE" : "PAUSED";
      const desiredStatus = action === "status_pause" ? "PAUSED" : "ACTIVE";
      if (
        actionPlan.action.fromStatus !== expectedStatus ||
        actionPlan.action.toStatus !== desiredStatus
      )
        fail("corrupt_store");
      const requestCore = {
        version: "p06-execution-request/1.0.0",
        workspaceRef: source.workspace_ref,
        accountRef: source.account_ref,
        entityRef: source.entity_ref,
        action: action as P06ExecutionV2Action,
        expectedBefore: { status: expectedStatus, budgetMinor: null },
        desired: { status: desiredStatus, budgetMinor: null },
        evaluatedAt,
        actionUnitHash: source.action_unit_hash,
        proposalHash: source.proposal_hash,
        contextHash: source.context_hash,
        effectiveGuideSetHash: source.effective_guide_set_hash,
        resolutionHash: source.resolution_hash,
        policyHash: source.policy_hash,
        gateSetHash,
        route: "human_approved",
      } as const;
      const requestHash = digest(requestCore);
      const executionRef = `p06_execution_${requestHash.slice(0, 24)}`;
      const idempotencyKey = `p06_exec_idem_${digest({ bindingId: source.binding_id, grantHash: source.grant_hash, requestHash })}`;
      const payload = {
        ...requestCore,
        executionRef,
        idempotencyKey,
        requestHash,
      };
      const inserted = one(
        rows(
          await tx.execute(
            sql`insert into p06_execution_runs(workspace_id,guide_run_action_binding_id,proposal_bundle_id,action_unit_id,decision_event_id,approval_grant_id,execution_ref,idempotency_key,request_hash,action_unit_hash,proposal_hash,context_hash,effective_guide_set_hash,resolution_hash,policy_hash,gate_set_hash,request_payload,created_at) values(${input.workspaceId}::uuid,${input.guideRunActionBindingId}::uuid,${source.bundle_id}::uuid,${source.unit_id}::uuid,${input.decisionEventId}::uuid,${input.approvalGrantId}::uuid,${executionRef},${idempotencyKey},${requestHash},${source.action_unit_hash},${source.proposal_hash},${source.context_hash},${source.effective_guide_set_hash},${source.resolution_hash},${source.policy_hash},${gateSetHash},${JSON.stringify(payload)}::jsonb,${evaluatedAt}::timestamptz) on conflict(workspace_id,idempotency_key) do nothing returning id::text`,
          ),
        ),
      );
      let runId: string | undefined =
        typeof inserted?.id === "string" ? inserted.id : undefined;
      if (typeof runId !== "string") {
        const replay = one(
          rows(
            await tx.execute(
              sql`select id::text,request_hash from p06_execution_runs where workspace_id=${input.workspaceId}::uuid and idempotency_key=${idempotencyKey} for update limit 2`,
            ),
          ),
        );
        if (
          !replay ||
          replay.request_hash !== requestHash ||
          typeof replay.id !== "string"
        )
          fail("conflict");
        if (typeof replay.id !== "string") fail("conflict");
        runId = replay.id;
      } else {
        await tx.execute(
          sql`insert into p06_execution_heads(workspace_id,execution_run_id,state,sequence,trace_sequence,updated_at) values(${input.workspaceId}::uuid,${runId}::uuid,'pending',0,0,${evaluatedAt}::timestamptz)`,
        );
        for (const gate of normalizedGates) {
          const receiptHash = digest({
            executionRef,
            phase: gate.phase,
            sequence: gate.sequence,
            leaseEpoch: 0,
            snapshotHash: gate.snapshotHash,
          });
          const gatePayload = { ...gate, receiptHash };
          await tx.execute(
            sql`insert into p06_execution_gate_snapshots(workspace_id,execution_run_id,phase,sequence,lease_epoch,snapshot_hash,receipt_hash,allowlist_hash,enabled,captured_at,expires_at,payload) values(${input.workspaceId}::uuid,${runId}::uuid,${gate.phase},${gate.sequence},0,${gate.snapshotHash},${receiptHash},${gate.allowlistHash},${gate.enabled},${gate.capturedAt}::timestamptz,${gate.expiresAt}::timestamptz,${JSON.stringify(gatePayload)}::jsonb)`,
          );
        }
      }
      if (typeof runId !== "string") fail("corrupt_store");
      const request: Omit<
        P06ExecutionV2Request,
        "leaseTokenHash" | "fenceHash"
      > = Object.freeze({
        executionRef,
        workspaceRef: String(source.workspace_ref),
        accountRef: String(source.account_ref),
        entityRef: String(source.entity_ref),
        action: action as P06ExecutionV2Action,
        expectedBefore: Object.freeze({
          status: expectedStatus,
          budgetMinor: null,
        }),
        desired: Object.freeze({ status: desiredStatus, budgetMinor: null }),
        evaluatedAt,
      });
      return Object.freeze({
        workspaceId: input.workspaceId,
        executionRunId: runId,
        executionRef,
        requestHash,
        idempotencyKey,
        request,
      });
    });
  }

  async materializeHumanApprovedUnit(
    input: Readonly<{
      workspaceId: string;
      unitRef: string;
      evaluatedAt: string;
      gates: readonly P06ExecutionGateSeed[];
    }>,
  ): Promise<P06ExecutionIdentity> {
    if (
      !UUID.test(input.workspaceId) ||
      !/^action_unit_[a-f0-9]{20}$/.test(input.unitRef)
    )
      fail("invalid_input");
    const source = one(
      rows(
        await this.database.execute(sql`
          select b.id::text binding_id,d.id::text decision_id,g.id::text grant_id
          from guide_run_action_bindings b
          join action_proposal_units u on u.workspace_id=b.workspace_id
            and u.id=b.action_unit_id and u.unit_ref=${input.unitRef}
          join action_approval_decision_events d on d.workspace_id=b.workspace_id
            and d.bundle_id=b.proposal_bundle_id and d.unit_id=b.action_unit_id
            and d.command_kind='approve'
          join action_approval_evidence_grants g on g.workspace_id=b.workspace_id
            and g.decision_event_id=d.id and g.bundle_id=b.proposal_bundle_id
            and g.unit_id=b.action_unit_id
          where b.workspace_id=${input.workspaceId}::uuid
          limit 2
        `),
      ),
    );
    if (
      !source ||
      typeof source.binding_id !== "string" ||
      typeof source.decision_id !== "string" ||
      typeof source.grant_id !== "string"
    )
      fail("not_found");
    return this.createHumanApproved({
      workspaceId: input.workspaceId,
      guideRunActionBindingId: source.binding_id,
      decisionEventId: source.decision_id,
      approvalGrantId: source.grant_id,
      evaluatedAt: input.evaluatedAt,
      gates: input.gates,
    });
  }

  async createGuideBudgetHumanApproved(
    input: Readonly<{
      workspaceId: string;
      actionExecutionAttemptId: string;
      evaluatedAt: string;
      gates: readonly P06ExecutionGateSeed[];
    }>,
  ): Promise<P06ExecutionIdentity> {
    if (!UUID.test(input.workspaceId) || !UUID.test(input.actionExecutionAttemptId)) fail("invalid_input");
    const evaluatedAt = instant(input.evaluatedAt);
    const { normalized: normalizedGates, gateSetHash } = initialGates(input.gates, evaluatedAt);
    return this.database.transaction(async (tx) => {
      const source = one(rows(await tx.execute(sql`
        select a.id::text attempt_id,a.admission_hash,a.write_spec_hash,a.admission_payload,
          u.id::text unit_id,u.unit_hash,u.context_hash,u.action_plan_hash,u.action_plan_payload,
          u.account_ref,u.entity_ref,u.action_type,u.ad_set_id::text,u.campaign_id::text,
          bundle.id::text bundle_id,bundle.workspace_ref,bundle.plan_ref,bundle.plan_hash,
          d.id::text decision_id,g.id::text grant_id,g.grant_hash,p.policy_hash,
          case when u.ad_set_id is not null then ads.configured_status else campaign.configured_status end current_status
        from action_execution_attempts a
        join action_proposal_units u on u.workspace_id=a.workspace_id and u.id=a.unit_id and u.bundle_id=a.bundle_id
        join action_proposal_bundles bundle on bundle.workspace_id=a.workspace_id and bundle.id=a.bundle_id
        join action_approval_policy_snapshots p on p.workspace_id=bundle.workspace_id and p.id=bundle.policy_snapshot_id
        join action_approval_decision_events d on d.workspace_id=a.workspace_id and d.id=a.decision_event_id
          and d.bundle_id=a.bundle_id and d.unit_id=a.unit_id and d.command_kind='approve'
        join action_approval_evidence_grants g on g.workspace_id=a.workspace_id and g.id=a.approval_grant_id
          and g.decision_event_id=d.id and g.bundle_id=a.bundle_id and g.unit_id=a.unit_id
          and g.expires_at>${evaluatedAt}::timestamptz
        left join meta_ad_sets ads on ads.workspace_id=u.workspace_id and ads.id=u.ad_set_id
        left join ad_campaigns campaign on campaign.workspace_id=u.workspace_id and campaign.id=u.campaign_id
        join workspaces w on w.id=a.workspace_id and w.lifecycle_state='active' and w.tombstoned_at is null
        where a.workspace_id=${input.workspaceId}::uuid and a.id=${input.actionExecutionAttemptId}::uuid
        for share of a,u,bundle,p,d,g,w limit 2
      `)));
      if (!source
        || typeof source.plan_ref !== "string" || typeof source.plan_hash !== "string"
        || typeof source.grant_hash !== "string" || typeof source.policy_hash !== "string"
        || typeof source.unit_id !== "string" || typeof source.bundle_id !== "string"
        || typeof source.decision_id !== "string" || typeof source.grant_id !== "string") fail("not_found");
      const mirror = source.ad_set_id
        ? one(rows(await tx.execute(sql`select configured_status from meta_ad_sets where workspace_id=${input.workspaceId}::uuid
            and id=${source.ad_set_id}::uuid and disappeared_at is null for share limit 2`)))
        : one(rows(await tx.execute(sql`select configured_status from ad_campaigns where workspace_id=${input.workspaceId}::uuid
            and id=${source.campaign_id}::uuid and disappeared_at is null for share limit 2`)));
      if (!mirror || (mirror.configured_status !== "ACTIVE" && mirror.configured_status !== "PAUSED")) fail("not_found");
      const materialized = (() => {
        try {
          return createP06BudgetExecutionMaterialization({
            admission: source.admission_payload as ActionExecutionAdmission,
            actionPlan: source.action_plan_payload as ActionPlan,
            unitHash: String(source.unit_hash), workspaceRef: String(source.workspace_ref),
            accountRef: String(source.account_ref), currentStatus: mirror.configured_status,
          });
        } catch { return fail("corrupt_store"); }
      })();
      const identity = /^guide_budget_[a-f0-9]{32}_([a-f0-9]{64})$/.exec(source.plan_ref);
      if (!identity || source.admission_hash !== materialized.admissionHash
        || source.write_spec_hash !== materialized.writeSpecHash
        || source.action_plan_hash !== materialized.actionPlanHash
        || source.context_hash !== materialized.contextHash
        || source.entity_ref !== materialized.entityRef || source.action_type !== materialized.action) fail("corrupt_store");
      const requestCore = {
        version: "p06-execution-request/1.0.0", workspaceRef: materialized.workspaceRef,
        accountRef: materialized.accountRef, entityRef: materialized.entityRef, action: materialized.action,
        budgetKind: materialized.budgetKind, currency: materialized.currency,
        expectedBefore: materialized.expectedBefore, desired: materialized.desired, evaluatedAt,
        actionUnitHash: String(source.unit_hash), proposalHash: source.plan_hash,
        contextHash: materialized.contextHash, effectiveGuideSetHash: null, resolutionHash: null,
        policyHash: source.policy_hash, gateSetHash, admissionHash: materialized.admissionHash,
        writeSpecHash: materialized.writeSpecHash, dryRunHash: identity[1],
        actionPlanHash: materialized.actionPlanHash, route: "guide_budget_human_approved",
      } as const;
      const requestHash = digest(requestCore);
      const executionRef = `p06_execution_${requestHash.slice(0, 24)}`;
      const idempotencyKey = `p06_exec_idem_${digest({ attemptId: input.actionExecutionAttemptId, grantHash: source.grant_hash, requestHash })}`;
      const payload = { ...requestCore, executionRef, idempotencyKey, requestHash };
      const inserted = one(rows(await tx.execute(sql`
        insert into p06_execution_runs(
          workspace_id,guide_run_action_binding_id,action_execution_attempt_id,proposal_bundle_id,action_unit_id,
          decision_event_id,approval_grant_id,execution_ref,idempotency_key,request_hash,action_unit_hash,proposal_hash,
          context_hash,effective_guide_set_hash,resolution_hash,policy_hash,gate_set_hash,admission_hash,write_spec_hash,
          dry_run_hash,action_plan_hash,budget_kind,currency,request_payload,route,created_at
        ) values (
          ${input.workspaceId}::uuid,null,${input.actionExecutionAttemptId}::uuid,${source.bundle_id}::uuid,${source.unit_id}::uuid,
          ${source.decision_id}::uuid,${source.grant_id}::uuid,${executionRef},${idempotencyKey},${requestHash},${source.unit_hash},${source.plan_hash},
          ${materialized.contextHash},null,null,${source.policy_hash},${gateSetHash},${materialized.admissionHash},${materialized.writeSpecHash},
          ${identity[1]},${materialized.actionPlanHash},${materialized.budgetKind},${materialized.currency},${JSON.stringify(payload)}::jsonb,
          'guide_budget_human_approved',${evaluatedAt}::timestamptz
        ) on conflict(workspace_id,idempotency_key) do nothing returning id::text
      `)));
      let runId = typeof inserted?.id === "string" ? inserted.id : undefined;
      if (!runId) {
        const replay = one(rows(await tx.execute(sql`select id::text,request_hash from p06_execution_runs
          where workspace_id=${input.workspaceId}::uuid and idempotency_key=${idempotencyKey} for update limit 2`)));
        if (!replay || replay.request_hash !== requestHash || typeof replay.id !== "string") fail("conflict");
        runId = replay.id;
      } else {
        await tx.execute(sql`insert into p06_execution_heads(workspace_id,execution_run_id,state,sequence,trace_sequence,updated_at)
          values(${input.workspaceId}::uuid,${runId}::uuid,'pending',0,0,${evaluatedAt}::timestamptz)`);
        for (const gate of normalizedGates) {
          const receiptHash = digest({ executionRef, phase: gate.phase, sequence: gate.sequence, leaseEpoch: 0, snapshotHash: gate.snapshotHash });
          await tx.execute(sql`insert into p06_execution_gate_snapshots(workspace_id,execution_run_id,phase,sequence,lease_epoch,
            snapshot_hash,receipt_hash,allowlist_hash,enabled,captured_at,expires_at,payload)
            values(${input.workspaceId}::uuid,${runId}::uuid,${gate.phase},${gate.sequence},0,${gate.snapshotHash},${receiptHash},
              ${gate.allowlistHash},${gate.enabled},${gate.capturedAt}::timestamptz,${gate.expiresAt}::timestamptz,
              ${JSON.stringify({ ...gate, receiptHash })}::jsonb)`);
        }
      }
      const request: Omit<P06ExecutionV2Request, "leaseTokenHash" | "fenceHash"> = Object.freeze({
        executionRef, workspaceRef: materialized.workspaceRef, accountRef: materialized.accountRef,
        entityRef: materialized.entityRef, action: materialized.action, budgetKind: materialized.budgetKind,
        currency: materialized.currency, expectedBefore: materialized.expectedBefore, desired: materialized.desired, evaluatedAt,
      });
      return Object.freeze({ workspaceId: input.workspaceId, executionRunId: runId, executionRef, requestHash, idempotencyKey, request });
    });
  }

  /**
   * Creates a disabled execution identity for a rename only from the immutable
   * admission attempt already tied to one human approval and single-use grant.
   * Callers supply no target, previous/desired name, or policy evidence.
   */
  async createHumanRenameApproved(
    input: Readonly<{
      workspaceId: string;
      actionExecutionAttemptId: string;
      evaluatedAt: string;
      gates: readonly P06ExecutionGateSeed[];
    }>,
  ): Promise<P06ExecutionIdentity> {
    if (!UUID.test(input.workspaceId) || !UUID.test(input.actionExecutionAttemptId))
      fail("invalid_input");
    const evaluatedAt = instant(input.evaluatedAt);
    const { normalized: normalizedGates, gateSetHash } = initialGates(input.gates, evaluatedAt);
    return this.database.transaction(async (tx) => {
      const source = one(rows(await tx.execute(sql`
        select a.id::text attempt_id,a.admission_hash,a.write_spec_hash,a.admission_payload,
          u.id::text unit_id,u.unit_ref,u.unit_hash,u.context_hash,u.action_plan_hash,u.action_plan_payload,
          u.account_ref,u.entity_ref,u.action_type,u.campaign_id::text,u.ad_set_id::text,u.ad_id::text,
          bundle.id::text bundle_id,bundle.workspace_ref,bundle.plan_hash,
          d.id::text decision_id,g.id::text grant_id,g.grant_hash,p.policy_hash
        from action_execution_attempts a
        join action_proposal_units u on u.workspace_id=a.workspace_id and u.id=a.unit_id and u.bundle_id=a.bundle_id
        join action_proposal_bundles bundle on bundle.workspace_id=a.workspace_id and bundle.id=a.bundle_id
        join action_approval_policy_snapshots p on p.workspace_id=bundle.workspace_id and p.id=bundle.policy_snapshot_id
        join action_approval_decision_events d on d.workspace_id=a.workspace_id and d.id=a.decision_event_id
          and d.bundle_id=a.bundle_id and d.unit_id=a.unit_id and d.command_kind='approve'
        join action_approval_evidence_grants g on g.workspace_id=a.workspace_id and g.id=a.approval_grant_id
          and g.decision_event_id=d.id and g.bundle_id=a.bundle_id and g.unit_id=a.unit_id
          and g.expires_at>${evaluatedAt}::timestamptz
        join workspaces w on w.id=a.workspace_id and w.lifecycle_state='active' and w.tombstoned_at is null
        where a.workspace_id=${input.workspaceId}::uuid and a.id=${input.actionExecutionAttemptId}::uuid
        for share of a,u,bundle,p,d,g,w limit 2
      `)));
      if (!source
        || typeof source.attempt_id !== "string" || typeof source.unit_id !== "string"
        || typeof source.bundle_id !== "string" || typeof source.decision_id !== "string"
        || typeof source.grant_id !== "string" || typeof source.grant_hash !== "string"
        || typeof source.unit_ref !== "string" || typeof source.unit_hash !== "string"
        || typeof source.workspace_ref !== "string" || typeof source.account_ref !== "string"
        || typeof source.entity_ref !== "string" || typeof source.context_hash !== "string"
        || typeof source.action_plan_hash !== "string" || typeof source.plan_hash !== "string"
        || typeof source.policy_hash !== "string") fail("not_found");
      const action = source.action_type;
      if (![
        "campaign_rename", "adset_rename", "ad_rename",
      ].includes(String(action)) || !HASH.test(source.unit_hash) || !HASH.test(source.context_hash)
        || !HASH.test(source.action_plan_hash) || !HASH.test(source.plan_hash)
        || !HASH.test(source.policy_hash) || !HASH.test(source.grant_hash)) fail("corrupt_store");
      const plan = record(source.action_plan_payload);
      const planAction = record(plan.action);
      const admission = record(source.admission_payload);
      const writeSpec = record(admission.writeSpec);
      const mutation = record(writeSpec.mutation);
      const target = record(writeSpec.target);
      if (plan.actionType !== action || planAction.kind !== "rename"
        || typeof planAction.beforeName !== "string" || typeof planAction.afterName !== "string"
        || planAction.beforeName !== planAction.beforeName.trim() || planAction.afterName !== planAction.afterName.trim()
        || planAction.beforeName.length < 1 || planAction.beforeName.length > 255
        || planAction.afterName.length < 1 || planAction.afterName.length > 255
        || /[\u0000-\u001f\u007f]/.test(planAction.beforeName + planAction.afterName)
        || planAction.beforeName === planAction.afterName
        || admission.admissionHash !== source.admission_hash || writeSpec.specHash !== source.write_spec_hash
        || writeSpec.actionPlanHash !== source.action_plan_hash || target.entityRef !== source.entity_ref
        || mutation.kind !== "rename" || mutation.previousName !== planAction.beforeName || mutation.desiredName !== planAction.afterName
        || record(admission.capabilities).canExecute !== false || record(admission.capabilities).canWriteMeta !== false
        || record(admission.capabilities).canDispatchNetwork !== false
        || (action === "campaign_rename" && planAction.entity && record(planAction.entity).level !== "campaign")
        || (action === "adset_rename" && planAction.entity && record(planAction.entity).level !== "adset")
        || (action === "ad_rename" && planAction.entity && record(planAction.entity).level !== "ad")
        || (action === "campaign_rename" && (typeof source.campaign_id !== "string" || source.ad_set_id !== null || source.ad_id !== null))
        || (action === "adset_rename" && (source.campaign_id !== null || typeof source.ad_set_id !== "string" || source.ad_id !== null))
        || (action === "ad_rename" && (source.campaign_id !== null || source.ad_set_id !== null || typeof source.ad_id !== "string"))
      ) fail("corrupt_store");
      const mirror = action === "campaign_rename"
        ? one(rows(await tx.execute(sql`select configured_status,name from ad_campaigns where workspace_id=${input.workspaceId}::uuid
            and id=${source.campaign_id}::uuid and disappeared_at is null for share limit 2`)))
        : action === "adset_rename"
          ? one(rows(await tx.execute(sql`select configured_status,name from meta_ad_sets where workspace_id=${input.workspaceId}::uuid
              and id=${source.ad_set_id}::uuid and disappeared_at is null for share limit 2`)))
          : one(rows(await tx.execute(sql`select configured_status,name from meta_ads where workspace_id=${input.workspaceId}::uuid
              and id=${source.ad_id}::uuid and disappeared_at is null for share limit 2`)));
      if (!mirror || (mirror.configured_status !== "ACTIVE" && mirror.configured_status !== "PAUSED")
        || mirror.name !== planAction.beforeName) fail("corrupt_store");
      const requestCore = {
        version: "p06-execution-request/1.0.0", workspaceRef: source.workspace_ref,
        accountRef: source.account_ref, entityRef: source.entity_ref, action: action as P06ExecutionV2Action,
        expectedBefore: { status: mirror.configured_status, budgetMinor: null, name: planAction.beforeName },
        desired: { status: mirror.configured_status, budgetMinor: null, name: planAction.afterName }, evaluatedAt,
        actionUnitHash: source.unit_hash, proposalHash: source.plan_hash, contextHash: source.context_hash,
        effectiveGuideSetHash: null, resolutionHash: null, policyHash: source.policy_hash, gateSetHash,
        admissionHash: source.admission_hash, writeSpecHash: source.write_spec_hash,
        actionPlanHash: source.action_plan_hash, route: "human_rename_approved" as const,
      };
      const requestHash = digest(requestCore);
      const executionRef = `p06_execution_${requestHash.slice(0, 24)}`;
      const idempotencyKey = `p06_exec_idem_${digest({ attemptId: source.attempt_id, grantHash: source.grant_hash, requestHash })}`;
      const payload = { ...requestCore, executionRef, idempotencyKey, requestHash };
      const inserted = one(rows(await tx.execute(sql`
        insert into p06_execution_runs(
          workspace_id,guide_run_action_binding_id,action_execution_attempt_id,proposal_bundle_id,action_unit_id,
          decision_event_id,approval_grant_id,execution_ref,idempotency_key,request_hash,action_unit_hash,proposal_hash,
          context_hash,effective_guide_set_hash,resolution_hash,policy_hash,gate_set_hash,admission_hash,write_spec_hash,
          action_plan_hash,budget_kind,currency,request_payload,route,created_at
        ) values (
          ${input.workspaceId}::uuid,null,${source.attempt_id}::uuid,${source.bundle_id}::uuid,${source.unit_id}::uuid,
          ${source.decision_id}::uuid,${source.grant_id}::uuid,${executionRef},${idempotencyKey},${requestHash},${source.unit_hash},${source.plan_hash},
          ${source.context_hash},null,null,${source.policy_hash},${gateSetHash},${source.admission_hash},${source.write_spec_hash},
          ${source.action_plan_hash},null,null,${JSON.stringify(payload)}::jsonb,'human_rename_approved',${evaluatedAt}::timestamptz
        ) on conflict(workspace_id,idempotency_key) do nothing returning id::text
      `)));
      let runId = typeof inserted?.id === "string" ? inserted.id : undefined;
      if (!runId) {
        const replay = one(rows(await tx.execute(sql`select id::text,request_hash from p06_execution_runs
          where workspace_id=${input.workspaceId}::uuid and idempotency_key=${idempotencyKey} for update limit 2`)));
        if (!replay || replay.request_hash !== requestHash || typeof replay.id !== "string") fail("conflict");
        runId = replay.id;
      } else {
        await tx.execute(sql`insert into p06_execution_heads(workspace_id,execution_run_id,state,sequence,trace_sequence,updated_at)
          values(${input.workspaceId}::uuid,${runId}::uuid,'pending',0,0,${evaluatedAt}::timestamptz)`);
        for (const gate of normalizedGates) {
          const receiptHash = digest({ executionRef, phase: gate.phase, sequence: gate.sequence, leaseEpoch: 0, snapshotHash: gate.snapshotHash });
          await tx.execute(sql`insert into p06_execution_gate_snapshots(workspace_id,execution_run_id,phase,sequence,lease_epoch,
            snapshot_hash,receipt_hash,allowlist_hash,enabled,captured_at,expires_at,payload)
            values(${input.workspaceId}::uuid,${runId}::uuid,${gate.phase},${gate.sequence},0,${gate.snapshotHash},${receiptHash},
              ${gate.allowlistHash},${gate.enabled},${gate.capturedAt}::timestamptz,${gate.expiresAt}::timestamptz,
              ${JSON.stringify({ ...gate, receiptHash })}::jsonb)`);
        }
      }
      if (!runId) fail("corrupt_store");
      return Object.freeze({ workspaceId: input.workspaceId, executionRunId: runId, executionRef, requestHash, idempotencyKey,
        request: Object.freeze({ executionRef, workspaceRef: source.workspace_ref, accountRef: source.account_ref,
          entityRef: source.entity_ref, action: action as P06ExecutionV2Action, budgetKind: null, currency: null,
          expectedBefore: Object.freeze({ status: mirror.configured_status as "ACTIVE" | "PAUSED", budgetMinor: null, name: planAction.beforeName }),
          desired: Object.freeze({ status: mirror.configured_status as "ACTIVE" | "PAUSED", budgetMinor: null, name: planAction.afterName }), evaluatedAt }) });
    });
  }

  async createLimitedAutonomyStatus(
    input: Readonly<{
      workspaceId: string;
      admissionId: string;
      evaluatedAt: string;
      gates: readonly P06ExecutionGateSeed[];
    }>,
  ): Promise<P06ExecutionIdentity> {
    if (!UUID.test(input.workspaceId) || !UUID.test(input.admissionId))
      fail("invalid_input");
    const evaluatedAt = instant(input.evaluatedAt);
    const { normalized: normalizedGates, gateSetHash } = initialGates(
      input.gates,
      evaluatedAt,
    );
    if (normalizedGates.some((gate) => !gate.enabled)) fail("invalid_input");
    return this.database.transaction(async (tx) => {
      const source = one(
        rows(
          await tx.execute(sql`
            select a.id::text admission_id,a.admission_hash,a.account_ref,a.entity_ref,
              a.context_hash,a.effective_guide_set_hash,a.resolution_hash,
              a.approval_policy_hash,a.autonomy_evidence_hash,a.data_health_report_hash,
              a.protection_hash,a.action_plan_hash,a.expected_status,a.desired_status,
              h.run_payload->>'workspaceRef' workspace_ref
            from p06_limited_autonomy_admissions a
            join guide_run_heads h on h.workspace_id=a.workspace_id and h.run_id=a.run_id
            join workspaces w on w.id=a.workspace_id and w.lifecycle_state='active'
              and w.tombstoned_at is null
            where a.workspace_id=${input.workspaceId}::uuid and a.id=${input.admissionId}::uuid
              and a.action_type='status_pause' and a.expires_at>${evaluatedAt}::timestamptz
            for share of a,h,w limit 2
          `),
        ),
      );
      if (!source) fail("not_found");
      const expectedStatus = source.expected_status;
      const desiredStatus = source.desired_status;
      if (
        expectedStatus !== "ACTIVE" ||
        desiredStatus !== "PAUSED" ||
        typeof source.workspace_ref !== "string" ||
        !REF.test(source.workspace_ref)
      )
        fail("corrupt_store");
      for (const key of [
        "admission_hash",
        "context_hash",
        "effective_guide_set_hash",
        "resolution_hash",
        "approval_policy_hash",
        "autonomy_evidence_hash",
        "data_health_report_hash",
        "protection_hash",
        "action_plan_hash",
      ] as const) {
        if (typeof source[key] !== "string" || !HASH.test(source[key] as string))
          fail("corrupt_store");
      }
      if (
        typeof source.account_ref !== "string" ||
        !REF.test(source.account_ref) ||
        typeof source.entity_ref !== "string" ||
        !REF.test(source.entity_ref)
      )
        fail("corrupt_store");
      const requestCore = {
        version: "p06-execution-request/1.0.0",
        workspaceRef: source.workspace_ref,
        accountRef: source.account_ref,
        entityRef: source.entity_ref,
        action: "status_pause" as const,
        expectedBefore: { status: "ACTIVE" as const, budgetMinor: null },
        desired: { status: "PAUSED" as const, budgetMinor: null },
        evaluatedAt,
        contextHash: source.context_hash,
        effectiveGuideSetHash: source.effective_guide_set_hash,
        resolutionHash: source.resolution_hash,
        policyHash: source.approval_policy_hash,
        gateSetHash,
        admissionHash: source.admission_hash,
        autonomyEvidenceHash: source.autonomy_evidence_hash,
        dataHealthReportHash: source.data_health_report_hash,
        protectionHash: source.protection_hash,
        actionPlanHash: source.action_plan_hash,
        route: "limited_autonomy_status" as const,
      };
      const requestHash = digest(requestCore);
      const executionRef = `p06_execution_${requestHash.slice(0, 24)}`;
      const idempotencyKey = `p06_exec_idem_${digest({ limitedAutonomyAdmissionId: input.admissionId, requestHash })}`;
      const payload = { ...requestCore, executionRef, idempotencyKey, requestHash };
      const inserted = one(
        rows(
          await tx.execute(sql`
            insert into p06_execution_runs(
              workspace_id,limited_autonomy_admission_id,execution_ref,idempotency_key,
              request_hash,context_hash,effective_guide_set_hash,resolution_hash,policy_hash,
              gate_set_hash,admission_hash,action_plan_hash,autonomy_evidence_hash,
              data_health_report_hash,protection_hash,request_payload,route,created_at
            ) values (
              ${input.workspaceId}::uuid,${input.admissionId}::uuid,${executionRef},${idempotencyKey},
              ${requestHash},${source.context_hash},${source.effective_guide_set_hash},${source.resolution_hash},
              ${source.approval_policy_hash},${gateSetHash},${source.admission_hash},${source.action_plan_hash},
              ${source.autonomy_evidence_hash},${source.data_health_report_hash},${source.protection_hash},
              ${JSON.stringify(payload)}::jsonb,'limited_autonomy_status',${evaluatedAt}::timestamptz
            ) on conflict(workspace_id,idempotency_key) do nothing returning id::text
          `),
        ),
      );
      let runId = typeof inserted?.id === "string" ? inserted.id : undefined;
      if (!runId) {
        const replay = one(
          rows(
            await tx.execute(sql`select id::text,request_hash from p06_execution_runs
              where workspace_id=${input.workspaceId}::uuid and idempotency_key=${idempotencyKey}
              for update limit 2`),
          ),
        );
        if (!replay || replay.request_hash !== requestHash || typeof replay.id !== "string")
          fail("conflict");
        runId = replay.id;
      } else {
        await tx.execute(sql`insert into p06_execution_heads(workspace_id,execution_run_id,state,sequence,trace_sequence,updated_at)
          values(${input.workspaceId}::uuid,${runId}::uuid,'pending',0,0,${evaluatedAt}::timestamptz)`);
        for (const gate of normalizedGates) {
          const receiptHash = digest({ executionRef, phase: gate.phase, sequence: gate.sequence, leaseEpoch: 0, snapshotHash: gate.snapshotHash });
          await tx.execute(sql`insert into p06_execution_gate_snapshots(workspace_id,execution_run_id,phase,sequence,lease_epoch,
            snapshot_hash,receipt_hash,allowlist_hash,enabled,captured_at,expires_at,payload)
            values(${input.workspaceId}::uuid,${runId}::uuid,${gate.phase},${gate.sequence},0,${gate.snapshotHash},${receiptHash},
              ${gate.allowlistHash},true,${gate.capturedAt}::timestamptz,${gate.expiresAt}::timestamptz,
              ${JSON.stringify({ ...gate, receiptHash })}::jsonb)`);
        }
      }
      const request: Omit<P06ExecutionV2Request, "leaseTokenHash" | "fenceHash"> = Object.freeze({
        executionRef,
        workspaceRef: String(source.workspace_ref),
        accountRef: String(source.account_ref),
        entityRef: String(source.entity_ref),
        action: "status_pause",
        expectedBefore: Object.freeze({ status: "ACTIVE", budgetMinor: null }),
        desired: Object.freeze({ status: "PAUSED", budgetMinor: null }),
        evaluatedAt,
      });
      return Object.freeze({ workspaceId: input.workspaceId, executionRunId: runId, executionRef, requestHash, idempotencyKey, request });
    });
  }

  async listUnmaterializedLimitedAutonomyAdmissions(
    limit = 25,
  ): Promise<readonly Readonly<{ workspaceId: string; admissionId: string }>[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      fail("invalid_input");
    const candidates = rows(await this.database.execute(sql`
      select a.workspace_id::text workspace_id,a.id::text admission_id
      from p06_limited_autonomy_admissions a
      join workspaces w on w.id=a.workspace_id and w.lifecycle_state='active' and w.tombstoned_at is null
      left join p06_execution_runs r on r.workspace_id=a.workspace_id and r.limited_autonomy_admission_id=a.id
      where r.id is null and a.expires_at>statement_timestamp()
      order by a.admitted_at,a.id limit ${limit}
    `));
    if (candidates.some((row) => typeof row.workspace_id !== "string" || !UUID.test(row.workspace_id)
      || typeof row.admission_id !== "string" || !UUID.test(row.admission_id))) fail("corrupt_store");
    return Object.freeze(candidates.map((row) => Object.freeze({ workspaceId: String(row.workspace_id), admissionId: String(row.admission_id) })));
  }

  async listRunnable(limit = 25): Promise<readonly string[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      fail("invalid_input");
    return this.database.transaction(async (tx) => {
      const candidates = rows(
        await tx.execute(sql`
          select r.execution_ref
          from p06_execution_runs r
          join p06_execution_heads h on h.workspace_id=r.workspace_id
            and h.execution_run_id=r.id
          join workspaces w on w.id=r.workspace_id
            and w.lifecycle_state='active' and w.tombstoned_at is null
          where h.state='pending'
             or (h.state in ('claimed','running') and h.lease_expires_at<=statement_timestamp())
          order by r.created_at,r.id
          limit ${limit}
        `),
      );
      if (
        candidates.some(
          (candidate) =>
            typeof candidate.execution_ref !== "string" ||
            !/^p06_execution_[a-f0-9]{24}$/.test(candidate.execution_ref),
        )
      )
        fail("corrupt_store");
      return Object.freeze(candidates.map((candidate) => String(candidate.execution_ref)));
    });
  }

  async listRunnableByRoute(route: "human_approved" | "guide_budget_human_approved" | "limited_autonomy_status", limit = 25): Promise<readonly string[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail("invalid_input");
    const candidates = rows(await this.database.execute(sql`
      select r.execution_ref from p06_execution_runs r
      join p06_execution_heads h on h.workspace_id=r.workspace_id and h.execution_run_id=r.id
      join workspaces w on w.id=r.workspace_id and w.lifecycle_state='active' and w.tombstoned_at is null
      where r.route=${route} and (h.state='pending' or (h.state in ('claimed','running') and h.lease_expires_at<=statement_timestamp()))
        and (${route}<>'limited_autonomy_status' or 2=(select count(*) from p06_execution_gate_snapshots gate
          where gate.workspace_id=r.workspace_id and gate.execution_run_id=r.id and gate.lease_epoch=0
            and gate.phase in ('staging','admission') and gate.enabled and gate.expires_at>statement_timestamp()))
      order by r.created_at,r.id limit ${limit}
    `));
    if (candidates.some((row) => typeof row.execution_ref !== "string" || !/^p06_execution_[a-f0-9]{24}$/.test(row.execution_ref))) fail("corrupt_store");
    return Object.freeze(candidates.map((row) => String(row.execution_ref)));
  }

  async listUnmaterializedGuideBudgetAttempts(limit = 25): Promise<readonly Readonly<{ workspaceId: string; attemptId: string }>[]> {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) fail("invalid_input");
    const candidates = rows(await this.database.execute(sql`
      select a.workspace_id::text workspace_id,a.id::text attempt_id
      from action_execution_attempts a
      join workspaces w on w.id=a.workspace_id and w.lifecycle_state='active' and w.tombstoned_at is null
      join action_proposal_units u on u.workspace_id=a.workspace_id and u.id=a.unit_id
        and u.action_type in ('budget_decrease','budget_increase') and u.expires_at>statement_timestamp()
      join action_proposal_bundles bundle on bundle.workspace_id=a.workspace_id and bundle.id=a.bundle_id
        and bundle.plan_ref ~ '^guide_budget_[a-f0-9]{32}_[a-f0-9]{64}$'
      join action_approval_evidence_grants g on g.workspace_id=a.workspace_id and g.id=a.approval_grant_id
        and g.expires_at>statement_timestamp() and g.capability='approval_evidence_only' and g.can_execute=false
      left join p06_execution_runs r on r.workspace_id=a.workspace_id and r.action_execution_attempt_id=a.id
      where r.id is null order by a.created_at,a.id limit ${limit}
    `));
    if (candidates.some((row) => typeof row.workspace_id !== "string" || !UUID.test(row.workspace_id)
      || typeof row.attempt_id !== "string" || !UUID.test(row.attempt_id))) fail("corrupt_store");
    return Object.freeze(candidates.map((row) => Object.freeze({ workspaceId: String(row.workspace_id), attemptId: String(row.attempt_id) })));
  }

  async appendGate(
    input: Readonly<{ executionRef: string; gate: P06ExecutionGateSeed }>,
  ): Promise<string> {
    if (!/^p06_execution_[a-f0-9]{24}$/.test(input.executionRef))
      fail("invalid_input");
    const sequence = PHASES.indexOf(input.gate.phase) + 1;
    if (
      sequence < 3 ||
      typeof input.gate.enabled !== "boolean" ||
      !HASH.test(input.gate.allowlistHash) ||
      Date.parse(instant(input.gate.expiresAt)) <=
        Date.parse(instant(input.gate.capturedAt))
    )
      fail("invalid_input");
    return this.database.transaction(async (tx) => {
      const run = one(
        rows(
          await tx.execute(
            sql`select r.id::text,r.workspace_id::text,h.lease_epoch from p06_execution_runs r join p06_execution_heads h on h.workspace_id=r.workspace_id and h.execution_run_id=r.id where r.execution_ref=${input.executionRef} for update of h limit 2`,
          ),
        ),
      );
      if (
        !run ||
        typeof run.id !== "string" ||
        typeof run.workspace_id !== "string" ||
        !Number.isSafeInteger(Number(run.lease_epoch)) ||
        Number(run.lease_epoch) < 1
      )
        fail("not_found");
      const leaseEpoch = Number(run.lease_epoch);
      const core = {
        version: "p06-execution-gate/1.0.0",
        phase: input.gate.phase,
        sequence,
        leaseEpoch,
        enabled: input.gate.enabled,
        allowlistHash: input.gate.allowlistHash,
        capturedAt: input.gate.capturedAt,
        expiresAt: input.gate.expiresAt,
      };
      const snapshotHash = digest(core);
      const receiptHash = digest({
        executionRef: input.executionRef,
        phase: input.gate.phase,
        sequence,
        leaseEpoch,
        snapshotHash,
      });
      const payload = { ...core, snapshotHash, receiptHash };
      const inserted = rows(
        await tx.execute(
          sql`insert into p06_execution_gate_snapshots(workspace_id,execution_run_id,phase,sequence,lease_epoch,snapshot_hash,receipt_hash,allowlist_hash,enabled,captured_at,expires_at,payload) values(${run.workspace_id}::uuid,${run.id}::uuid,${input.gate.phase},${sequence},${leaseEpoch},${snapshotHash},${receiptHash},${input.gate.allowlistHash},${input.gate.enabled},${input.gate.capturedAt}::timestamptz,${input.gate.expiresAt}::timestamptz,${JSON.stringify(payload)}::jsonb) on conflict(workspace_id,execution_run_id,phase,lease_epoch) do nothing returning id`,
        ),
      );
      if (inserted.length !== 1) {
        const replay = one(
          rows(
            await tx.execute(
              sql`select receipt_hash from p06_execution_gate_snapshots where workspace_id=${run.workspace_id}::uuid and execution_run_id=${run.id}::uuid and phase=${input.gate.phase} and lease_epoch=${leaseEpoch} limit 2`,
            ),
          ),
        );
        if (!replay || replay.receipt_hash !== receiptHash) fail("conflict");
      }
      return receiptHash;
    });
  }

  async claimLease(
    input: Readonly<{
      executionRef: string;
      leaseTokenHash: string;
      fenceHash: string;
      now: string;
      leaseUntil: string;
    }>,
  ): Promise<
    P06ExecutionV2Receipt<
      Readonly<{
        executionRef: string;
        leaseTokenHash: string;
        fenceHash: string;
        owned: true;
      }>
    >
  > {
    if (
      !/^p06_execution_[a-f0-9]{24}$/.test(input.executionRef) ||
      !HASH.test(input.leaseTokenHash) ||
      !HASH.test(input.fenceHash)
    )
      fail("invalid_input");
    const now = instant(input.now);
    const leaseUntil = instant(input.leaseUntil);
    if (Date.parse(leaseUntil) <= Date.parse(now)) fail("invalid_input");
    return this.database.transaction(async (tx) => {
      const current = one(
        rows(
          await tx.execute(
            sql`select r.id::text run_id,r.workspace_id::text,h.state,h.sequence,h.trace_sequence,h.head_event_hash,h.lease_token_hash,h.fence_hash,h.lease_epoch,h.lease_expires_at::text from p06_execution_runs r join p06_execution_heads h on h.workspace_id=r.workspace_id and h.execution_run_id=r.id join workspaces w on w.id=r.workspace_id and w.lifecycle_state='active' where r.execution_ref=${input.executionRef} for update of h,w limit 2`,
          ),
        ),
      );
      if (
        !current ||
        typeof current.run_id !== "string" ||
        typeof current.workspace_id !== "string"
      )
        fail("not_found");
      const receiptCore = Object.freeze({
        executionRef: input.executionRef,
        leaseTokenHash: input.leaseTokenHash,
        fenceHash: input.fenceHash,
        owned: true as const,
      });
      const receiptHash = digest(receiptCore);
      if (
        (current.state === "claimed" || current.state === "running") &&
        current.lease_token_hash === input.leaseTokenHash &&
        current.fence_hash === input.fenceHash &&
        Date.parse(String(current.lease_expires_at)) > Date.parse(now)
      ) {
        return Object.freeze({ core: receiptCore, receiptHash });
      }
      const pending = current.state === "pending";
      const expired =
        (current.state === "claimed" || current.state === "running") &&
        Number.isFinite(Date.parse(String(current.lease_expires_at))) &&
        Date.parse(String(current.lease_expires_at)) <= Date.parse(now);
      if (!pending && !expired) fail("conflict");
      const sequence = Number(current.sequence) + 1;
      const previousHash =
        typeof current.head_event_hash === "string"
          ? current.head_event_hash
          : "GENESIS";
      const eventKind = pending ? "lease_claimed" : "lease_reclaimed";
      const eventCore = {
        version: "p06-execution-event/1.0.0",
        executionRef: input.executionRef,
        sequence,
        traceSequence: null,
        eventKind,
        step: null,
        outcome: "ok",
        previousHash,
        receiptCore,
        receiptHash,
        occurredAt: now,
      };
      const eventHash = digest(eventCore);
      const eventRef = `p06_exec_event_${eventHash.slice(0, 24)}`;
      const eventPayload = { ...eventCore, eventRef, eventHash };
      const inserted = rows(
        await tx.execute(
          sql`insert into p06_execution_events(workspace_id,execution_run_id,event_ref,event_hash,sequence,trace_sequence,event_kind,step,outcome,previous_hash,receipt_hash,payload,occurred_at) values(${current.workspace_id}::uuid,${current.run_id}::uuid,${eventRef},${eventHash},${sequence},null,${eventKind},null,'ok',${previousHash},${receiptHash},${JSON.stringify(eventPayload)}::jsonb,${now}::timestamptz) on conflict(workspace_id,event_hash) do nothing returning id`,
        ),
      );
      if (inserted.length !== 1) fail("conflict");
      const advanced = rows(
        await tx.execute(
          sql`update p06_execution_heads set state='claimed',sequence=${sequence},head_event_hash=${eventHash},lease_token_hash=${input.leaseTokenHash},fence_hash=${input.fenceHash},lease_epoch=${Number(current.lease_epoch) + 1},lease_expires_at=${leaseUntil}::timestamptz,updated_at=${now}::timestamptz where workspace_id=${current.workspace_id}::uuid and execution_run_id=${current.run_id}::uuid and sequence=${Number(current.sequence)} returning id`,
        ),
      );
      if (advanced.length !== 1) fail("conflict");
      return Object.freeze({ core: receiptCore, receiptHash });
    });
  }

  async appendTrace(
    input: Readonly<{
      executionRef: string;
      leaseTokenHash: string;
      fenceHash: string;
      step: (typeof P06_EXECUTION_V2_STEPS)[number];
      outcome: P06ExecutionV2TraceEntry["outcome"];
      receiptCore: Readonly<Record<string, unknown>>;
      occurredAt: string;
    }>,
  ): Promise<Readonly<{ eventHash: string; receiptHash: string }>> {
    if (
      !/^p06_execution_[a-f0-9]{24}$/.test(input.executionRef) ||
      !HASH.test(input.leaseTokenHash) ||
      !HASH.test(input.fenceHash) ||
      !input.receiptCore ||
      Array.isArray(input.receiptCore) ||
      typeof input.receiptCore !== "object"
    )
      fail("invalid_input");
    const occurredAt = instant(input.occurredAt);
    const expectedTraceSequence =
      P06_EXECUTION_V2_STEPS.indexOf(input.step) + 1;
    if (
      expectedTraceSequence < 1 ||
      !["ok", "skipped", "held", "ambiguous", "already_applied"].includes(
        input.outcome,
      ) ||
      Buffer.byteLength(JSON.stringify(input.receiptCore), "utf8") > 8_192
    )
      fail("invalid_input");
    const receiptHash = digest(input.receiptCore);
    return this.database.transaction(async (tx) => {
      const current = one(
        rows(
          await tx.execute(
            sql`select r.id::text run_id,r.workspace_id::text,h.state,h.sequence,h.trace_sequence,h.head_event_hash,h.lease_token_hash,h.fence_hash,h.lease_epoch,h.lease_expires_at::text from p06_execution_runs r join p06_execution_heads h on h.workspace_id=r.workspace_id and h.execution_run_id=r.id join workspaces w on w.id=r.workspace_id and w.lifecycle_state='active' where r.execution_ref=${input.executionRef} for update of h,w limit 2`,
          ),
        ),
      );
      if (
        !current ||
        typeof current.run_id !== "string" ||
        typeof current.workspace_id !== "string"
      )
        fail("not_found");
      if (
        (current.state !== "claimed" && current.state !== "running") ||
        current.lease_token_hash !== input.leaseTokenHash ||
        current.fence_hash !== input.fenceHash ||
        Date.parse(String(current.lease_expires_at)) <=
          Date.parse(occurredAt) ||
        Number(current.trace_sequence) + 1 !== expectedTraceSequence
      )
        fail("conflict");
      const sequence = Number(current.sequence) + 1;
      const previousHash = String(current.head_event_hash);
      const eventCore = {
        version: "p06-execution-event/1.0.0",
        executionRef: input.executionRef,
        sequence,
        traceSequence: expectedTraceSequence,
        eventKind: "trace",
        step: input.step,
        outcome: input.outcome,
        previousHash,
        receiptCore: input.receiptCore,
        receiptHash,
        occurredAt,
      };
      const eventHash = digest(eventCore);
      const eventRef = `p06_exec_event_${eventHash.slice(0, 24)}`;
      const payload = { ...eventCore, eventRef, eventHash };
      const inserted = rows(
        await tx.execute(
          sql`insert into p06_execution_events(workspace_id,execution_run_id,event_ref,event_hash,sequence,trace_sequence,event_kind,step,outcome,previous_hash,receipt_hash,payload,occurred_at) values(${current.workspace_id}::uuid,${current.run_id}::uuid,${eventRef},${eventHash},${sequence},${expectedTraceSequence},'trace',${input.step},${input.outcome},${previousHash},${receiptHash},${JSON.stringify(payload)}::jsonb,${occurredAt}::timestamptz) on conflict(workspace_id,event_hash) do nothing returning id`,
        ),
      );
      if (inserted.length !== 1) fail("conflict");
      let state = "running";
      let terminalHash: string | null = null;
      if (expectedTraceSequence === 10) {
        const terminal = one(
          rows(
            await tx.execute(
              sql`select receipt_hash,payload->'receiptCore'->>'outcome' outcome from p06_execution_events where workspace_id=${current.workspace_id}::uuid and execution_run_id=${current.run_id}::uuid and trace_sequence=9 limit 2`,
            ),
          ),
        );
        const terminalOutcome = terminal?.outcome as
          P06ExecutionV2Outcome | undefined;
        if (!terminal || typeof terminal.receipt_hash !== "string")
          fail("corrupt_store");
        state =
          terminalOutcome === "verification_failed"
            ? "verification_failed"
            : terminalOutcome === "expected_before_mismatch"
              ? "held"
              : [
                    "already_applied_no_write",
                    "written_verified",
                    "ambiguous_resolved",
                  ].includes(String(terminalOutcome))
                ? "succeeded"
                : fail("corrupt_store");
        terminalHash = terminal.receipt_hash;
      }
      const advanced =
        expectedTraceSequence === 10
          ? rows(
              await tx.execute(
                sql`update p06_execution_heads set state=${state},sequence=${sequence},trace_sequence=${expectedTraceSequence},head_event_hash=${eventHash},lease_token_hash=null,fence_hash=null,lease_expires_at=null,terminal_hash=${terminalHash},updated_at=${occurredAt}::timestamptz where workspace_id=${current.workspace_id}::uuid and execution_run_id=${current.run_id}::uuid and sequence=${Number(current.sequence)} returning id`,
              ),
            )
          : rows(
              await tx.execute(
                sql`update p06_execution_heads set state='running',sequence=${sequence},trace_sequence=${expectedTraceSequence},head_event_hash=${eventHash},updated_at=${occurredAt}::timestamptz where workspace_id=${current.workspace_id}::uuid and execution_run_id=${current.run_id}::uuid and sequence=${Number(current.sequence)} returning id`,
              ),
            );
      if (advanced.length !== 1) fail("conflict");
      return Object.freeze({ eventHash, receiptHash });
    });
  }

  async appendObservation(
    input: Readonly<{
      executionRef: string;
      eventHash: string;
      kind:
        "read_before" | "write_receipt" | "read_after" | "ambiguous_retry_read";
      metadataHash: string;
      rawHash: string;
      observedValue: Readonly<Record<string, unknown>>;
      observedAt: string;
    }>,
  ): Promise<
    Readonly<{
      observationId: string;
      observationRef: string;
      observationHash: string;
    }>
  > {
    if (
      !/^p06_execution_[a-f0-9]{24}$/.test(input.executionRef) ||
      !HASH.test(input.eventHash) ||
      !HASH.test(input.metadataHash) ||
      !HASH.test(input.rawHash) ||
      !input.observedValue ||
      Array.isArray(input.observedValue) ||
      typeof input.observedValue !== "object" ||
      Buffer.byteLength(JSON.stringify(input.observedValue), "utf8") > 4_096
    )
      fail("invalid_input");
    const observedAt = instant(input.observedAt);
    return this.database.transaction(async (tx) => {
      const target = one(
        rows(
          await tx.execute(
            sql`select r.id::text run_id,r.workspace_id::text,e.id::text event_id from p06_execution_runs r join p06_execution_events e on e.workspace_id=r.workspace_id and e.execution_run_id=r.id and e.event_hash=${input.eventHash} join workspaces w on w.id=r.workspace_id and w.lifecycle_state='active' where r.execution_ref=${input.executionRef} for share of r,e,w limit 2`,
          ),
        ),
      );
      if (
        !target ||
        typeof target.run_id !== "string" ||
        typeof target.workspace_id !== "string" ||
        typeof target.event_id !== "string"
      )
        fail("not_found");
      const observationCore = {
        version: "p06-execution-observation/1.0.0",
        executionRef: input.executionRef,
        kind: input.kind,
        metadataHash: input.metadataHash,
        rawHash: input.rawHash,
        observedValue: input.observedValue,
        observedAt,
      };
      const observationHash = digest(observationCore);
      const observationRef = `p06_observation_${observationHash.slice(0, 24)}`;
      const inserted = one(
        rows(
          await tx.execute(
            sql`insert into p06_execution_observations(workspace_id,execution_run_id,event_id,kind,observation_ref,observation_hash,metadata_hash,raw_hash,observed_value,observed_at) values(${target.workspace_id}::uuid,${target.run_id}::uuid,${target.event_id}::uuid,${input.kind},${observationRef},${observationHash},${input.metadataHash},${input.rawHash},${JSON.stringify(input.observedValue)}::jsonb,${observedAt}::timestamptz) on conflict(workspace_id,event_id,kind) do nothing returning id::text`,
          ),
        ),
      );
      if (inserted && typeof inserted.id === "string")
        return Object.freeze({
          observationId: inserted.id,
          observationRef,
          observationHash,
        });
      const replay = one(
        rows(
          await tx.execute(
            sql`select id::text,observation_hash from p06_execution_observations where workspace_id=${target.workspace_id}::uuid and event_id=${target.event_id}::uuid and kind=${input.kind} limit 2`,
          ),
        ),
      );
      if (
        !replay ||
        replay.observation_hash !== observationHash ||
        typeof replay.id !== "string"
      )
        fail("conflict");
      return Object.freeze({
        observationId: replay.id,
        observationRef,
        observationHash,
      });
    });
  }

  async appendRollbackProposal(
    input: Readonly<{
      proposal: P06ExecutionV2RollbackProposal;
      beforeObservationId: string;
      afterObservationId: string;
      writeObservationId: string;
    }>,
  ): Promise<
    Readonly<{
      rollbackProposalId: string;
      proposalRef: string;
      proposalHash: string;
    }>
  > {
    if (
      !UUID.test(input.beforeObservationId) ||
      !UUID.test(input.afterObservationId) ||
      !UUID.test(input.writeObservationId) ||
      !HASH.test(input.proposal.proposalHash) ||
      input.proposal.requiresNewHumanApproval !== true
    )
      fail("invalid_input");
    const { proposalHash, ...core } = input.proposal;
    if (digest(core) !== proposalHash) fail("invalid_input");
    const proposalRef = `p06_rollback_${proposalHash.slice(0, 24)}`;
    const payload = { ...input.proposal, proposalRef };
    return this.database.transaction(async (tx) => {
      const target = one(
        rows(
          await tx.execute(
            sql`select r.id::text run_id,r.workspace_id::text,e.id::text terminal_event_id from p06_execution_runs r join p06_execution_heads h on h.workspace_id=r.workspace_id and h.execution_run_id=r.id and h.state='verification_failed' join p06_execution_events e on e.workspace_id=r.workspace_id and e.execution_run_id=r.id and e.trace_sequence=9 and e.receipt_hash=${input.proposal.terminalHash} where r.execution_ref=${input.proposal.executionRef} for share of r,h,e limit 2`,
          ),
        ),
      );
      if (
        !target ||
        typeof target.run_id !== "string" ||
        typeof target.workspace_id !== "string" ||
        typeof target.terminal_event_id !== "string"
      )
        fail("not_found");
      const inserted = one(
        rows(
          await tx.execute(
            sql`insert into p06_rollback_proposals(workspace_id,execution_run_id,terminal_event_id,before_observation_id,after_observation_id,write_observation_id,proposal_ref,proposal_hash,payload,requires_new_human_approval) values(${target.workspace_id}::uuid,${target.run_id}::uuid,${target.terminal_event_id}::uuid,${input.beforeObservationId}::uuid,${input.afterObservationId}::uuid,${input.writeObservationId}::uuid,${proposalRef},${proposalHash},${JSON.stringify(payload)}::jsonb,true) on conflict(workspace_id,execution_run_id) do nothing returning id::text`,
          ),
        ),
      );
      if (inserted && typeof inserted.id === "string")
        return Object.freeze({
          rollbackProposalId: inserted.id,
          proposalRef,
          proposalHash,
        });
      const replay = one(
        rows(
          await tx.execute(
            sql`select id::text,proposal_hash from p06_rollback_proposals where workspace_id=${target.workspace_id}::uuid and execution_run_id=${target.run_id}::uuid limit 2`,
          ),
        ),
      );
      if (
        !replay ||
        replay.proposal_hash !== proposalHash ||
        typeof replay.id !== "string"
      )
        fail("conflict");
      return Object.freeze({
        rollbackProposalId: replay.id,
        proposalRef,
        proposalHash,
      });
    });
  }
}
