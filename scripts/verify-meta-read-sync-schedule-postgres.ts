import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { META_READ_SYNC_SCHEDULE_WORKER_VERSION } from "@/application/meta-read-sync-schedule-worker";
import * as schema from "@/db/schema";
import { DrizzleMetaReadSyncLease, DrizzleMetaReadSyncScheduleRegistry } from "@/server/meta-read-sync-schedule-drizzle-adapters";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const databaseUrl = process.env.DIRECT_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("Supabase PostgreSQL bağlantısı yapılandırılmadı");

const workspaceId = randomUUID();
const connectionId = randomUUID();
const scheduleId = randomUUID();
const scheduledFor = "2026-08-08T03:00:00.000Z";
const now = "2026-08-08T04:00:00.000Z";
const leaseUntil = "2026-08-08T04:05:00.000Z";
const rollback = Symbol("rollback");
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 30_000 });
const database = drizzle(pool, { schema });
let dueDerived = false;
let claimed = false;
let wrongTokenRejected = false;
let completed = false;
let cursorAdvanced = false;
let duplicateCompleted = false;
let manualBlockedByAutomatic = false;
let manualCompleted = false;
let manualCursorUnchanged = false;
let manualReplayCompleted = false;
let rollbackClean = false;

try {
  await database.transaction(async (transaction) => {
    await transaction.insert(schema.workspaces).values({ id: workspaceId, name: "Meta schedule acceptance workspace" });
    await transaction.insert(schema.metaConnections).values({
      id: connectionId,
      workspaceId,
      externalConnectionKey: `schedule_acceptance_${connectionId.replaceAll("-", "")}`,
      displayName: "Meta schedule acceptance connection",
      graphApiVersion: "v23.0",
      fieldCatalogVersion: "meta-inventory-field-catalog/2.0.0",
      accessMode: "read_only",
      status: "active",
    });
    await transaction.insert(schema.metaReadSyncSchedules).values({
      id: scheduleId,
      workspaceId,
      connectionId,
      revision: 1,
      workspaceLifecycleGeneration: 1,
      connectionLifecycleGeneration: 1,
      timeframeDays: 7,
      nextDueAt: new Date(scheduledFor),
      enabled: true,
    });

    const registry = new DrizzleMetaReadSyncScheduleRegistry(transaction as never);
    const lease = new DrizzleMetaReadSyncLease(transaction as never);
    const candidates = await registry.listDue(now, 10);
    if (candidates.length !== 1) throw new Error("Schedule due candidate üretilemedi");
    const candidate = candidates[0]!;
    dueDerived = candidate.workspaceId === workspaceId && candidate.connectionId === connectionId
      && candidate.scopeRevision === 1 && candidate.dateStart === "2026-08-01" && candidate.dateStop === "2026-08-07";
    const scopeKey = digest(["scope", candidate.workspaceId, candidate.connectionId]);
    const fireHash = digest([META_READ_SYNC_SCHEDULE_WORKER_VERSION, candidate.triggerKind, candidate.scheduledFor,
      candidate.workspaceId, candidate.connectionId, candidate.scopeRevision, candidate.dateStart, candidate.dateStop]);
    const idempotencyKey = `syncfire_${fireHash}`;
    const first = await lease.claim({ idempotencyKey, scopeKey, workspaceId, connectionId, scopeRevision: 1,
      triggerKind: candidate.triggerKind, scheduledFor: candidate.scheduledFor,
      dateStart: candidate.dateStart, dateStop: candidate.dateStop, now, leaseUntil });
    if (first.status !== "claimed") throw new Error("Schedule lease claim başarısız");
    claimed = first.attempt === 1;
    const manualAt = "2026-08-08T04:01:00.000Z";
    const manualCandidate = await registry.resolveManual(workspaceId, manualAt);
    if (!manualCandidate) throw new Error("Manual candidate üretilemedi");
    const manualFireHashWhileAutomatic = digest([META_READ_SYNC_SCHEDULE_WORKER_VERSION, manualCandidate.triggerKind,
      manualCandidate.scheduledFor, manualCandidate.workspaceId, manualCandidate.connectionId,
      manualCandidate.scopeRevision, manualCandidate.dateStart, manualCandidate.dateStop]);
    const blockedManual = await lease.claim({ idempotencyKey: `syncfire_${manualFireHashWhileAutomatic}`, scopeKey,
      workspaceId, connectionId, scopeRevision: manualCandidate.scopeRevision, triggerKind: "manual",
      scheduledFor: manualCandidate.scheduledFor, dateStart: manualCandidate.dateStart,
      dateStop: manualCandidate.dateStop, now: manualAt, leaseUntil: "2026-08-08T04:06:00.000Z" });
    manualBlockedByAutomatic = blockedManual.status === "duplicate_in_progress";
    wrongTokenRejected = !(await lease.complete({
      idempotencyKey,
      leaseToken: `lease_${"f".repeat(32)}`,
      completedAt: now,
    }));
    completed = await lease.complete({ idempotencyKey, leaseToken: first.leaseToken, completedAt: now });
    const scheduleRows = await transaction.select({ revision: schema.metaReadSyncSchedules.revision,
      nextDueAt: schema.metaReadSyncSchedules.nextDueAt }).from(schema.metaReadSyncSchedules).where(and(
      eq(schema.metaReadSyncSchedules.workspaceId, workspaceId),
      eq(schema.metaReadSyncSchedules.id, scheduleId),
    ));
    cursorAdvanced = scheduleRows[0]?.revision === 2
      && scheduleRows[0]?.nextDueAt.toISOString() === "2026-08-08T09:00:00.000Z";
    const replay = await lease.claim({ idempotencyKey, scopeKey, workspaceId, connectionId,
      scopeRevision: 1, triggerKind: candidate.triggerKind, scheduledFor: candidate.scheduledFor,
      dateStart: candidate.dateStart, dateStop: candidate.dateStop, now, leaseUntil });
    duplicateCompleted = replay.status === "duplicate_completed" && replay.attempt === 1;

    const manualAfterAt = "2026-08-08T04:10:00.000Z";
    const manualAfter = await registry.resolveManual(workspaceId, manualAfterAt);
    if (!manualAfter || manualAfter.scopeRevision !== 2) throw new Error("Manual post-schedule candidate üretilemedi");
    const manualFireHash = digest([META_READ_SYNC_SCHEDULE_WORKER_VERSION, manualAfter.triggerKind,
      manualAfter.scheduledFor, manualAfter.workspaceId, manualAfter.connectionId, manualAfter.scopeRevision,
      manualAfter.dateStart, manualAfter.dateStop]);
    const manualKey = `syncfire_${manualFireHash}`;
    const manualLease = await lease.claim({ idempotencyKey: manualKey, scopeKey, workspaceId, connectionId,
      scopeRevision: manualAfter.scopeRevision, triggerKind: "manual", scheduledFor: manualAfter.scheduledFor,
      dateStart: manualAfter.dateStart, dateStop: manualAfter.dateStop, now: manualAfterAt,
      leaseUntil: "2026-08-08T04:15:00.000Z" });
    if (manualLease.status !== "claimed") throw new Error("Manual lease claim başarısız");
    manualCompleted = await lease.complete({ idempotencyKey: manualKey, leaseToken: manualLease.leaseToken,
      completedAt: manualAfterAt });
    const afterManual = await transaction.select({ revision: schema.metaReadSyncSchedules.revision,
      nextDueAt: schema.metaReadSyncSchedules.nextDueAt }).from(schema.metaReadSyncSchedules).where(and(
      eq(schema.metaReadSyncSchedules.workspaceId, workspaceId), eq(schema.metaReadSyncSchedules.id, scheduleId)));
    manualCursorUnchanged = afterManual[0]?.revision === 2
      && afterManual[0]?.nextDueAt.toISOString() === "2026-08-08T09:00:00.000Z";
    const manualReplay = await lease.claim({ idempotencyKey: manualKey, scopeKey, workspaceId, connectionId,
      scopeRevision: manualAfter.scopeRevision, triggerKind: "manual", scheduledFor: manualAfter.scheduledFor,
      dateStart: manualAfter.dateStart, dateStop: manualAfter.dateStop, now: manualAfterAt,
      leaseUntil: "2026-08-08T04:15:00.000Z" });
    manualReplayCompleted = manualReplay.status === "duplicate_completed" && manualReplay.attempt === 1;

    if (!dueDerived || !claimed || !manualBlockedByAutomatic || !wrongTokenRejected || !completed || !cursorAdvanced
      || !duplicateCompleted || !manualCompleted || !manualCursorUnchanged || !manualReplayCompleted) {
      throw new Error("Meta read-sync schedule PostgreSQL acceptance failed");
    }
    throw rollback;
  });
} catch (error) {
  if (error !== rollback) throw error;
}

try {
  const workspaces = await database.select({ id: schema.workspaces.id }).from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId));
  const schedules = await database.select({ id: schema.metaReadSyncSchedules.id }).from(schema.metaReadSyncSchedules)
    .where(eq(schema.metaReadSyncSchedules.workspaceId, workspaceId));
  const runs = await database.select({ id: schema.metaReadSyncScheduleRuns.id }).from(schema.metaReadSyncScheduleRuns)
    .where(eq(schema.metaReadSyncScheduleRuns.workspaceId, workspaceId));
  rollbackClean = workspaces.length === 0 && schedules.length === 0 && runs.length === 0;
  if (!rollbackClean) throw new Error("Meta schedule acceptance rollback cleanup failed");
} finally {
  await pool.end();
}

console.log(JSON.stringify({
  dueDerived,
  claimed,
  wrongTokenRejected,
  completed,
  cursorAdvanced,
  duplicateCompleted,
  manualBlockedByAutomatic,
  manualCompleted,
  manualCursorUnchanged,
  manualReplayCompleted,
  rollbackClean,
  temporaryRowsCommitted: false,
  cronActivated: false,
  metaNetworkCalls: 0,
  metaWriteCalls: 0,
}));
