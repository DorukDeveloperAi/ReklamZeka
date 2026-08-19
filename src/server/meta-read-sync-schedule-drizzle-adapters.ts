import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import {
  META_READ_SYNC_SCHEDULE_WORKER_VERSION,
  type MetaReadSyncFailureReason,
  type MetaReadSyncLeaseClaim,
  type MetaReadSyncLeasePort,
  type MetaReadSyncTriggerKind,
  type MetaReadSyncScheduleCandidate,
  type MetaReadSyncScheduleRegistryPort,
} from "@/application/meta-read-sync-schedule-worker";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
type AdapterDatabase = Pick<Database, "execute" | "transaction">;

export class MetaReadSyncSchedulePersistenceError extends Error {
  constructor(readonly code:
    | "invalid_input"
    | "scope_unavailable"
    | "scope_revision_changed"
    | "lease_conflict"
    | "corrupt_store") {
    super("Meta read-sync schedule persistence güvenli biçimde işlenemedi");
    this.name = "MetaReadSyncSchedulePersistenceError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const IDEMPOTENCY = /^syncfire_[a-f0-9]{64}$/;
const LEASE = /^lease_[a-f0-9]{32}$/;
const MAX_ATTEMPTS = 5;
const FAILURE_REASONS = new Set<MetaReadSyncFailureReason>([
  "scope_unavailable", "connection_unavailable", "account_scope_unavailable", "rate_limited",
  "transient", "partial_result", "sync_failed",
]);

type ScheduleRow = Readonly<{
  id: string;
  workspace_id: string;
  connection_id: string;
  revision: number;
  trigger_kind: "interval_6h";
  timeframe_days: number;
  next_due_at: string | Date;
}>;
type RunRow = Readonly<{
  id: string;
  workspace_id: string;
  schedule_id: string;
  connection_id: string;
  schedule_revision: number;
  idempotency_key: string;
  scope_key: string;
  trigger_kind: string;
  scheduled_for: string | Date;
  date_start: string | Date;
  date_stop: string | Date;
  state: "running" | "completed" | "failed";
  lease_token: string | null;
  lease_until: string | Date | null;
  attempt: number;
  retryable: boolean | null;
}>;

function fail(code: MetaReadSyncSchedulePersistenceError["code"]): never {
  throw new MetaReadSyncSchedulePersistenceError(code);
}
function rows<T>(result: unknown): readonly T[] {
  if (!result || typeof result !== "object" || !("rows" in result) || !Array.isArray(result.rows)) fail("corrupt_store");
  return result.rows as readonly T[];
}
function exact(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value as object).length === keys.length
    && Object.keys(value as object).every((key) => keys.includes(key));
}
function instant(value: unknown): string {
  if (value instanceof Date && Number.isFinite(value.valueOf())) return value.toISOString();
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail("invalid_input");
  return value;
}
function storedInstant(value: unknown): string {
  if (value instanceof Date && Number.isFinite(value.valueOf())) return value.toISOString();
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return fail("corrupt_store");
  return new Date(value).toISOString();
}
function storedDate(value: unknown): string {
  const rendered = value instanceof Date ? value.toISOString().slice(0, 10) : value;
  if (typeof rendered !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(rendered)
    || new Date(`${rendered}T00:00:00.000Z`).toISOString().slice(0, 10) !== rendered) fail("corrupt_store");
  return rendered;
}
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function candidate(row: ScheduleRow, kind: MetaReadSyncTriggerKind = "interval_6h", scheduledForOverride?: string): MetaReadSyncScheduleCandidate {
  if (!UUID.test(row.id) || !UUID.test(row.workspace_id) || !UUID.test(row.connection_id)
    || !Number.isSafeInteger(row.revision) || row.revision < 1 || row.trigger_kind !== "interval_6h"
    || !Number.isSafeInteger(row.timeframe_days) || row.timeframe_days < 1 || row.timeframe_days > 90) fail("corrupt_store");
  const scheduledFor = scheduledForOverride ?? storedInstant(row.next_due_at);
  const stop = new Date(Date.parse(scheduledFor)); stop.setUTCDate(stop.getUTCDate() - 1);
  const start = new Date(stop); start.setUTCDate(start.getUTCDate() - row.timeframe_days + 1);
  return Object.freeze({ workspaceId: row.workspace_id, connectionId: row.connection_id, scopeRevision: row.revision,
    triggerKind: kind, scheduledFor, dateStart: start.toISOString().slice(0, 10), dateStop: stop.toISOString().slice(0, 10) });
}
function identity(value: MetaReadSyncScheduleCandidate) {
  const scopeKey = digest(["scope", value.workspaceId, value.connectionId]);
  const fireHash = digest([META_READ_SYNC_SCHEDULE_WORKER_VERSION, value.triggerKind, value.scheduledFor,
    value.workspaceId, value.connectionId, value.scopeRevision, value.dateStart, value.dateStop]);
  return Object.freeze({ scopeKey, idempotencyKey: `syncfire_${fireHash}` });
}
function same(left: MetaReadSyncScheduleCandidate, right: MetaReadSyncScheduleCandidate): boolean {
  return left.workspaceId === right.workspaceId && left.connectionId === right.connectionId
    && left.scopeRevision === right.scopeRevision && left.triggerKind === right.triggerKind
    && left.scheduledFor === right.scheduledFor && left.dateStart === right.dateStart && left.dateStop === right.dateStop;
}
function validateCandidate(value: unknown): MetaReadSyncScheduleCandidate {
  if (!exact(value, ["workspaceId", "connectionId", "scopeRevision", "triggerKind", "scheduledFor", "dateStart", "dateStop"])
    || typeof value.workspaceId !== "string" || !UUID.test(value.workspaceId)
    || typeof value.connectionId !== "string" || !UUID.test(value.connectionId)
    || !Number.isSafeInteger(value.scopeRevision) || (value.scopeRevision as number) < 1
    || !["interval_6h", "manual"].includes(value.triggerKind as string)) fail("invalid_input");
  const scheduledFor = instant(value.scheduledFor);
  if (typeof value.dateStart !== "string" || typeof value.dateStop !== "string"
    || !/^\d{4}-\d{2}-\d{2}$/.test(value.dateStart) || !/^\d{4}-\d{2}-\d{2}$/.test(value.dateStop)
    || value.dateStart > value.dateStop) fail("invalid_input");
  return { ...value, scheduledFor } as MetaReadSyncScheduleCandidate;
}

const ACTIVE_BINDING = sql.raw(`schedule.enabled = true and schedule.trigger_kind = 'interval_6h'
  and workspace.lifecycle_state = 'active'
  and workspace.lifecycle_generation = schedule.workspace_lifecycle_generation
  and connection.status = 'active' and connection.access_mode = 'read_only'
  and connection.lifecycle_generation = schedule.connection_lifecycle_generation`);
const SCHEDULE_COLUMNS = sql.raw(`schedule.id, schedule.workspace_id, schedule.connection_id, schedule.revision,
  schedule.trigger_kind, schedule.timeframe_days, schedule.next_due_at`);
const RUN_COLUMNS = sql.raw(`id, workspace_id, schedule_id, connection_id, schedule_revision, idempotency_key,
  scope_key, trigger_kind, scheduled_for, date_start, date_stop, state, lease_token, lease_until, attempt, retryable`);

/** Read-only registry adapter; schedules must already exist in the private database. */
export class DrizzleMetaReadSyncScheduleRegistry implements MetaReadSyncScheduleRegistryPort {
  constructor(private readonly database: Pick<Database, "execute">) {}

