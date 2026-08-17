import { createHash } from "node:crypto";
import type { GuideAction } from "@/domain/guides/guide-revision";

export const P06_EXECUTION_V2_VERSION = "p06-execution-v2/1.0.0" as const;
export const P06_EXECUTION_V2_STEPS = [
  "lease",
  "idempotency",
  "current_meta_read",
  "expected_before",
  "typed_mutation",
  "raw",
  "already_applied_no_second_write",
  "ambiguous_read_before_retry",
  "immutable_terminal",
  "release",
] as const;

export type P06ExecutionV2Action = Extract<
  GuideAction,
  "status_pause" | "status_activate" | "budget_decrease" | "budget_increase"
>;
export type P06ExecutionV2Value = Readonly<{ status: "ACTIVE" | "PAUSED"; budgetMinor: number | null }>;
export type P06ExecutionV2Request = Readonly<{
  executionRef: string;
  workspaceRef: string;
  accountRef: string;
  entityRef: string;
  action: P06ExecutionV2Action;
  expectedBefore: P06ExecutionV2Value;
  desired: P06ExecutionV2Value;
  leaseTokenHash: string;
  fenceHash: string;
  evaluatedAt: string;
}>;
export type P06ExecutionV2GatePhase = "staging" | "admission" | "post_claim" | "pre_dispatch" | "read_after_write";
export type P06ExecutionV2Gate = Readonly<{
  enabled: boolean;
  killSwitch: boolean;
  workspaceAllowlist: readonly string[];
  accountAllowlist: readonly string[];
  actionAllowlist: readonly P06ExecutionV2Action[];
  snapshotHash: string;
  capturedAt: string;
}>;
export type P06ExecutionV2Receipt<T> = Readonly<{ core: Readonly<T>; receiptHash: string }>;
export type P06ExecutionV2ReadCore = Readonly<{
  workspaceRef: string;
  accountRef: string;
  entityRef: string;
  value: P06ExecutionV2Value;
  observedAt: string;
  rawHash: string;
}>;
export type P06ExecutionV2ReadEvidence = P06ExecutionV2Receipt<P06ExecutionV2ReadCore>;
export type P06ExecutionV2WriteCore = Readonly<{
  executionRef: string;
  idempotencyKey: string;
  entityRef: string;
  action: P06ExecutionV2Action;
  kind: "written" | "ambiguous_transport";
  rawHash: string;
}>;
export type P06ExecutionV2Writer = Readonly<{
  read(input: Readonly<{ workspaceRef: string; accountRef: string; entityRef: string }>): Promise<P06ExecutionV2ReadEvidence>;
  write(input: Readonly<{ request: P06ExecutionV2Request; idempotencyKey: string }>): Promise<P06ExecutionV2Receipt<P06ExecutionV2WriteCore>>;
}>;
export type P06ExecutionV2Outcome =
  | "disabled"
  | "already_applied_no_write"
  | "expected_before_mismatch"
  | "written_verified"
  | "ambiguous_resolved"
  | "verification_failed";
export type P06ExecutionV2Control = Readonly<{
  gate(input: Readonly<{ phase: P06ExecutionV2GatePhase; request: P06ExecutionV2Request }>): Promise<P06ExecutionV2Gate>;
  claim(input: Readonly<{ executionRef: string; leaseTokenHash: string; fenceHash: string }>): Promise<
    P06ExecutionV2Receipt<Readonly<{ executionRef: string; leaseTokenHash: string; fenceHash: string; owned: true }>>
  >;
  idempotency(input: Readonly<{ executionRef: string; idempotencyKey: string; fenceHash: string }>): Promise<
    | P06ExecutionV2Receipt<Readonly<{ kind: "fresh"; executionRef: string; idempotencyKey: string; fenceHash: string }>>
    | P06ExecutionV2Receipt<Readonly<{ kind: "completed"; executionRef: string; idempotencyKey: string; fenceHash: string;
      terminalHash: string; outcome: P06ExecutionV2Outcome }>>
  >;
  terminal(input: Readonly<{
    executionRef: string;
    outcome: Exclude<P06ExecutionV2Outcome, "disabled">;
    writeReceiptHash: string | null;
    fenceHash: string;
  }>): Promise<P06ExecutionV2Receipt<Readonly<{ executionRef: string; outcome: Exclude<P06ExecutionV2Outcome, "disabled">;
    writeReceiptHash: string | null; fenceHash: string }>>>;
  release(input: Readonly<{ executionRef: string; leaseTokenHash: string; fenceHash: string }>): Promise<
    P06ExecutionV2Receipt<Readonly<{ executionRef: string; leaseTokenHash: string; fenceHash: string; released: true }>>
  >;
}>;

