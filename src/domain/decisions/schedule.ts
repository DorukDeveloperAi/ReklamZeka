import {
  DECISION_ROOM_EXECUTOR_VERSION,
  validateDecisionRoomRequest,
  type DecisionRoomRequest,
} from "@/domain/decisions/executor";

export const DECISION_ROOM_SCHEDULE_VERSION = "decision-room-schedule/1.0.0" as const;

type ScheduleBase = Readonly<{
  version: typeof DECISION_ROOM_SCHEDULE_VERSION;
  scheduleRef: string;
  workspaceRef: string;
  accountRef: string;
  campaignRef: string;
  timeframeRef: string;
  templateRef: string;
  timezone: string;
  localTime: string;
  enabled: boolean;
  catchUpPolicy: "skip" | "run_once";
  tickGraceMinutes: number;
  dstPolicy: Readonly<{ gap: "next_valid"; overlap: "first_occurrence" }>;
  notificationChannel: "in_app_inbox";
}>;

export type DecisionRoomSchedule =
  | (ScheduleBase & Readonly<{ frequency: "daily" }>)
  | (ScheduleBase & Readonly<{ frequency: "weekly"; dayOfWeek: number }>);

export type ScheduleTickPlan = Readonly<{
  dueSlots: readonly string[];
  nextRunAt: string | null;
  catchUpApplied: boolean;
  actionAuthority: "none";
  notificationChannel: "in_app_inbox";
}>;

export class DecisionRoomScheduleError extends Error {
  constructor(readonly code: "invalid_schedule" | "invalid_tick" | "unresolvable_local_time") {
    super("Decision Room zamanlaması güvenli biçimde çözümlenemedi");
    this.name = "DecisionRoomScheduleError";
  }
}

type LocalParts = Readonly<{ year: number; month: number; day: number; hour: number; minute: number }>;
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timezone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timezone);
  if (cached) return cached;
  try {
    const created = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    created.format(new Date(0));
    formatterCache.set(timezone, created);
    return created;
  } catch {
    throw new DecisionRoomScheduleError("invalid_schedule");
  }
}

function localParts(instant: Date, timezone: string): LocalParts {
  const values = Object.fromEntries(formatter(timezone).formatToParts(instant)
    .filter((part) => part.type !== "literal")
    .map((part) => [part.type, Number(part.value)]));
  if (![values.year, values.month, values.day, values.hour, values.minute].every(Number.isInteger)) {
    throw new DecisionRoomScheduleError("unresolvable_local_time");
  }
  return values as LocalParts;
}

function exactKeys(value: unknown, allowed: readonly string[], code: "invalid_schedule" | "invalid_tick"): void {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((key) => !allowed.includes(key))) throw new DecisionRoomScheduleError(code);
}

function required(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new DecisionRoomScheduleError("invalid_schedule");
  return value.trim();
}

function instant(value: unknown): Date {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new DecisionRoomScheduleError("invalid_tick");
  return new Date(value);
}

function localDate(parts: LocalParts): string {
  return `${parts.year.toString().padStart(4, "0")}-${parts.month.toString().padStart(2, "0")}-${parts.day.toString().padStart(2, "0")}`;
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return next.toISOString().slice(0, 10);
}

