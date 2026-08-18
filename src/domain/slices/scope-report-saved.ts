import { createHash } from "node:crypto";

export const SAVED_SCOPE_REPORT_VERSION = "saved-scope-report/1.0.0" as const;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,190}$/;
const HASH = /^[a-f0-9]{64}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type SavedScopeReportQuery = Readonly<{
  slice: string;
  start: string;
  end: string;
  granularity: "day" | "week" | "month";
  level: "campaign" | "ad_set" | null;
  metric: string | null;
  action: string | null;
  sort: "bucket" | "entity" | "metric";
  direction: "asc" | "desc";
}>;
export type SavedScopeReportRevision = Readonly<{
  version: typeof SAVED_SCOPE_REPORT_VERSION;
  workspaceId: string;
  reportRef: string;
  commandRef: string;
  revisionNumber: number;
  previousRevisionHash: string;
  revisionHash: string;
  state: "active" | "archived";
  label: string;
  query: SavedScopeReportQuery;
  createdByActorId: string;
  createdAt: string;
  authority: Readonly<{
    canWriteMeta: false;
    canApprove: false;
    canExecute: false;
  }>;
}>;
export class SavedScopeReportError extends Error {
  constructor(readonly code: "invalid_input" | "conflict" | "corrupt_store") {
    super(`saved scope report rejected: ${code}`);
    this.name = "SavedScopeReportError";
  }
}
const fail = (code: SavedScopeReportError["code"] = "invalid_input"): never => {
  throw new SavedScopeReportError(code);
};
const stable = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(stable)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value as Record<string, unknown>)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, item]) => [key, stable(item)]),
        )
      : value;
export const savedScopeReportDigest = (value: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(stable(value)))
    .digest("hex");
function exact(
  value: unknown,
  keys: readonly string[],
): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length !== keys.length ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    fail();
}
function calendar(value: string) {
  if (!DATE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number),
    parsed = new Date(Date.UTC(y!, m! - 1, d!));
  return (
    parsed.getUTCFullYear() === y &&
    parsed.getUTCMonth() === m! - 1 &&
    parsed.getUTCDate() === d
  );
}
export function normalizeSavedScopeReportQuery(
  value: unknown,
): SavedScopeReportQuery {
  exact(value, [
    "slice",
    "start",
    "end",
    "granularity",
    "level",
    "metric",
    "action",
    "sort",
    "direction",
  ]);
  const q = value as unknown as SavedScopeReportQuery;
  if (
    !/^slice_[a-z0-9][a-z0-9_.:-]{0,190}$/.test(q.slice) ||
    !calendar(q.start) ||
    !calendar(q.end) ||
    q.start > q.end ||
    (Date.parse(`${q.end}T00:00:00Z`) - Date.parse(`${q.start}T00:00:00Z`)) /
      86_400_000 +
      1 >
      366 ||
    !["day", "week", "month"].includes(q.granularity) ||
    !(q.level === null || q.level === "campaign" || q.level === "ad_set") ||
    !(q.metric === null || /^[a-z][a-z0-9_:-]{0,80}$/.test(q.metric)) ||
    !(q.action === null || /^[a-z][a-z0-9_:-]{0,80}$/.test(q.action)) ||
    !["bucket", "entity", "metric"].includes(q.sort) ||
    !["asc", "desc"].includes(q.direction)
  )
    fail();
  return Object.freeze({ ...q });
}
export function createSavedScopeReportRevision(
  input: Readonly<{
    workspaceId: string;
    reportRef: string;
    commandRef: string;
    revisionNumber: number;
    previousRevisionHash: string;
    state: "active" | "archived";
    label: string;
    query: SavedScopeReportQuery;
    createdByActorId: string;
    createdAt: string;
  }>,
): SavedScopeReportRevision {
  exact(input, [
    "workspaceId",
    "reportRef",
    "commandRef",
    "revisionNumber",
    "previousRevisionHash",
    "state",
    "label",
    "query",
    "createdByActorId",
    "createdAt",
  ]);
  if (
    !UUID.test(input.workspaceId) ||
    !/^scope_report_saved_[a-f0-9]{24}$/.test(input.reportRef) ||
    !/^scope_report_save_[a-f0-9]{64}$/.test(input.commandRef) ||
    !Number.isSafeInteger(input.revisionNumber) ||
    input.revisionNumber < 1 ||
    (input.revisionNumber === 1
      ? input.previousRevisionHash !== "GENESIS"
      : !HASH.test(input.previousRevisionHash)) ||
    !["active", "archived"].includes(input.state) ||
    typeof input.label !== "string" ||
    input.label.trim() !== input.label ||
    input.label.length < 1 ||
    input.label.length > 160 ||
    !UUID.test(input.createdByActorId) ||
    typeof input.createdAt !== "string" ||
    !/T\d\d:\d\d:\d\d\.\d{3}Z$/.test(input.createdAt) ||
    new Date(input.createdAt).toISOString() !== input.createdAt
  )
    fail();
  const query = normalizeSavedScopeReportQuery(input.query);
  const core = {
    version: SAVED_SCOPE_REPORT_VERSION,
    workspaceId: input.workspaceId,
    reportRef: input.reportRef,
    commandRef: input.commandRef,
    revisionNumber: input.revisionNumber,
    previousRevisionHash: input.previousRevisionHash,
    state: input.state,
    label: input.label,
    query,
    createdByActorId: input.createdByActorId,
  };
  return Object.freeze({
    ...core,
    revisionHash: savedScopeReportDigest(core),
    createdAt: input.createdAt,
    authority: Object.freeze({
      canWriteMeta: false as const,
      canApprove: false as const,
      canExecute: false as const,
    }),
  });
}
export function verifySavedScopeReportRevision(
  value: SavedScopeReportRevision,
): boolean {
  try {
    exact(value, [
      "version",
      "workspaceId",
      "reportRef",
      "commandRef",
      "revisionNumber",
      "previousRevisionHash",
      "revisionHash",
      "state",
      "label",
      "query",
      "createdByActorId",
      "createdAt",
      "authority",
    ]);
    const rebuilt = createSavedScopeReportRevision({
      workspaceId: value.workspaceId,
      reportRef: value.reportRef,
      commandRef: value.commandRef,
      revisionNumber: value.revisionNumber,
      previousRevisionHash: value.previousRevisionHash,
      state: value.state,
      label: value.label,
      query: value.query,
      createdByActorId: value.createdByActorId,
      createdAt: value.createdAt,
    });
    return (
      value.version === rebuilt.version &&
      value.revisionHash === rebuilt.revisionHash &&
      JSON.stringify(value.authority) === JSON.stringify(rebuilt.authority) &&
      REF.test(value.query.slice)
    );
  } catch {
    return false;
  }
}
