import "server-only";

import type {
  DrizzleP06ExecutionRepository,
  P06ExecutionGateSeed,
  P06ExecutionWorkerSnapshot,
} from "@/connectors/actions/p06-execution-drizzle-repository";
import {
  p06ExecutionV2Digest,
  type P06ExecutionV2Action,
  type P06ExecutionV2GatePhase,
  type P06ExecutionV2ReadCore,
  type P06ExecutionV2ReadEvidence,
  type P06ExecutionV2RollbackProposal,
  type P06ExecutionV2Value,
  type P06ExecutionV2Writer,
} from "@/domain/actions/p06-execution-v2";

type Repository = Pick<
  DrizzleP06ExecutionRepository,
  | "loadForWorker"
  | "claimLease"
  | "appendGate"
  | "appendTrace"
  | "appendObservation"
  | "appendRollbackProposal"
>;
const HASH = /^[a-f0-9]{64}$/;

export type P06StatusExecutionGate = Readonly<
  P06ExecutionGateSeed & {
    killSwitch: boolean;
    workspaceAllowlist: readonly string[];
    accountAllowlist: readonly string[];
    actionAllowlist: readonly P06ExecutionV2Action[];
  }
>;
export type P06StatusExecutionGateResolver = Readonly<{
  resolve(
    input: Readonly<{
      phase: P06ExecutionV2GatePhase;
      request: P06ExecutionWorkerSnapshot["request"];
      evaluatedAt: string;
    }>,
  ): Promise<P06StatusExecutionGate>;
}>;
export type P06StatusExecutionDispatchAuthority = Readonly<{
  revalidate(
    input: Readonly<{
      phase: "post_claim" | "pre_dispatch";
      executionRef: string;
      request: P06ExecutionWorkerSnapshot["request"];
    }>,
  ): Promise<Readonly<{ allowed: boolean; authorityHash: string }>>;
}>;

export class P06StatusExecutionWorkerError extends Error {
  constructor(
    readonly code:
      | "invalid_input"
      | "gate_rejected"
      | "corrupt_store"
      | "persistence_failed",
  ) {
    super(`P06 status execution worker rejected: ${code}`);
  }
}
const fail = (code: P06StatusExecutionWorkerError["code"]): never => {
  throw new P06StatusExecutionWorkerError(code);
};
const same = (left: P06ExecutionV2Value, right: P06ExecutionV2Value) =>
  left.status === right.status && left.budgetMinor === right.budgetMinor;
const value = (input: unknown): P06ExecutionV2Value => {
  if (!input || typeof input !== "object" || Array.isArray(input))
    fail("corrupt_store");
  const source = input as Record<string, unknown>;
  if (
    (source.status !== "ACTIVE" && source.status !== "PAUSED") ||
    source.budgetMinor !== null
  )
    fail("corrupt_store");
  return Object.freeze({
    status: source.status as "ACTIVE" | "PAUSED",
    budgetMinor: null,
  });
};
const exactRead = (
  input: unknown,
  snapshot: P06ExecutionWorkerSnapshot,
): P06ExecutionV2ReadCore => {
  if (!input || typeof input !== "object" || Array.isArray(input))
    fail("corrupt_store");
  const source = input as Record<string, unknown>;
  if (
    source.workspaceRef !== snapshot.request.workspaceRef ||
    source.accountRef !== snapshot.request.accountRef ||
    source.entityRef !== snapshot.request.entityRef ||
    typeof source.observedAt !== "string" ||
    !Number.isFinite(Date.parse(source.observedAt)) ||
    typeof source.rawHash !== "string" ||
    !HASH.test(source.rawHash)
  )
    fail("corrupt_store");
  return Object.freeze({
    workspaceRef: source.workspaceRef as string,
    accountRef: source.accountRef as string,
    entityRef: source.entityRef as string,
    value: value(source.value),
    observedAt: source.observedAt as string,
    rawHash: source.rawHash as string,
  });
};

/**
 * Server-private durable status worker. It deliberately never retries a Meta
 * mutation. When an invocation resumes at the dispatch boundary it reads Meta
 * first; a still-old state is held for human review, while an already-applied
 * state is recorded as an ambiguous resolution.
 */
export class P06StatusExecutionWorker {
  constructor(
    private readonly dependencies: Readonly<{
      repository: Repository;
      gates: P06StatusExecutionGateResolver;
      authority: P06StatusExecutionDispatchAuthority;
      writer: P06ExecutionV2Writer;
      now?: () => Date;
    }>,
  ) {}