export type P06ExecutionV2Step = (typeof P06_EXECUTION_V2_STEPS)[number];
export type P06ExecutionV2TraceEntry = Readonly<{
  step: P06ExecutionV2Step;
  outcome: "ok" | "skipped" | "held" | "ambiguous" | "already_applied";
  receiptHash: string | null;
}>;
export type P06ExecutionV2RollbackProposal = Readonly<{
  version: "p06-rollback-proposal/1.0.0";
  proposalHash: string;
  executionRef: string;
  terminalHash: string;
  writeReceiptHash: string;
  beforeReadReceiptHash: string;
  afterReadReceiptHash: string;
  previousObserved: P06ExecutionV2Value;
  postWriteObserved: P06ExecutionV2Value;
  restoreTo: P06ExecutionV2Value;
  failedDesired: P06ExecutionV2Value;
  requiresNewHumanApproval: true;
}>;
export type P06ExecutionV2Result = Readonly<{
  version: typeof P06_EXECUTION_V2_VERSION;
  executionRef: string;
  outcome: P06ExecutionV2Outcome;
  writes: 0 | 1;
  gateHashes: readonly string[];
  terminalHash: string | null;
  releaseHash: string | null;
  rollbackProposal: P06ExecutionV2RollbackProposal | null;
  trace: readonly P06ExecutionV2TraceEntry[];
}>;

const HASH = /^[a-f0-9]{64}$/;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MAX_ALLOWLIST = 1_000;
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const sameValue = (left: P06ExecutionV2Value, right: P06ExecutionV2Value) =>
  left.status === right.status && left.budgetMinor === right.budgetMinor;
const validValue = (value: P06ExecutionV2Value) =>
  (value.status === "ACTIVE" || value.status === "PAUSED") &&
  (value.budgetMinor === null || (Number.isSafeInteger(value.budgetMinor) && value.budgetMinor >= 0));

function coherent(request: P06ExecutionV2Request): boolean {
  if (!validValue(request.expectedBefore) || !validValue(request.desired)) return false;
  if (request.action === "status_pause") {
    return request.expectedBefore.status === "ACTIVE" && request.desired.status === "PAUSED" &&
      request.expectedBefore.budgetMinor === request.desired.budgetMinor;
  }
  if (request.action === "status_activate") {
    return request.expectedBefore.status === "PAUSED" && request.desired.status === "ACTIVE" &&
      request.expectedBefore.budgetMinor === request.desired.budgetMinor;
  }
  return request.expectedBefore.status === request.desired.status && request.expectedBefore.budgetMinor !== null &&
    request.desired.budgetMinor !== null && (request.action === "budget_decrease"
      ? request.desired.budgetMinor < request.expectedBefore.budgetMinor
      : request.desired.budgetMinor > request.expectedBefore.budgetMinor);
}

const validReceipt = (receipt: Readonly<{ core: unknown; receiptHash: string }>) =>
  HASH.test(receipt.receiptHash) && receipt.receiptHash === digest(receipt.core);
const validEvidence = (evidence: P06ExecutionV2ReadEvidence, request: P06ExecutionV2Request) =>
  validReceipt(evidence) && validValue(evidence.core.value) && HASH.test(evidence.core.rawHash) &&
  evidence.core.workspaceRef === request.workspaceRef && evidence.core.accountRef === request.accountRef &&
  evidence.core.entityRef === request.entityRef && ISO.test(evidence.core.observedAt) &&
  Number.isFinite(Date.parse(evidence.core.observedAt));
const skippedTrace = (): P06ExecutionV2TraceEntry[] =>
  P06_EXECUTION_V2_STEPS.map((step) => ({ step, outcome: "skipped", receiptHash: null }));
function setTrace(trace: P06ExecutionV2TraceEntry[], step: P06ExecutionV2Step,
  outcome: P06ExecutionV2TraceEntry["outcome"], receiptHash: string | null): void {
  trace[P06_EXECUTION_V2_STEPS.indexOf(step)] = { step, outcome, receiptHash };
}

function validateRequest(request: P06ExecutionV2Request): void {
  if (!REF.test(request.executionRef) || !REF.test(request.workspaceRef) || !REF.test(request.accountRef) || !REF.test(request.entityRef) ||
    !HASH.test(request.leaseTokenHash) || !HASH.test(request.fenceHash) || !ISO.test(request.evaluatedAt) ||
    !Number.isFinite(Date.parse(request.evaluatedAt)) || !coherent(request)) {
    throw new Error("p06 execution v2 invalid input");
  }
}