  async listDue(nowValue: string, limitValue: number): Promise<readonly MetaReadSyncScheduleCandidate[]> {
    const now = instant(nowValue);
    if (!Number.isSafeInteger(limitValue) || limitValue < 1 || limitValue > 100) fail("invalid_input");
    const found = rows<ScheduleRow>(await this.database.execute(sql`
      select ${SCHEDULE_COLUMNS}
      from meta_read_sync_schedules schedule
      join workspaces workspace on workspace.id = schedule.workspace_id
      join meta_connections connection
        on connection.workspace_id = schedule.workspace_id and connection.id = schedule.connection_id
      where ${ACTIVE_BINDING} and schedule.next_due_at <= ${now}::timestamptz
      order by schedule.next_due_at, schedule.workspace_id, schedule.connection_id
      limit ${limitValue}
    `));
    if (found.length > limitValue) fail("corrupt_store");
    const values = found.map((row) => candidate(row));
    if (new Set(values.map((value) => identity(value).idempotencyKey)).size !== values.length) fail("corrupt_store");
    return Object.freeze(values);
  }

  async revalidate(raw: MetaReadSyncScheduleCandidate): Promise<MetaReadSyncScheduleCandidate | null> {
    const expected = validateCandidate(raw);
    const found = rows<ScheduleRow>(await this.database.execute(sql`
      select ${SCHEDULE_COLUMNS}
      from meta_read_sync_schedules schedule
      join workspaces workspace on workspace.id = schedule.workspace_id
      join meta_connections connection
        on connection.workspace_id = schedule.workspace_id and connection.id = schedule.connection_id
      where ${ACTIVE_BINDING}
        and schedule.workspace_id = ${expected.workspaceId}::uuid
        and schedule.connection_id = ${expected.connectionId}::uuid
        and schedule.revision = ${expected.scopeRevision}
        and (${expected.triggerKind} = 'manual' or schedule.next_due_at = ${expected.scheduledFor}::timestamptz)
      limit 2
    `));
    if (found.length === 0) return null;
    if (found.length > 1) fail("corrupt_store");
    const checked = candidate(found[0]!, expected.triggerKind,
      expected.triggerKind === "manual" ? expected.scheduledFor : undefined);
    return same(expected, checked) ? checked : null;
  }

