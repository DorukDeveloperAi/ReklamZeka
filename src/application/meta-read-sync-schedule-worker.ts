import { createHash } from "node:crypto";

export const META_READ_SYNC_SCHEDULE_WORKER_VERSION = "meta-read-sync-schedule-worker/1.0.0" as const;

export type MetaReadSyncScheduleCandidate = Readonly<{
  workspaceId: string;
  connectionId: string;
  scopeRevision: number;
  triggerKind: "daily";
  scheduledFor: string;
  dateStart: string;
  dateStop: string;
}>;

export interface MetaReadSyncScheduleRegistryPort {
  /** Returns only DB-derived active workspace + connection bindings. */
  listDue(now: string, limit: number): Promise<readonly MetaReadSyncScheduleCandidate[]>;
  /** Re-reads workspace and connection lifecycle immediately before sync. */
  revalidate(candidate: MetaReadSyncScheduleCandidate): Promise<MetaReadSyncScheduleCandidate | null>;
}

export type MetaReadSyncLeaseClaim =
  | Readonly<{ status: "claimed"; leaseToken: string; attempt: number }>
  | Readonly<{ status: "duplicate_completed" | "duplicate_in_progress"; attempt: number }>;

export interface MetaReadSyncLeasePort {
  /** Atomically claims only when this exact workspace/connection revision remains active. */
  claim(input: Readonly<{
    idempotencyKey: string;
    scopeKey: string;
    workspaceId: string;
    connectionId: string;
    scopeRevision: number;
    now: string;
    leaseUntil: string;
  }>): Promise<MetaReadSyncLeaseClaim>;
  complete(input: Readonly<{ idempotencyKey: string; leaseToken: string; completedAt: string }>): Promise<boolean>;
  fail(input: Readonly<{
    idempotencyKey: string;
    leaseToken: string;
    failedAt: string;
    reason: MetaReadSyncFailureReason;
    retryable: boolean;
  }>): Promise<boolean>;
}

export type MetaReadSyncServiceResult = Readonly<{
  status: "completed" | "partial" | "failed";
  streamCounts: Readonly<{ completed: number; partial: number; failed: number }>;
  inserted: number;
  updated: number;
  unchanged: number;
  writeNetworkCalls: 0;
}>;

export interface ScheduledMetaReadSyncService {
  run(input: Readonly<{
    parentRunId: string;
    dateStart: string;
    dateStop: string;
  }>): Promise<MetaReadSyncServiceResult>;
}

/** A server adapter may wrap createDrizzleProductionMetaReadSyncService here. */
export interface ScheduledMetaReadSyncServiceFactoryPort {
  create(input: Readonly<{
    scopeResolver: Readonly<{ resolve(): Promise<Readonly<{ workspaceId: string; connectionId: string }>> }>;
  }>): ScheduledMetaReadSyncService;
}

export type MetaReadSyncFailureReason =
  | "scope_unavailable"
  | "connection_unavailable"
  | "account_scope_unavailable"
  | "rate_limited"
  | "transient"
  | "partial_result"
  | "sync_failed";

export interface MetaReadSyncRetryClassifierPort {
  classify(error: unknown): Readonly<{ reason: MetaReadSyncFailureReason; retryable: boolean }>;
}

export type MetaReadSyncScheduleWorkerItem = Readonly<{
  scopeRef: string;
  parentRunRef: string;
  outcome:
    | "completed"
    | "partial"
    | "failed"
    | "duplicate_completed"
    | "duplicate_in_progress"
    | "stale_scope"
    | "lease_lost"
    | "isolated_error";
  attempts: number;
  retryable: boolean;
  reason: MetaReadSyncFailureReason | "none" | "lease_unavailable";
  counts: Readonly<{ streams: number; inserted: number; updated: number; unchanged: number }>;
}>;

export type MetaReadSyncScheduleWorkerResult = Readonly<{
  version: typeof META_READ_SYNC_SCHEDULE_WORKER_VERSION;
  now: string;
  batchSize: number;
  dueCount: number;
  completedCount: number;
  partialCount: number;
  failedCount: number;
  duplicateCount: number;
  items: readonly MetaReadSyncScheduleWorkerItem[];
  actionAuthority: "none";
  writeNetworkCalls: 0;
}>;

