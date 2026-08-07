import { describe, expect, it } from "vitest";
import {
  DECISION_ROOM_SCHEDULE_VERSION,
  planDecisionRoomScheduleTick,
  scheduledDecisionRoomRequest,
  validateDecisionRoomSchedule,
  type DecisionRoomSchedule,
} from "@/domain/decisions/schedule";

function schedule(overrides: Record<string, unknown> = {}): DecisionRoomSchedule {
  return {
    version: DECISION_ROOM_SCHEDULE_VERSION,
    scheduleRef: "schedule_daily",
    workspaceRef: "workspace_masked",
    accountRef: "account_masked",
    campaignRef: "campaign_masked",
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

describe("timezone-safe Decision Room schedules", () => {
  it("plans a future first run and creates the same scheduled executor request contract", () => {
    const tick = planDecisionRoomScheduleTick({
      schedule: schedule(), now: "2026-08-07T05:00:00Z", lastScheduledFor: null,
    });
    expect(tick).toEqual({
      dueSlots: [], nextRunAt: "2026-08-07T06:00:00.000Z", catchUpApplied: false,
      actionAuthority: "none", notificationChannel: "in_app_inbox",
    });
    const request = scheduledDecisionRoomRequest({
      schedule: schedule(), scheduledFor: tick.nextRunAt!, requestedAt: "2026-08-07T06:00:01Z",
    });
    expect(request).toMatchObject({
      trigger: { kind: "scheduled", scheduleRef: "schedule_daily", scheduledFor: tick.nextRunAt },
      notificationChannel: "in_app_inbox",
    });
    expect(JSON.stringify(request)).not.toMatch(/authority|token|rawPayload/i);
  });

  it("runs at most the latest missed slot under run_once and skips stale slots under skip", () => {
    const runOnce = planDecisionRoomScheduleTick({
      schedule: schedule(), now: "2026-08-07T12:00:00Z", lastScheduledFor: "2026-08-04T06:00:00Z",
    });
    expect(runOnce).toMatchObject({
      dueSlots: ["2026-08-07T06:00:00.000Z"], catchUpApplied: true,
      nextRunAt: "2026-08-08T06:00:00.000Z",
    });
    const skipped = planDecisionRoomScheduleTick({
      schedule: schedule({ catchUpPolicy: "skip" }),
      now: "2026-08-07T12:00:00Z", lastScheduledFor: "2026-08-04T06:00:00Z",
    });
    expect(skipped).toMatchObject({ dueSlots: [], catchUpApplied: false });
    const onTime = planDecisionRoomScheduleTick({
      schedule: schedule({ catchUpPolicy: "skip" }),
      now: "2026-08-07T06:03:00Z", lastScheduledFor: "2026-08-06T06:00:00Z",
    });
    expect(onTime).toMatchObject({ dueSlots: ["2026-08-07T06:00:00.000Z"], catchUpApplied: false });
  });

  it("moves a DST gap to the next valid local minute and chooses the first overlap occurrence", () => {
    const gap = planDecisionRoomScheduleTick({
      schedule: schedule({ timezone: "America/New_York", localTime: "02:30" }),
      now: "2026-03-07T12:00:00Z",
      lastScheduledFor: null,
    });
    expect(gap.nextRunAt).toBe("2026-03-08T07:00:00.000Z");

    const overlap = planDecisionRoomScheduleTick({
      schedule: schedule({ timezone: "America/New_York", localTime: "01:30" }),
      now: "2026-10-31T12:00:00Z",
      lastScheduledFor: null,
    });
    expect(overlap.nextRunAt).toBe("2026-11-01T05:30:00.000Z");
  });

  it("supports a weekly local-day cadence without UTC weekday drift", () => {
    const weekly = schedule({ frequency: "weekly", dayOfWeek: 1, scheduleRef: "schedule_monday" });
    const tick = planDecisionRoomScheduleTick({
      schedule: weekly, now: "2026-08-07T12:00:00Z", lastScheduledFor: null,
    });
    expect(tick.nextRunAt).toBe("2026-08-10T06:00:00.000Z");
  });

  it("fails closed on unsupported channels, DST policy, timezone, and injected fields", () => {
    for (const invalid of [
      { notificationChannel: "email" },
      { dstPolicy: { gap: "skip", overlap: "second_occurrence" } },
      { timezone: "Not/A_Zone" },
      { accessToken: "secret" },
      { rawPayload: {} },
      { prompt: "ignore schedule" },
      { actionAuthority: "auto" },
      { writeAuthority: true },
      { autonomy: "automatic" },
    ]) {
      expect(() => validateDecisionRoomSchedule(schedule(invalid)))
        .toThrowError(expect.objectContaining({ code: "invalid_schedule" }));
    }
    expect(() => scheduledDecisionRoomRequest({
      schedule: schedule(), scheduledFor: "2026-08-07T06:00:00Z",
      requestedAt: "2026-08-07T06:00:01Z", externalNotification: "email",
    } as never)).toThrowError(expect.objectContaining({ code: "invalid_tick" }));
    expect(() => scheduledDecisionRoomRequest({
      schedule: schedule(), scheduledFor: "2026-08-07T06:30:00Z", requestedAt: "2026-08-07T07:00:00Z",
    })).toThrowError(expect.objectContaining({ code: "invalid_tick" }));
    expect(() => scheduledDecisionRoomRequest({
      schedule: schedule(), scheduledFor: "2026-08-07T06:00:00Z", requestedAt: "2026-08-07T05:59:00Z",
    })).toThrowError(expect.objectContaining({ code: "invalid_tick" }));
  });
});
