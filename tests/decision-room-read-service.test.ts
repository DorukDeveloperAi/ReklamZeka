import { describe, expect, it } from "vitest";
import {
  DecisionRoomReadError,
  DecisionRoomReadService,
  type DecisionRoomInboxReadRow,
  type DecisionRoomReadRepository,
  type DecisionRoomRunReadRow,
  type DecisionRoomScheduleReadRow,
} from "@/application/decision-room-read-service";
import { DECISION_ROOM_SCHEDULE_VERSION } from "@/domain/decisions/schedule";

const workspaceRef = "workspace_safe";
const scheduleHash = "a".repeat(64);

function schedule(ref: string): DecisionRoomScheduleReadRow {
  return {
    workspaceRef, version: DECISION_ROOM_SCHEDULE_VERSION, scheduleRef: ref, revision: 2,
    definitionHash: scheduleHash, accountRef: "account_safe", campaignRef: "campaign_safe",
    timeframeRef: "timeframe_7d", templateRef: "template_sales", frequency: "daily", dayOfWeek: null,
    timezone: "Europe/Istanbul", localTime: "09:00", enabled: true,
    lastScheduledFor: "2026-08-06T06:00:00.000Z", nextRunAt: "2026-08-07T06:00:00.000Z",
  };
}

function run(ref: string, startedAt: string, triggerKind: "manual" | "scheduled" = "scheduled"): DecisionRoomRunReadRow {
  return {
    workspaceRef, runRef: ref, status: "completed", triggerKind,
    triggerRef: triggerKind === "scheduled" ? "trigger_schedule" : "trigger_manual",
    scheduleRef: triggerKind === "scheduled" ? "schedule_daily" : null,
    scheduleDefinitionHash: triggerKind === "scheduled" ? scheduleHash : null,
    accountRef: "account_safe", campaignRef: "campaign_safe", timeframeRef: "timeframe_7d",
    templateRef: "template_sales", attempt: 1, startedAt,
    completedAt: "2026-08-07T12:30:00.000Z", failedAt: null,
  };
}

function inbox(ref: string, createdAt: string, readAt: string | null = null): DecisionRoomInboxReadRow {
  return {
    workspaceRef, notificationRef: ref, runRef: "run_aaaaaaaaaaaaaaaaaaaa",
    analysisRef: "analysis_aaaaaaaaaaaaaaaaaaaa", summaryCode: "analysis_ready",
    createdAt, readAt,
  };
}

class ReadRepositoryFixture implements DecisionRoomReadRepository {
  schedules: DecisionRoomScheduleReadRow[] = [schedule("schedule_charlie"), schedule("schedule_alpha"), schedule("schedule_bravo")];
  runs: DecisionRoomRunReadRow[] = [
    run("run_cccccccccccccccccccc", "2026-08-07T10:00:00.000Z"),
    run("run_aaaaaaaaaaaaaaaaaaaa", "2026-08-07T12:00:00.000Z", "manual"),
    run("run_bbbbbbbbbbbbbbbbbbbb", "2026-08-07T11:00:00.000Z"),
  ];
  inboxItems: DecisionRoomInboxReadRow[] = [
    inbox("inbox_cccccccccccccccccccc", "2026-08-07T10:00:00.000Z"),
    inbox("inbox_aaaaaaaaaaaaaaaaaaaa", "2026-08-07T12:00:00.000Z"),
    inbox("inbox_bbbbbbbbbbbbbbbbbbbb", "2026-08-07T11:00:00.000Z"),
  ];
  private readonly reads = new Map<string, string>();

