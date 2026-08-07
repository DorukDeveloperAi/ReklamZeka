import { Buffer } from "node:buffer";
import type { DECISION_ROOM_SCHEDULE_VERSION } from "@/domain/decisions/schedule";
import { inspectMetaPersistenceWrite } from "@/domain/meta/data-lifecycle";

export const DECISION_ROOM_READ_MODEL_VERSION = "decision-room-read-model/1.0.0" as const;

export type DecisionRoomScheduleReadRow = Readonly<{
  workspaceRef: string;
  version: typeof DECISION_ROOM_SCHEDULE_VERSION;
  scheduleRef: string;
  revision: number;
  definitionHash: string;
  accountRef: string;
  campaignRef: string;
  timeframeRef: string;
  templateRef: string;
  frequency: "daily" | "weekly";
  dayOfWeek: number | null;
  timezone: string;
  localTime: string;
  enabled: boolean;
  lastScheduledFor: string | null;
  nextRunAt: string | null;
}>;

export type DecisionRoomRunReadRow = Readonly<{
  workspaceRef: string;
  runRef: string;
  status: "running" | "completed" | "failed";
  triggerKind: "manual" | "scheduled";
  triggerRef: string;
  scheduleRef: string | null;
  scheduleDefinitionHash: string | null;
  accountRef: string;
  campaignRef: string;
  timeframeRef: string | null;
  templateRef: string | null;
  attempt: number;
  startedAt: string;
  completedAt: string | null;
  failedAt: string | null;
}>;

export type DecisionRoomInboxReadRow = Readonly<{
  workspaceRef: string;
  notificationRef: string;
  runRef: string;
  analysisRef: string;
  summaryCode: string;
  createdAt: string;
  readAt: string | null;
}>;

type After = Readonly<{ ref: string; sortAt: string | null }>;

export type DecisionRoomReadRepository = Readonly<{
  listSchedules(input: Readonly<{ workspaceRef: string; after: After | null; limit: number }>): Promise<readonly DecisionRoomScheduleReadRow[]>;
  listRuns(input: Readonly<{ workspaceRef: string; after: After | null; limit: number }>): Promise<readonly DecisionRoomRunReadRow[]>;
  listInbox(input: Readonly<{
    workspaceRef: string;
    readerRef: string;
    after: After | null;
    limit: number;
  }>): Promise<readonly DecisionRoomInboxReadRow[]>;
  markInboxRead(input: Readonly<{
    workspaceRef: string;
    readerRef: string;
    notificationRef: string;
    readAt: string;
  }>): Promise<Readonly<{
    workspaceRef: string;
    readerRef: string;
    notificationRef: string;
    readAt: string;
    changed: boolean;
  }> | null>;
}>;

export type DecisionRoomScheduleSummary = Omit<DecisionRoomScheduleReadRow, "workspaceRef">;
export type DecisionRoomRunStatus = Omit<DecisionRoomRunReadRow, "workspaceRef">;
export type DecisionRoomInboxItem = Omit<DecisionRoomInboxReadRow, "workspaceRef" | "readAt"> & Readonly<{
  readState: Readonly<{ status: "read" | "unread"; readAt: string | null }>;
}>;

export type DecisionRoomReadResult = Readonly<{
  contractVersion: typeof DECISION_ROOM_READ_MODEL_VERSION;
  view: "schedules" | "runs" | "inbox";
  items: readonly (DecisionRoomScheduleSummary | DecisionRoomRunStatus | DecisionRoomInboxItem)[];
  nextCursor: string | null;
  capabilities: Readonly<{
    modelAgnostic: true;
    containsInternalIds: false;
    containsRawData: false;
    canAuthorizeAction: false;
    canExecuteWrite: false;
  }>;
}>;

export type DecisionRoomReadStateResult = Readonly<{
  contractVersion: typeof DECISION_ROOM_READ_MODEL_VERSION;
  notificationRef: string;
  readState: Readonly<{ status: "read"; readAt: string }>;
  changed: boolean;
  capabilities: Readonly<{ canAuthorizeAction: false; canExecuteWrite: false }>;
}>;

export class DecisionRoomReadError extends Error {
  constructor(readonly code: "invalid_input" | "forbidden_material" | "scope_mismatch" | "corrupt_source" | "not_found") {
    super(`Decision Room read model oluşturulamadı: ${code}`);
    this.name = "DecisionRoomReadError";
  }
}

