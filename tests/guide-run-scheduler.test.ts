import { describe, expect, it } from "vitest";

import { GuideRunSchedulerError, planManualGuideRun, planScheduledGuideRuns } from "@/domain/guides/guide-run-scheduler";

const revisionHash = "a".repeat(64);
const guide = Object.freeze({ guideRef: "guide_main", revisionHash,
  schedule: { frequency: "daily" as const, timezone: "Europe/Istanbul", localTime: "09:00" }, active: true });

describe("Guide run scheduler planner", () => {
  it("records older due slots as missed and claims only the newest due slot", () => {
    const plan = planScheduledGuideRuns({ guide,
      head: { activatedAt: "2026-08-13T06:00:00.000Z", lastScheduledFor: "2026-08-14T06:00:00.000Z" },
      now: "2026-08-17T12:00:00.000Z" });
    expect(plan.missed.map((slot) => slot.scheduledFor)).toEqual([
      "2026-08-15T06:00:00.000Z", "2026-08-16T06:00:00.000Z",
    ]);
    expect(plan.claim).toMatchObject({ scheduledFor: "2026-08-17T06:00:00.000Z", state: "due" });
    expect(plan.cursor).toEqual({ previousScheduledFor: "2026-08-14T06:00:00.000Z", advanceTo: "2026-08-17T06:00:00.000Z" });
    expect(plan.nextScheduledAt).toBe("2026-08-18T06:00:00.000Z");
    expect(new Set([...plan.missed.map((slot) => slot.idempotencyKey), plan.claim!.idempotencyKey]).size).toBe(3);
  });

  it("does not manufacture a run before the first due slot", () => {
    const plan = planScheduledGuideRuns({ guide,
      head: { activatedAt: "2026-08-17T05:00:00.000Z", lastScheduledFor: null },
      now: "2026-08-17T05:30:00.000Z" });
    expect(plan).toMatchObject({ missed: [], claim: null,
      cursor: { previousScheduledFor: null, advanceTo: null }, nextScheduledAt: "2026-08-17T06:00:00.000Z" });
  });

  it("bounds downtime expansion instead of creating a replay storm", () => {
    expect(() => planScheduledGuideRuns({ guide,
      head: { activatedAt: "2026-08-01T06:00:00.000Z", lastScheduledFor: "2026-08-01T06:00:00.000Z" },
      now: "2026-08-17T12:00:00.000Z", maximumSlots: 3 }))
      .toThrowError(expect.objectContaining<Partial<GuideRunSchedulerError>>({ code: "backlog_exceeded" }));
  });

  it("keeps manual runs separate and never advances the scheduled cursor", () => {
    const manual = planManualGuideRun({ guideRef: "guide_main", guideRevisionHash: revisionHash,
      requestRef: "request_refresh_one", requestedAt: "2026-08-17T12:00:00Z" });
    expect(manual).toMatchObject({ state: "due", scheduledCursorAdvance: null, requestRef: "request_refresh_one" });
    expect(manual.idempotencyKey).toMatch(/^guide_manual_[a-f0-9]{64}$/);
  });

  it("rejects inactive guides and invalid schedule heads", () => {
    expect(() => planScheduledGuideRuns({ guide: { ...guide, active: false },
      head: { activatedAt: "2026-08-16T06:00:00.000Z", lastScheduledFor: null }, now: "2026-08-17T12:00:00.000Z" }))
      .toThrowError(expect.objectContaining({ code: "inactive_guide" }));
    expect(() => planScheduledGuideRuns({ guide,
      head: { activatedAt: "2026-08-17T06:00:00.000Z", lastScheduledFor: "2026-08-16T06:00:00.000Z" },
      now: "2026-08-17T12:00:00.000Z" })).toThrowError(expect.objectContaining({ code: "invalid_input" }));
  });
});
