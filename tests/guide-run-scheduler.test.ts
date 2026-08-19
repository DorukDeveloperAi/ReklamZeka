import { describe, expect, it } from "vitest";

import { planManualGuideRun, planScheduledGuideRuns } from "@/domain/guides/guide-run-scheduler";

const revisionHash = "a".repeat(64);
const guide = Object.freeze({ guideRef: "guide_main", revisionHash,
  schedule: { frequency: "daily" as const, timezone: "Europe/Istanbul", localTime: "09:00" }, active: true });

describe("Guide run scheduler planner", () => {
  it("records older due slots as missed and claims only the newest due slot", () => {
    const plan = planScheduledGuideRuns({ guide,
      head: { activatedAt: "2026-08-13T06:00:00.000Z", lastScheduledFor: "2026-08-14T06:00:00.000Z" },
      now: "2026-08-17T12:00:00.000Z" });
    expect(plan.missed).toMatchObject({ state: "missed", firstScheduledFor: "2026-08-15T06:00:00.000Z",
      lastScheduledFor: "2026-08-16T06:00:00.000Z", count: 2, idempotencyKey: expect.stringMatching(/^guide_missed_range_[a-f0-9]{64}$/) });
    expect(plan.claim).toMatchObject({ scheduledFor: "2026-08-17T06:00:00.000Z", state: "due" });
    expect(plan.cursor).toEqual({ previousScheduledFor: "2026-08-14T06:00:00.000Z", advanceTo: "2026-08-17T06:00:00.000Z" });
    expect(plan.nextScheduledAt).toBe("2026-08-18T06:00:00.000Z");
    expect(plan.claim!.idempotencyKey).toMatch(/^guide_slot_[a-f0-9]{64}$/);
  });

  it("does not manufacture a run before the first due slot", () => {
    const plan = planScheduledGuideRuns({ guide,
      head: { activatedAt: "2026-08-17T05:00:00.000Z", lastScheduledFor: null },
      now: "2026-08-17T05:30:00.000Z" });
    expect(plan).toMatchObject({ missed: null, claim: null,
      cursor: { previousScheduledFor: null, advanceTo: null }, nextScheduledAt: "2026-08-17T06:00:00.000Z" });
  });

  it("records a constant-size missed-range receipt after long downtime", () => {
    const plan = planScheduledGuideRuns({ guide,
      head: { activatedAt: "2026-08-01T06:00:00.000Z", lastScheduledFor: "2026-08-01T06:00:00.000Z" },
      now: "2026-08-17T12:00:00.000Z", maximumSlots: 3 });
    expect(plan.missed).toMatchObject({ state: "missed", count: 15,
      firstScheduledFor: "2026-08-02T06:00:00.000Z", lastScheduledFor: "2026-08-16T06:00:00.000Z" });
    expect(plan.claim).toMatchObject({ scheduledFor: "2026-08-17T06:00:00.000Z" });
  });

  it("keeps an identical missed range idempotent and changes its receipt for a different range", () => {
    const base = { guide, head: { activatedAt: "2026-08-13T06:00:00.000Z", lastScheduledFor: "2026-08-14T06:00:00.000Z" }, now: "2026-08-17T12:00:00.000Z" } as const;
    const first = planScheduledGuideRuns(base);
    const retry = planScheduledGuideRuns({ ...base, guide: { ...base.guide }, head: { ...base.head } });
    const different = planScheduledGuideRuns({ ...base, now: "2026-08-18T12:00:00.000Z" });
    expect(first.missed!.idempotencyKey).toBe(retry.missed!.idempotencyKey);
    expect(first.missed!.idempotencyKey).not.toBe(different.missed!.idempotencyKey);
  });

  it("keeps New York local schedule boundaries correct across daylight-saving time", () => {
    const newYorkGuide = { ...guide, schedule: { frequency: "daily" as const, timezone: "America/New_York", localTime: "09:00" } };
    const plan = planScheduledGuideRuns({ guide: newYorkGuide,
      head: { activatedAt: "2026-03-06T14:00:00.000Z", lastScheduledFor: "2026-03-06T14:00:00.000Z" },
      now: "2026-03-10T14:00:00.000Z" });
    expect(plan.missed).toMatchObject({ firstScheduledFor: "2026-03-07T14:00:00.000Z",
      lastScheduledFor: "2026-03-09T13:00:00.000Z", count: 3 });
    expect(plan.claim).toMatchObject({ scheduledFor: "2026-03-10T13:00:00.000Z" });
  });

  it("accepts the documented lower bound in UTC and New York without Date.UTC remapping", () => {
    const utc = planScheduledGuideRuns({ guide: { ...guide, schedule: { frequency: "daily", timezone: "UTC", localTime: "09:00" } },
      head: { activatedAt: "0102-01-01T09:00:00.000Z", lastScheduledFor: "0102-01-01T09:00:00.000Z" }, now: "0102-01-02T10:00:00.000Z" });
    const newYork = planScheduledGuideRuns({ guide: { ...guide, schedule: { frequency: "daily", timezone: "America/New_York", localTime: "09:00" } },
      head: { activatedAt: "0102-01-01T14:00:00.000Z", lastScheduledFor: "0102-01-01T14:00:00.000Z" }, now: "0102-01-02T15:00:00.000Z" });
    expect(utc.claim).toMatchObject({ scheduledFor: "0102-01-02T09:00:00.000Z" });
    // Historical New York used local mean time; the key regression is preserving year 0102, not imposing modern offsets.
    expect(newYork.claim).toMatchObject({ scheduledFor: "0102-01-02T13:57:00.000Z" });
  });

  it("rejects the adjacent unsafe calendar year below the documented 0102–9996 range", () => {
    expect(() => planScheduledGuideRuns({ guide,
      head: { activatedAt: "0101-01-01T00:00:00.000Z", lastScheduledFor: null }, now: "0102-01-01T00:00:00.000Z" }))
      .toThrowError(expect.objectContaining({ code: "invalid_input" }));
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
