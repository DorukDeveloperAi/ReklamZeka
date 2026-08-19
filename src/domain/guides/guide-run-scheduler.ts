import { createHash } from "node:crypto";

import { nextGuideScheduledAt, validateGuideSchedule, type GuideSchedule } from "@/domain/guides/guide-revision";
import { manualGuideRunIdempotencyKey, scheduledGuideRunIdempotencyKey } from "@/domain/guides/guide-run";

export const GUIDE_RUN_SCHEDULER_VERSION = "guide-run-scheduler/1.1.0" as const;

export type GuideRunSchedulePlan = Readonly<{
  version: typeof GUIDE_RUN_SCHEDULER_VERSION;
  guideRef: string;
  guideRevisionHash: string;
  /** One durable range receipt: scheduler downtime never expands into an unbounded run array. */
  missed: Readonly<{ state: "missed"; firstScheduledFor: string; lastScheduledFor: string; count: number; idempotencyKey: string }> | null;
  claim: Readonly<{ scheduledFor: string; idempotencyKey: string; state: "due" }> | null;
  cursor: Readonly<{ previousScheduledFor: string | null; advanceTo: string | null }>;
  nextScheduledAt: string;
  replayPolicy: "newest_due_only";
}>;

export class GuideRunSchedulerError extends Error {
  constructor(readonly code: "invalid_input" | "inactive_guide" | "count_overflow") {
    super(`Guide run scheduler rejected: ${code}`);
    this.name = "GuideRunSchedulerError";
  }
}