export class MetaReadSyncScheduleWorkerError extends Error {
  constructor(readonly code: "invalid_input" | "registry_failure" | "lease_unavailable") {
    super("Meta read-sync worker güvenli biçimde çalıştırılamadı");
    this.name = "MetaReadSyncScheduleWorkerError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const LEASE = /^[a-z][a-z0-9_.:-]{0,127}$/;
const MAX_BATCH = 100;
const MAX_CONCURRENCY = 8;
const MAX_ATTEMPTS = 5;
const FAILURE_REASONS = new Set<MetaReadSyncFailureReason>([
  "scope_unavailable", "connection_unavailable", "account_scope_unavailable", "rate_limited",
  "transient", "partial_result", "sync_failed",
]);

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function instant(value: unknown): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    throw new MetaReadSyncScheduleWorkerError("invalid_input");
  }
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString() !== value) {
    throw new MetaReadSyncScheduleWorkerError("invalid_input");
  }
  return value;
}

function date(value: unknown): string {
  if (typeof value !== "string" || !DATE.test(value)
    || new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) {
    throw new MetaReadSyncScheduleWorkerError("registry_failure");
  }
  return value;
}

function integer(value: unknown, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    throw new MetaReadSyncScheduleWorkerError("invalid_input");
  }
  return value as number;
}

function candidate(raw: unknown, now: string): MetaReadSyncScheduleCandidate {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)
    || Object.keys(raw).length !== 7
    || Object.keys(raw).some((key) => ![
      "workspaceId", "connectionId", "scopeRevision", "triggerKind", "scheduledFor", "dateStart", "dateStop",
    ].includes(key))) throw new MetaReadSyncScheduleWorkerError("registry_failure");
  const value = raw as MetaReadSyncScheduleCandidate;
  const scheduledFor = instant(value.scheduledFor);
  const dateStart = date(value.dateStart);
  const dateStop = date(value.dateStop);
  if (!UUID.test(value.workspaceId) || !UUID.test(value.connectionId)
    || !Number.isSafeInteger(value.scopeRevision) || value.scopeRevision < 1
    || value.triggerKind !== "daily" || scheduledFor > now || dateStart > dateStop) {
    throw new MetaReadSyncScheduleWorkerError("registry_failure");
  }
  return Object.freeze({ ...value, scheduledFor, dateStart, dateStop });
}

function identity(value: MetaReadSyncScheduleCandidate): Readonly<{
  idempotencyKey: string;
  scopeKey: string;
  scopeRef: string;
  parentRunRef: string;
}> {
  const scopeHash = digest(["scope", value.workspaceId, value.connectionId]);
  const fireHash = digest([
    META_READ_SYNC_SCHEDULE_WORKER_VERSION, value.triggerKind, value.scheduledFor,
    value.workspaceId, value.connectionId, value.scopeRevision, value.dateStart, value.dateStop,
  ]);
  return Object.freeze({
    idempotencyKey: `syncfire_${fireHash}`,
    scopeKey: scopeHash,
    scopeRef: `syncscope_${scopeHash.slice(0, 20)}`,
    parentRunRef: `sync_daily_${fireHash.slice(0, 32)}`,
  });
}

function emptyCounts(): MetaReadSyncScheduleWorkerItem["counts"] {
  return Object.freeze({ streams: 0, inserted: 0, updated: 0, unchanged: 0 });
}

function classified(value: unknown): Readonly<{ reason: MetaReadSyncFailureReason; retryable: boolean }> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== 2 || Object.keys(value).some((key) => !["reason", "retryable"].includes(key))) {
    return Object.freeze({ reason: "sync_failed", retryable: false });
  }
  const candidate = value as { reason?: unknown; retryable?: unknown };
  if (typeof candidate.reason !== "string" || !FAILURE_REASONS.has(candidate.reason as MetaReadSyncFailureReason)
    || typeof candidate.retryable !== "boolean") {
    return Object.freeze({ reason: "sync_failed", retryable: false });
  }
  return Object.freeze({ reason: candidate.reason as MetaReadSyncFailureReason, retryable: candidate.retryable });
}

function serviceResult(value: unknown): MetaReadSyncServiceResult {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== 6 || Object.keys(value).some((key) => ![
      "status", "streamCounts", "inserted", "updated", "unchanged", "writeNetworkCalls",
    ].includes(key))) throw new Error("invalid service result");
  const result = value as MetaReadSyncServiceResult;
  if (!result.streamCounts || typeof result.streamCounts !== "object" || Array.isArray(result.streamCounts)
    || Object.keys(result.streamCounts).length !== 3
    || Object.keys(result.streamCounts).some((key) => !["completed", "partial", "failed"].includes(key))
    || !["completed", "partial", "failed"].includes(result.status)
    || [result.streamCounts.completed, result.streamCounts.partial, result.streamCounts.failed,
      result.inserted, result.updated, result.unchanged].some((count) => !Number.isSafeInteger(count) || count < 0)
    || result.writeNetworkCalls !== 0) throw new Error("invalid service result");
  return result;
}

