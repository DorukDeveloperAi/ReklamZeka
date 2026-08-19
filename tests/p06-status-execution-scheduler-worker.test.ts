import { describe, expect, it, vi } from "vitest";

import { P06StatusExecutionSchedulerWorker } from "@/application/p06-status-execution-scheduler-worker";

describe("P06 status execution scheduler worker", () => {
  it("runs bounded pending/reclaim candidates with fresh lease and fence identities", async () => {
    const refs = [
      "p06_execution_aaaaaaaaaaaaaaaaaaaaaaaa",
      "p06_execution_bbbbbbbbbbbbbbbbbbbbbbbb",
    ] as const;
    const run = vi.fn().mockResolvedValue({ state: "succeeded" });
    const scheduler = new P06StatusExecutionSchedulerWorker({
      repository: { listRunnable: vi.fn(async () => refs) } as never,
      worker: { run } as never,
      now: () => new Date("2026-08-18T10:00:00.000Z"),
      nonce: vi.fn().mockReturnValueOnce("nonce-one").mockReturnValueOnce("nonce-two"),
    });

    const result = await scheduler.tick(2);

    expect(result).toEqual(refs.map((executionRef) => ({ executionRef, outcome: "completed" })));
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[0]![0]).toMatchObject({
      executionRef: refs[0],
      leaseUntil: "2026-08-18T10:01:00.000Z",
    });
    expect(run.mock.calls[0]![0].leaseTokenHash).toMatch(/^[a-f0-9]{64}$/);
    expect(run.mock.calls[0]![0].fenceHash).toMatch(/^[a-f0-9]{64}$/);
    expect(run.mock.calls[0]![0].leaseTokenHash).not.toBe(run.mock.calls[1]![0].leaseTokenHash);
  });

  it("isolates a lost CAS claim and continues the bounded batch", async () => {
    const run = vi.fn().mockRejectedValueOnce(new Error("conflict")).mockResolvedValueOnce({});
    const scheduler = new P06StatusExecutionSchedulerWorker({
      repository: {
        listRunnable: vi.fn(async () => [
          "p06_execution_aaaaaaaaaaaaaaaaaaaaaaaa",
          "p06_execution_bbbbbbbbbbbbbbbbbbbbbbbb",
        ]),
      } as never,
      worker: { run } as never,
      nonce: () => "nonce",
    });

    await expect(scheduler.tick()).resolves.toEqual([
      { executionRef: "p06_execution_aaaaaaaaaaaaaaaaaaaaaaaa", outcome: "conflict" },
      { executionRef: "p06_execution_bbbbbbbbbbbbbbbbbbbbbbbb", outcome: "completed" },
    ]);
  });
});