const REF = /^guide_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const REQUEST = /^request_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const HASH = /^[a-f0-9]{64}$/;
function fail(code: GuideRunSchedulerError["code"]): never { throw new GuideRunSchedulerError(code); }
function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length !== keys.length
    || Object.keys(value).some((key) => !keys.includes(key))) fail("invalid_input");
}
function instant(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT/.test(value) || !Number.isFinite(Date.parse(value))) fail("invalid_input");
  const normalized = new Date(value).toISOString();
  // A persisted schedule needs a full 366-day internal lookback/lookahead without Date.UTC's 0–99 remap.
  if (!/^\d{4}-/.test(normalized) || Number(normalized.slice(0, 4)) < 102 || Number(normalized.slice(0, 4)) > 9996) fail("invalid_input");
  return normalized;
}
function calendarInstant(value: string): string {
  if (!/^\d{4}-\d\d-\d\dT/.test(value) || !Number.isFinite(Date.parse(value))) fail("invalid_input");
  const normalized = new Date(value).toISOString();
  if (!/^\d{4}-/.test(normalized) || Number(normalized.slice(0, 4)) < 100 || Number(normalized.slice(0, 4)) > 9998) fail("invalid_input");
  return normalized;
}
function missedRangeIdempotencyKey(guideRevisionHash: string, firstScheduledFor: string, lastScheduledFor: string, count: number): string {
  return `guide_missed_range_${createHash("sha256").update(JSON.stringify({ guideRevisionHash, firstScheduledFor, lastScheduledFor, count })).digest("hex")}`;
}
function nextSafeGuideScheduledAt(schedule: GuideSchedule, after: string): string {
  return calendarInstant(nextGuideScheduledAt(schedule, after));
}
function localDate(value: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date(value));
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${String(values.year).padStart(4, "0")}-${values.month}-${values.day}`;
}
function utcDays(left: string, right: string): number {
  return Math.round((Date.parse(`${right}T00:00:00.000Z`) - Date.parse(`${left}T00:00:00.000Z`)) / 86_400_000);
}
function slotCount(schedule: GuideSchedule, first: string, last: string): number {
  const firstDate = localDate(first, schedule.timezone);
  const lastDate = localDate(last, schedule.timezone);
  const days = utcDays(firstDate, lastDate);
  const count = schedule.frequency === "daily" ? days + 1
    : schedule.frequency === "weekly" ? Math.floor(days / 7) + 1
      : schedule.frequency === "custom_days" ? Math.floor(days / schedule.intervalDays) + 1
        : (Number(lastDate.slice(0, 4)) * 12 + Number(lastDate.slice(5, 7))) - (Number(firstDate.slice(0, 4)) * 12 + Number(firstDate.slice(5, 7))) + 1;
  if (!Number.isSafeInteger(count) || count < 1) fail("count_overflow");
  return count;
}
function recentWindowDays(schedule: GuideSchedule): number {
  if (schedule.frequency === "daily") return 3;
  if (schedule.frequency === "weekly") return 10;
  if (schedule.frequency === "monthly") return 42;
  return schedule.intervalDays + 3;
}
/** Bounded search around now. Unlike a backlog walk, calls stay constant for arbitrarily old cursors. */
function newestDue(schedule: GuideSchedule, now: string): string | null {
  const probe = new Date(Math.max(Date.parse(now) - recentWindowDays(schedule) * 86_400_000,
    Date.parse("0100-01-01T00:00:00.000Z"))).toISOString();
  let candidate = nextSafeGuideScheduledAt(schedule, probe);
  let newest: string | null = null;
  for (let index = 0; index < 4 && Date.parse(candidate) <= Date.parse(now); index += 1) {
    newest = candidate;
    candidate = nextSafeGuideScheduledAt(schedule, candidate);
  }
  return newest;
}

export function planScheduledGuideRuns(input: Readonly<{
  guide: Readonly<{ guideRef: string; revisionHash: string; schedule: GuideSchedule; active: boolean }>;
  head: Readonly<{ activatedAt: string; lastScheduledFor: string | null }>;
  now: string;
  maximumSlots?: number;
}>): GuideRunSchedulePlan {
  exact(input, ["guide", "head", "now", ...(Object.hasOwn(input, "maximumSlots") ? ["maximumSlots"] : [])]);
  exact(input.guide, ["guideRef", "revisionHash", "schedule", "active"]);
  exact(input.head, ["activatedAt", "lastScheduledFor"]);
  if (!REF.test(input.guide.guideRef) || !HASH.test(input.guide.revisionHash)
    || typeof input.guide.active !== "boolean") fail("invalid_input");
  if (!input.guide.active) fail("inactive_guide");
  const schedule = validateGuideSchedule(input.guide.schedule);
  const now = instant(input.now);
  const activatedAt = instant(input.head.activatedAt);
  const lastScheduledFor = input.head.lastScheduledFor === null ? null : instant(input.head.lastScheduledFor);
  if (Date.parse(activatedAt) > Date.parse(now)
    || lastScheduledFor !== null && Date.parse(lastScheduledFor) < Date.parse(activatedAt)) fail("invalid_input");
  if (input.maximumSlots !== undefined && (!Number.isSafeInteger(input.maximumSlots) || input.maximumSlots < 1 || input.maximumSlots > 366)) fail("invalid_input");
  const after = lastScheduledFor ?? activatedAt;
  const first = nextSafeGuideScheduledAt(schedule, after);
  const newest = Date.parse(first) <= Date.parse(now) ? newestDue(schedule, now) : null;
  if (newest !== null && Date.parse(newest) < Date.parse(first)) fail("invalid_input");
  const totalDue = newest === null ? 0 : slotCount(schedule, first, newest);
  const previousNewest = newest === null || totalDue < 2 ? null : newestDue(schedule, new Date(Date.parse(newest) - 1).toISOString());
  const missed = totalDue > 1 && previousNewest !== null ? Object.freeze({ state: "missed" as const,
    firstScheduledFor: first, lastScheduledFor: previousNewest, count: totalDue - 1,
    idempotencyKey: missedRangeIdempotencyKey(input.guide.revisionHash, first, previousNewest, totalDue - 1) }) : null;
  const claim = newest === null ? null : Object.freeze({ scheduledFor: newest,
    idempotencyKey: scheduledGuideRunIdempotencyKey(input.guide.revisionHash, newest), state: "due" as const });
  const next = newest === null ? first : nextSafeGuideScheduledAt(schedule, newest);
  return Object.freeze({ version: GUIDE_RUN_SCHEDULER_VERSION, guideRef: input.guide.guideRef,
    guideRevisionHash: input.guide.revisionHash, missed, claim,
    cursor: Object.freeze({ previousScheduledFor: lastScheduledFor, advanceTo: newest ?? lastScheduledFor }),
    nextScheduledAt: next, replayPolicy: "newest_due_only" });
}

export function planManualGuideRun(input: Readonly<{
  guideRef: string;
  guideRevisionHash: string;
  requestRef: string;
  requestedAt: string;
}>): Readonly<{
  version: typeof GUIDE_RUN_SCHEDULER_VERSION;
  guideRef: string;
  guideRevisionHash: string;
  requestRef: string;
  requestedAt: string;
  idempotencyKey: string;
  state: "due";
  scheduledCursorAdvance: null;
}> {
  exact(input, ["guideRef", "guideRevisionHash", "requestRef", "requestedAt"]);
  if (!REF.test(input.guideRef) || !HASH.test(input.guideRevisionHash) || !REQUEST.test(input.requestRef)) fail("invalid_input");
  const requestedAt = instant(input.requestedAt);
  return Object.freeze({ version: GUIDE_RUN_SCHEDULER_VERSION, guideRef: input.guideRef,
    guideRevisionHash: input.guideRevisionHash, requestRef: input.requestRef, requestedAt,
    idempotencyKey: manualGuideRunIdempotencyKey(input.guideRevisionHash, input.requestRef),
    state: "due", scheduledCursorAdvance: null });
}
