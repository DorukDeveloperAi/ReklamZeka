import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  P06_EXECUTION_V2_STEPS,
  runP06ExecutionV2,
  type P06ExecutionV2Control,
  type P06ExecutionV2GatePhase,
  type P06ExecutionV2Value,
} from "@/domain/actions/p06-execution-v2";

const hash = (character: string) => character.repeat(64);
const receipt = <T>(core: T) => ({ core, receiptHash: createHash("sha256").update(JSON.stringify(core)).digest("hex") });
const request = {
  executionRef: "execution_main",
  workspaceRef: "workspace_main",
  accountRef: "account_main",
  entityRef: "adset_main",
  action: "status_pause" as const,
  expectedBefore: { status: "ACTIVE" as const, budgetMinor: 100 },
  desired: { status: "PAUSED" as const, budgetMinor: 100 },
  leaseTokenHash: hash("a"),
  fenceHash: hash("b"),
  evaluatedAt: "2026-08-18T12:00:00.000Z",
};

function makeControl(disabledAt?: P06ExecutionV2GatePhase): P06ExecutionV2Control {
  return {
    gate: vi.fn(async ({ phase }) => ({
      enabled: phase !== disabledAt,
      killSwitch: false,
      workspaceAllowlist: [request.workspaceRef],
      accountAllowlist: [request.accountRef],
      actionAllowlist: [request.action],
      snapshotHash: hash(phase === "staging" ? "1" : phase === "admission" ? "2" : phase === "post_claim" ? "3" : phase === "pre_dispatch" ? "4" : "5"),
      capturedAt: "2026-08-18T12:00:01.000Z",
    })),
    claim: vi.fn(async (input) => receipt({ ...input, owned: true as const })),
    idempotency: vi.fn(async (input) => receipt({ ...input, kind: "fresh" as const })),
    terminal: vi.fn(async (input) => receipt(input)),
    release: vi.fn(async (input) => receipt({ ...input, released: true as const })),
  };
}

function makeWriter(values: P06ExecutionV2Value[], writeKind: "written" | "ambiguous_transport" = "written") {
  let reads = 0;
  let writes = 0;
  return {
    port: {
      read: vi.fn(async (input) => receipt({
        ...input,
        value: values[Math.min(reads++, values.length - 1)]!,
        observedAt: "2026-08-18T12:00:02.000Z",
        rawHash: hash("d"),
      })),
      write: vi.fn(async ({ request: candidate, idempotencyKey }) => {
        writes += 1;
        return receipt({ executionRef: candidate.executionRef, idempotencyKey, entityRef: candidate.entityRef,
          action: candidate.action, kind: writeKind, rawHash: hash("f") });
      }),
    },
    counts: () => ({ reads, writes }),
  };
}

