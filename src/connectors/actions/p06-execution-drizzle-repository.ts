import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { P06_EXECUTION_V2_STEPS, type P06ExecutionV2Action, type P06ExecutionV2Outcome,
  type P06ExecutionV2Receipt, type P06ExecutionV2Request, type P06ExecutionV2RollbackProposal,
  type P06ExecutionV2TraceEntry } from "@/domain/actions/p06-execution-v2";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
type Executor = Pick<Database, "execute">;
type Row = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const PHASES = ["staging", "admission", "post_claim", "pre_dispatch", "read_after_write"] as const;

export class P06ExecutionRepositoryError extends Error {
  constructor(readonly code: "invalid_input" | "not_found" | "conflict" | "corrupt_store") {
    super(`P06 execution persistence rejected: ${code}`);
  }
}
function fail(code: P06ExecutionRepositoryError["code"]): never { throw new P06ExecutionRepositoryError(code); }
function rows(value: unknown): readonly Row[] {
  if (!value || typeof value !== "object" || !("rows" in value)) fail("corrupt_store");
  const resultRows = (value as { rows?: unknown }).rows;
  if (!Array.isArray(resultRows)) fail("corrupt_store");
  return resultRows as readonly Row[];
}
function one(values: readonly Row[]): Row | null { if (values.length > 1) fail("corrupt_store"); return values[0] ?? null; }
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, stable(child)]));
  if (typeof value === "number" && (!Number.isSafeInteger(value) || !Number.isFinite(value))) fail("invalid_input");
  return value;
}
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function instant(value: string): string {
  if (!ISO.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail("invalid_input");
  return value;
}
function hash(value: string): string { if (!HASH.test(value)) fail("invalid_input"); return value; }

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
  request: P06ExecutionV2Request;
}>;

/**
 * Server-private persistence boundary. It never owns a Meta client and cannot
 * dispatch a write. Creation derives the writable identity from the persisted
 * ActionUnit and binds one approved decision/grant plus all five gate seeds.
 */
export class DrizzleP06ExecutionRepository {
  constructor(private readonly database: Pick<Database, "execute" | "transaction">) {}