  async run(
    input: Readonly<{
      executionRef: string;
      leaseTokenHash: string;
      fenceHash: string;
      leaseUntil: string;
    }>,
  ): Promise<
    Readonly<{
      executionRef: string;
      state: P06ExecutionWorkerSnapshot["head"]["state"];
      traceSequence: number;
      terminalHash: string | null;
      rollbackProposalId: string | null;
    }>
  > {
    if (
      !/^p06_execution_[a-f0-9]{24}$/.test(input.executionRef) ||
      !HASH.test(input.leaseTokenHash) ||
      !HASH.test(input.fenceHash) ||
      !Number.isFinite(Date.parse(input.leaseUntil))
    )
      fail("invalid_input");
    const clock = () => (this.dependencies.now?.() ?? new Date()).toISOString();
    let snapshot = await this.dependencies.repository.loadForWorker(
      input.executionRef,
    );
    if (
      ["succeeded", "verification_failed", "held"].includes(snapshot.head.state)
    )
      return this.result(snapshot, null);
    const claim = await this.dependencies.repository.claimLease({
      executionRef: input.executionRef,
      leaseTokenHash: input.leaseTokenHash,
      fenceHash: input.fenceHash,
      now: clock(),
      leaseUntil: input.leaseUntil,
    });
    snapshot = await this.dependencies.repository.loadForWorker(
      input.executionRef,
    );
    const invocationStartedAt = snapshot.head.traceSequence;
    let rollbackProposalId: string | null = null;

    const append = async (
      step: Parameters<Repository["appendTrace"]>[0]["step"],
      outcome: Parameters<Repository["appendTrace"]>[0]["outcome"],
      receiptCore: Readonly<Record<string, unknown>>,
    ) => {
      await this.dependencies.repository.appendTrace({
        executionRef: input.executionRef,
        leaseTokenHash: input.leaseTokenHash,
        fenceHash: input.fenceHash,
        step,
        outcome,
        receiptCore,
        occurredAt: clock(),
      });
      snapshot = await this.dependencies.repository.loadForWorker(
        input.executionRef,
      );
    };
    const trace = (sequence: number) =>
      snapshot.traces.find((entry) => entry.traceSequence === sequence) ?? null;
    const observation = (
      kind: P06ExecutionWorkerSnapshot["observations"][number]["kind"],
    ) => snapshot.observations.find((entry) => entry.kind === kind) ?? null;
    const persistObservation = async (
      eventHash: string,
      kind: P06ExecutionWorkerSnapshot["observations"][number]["kind"],
      core: P06ExecutionV2ReadCore | Readonly<Record<string, unknown>>,
      observedValue: P06ExecutionV2Value,
      observedAt: string,
    ) => {
      await this.dependencies.repository.appendObservation({
        executionRef: input.executionRef,
        eventHash,
        kind,
        metadataHash: p06ExecutionV2Digest(core),
        rawHash: String(core.rawHash),
        observedValue,
        observedAt,
      });
      snapshot = await this.dependencies.repository.loadForWorker(
        input.executionRef,
      );
    };
    const gate = async (phase: P06ExecutionV2GatePhase): Promise<boolean> => {
      const resolved = await this.dependencies.gates.resolve({
        phase,
        request: snapshot.request,
        evaluatedAt: clock(),
      });
      const allowlistHash = p06ExecutionV2Digest({
        workspaceAllowlist: [...resolved.workspaceAllowlist].sort(),
        accountAllowlist: [...resolved.accountAllowlist].sort(),
        actionAllowlist: [...resolved.actionAllowlist].sort(),
        killSwitch: resolved.killSwitch,
      });
      if (
        resolved.phase !== phase ||
        resolved.allowlistHash !== allowlistHash ||
        !HASH.test(allowlistHash)
      )
        fail("gate_rejected");
      const allowed =
        resolved.enabled === true &&
        resolved.killSwitch === false &&
        resolved.workspaceAllowlist.includes(snapshot.request.workspaceRef) &&
        resolved.accountAllowlist.includes(snapshot.request.accountRef) &&
        resolved.actionAllowlist.includes(snapshot.request.action);
      if (phase === "staging" || phase === "admission") {
        const persisted = snapshot.gates.find(
          (entry) => entry.phase === phase && entry.leaseEpoch === 0,
        );
        if (
          !persisted ||
          persisted.enabled !== true ||
          persisted.allowlistHash !== allowlistHash ||
          Date.parse(persisted.expiresAt) <= Date.parse(clock())
        )
          return false;
      } else {
        await this.dependencies.repository.appendGate({
          executionRef: input.executionRef,
          gate: resolved,
        });
        snapshot = await this.dependencies.repository.loadForWorker(
          input.executionRef,
        );
      }
      return allowed;
    };
    const authority = async (phase: "post_claim" | "pre_dispatch") => {
      const result = await this.dependencies.authority.revalidate({
        phase,
        executionRef: input.executionRef,
        request: snapshot.request,
      });
      if (typeof result.allowed !== "boolean" || !HASH.test(result.authorityHash))
        fail("gate_rejected");
      return result;
    };
    const ensureLateGates = async () => {
      for (const phase of [
        "post_claim",
        "pre_dispatch",
        "read_after_write",
      ] as const) {
        if (
          !snapshot.gates.some(
            (entry) =>
              entry.phase === phase &&
              entry.leaseEpoch === snapshot.head.leaseEpoch,
          )
        )
          await gate(phase);
      }
    };
    const finishHeld = async () => {
      await ensureLateGates();
      const skipped: readonly [
        Parameters<Repository["appendTrace"]>[0]["step"],
        Parameters<Repository["appendTrace"]>[0]["outcome"],
      ][] = [
        ["current_meta_read", "skipped"],
        ["expected_before", "held"],
        ["typed_mutation", "held"],
        ["raw", "skipped"],
        ["already_applied_no_second_write", "skipped"],
        ["ambiguous_read_before_retry", "skipped"],
      ];
      for (const [step, outcome] of skipped)
        if (
          snapshot.head.traceSequence <
          [
            "lease",
            "idempotency",
            "current_meta_read",
            "expected_before",
            "typed_mutation",
            "raw",
            "already_applied_no_second_write",
            "ambiguous_read_before_retry",
          ].indexOf(step) +
            1
        ) {
          await append(step, outcome, {
            executionRef: input.executionRef,
            step,
            reason: "execution_held",
          });
        }
      if (snapshot.head.traceSequence < 9)
        await append("immutable_terminal", "ok", {
          executionRef: input.executionRef,
          outcome: "expected_before_mismatch",
          writeReceiptHash: null,
          fenceHash: input.fenceHash,
        });
      if (snapshot.head.traceSequence < 10)
        await append("release", "ok", {
          executionRef: input.executionRef,
          leaseTokenHash: input.leaseTokenHash,
          fenceHash: input.fenceHash,
          released: true,
        });
    };

    if (!(await gate("staging")) || !(await gate("admission"))) {
      if (snapshot.head.traceSequence === 0)
        await append("lease", "ok", claim.core);
      if (snapshot.head.traceSequence === 1)
        await append("idempotency", "ok", {
          kind: "fresh",
          executionRef: input.executionRef,
          idempotencyKey: snapshot.idempotencyKey,
          fenceHash: input.fenceHash,
        });
      await finishHeld();
      return this.result(snapshot, null);
    }
    if (snapshot.head.traceSequence === 0)
      await append("lease", "ok", claim.core);
    if (snapshot.head.traceSequence === 1)
      await append("idempotency", "ok", {
        kind: "fresh",
        executionRef: input.executionRef,
        idempotencyKey: snapshot.idempotencyKey,
        fenceHash: input.fenceHash,
      });
    if (
      snapshot.head.traceSequence >= 2 &&
      snapshot.head.traceSequence < 9 &&
      !snapshot.gates.some(
        (entry) =>
          entry.phase === "post_claim" &&
          entry.leaseEpoch === snapshot.head.leaseEpoch,
      )
    ) {
      const postClaimAllowed = await gate("post_claim");
      // From the dispatch boundary onward, the previous invocation may have
      // reached Meta. A newly disabled gate prevents another write, but the
      // worker must still reconcile by reading before it can terminalize.
      if (!postClaimAllowed && invocationStartedAt < 4) {
        await finishHeld();
        return this.result(snapshot, null);
      }
    }
    if (snapshot.head.traceSequence >= 2 && snapshot.head.traceSequence < 9) {
      const postClaimAuthority = await authority("post_claim");
      if (!postClaimAuthority.allowed && invocationStartedAt < 4) {
        await finishHeld();
        return this.result(snapshot, null);
      }
    }
    if (snapshot.head.traceSequence === 2) {
      const read = await this.dependencies.writer.read({
        workspaceRef: snapshot.request.workspaceRef,
        accountRef: snapshot.request.accountRef,
        entityRef: snapshot.request.entityRef,
        action: snapshot.request.action,
      });
      if (read.receiptHash !== p06ExecutionV2Digest(read.core))
        fail("corrupt_store");
      await append("current_meta_read", "ok", read.core);
      await persistObservation(
        trace(3)!.eventHash,
        "read_before",
        read.core,
        read.core.value,
        read.core.observedAt,
      );
    }
    let before = observation("read_before");
    if (!before && snapshot.head.traceSequence >= 3) {
      const core = exactRead(trace(3)?.receiptCore, snapshot);
      await persistObservation(
        trace(3)!.eventHash,
        "read_before",
        core,
        core.value,
        core.observedAt,
      );
      before = observation("read_before");
    }
    if (!before) fail("corrupt_store");
    const requiredBefore = before as NonNullable<typeof before>;
    const beforeValue = value(requiredBefore.observedValue);
    if (snapshot.head.traceSequence === 3) {
      if (same(beforeValue, snapshot.request.desired)) {
        await append("expected_before", "skipped", {
          executionRef: input.executionRef,
          alreadyApplied: true,
        });
      } else if (!same(beforeValue, snapshot.request.expectedBefore)) {
        await append("expected_before", "held", {
          executionRef: input.executionRef,
          mismatch: true,
        });
      } else await append("expected_before", "ok", trace(3)!.receiptCore);
    }
    const expectedTrace = trace(4)!;
    if (expectedTrace.outcome === "held") {
      await finishHeld();
      return this.result(snapshot, null);
    }
    if (expectedTrace.outcome === "skipped") {
      if (snapshot.head.traceSequence === 4)
        await append("typed_mutation", "skipped", {
          executionRef: input.executionRef,
          skipped: true,
        });
      if (snapshot.head.traceSequence === 5)
        await append("raw", "skipped", {
          executionRef: input.executionRef,
          skipped: true,
        });
      if (snapshot.head.traceSequence === 6)
        await append(
          "already_applied_no_second_write",
          "already_applied",
          trace(3)!.receiptCore,
        );
      if (snapshot.head.traceSequence === 7)
        await append("ambiguous_read_before_retry", "skipped", {
          executionRef: input.executionRef,
          skipped: true,
        });
      await ensureLateGates();
    } else if (snapshot.head.traceSequence === 4) {
      const preDispatchAllowed = await gate("pre_dispatch");
      const preDispatchAuthority = await authority("pre_dispatch");
      if (
        (!preDispatchAllowed || !preDispatchAuthority.allowed) &&
        invocationStartedAt < 4
      ) {
        await finishHeld();
        return this.result(snapshot, null);
      }
      if (invocationStartedAt >= 4) {
        const reread = await this.dependencies.writer.read({
          workspaceRef: snapshot.request.workspaceRef,
          accountRef: snapshot.request.accountRef,
          entityRef: snapshot.request.entityRef,
          action: snapshot.request.action,
        });
        if (reread.receiptHash !== p06ExecutionV2Digest(reread.core))
          fail("corrupt_store");
        if (!same(reread.core.value, snapshot.request.desired)) {
          await finishHeld();
          return this.result(snapshot, null);
        }
        const unknownWrite = {
          executionRef: input.executionRef,
          idempotencyKey: snapshot.idempotencyKey,
          entityRef: snapshot.request.entityRef,
          action: snapshot.request.action,
          kind: "ambiguous_transport",
          rawHash: reread.core.rawHash,
        } as const;
        await append("typed_mutation", "ambiguous", unknownWrite);
        await persistObservation(
          trace(5)!.eventHash,
          "write_receipt",
          unknownWrite,
          snapshot.request.desired,
          reread.core.observedAt,
        );
      } else {
        const write = await this.dependencies.writer.write({
          request: {
            ...snapshot.request,
            leaseTokenHash: input.leaseTokenHash,
            fenceHash: input.fenceHash,
          },
          idempotencyKey: snapshot.idempotencyKey,
        });
        if (write.receiptHash !== p06ExecutionV2Digest(write.core))
          fail("corrupt_store");
        await append(
          "typed_mutation",
          write.core.kind === "ambiguous_transport" ? "ambiguous" : "ok",
          write.core,
        );
        await persistObservation(
          trace(5)!.eventHash,
          "write_receipt",
          write.core,
          snapshot.request.desired,
          clock(),
        );
      }
    }
    if (snapshot.head.traceSequence === 5) {
      const after = await this.dependencies.writer.read({
        workspaceRef: snapshot.request.workspaceRef,
        accountRef: snapshot.request.accountRef,
        entityRef: snapshot.request.entityRef,
        action: snapshot.request.action,
      });
      if (after.receiptHash !== p06ExecutionV2Digest(after.core))
        fail("corrupt_store");
      const writeTrace = trace(5)!;
      await append("raw", "ok", {
        beforeRawHash: requiredBefore.rawHash,
        writeRawHash: String(writeTrace.receiptCore.rawHash),
        afterRawHash: after.core.rawHash,
        writeReceiptHash: writeTrace.receiptHash,
        afterRead: after.core,
      });
      await persistObservation(
        trace(6)!.eventHash,
        "read_after",
        after.core,
        after.core.value,
        after.core.observedAt,
      );
    }
    let after = observation("read_after");
    if (!after && snapshot.head.traceSequence >= 6) {
      const raw = trace(6)?.receiptCore;
      const core = exactRead(raw?.afterRead, snapshot);
      await persistObservation(
        trace(6)!.eventHash,
        "read_after",
        core,
        core.value,
        core.observedAt,
      );
      after = observation("read_after");
    }
    if (snapshot.head.traceSequence === 6) {
      await gate("read_after_write");
      await append("already_applied_no_second_write", "skipped", {
        executionRef: input.executionRef,
        skipped: true,
      });
    }
    if (snapshot.head.traceSequence === 7)
      await append(
        "ambiguous_read_before_retry",
        trace(5)?.outcome === "ambiguous" ? "ok" : "skipped",
        {
          executionRef: input.executionRef,
          readReceiptHash: after?.metadataHash ?? null,
          beforeRetry: trace(5)?.outcome === "ambiguous",
        },
      );
    if (snapshot.head.traceSequence === 8) {
      if (!after) fail("corrupt_store");
      const requiredAfter = after as NonNullable<typeof after>;
      const outcome = same(
        value(requiredAfter.observedValue),
        snapshot.request.desired,
      )
        ? trace(5)?.outcome === "ambiguous"
          ? "ambiguous_resolved"
          : "written_verified"
        : "verification_failed";
      await append("immutable_terminal", "ok", {
        executionRef: input.executionRef,
        outcome,
        writeReceiptHash: trace(5)?.receiptHash ?? null,
        fenceHash: input.fenceHash,
      });
    }
    if (snapshot.head.traceSequence === 9)
      await append("release", "ok", {
        executionRef: input.executionRef,
        leaseTokenHash: input.leaseTokenHash,
        fenceHash: input.fenceHash,
        released: true,
      });
    if (snapshot.head.state === "verification_failed") {
      before = observation("read_before");
      after = observation("read_after");
      const write = observation("write_receipt");
      const terminal = trace(9);
      if (before && after && write && terminal) {
        const core = {
          version: "p06-rollback-proposal/1.0.0" as const,
          executionRef: input.executionRef,
          terminalHash: terminal.receiptHash,
          writeReceiptHash: write.metadataHash,
          beforeReadReceiptHash: before.metadataHash,
          afterReadReceiptHash: after.metadataHash,
          previousObserved: value(before.observedValue),
          postWriteObserved: value(after.observedValue),
          restoreTo: value(before.observedValue),
          failedDesired: snapshot.request.desired,
          requiresNewHumanApproval: true as const,
        };
        const proposal: P06ExecutionV2RollbackProposal = Object.freeze({
          ...core,
          proposalHash: p06ExecutionV2Digest(core),
        });
        const saved = await this.dependencies.repository.appendRollbackProposal(
          {
            proposal,
            beforeObservationId: before.observationId,
            afterObservationId: after.observationId,
            writeObservationId: write.observationId,
          },
        );
        rollbackProposalId = saved.rollbackProposalId;
      }
    }
    snapshot = await this.dependencies.repository.loadForWorker(
      input.executionRef,
    );
    return this.result(snapshot, rollbackProposalId);
  }

  private result(
    snapshot: P06ExecutionWorkerSnapshot,
    rollbackProposalId: string | null,
  ) {
    return Object.freeze({
      executionRef: snapshot.executionRef,
      state: snapshot.head.state,
      traceSequence: snapshot.head.traceSequence,
      terminalHash: snapshot.head.terminalHash,
      rollbackProposalId,
    });
  }
}
