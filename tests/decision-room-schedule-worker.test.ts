import { describe, expect, it, vi } from "vitest";
import { runDecisionRoomScheduleWorker } from "@/application/decision-room-schedule-worker";
import type { DecisionRoomDueSchedule } from "@/connectors/decisions/decision-room-drizzle-adapters";
import {
  DecisionRoomExecutor,
  InMemoryDecisionRoomInbox,
  InMemoryDecisionRoomRunStore,
} from "@/domain/decisions/executor";
import {
  DECISION_ROOM_SCHEDULE_VERSION,
  decisionRoomScheduleDefinitionHash,
  type DecisionRoomSchedule,
} from "@/domain/decisions/schedule";

function schedule(overrides: Partial<DecisionRoomSchedule> = {}): DecisionRoomSchedule {
  return {
    version: DECISION_ROOM_SCHEDULE_VERSION,
    scheduleRef: "schedule_daily",
    workspaceRef: "workspace_safe",
    accountRef: "account_safe",
    campaignRef: "campaign_safe",
    timeframeRef: "timeframe_7d",
    templateRef: "template_daily",
    timezone: "Europe/Istanbul",
    localTime: "09:00",
    enabled: true,
    catchUpPolicy: "run_once",
    tickGraceMinutes: 5,
    dstPolicy: { gap: "next_valid", overlap: "first_occurrence" },
    notificationChannel: "in_app_inbox",
    frequency: "daily",
    ...overrides,
  } as DecisionRoomSchedule;
}

function due(value = schedule(), overrides: Partial<DecisionRoomDueSchedule> = {}): DecisionRoomDueSchedule {
  return {
    schedule: value,
    revision: 1,
    definitionHash: decisionRoomScheduleDefinitionHash(value),
    lastScheduledFor: "2026-08-06T06:00:00.000Z",
    nextRunAt: "2026-08-07T06:00:00.000Z",
    ...overrides,
  };
}

describe("bounded Decision Room schedule worker", () => {
  it("runs the exact definition and advances only a safely completed tick", async () => {
    const recordTick = vi.fn(async () => true);
    const registry = { listDue: vi.fn(async () => [due()]), recordTick };
    const executor = { execute: vi.fn(async () => ({
      status: "completed" as const, runRef: "run_aaaaaaaaaaaaaaaaaaaa",
      version: "decision-room-executor/1.0.0" as const,
      idempotencyKey: `idempotency_${"b".repeat(32)}`, attempt: 1, retryable: false,
      actionAuthority: "none" as const, notificationChannel: "in_app_inbox" as const,
    })) };

    const result = await runDecisionRoomScheduleWorker(
      { now: "2026-08-07T12:00:00Z", batchSize: 10 }, registry, executor,
    );

    expect(result).toMatchObject({ dueCount: 1, tickAdvancedCount: 1, actionAuthority: "none" });
    expect(executor.execute).toHaveBeenCalledWith(expect.objectContaining({
      trigger: expect.objectContaining({
        kind: "scheduled",
        scheduleRef: "schedule_daily",
        scheduleDefinitionHash: due().definitionHash,
        scheduledFor: "2026-08-07T06:00:00.000Z",
      }),
    }));
    expect(recordTick).toHaveBeenCalledWith({
      scheduleRef: "schedule_daily",
      scheduledFor: "2026-08-07T06:00:00.000Z",
      nextRunAt: "2026-08-08T06:00:00.000Z",
    });
  });

  it("isolates per-schedule failures and does not advance unsafe executor outcomes", async () => {
    const candidates = [
      due(schedule({ scheduleRef: "schedule_failed" })),
      due(schedule({ scheduleRef: "schedule_broken" })),
      due(schedule({ scheduleRef: "schedule_mismatch" }), { definitionHash: "f".repeat(64) }),
    ];
    const recordTick = vi.fn(async () => true);
    const executor = { execute: vi.fn(async (request: { trigger: { scheduleRef: string } }) => {
      if (request.trigger.scheduleRef === "schedule_broken") throw new Error("redacted");
      return {
        status: "failed" as const, runRef: "run_aaaaaaaaaaaaaaaaaaaa",
        version: "decision-room-executor/1.0.0" as const,
        idempotencyKey: `idempotency_${"b".repeat(32)}`, attempt: 1, retryable: true,
        actionAuthority: "none" as const, notificationChannel: "in_app_inbox" as const,
      };
    }) };
    const result = await runDecisionRoomScheduleWorker(
      { now: "2026-08-07T12:00:00Z", batchSize: 3 },
      { listDue: async () => candidates, recordTick }, executor as never,
    );
    expect(result.items.map((entry) => entry.outcome)).toEqual([
      "failed", "isolated_error", "definition_mismatch",
    ]);
    expect(recordTick).not.toHaveBeenCalled();
  });

  it("advances a deterministically stale skip and suppresses duplicate concurrent execution", async () => {
    const skipped = due(schedule({ scheduleRef: "schedule_skip", catchUpPolicy: "skip" }));
    const skippedTick = vi.fn(async () => true);
    const skippedResult = await runDecisionRoomScheduleWorker(
      { now: "2026-08-07T12:00:00Z" },
      { listDue: async () => [skipped], recordTick: skippedTick },
      { execute: vi.fn() as never },
    );
    expect(skippedResult.items[0]).toMatchObject({ outcome: "stale_skipped", tickAdvanced: true });
    expect(skippedTick).toHaveBeenCalledOnce();

    const candidate = due();
    let advanced = false;
    const registry = {
      listDue: async () => [candidate],
      recordTick: vi.fn(async () => {
        if (advanced) return false;
        advanced = true;
        return true;
      }),
    };
    const analysis = { execute: vi.fn(async () => ({ analysisRef: "analysis_safe", evidenceRefs: [], summaryCode: "ready" })) };
    const inbox = new InMemoryDecisionRoomInbox();
    const executor = new DecisionRoomExecutor(
      new InMemoryDecisionRoomRunStore(), analysis, inbox,
      () => new Date("2026-08-07T12:00:00Z"),
    );
    const concurrent = await Promise.all([
      runDecisionRoomScheduleWorker({ now: "2026-08-07T12:00:00Z" }, registry, executor),
      runDecisionRoomScheduleWorker({ now: "2026-08-07T12:00:00Z" }, registry, executor),
    ]);
    expect(analysis.execute).toHaveBeenCalledOnce();
    expect(inbox.list()).toHaveLength(1);
    expect(concurrent.reduce((sum, value) => sum + value.tickAdvancedCount, 0)).toBe(1);
  });

  it("enforces a bounded batch and rejects an oversized registry response", async () => {
    await expect(runDecisionRoomScheduleWorker(
      { now: "2026-08-07T12:00:00Z", batchSize: 101 },
      { listDue: vi.fn(), recordTick: vi.fn() }, { execute: vi.fn() as never },
    )).rejects.toMatchObject({ code: "invalid_input" });
    await expect(runDecisionRoomScheduleWorker(
      { now: "2026-08-07T12:00:00Z", batchSize: 1 },
      { listDue: async () => [due(), due(schedule({ scheduleRef: "schedule_second" }))], recordTick: vi.fn() },
      { execute: vi.fn() as never },
    )).rejects.toMatchObject({ code: "registry_failure" });
  });
});
