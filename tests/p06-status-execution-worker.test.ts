import { describe, expect, it, vi } from "vitest";

import {
  P06StatusExecutionWorker,
  type P06StatusExecutionDispatchAuthority,
  type P06StatusExecutionGate,
} from "@/application/p06-status-execution-worker";
import type { P06ExecutionWorkerSnapshot } from "@/connectors/actions/p06-execution-drizzle-repository";
import {
  p06ExecutionV2Digest,
  type P06ExecutionV2Writer,
} from "@/domain/actions/p06-execution-v2";

const executionRef = "p06_execution_aaaaaaaaaaaaaaaaaaaaaaaa";
const workspaceRef = "workspace_aaaaaaaaaaaaaaaa";
const request = Object.freeze({
  executionRef,
  workspaceRef,
  accountRef: "act_12345",
  entityRef: "adset_12345",
  action: "status_pause" as const,
  expectedBefore: Object.freeze({
    status: "ACTIVE" as const,
    budgetMinor: null,
  }),
  desired: Object.freeze({ status: "PAUSED" as const, budgetMinor: null }),
  evaluatedAt: "2026-08-18T10:00:00.000Z",
});
const allowlistHash = p06ExecutionV2Digest({
  workspaceAllowlist: [workspaceRef],
  accountAllowlist: ["act_12345"],
  actionAllowlist: ["status_pause"],
  killSwitch: false,
});
const phaseNumber = {
  staging: 1,
  admission: 2,
  post_claim: 3,
  pre_dispatch: 4,
  read_after_write: 5,
} as const;
const gate = (phase: keyof typeof phaseNumber): P06StatusExecutionGate =>
  Object.freeze({
    phase,
    enabled: true,
    killSwitch: false,
    workspaceAllowlist: [workspaceRef] as const,
    accountAllowlist: ["act_12345"] as const,
    actionAllowlist: ["status_pause"] as const,
    allowlistHash,
    capturedAt: `2026-08-18T10:00:0${phaseNumber[phase]}.000Z`,
    expiresAt: "2026-08-18T11:00:00.000Z",
  });
const persistedGate = (phase: "staging" | "admission") => {
  const seed = gate(phase);
  const sequence = phaseNumber[phase];
  const leaseEpoch = 0;
  const core = {
    version: "p06-execution-gate/1.0.0",
    phase,
    sequence,
    leaseEpoch,
    enabled: seed.enabled,
    allowlistHash,
    capturedAt: seed.capturedAt,
    expiresAt: seed.expiresAt,
  };
  const snapshotHash = p06ExecutionV2Digest(core);
  return Object.freeze({
    phase,
    sequence,
    leaseEpoch,
    snapshotHash,
    receiptHash: p06ExecutionV2Digest({
      executionRef,
      phase,
      sequence,
      leaseEpoch,
      snapshotHash,
    }),
    allowlistHash,
    enabled: true,
    capturedAt: seed.capturedAt,
    expiresAt: seed.expiresAt,
  });
};