const OPAQUE_REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_-]{0,94}$/;
const HASH = /^[a-f0-9]{64}$/;
const MACHINE_CODE = /^[a-z0-9][a-z0-9_:-]{0,127}$/;
const CURSOR = /^cursor_[A-Za-z0-9_-]{8,512}$/;

function exactKeys(value: unknown, allowed: readonly string[], code: DecisionRoomReadError["code"]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((key) => !allowed.includes(key))) throw new DecisionRoomReadError(code);
}

function ref(value: unknown, code: DecisionRoomReadError["code"] = "invalid_input"): string {
  if (typeof value !== "string" || !OPAQUE_REF.test(value)
    || /(token|secret|prompt|raw[_-]?(payload|request|response|json))/i.test(value)) {
    throw new DecisionRoomReadError(code);
  }
  return value;
}

function instant(value: unknown, nullable = false, code: DecisionRoomReadError["code"] = "corrupt_source"): string | null {
  if (nullable && value === null) return null;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw new DecisionRoomReadError(code);
  return new Date(value).toISOString();
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function cursor(view: DecisionRoomReadResult["view"], after: After): string {
  return `cursor_${Buffer.from(JSON.stringify({ v: 1, view, ref: after.ref, sortAt: after.sortAt }), "utf8").toString("base64url")}`;
}

function parseCursor(value: unknown, view: DecisionRoomReadResult["view"]): After | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !CURSOR.test(value)) throw new DecisionRoomReadError("invalid_input");
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value.slice(7), "base64url").toString("utf8"));
  } catch {
    throw new DecisionRoomReadError("invalid_input");
  }
  exactKeys(parsed, ["v", "view", "ref", "sortAt"], "invalid_input");
  if (parsed.v !== 1 || parsed.view !== view) throw new DecisionRoomReadError("invalid_input");
  const parsedRef = ref(parsed.ref);
  const sortAt = view === "schedules"
    ? parsed.sortAt === null ? null : (() => { throw new DecisionRoomReadError("invalid_input"); })()
    : instant(parsed.sortAt, false, "invalid_input");
  return Object.freeze({ ref: parsedRef, sortAt });
}

function boundedLimit(value: unknown): number {
  if (value === undefined) return 25;
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 100) {
    throw new DecisionRoomReadError("invalid_input");
  }
  return value as number;
}

function assertSafe(value: unknown): void {
  if (!inspectMetaPersistenceWrite(value).compliant) throw new DecisionRoomReadError("forbidden_material");
}

function schedule(row: DecisionRoomScheduleReadRow, workspaceRef: string): DecisionRoomScheduleSummary {
  exactKeys(row, [
    "workspaceRef", "version", "scheduleRef", "revision", "definitionHash", "accountRef", "campaignRef",
    "timeframeRef", "templateRef", "frequency", "dayOfWeek", "timezone", "localTime", "enabled",
    "lastScheduledFor", "nextRunAt",
  ], "corrupt_source");
  if (row.workspaceRef !== workspaceRef) throw new DecisionRoomReadError("scope_mismatch");
  if (row.version !== "decision-room-schedule/1.0.0" || !Number.isSafeInteger(row.revision) || row.revision < 1
    || !HASH.test(row.definitionHash) || !["daily", "weekly"].includes(row.frequency)
    || (row.frequency === "daily" ? row.dayOfWeek !== null : !Number.isInteger(row.dayOfWeek) || row.dayOfWeek! < 0 || row.dayOfWeek! > 6)
    || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(row.localTime) || typeof row.enabled !== "boolean") {
    throw new DecisionRoomReadError("corrupt_source");
  }
  for (const value of [row.scheduleRef, row.accountRef, row.campaignRef, row.timeframeRef, row.templateRef]) ref(value, "corrupt_source");
  if (typeof row.timezone !== "string" || !row.timezone.trim()) throw new DecisionRoomReadError("corrupt_source");
  const { workspaceRef: _workspaceRef, ...projected } = row;
  return Object.freeze({ ...projected, lastScheduledFor: instant(row.lastScheduledFor, true), nextRunAt: instant(row.nextRunAt, true) });
}

