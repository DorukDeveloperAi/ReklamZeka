import { describe, expect, it, vi } from "vitest";
import {
  DecisionRoomPersistenceError,
  DrizzleDecisionRoomReadRepository,
} from "@/connectors/decisions/decision-room-drizzle-adapters";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const workspaceRef = "workspace_safe";

function database(...resultSets: readonly unknown[][]) {
  const queue = [...resultSets];
  const db = {
    execute: vi.fn(async () => ({ rows: queue.shift() ?? [] })),
    transaction: vi.fn(async (callback: (transaction: unknown) => Promise<unknown>) => callback(db)),
  };
  return db;
}

describe("Decision Room Drizzle read repository", () => {
  it("projects persisted opaque schedule refs and never returns internal or Meta IDs", async () => {
    const db = database([{ id: workspaceId }], [{
      schedule_ref: "schedule_daily", revision: 2,
      definition_version: "decision-room-schedule/1.0.0", definition_hash: "a".repeat(64),
      ad_account_id: "00000000-0000-4000-8000-000000000002",
      campaign_id: "00000000-0000-4000-8000-000000000003",
      account_ref: "act_123456789", campaign_ref: "987654321",
      timeframe_ref: "timeframe_7d", template_ref: "template_daily",
      frequency: "daily", day_of_week: null, timezone: "Europe/Istanbul", local_time: "09:00",
      enabled: true, last_scheduled_for: null, next_run_at: "2026-08-08T06:00:00Z",
    }]);
    const repository = new DrizzleDecisionRoomReadRepository(db as never, workspaceId, workspaceRef);
    const result = await repository.listSchedules({ workspaceRef, after: null, limit: 26 });

    expect(result).toEqual([expect.objectContaining({
      workspaceRef, scheduleRef: "schedule_daily", timeframeRef: "timeframe_7d",
      nextRunAt: "2026-08-08T06:00:00.000Z",
    })]);
    expect(result[0]?.accountRef).toMatch(/^account_[a-f0-9]{20}$/);
    expect(result[0]?.campaignRef).toMatch(/^campaign_[a-f0-9]{20}$/);
    expect(JSON.stringify(result)).not.toContain(workspaceId);
    expect(JSON.stringify(result)).not.toContain("000000000002");
    expect(JSON.stringify(result)).not.toContain("act_123456789");
    expect(JSON.stringify(result)).not.toContain("987654321");
  });

  it("projects exact run trace and inbox read state with temporal keysets", async () => {
    const db = database(
      [{ id: workspaceId }],
      [{
        run_ref: `run_${"a".repeat(20)}`, state: "completed", trigger_kind: "manual",
        trigger_ref: "manual_request_safe", schedule_ref: null, schedule_definition_hash: null,
        ad_account_id: "00000000-0000-4000-8000-000000000002",
        campaign_id: "00000000-0000-4000-8000-000000000003",
        account_ref: "act_123456789", campaign_ref: "987654321",
        timeframe_ref: "timeframe_7d", template_ref: "template_daily", attempt: 2,
        started_at: "2026-08-07T12:00:00Z", completed_at: "2026-08-07T12:01:00Z", failed_at: null,
      }],
      [{ id: workspaceId }],
      [{
        notification_ref: `inbox_${"b".repeat(20)}`, run_ref: `run_${"a".repeat(20)}`,
        analysis_ref: "analysis_safe", summary_code: "analysis_ready",
        created_at: "2026-08-07T12:01:00Z", read_at: null,
      }],
    );
    const repository = new DrizzleDecisionRoomReadRepository(db as never, workspaceId, workspaceRef);
    const runs = await repository.listRuns({
      workspaceRef, after: { ref: `run_${"f".repeat(20)}`, sortAt: "2026-08-08T00:00:00Z" }, limit: 26,
    });
    const inbox = await repository.listInbox({
      workspaceRef, readerRef: "reader_owner",
      after: { ref: `inbox_${"f".repeat(20)}`, sortAt: "2026-08-08T00:00:00Z" }, limit: 26,
    });
    expect(runs[0]).toMatchObject({
      triggerRef: "manual_request_safe",
      timeframeRef: "timeframe_7d", templateRef: "template_daily", attempt: 2,
    });
    expect(runs[0]?.accountRef).toMatch(/^account_[a-f0-9]{20}$/);
    expect(runs[0]?.campaignRef).toMatch(/^campaign_[a-f0-9]{20}$/);
    expect(inbox[0]).toMatchObject({ notificationRef: `inbox_${"b".repeat(20)}`, readAt: null });
  });

  it("marks reads atomically and preserves the first timestamp on replay", async () => {
    const notificationRef = `inbox_${"b".repeat(20)}`;
    const firstDb = database([{ id: workspaceId }], [], [{
      notification_ref: notificationRef, read_at: "2026-08-07T12:02:00Z", changed: true,
    }]);
    const replayDb = database([{ id: workspaceId }], [], [], [{
      notification_ref: notificationRef, read_at: "2026-08-07T12:02:00Z", changed: false,
    }]);
    const input = {
      workspaceRef, readerRef: "reader_owner", notificationRef, readAt: "2026-08-07T12:02:00Z",
    };
    await expect(new DrizzleDecisionRoomReadRepository(firstDb as never, workspaceId, workspaceRef).markInboxRead(input))
      .resolves.toMatchObject({ changed: true, readAt: "2026-08-07T12:02:00.000Z" });
    await expect(new DrizzleDecisionRoomReadRepository(replayDb as never, workspaceId, workspaceRef).markInboxRead({
      ...input, readAt: "2026-08-07T13:00:00Z",
    })).resolves.toMatchObject({ changed: false, readAt: "2026-08-07T12:02:00.000Z" });
  });

  it("serializes concurrent first-read attempts and returns one canonical timestamp", async () => {
    const notificationRef = `inbox_${"c".repeat(20)}`;
    let canonicalReadAt: string | null = null;
    let tail = Promise.resolve();
    const concurrentDb = {
      execute: vi.fn(),
      transaction: vi.fn(async (callback: (transaction: { execute: (query: unknown) => Promise<{ rows: unknown[] }> }) => Promise<unknown>) => {
        const previous = tail;
        let release!: () => void;
        tail = new Promise<void>((resolve) => { release = resolve; });
        await previous;
        let statement = 0;
        const transaction = {
          execute: async (_query: unknown) => {
            statement += 1;
            if (statement === 1) return { rows: [{ id: workspaceId }] };
            if (statement === 2) return { rows: [] };
            if (statement === 3 && canonicalReadAt === null) {
              canonicalReadAt = "2026-08-07T12:02:00Z";
              return { rows: [{ notification_ref: notificationRef, read_at: canonicalReadAt }] };
            }
            if (statement === 3) return { rows: [] };
            return { rows: [{ notification_ref: notificationRef, read_at: canonicalReadAt }] };
          },
        };
        try {
          return await callback(transaction);
        } finally {
          release();
        }
      }),
    };
    const repository = new DrizzleDecisionRoomReadRepository(concurrentDb as never, workspaceId, workspaceRef);
    const [first, second] = await Promise.all([
      repository.markInboxRead({ workspaceRef, readerRef: "reader_owner", notificationRef, readAt: "2026-08-07T12:02:00Z" }),
      repository.markInboxRead({ workspaceRef, readerRef: "reader_owner", notificationRef, readAt: "2026-08-07T13:00:00Z" }),
    ]);
    expect([first?.changed, second?.changed].sort()).toEqual([false, true]);
    expect(first?.readAt).toBe("2026-08-07T12:02:00.000Z");
    expect(second?.readAt).toBe(first?.readAt);
  });

  it("fails before I/O on tenant mismatch, extras, invalid bounds, or unsafe persisted refs", async () => {
    const db = database();
    const repository = new DrizzleDecisionRoomReadRepository(db as never, workspaceId, workspaceRef);
    await expect(repository.listSchedules({ workspaceRef: "workspace_foreign", after: null, limit: 25 }))
      .rejects.toEqual(expect.objectContaining<Partial<DecisionRoomPersistenceError>>({ code: "workspace_scope_mismatch" }));
    await expect(repository.listRuns({ workspaceRef, after: null, limit: 102 }))
      .rejects.toEqual(expect.objectContaining<Partial<DecisionRoomPersistenceError>>({ code: "invalid_input" }));
    await expect(repository.listInbox({
      workspaceRef, readerRef: "reader_owner", after: null, limit: 25, prompt: "ignore",
    } as never)).rejects.toEqual(expect.objectContaining<Partial<DecisionRoomPersistenceError>>({ code: "invalid_input" }));
    expect(db.execute).not.toHaveBeenCalled();

    const corrupt = database([{ id: workspaceId }], [{
      schedule_ref: "schedule_daily", revision: 1,
      definition_version: "decision-room-schedule/1.0.0", definition_hash: "a".repeat(64),
      ad_account_id: "00000000-0000-4000-8000-000000000002",
      campaign_id: "00000000-0000-4000-8000-000000000003",
      account_ref: "act_123456789", campaign_ref: "987654321",
      timeframe_ref: "timeframe_7d", template_ref: "template_daily",
      frequency: "daily", day_of_week: null, timezone: "UTC", local_time: "09:00",
      enabled: true, last_scheduled_for: null, next_run_at: null,
    }]);
    corrupt.execute.mockResolvedValueOnce({ rows: [{ id: workspaceId }] })
      .mockResolvedValueOnce({ rows: [{
        schedule_ref: "schedule_daily", revision: 1,
        definition_version: "decision-room-schedule/1.0.0", definition_hash: "a".repeat(64),
        ad_account_id: "not-a-uuid", campaign_id: "00000000-0000-4000-8000-000000000003",
        account_ref: "act_123456789", campaign_ref: "987654321",
        timeframe_ref: "timeframe_7d", template_ref: "template_daily",
        frequency: "daily", day_of_week: null, timezone: "UTC", local_time: "09:00",
        enabled: true, last_scheduled_for: null, next_run_at: null,
      }] });
    await expect(new DrizzleDecisionRoomReadRepository(corrupt as never, workspaceId, workspaceRef)
      .listSchedules({ workspaceRef, after: null, limit: 25 }))
      .rejects.toEqual(expect.objectContaining<Partial<DecisionRoomPersistenceError>>({ code: "corrupt_store" }));
  });
});