  async resolveManual(workspaceId: string, nowValue: string): Promise<MetaReadSyncScheduleCandidate | null> {
    const now = instant(nowValue);
    if (!UUID.test(workspaceId)) fail("invalid_input");
    const found = rows<ScheduleRow>(await this.database.execute(sql`
      select ${SCHEDULE_COLUMNS}
      from meta_read_sync_schedules schedule
      join workspaces workspace on workspace.id = schedule.workspace_id
      join meta_connections connection
        on connection.workspace_id = schedule.workspace_id and connection.id = schedule.connection_id
      where ${ACTIVE_BINDING} and schedule.workspace_id = ${workspaceId}::uuid
      limit 2
    `));
    if (found.length === 0) return null;
    if (found.length > 1) fail("corrupt_store");
    return candidate(found[0]!, "manual", now);
  }
}

/** Atomic private lease adapter. No network, cron, Meta write, or execution authority exists here. */
export class DrizzleMetaReadSyncLease implements MetaReadSyncLeasePort {
  constructor(private readonly database: AdapterDatabase) {}

  async claim(input: Parameters<MetaReadSyncLeasePort["claim"]>[0]): Promise<MetaReadSyncLeaseClaim> {
    if (!exact(input, ["idempotencyKey", "scopeKey", "workspaceId", "connectionId", "scopeRevision", "triggerKind", "scheduledFor", "dateStart", "dateStop", "now", "leaseUntil"])
      || typeof input.idempotencyKey !== "string" || !IDEMPOTENCY.test(input.idempotencyKey)
      || typeof input.scopeKey !== "string" || !HASH.test(input.scopeKey)
      || typeof input.workspaceId !== "string" || !UUID.test(input.workspaceId)
      || typeof input.connectionId !== "string" || !UUID.test(input.connectionId)
      || !Number.isSafeInteger(input.scopeRevision) || input.scopeRevision < 1
      || !["interval_6h", "manual"].includes(input.triggerKind)
      || typeof input.scheduledFor !== "string" || typeof input.dateStart !== "string" || typeof input.dateStop !== "string") fail("invalid_input");
    const now = instant(input.now); const leaseUntil = instant(input.leaseUntil);
    const requested: MetaReadSyncScheduleCandidate = validateCandidate({ workspaceId: input.workspaceId,
      connectionId: input.connectionId, scopeRevision: input.scopeRevision, triggerKind: input.triggerKind,
      scheduledFor: input.scheduledFor, dateStart: input.dateStart, dateStop: input.dateStop });
    if (leaseUntil <= now) fail("invalid_input");
    return this.database.transaction(async (transaction) => {
      const schedules = rows<ScheduleRow>(await transaction.execute(sql`
        select ${SCHEDULE_COLUMNS}
        from meta_read_sync_schedules schedule
        join workspaces workspace on workspace.id = schedule.workspace_id
        join meta_connections connection
          on connection.workspace_id = schedule.workspace_id and connection.id = schedule.connection_id
        where ${ACTIVE_BINDING}
          and schedule.workspace_id = ${input.workspaceId}::uuid
          and schedule.connection_id = ${input.connectionId}::uuid
        limit 2 for update of schedule
      `));
      if (schedules.length !== 1) fail(schedules.length === 0 ? "scope_revision_changed" : "corrupt_store");
      const due = candidate(schedules[0]!, requested.triggerKind,
        requested.triggerKind === "manual" ? requested.scheduledFor : undefined);
      const existingRows = rows<RunRow>(await transaction.execute(sql`
        select ${RUN_COLUMNS} from meta_read_sync_schedule_runs
        where idempotency_key = ${input.idempotencyKey}
        limit 2 for update
      `));
      if (existingRows.length > 1) fail("corrupt_store");
      const existing = existingRows[0] ?? null;
      if (existing) {
        const storedCandidate: MetaReadSyncScheduleCandidate = Object.freeze({ workspaceId: existing.workspace_id,
          connectionId: existing.connection_id, scopeRevision: existing.schedule_revision,
          triggerKind: existing.trigger_kind === "manual" ? "manual"
            : existing.trigger_kind === "daily" ? "daily" : "interval_6h",
          scheduledFor: storedInstant(existing.scheduled_for), dateStart: storedDate(existing.date_start),
          dateStop: storedDate(existing.date_stop) });
        const storedIdentity = identity(storedCandidate);
        if (existing.workspace_id !== input.workspaceId || existing.schedule_id !== schedules[0]!.id
          || existing.connection_id !== input.connectionId || existing.schedule_revision !== input.scopeRevision
          || existing.idempotency_key !== input.idempotencyKey || existing.scope_key !== input.scopeKey
          || existing.trigger_kind !== requested.triggerKind || storedIdentity.idempotencyKey !== input.idempotencyKey
          || storedIdentity.scopeKey !== input.scopeKey || !Number.isSafeInteger(existing.attempt)
          || existing.attempt < 1 || existing.attempt > MAX_ATTEMPTS) fail("corrupt_store");
      }
      if (existing?.state === "completed") return Object.freeze({ status: "duplicate_completed" as const, attempt: existing.attempt });
      const expected = identity(requested);
      if (due.scopeRevision !== input.scopeRevision || due.scheduledFor > now
        || expected.idempotencyKey !== input.idempotencyKey || expected.scopeKey !== input.scopeKey) fail("scope_revision_changed");
      if (existing?.state === "running" && existing.lease_until !== null && storedInstant(existing.lease_until) > now) {
        return Object.freeze({ status: "duplicate_in_progress" as const, attempt: existing.attempt });
      }
      if (existing && (existing.attempt >= MAX_ATTEMPTS || existing.state === "failed" && existing.retryable !== true)) {
        return Object.freeze({ status: "duplicate_in_progress" as const, attempt: existing.attempt });
      }
      const activeOther = rows<RunRow>(await transaction.execute(sql`
        select ${RUN_COLUMNS} from meta_read_sync_schedule_runs
        where workspace_id = ${input.workspaceId}::uuid and connection_id = ${input.connectionId}::uuid
          and scope_key = ${input.scopeKey} and state = 'running'
          and lease_until > ${now}::timestamptz and idempotency_key <> ${input.idempotencyKey}
        limit 2 for update
      `));
      if (activeOther.length > 1) fail("corrupt_store");
      if (activeOther.length === 1) return Object.freeze({ status: "duplicate_in_progress" as const, attempt: activeOther[0]!.attempt });
      const attempt = (existing?.attempt ?? 0) + 1;
      const leaseToken = `lease_${randomUUID().replaceAll("-", "")}`;
      if (existing) {
        const updated = rows<{ id: string }>(await transaction.execute(sql`
          update meta_read_sync_schedule_runs set state = 'running', lease_token = ${leaseToken},
            lease_until = ${leaseUntil}::timestamptz, attempt = ${attempt}, failure_reason = null, retryable = null,
            started_at = ${now}::timestamptz, completed_at = null, failed_at = null, updated_at = now()
          where id = ${existing.id}::uuid and idempotency_key = ${input.idempotencyKey}
          returning id
        `));
        if (updated.length !== 1) fail("lease_conflict");
      } else {
        const inserted = rows<{ id: string }>(await transaction.execute(sql`
          insert into meta_read_sync_schedule_runs (
            workspace_id, schedule_id, connection_id, schedule_revision, idempotency_key, scope_key, trigger_kind,
            scheduled_for, date_start, date_stop, state, lease_token, lease_until, attempt, started_at
          ) values (
            ${due.workspaceId}::uuid, ${schedules[0]!.id}::uuid, ${due.connectionId}::uuid, ${due.scopeRevision},
            ${input.idempotencyKey}, ${input.scopeKey}, ${requested.triggerKind}, ${requested.scheduledFor}::timestamptz,
            ${requested.dateStart}::date, ${requested.dateStop}::date, 'running', ${leaseToken}, ${leaseUntil}::timestamptz,
            ${attempt}, ${now}::timestamptz
          ) returning id
        `));
        if (inserted.length !== 1 || !UUID.test(inserted[0]!.id)) fail("corrupt_store");
      }
      return Object.freeze({ status: "claimed" as const, leaseToken, attempt });
    });
  }

