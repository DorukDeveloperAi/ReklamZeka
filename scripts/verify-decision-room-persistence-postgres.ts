import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { runDecisionRoomScheduleWorker } from "@/application/decision-room-schedule-worker";
import {
  DrizzleDecisionRoomInbox,
  DrizzleDecisionRoomRunStore,
  DrizzleDecisionRoomScheduleRegistry,
} from "@/connectors/decisions/decision-room-drizzle-adapters";
import * as schema from "@/db/schema";
import { DecisionRoomExecutor } from "@/domain/decisions/executor";
import { DECISION_ROOM_SCHEDULE_VERSION, type DecisionRoomSchedule } from "@/domain/decisions/schedule";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL yapılandırılmadı");

const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 20_000 });
const database = drizzle(pool, { schema });
const rollback = Symbol("rollback");

const workspaceId = randomUUID();
const foreignWorkspaceId = randomUUID();
const connectionId = randomUUID();
const dataSourceId = randomUUID();
const accountId = randomUUID();
const campaignId = randomUUID();
const secondCampaignId = randomUUID();
const idempotencyKey = `idempotency_${"a".repeat(32)}`;
const retryKey = `idempotency_${"b".repeat(32)}`;
const scopeKey = "c".repeat(64);

let appliedProductionTablesVerified = false;
let scheduleRoundTrip = false;
let historicalScheduleRevision = false;
let immutableScheduleDefinition = false;
let manualAssetBinding = false;
let scheduledAssetBinding = false;
let crossCombinationBlocked = false;
let hashMismatchBlocked = false;
let crossAssetClaimBlocked = false;
let assetChainEnforced = false;
let duplicateInProgress = false;
let overlapSuppressed = false;
let leaseTokenEnforced = false;
let retryStable = false;
let duplicateCompleted = false;
let inboxDeduplicated = false;
let readStateIdempotent = false;
let invalidReaderRefBlocked = false;
let crossTenantReadBlocked = false;
let externalChannelBlocked = false;
let authorityColumnAbsent = false;
let dueListingBounded = false;
let disabledSupersededExcluded = false;
let workerPartialIsolation = false;
let workerCatchUp = false;
let concurrentWorkerSingleRun = false;
let revisionRaceTickBlocked = false;
let temporaryRowsCommitted = true;

const schedule: DecisionRoomSchedule = {
  version: DECISION_ROOM_SCHEDULE_VERSION,
  scheduleRef: "schedule_daily",
  workspaceRef: "workspace_safe",
  accountRef: "account_safe",
  campaignRef: "campaign_safe",
  timeframeRef: "timeframe_7d",
  templateRef: "template_daily",
  timezone: "Europe/Istanbul",
  localTime: "09:00",
  enabled: true,
  catchUpPolicy: "run_once",
  tickGraceMinutes: 5,
  dstPolicy: { gap: "next_valid", overlap: "first_occurrence" },
  notificationChannel: "in_app_inbox",
  frequency: "daily",
};

function resultRows(result: unknown): readonly Record<string, unknown>[] {
  if (!result || typeof result !== "object" || !("rows" in result) || !Array.isArray(result.rows)) return [];
  return result.rows as readonly Record<string, unknown>[];
}