function run(row: DecisionRoomRunReadRow, workspaceRef: string): DecisionRoomRunStatus {
  exactKeys(row, [
    "workspaceRef", "runRef", "status", "triggerKind", "triggerRef", "scheduleRef", "scheduleDefinitionHash",
    "accountRef", "campaignRef", "timeframeRef", "templateRef", "attempt", "startedAt", "completedAt", "failedAt",
  ], "corrupt_source");
  if (row.workspaceRef !== workspaceRef) throw new DecisionRoomReadError("scope_mismatch");
  for (const value of [row.runRef, row.triggerRef, row.accountRef, row.campaignRef]) ref(value, "corrupt_source");
  if (!["running", "completed", "failed"].includes(row.status)
    || !["manual", "scheduled"].includes(row.triggerKind)
    || !Number.isSafeInteger(row.attempt) || row.attempt < 1
    || (row.triggerKind === "manual"
      ? row.scheduleRef !== null || row.scheduleDefinitionHash !== null
      : !row.scheduleRef || !HASH.test(row.scheduleDefinitionHash ?? ""))) {
    throw new DecisionRoomReadError("corrupt_source");
  }
  if (row.scheduleRef) ref(row.scheduleRef, "corrupt_source");
  if (row.timeframeRef) ref(row.timeframeRef, "corrupt_source");
  if (row.templateRef) ref(row.templateRef, "corrupt_source");
  const completedAt = instant(row.completedAt, true);
  const failedAt = instant(row.failedAt, true);
  if ((row.status === "running" && (completedAt !== null || failedAt !== null))
    || (row.status === "completed" && (completedAt === null || failedAt !== null))
    || (row.status === "failed" && (failedAt === null || completedAt !== null))) {
    throw new DecisionRoomReadError("corrupt_source");
  }
  const { workspaceRef: _workspaceRef, ...projected } = row;
  return Object.freeze({
    ...projected,
    startedAt: instant(row.startedAt)!, completedAt, failedAt,
  });
}

function inbox(row: DecisionRoomInboxReadRow, workspaceRef: string): DecisionRoomInboxItem {
  exactKeys(row, ["workspaceRef", "notificationRef", "runRef", "analysisRef", "summaryCode", "createdAt", "readAt"], "corrupt_source");
  if (row.workspaceRef !== workspaceRef) throw new DecisionRoomReadError("scope_mismatch");
  for (const value of [row.notificationRef, row.runRef, row.analysisRef]) ref(value, "corrupt_source");
  if (!MACHINE_CODE.test(row.summaryCode) || /(token|secret|prompt|raw)/i.test(row.summaryCode)) {
    throw new DecisionRoomReadError("corrupt_source");
  }
  const readAt = instant(row.readAt, true);
  return Object.freeze({
    notificationRef: row.notificationRef, runRef: row.runRef, analysisRef: row.analysisRef,
    summaryCode: row.summaryCode, createdAt: instant(row.createdAt)!,
    readState: Object.freeze({ status: readAt === null ? "unread" as const : "read" as const, readAt }),
  });
}

const CAPABILITIES = Object.freeze({
  modelAgnostic: true as const, containsInternalIds: false as const, containsRawData: false as const,
  canAuthorizeAction: false as const, canExecuteWrite: false as const,
});

export class DecisionRoomReadService {
  constructor(private readonly repository: DecisionRoomReadRepository) {}