function dayOfWeek(date: string): number {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

function resolveLocal(date: string, localTime: string, timezone: string): Date {
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const [hour, minute] = localTime.split(":").map(Number) as [number, number];
  const approximate = Date.UTC(year, month - 1, day, hour, minute);
  const exact: number[] = [];
  const nextValid: { instant: number; localMinute: number }[] = [];
  for (let candidate = approximate - 18 * 3_600_000; candidate <= approximate + 18 * 3_600_000; candidate += 60_000) {
    const parts = localParts(new Date(candidate), timezone);
    if (localDate(parts) !== date) continue;
    const candidateMinute = parts.hour * 60 + parts.minute;
    if (candidateMinute === hour * 60 + minute) exact.push(candidate);
    else if (candidateMinute > hour * 60 + minute) nextValid.push({ instant: candidate, localMinute: candidateMinute });
  }
  if (exact.length > 0) return new Date(Math.min(...exact));
  nextValid.sort((left, right) => left.localMinute - right.localMinute || left.instant - right.instant);
  if (nextValid[0]) return new Date(nextValid[0].instant);
  throw new DecisionRoomScheduleError("unresolvable_local_time");
}

export function validateDecisionRoomSchedule(schedule: DecisionRoomSchedule): DecisionRoomSchedule {
  exactKeys(schedule, schedule?.frequency === "weekly"
    ? [
      "version", "scheduleRef", "workspaceRef", "accountRef", "campaignRef", "timeframeRef", "templateRef",
      "timezone", "localTime", "enabled", "catchUpPolicy", "tickGraceMinutes", "dstPolicy",
      "notificationChannel", "frequency", "dayOfWeek",
    ]
    : [
      "version", "scheduleRef", "workspaceRef", "accountRef", "campaignRef", "timeframeRef", "templateRef",
      "timezone", "localTime", "enabled", "catchUpPolicy", "tickGraceMinutes", "dstPolicy",
      "notificationChannel", "frequency",
    ], "invalid_schedule");
  exactKeys(schedule.dstPolicy, ["gap", "overlap"], "invalid_schedule");
  if (schedule.version !== DECISION_ROOM_SCHEDULE_VERSION
    || !(["daily", "weekly"] as const).includes(schedule.frequency)
    || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(schedule.localTime)
    || typeof schedule.enabled !== "boolean"
    || !(["skip", "run_once"] as const).includes(schedule.catchUpPolicy)
    || !Number.isInteger(schedule.tickGraceMinutes) || schedule.tickGraceMinutes < 0 || schedule.tickGraceMinutes > 60
    || schedule.dstPolicy.gap !== "next_valid" || schedule.dstPolicy.overlap !== "first_occurrence"
    || schedule.notificationChannel !== "in_app_inbox"
    || (schedule.frequency === "weekly" && (!Number.isInteger(schedule.dayOfWeek) || schedule.dayOfWeek < 0 || schedule.dayOfWeek > 6))) {
    throw new DecisionRoomScheduleError("invalid_schedule");
  }
  formatter(schedule.timezone);
  const base = {
    version: DECISION_ROOM_SCHEDULE_VERSION,
    scheduleRef: required(schedule.scheduleRef),
    workspaceRef: required(schedule.workspaceRef),
    accountRef: required(schedule.accountRef),
    campaignRef: required(schedule.campaignRef),
    timeframeRef: required(schedule.timeframeRef),
    templateRef: required(schedule.templateRef),
    timezone: required(schedule.timezone),
    localTime: schedule.localTime,
    enabled: schedule.enabled,
    catchUpPolicy: schedule.catchUpPolicy,
    tickGraceMinutes: schedule.tickGraceMinutes,
    dstPolicy: Object.freeze({ gap: "next_valid" as const, overlap: "first_occurrence" as const }),
    notificationChannel: "in_app_inbox" as const,
  };
  return schedule.frequency === "daily"
    ? Object.freeze({ ...base, frequency: "daily" })
    : Object.freeze({ ...base, frequency: "weekly", dayOfWeek: schedule.dayOfWeek });
}

function applies(schedule: DecisionRoomSchedule, date: string): boolean {
  return schedule.frequency === "daily" || dayOfWeek(date) === schedule.dayOfWeek;
}

function nextOccurrence(schedule: DecisionRoomSchedule, after: Date): Date {
  const startDate = localDate(localParts(after, schedule.timezone));
  for (let offset = 0; offset <= 8; offset += 1) {
    const date = addDays(startDate, offset);
    if (!applies(schedule, date)) continue;
    const candidate = resolveLocal(date, schedule.localTime, schedule.timezone);
    if (candidate.getTime() > after.getTime()) return candidate;
  }
  throw new DecisionRoomScheduleError("unresolvable_local_time");
}

function previousOccurrence(schedule: DecisionRoomSchedule, atOrBefore: Date): Date {
  const startDate = localDate(localParts(atOrBefore, schedule.timezone));
  for (let offset = 0; offset >= -8; offset -= 1) {
    const date = addDays(startDate, offset);
    if (!applies(schedule, date)) continue;
    const candidate = resolveLocal(date, schedule.localTime, schedule.timezone);
    if (candidate.getTime() <= atOrBefore.getTime()) return candidate;
  }
  throw new DecisionRoomScheduleError("unresolvable_local_time");
}

export function planDecisionRoomScheduleTick(input: Readonly<{
  schedule: DecisionRoomSchedule;
  now: string;
  lastScheduledFor: string | null;
}>): ScheduleTickPlan {
  exactKeys(input, ["schedule", "now", "lastScheduledFor"], "invalid_tick");
  const schedule = validateDecisionRoomSchedule(input.schedule);
  const now = instant(input.now);
  if (!schedule.enabled) return Object.freeze({
    dueSlots: Object.freeze([]), nextRunAt: null, catchUpApplied: false,
    actionAuthority: "none", notificationChannel: "in_app_inbox",
  });
  if (input.lastScheduledFor === null) return Object.freeze({
    dueSlots: Object.freeze([]), nextRunAt: nextOccurrence(schedule, now).toISOString(), catchUpApplied: false,
    actionAuthority: "none", notificationChannel: "in_app_inbox",
  });
  const last = instant(input.lastScheduledFor);
  if (last.getTime() > now.getTime()) throw new DecisionRoomScheduleError("invalid_tick");
  const latest = previousOccurrence(schedule, now);
  const missed = latest.getTime() > last.getTime();
  const withinGrace = now.getTime() - latest.getTime() <= schedule.tickGraceMinutes * 60_000;
  const shouldRun = missed && (schedule.catchUpPolicy === "run_once" || withinGrace);
  return Object.freeze({
    dueSlots: Object.freeze(shouldRun ? [latest.toISOString()] : []),
    nextRunAt: nextOccurrence(schedule, now).toISOString(),
    catchUpApplied: shouldRun && !withinGrace,
    actionAuthority: "none",
    notificationChannel: "in_app_inbox",
  });
}

export function scheduledDecisionRoomRequest(input: Readonly<{
  schedule: DecisionRoomSchedule;
  scheduledFor: string;
  requestedAt: string;
}>): DecisionRoomRequest {
  exactKeys(input, ["schedule", "scheduledFor", "requestedAt"], "invalid_tick");
  const schedule = validateDecisionRoomSchedule(input.schedule);
  const scheduledFor = instant(input.scheduledFor);
  const requestedAt = instant(input.requestedAt);
  if (scheduledFor.getTime() > requestedAt.getTime()
    || previousOccurrence(schedule, scheduledFor).getTime() !== scheduledFor.getTime()) {
    throw new DecisionRoomScheduleError("invalid_tick");
  }
  const request: DecisionRoomRequest = {
    version: DECISION_ROOM_EXECUTOR_VERSION,
    trigger: { kind: "scheduled", scheduleRef: schedule.scheduleRef, scheduledFor: scheduledFor.toISOString() },
    requestedAt: requestedAt.toISOString(),
    workspaceRef: schedule.workspaceRef,
    accountRef: schedule.accountRef,
    campaignRef: schedule.campaignRef,
    timeframeRef: schedule.timeframeRef,
    templateRef: schedule.templateRef,
    notificationChannel: "in_app_inbox",
  };
  return validateDecisionRoomRequest(request);
}