function item(
  ids: ReturnType<typeof identity>,
  outcome: MetaReadSyncScheduleWorkerItem["outcome"],
  attempts: number,
  retryable: boolean,
  reason: MetaReadSyncScheduleWorkerItem["reason"],
  result?: MetaReadSyncServiceResult,
): MetaReadSyncScheduleWorkerItem {
  return Object.freeze({
    scopeRef: ids.scopeRef,
    parentRunRef: ids.parentRunRef,
    outcome,
    attempts,
    retryable,
    reason,
    counts: result ? Object.freeze({
      streams: result.streamCounts.completed + result.streamCounts.partial + result.streamCounts.failed,
      inserted: result.inserted,
      updated: result.updated,
      unchanged: result.unchanged,
    }) : emptyCounts(),
  });
}

function exactRevalidation(
  original: MetaReadSyncScheduleCandidate,
  revalidated: MetaReadSyncScheduleCandidate | null,
  now: string,
): MetaReadSyncScheduleCandidate | null {
  if (revalidated === null) return null;
  const checked = candidate(revalidated, now);
  return checked.workspaceId === original.workspaceId
    && checked.connectionId === original.connectionId
    && checked.scopeRevision === original.scopeRevision
    && checked.triggerKind === original.triggerKind
    && checked.scheduledFor === original.scheduledFor
    && checked.dateStart === original.dateStart
    && checked.dateStop === original.dateStop
    ? checked : null;
}

async function mapBounded<T, U>(values: readonly T[], concurrency: number, work: (value: T) => Promise<U>): Promise<readonly U[]> {
  const results = new Array<U>(values.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (true) {
      const index = next++;
      if (index >= values.length) return;
      results[index] = await work(values[index]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, values.length) }, () => worker()));
  return Object.freeze(results);
}