  async complete(input: Parameters<MetaReadSyncLeasePort["complete"]>[0]): Promise<boolean> {
    if (!exact(input, ["idempotencyKey", "leaseToken", "completedAt"])
      || typeof input.idempotencyKey !== "string" || !IDEMPOTENCY.test(input.idempotencyKey)
      || typeof input.leaseToken !== "string" || !LEASE.test(input.leaseToken)) fail("invalid_input");
    const completedAt = instant(input.completedAt);
    return this.database.transaction(async (transaction) => {
      const preview = rows<RunRow>(await transaction.execute(sql`
        select ${RUN_COLUMNS} from meta_read_sync_schedule_runs
        where idempotency_key = ${input.idempotencyKey} and state = 'running' and lease_token = ${input.leaseToken}
        limit 2
      `));
      if (preview.length !== 1) return false;
      const run = preview[0]!;
      const schedule = rows<{ id: string }>(await transaction.execute(sql`
        select schedule.id from meta_read_sync_schedules schedule
        join workspaces workspace on workspace.id = schedule.workspace_id
        join meta_connections connection
          on connection.workspace_id = schedule.workspace_id and connection.id = schedule.connection_id
        where ${ACTIVE_BINDING} and schedule.workspace_id = ${run.workspace_id}::uuid
          and schedule.id = ${run.schedule_id}::uuid and schedule.connection_id = ${run.connection_id}::uuid
          and schedule.revision = ${run.schedule_revision}
          and (schedule.next_due_at = ${storedInstant(run.scheduled_for)}::timestamptz or ${run.trigger_kind} = 'manual')
        limit 2 for update of schedule
      `));
      if (schedule.length !== 1) return false;
      const locked = rows<RunRow>(await transaction.execute(sql`
        select ${RUN_COLUMNS} from meta_read_sync_schedule_runs
        where id = ${run.id}::uuid and idempotency_key = ${input.idempotencyKey}
          and state = 'running' and lease_token = ${input.leaseToken}
        limit 2 for update
      `));
      if (locked.length !== 1) return false;
      if (run.trigger_kind === "interval_6h") {
        const advanced = rows<{ id: string }>(await transaction.execute(sql`
          update meta_read_sync_schedules set revision = revision + 1,
            next_due_at = next_due_at + interval '6 hours', updated_at = now()
          where id = ${run.schedule_id}::uuid and workspace_id = ${run.workspace_id}::uuid
            and connection_id = ${run.connection_id}::uuid and revision = ${run.schedule_revision}
            and next_due_at = ${storedInstant(run.scheduled_for)}::timestamptz
          returning id
        `));
        if (advanced.length !== 1) fail("lease_conflict");
      }
      const completed = rows<{ id: string }>(await transaction.execute(sql`
        update meta_read_sync_schedule_runs set state = 'completed', lease_token = null, lease_until = null,
          completed_at = ${completedAt}::timestamptz, failed_at = null, failure_reason = null, retryable = null,
          updated_at = now()
        where id = ${run.id}::uuid and state = 'running' and lease_token = ${input.leaseToken}
        returning id
      `));
      if (completed.length !== 1) fail("lease_conflict");
      return true;
    });
  }