function gateAllows(gate: P06ExecutionV2Gate, request: P06ExecutionV2Request): boolean {
  if (!HASH.test(gate.snapshotHash) || !ISO.test(gate.capturedAt) || !Number.isFinite(Date.parse(gate.capturedAt)) ||
    gate.workspaceAllowlist.length > MAX_ALLOWLIST || gate.accountAllowlist.length > MAX_ALLOWLIST ||
    gate.actionAllowlist.length > MAX_ALLOWLIST) return false;
  return gate.enabled === true && gate.killSwitch === false && gate.workspaceAllowlist.includes(request.workspaceRef) &&
    gate.accountAllowlist.includes(request.accountRef) && gate.actionAllowlist.includes(request.action);
}

function freezeResult(result: P06ExecutionV2Result): P06ExecutionV2Result {
  result.trace.forEach(Object.freeze);
  Object.freeze(result.trace);
  Object.freeze(result.gateHashes);
  if (result.rollbackProposal) {
    Object.freeze(result.rollbackProposal.previousObserved);
    Object.freeze(result.rollbackProposal.postWriteObserved);
    Object.freeze(result.rollbackProposal.restoreTo);
    Object.freeze(result.rollbackProposal.failedDesired);
    Object.freeze(result.rollbackProposal);
  }
  return Object.freeze(result);
}