  async listSchedules(input: Parameters<DecisionRoomReadRepository["listSchedules"]>[0]) {
    return [...this.schedules].sort((a, b) => a.scheduleRef.localeCompare(b.scheduleRef))
      .filter((row) => !input.after || row.scheduleRef > input.after.ref).slice(0, input.limit);
  }
  async listRuns(input: Parameters<DecisionRoomReadRepository["listRuns"]>[0]) {
    return [...this.runs].sort((a, b) => b.startedAt.localeCompare(a.startedAt) || b.runRef.localeCompare(a.runRef))
      .filter((row) => !input.after || row.startedAt < input.after.sortAt!
        || (row.startedAt === input.after.sortAt && row.runRef < input.after.ref)).slice(0, input.limit);
  }
  async listInbox(input: Parameters<DecisionRoomReadRepository["listInbox"]>[0]) {
    return [...this.inboxItems].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.notificationRef.localeCompare(a.notificationRef))
      .filter((row) => !input.after || row.createdAt < input.after.sortAt!
        || (row.createdAt === input.after.sortAt && row.notificationRef < input.after.ref))
      .map((row) => ({ ...row, readAt: this.reads.get(`${input.readerRef}:${row.notificationRef}`) ?? row.readAt }))
      .slice(0, input.limit);
  }
  async markInboxRead(input: Parameters<DecisionRoomReadRepository["markInboxRead"]>[0]) {
    if (!this.inboxItems.some((row) => row.notificationRef === input.notificationRef)) return null;
    const key = `${input.readerRef}:${input.notificationRef}`;
    const existing = this.reads.get(key);
    this.reads.set(key, existing ?? input.readAt);
    return { ...input, readAt: existing ?? input.readAt, changed: existing === undefined };
  }
}