export async function runMetaReadSyncScheduleWorker(
  input: Readonly<{
    now: string;
    batchSize?: number;
    concurrency?: number;
    maxAttempts?: number;
    leaseMs?: number;
  }>,
  ports: Readonly<{
    registry: MetaReadSyncScheduleRegistryPort;
    leases: MetaReadSyncLeasePort;
    services: ScheduledMetaReadSyncServiceFactoryPort;
    retryClassifier: MetaReadSyncRetryClassifierPort;
    sleep?: (milliseconds: number) => Promise<void>;
  }>,
): Promise<MetaReadSyncScheduleWorkerResult> {
  if (!input || Object.keys(input).some((key) => !["now", "batchSize", "concurrency", "maxAttempts", "leaseMs"].includes(key))
    || !ports?.registry?.listDue || !ports.registry.revalidate || !ports.leases?.claim
    || !ports.leases.complete || !ports.leases.fail || !ports.services?.create || !ports.retryClassifier?.classify) {
    throw new MetaReadSyncScheduleWorkerError("lease_unavailable");
  }
  const now = instant(input.now);
  const batchSize = integer(input.batchSize ?? 25, MAX_BATCH);
  const concurrency = integer(input.concurrency ?? 2, MAX_CONCURRENCY);
  const maxAttempts = integer(input.maxAttempts ?? 3, MAX_ATTEMPTS);
  const leaseMs = integer(input.leaseMs ?? 5 * 60_000, 60 * 60_000);
  const sleep = ports.sleep ?? (async () => undefined);

  let rawCandidates: readonly MetaReadSyncScheduleCandidate[];
  try {
    rawCandidates = await ports.registry.listDue(now, batchSize);
  } catch {
    throw new MetaReadSyncScheduleWorkerError("registry_failure");
  }
  if (!Array.isArray(rawCandidates) || rawCandidates.length > batchSize) {
    throw new MetaReadSyncScheduleWorkerError("registry_failure");
  }
  let candidates: readonly MetaReadSyncScheduleCandidate[];
  try {
    candidates = rawCandidates.map((entry) => candidate(entry, now));
  } catch {
    throw new MetaReadSyncScheduleWorkerError("registry_failure");
  }
  const fireKeys = candidates.map((entry) => identity(entry).idempotencyKey);
  if (new Set(fireKeys).size !== fireKeys.length) throw new MetaReadSyncScheduleWorkerError("registry_failure");

  const items = await mapBounded(candidates, concurrency, async (due) => {
    const ids = identity(due);
    let claim: MetaReadSyncLeaseClaim;
    try {
      claim = await ports.leases.claim({
        idempotencyKey: ids.idempotencyKey,
        scopeKey: ids.scopeKey,
        workspaceId: due.workspaceId,
        connectionId: due.connectionId,
        scopeRevision: due.scopeRevision,
        now,
        leaseUntil: new Date(Date.parse(now) + leaseMs).toISOString(),
      });
    } catch {
      return item(ids, "isolated_error", 0, true, "lease_unavailable");
    }
    if (!claim || typeof claim !== "object" || !Number.isSafeInteger(claim.attempt) || claim.attempt < 1
      || !["claimed", "duplicate_completed", "duplicate_in_progress"].includes(claim.status)
      || (claim.status === "claimed" ? !LEASE.test(claim.leaseToken) : "leaseToken" in claim)) {
      return item(ids, "isolated_error", 0, false, "lease_unavailable");
    }
    if (claim.status !== "claimed") {
      return item(ids, claim.status, claim.attempt, claim.status === "duplicate_in_progress", "none");
    }

    let active: MetaReadSyncScheduleCandidate | null;
    try {
      active = exactRevalidation(due, await ports.registry.revalidate(due), now);
    } catch {
      active = null;
    }
    if (active === null) {
      const released = await ports.leases.fail({
        idempotencyKey: ids.idempotencyKey, leaseToken: claim.leaseToken, failedAt: now,
        reason: "scope_unavailable", retryable: false,
      }).catch(() => false);
      return item(ids, released ? "stale_scope" : "lease_lost", claim.attempt, false, "scope_unavailable");
    }

    let service: ScheduledMetaReadSyncService;
    try {
      service = ports.services.create({
        scopeResolver: { resolve: async () => ({ workspaceId: active!.workspaceId, connectionId: active!.connectionId }) },
      });
    } catch {
      const released = await ports.leases.fail({ idempotencyKey: ids.idempotencyKey, leaseToken: claim.leaseToken,
        failedAt: now, reason: "connection_unavailable", retryable: false }).catch(() => false);
      return item(ids, released ? "failed" : "lease_lost", claim.attempt, false, "connection_unavailable");
    }

    let lastFailure: Readonly<{ reason: MetaReadSyncFailureReason; retryable: boolean }> = {
      reason: "sync_failed", retryable: false,
    };
    let executionAttempts = 0;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      executionAttempts = attempt;
      try {
        const result = serviceResult(await service.run({
          parentRunId: ids.parentRunRef, dateStart: active.dateStart, dateStop: active.dateStop,
        }));
        if (result.status === "completed") {
          const completed = await ports.leases.complete({
            idempotencyKey: ids.idempotencyKey, leaseToken: claim.leaseToken, completedAt: now,
          }).catch(() => false);
          return item(ids, completed ? "completed" : "lease_lost", attempt, false,
            completed ? "none" : "lease_unavailable", result);
        }
        lastFailure = result.status === "partial"
          ? { reason: "partial_result", retryable: true }
          : { reason: "sync_failed", retryable: false };
        const released = await ports.leases.fail({
          idempotencyKey: ids.idempotencyKey, leaseToken: claim.leaseToken, failedAt: now,
          reason: lastFailure.reason, retryable: lastFailure.retryable,
        }).catch(() => false);
        return item(ids, released ? result.status : "lease_lost", attempt, lastFailure.retryable,
          released ? lastFailure.reason : "lease_unavailable", result);
      } catch (error) {
        try {
          lastFailure = classified(ports.retryClassifier.classify(error));
        } catch {
          lastFailure = { reason: "sync_failed", retryable: false };
        }
        if (!lastFailure.retryable || attempt === maxAttempts) break;
        await sleep(Math.min(5_000, 100 * 2 ** (attempt - 1)));
      }
    }
    const released = await ports.leases.fail({
      idempotencyKey: ids.idempotencyKey, leaseToken: claim.leaseToken, failedAt: now,
      reason: lastFailure.reason, retryable: lastFailure.retryable,
    }).catch(() => false);
    return item(ids, released ? "failed" : "lease_lost", executionAttempts, lastFailure.retryable,
      released ? lastFailure.reason : "lease_unavailable");
  });

  return Object.freeze({
    version: META_READ_SYNC_SCHEDULE_WORKER_VERSION,
    now,
    batchSize,
    dueCount: candidates.length,
    completedCount: items.filter((entry) => entry.outcome === "completed").length,
    partialCount: items.filter((entry) => entry.outcome === "partial").length,
    failedCount: items.filter((entry) => ["failed", "stale_scope", "lease_lost", "isolated_error"].includes(entry.outcome)).length,
    duplicateCount: items.filter((entry) => entry.outcome.startsWith("duplicate_")).length,
    items,
    actionAuthority: "none",
    writeNetworkCalls: 0,
  });
}