  async read(input: Readonly<{
    workspaceRef: string;
    view: "schedules" | "runs" | "inbox";
    readerRef?: string;
    limit?: number;
    cursor?: string | null;
  }>): Promise<DecisionRoomReadResult> {
    exactKeys(input, ["workspaceRef", "view", "readerRef", "limit", "cursor"], "invalid_input");
    assertSafe(input);
    const workspaceRef = ref(input.workspaceRef);
    if (!["schedules", "runs", "inbox"].includes(input.view)) throw new DecisionRoomReadError("invalid_input");
    const readerRef = input.view === "inbox" ? ref(input.readerRef) : null;
    if (input.view !== "inbox" && input.readerRef !== undefined) throw new DecisionRoomReadError("invalid_input");
    const limit = boundedLimit(input.limit);
    const after = parseCursor(input.cursor, input.view);
    let rows: readonly (DecisionRoomScheduleReadRow | DecisionRoomRunReadRow | DecisionRoomInboxReadRow)[];
    if (input.view === "schedules") rows = await this.repository.listSchedules({ workspaceRef, after, limit: limit + 1 });
    else if (input.view === "runs") rows = await this.repository.listRuns({ workspaceRef, after, limit: limit + 1 });
    else rows = await this.repository.listInbox({ workspaceRef, readerRef: readerRef!, after, limit: limit + 1 });
    if (!Array.isArray(rows) || rows.length > limit + 1) throw new DecisionRoomReadError("corrupt_source");
    assertSafe(rows);
    const projected = input.view === "schedules"
      ? (rows as readonly DecisionRoomScheduleReadRow[]).map((row) => schedule(row, workspaceRef))
        .sort((left, right) => compareText(left.scheduleRef, right.scheduleRef))
      : input.view === "runs"
        ? (rows as readonly DecisionRoomRunReadRow[]).map((row) => run(row, workspaceRef))
          .sort((left, right) => compareText(right.startedAt, left.startedAt) || compareText(right.runRef, left.runRef))
        : (rows as readonly DecisionRoomInboxReadRow[]).map((row) => inbox(row, workspaceRef))
          .sort((left, right) => compareText(right.createdAt, left.createdAt) || compareText(right.notificationRef, left.notificationRef));
    const itemRefs = projected.map((item) => (
      input.view === "schedules" ? (item as DecisionRoomScheduleSummary).scheduleRef
        : input.view === "runs" ? (item as DecisionRoomRunStatus).runRef
          : (item as DecisionRoomInboxItem).notificationRef
    ));
    if (new Set(itemRefs).size !== itemRefs.length) throw new DecisionRoomReadError("corrupt_source");
    if (after && projected.some((item) => {
      if (input.view === "schedules") return (item as DecisionRoomScheduleSummary).scheduleRef <= after.ref;
      const sortAt = input.view === "runs"
        ? (item as DecisionRoomRunStatus).startedAt : (item as DecisionRoomInboxItem).createdAt;
      const itemRef = input.view === "runs"
        ? (item as DecisionRoomRunStatus).runRef : (item as DecisionRoomInboxItem).notificationRef;
      return sortAt > after.sortAt! || (sortAt === after.sortAt && itemRef >= after.ref);
    })) throw new DecisionRoomReadError("corrupt_source");
    const page = Object.freeze(projected.slice(0, limit));
    const last = page.at(-1);
    const nextCursor = rows.length > limit && last
      ? cursor(input.view, {
        ref: input.view === "schedules"
          ? (last as DecisionRoomScheduleSummary).scheduleRef
          : input.view === "runs" ? (last as DecisionRoomRunStatus).runRef : (last as DecisionRoomInboxItem).notificationRef,
        sortAt: input.view === "schedules" ? null
          : input.view === "runs" ? (last as DecisionRoomRunStatus).startedAt : (last as DecisionRoomInboxItem).createdAt,
      })
      : null;
    return Object.freeze({
      contractVersion: DECISION_ROOM_READ_MODEL_VERSION, view: input.view,
      items: page, nextCursor, capabilities: CAPABILITIES,
    });
  }

  async markInboxRead(input: Readonly<{
    workspaceRef: string;
    readerRef: string;
    notificationRef: string;
    readAt: string;
  }>): Promise<DecisionRoomReadStateResult> {
    exactKeys(input, ["workspaceRef", "readerRef", "notificationRef", "readAt"], "invalid_input");
    assertSafe(input);
    const workspaceRef = ref(input.workspaceRef);
    const readerRef = ref(input.readerRef);
    const notificationRef = ref(input.notificationRef);
    const readAt = instant(input.readAt, false, "invalid_input")!;
    const stored = await this.repository.markInboxRead({ workspaceRef, readerRef, notificationRef, readAt });
    if (stored === null) throw new DecisionRoomReadError("not_found");
    exactKeys(stored, ["workspaceRef", "readerRef", "notificationRef", "readAt", "changed"], "corrupt_source");
    if (stored.workspaceRef !== workspaceRef || stored.readerRef !== readerRef || stored.notificationRef !== notificationRef
      || typeof stored.changed !== "boolean") throw new DecisionRoomReadError("scope_mismatch");
    const storedAt = instant(stored.readAt)!;
    return Object.freeze({
      contractVersion: DECISION_ROOM_READ_MODEL_VERSION, notificationRef,
      readState: Object.freeze({ status: "read" as const, readAt: storedAt }), changed: stored.changed,
      capabilities: Object.freeze({ canAuthorizeAction: false as const, canExecuteWrite: false as const }),
    });
  }
}
