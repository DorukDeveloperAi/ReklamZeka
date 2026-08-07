import { createHash } from "node:crypto";

export const META_SYNC_STREAMS = ["inventory", "creative_post", "insights"] as const;
export type MetaSyncStream = (typeof META_SYNC_STREAMS)[number];
export const META_ENTITY_LEVELS = ["account", "campaign", "ad_set", "ad"] as const;
export type MetaEntityLevel = (typeof META_ENTITY_LEVELS)[number];
export type MetaSyncStatus = "pending" | "running" | "completed" | "partial" | "failed";
export type MetaSyncErrorReason = "timeout" | "http_500" | "rate_limited" | "reduce_data" | "malformed_response" | "connection_lost" | "authentication" | "unknown";

export type MetaSyncSlice = Readonly<{
  id: string;
  stream: MetaSyncStream;
  accountId: string;
  entityLevel: MetaEntityLevel;
  dateStart: string | null;
  dateStop: string | null;
  pageSize: number;
}>;

export type MetaReadRequest = Readonly<{
  method: "GET";
  stream: MetaSyncStream;
  accountId: string;
  entityLevel: MetaEntityLevel;
  dateStart: string | null;
  dateStop: string | null;
  cursor: string | null;
  limit: number;
  correlation: Readonly<{ parentRunId: string; streamRunId: string; accountId: string; sliceId: string; cursorId: string }>;
}>;

export type MetaReadPage = Readonly<{
  records: readonly Readonly<Record<string, unknown>>[];
  nextCursor: string | null;
  usageHeadroom: number;
}>;

export interface MetaReadTransport {
  get(request: MetaReadRequest): Promise<MetaReadPage>;
}

export type MetaSyncError = Readonly<{ reason: MetaSyncErrorReason; retryable: boolean; message: string }>;
export type MetaSyncCursor = Readonly<{ cursor: string | null; cursorId: string; updatedAt: string }>;
export type MetaStreamRun = Readonly<{
  id: string;
  parentRunId: string;
  stream: MetaSyncStream;
  accountId: string;
  status: MetaSyncStatus;
  completedSliceIds: readonly string[];
  cursorBySlice: Readonly<Record<string, MetaSyncCursor>>;
  error: MetaSyncError | null;
}>;
export type MetaParentSyncRun = Readonly<{ id: string; workspaceId: string; connectionId: string; status: MetaSyncStatus; streamRunIds: readonly string[] }>;
export type MetaSyncRecord = Readonly<{
  identity: string;
  accountId: string;
  stream: MetaSyncStream;
  entityLevel: MetaEntityLevel;
  snapshotHash: string;
  payload: Readonly<Record<string, unknown>>;
  firstSeenAt: string;
  lastSeenAt: string;
}>;

export function stableHash(value: unknown): string {
  const normalize = (entry: unknown): unknown => Array.isArray(entry)
    ? entry.map(normalize)
    : entry && typeof entry === "object"
      ? Object.fromEntries(Object.entries(entry as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, normalize(child)]))
      : entry;
  return createHash("sha256").update(JSON.stringify(normalize(value))).digest("hex");
}

export function sliceId(stream: MetaSyncStream, accountId: string, entityLevel: MetaEntityLevel, dateStart: string | null, dateStop: string | null): string {
  return `${stream}:${accountId}:${entityLevel}:${dateStart ?? "all"}:${dateStop ?? "all"}`;
}