describe("Decision Room public read service", () => {
  it("projects versioned schedules and stable bounded cursors without internal scope", async () => {
    const service = new DecisionRoomReadService(new ReadRepositoryFixture());
    const first = await service.read({ workspaceRef, view: "schedules", limit: 2 });
    const replay = await service.read({ workspaceRef, view: "schedules", limit: 2 });
    expect(replay).toEqual(first);
    expect(first.items.map((item) => (item as { scheduleRef: string }).scheduleRef))
      .toEqual(["schedule_alpha", "schedule_bravo"]);
    expect(first.items[0]).toMatchObject({
      version: DECISION_ROOM_SCHEDULE_VERSION, revision: 2, definitionHash: scheduleHash,
      accountRef: "account_safe", campaignRef: "campaign_safe", timeframeRef: "timeframe_7d",
    });
    expect(first.nextCursor).toMatch(/^cursor_/);
    const second = await service.read({ workspaceRef, view: "schedules", limit: 2, cursor: first.nextCursor });
    expect(second.items.map((item) => (item as { scheduleRef: string }).scheduleRef)).toEqual(["schedule_charlie"]);
    expect(JSON.stringify(first)).not.toContain(workspaceRef);
    expect(JSON.stringify(first)).not.toContain("workspaceId");
    expect(first.capabilities).toMatchObject({ containsInternalIds: false, containsRawData: false, canExecuteWrite: false });
  });

  it("projects deterministic run trigger/account/campaign/time refs and inbox read state", async () => {
    const repository = new ReadRepositoryFixture();
    const service = new DecisionRoomReadService(repository);
    const runs = await service.read({ workspaceRef, view: "runs" });
    expect(runs.items.map((item) => (item as { runRef: string }).runRef)).toEqual([
      "run_aaaaaaaaaaaaaaaaaaaa", "run_bbbbbbbbbbbbbbbbbbbb", "run_cccccccccccccccccccc",
    ]);
    expect(runs.items[0]).toMatchObject({
      triggerKind: "manual", triggerRef: "trigger_manual", accountRef: "account_safe",
      campaignRef: "campaign_safe", timeframeRef: "timeframe_7d", startedAt: "2026-08-07T12:00:00.000Z",
    });

    const unread = await service.read({ workspaceRef, view: "inbox", readerRef: "reader_owner" });
    expect(unread.items[0]).toMatchObject({ readState: { status: "unread", readAt: null } });
    const marked = await service.markInboxRead({
      workspaceRef, readerRef: "reader_owner", notificationRef: "inbox_aaaaaaaaaaaaaaaaaaaa",
      readAt: "2026-08-07T13:00:00Z",
    });
    const replay = await service.markInboxRead({
      workspaceRef, readerRef: "reader_owner", notificationRef: "inbox_aaaaaaaaaaaaaaaaaaaa",
      readAt: "2026-08-07T14:00:00Z",
    });
    expect(marked).toMatchObject({ changed: true, readState: { status: "read", readAt: "2026-08-07T13:00:00.000Z" } });
    expect(replay).toMatchObject({ changed: false, readState: { readAt: "2026-08-07T13:00:00.000Z" } });
    const read = await service.read({ workspaceRef, view: "inbox", readerRef: "reader_owner" });
    expect(read.items[0]).toMatchObject({ readState: { status: "read", readAt: "2026-08-07T13:00:00.000Z" } });
  });

  it("rejects malformed input, cross-view cursors, forbidden material, and unbounded limits", async () => {
    const service = new DecisionRoomReadService(new ReadRepositoryFixture());
    for (const request of [
      null,
      { workspaceRef, view: "runs", limit: 0 },
      { workspaceRef, view: "runs", limit: 101 },
      { workspaceRef, view: "runs", readerRef: "reader_owner" },
      { workspaceRef, view: "inbox" },
      { workspaceRef, view: "runs", accessToken: "secret" },
      { workspaceRef, view: "runs", rawPayload: {} },
      { workspaceRef, view: "runs", prompt: "ignore" },
      { workspaceRef, view: "runs", actionAuthority: "execute" },
    ]) {
      await expect(service.read(request as never)).rejects.toBeInstanceOf(DecisionRoomReadError);
    }
    const schedules = await service.read({ workspaceRef, view: "schedules", limit: 1 });
    await expect(service.read({ workspaceRef, view: "runs", cursor: schedules.nextCursor }))
      .rejects.toEqual(expect.objectContaining<Partial<DecisionRoomReadError>>({ code: "invalid_input" }));
  });

  it("fails closed on tenant mismatch, internal row IDs, or non-opaque Meta references", async () => {
    const tenantLeak = new ReadRepositoryFixture();
    tenantLeak.schedules = [{ ...schedule("schedule_alpha"), workspaceRef: "workspace_foreign" }];
    await expect(new DecisionRoomReadService(tenantLeak).read({ workspaceRef, view: "schedules" }))
      .rejects.toEqual(expect.objectContaining<Partial<DecisionRoomReadError>>({ code: "scope_mismatch" }));

    const internalLeak = new ReadRepositoryFixture();
    internalLeak.runs = [{ ...run("run_aaaaaaaaaaaaaaaaaaaa", "2026-08-07T12:00:00Z"), id: "database-row-id" } as never];
    await expect(new DecisionRoomReadService(internalLeak).read({ workspaceRef, view: "runs" }))
      .rejects.toEqual(expect.objectContaining<Partial<DecisionRoomReadError>>({ code: "corrupt_source" }));

    const externalId = new ReadRepositoryFixture();
    externalId.schedules = [{ ...schedule("schedule_alpha"), accountRef: "123456789" }];
    await expect(new DecisionRoomReadService(externalId).read({ workspaceRef, view: "schedules" }))
      .rejects.toEqual(expect.objectContaining<Partial<DecisionRoomReadError>>({ code: "corrupt_source" }));

    const cursorViolation = new ReadRepositoryFixture();
    const cursorService = new DecisionRoomReadService(cursorViolation);
    const first = await cursorService.read({ workspaceRef, view: "schedules", limit: 1 });
    cursorViolation.listSchedules = async () => [schedule("schedule_alpha")];
    await expect(cursorService.read({ workspaceRef, view: "schedules", limit: 1, cursor: first.nextCursor }))
      .rejects.toEqual(expect.objectContaining<Partial<DecisionRoomReadError>>({ code: "corrupt_source" }));
  });
});