function harness(
  writer: P06ExecutionV2Writer,
  authority: P06StatusExecutionDispatchAuthority = {
    revalidate: vi.fn(async ({ phase }) => ({
      allowed: true,
      authorityHash: p06ExecutionV2Digest({ phase, allowed: true }),
    })),
  },
) {
  const mutable: {
    state: P06ExecutionWorkerSnapshot["head"]["state"];
    sequence: number;
    traceSequence: number;
    terminalHash: string | null;
    traces: Array<P06ExecutionWorkerSnapshot["traces"][number]>;
    observations: Array<P06ExecutionWorkerSnapshot["observations"][number]>;
    gates: Array<P06ExecutionWorkerSnapshot["gates"][number]>;
  } = {
    state: "pending",
    sequence: 0,
    traceSequence: 0,
    terminalHash: null,
    traces: [],
    observations: [],
    gates: [persistedGate("staging"), persistedGate("admission")],
  };
  let leaseTokenHash: string | null = null;
  let fenceHash: string | null = null;
  let leaseEpoch = 0;
  const snapshot = (): P06ExecutionWorkerSnapshot =>
    Object.freeze({
      workspaceId: "00000000-0000-4000-8000-000000000001",
      executionRunId: "00000000-0000-4000-8000-000000000002",
      executionRef,
      idempotencyKey: `p06_exec_idem_${"1".repeat(64)}`,
      request,
      head: Object.freeze({
        state: mutable.state,
        sequence: mutable.sequence,
        traceSequence: mutable.traceSequence,
        headEventHash: mutable.traces.at(-1)?.eventHash ?? null,
        leaseTokenHash,
        fenceHash,
        leaseEpoch,
        leaseExpiresAt: leaseTokenHash ? "2026-08-18T11:00:00.000Z" : null,
        terminalHash: mutable.terminalHash,
      }),
      traces: Object.freeze([...mutable.traces]),
      observations: Object.freeze([...mutable.observations]),
      gates: Object.freeze([...mutable.gates]),
    });
  const repository = {
    loadForWorker: vi.fn(async () => snapshot()),
    claimLease: vi.fn(
      async (input: { leaseTokenHash: string; fenceHash: string }) => {
        leaseTokenHash = input.leaseTokenHash;
        fenceHash = input.fenceHash;
        leaseEpoch += 1;
        mutable.state = "claimed";
        const core = Object.freeze({
          executionRef,
          leaseTokenHash,
          fenceHash,
          owned: true as const,
        });
        return Object.freeze({ core, receiptHash: p06ExecutionV2Digest(core) });
      },
    ),
    appendGate: vi.fn(
      async ({ gate: seed }: { gate: P06StatusExecutionGate }) => {
        const sequence = phaseNumber[seed.phase];
        const core = {
          version: "p06-execution-gate/1.0.0",
          phase: seed.phase,
          sequence,
          leaseEpoch,
          enabled: seed.enabled,
          allowlistHash: seed.allowlistHash,
          capturedAt: seed.capturedAt,
          expiresAt: seed.expiresAt,
        };
        const snapshotHash = p06ExecutionV2Digest(core);
        const receiptHash = p06ExecutionV2Digest({
          executionRef,
          phase: seed.phase,
          sequence,
          leaseEpoch,
          snapshotHash,
        });
        const existing = mutable.gates.find(
          (item) => item.phase === seed.phase && item.leaseEpoch === leaseEpoch,
        );
        if (!existing)
          mutable.gates.push(
            Object.freeze({
              phase: seed.phase,
              sequence,
              snapshotHash,
              receiptHash,
              leaseEpoch,
              allowlistHash: seed.allowlistHash,
              enabled: seed.enabled,
              capturedAt: seed.capturedAt,
              expiresAt: seed.expiresAt,
            }),
          );
        else if (existing.receiptHash !== receiptHash)
          throw new Error("gate conflict");
        return receiptHash;
      },
    ),
    appendTrace: vi.fn(
      async ({
        step,
        outcome,
        receiptCore,
        occurredAt,
      }: {
        step: P06ExecutionWorkerSnapshot["traces"][number]["step"];
        outcome: P06ExecutionWorkerSnapshot["traces"][number]["outcome"];
        receiptCore: Record<string, unknown>;
        occurredAt: string;
      }) => {
        const traceSequence = mutable.traceSequence + 1;
        const receiptHash = p06ExecutionV2Digest(receiptCore);
        const eventHash = p06ExecutionV2Digest({
          executionRef,
          traceSequence,
          step,
          outcome,
          receiptHash,
          occurredAt,
        });
        mutable.traces.push(
          Object.freeze({
            eventHash,
            traceSequence,
            step,
            outcome,
            receiptHash,
            receiptCore: Object.freeze(receiptCore),
            occurredAt,
          }),
        );
        mutable.traceSequence = traceSequence;
        mutable.sequence += 1;
        mutable.state = "running";
        if (traceSequence === 10) {
          const terminal = mutable.traces[8]!;
          mutable.terminalHash = terminal.receiptHash;
          leaseTokenHash = null;
          fenceHash = null;
          const terminalOutcome = String(terminal.receiptCore.outcome);
          mutable.state =
            terminalOutcome === "verification_failed"
              ? "verification_failed"
              : terminalOutcome === "expected_before_mismatch"
                ? "held"
                : "succeeded";
        }
        return Object.freeze({ eventHash, receiptHash });
      },
    ),
    appendObservation: vi.fn(
      async ({
        eventHash,
        kind,
        metadataHash,
        rawHash,
        observedValue,
        observedAt,
      }: {
        eventHash: string;
        kind: P06ExecutionWorkerSnapshot["observations"][number]["kind"];
        metadataHash: string;
        rawHash: string;
        observedValue: Record<string, unknown>;
        observedAt: string;
      }) => {
        const existing = mutable.observations.find(
          (item) => item.eventHash === eventHash && item.kind === kind,
        );
        if (existing)
          return {
            observationId: existing.observationId,
            observationRef: "p06_observation_replay",
            observationHash: "2".repeat(64),
          };
        const observationId = `00000000-0000-4000-8000-${String(mutable.observations.length + 10).padStart(12, "0")}`;
        mutable.observations.push(
          Object.freeze({
            observationId,
            eventHash,
            kind,
            metadataHash,
            rawHash,
            observedValue: Object.freeze(observedValue),
            observedAt,
          }),
        );
        return {
          observationId,
          observationRef: "p06_observation_fixture",
          observationHash: "2".repeat(64),
        };
      },
    ),
    appendRollbackProposal: vi.fn(async () => ({
      rollbackProposalId: "00000000-0000-4000-8000-000000000099",
      proposalRef: "p06_rollback_aaaaaaaaaaaaaaaaaaaaaaaa",
      proposalHash: "3".repeat(64),
    })),
  };
  let tick = 10;
  const worker = new P06StatusExecutionWorker({
    repository: repository as never,
    writer,
    authority,
    gates: { resolve: vi.fn(async ({ phase }) => gate(phase)) },
    now: () =>
      new Date(`2026-08-18T10:00:${String(tick++).padStart(2, "0")}.000Z`),
  });
  return { worker, repository, mutable };
}