  async fail(input: Parameters<MetaReadSyncLeasePort["fail"]>[0]): Promise<boolean> {
    if (!exact(input, ["idempotencyKey", "leaseToken", "failedAt", "reason", "retryable"])
      || typeof input.idempotencyKey !== "string" || !IDEMPOTENCY.test(input.idempotencyKey)
      || typeof input.leaseToken !== "string" || !LEASE.test(input.leaseToken)
      || typeof input.reason !== "string" || !FAILURE_REASONS.has(input.reason)
      || typeof input.retryable !== "boolean") fail("invalid_input");
    const failedAt = instant(input.failedAt);
    return this.database.transaction(async (transaction) => {
      const preview = rows<RunRow>(await transaction.execute(sql`
        select ${RUN_COLUMNS} from meta_read_sync_schedule_runs
        where idempotency_key = ${input.idempotencyKey} and state = 'running' and lease_token = ${input.leaseToken}
        limit 2
      `));
      if (preview.length !== 1) return false;
      const run = preview[0]!;
      const terminal = !input.retryable || run.attempt >= MAX_ATTEMPTS;
      if (terminal) {
        const schedule = rows<{ id: string }>(await transaction.execute(sql`
          select schedule.id from meta_read_sync_schedules schedule
          join workspaces workspace on workspace.id = schedule.workspace_id
          join meta_connections connection
            on connection.workspace_id = schedule.workspace_id and connection.id = schedule.connection_id
          where ${ACTIVE_BINDING} and schedule.workspace_id = ${run.workspace_id}::uuid
            and schedule.id = ${run.schedule_id}::uuid and schedule.connection_id = ${run.connection_id}::uuid
            and schedule.revision = ${run.schedule_revision}
            and (schedule.next_due_at = ${storedInstant(run.scheduled_for)}::timestamptz or ${run.trigger_kind} = 'manual')
          limit 2 for update of schedule
        `));
        if (schedule.length === 1 && run.trigger_kind === "interval_6h") {
          const locked = rows<RunRow>(await transaction.execute(sql`
            select ${RUN_COLUMNS} from meta_read_sync_schedule_runs
            where id = ${run.id}::uuid and state = 'running' and lease_token = ${input.leaseToken}
            limit 2 for update
          `));
          if (locked.length !== 1) return false;
          const advanced = rows<{ id: string }>(await transaction.execute(sql`
            update meta_read_sync_schedules set revision = revision + 1,
              next_due_at = next_due_at + interval '6 hours', updated_at = now()
            where id = ${run.schedule_id}::uuid and workspace_id = ${run.workspace_id}::uuid
              and connection_id = ${run.connection_id}::uuid and revision = ${run.schedule_revision}
              and next_due_at = ${storedInstant(run.scheduled_for)}::timestamptz
            returning id
          `));
          if (advanced.length !== 1) fail("lease_conflict");
        }
      }
      const changed = rows<{ id: string }>(await transaction.execute(sql`
        update meta_read_sync_schedule_runs set state = 'failed', lease_token = null, lease_until = null,
          failed_at = ${failedAt}::timestamptz, completed_at = null, failure_reason = ${input.reason},
          retryable = ${input.retryable}, updated_at = now()
        where id = ${run.id}::uuid and state = 'running' and lease_token = ${input.leaseToken}
        returning id
      `));
      return changed.length === 1;
    });
  }
}