describe("P06 execution v2", () => {
  it("is default-off before lease or Meta reads", async () => {
    const writer = makeWriter([request.expectedBefore]);
    const control = makeControl("staging");
    const result = await runP06ExecutionV2({ request, writer: writer.port, control });
    expect(result.outcome).toBe("disabled");
    expect(result.terminalHash).toBeNull();
    expect(writer.counts()).toEqual({ reads: 0, writes: 0 });
    expect(control.claim).not.toHaveBeenCalled();
  });

  it("rechecks the central gate after claim and immediately before dispatch", async () => {
    for (const phase of ["post_claim", "pre_dispatch"] as const) {
      const writer = makeWriter([request.expectedBefore]);
      const control = makeControl(phase);
      const result = await runP06ExecutionV2({ request, writer: writer.port, control });
      expect(result.writes).toBe(0);
      expect(control.terminal).toHaveBeenCalledTimes(1);
      expect(control.release).toHaveBeenCalledTimes(1);
    }
  });

  it("rejects incoherent typed status and budget mutations", async () => {
    const writer = makeWriter([request.expectedBefore]);
    const control = makeControl();
    await expect(runP06ExecutionV2({
      request: { ...request, desired: { status: "ACTIVE", budgetMinor: 100 } }, writer: writer.port, control,
    })).rejects.toThrow("invalid input");
    await expect(runP06ExecutionV2({
      request: { ...request, action: "budget_decrease", desired: { status: "ACTIVE", budgetMinor: 100 } },
      writer: writer.port, control,
    })).rejects.toThrow("invalid input");
  });

  it("reads first and never writes an already-applied target", async () => {
    const writer = makeWriter([request.desired]);
    const result = await runP06ExecutionV2({ request, writer: writer.port, control: makeControl() });
    expect(result.outcome).toBe("already_applied_no_write");
    expect(result.writes).toBe(0);
    expect(writer.counts()).toEqual({ reads: 1, writes: 0 });
  });

  it("performs one typed write, captures RAW, and emits the exact ten-step trace", async () => {
    const writer = makeWriter([request.expectedBefore, request.desired]);
    const result = await runP06ExecutionV2({ request, writer: writer.port, control: makeControl() });
    expect(result.outcome).toBe("written_verified");
    expect(result.trace.map(({ step }) => step)).toEqual(P06_EXECUTION_V2_STEPS);
    expect(result.trace.find(({ step }) => step === "raw")?.receiptHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.trace.find(({ step }) => step === "ambiguous_read_before_retry")?.outcome).toBe("skipped");
    expect(writer.counts()).toEqual({ reads: 2, writes: 1 });
  });

  it("reads after ambiguous transport before any retry and performs no second write", async () => {
    const writer = makeWriter([request.expectedBefore, request.desired], "ambiguous_transport");
    const result = await runP06ExecutionV2({ request, writer: writer.port, control: makeControl() });
    expect(result.outcome).toBe("ambiguous_resolved");
    expect(result.trace.find(({ step }) => step === "ambiguous_read_before_retry")?.outcome).toBe("ok");
    expect(writer.counts()).toEqual({ reads: 2, writes: 1 });
  });

  it("does not misclassify a verified successful write when the final kill gate flips", async () => {
    const writer = makeWriter([request.expectedBefore, request.desired]);
    const result = await runP06ExecutionV2({ request, writer: writer.port, control: makeControl("read_after_write") });
    expect(result.outcome).toBe("written_verified");
    expect(result.rollbackProposal).toBeNull();
    expect(writer.counts()).toEqual({ reads: 2, writes: 1 });
  });

  it("binds rollback to execution-time observations and immutable receipts", async () => {
    const writer = makeWriter([request.expectedBefore, { status: "ACTIVE", budgetMinor: 77 }]);
    const result = await runP06ExecutionV2({ request, writer: writer.port, control: makeControl() });
    expect(result.outcome).toBe("verification_failed");
    expect(result.rollbackProposal).toMatchObject({
      executionRef: request.executionRef,
      previousObserved: request.expectedBefore,
      postWriteObserved: { status: "ACTIVE", budgetMinor: 77 },
      restoreTo: request.expectedBefore,
      requiresNewHumanApproval: true,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.rollbackProposal)).toBe(true);
  });

  it("uses durable idempotency replay without reading or writing Meta", async () => {
    const writer = makeWriter([request.expectedBefore]);
    const base = makeControl();
    const control: P06ExecutionV2Control = { ...base, idempotency: vi.fn(async (input) => receipt({
      ...input, kind: "completed" as const, terminalHash: hash("8"), outcome: "written_verified" as const,
    })) };
    const result = await runP06ExecutionV2({ request, writer: writer.port, control });
    expect(result.outcome).toBe("written_verified");
    expect(result.writes).toBe(0);
    expect(writer.counts()).toEqual({ reads: 0, writes: 0 });
  });

  it("fails closed on forged lease and read receipts", async () => {
    const base = makeControl();
    const badClaim: P06ExecutionV2Control = { ...base,
      claim: vi.fn(async (input) => ({ core: { ...input, owned: true as const }, receiptHash: "forged" })) };
    await expect(runP06ExecutionV2({ request, writer: makeWriter([request.expectedBefore]).port, control: badClaim }))
      .rejects.toThrow("invalid claim");
    const foreignCore = { executionRef: "execution_other", leaseTokenHash: request.leaseTokenHash,
      fenceHash: request.fenceHash, owned: true as const };
    const foreignClaim: P06ExecutionV2Control = { ...base, claim: vi.fn(async () => receipt(foreignCore)) };
    await expect(runP06ExecutionV2({ request, writer: makeWriter([request.expectedBefore]).port, control: foreignClaim }))
      .rejects.toThrow("invalid claim");
    const badRead = makeWriter([request.expectedBefore]);
    badRead.port.read = vi.fn(async (input) => ({ core: { ...input, value: request.expectedBefore,
      observedAt: "2026-08-18T12:00:02.000Z", rawHash: hash("d") }, receiptHash: "forged" }));
    await expect(runP06ExecutionV2({ request, writer: badRead.port, control: makeControl() }))
      .rejects.toThrow("invalid read evidence");
  });
});