const readReceipt = (status: "ACTIVE" | "PAUSED") => {
  const core = Object.freeze({
    workspaceRef,
    accountRef: "act_12345",
    entityRef: "adset_12345",
    value: Object.freeze({ status, budgetMinor: null }),
    observedAt: "2026-08-18T10:00:20.000Z",
    rawHash: "a".repeat(64),
  });
  return Object.freeze({ core, receiptHash: p06ExecutionV2Digest(core) });
};

describe("P06StatusExecutionWorker", () => {
  it("persists the exact ten-step successful status path with one write", async () => {
    const writer: P06ExecutionV2Writer = {
      read: vi
        .fn()
        .mockResolvedValueOnce(readReceipt("ACTIVE"))
        .mockResolvedValueOnce(readReceipt("PAUSED")),
      write: vi.fn(async ({ request: current, idempotencyKey }) => {
        const core = Object.freeze({
          executionRef,
          idempotencyKey,
          entityRef: current.entityRef,
          action: current.action,
          kind: "written" as const,
          rawHash: "b".repeat(64),
        });
        return Object.freeze({ core, receiptHash: p06ExecutionV2Digest(core) });
      }),
    };
    const { worker, mutable } = harness(writer);
    const result = await worker.run({
      executionRef,
      leaseTokenHash: "c".repeat(64),
      fenceHash: "d".repeat(64),
      leaseUntil: "2026-08-18T11:00:00.000Z",
    });

    expect(result).toMatchObject({ state: "succeeded", traceSequence: 10 });
    expect(mutable.traces.map((item) => item.step)).toEqual([
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
    ]);
    expect(writer.write).toHaveBeenCalledTimes(1);
    expect(mutable.observations).toHaveLength(3);
  });

  it("recovers a crash after dispatch by reading Meta and never issuing a second write", async () => {
    let status: "ACTIVE" | "PAUSED" = "ACTIVE";
    let writes = 0;
    const writer: P06ExecutionV2Writer = {
      read: vi.fn(async () => readReceipt(status)),
      write: vi.fn(async () => {
        writes += 1;
        status = "PAUSED";
        throw new Error("crash_after_dispatch");
      }),
    };
    const { worker, mutable } = harness(writer);
    await expect(
      worker.run({
        executionRef,
        leaseTokenHash: "c".repeat(64),
        fenceHash: "d".repeat(64),
        leaseUntil: "2026-08-18T11:00:00.000Z",
      }),
    ).rejects.toThrow("crash_after_dispatch");
    expect(mutable.traceSequence).toBe(4);

    const recovered = await worker.run({
      executionRef,
      leaseTokenHash: "e".repeat(64),
      fenceHash: "f".repeat(64),
      leaseUntil: "2026-08-18T11:00:00.000Z",
    });

    expect(recovered.state).toBe("succeeded");
    expect(
      mutable.traces.find((item) => item.step === "typed_mutation")?.outcome,
    ).toBe("ambiguous");
    expect(mutable.traces[8]?.receiptCore.outcome).toBe("ambiguous_resolved");
    expect(
      mutable.gates
        .filter((item) => item.leaseEpoch === 2)
        .map((item) => item.phase)
        .sort(),
    ).toEqual(["post_claim", "pre_dispatch", "read_after_write"]);
    expect(writes).toBe(1);
  });

  it("holds before any Meta call when current dispatch authority has expired", async () => {
    const writer: P06ExecutionV2Writer = {
      read: vi.fn(),
      write: vi.fn(),
    };
    const authority: P06StatusExecutionDispatchAuthority = {
      revalidate: vi.fn(async ({ phase }) => ({
        allowed: phase !== "post_claim",
        authorityHash: p06ExecutionV2Digest({
          phase,
          allowed: phase !== "post_claim",
        }),
      })),
    };
    const { worker, mutable } = harness(writer, authority);

    const result = await worker.run({
      executionRef,
      leaseTokenHash: "c".repeat(64),
      fenceHash: "d".repeat(64),
      leaseUntil: "2026-08-18T11:00:00.000Z",
    });

    expect(result.state).toBe("held");
    expect(writer.read).not.toHaveBeenCalled();
    expect(writer.write).not.toHaveBeenCalled();
    expect(mutable.traces).toHaveLength(10);
  });
});