try {
  await database.transaction(async (transaction) => {
    const applied = resultRows(await transaction.execute(sql`
      select
        to_regclass('public.decision_room_schedules')::text as schedules,
        to_regclass('public.decision_room_runs')::text as runs,
        to_regclass('public.decision_room_inbox_items')::text as inbox_items,
        to_regclass('public.decision_room_inbox_reads')::text as inbox_reads
    `))[0];
    appliedProductionTablesVerified = Boolean(
      applied?.schedules && applied?.runs && applied?.inbox_items && applied?.inbox_reads,
    );
    if (!appliedProductionTablesVerified) throw new Error("S2.7 migration uygulanmadı");

    await transaction.insert(schema.workspaces).values([
      { id: workspaceId, name: "Decision Room Persistence E2E" },
      { id: foreignWorkspaceId, name: "Foreign Decision Room E2E" },
    ]);
    await transaction.insert(schema.metaConnections).values({
      id: connectionId, workspaceId, externalConnectionKey: "decision-room", displayName: "Decision Room",
      graphApiVersion: "v1", fieldCatalogVersion: "fields-v1", status: "active",
    });
    await transaction.insert(schema.dataSources).values({
      id: dataSourceId, workspaceId, metaConnectionId: connectionId, platform: "meta_ads",
      externalAccountId: "account_safe", displayName: "Decision Room account",
    });
    await transaction.insert(schema.adAccounts).values({
      id: accountId, workspaceId, dataSourceId, externalAccountId: "account_safe",
      name: "Decision Room", currency: "TRY", timezone: "Europe/Istanbul",
    });
    await transaction.insert(schema.adCampaigns).values([
      { id: campaignId, workspaceId, adAccountId: accountId, externalCampaignId: "campaign_safe", name: "Decision Room campaign" },
      { id: secondCampaignId, workspaceId, adAccountId: accountId, externalCampaignId: "campaign_other", name: "Other campaign" },
    ]);

    const registry = new DrizzleDecisionRoomScheduleRegistry(transaction as never, workspaceId);
    await registry.save(schedule, "2026-08-08T06:00:00Z");
    const restored = await registry.get(schedule.scheduleRef);
    scheduleRoundTrip = restored?.schedule.scheduleRef === schedule.scheduleRef
      && restored.revision === 1
      && restored.nextRunAt === "2026-08-08T06:00:00.000Z"
      && await registry.recordTick({
        scheduleRef: schedule.scheduleRef,
        revision: restored.revision,
        definitionHash: restored.definitionHash,
        scheduledFor: "2026-08-08T06:00:00Z",
        nextRunAt: "2026-08-09T06:00:00Z",
      });

    const scheduledStore = new DrizzleDecisionRoomRunStore(transaction as never, workspaceId);
    const scheduledFirst = await scheduledStore.claim({
      idempotencyKey: `idempotency_${"e".repeat(32)}`, scopeKey: "f".repeat(64),
      triggerKind: "scheduled", scheduleRef: schedule.scheduleRef,
      scheduleDefinitionHash: restored!.definitionHash,
      accountRef: "account_safe", campaignRef: "campaign_safe",
      now: "2026-08-07T10:00:00Z", leaseUntil: "2026-08-07T10:05:00Z",
    });
    if (scheduledFirst.status !== "claimed") throw new Error("Scheduled run claim alınamadı");
    if (!await scheduledStore.fail({
      idempotencyKey: `idempotency_${"e".repeat(32)}`, leaseToken: scheduledFirst.leaseToken,
    })) throw new Error("Scheduled run retry hazırlığı başarısız");
    await registry.save({ ...schedule, localTime: "10:00" }, "2026-08-08T07:00:00Z");
    const scheduledRetry = await scheduledStore.claim({
      idempotencyKey: `idempotency_${"e".repeat(32)}`, scopeKey: "f".repeat(64),
      triggerKind: "scheduled", scheduleRef: schedule.scheduleRef,
      scheduleDefinitionHash: restored!.definitionHash,
      accountRef: "account_safe", campaignRef: "campaign_safe",
      now: "2026-08-07T10:01:00Z", leaseUntil: "2026-08-07T10:06:00Z",
    });
    const revisionEvidence = resultRows(await transaction.execute(sql`
      select run.trigger_kind, run.ad_account_id, run.campaign_id, schedule.revision,
        schedule.superseded_at, schedule.next_run_at,
        (select max(revision) from decision_room_schedules latest
          where latest.workspace_id = run.workspace_id and latest.schedule_ref = schedule.schedule_ref) as latest_revision
      from decision_room_runs run
      join decision_room_schedules schedule
        on schedule.workspace_id = run.workspace_id and schedule.id = run.schedule_id
      where run.workspace_id = ${workspaceId}::uuid and run.run_ref = ${scheduledFirst.runRef}
    `))[0];
    historicalScheduleRevision = scheduledRetry.status === "claimed"
      && scheduledRetry.runRef === scheduledFirst.runRef && scheduledRetry.attempt === 2
      && Number(revisionEvidence?.revision) === 1 && Number(revisionEvidence?.latest_revision) === 2
      && revisionEvidence?.superseded_at !== null && revisionEvidence?.next_run_at === null;
    scheduledAssetBinding = revisionEvidence?.trigger_kind === "scheduled"
      && revisionEvidence?.ad_account_id === accountId && revisionEvidence?.campaign_id === campaignId;
    try {
      await scheduledStore.claim({
        idempotencyKey: `idempotency_${"4".repeat(32)}`, scopeKey: "5".repeat(64),
        triggerKind: "scheduled", scheduleRef: schedule.scheduleRef, scheduleDefinitionHash: "6".repeat(64),
        accountRef: "account_safe", campaignRef: "campaign_safe",
        now: "2026-08-07T10:02:00Z", leaseUntil: "2026-08-07T10:07:00Z",
      });
    } catch {
      hashMismatchBlocked = true;
    }
    try {
      await scheduledStore.claim({
        idempotencyKey: `idempotency_${"7".repeat(32)}`, scopeKey: "8".repeat(64),
        triggerKind: "scheduled", scheduleRef: schedule.scheduleRef,
        scheduleDefinitionHash: restored!.definitionHash,
        accountRef: "account_safe", campaignRef: "campaign_other",
        now: "2026-08-07T10:02:00Z", leaseUntil: "2026-08-07T10:07:00Z",
      });
    } catch {
      crossAssetClaimBlocked = true;
    }
    const scheduleBinding = resultRows(await transaction.execute(sql`
      select id, definition_hash from decision_room_schedules
      where workspace_id = ${workspaceId}::uuid and schedule_ref = ${schedule.scheduleRef} and revision = 1
    `))[0];
    try {
      await transaction.transaction(async (savepoint) => {
        await savepoint.execute(sql`
          insert into decision_room_runs (
            workspace_id, schedule_id, ad_account_id, campaign_id, trigger_kind, schedule_definition_hash,
            idempotency_key, scope_key, run_ref, state, attempt, failed_at
          ) values (
            ${workspaceId}::uuid, ${String(scheduleBinding?.id)}::uuid, ${accountId}::uuid, ${secondCampaignId}::uuid,
            'scheduled', ${String(scheduleBinding?.definition_hash)}, ${`idempotency_${"1".repeat(32)}`},
            ${"2".repeat(64)}, ${`run_${"3".repeat(20)}`}, 'failed', 1, now()
          )
        `);
      });
    } catch {
      crossCombinationBlocked = true;
    }
    try {
      await transaction.transaction(async (savepoint) => {
        await savepoint.execute(sql`
          update decision_room_schedules set template_ref = 'template_mutated'
          where workspace_id = ${workspaceId}::uuid and schedule_ref = ${schedule.scheduleRef} and revision = 1
        `);
      });
    } catch {
      immutableScheduleDefinition = true;
    }
    try {
      await new DrizzleDecisionRoomScheduleRegistry(transaction as never, foreignWorkspaceId).save(schedule);
    } catch {
      assetChainEnforced = true;
    }

    const store = new DrizzleDecisionRoomRunStore(transaction as never, workspaceId);
    const first = await store.claim({
      idempotencyKey, scopeKey, now: "2026-08-07T12:00:00Z", leaseUntil: "2026-08-07T12:05:00Z",
      triggerKind: "manual", scheduleRef: null, scheduleDefinitionHash: null,
      accountRef: "account_safe", campaignRef: "campaign_safe",
    });
    if (first.status !== "claimed") throw new Error("İlk run claim alınamadı");
    const manualBinding = resultRows(await transaction.execute(sql`
      select trigger_kind, schedule_id, ad_account_id, campaign_id from decision_room_runs
      where workspace_id = ${workspaceId}::uuid and run_ref = ${first.runRef}
    `))[0];
    manualAssetBinding = manualBinding?.trigger_kind === "manual" && manualBinding.schedule_id === null
      && manualBinding.ad_account_id === accountId && manualBinding.campaign_id === campaignId;
    duplicateInProgress = (await store.claim({
      idempotencyKey, scopeKey, now: "2026-08-07T12:01:00Z", leaseUntil: "2026-08-07T12:06:00Z",
      triggerKind: "manual", scheduleRef: null, scheduleDefinitionHash: null,
      accountRef: "account_safe", campaignRef: "campaign_safe",
    })).status === "duplicate_in_progress";
    overlapSuppressed = (await store.claim({
      idempotencyKey: retryKey, scopeKey, now: "2026-08-07T12:01:00Z", leaseUntil: "2026-08-07T12:06:00Z",
      triggerKind: "manual", scheduleRef: null, scheduleDefinitionHash: null,
      accountRef: "account_safe", campaignRef: "campaign_safe",
    })).status === "overlap_suppressed";
    leaseTokenEnforced = !await store.complete({
      idempotencyKey, leaseToken: randomUUID(), completion: { analysisRef: "analysis_safe", summaryCode: "ready" },
    });
    if (!await store.fail({ idempotencyKey, leaseToken: first.leaseToken })) throw new Error("Run fail state yazılamadı");
    const retry = await store.claim({
      idempotencyKey, scopeKey, now: "2026-08-07T12:02:00Z", leaseUntil: "2026-08-07T12:07:00Z",
      triggerKind: "manual", scheduleRef: null, scheduleDefinitionHash: null,
      accountRef: "account_safe", campaignRef: "campaign_safe",
    });
    retryStable = retry.status === "claimed" && retry.runRef === first.runRef && retry.attempt === 2;
    if (retry.status !== "claimed" || !await store.complete({
      idempotencyKey, leaseToken: retry.leaseToken,
      completion: { analysisRef: "analysis_safe", summaryCode: "analysis_ready" },
    })) throw new Error("Retry completion yazılamadı");
    duplicateCompleted = (await store.claim({
      idempotencyKey, scopeKey, now: "2026-08-07T12:03:00Z", leaseUntil: "2026-08-07T12:08:00Z",
      triggerKind: "manual", scheduleRef: null, scheduleDefinitionHash: null,
      accountRef: "account_safe", campaignRef: "campaign_safe",
    })).status === "duplicate_completed";

    const inbox = new DrizzleDecisionRoomInbox(transaction as never, workspaceId);
    const notification = {
      notificationRef: `inbox_${"d".repeat(20)}`,
      channel: "in_app_inbox" as const,
      runRef: first.runRef,
      analysisRef: "analysis_safe",
      summaryCode: "analysis_ready",
      actionAuthority: "none" as const,
    };
    await inbox.publish(notification);
    await inbox.publish(notification);
    inboxDeduplicated = (await inbox.list("reader_owner")).length === 1;
    const firstRead = await inbox.markRead({
      notificationRef: notification.notificationRef, readerRef: "reader_owner", readAt: "2026-08-07T12:04:00Z",
    });
    const duplicateRead = await inbox.markRead({
      notificationRef: notification.notificationRef, readerRef: "reader_owner", readAt: "2026-08-07T12:05:00Z",
    });
    readStateIdempotent = firstRead && !duplicateRead
      && (await inbox.list("reader_owner"))[0]?.readAt === "2026-08-07T12:04:00.000Z";
    try {
      await transaction.transaction(async (savepoint) => {
        await savepoint.execute(sql`
          insert into decision_room_inbox_reads (workspace_id, inbox_item_id, reader_ref, read_at)
          select ${workspaceId}::uuid, id, 'reader_token', now()
          from decision_room_inbox_items
          where workspace_id = ${workspaceId}::uuid and notification_ref = ${notification.notificationRef}
        `);
      });
    } catch {
      invalidReaderRefBlocked = true;
    }
    crossTenantReadBlocked = !await new DrizzleDecisionRoomInbox(transaction as never, foreignWorkspaceId).markRead({
      notificationRef: notification.notificationRef, readerRef: "reader_owner", readAt: "2026-08-07T12:04:00Z",
    });
    try {
      await transaction.transaction(async (savepoint) => {
        await savepoint.execute(sql`
          update decision_room_inbox_items set channel = 'email'
          where workspace_id = ${workspaceId}::uuid
        `);
      });
    } catch {
      externalChannelBlocked = true;
    }

    const workerOk = { ...schedule, scheduleRef: "schedule_worker_ok" };
    const workerFail = {
      ...schedule, scheduleRef: "schedule_worker_fail", campaignRef: "campaign_other",
    };
    const workerSkip = {
      ...schedule, scheduleRef: "schedule_worker_skip", catchUpPolicy: "skip" as const,
    };
    const workerDisabled = {
      ...schedule, scheduleRef: "schedule_worker_disabled", enabled: false,
    };
    const workerSuperseded = { ...schedule, scheduleRef: "schedule_worker_superseded" };
    await registry.save(workerOk, "2026-08-07T06:00:00Z");
    await registry.save(workerFail, "2026-08-07T06:00:00Z");
    await registry.save(workerSkip, "2026-08-05T06:00:00Z");
    await registry.save(workerDisabled, "2026-08-07T06:00:00Z");
    await registry.save(workerSuperseded, "2026-08-07T06:00:00Z");
    await registry.save({ ...workerSuperseded, localTime: "10:00" }, "2026-08-08T07:00:00Z");

    const boundedDue = await registry.listDue("2026-08-07T12:00:00Z", 2);
    const allDue = await registry.listDue("2026-08-07T12:00:00Z", 10);
    dueListingBounded = boundedDue.length === 2 && allDue.length === 3;
    const dueRefs = new Set(allDue.map((entry) => entry.schedule.scheduleRef));
    disabledSupersededExcluded = !dueRefs.has("schedule_worker_disabled")
      && !dueRefs.has("schedule_worker_superseded");

    const workerAnalysis = {
      execute: async (input: Readonly<{ campaignRef: string }>) => {
        if (input.campaignRef === "campaign_other") throw new Error("redacted deterministic failure");
        return { analysisRef: "analysis_worker", evidenceRefs: [], summaryCode: "worker_ready" };
      },
    };
    const workerExecutor = new DecisionRoomExecutor(
      new DrizzleDecisionRoomRunStore(transaction as never, workspaceId),
      workerAnalysis as never,
      new DrizzleDecisionRoomInbox(transaction as never, workspaceId),
      () => new Date("2026-08-07T12:00:00Z"),
    );
    const workerResult = await runDecisionRoomScheduleWorker(
      { now: "2026-08-07T12:00:00Z", batchSize: 10 }, registry, workerExecutor,
    );
    const workerOutcomes = new Map(workerResult.items.map((entry) => [entry.scheduleRef, entry.outcome]));
    workerPartialIsolation = workerOutcomes.get("schedule_worker_ok") === "completed"
      && workerOutcomes.get("schedule_worker_fail") === "failed";
    workerCatchUp = workerOutcomes.get("schedule_worker_skip") === "stale_skipped"
      && workerResult.tickAdvancedCount === 2;

    const concurrentSchedule = { ...schedule, scheduleRef: "schedule_worker_concurrent" };
    await registry.save(concurrentSchedule, "2026-08-07T06:00:00Z");
    const concurrentCandidate = (await registry.listDue("2026-08-07T12:00:00Z", 10))
      .find((entry) => entry.schedule.scheduleRef === concurrentSchedule.scheduleRef);
    if (!concurrentCandidate) throw new Error("Concurrent worker fixture due değil");
    const cachedRegistry = {
      listDue: async () => [concurrentCandidate],
      recordTick: (input: Parameters<typeof registry.recordTick>[0]) => registry.recordTick(input),
    };
    const workerFirst = await runDecisionRoomScheduleWorker(
      { now: "2026-08-07T12:00:00Z" }, cachedRegistry, workerExecutor,
    );
    const workerDuplicate = await runDecisionRoomScheduleWorker(
      { now: "2026-08-07T12:00:00Z" }, cachedRegistry, workerExecutor,
    );
    const concurrentRows = resultRows(await transaction.execute(sql`
      select count(*)::int as count from decision_room_runs run
      join decision_room_schedules schedule
        on schedule.workspace_id = run.workspace_id and schedule.id = run.schedule_id
      where run.workspace_id = ${workspaceId}::uuid and schedule.schedule_ref = ${concurrentSchedule.scheduleRef}
    `));
    concurrentWorkerSingleRun = workerFirst.items[0]?.outcome === "completed"
      && workerDuplicate.items[0]?.outcome === "tick_conflict"
      && workerDuplicate.items[0]?.tickAdvanced === false
      && Number(concurrentRows[0]?.count) === 1;

    const raceSchedule = { ...schedule, scheduleRef: "schedule_worker_revision_race" };
    await registry.save(raceSchedule, "2026-08-07T06:00:00Z");
    const raceCandidate = (await registry.listDue("2026-08-07T12:00:00Z", 10))
      .find((entry) => entry.schedule.scheduleRef === raceSchedule.scheduleRef);
    if (!raceCandidate) throw new Error("Revision race fixture due değil");
    const editingExecutor = {
      execute: async (request: Parameters<typeof workerExecutor.execute>[0]) => {
        const result = await workerExecutor.execute(request);
        await registry.save({ ...raceSchedule, localTime: "10:00" }, "2026-08-09T07:00:00Z");
        return result;
      },
    };
    const raceResult = await runDecisionRoomScheduleWorker(
      { now: "2026-08-07T12:00:00Z" },
      { listDue: async () => [raceCandidate], recordTick: (input) => registry.recordTick(input) },
      editingExecutor,
    );
    const raceCurrent = await registry.get(raceSchedule.scheduleRef);
    revisionRaceTickBlocked = raceResult.items[0]?.outcome === "tick_conflict"
      && raceResult.items[0]?.tickAdvanced === false
      && raceCurrent?.revision === 2
      && raceCurrent.nextRunAt === "2026-08-09T07:00:00.000Z";

    const authorityColumns = resultRows(await transaction.execute(sql`
      select column_name from information_schema.columns
      where table_schema = 'public'
        and table_name in ('decision_room_schedules', 'decision_room_runs', 'decision_room_inbox_items', 'decision_room_inbox_reads')
        and column_name ~* '(authority|autonomy|approval|secret|prompt|raw|token)'
        and column_name <> 'lease_token'
    `));
    authorityColumnAbsent = authorityColumns.length === 0;

    const acceptance = {
      appliedProductionTablesVerified, scheduleRoundTrip, historicalScheduleRevision, immutableScheduleDefinition,
      manualAssetBinding, scheduledAssetBinding, crossCombinationBlocked,
      hashMismatchBlocked, crossAssetClaimBlocked, assetChainEnforced,
      duplicateInProgress, overlapSuppressed,
      leaseTokenEnforced, retryStable, duplicateCompleted, inboxDeduplicated, readStateIdempotent,
      crossTenantReadBlocked, invalidReaderRefBlocked, externalChannelBlocked, authorityColumnAbsent,
      dueListingBounded, disabledSupersededExcluded, workerPartialIsolation, workerCatchUp,
      concurrentWorkerSingleRun,
      revisionRaceTickBlocked,
    };
    const failed = Object.entries(acceptance).filter(([, passed]) => !passed).map(([name]) => name);
    if (failed.length > 0) throw new Error(
      `Decision Room persistence PostgreSQL acceptance failed: ${failed.join(",")}; sensitiveColumns=${authorityColumns.map((row) => String(row.column_name)).join(",")}`,
    );
    throw rollback;
  });
} catch (error) {
  if (error !== rollback) throw error;
} finally {
  const check = await pool.query(
    "select count(*)::int as count from workspaces where id = any($1::uuid[])",
    [[workspaceId, foreignWorkspaceId]],
  );
  temporaryRowsCommitted = Number(check.rows[0]?.count ?? -1) !== 0;
  await pool.end();
}

console.log(JSON.stringify({
  appliedProductionTablesVerified,
  scheduleRoundTrip,
  historicalScheduleRevision,
  immutableScheduleDefinition,
  manualAssetBinding,
  scheduledAssetBinding,
  crossCombinationBlocked,
  hashMismatchBlocked,
  crossAssetClaimBlocked,
  assetChainEnforced,
  duplicateInProgress,
  overlapSuppressed,
  leaseTokenEnforced,
  retryStable,
  duplicateCompleted,
  inboxDeduplicated,
  readStateIdempotent,
  invalidReaderRefBlocked,
  crossTenantReadBlocked,
  externalChannelBlocked,
  authorityColumnAbsent,
  dueListingBounded,
  disabledSupersededExcluded,
  workerPartialIsolation,
  workerCatchUp,
  concurrentWorkerSingleRun,
  revisionRaceTickBlocked,
  metaNetworkCalls: 0,
  externalNotifications: 0,
  temporaryRowsCommitted,
}));

if (temporaryRowsCommitted) throw new Error("Outer rollback Decision Room fixture satırlarını kalıcı bıraktı");
