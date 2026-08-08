import { createHash } from "node:crypto";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

import { META_READ_SYNC_SCHEDULE_WORKER_VERSION } from "@/application/meta-read-sync-schedule-worker";
import {
  DrizzleMetaReadSyncLease,
  DrizzleMetaReadSyncScheduleRegistry,
} from "@/server/meta-read-sync-schedule-drizzle-adapters";

const workspaceId = "11111111-1111-4111-a111-111111111111";
const connectionId = "22222222-2222-4222-a222-222222222222";
const scheduleId = "33333333-3333-4333-a333-333333333333";
const runId = "44444444-4444-4444-a444-444444444444";
const now = "2026-08-08T04:00:00.000Z";
const leaseUntil = "2026-08-08T04:05:00.000Z";
const candidate = Object.freeze({ workspaceId, connectionId, scopeRevision: 7, triggerKind: "daily" as const,
  scheduledFor: "2026-08-08T03:00:00.000Z", dateStart: "2026-08-07", dateStop: "2026-08-07" });
const scheduleRow = Object.freeze({ id: scheduleId, workspace_id: workspaceId, connection_id: connectionId,
  revision: 7, trigger_kind: "daily" as const, timeframe_days: 1, next_due_at: candidate.scheduledFor });
function digest(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
const scopeKey = digest(["scope", workspaceId, connectionId]);
const idempotencyKey = `syncfire_${digest([META_READ_SYNC_SCHEDULE_WORKER_VERSION, "daily", candidate.scheduledFor,
  workspaceId, connectionId, 7, candidate.dateStart, candidate.dateStop])}`;
const token = `lease_${"a".repeat(32)}`;
function runRow(patch: Record<string, unknown> = {}) {
  return { id: runId, workspace_id: workspaceId, schedule_id: scheduleId, connection_id: connectionId,
    schedule_revision: 7, idempotency_key: idempotencyKey, scope_key: scopeKey, trigger_kind: "daily",
    scheduled_for: candidate.scheduledFor, date_start: candidate.dateStart, date_stop: candidate.dateStop,
    state: "running", lease_token: token, lease_until: leaseUntil, attempt: 1, retryable: null, ...patch };
}
function claimInput(patch: Record<string, unknown> = {}) {
  return { idempotencyKey, scopeKey, workspaceId, connectionId, scopeRevision: 7, now, leaseUntil, ...patch };
}
function database(results: readonly unknown[]) {
  const execute = vi.fn();
  for (const result of results) execute.mockResolvedValueOnce(result);
  const transaction = vi.fn(async (callback: (tx: { execute: typeof execute }) => Promise<unknown>) => callback({ execute }));
  return { execute, transaction };
}

describe("Drizzle Meta read-sync schedule registry", () => {
  it("lists only deterministic DB-derived due bindings and timeframe", async () => {
    const db = database([{ rows: [scheduleRow] }]);
    await expect(new DrizzleMetaReadSyncScheduleRegistry(db as never).listDue(now, 25)).resolves.toEqual([candidate]);
    const query = new PgDialect().sqlToQuery(db.execute.mock.calls[0]![0]).sql;
    for (const condition of ["workspace.lifecycle_state = 'active'", "connection.status = 'active'",
      "connection.access_mode = 'read_only'", "workspace.lifecycle_generation = schedule.workspace_lifecycle_generation",
      "connection.lifecycle_generation = schedule.connection_lifecycle_generation", "schedule.next_due_at <="]) {
      expect(query).toContain(condition);
    }
    expect(query).toContain("order by schedule.next_due_at, schedule.workspace_id, schedule.connection_id");
  });

  it("normalizes PostgreSQL timestamptz text before deriving the candidate", async () => {
    const db = database([{ rows: [{ ...scheduleRow, next_due_at: "2026-08-08 03:00:00+00" }] }]);
    await expect(new DrizzleMetaReadSyncScheduleRegistry(db as never).listDue(now, 25)).resolves.toEqual([candidate]);
  });

  it("revalidates the exact revision, due instant and all derived candidate fields", async () => {
    const valid = database([{ rows: [scheduleRow] }]);
    await expect(new DrizzleMetaReadSyncScheduleRegistry(valid as never).revalidate(candidate)).resolves.toEqual(candidate);
    const stale = database([{ rows: [{ ...scheduleRow, timeframe_days: 7 }] }]);
    await expect(new DrizzleMetaReadSyncScheduleRegistry(stale as never).revalidate(candidate)).resolves.toBeNull();
    const absent = database([{ rows: [] }]);
    await expect(new DrizzleMetaReadSyncScheduleRegistry(absent as never).revalidate(candidate)).resolves.toBeNull();
  });
});

describe("Drizzle Meta read-sync atomic lease", () => {
  it("re-derives logical identity under a schedule row lock before first claim", async () => {
    const db = database([{ rows: [scheduleRow] }, { rows: [] }, { rows: [{ id: runId }] }]);
    await expect(new DrizzleMetaReadSyncLease(db as never).claim(claimInput())).resolves.toMatchObject({
      status: "claimed", leaseToken: expect.stringMatching(/^lease_[a-f0-9]{32}$/), attempt: 1,
    });
    const query = new PgDialect().sqlToQuery(db.execute.mock.calls[0]![0]).sql;
    expect(query).toContain("for update of schedule");
    expect(query).toContain("connection.access_mode = 'read_only'");
  });

  it("returns duplicate states, retries expired/retryable work, and caps attempts", async () => {
    const completed = database([{ rows: [{ ...scheduleRow, revision: 8, next_due_at: "2026-08-09T03:00:00.000Z" }] },
      { rows: [runRow({ state: "completed", lease_token: null,
      lease_until: null, attempt: 2 })] }]);
    await expect(new DrizzleMetaReadSyncLease(completed as never).claim(claimInput()))
      .resolves.toEqual({ status: "duplicate_completed", attempt: 2 });
    const inProgress = database([{ rows: [scheduleRow] }, { rows: [runRow()] }]);
    await expect(new DrizzleMetaReadSyncLease(inProgress as never).claim(claimInput()))
      .resolves.toEqual({ status: "duplicate_in_progress", attempt: 1 });
    const expired = database([{ rows: [scheduleRow] }, { rows: [runRow({ lease_until: "2026-08-08T03:59:00.000Z" })] },
      { rows: [{ id: runId }] }]);
    await expect(new DrizzleMetaReadSyncLease(expired as never).claim(claimInput())).resolves.toMatchObject({ status: "claimed", attempt: 2 });
    const retryable = database([{ rows: [scheduleRow] }, { rows: [runRow({ state: "failed", lease_token: null,
      lease_until: null, retryable: true, attempt: 2 })] }, { rows: [{ id: runId }] }]);
    await expect(new DrizzleMetaReadSyncLease(retryable as never).claim(claimInput())).resolves.toMatchObject({ status: "claimed", attempt: 3 });
    const capped = database([{ rows: [scheduleRow] }, { rows: [runRow({ state: "failed", lease_token: null,
      lease_until: null, retryable: true, attempt: 5 })] }]);
    await expect(new DrizzleMetaReadSyncLease(capped as never).claim(claimInput()))
      .resolves.toEqual({ status: "duplicate_in_progress", attempt: 5 });
  });

  it("fails closed on changed scope revision, forged identity and cross-tenant stored run", async () => {
    const stale = database([{ rows: [] }]);
    await expect(new DrizzleMetaReadSyncLease(stale as never).claim(claimInput())).rejects.toMatchObject({ code: "scope_revision_changed" });
    const forged = database([{ rows: [scheduleRow] }, { rows: [] }]);
    await expect(new DrizzleMetaReadSyncLease(forged as never).claim(claimInput({ scopeKey: "f".repeat(64) })))
      .rejects.toMatchObject({ code: "scope_revision_changed" });
    const crossTenant = database([{ rows: [scheduleRow] }, { rows: [runRow({
      workspace_id: "55555555-5555-4555-a555-555555555555",
    })] }]);
    await expect(new DrizzleMetaReadSyncLease(crossTenant as never).claim(claimInput()))
      .rejects.toMatchObject({ code: "corrupt_store" });
  });

  it("completes token-bound work and advances the exact daily cursor atomically", async () => {
    const db = database([{ rows: [runRow()] }, { rows: [{ id: scheduleId }] }, { rows: [runRow()] },
      { rows: [{ id: scheduleId }] }, { rows: [{ id: runId }] }]);
    await expect(new DrizzleMetaReadSyncLease(db as never).complete({ idempotencyKey, leaseToken: token, completedAt: now }))
      .resolves.toBe(true);
    const dialect = new PgDialect();
    const statements = db.execute.mock.calls.map((call) => dialect.sqlToQuery(call[0]).sql).join("\n");
    expect(statements).toContain("revision = revision + 1");
    expect(statements).toContain("next_due_at = next_due_at + interval '1 day'");
    expect(statements).toContain("state = 'completed'");
  });

  it("rejects a lost token and records only closed failure reasons", async () => {
    const lost = database([{ rows: [] }]);
    await expect(new DrizzleMetaReadSyncLease(lost as never).complete({ idempotencyKey, leaseToken: token, completedAt: now }))
      .resolves.toBe(false);
    const failed = database([{ rows: [runRow()] }, { rows: [{ id: runId }] }]);
    await expect(new DrizzleMetaReadSyncLease(failed as never).fail({ idempotencyKey, leaseToken: token,
      failedAt: now, reason: "rate_limited", retryable: true })).resolves.toBe(true);
    const terminal = database([{ rows: [runRow({ attempt: 5 })] }, { rows: [{ id: scheduleId }] },
      { rows: [runRow({ attempt: 5 })] }, { rows: [{ id: scheduleId }] }, { rows: [{ id: runId }] }]);
    await expect(new DrizzleMetaReadSyncLease(terminal as never).fail({ idempotencyKey, leaseToken: token,
      failedAt: now, reason: "rate_limited", retryable: true })).resolves.toBe(true);
    const terminalSql = terminal.execute.mock.calls.map((call) => new PgDialect().sqlToQuery(call[0]).sql).join("\n");
    expect(terminalSql).toContain("next_due_at = next_due_at + interval '1 day'");
    const bad = database([]);
    await expect(new DrizzleMetaReadSyncLease(bad as never).fail({ idempotencyKey, leaseToken: token,
      failedAt: now, reason: "token leaked" as never, retryable: true })).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("exposes only the exact registry and lease port methods", () => {
    expect(Object.getOwnPropertyNames(DrizzleMetaReadSyncScheduleRegistry.prototype).sort())
      .toEqual(["constructor", "listDue", "revalidate"]);
    expect(Object.getOwnPropertyNames(DrizzleMetaReadSyncLease.prototype).sort())
      .toEqual(["claim", "complete", "constructor", "fail"]);
  });
});