  async createHumanApproved(input: Readonly<{
    workspaceId: string;
    guideRunActionBindingId: string;
    decisionEventId: string;
    approvalGrantId: string;
    leaseTokenHash: string;
    fenceHash: string;
    evaluatedAt: string;
    gates: readonly P06ExecutionGateSeed[];
  }>): Promise<P06ExecutionIdentity> {
    if (!UUID.test(input.workspaceId) || !UUID.test(input.guideRunActionBindingId) || !UUID.test(input.decisionEventId)
      || !UUID.test(input.approvalGrantId) || !HASH.test(input.leaseTokenHash) || !HASH.test(input.fenceHash)
      || input.gates.length !== 2) fail("invalid_input");
    const evaluatedAt = instant(input.evaluatedAt);
    const normalizedGates = PHASES.slice(0, 2).map((phase, index) => {
      const gate = input.gates[index];
      if (!gate || gate.phase !== phase || typeof gate.enabled !== "boolean" || !HASH.test(gate.allowlistHash)
        || Date.parse(instant(gate.capturedAt)) > Date.parse(evaluatedAt) || Date.parse(instant(gate.expiresAt)) <= Date.parse(evaluatedAt)) fail("invalid_input");
      if (!gate) fail("invalid_input");
      if (index > 0 && Date.parse(gate.capturedAt) <= Date.parse(input.gates[index - 1]!.capturedAt)) fail("invalid_input");
      const core = { version: "p06-execution-gate/1.0.0", phase, sequence: index + 1, enabled: gate.enabled,
        allowlistHash: gate.allowlistHash, capturedAt: gate.capturedAt, expiresAt: gate.expiresAt };
      const snapshotHash = digest(core);
      return { ...core, snapshotHash };
    });
    const gateSetHash = digest(normalizedGates.map((gate) => ({ phase: gate.phase, allowlistHash: gate.allowlistHash })));
    return this.database.transaction(async (tx) => {
      const source = one(rows(await tx.execute(sql`select b.id::text binding_id,b.proposal_bundle_id::text bundle_id,b.action_unit_id::text unit_id,b.action_unit_hash,b.proposal_hash,b.effective_guide_set_hash,b.resolution_hash,u.context_hash,u.account_ref,u.entity_ref,u.action_type,u.action_plan_payload,bundle.workspace_ref,p.policy_hash,g.grant_hash from guide_run_action_bindings b join action_proposal_units u on u.workspace_id=b.workspace_id and u.id=b.action_unit_id join action_proposal_bundles bundle on bundle.workspace_id=b.workspace_id and bundle.id=b.proposal_bundle_id join action_approval_policy_snapshots p on p.workspace_id=bundle.workspace_id and p.id=bundle.policy_snapshot_id join action_approval_decision_events d on d.workspace_id=b.workspace_id and d.id=${input.decisionEventId}::uuid and d.bundle_id=b.proposal_bundle_id and d.unit_id=b.action_unit_id and d.command_kind='approve' join action_approval_evidence_grants g on g.workspace_id=b.workspace_id and g.id=${input.approvalGrantId}::uuid and g.decision_event_id=d.id and g.bundle_id=b.proposal_bundle_id and g.unit_id=b.action_unit_id and g.expires_at>${evaluatedAt}::timestamptz where b.workspace_id=${input.workspaceId}::uuid and b.id=${input.guideRunActionBindingId}::uuid for share of b,u,bundle,p,d,g limit 2`)));
      if (!source) fail("not_found");
      const actionPlan = source.action_plan_payload as { action?: { kind?: unknown; fromStatus?: unknown; toStatus?: unknown } };
      const action = source.action_type;
      if ((action !== "status_pause" && action !== "status_activate") || actionPlan?.action?.kind !== "status_change") fail("invalid_input");
      if (!actionPlan.action) fail("corrupt_store");
      const expectedStatus = action === "status_pause" ? "ACTIVE" : "PAUSED";
      const desiredStatus = action === "status_pause" ? "PAUSED" : "ACTIVE";
      if (actionPlan.action.fromStatus !== expectedStatus || actionPlan.action.toStatus !== desiredStatus) fail("corrupt_store");
      const requestCore = {
        version: "p06-execution-request/1.0.0",
        workspaceRef: source.workspace_ref,
        accountRef: source.account_ref,
        entityRef: source.entity_ref,
        action: action as P06ExecutionV2Action,
        expectedBefore: { status: expectedStatus, budgetMinor: null },
        desired: { status: desiredStatus, budgetMinor: null },
        leaseTokenHash: input.leaseTokenHash,
        fenceHash: input.fenceHash,
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
      const payload = { ...requestCore, executionRef, idempotencyKey, requestHash };
      const inserted = one(rows(await tx.execute(sql`insert into p06_execution_runs(workspace_id,guide_run_action_binding_id,proposal_bundle_id,action_unit_id,decision_event_id,approval_grant_id,execution_ref,idempotency_key,request_hash,action_unit_hash,proposal_hash,context_hash,effective_guide_set_hash,resolution_hash,policy_hash,gate_set_hash,request_payload,created_at) values(${input.workspaceId}::uuid,${input.guideRunActionBindingId}::uuid,${source.bundle_id}::uuid,${source.unit_id}::uuid,${input.decisionEventId}::uuid,${input.approvalGrantId}::uuid,${executionRef},${idempotencyKey},${requestHash},${source.action_unit_hash},${source.proposal_hash},${source.context_hash},${source.effective_guide_set_hash},${source.resolution_hash},${source.policy_hash},${gateSetHash},${JSON.stringify(payload)}::jsonb,${evaluatedAt}::timestamptz) on conflict(workspace_id,idempotency_key) do nothing returning id::text`)));
      let runId: string | undefined = typeof inserted?.id === "string" ? inserted.id : undefined;
      if (typeof runId !== "string") {
        const replay = one(rows(await tx.execute(sql`select id::text,request_hash from p06_execution_runs where workspace_id=${input.workspaceId}::uuid and idempotency_key=${idempotencyKey} for update limit 2`)));
        if (!replay || replay.request_hash !== requestHash || typeof replay.id !== "string") fail("conflict");
        if (typeof replay.id !== "string") fail("conflict");
        runId = replay.id;
      } else {
        await tx.execute(sql`insert into p06_execution_heads(workspace_id,execution_run_id,state,sequence,trace_sequence,updated_at) values(${input.workspaceId}::uuid,${runId}::uuid,'pending',0,0,${evaluatedAt}::timestamptz)`);
        for (const gate of normalizedGates) {
          const receiptHash = digest({ executionRef, phase: gate.phase, sequence: gate.sequence, snapshotHash: gate.snapshotHash });
          const gatePayload = { ...gate, receiptHash };
          await tx.execute(sql`insert into p06_execution_gate_snapshots(workspace_id,execution_run_id,phase,sequence,snapshot_hash,receipt_hash,allowlist_hash,enabled,captured_at,expires_at,payload) values(${input.workspaceId}::uuid,${runId}::uuid,${gate.phase},${gate.sequence},${gate.snapshotHash},${receiptHash},${gate.allowlistHash},${gate.enabled},${gate.capturedAt}::timestamptz,${gate.expiresAt}::timestamptz,${JSON.stringify(gatePayload)}::jsonb)`);
        }
      }
      if (typeof runId !== "string") fail("corrupt_store");
      const request: P06ExecutionV2Request = Object.freeze({ executionRef, workspaceRef: String(source.workspace_ref),
        accountRef: String(source.account_ref), entityRef: String(source.entity_ref), action: action as P06ExecutionV2Action,
        expectedBefore: Object.freeze({ status: expectedStatus, budgetMinor: null }), desired: Object.freeze({ status: desiredStatus, budgetMinor: null }),
        leaseTokenHash: hash(input.leaseTokenHash), fenceHash: hash(input.fenceHash), evaluatedAt });
      return Object.freeze({ workspaceId: input.workspaceId, executionRunId: runId, executionRef, requestHash, idempotencyKey, request });
    });
  }

  async appendGate(input: Readonly<{ executionRef: string; gate: P06ExecutionGateSeed }>): Promise<string> {
    if (!/^p06_execution_[a-f0-9]{24}$/.test(input.executionRef)) fail("invalid_input");
    const sequence = PHASES.indexOf(input.gate.phase) + 1;
    if (sequence < 3 || typeof input.gate.enabled !== "boolean" || !HASH.test(input.gate.allowlistHash)
      || Date.parse(instant(input.gate.expiresAt)) <= Date.parse(instant(input.gate.capturedAt))) fail("invalid_input");
    const core = { version: "p06-execution-gate/1.0.0", phase: input.gate.phase, sequence,
      enabled: input.gate.enabled, allowlistHash: input.gate.allowlistHash, capturedAt: input.gate.capturedAt, expiresAt: input.gate.expiresAt };
    const snapshotHash = digest(core);
    return this.database.transaction(async (tx) => {
      const run = one(rows(await tx.execute(sql`select id::text,workspace_id::text from p06_execution_runs where execution_ref=${input.executionRef} for update limit 2`)));
      if (!run || typeof run.id !== "string" || typeof run.workspace_id !== "string") fail("not_found");
      const receiptHash = digest({ executionRef: input.executionRef, phase: input.gate.phase, sequence, snapshotHash });
      const payload = { ...core, snapshotHash, receiptHash };
      const inserted = rows(await tx.execute(sql`insert into p06_execution_gate_snapshots(workspace_id,execution_run_id,phase,sequence,snapshot_hash,receipt_hash,allowlist_hash,enabled,captured_at,expires_at,payload) values(${run.workspace_id}::uuid,${run.id}::uuid,${input.gate.phase},${sequence},${snapshotHash},${receiptHash},${input.gate.allowlistHash},${input.gate.enabled},${input.gate.capturedAt}::timestamptz,${input.gate.expiresAt}::timestamptz,${JSON.stringify(payload)}::jsonb) on conflict(workspace_id,execution_run_id,phase) do nothing returning id`));
      if (inserted.length !== 1) {
        const replay = one(rows(await tx.execute(sql`select receipt_hash from p06_execution_gate_snapshots where workspace_id=${run.workspace_id}::uuid and execution_run_id=${run.id}::uuid and phase=${input.gate.phase} limit 2`)));
        if (!replay || replay.receipt_hash !== receiptHash) fail("conflict");
      }
      return receiptHash;
    });
  }

  async claimLease(input: Readonly<{ executionRef: string; leaseTokenHash: string; fenceHash: string; now: string; leaseUntil: string }>): Promise<
    P06ExecutionV2Receipt<Readonly<{ executionRef: string; leaseTokenHash: string; fenceHash: string; owned: true }>>
  > {
    if (!/^p06_execution_[a-f0-9]{24}$/.test(input.executionRef) || !HASH.test(input.leaseTokenHash) || !HASH.test(input.fenceHash)) fail("invalid_input");
    const now = instant(input.now); const leaseUntil = instant(input.leaseUntil);
    if (Date.parse(leaseUntil) <= Date.parse(now)) fail("invalid_input");
    return this.database.transaction(async (tx) => {
      const current = one(rows(await tx.execute(sql`select r.id::text run_id,r.workspace_id::text,h.state,h.sequence,h.trace_sequence,h.head_event_hash,h.lease_token_hash,h.fence_hash,h.lease_epoch,h.lease_expires_at::text from p06_execution_runs r join p06_execution_heads h on h.workspace_id=r.workspace_id and h.execution_run_id=r.id join workspaces w on w.id=r.workspace_id and w.lifecycle_state='active' where r.execution_ref=${input.executionRef} for update of h,w limit 2`)));
      if (!current || typeof current.run_id !== "string" || typeof current.workspace_id !== "string") fail("not_found");
      const receiptCore = Object.freeze({ executionRef: input.executionRef, leaseTokenHash: input.leaseTokenHash,
        fenceHash: input.fenceHash, owned: true as const });
      const receiptHash = digest(receiptCore);
      if ((current.state === "claimed" || current.state === "running") && current.lease_token_hash === input.leaseTokenHash
        && current.fence_hash === input.fenceHash && Date.parse(String(current.lease_expires_at)) > Date.parse(now)) {
        return Object.freeze({ core: receiptCore, receiptHash });
      }
      const pending = current.state === "pending";
      const expired = (current.state === "claimed" || current.state === "running")
        && Number.isFinite(Date.parse(String(current.lease_expires_at))) && Date.parse(String(current.lease_expires_at)) <= Date.parse(now);
      if (!pending && !expired) fail("conflict");
      const sequence = Number(current.sequence) + 1;
      const previousHash = typeof current.head_event_hash === "string" ? current.head_event_hash : "GENESIS";
      const eventKind = pending ? "lease_claimed" : "lease_reclaimed";
      const eventCore = { version: "p06-execution-event/1.0.0", executionRef: input.executionRef, sequence,
        traceSequence: null, eventKind, step: null, outcome: "ok", previousHash, receiptCore, receiptHash, occurredAt: now };
      const eventHash = digest(eventCore); const eventRef = `p06_exec_event_${eventHash.slice(0, 24)}`;
      const eventPayload = { ...eventCore, eventRef, eventHash };
      const inserted = rows(await tx.execute(sql`insert into p06_execution_events(workspace_id,execution_run_id,event_ref,event_hash,sequence,trace_sequence,event_kind,step,outcome,previous_hash,receipt_hash,payload,occurred_at) values(${current.workspace_id}::uuid,${current.run_id}::uuid,${eventRef},${eventHash},${sequence},null,${eventKind},null,'ok',${previousHash},${receiptHash},${JSON.stringify(eventPayload)}::jsonb,${now}::timestamptz) on conflict(workspace_id,event_hash) do nothing returning id`));
      if (inserted.length !== 1) fail("conflict");
      const advanced = rows(await tx.execute(sql`update p06_execution_heads set state='claimed',sequence=${sequence},head_event_hash=${eventHash},lease_token_hash=${input.leaseTokenHash},fence_hash=${input.fenceHash},lease_epoch=${Number(current.lease_epoch)+1},lease_expires_at=${leaseUntil}::timestamptz,updated_at=${now}::timestamptz where workspace_id=${current.workspace_id}::uuid and execution_run_id=${current.run_id}::uuid and sequence=${Number(current.sequence)} returning id`));
      if (advanced.length !== 1) fail("conflict");
      return Object.freeze({ core: receiptCore, receiptHash });
    });
  }

  async appendTrace(input: Readonly<{ executionRef: string; leaseTokenHash: string; fenceHash: string;
    step: (typeof P06_EXECUTION_V2_STEPS)[number]; outcome: P06ExecutionV2TraceEntry["outcome"];
    receiptCore: Readonly<Record<string, unknown>>; occurredAt: string }>): Promise<Readonly<{ eventHash: string; receiptHash: string }>> {
    if (!/^p06_execution_[a-f0-9]{24}$/.test(input.executionRef) || !HASH.test(input.leaseTokenHash)
      || !HASH.test(input.fenceHash) || !input.receiptCore || Array.isArray(input.receiptCore)
      || typeof input.receiptCore !== "object") fail("invalid_input");
    const occurredAt = instant(input.occurredAt); const expectedTraceSequence = P06_EXECUTION_V2_STEPS.indexOf(input.step) + 1;
    if (expectedTraceSequence < 1 || !["ok", "skipped", "held", "ambiguous", "already_applied"].includes(input.outcome)
      || Buffer.byteLength(JSON.stringify(input.receiptCore), "utf8") > 8_192) fail("invalid_input");
    const receiptHash = digest(input.receiptCore);
    return this.database.transaction(async (tx) => {
      const current = one(rows(await tx.execute(sql`select r.id::text run_id,r.workspace_id::text,h.state,h.sequence,h.trace_sequence,h.head_event_hash,h.lease_token_hash,h.fence_hash,h.lease_epoch,h.lease_expires_at::text from p06_execution_runs r join p06_execution_heads h on h.workspace_id=r.workspace_id and h.execution_run_id=r.id join workspaces w on w.id=r.workspace_id and w.lifecycle_state='active' where r.execution_ref=${input.executionRef} for update of h,w limit 2`)));
      if (!current || typeof current.run_id !== "string" || typeof current.workspace_id !== "string") fail("not_found");
      if ((current.state !== "claimed" && current.state !== "running") || current.lease_token_hash !== input.leaseTokenHash
        || current.fence_hash !== input.fenceHash || Date.parse(String(current.lease_expires_at)) <= Date.parse(occurredAt)
        || Number(current.trace_sequence) + 1 !== expectedTraceSequence) fail("conflict");
      const sequence = Number(current.sequence) + 1; const previousHash = String(current.head_event_hash);
      const eventCore = { version: "p06-execution-event/1.0.0", executionRef: input.executionRef, sequence,
        traceSequence: expectedTraceSequence, eventKind: "trace", step: input.step, outcome: input.outcome,
        previousHash, receiptCore: input.receiptCore, receiptHash, occurredAt };
      const eventHash = digest(eventCore); const eventRef = `p06_exec_event_${eventHash.slice(0, 24)}`;
      const payload = { ...eventCore, eventRef, eventHash };
      const inserted = rows(await tx.execute(sql`insert into p06_execution_events(workspace_id,execution_run_id,event_ref,event_hash,sequence,trace_sequence,event_kind,step,outcome,previous_hash,receipt_hash,payload,occurred_at) values(${current.workspace_id}::uuid,${current.run_id}::uuid,${eventRef},${eventHash},${sequence},${expectedTraceSequence},'trace',${input.step},${input.outcome},${previousHash},${receiptHash},${JSON.stringify(payload)}::jsonb,${occurredAt}::timestamptz) on conflict(workspace_id,event_hash) do nothing returning id`));
      if (inserted.length !== 1) fail("conflict");
      let state = "running"; let terminalHash: string | null = null;
      if (expectedTraceSequence === 10) {
        const terminal = one(rows(await tx.execute(sql`select receipt_hash,payload->'receiptCore'->>'outcome' outcome from p06_execution_events where workspace_id=${current.workspace_id}::uuid and execution_run_id=${current.run_id}::uuid and trace_sequence=9 limit 2`)));
        const terminalOutcome = terminal?.outcome as P06ExecutionV2Outcome | undefined;
        if (!terminal || typeof terminal.receipt_hash !== "string") fail("corrupt_store");
        state = terminalOutcome === "verification_failed" ? "verification_failed"
          : terminalOutcome === "expected_before_mismatch" ? "held"
            : ["already_applied_no_write", "written_verified", "ambiguous_resolved"].includes(String(terminalOutcome)) ? "succeeded" : fail("corrupt_store");
        terminalHash = terminal.receipt_hash;
      }
      const advanced = expectedTraceSequence === 10
        ? rows(await tx.execute(sql`update p06_execution_heads set state=${state},sequence=${sequence},trace_sequence=${expectedTraceSequence},head_event_hash=${eventHash},lease_token_hash=null,fence_hash=null,lease_expires_at=null,terminal_hash=${terminalHash},updated_at=${occurredAt}::timestamptz where workspace_id=${current.workspace_id}::uuid and execution_run_id=${current.run_id}::uuid and sequence=${Number(current.sequence)} returning id`))
        : rows(await tx.execute(sql`update p06_execution_heads set state='running',sequence=${sequence},trace_sequence=${expectedTraceSequence},head_event_hash=${eventHash},updated_at=${occurredAt}::timestamptz where workspace_id=${current.workspace_id}::uuid and execution_run_id=${current.run_id}::uuid and sequence=${Number(current.sequence)} returning id`));
      if (advanced.length !== 1) fail("conflict");
      return Object.freeze({ eventHash, receiptHash });
    });
  }

  async appendObservation(input: Readonly<{ executionRef: string; eventHash: string;
    kind: "read_before" | "write_receipt" | "read_after" | "ambiguous_retry_read";
    metadataHash: string; rawHash: string; observedValue: Readonly<Record<string, unknown>>; observedAt: string }>): Promise<
      Readonly<{ observationId: string; observationRef: string; observationHash: string }>
    > {
    if (!/^p06_execution_[a-f0-9]{24}$/.test(input.executionRef) || !HASH.test(input.eventHash)
      || !HASH.test(input.metadataHash) || !HASH.test(input.rawHash) || !input.observedValue
      || Array.isArray(input.observedValue) || typeof input.observedValue !== "object"
      || Buffer.byteLength(JSON.stringify(input.observedValue), "utf8") > 4_096) fail("invalid_input");
    const observedAt = instant(input.observedAt);
    return this.database.transaction(async (tx) => {
      const target = one(rows(await tx.execute(sql`select r.id::text run_id,r.workspace_id::text,e.id::text event_id from p06_execution_runs r join p06_execution_events e on e.workspace_id=r.workspace_id and e.execution_run_id=r.id and e.event_hash=${input.eventHash} join workspaces w on w.id=r.workspace_id and w.lifecycle_state='active' where r.execution_ref=${input.executionRef} for share of r,e,w limit 2`)));
      if (!target || typeof target.run_id !== "string" || typeof target.workspace_id !== "string" || typeof target.event_id !== "string") fail("not_found");
      const observationCore = { version: "p06-execution-observation/1.0.0", executionRef: input.executionRef,
        kind: input.kind, metadataHash: input.metadataHash, rawHash: input.rawHash, observedValue: input.observedValue, observedAt };
      const observationHash = digest(observationCore); const observationRef = `p06_observation_${observationHash.slice(0, 24)}`;
      const inserted = one(rows(await tx.execute(sql`insert into p06_execution_observations(workspace_id,execution_run_id,event_id,kind,observation_ref,observation_hash,metadata_hash,raw_hash,observed_value,observed_at) values(${target.workspace_id}::uuid,${target.run_id}::uuid,${target.event_id}::uuid,${input.kind},${observationRef},${observationHash},${input.metadataHash},${input.rawHash},${JSON.stringify(input.observedValue)}::jsonb,${observedAt}::timestamptz) on conflict(workspace_id,event_id,kind) do nothing returning id::text`)));
      if (inserted && typeof inserted.id === "string") return Object.freeze({ observationId: inserted.id, observationRef, observationHash });
      const replay = one(rows(await tx.execute(sql`select id::text,observation_hash from p06_execution_observations where workspace_id=${target.workspace_id}::uuid and event_id=${target.event_id}::uuid and kind=${input.kind} limit 2`)));
      if (!replay || replay.observation_hash !== observationHash || typeof replay.id !== "string") fail("conflict");
      return Object.freeze({ observationId: replay.id, observationRef, observationHash });
    });
  }

  async appendRollbackProposal(input: Readonly<{ proposal: P06ExecutionV2RollbackProposal;
    beforeObservationId: string; afterObservationId: string; writeObservationId: string }>): Promise<
      Readonly<{ rollbackProposalId: string; proposalRef: string; proposalHash: string }>
    > {
    if (!UUID.test(input.beforeObservationId) || !UUID.test(input.afterObservationId) || !UUID.test(input.writeObservationId)
      || !HASH.test(input.proposal.proposalHash) || input.proposal.requiresNewHumanApproval !== true) fail("invalid_input");
    const { proposalHash, ...core } = input.proposal;
    if (digest(core) !== proposalHash) fail("invalid_input");
    const proposalRef = `p06_rollback_${proposalHash.slice(0, 24)}`;
    const payload = { ...input.proposal, proposalRef };
    return this.database.transaction(async (tx) => {
      const target = one(rows(await tx.execute(sql`select r.id::text run_id,r.workspace_id::text,e.id::text terminal_event_id from p06_execution_runs r join p06_execution_heads h on h.workspace_id=r.workspace_id and h.execution_run_id=r.id and h.state='verification_failed' join p06_execution_events e on e.workspace_id=r.workspace_id and e.execution_run_id=r.id and e.trace_sequence=9 and e.receipt_hash=${input.proposal.terminalHash} where r.execution_ref=${input.proposal.executionRef} for share of r,h,e limit 2`)));
      if (!target || typeof target.run_id !== "string" || typeof target.workspace_id !== "string" || typeof target.terminal_event_id !== "string") fail("not_found");
      const inserted = one(rows(await tx.execute(sql`insert into p06_rollback_proposals(workspace_id,execution_run_id,terminal_event_id,before_observation_id,after_observation_id,write_observation_id,proposal_ref,proposal_hash,payload,requires_new_human_approval) values(${target.workspace_id}::uuid,${target.run_id}::uuid,${target.terminal_event_id}::uuid,${input.beforeObservationId}::uuid,${input.afterObservationId}::uuid,${input.writeObservationId}::uuid,${proposalRef},${proposalHash},${JSON.stringify(payload)}::jsonb,true) on conflict(workspace_id,execution_run_id) do nothing returning id::text`)));
      if (inserted && typeof inserted.id === "string") return Object.freeze({ rollbackProposalId: inserted.id, proposalRef, proposalHash });
      const replay = one(rows(await tx.execute(sql`select id::text,proposal_hash from p06_rollback_proposals where workspace_id=${target.workspace_id}::uuid and execution_run_id=${target.run_id}::uuid limit 2`)));
      if (!replay || replay.proposal_hash !== proposalHash || typeof replay.id !== "string") fail("conflict");
      return Object.freeze({ rollbackProposalId: replay.id, proposalRef, proposalHash });
    });
  }
}