export async function runP06ExecutionV2({ request, writer, control }: Readonly<{
  request: P06ExecutionV2Request; writer: P06ExecutionV2Writer; control: P06ExecutionV2Control;
}>): Promise<P06ExecutionV2Result> {
  validateRequest(request);
  const trace = skippedTrace();
  const gateHashes: string[] = [];
  let writes: 0 | 1 = 0;
  let writeReceiptHash: string | null = null;
  let before: P06ExecutionV2ReadEvidence | null = null;
  let after: P06ExecutionV2ReadEvidence | null = null;
  const checkGate = async (phase: P06ExecutionV2GatePhase) => {
    const gate = await control.gate({ phase, request });
    if (HASH.test(gate.snapshotHash)) gateHashes.push(gate.snapshotHash);
    return gateAllows(gate, request);
  };
  const preclaimDisabled = () => freezeResult({ version: P06_EXECUTION_V2_VERSION, executionRef: request.executionRef,
    outcome: "disabled" as const, writes: 0 as const, gateHashes, terminalHash: null, releaseHash: null,
    rollbackProposal: null, trace });
  if (!(await checkGate("staging")) || !(await checkGate("admission"))) return preclaimDisabled();

  const claim = await control.claim({ executionRef: request.executionRef, leaseTokenHash: request.leaseTokenHash,
    fenceHash: request.fenceHash });
  if (!validReceipt(claim) || claim.core.owned !== true || claim.core.executionRef !== request.executionRef ||
    claim.core.leaseTokenHash !== request.leaseTokenHash || claim.core.fenceHash !== request.fenceHash) {
    throw new Error("p06 execution v2 invalid claim");
  }
  setTrace(trace, "lease", "ok", claim.receiptHash);
  const idempotencyKey = digest({ version: P06_EXECUTION_V2_VERSION, executionRef: request.executionRef,
    workspaceRef: request.workspaceRef, accountRef: request.accountRef, entityRef: request.entityRef,
    action: request.action, expectedBefore: request.expectedBefore, desired: request.desired });
  const replay = await control.idempotency({ executionRef: request.executionRef, idempotencyKey, fenceHash: request.fenceHash });
  if (!validReceipt(replay) || replay.core.executionRef !== request.executionRef ||
    replay.core.idempotencyKey !== idempotencyKey || replay.core.fenceHash !== request.fenceHash) {
    throw new Error("p06 execution v2 invalid idempotency receipt");
  }
  setTrace(trace, "idempotency", "ok", replay.receiptHash);
  if (replay.core.kind === "completed") {
    if (!HASH.test(replay.core.terminalHash) || replay.core.outcome === "disabled") throw new Error("p06 execution v2 invalid replay");
    setTrace(trace, "immutable_terminal", "already_applied", replay.core.terminalHash);
    const release = await control.release({ executionRef: request.executionRef, leaseTokenHash: request.leaseTokenHash,
      fenceHash: request.fenceHash });
    if (!validReceipt(release) || release.core.executionRef !== request.executionRef ||
      release.core.leaseTokenHash !== request.leaseTokenHash || release.core.fenceHash !== request.fenceHash ||
      release.core.released !== true) throw new Error("p06 execution v2 invalid release");
    setTrace(trace, "release", "ok", release.receiptHash);
    return freezeResult({ version: P06_EXECUTION_V2_VERSION, executionRef: request.executionRef, outcome: replay.core.outcome,
      writes: 0, gateHashes, terminalHash: replay.core.terminalHash, releaseHash: release.receiptHash,
      rollbackProposal: null, trace });
  }

  const finish = async (outcome: Exclude<P06ExecutionV2Outcome, "disabled">): Promise<P06ExecutionV2Result> => {
    const terminal = await control.terminal({ executionRef: request.executionRef, outcome, writeReceiptHash,
      fenceHash: request.fenceHash });
    if (!validReceipt(terminal) || terminal.core.executionRef !== request.executionRef || terminal.core.outcome !== outcome ||
      terminal.core.writeReceiptHash !== writeReceiptHash || terminal.core.fenceHash !== request.fenceHash) {
      throw new Error("p06 execution v2 invalid terminal receipt");
    }
    setTrace(trace, "immutable_terminal", "ok", terminal.receiptHash);
    const release = await control.release({ executionRef: request.executionRef, leaseTokenHash: request.leaseTokenHash,
      fenceHash: request.fenceHash });
    if (!validReceipt(release) || release.core.executionRef !== request.executionRef ||
      release.core.leaseTokenHash !== request.leaseTokenHash || release.core.fenceHash !== request.fenceHash ||
      release.core.released !== true) throw new Error("p06 execution v2 invalid release");
    setTrace(trace, "release", "ok", release.receiptHash);
    let rollbackProposal: P06ExecutionV2RollbackProposal | null = null;
    if (outcome === "verification_failed" && before && after && writeReceiptHash) {
      const core = { version: "p06-rollback-proposal/1.0.0" as const, executionRef: request.executionRef,
        terminalHash: terminal.receiptHash, writeReceiptHash, beforeReadReceiptHash: before.receiptHash,
        afterReadReceiptHash: after.receiptHash, previousObserved: before.core.value, postWriteObserved: after.core.value,
        restoreTo: before.core.value, failedDesired: request.desired, requiresNewHumanApproval: true as const };
      rollbackProposal = Object.freeze({ ...core, proposalHash: digest(core) });
    }
    return freezeResult({ version: P06_EXECUTION_V2_VERSION, executionRef: request.executionRef, outcome, writes,
      gateHashes, terminalHash: terminal.receiptHash, releaseHash: release.receiptHash, rollbackProposal, trace });
  };

  if (!(await checkGate("post_claim"))) return finish("expected_before_mismatch");
  before = await writer.read({ workspaceRef: request.workspaceRef, accountRef: request.accountRef, entityRef: request.entityRef });
  if (!validEvidence(before, request)) throw new Error("p06 execution v2 invalid read evidence");
  setTrace(trace, "current_meta_read", "ok", before.receiptHash);
  if (sameValue(before.core.value, request.desired)) {
    setTrace(trace, "already_applied_no_second_write", "already_applied", before.receiptHash);
    return finish("already_applied_no_write");
  }
  if (!sameValue(before.core.value, request.expectedBefore)) {
    setTrace(trace, "expected_before", "held", before.receiptHash);
    return finish("expected_before_mismatch");
  }
  setTrace(trace, "expected_before", "ok", before.receiptHash);
  if (!(await checkGate("pre_dispatch"))) {
    setTrace(trace, "typed_mutation", "held", null);
    return finish("expected_before_mismatch");
  }
  const write = await writer.write({ request, idempotencyKey });
  if (!validReceipt(write) || write.core.executionRef !== request.executionRef ||
    write.core.idempotencyKey !== idempotencyKey || write.core.entityRef !== request.entityRef ||
    write.core.action !== request.action || !HASH.test(write.core.rawHash)) {
    throw new Error("p06 execution v2 invalid write evidence");
  }
  writes = 1;
  writeReceiptHash = write.receiptHash;
  setTrace(trace, "typed_mutation", write.core.kind === "ambiguous_transport" ? "ambiguous" : "ok", write.receiptHash);
  after = await writer.read({ workspaceRef: request.workspaceRef, accountRef: request.accountRef, entityRef: request.entityRef });
  if (!validEvidence(after, request)) throw new Error(`p06 execution v2 invalid ${write.core.kind === "ambiguous_transport" ? "ambiguous read" : "verification"} evidence`);
  setTrace(trace, "raw", "ok", digest({ beforeRawHash: before.core.rawHash, writeRawHash: write.core.rawHash,
    afterRawHash: after.core.rawHash, writeReceiptHash: write.receiptHash }));
  if (write.core.kind === "ambiguous_transport") setTrace(trace, "ambiguous_read_before_retry", "ok", after.receiptHash);
  const verified = sameValue(after.core.value, request.desired);
  const afterGateAllows = await checkGate("read_after_write");
  if (verified) return finish(write.core.kind === "ambiguous_transport" ? "ambiguous_resolved" : "written_verified");
  if (!afterGateAllows) return finish("verification_failed");
  return finish("verification_failed");
}
