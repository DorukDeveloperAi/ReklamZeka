import { nextGuideScheduledAt, validateGuideSchedule, type GuideSchedule } from "@/domain/guides/guide-revision";
import { manualGuideRunIdempotencyKey, scheduledGuideRunIdempotencyKey } from "@/domain/guides/guide-run";

export const GUIDE_RUN_SCHEDULER_VERSION = "guide-run-scheduler/1.0.0" as const;

export type GuideRunSchedulePlan = Readonly<{
  version: typeof GUIDE_RUN_SCHEDULER_VERSION;
  guideRef: string;
  guideRevisionHash: string;
  missed: readonly Readonly<{ scheduledFor: string; idempotencyKey: string; state: "missed" }> [];
  claim: Readonly<{ scheduledFor: string; idempotencyKey: string; state: "due" }> | null;
  cursor: Readonly<{ previousScheduledFor: string | null; advanceTo: string | null }>;
  nextScheduledAt: string;
  replayPolicy: "newest_due_only";
}>;

export class GuideRunSchedulerError extends Error {
  constructor(readonly code: "invalid_input" | "inactive_guide" | "backlog_exceeded") {
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
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) fail("invalid_input");
  return new Date(value).toISOString();
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
  const maximumSlots = input.maximumSlots ?? 100;
  if (!Number.isSafeInteger(maximumSlots) || maximumSlots < 1 || maximumSlots > 366) fail("invalid_input");
  const due: string[] = [];
  let cursor = lastScheduledFor ?? activatedAt;
  let next = nextGuideScheduledAt(schedule, cursor);
  while (Date.parse(next) <= Date.parse(now)) {
    due.push(next);
    if (due.length > maximumSlots) fail("backlog_exceeded");
    cursor = next;
    next = nextGuideScheduledAt(schedule, cursor);
  }
  const newest = due.at(-1) ?? null;
  const missed = Object.freeze(due.slice(0, -1).map((scheduledFor) => Object.freeze({ scheduledFor,
    idempotencyKey: scheduledGuideRunIdempotencyKey(input.guide.revisionHash, scheduledFor), state: "missed" as const })));
  const claim = newest === null ? null : Object.freeze({ scheduledFor: newest,
    idempotencyKey: scheduledGuideRunIdempotencyKey(input.guide.revisionHash, newest), state: "due" as const });
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
