import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import type {
  DecisionRoomInboxPort,
  DecisionRoomRunStore,
} from "@/domain/decisions/executor";
import type {
  DecisionRoomInboxReadRow,
  DecisionRoomReadRepository,
  DecisionRoomRunReadRow,
  DecisionRoomScheduleReadRow,
} from "@/application/decision-room-read-service";
import {
  DECISION_ROOM_SCHEDULE_VERSION,
  decisionRoomScheduleDefinitionHash,
  validateDecisionRoomSchedule,
  type DecisionRoomSchedule,
} from "@/domain/decisions/schedule";

type Database = NodePgDatabase<typeof schema>;
type PersistenceDatabase = Pick<Database, "execute" | "transaction">;

type RunRow = Readonly<{
  id: string;
  run_ref: string;
  state: "running" | "completed" | "failed";
  lease_until: Date | string | null;
  attempt: number;
  analysis_ref: string | null;
  summary_code: string | null;
  ad_account_id: string;
  campaign_id: string;
  account_ref: string;
  campaign_ref: string;
  trigger_kind: "manual" | "scheduled";
  schedule_id: string | null;
  schedule_definition_hash: string | null;
  trigger_ref: string;
  timeframe_ref: string;
  template_ref: string;
}>;

type ScheduleRow = Readonly<{
  schedule_ref: string;
  revision: number;
  definition_hash: string;
  workspace_ref: string;
  account_ref: string;
  campaign_ref: string;
  timeframe_ref: string;
  template_ref: string;
  timezone: string;
  local_time: string;
  frequency: "daily" | "weekly";
  day_of_week: number | null;
  enabled: boolean;
  catch_up_policy: "skip" | "run_once";
  tick_grace_minutes: number;
  last_scheduled_for: Date | string | null;
  next_run_at: Date | string | null;
}>;

type InboxRow = Readonly<{
  id: string;
  notification_ref: string;
  run_ref: string;
  analysis_ref: string;
  summary_code: string;
  created_at: Date | string;
  read_at: Date | string | null;
}>;

export class DecisionRoomPersistenceError extends Error {
  constructor(readonly code:
    | "invalid_input"
    | "workspace_scope_mismatch"
    | "asset_scope_mismatch"
    | "schedule_conflict"
    | "run_missing"
    | "notification_conflict"
    | "corrupt_store") {
    super(`Decision Room persistence reddedildi: ${code}`);
    this.name = "DecisionRoomPersistenceError";
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_PATTERN = /^idempotency_[a-f0-9]{32}$/;
const SCOPE_PATTERN = /^[a-f0-9]{64}$/;
const OPAQUE_REF_PATTERN = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_-]{0,94}$/;
const MACHINE_CODE_PATTERN = /^[a-z0-9][a-z0-9_:-]{0,127}$/;
const INBOX_REF_PATTERN = /^inbox_[a-f0-9]{20}$/;

function rows<T>(result: unknown): readonly T[] {
  if (!result || typeof result !== "object" || !("rows" in result) || !Array.isArray(result.rows)) {
    throw new DecisionRoomPersistenceError("corrupt_store");
  }
  return result.rows as readonly T[];
}

function required(value: unknown, max = 256): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max) {
    throw new DecisionRoomPersistenceError("invalid_input");
  }
  return value.trim();
}

function opaqueRef(value: unknown): string {
  const ref = required(value, 96);
  if (!OPAQUE_REF_PATTERN.test(ref) || /(token|secret|prompt|raw[_-]?(payload|request|response|json))/i.test(ref)) {
    throw new DecisionRoomPersistenceError("invalid_input");
  }
  return ref;
}

function privateAssetRef(value: unknown): string {
  const ref = required(value, 256);
  if (/(token|secret|prompt|raw[_-]?(payload|request|response|json))/i.test(ref)) {
    throw new DecisionRoomPersistenceError("invalid_input");
  }
  return ref;
}

function workspace(value: string): string {
  if (!UUID_PATTERN.test(value)) throw new DecisionRoomPersistenceError("invalid_input");
  return value;
}

function instant(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new DecisionRoomPersistenceError("invalid_input");
  }
  return new Date(value).toISOString();
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new DecisionRoomPersistenceError("corrupt_store");
  return parsed.toISOString();
}

async function assertActiveWorkspace(database: Pick<Database, "execute">, workspaceId: string): Promise<void> {
  const result = await database.execute(sql`
    select id from workspaces
    where id = ${workspaceId}::uuid and lifecycle_state = 'active'
    limit 1
  `);
  if (rows(result).length !== 1) throw new DecisionRoomPersistenceError("workspace_scope_mismatch");
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** PostgreSQL-backed lease store for one explicitly bound workspace. */
export class DrizzleDecisionRoomRunStore implements DecisionRoomRunStore {
  private readonly workspaceId: string;

  constructor(private readonly database: PersistenceDatabase, workspaceId: string) {
    this.workspaceId = workspace(workspaceId);
  }

  async claim(input: Readonly<{
    idempotencyKey: string;
    scopeKey: string;
    triggerKind: "manual" | "scheduled";
    scheduleRef: string | null;
    scheduleDefinitionHash: string | null;
    triggerRef: string;
    accountRef: string;
    campaignRef: string;
    timeframeRef: string;
    templateRef: string;
    now: string;
    leaseUntil: string;
  }>) {
    if (!input || Object.keys(input).some((key) => ![
      "idempotencyKey", "scopeKey", "triggerKind", "scheduleRef", "scheduleDefinitionHash",
      "triggerRef", "accountRef", "campaignRef", "timeframeRef", "templateRef", "now", "leaseUntil",
    ].includes(key)) || !IDEMPOTENCY_PATTERN.test(input.idempotencyKey) || !SCOPE_PATTERN.test(input.scopeKey)
      || !(["manual", "scheduled"] as const).includes(input.triggerKind)
      || (input.triggerKind === "manual"
        ? input.scheduleRef !== null || input.scheduleDefinitionHash !== null
        : input.scheduleRef === null || input.triggerRef !== input.scheduleRef
          || !/^[a-f0-9]{64}$/.test(input.scheduleDefinitionHash ?? ""))) {
      throw new DecisionRoomPersistenceError("invalid_input");
    }
    const scheduleRef = input.scheduleRef === null ? null : opaqueRef(input.scheduleRef);
    const scheduleDefinitionHash = input.scheduleDefinitionHash;
    const triggerRef = opaqueRef(input.triggerRef);
    const accountRef = privateAssetRef(input.accountRef);
    const campaignRef = privateAssetRef(input.campaignRef);
    const timeframeRef = opaqueRef(input.timeframeRef);
    const templateRef = opaqueRef(input.templateRef);
    const now = instant(input.now);
    const leaseUntil = instant(input.leaseUntil);
    if (Date.parse(leaseUntil) <= Date.parse(now)) throw new DecisionRoomPersistenceError("invalid_input");

    return this.database.transaction(async (transaction) => {
      await assertActiveWorkspace(transaction, this.workspaceId);
      // Fixed lock order: idempotency first, then campaign scope. This prevents
      // both duplicate insertion and concurrent overlap without long row locks.
      await transaction.execute(sql`
        select pg_advisory_xact_lock(hashtextextended(${`${this.workspaceId}:idempotency:${input.idempotencyKey}`}, 0))
      `);
      await transaction.execute(sql`
        select pg_advisory_xact_lock(hashtextextended(${`${this.workspaceId}:scope:${input.scopeKey}`}, 0))
      `);

      const asset = rows<{ account_id: string; campaign_id: string }>(await transaction.execute(sql`
        select account.id as account_id, campaign.id as campaign_id
        from ad_accounts account
        join ad_campaigns campaign
          on campaign.workspace_id = account.workspace_id and campaign.ad_account_id = account.id
        where account.workspace_id = ${this.workspaceId}::uuid
          and account.external_account_id = ${accountRef}
          and campaign.external_campaign_id = ${campaignRef}
        limit 1
      `))[0];
      if (!asset) throw new DecisionRoomPersistenceError("asset_scope_mismatch");
      const existing = rows<RunRow>(await transaction.execute(sql`
        select id, run_ref, state, lease_until, attempt, analysis_ref, summary_code,
          ad_account_id, campaign_id, trigger_kind, schedule_id, schedule_definition_hash
          , trigger_ref, account_ref, campaign_ref, timeframe_ref, template_ref
        from decision_room_runs
        where workspace_id = ${this.workspaceId}::uuid and idempotency_key = ${input.idempotencyKey}
        for update
      `))[0];
      const schedule = scheduleRef === null ? null : rows<{ id: string }>(await transaction.execute(sql`
        select id from decision_room_schedules
        where workspace_id = ${this.workspaceId}::uuid and schedule_ref = ${scheduleRef}
          and definition_hash = ${scheduleDefinitionHash}
          and ad_account_id = ${asset.account_id}::uuid and campaign_id = ${asset.campaign_id}::uuid
          and account_ref = ${accountRef} and campaign_ref = ${campaignRef}
          and timeframe_ref = ${timeframeRef} and template_ref = ${templateRef}
          and (${existing?.schedule_id ?? null}::uuid is not null
            and id = ${existing?.schedule_id ?? null}::uuid
            or ${existing?.schedule_id ?? null}::uuid is null
              and superseded_at is null and enabled is true)
        limit 1
      `))[0];
      if (scheduleRef !== null && !schedule) throw new DecisionRoomPersistenceError("schedule_conflict");
      if (existing && (existing.ad_account_id !== asset.account_id || existing.campaign_id !== asset.campaign_id
        || existing.trigger_kind !== input.triggerKind
        || (existing.schedule_id ?? null) !== (schedule?.id ?? null)
        || (existing.schedule_definition_hash ?? null) !== scheduleDefinitionHash
        || existing.account_ref !== accountRef || existing.campaign_ref !== campaignRef
        || existing.trigger_ref !== triggerRef || existing.timeframe_ref !== timeframeRef
        || existing.template_ref !== templateRef)) {
        throw new DecisionRoomPersistenceError("corrupt_store");
      }
      if (existing?.state === "completed") {
        if (!existing.analysis_ref || !existing.summary_code) throw new DecisionRoomPersistenceError("corrupt_store");
        return Object.freeze({
          status: "duplicate_completed" as const,
          runRef: existing.run_ref,
          attempt: existing.attempt,
          completion: Object.freeze({ analysisRef: existing.analysis_ref, summaryCode: existing.summary_code }),
        });
      }
      if (existing?.state === "running" && Date.parse(iso(existing.lease_until) ?? "") > Date.parse(now)) {
        return Object.freeze({ status: "duplicate_in_progress" as const, runRef: existing.run_ref, attempt: existing.attempt });
      }
      const overlap = rows<RunRow>(await transaction.execute(sql`
        select id, run_ref, state, lease_until, attempt, analysis_ref, summary_code,
          ad_account_id, campaign_id, trigger_kind, schedule_id, schedule_definition_hash
          , trigger_ref, account_ref, campaign_ref, timeframe_ref, template_ref
        from decision_room_runs
        where workspace_id = ${this.workspaceId}::uuid
          and scope_key = ${input.scopeKey}
          and idempotency_key <> ${input.idempotencyKey}
          and state = 'running' and lease_until > ${now}::timestamptz
        order by lease_until desc, id
        limit 1
        for update
      `))[0];
      if (overlap) {
        return Object.freeze({ status: "overlap_suppressed" as const, runRef: overlap.run_ref, attempt: overlap.attempt });
      }

      const leaseToken = randomUUID();
      const runRef = existing?.run_ref ?? `run_${sha256(input.idempotencyKey).slice(0, 20)}`;
      const attempt = (existing?.attempt ?? 0) + 1;
      if (existing) {
        await transaction.execute(sql`
          update decision_room_runs set
            state = 'running', lease_token = ${leaseToken}::uuid, lease_until = ${leaseUntil}::timestamptz,
            attempt = ${attempt}, analysis_ref = null, summary_code = null,
            started_at = ${now}::timestamptz, completed_at = null, failed_at = null, updated_at = now()
          where id = ${existing.id}::uuid and workspace_id = ${this.workspaceId}::uuid
        `);
      } else {
        await transaction.execute(sql`
          insert into decision_room_runs (
            workspace_id, schedule_id, ad_account_id, campaign_id, trigger_kind, schedule_definition_hash,
            trigger_ref, account_ref, campaign_ref, timeframe_ref, template_ref,
            idempotency_key, scope_key, run_ref, state, lease_token,
            lease_until, attempt, started_at
          ) values (
            ${this.workspaceId}::uuid, ${schedule?.id ?? null}::uuid, ${asset.account_id}::uuid,
            ${asset.campaign_id}::uuid, ${input.triggerKind}, ${scheduleDefinitionHash},
            ${triggerRef}, ${accountRef}, ${campaignRef}, ${timeframeRef}, ${templateRef},
            ${input.idempotencyKey}, ${input.scopeKey}, ${runRef}, 'running',
            ${leaseToken}::uuid, ${leaseUntil}::timestamptz, ${attempt}, ${now}::timestamptz
          )
        `);
      }
      return Object.freeze({ status: "claimed" as const, runRef, leaseToken, attempt });
    });
  }

  async complete(input: Readonly<{
    idempotencyKey: string;
    leaseToken: string;
    completion: Readonly<{ analysisRef: string; summaryCode: string }>;
  }>): Promise<boolean> {
    if (!input || Object.keys(input).some((key) => !["idempotencyKey", "leaseToken", "completion"].includes(key))
      || Object.keys(input.completion ?? {}).some((key) => !["analysisRef", "summaryCode"].includes(key))
      || !IDEMPOTENCY_PATTERN.test(input.idempotencyKey) || !UUID_PATTERN.test(input.leaseToken)
      || !OPAQUE_REF_PATTERN.test(input.completion?.analysisRef)
      || !MACHINE_CODE_PATTERN.test(input.completion?.summaryCode)) {
      throw new DecisionRoomPersistenceError("invalid_input");
    }
    const result = await this.database.execute(sql`
      update decision_room_runs set
        state = 'completed', lease_token = null, lease_until = null,
        analysis_ref = ${input.completion.analysisRef}, summary_code = ${input.completion.summaryCode},
        completed_at = now(), failed_at = null, updated_at = now()
      where workspace_id = ${this.workspaceId}::uuid and idempotency_key = ${input.idempotencyKey}
        and state = 'running' and lease_token = ${input.leaseToken}::uuid
      returning id
    `);
    return rows(result).length === 1;
  }

  async fail(input: Readonly<{ idempotencyKey: string; leaseToken: string }>): Promise<boolean> {
    if (!input || Object.keys(input).some((key) => !["idempotencyKey", "leaseToken"].includes(key))
      || !IDEMPOTENCY_PATTERN.test(input.idempotencyKey) || !UUID_PATTERN.test(input.leaseToken)) {
      throw new DecisionRoomPersistenceError("invalid_input");
    }
    const result = await this.database.execute(sql`
      update decision_room_runs set
        state = 'failed', lease_token = null, lease_until = null,
        analysis_ref = null, summary_code = null, failed_at = now(), completed_at = null, updated_at = now()
      where workspace_id = ${this.workspaceId}::uuid and idempotency_key = ${input.idempotencyKey}
        and state = 'running' and lease_token = ${input.leaseToken}::uuid
      returning id
    `);
    return rows(result).length === 1;
  }
}

function restoreSchedule(row: ScheduleRow): DecisionRoomSchedule {
  const base = {
    version: DECISION_ROOM_SCHEDULE_VERSION,
    scheduleRef: row.schedule_ref,
    workspaceRef: row.workspace_ref,
    accountRef: row.account_ref,
    campaignRef: row.campaign_ref,
    timeframeRef: row.timeframe_ref,
    templateRef: row.template_ref,
    timezone: row.timezone,
    localTime: row.local_time,
    enabled: row.enabled,
    catchUpPolicy: row.catch_up_policy,
    tickGraceMinutes: row.tick_grace_minutes,
    dstPolicy: { gap: "next_valid" as const, overlap: "first_occurrence" as const },
    notificationChannel: "in_app_inbox" as const,
  };
  return validateDecisionRoomSchedule(row.frequency === "daily"
    ? { ...base, frequency: "daily" }
    : { ...base, frequency: "weekly", dayOfWeek: row.day_of_week ?? -1 });
}

export type DecisionRoomDueSchedule = Readonly<{
  schedule: DecisionRoomSchedule;
  revision: number;
  definitionHash: string;
  lastScheduledFor: string | null;
  nextRunAt: string;
}>;

/** Registry binds schedule refs to the canonical account/campaign mirror. */
export class DrizzleDecisionRoomScheduleRegistry {
  private readonly workspaceId: string;

  constructor(private readonly database: PersistenceDatabase, workspaceId: string) {
    this.workspaceId = workspace(workspaceId);
  }

  async save(input: DecisionRoomSchedule, nextRunAt: string | null = null): Promise<DecisionRoomSchedule> {
    const schedule = validateDecisionRoomSchedule(input);
    for (const value of [
      schedule.scheduleRef, schedule.workspaceRef, schedule.accountRef, schedule.campaignRef,
      schedule.timeframeRef, schedule.templateRef, schedule.timezone,
    ]) required(value);
    opaqueRef(schedule.scheduleRef);
    const definitionHash = decisionRoomScheduleDefinitionHash(schedule);
    const normalizedNext = nextRunAt === null ? null : instant(nextRunAt);
    return this.database.transaction(async (transaction) => {
      await assertActiveWorkspace(transaction, this.workspaceId);
      await transaction.execute(sql`
        select pg_advisory_xact_lock(hashtextextended(${`${this.workspaceId}:schedule:${schedule.scheduleRef}`}, 0))
      `);
      const asset = rows<{ account_id: string; campaign_id: string }>(await transaction.execute(sql`
        select account.id as account_id, campaign.id as campaign_id
        from ad_accounts account
        join ad_campaigns campaign
          on campaign.workspace_id = account.workspace_id and campaign.ad_account_id = account.id
        where account.workspace_id = ${this.workspaceId}::uuid
          and account.external_account_id = ${schedule.accountRef}
          and campaign.external_campaign_id = ${schedule.campaignRef}
        limit 1
      `))[0];
      if (!asset) throw new DecisionRoomPersistenceError("asset_scope_mismatch");
      const latest = rows<{ revision: number; definition_hash: string }>(await transaction.execute(sql`
        select revision, definition_hash from decision_room_schedules
        where workspace_id = ${this.workspaceId}::uuid and schedule_ref = ${schedule.scheduleRef}
          and superseded_at is null
        limit 1 for update
      `))[0];
      if (latest?.definition_hash === definitionHash) return schedule;
      const revision = (latest?.revision ?? 0) + 1;
      await transaction.execute(sql`
        update decision_room_schedules set superseded_at = now(), next_run_at = null, updated_at = now()
        where workspace_id = ${this.workspaceId}::uuid and schedule_ref = ${schedule.scheduleRef}
          and superseded_at is null
      `);
      await transaction.execute(sql`
        insert into decision_room_schedules (
          workspace_id, ad_account_id, campaign_id, schedule_ref, revision, definition_version,
          definition_hash, workspace_ref, account_ref,
          campaign_ref, timeframe_ref, template_ref, timezone, local_time, frequency, day_of_week,
          enabled, catch_up_policy, tick_grace_minutes, next_run_at
        ) values (
          ${this.workspaceId}::uuid, ${asset.account_id}::uuid, ${asset.campaign_id}::uuid,
          ${schedule.scheduleRef}, ${revision}, ${DECISION_ROOM_SCHEDULE_VERSION}, ${definitionHash},
          ${schedule.workspaceRef}, ${schedule.accountRef}, ${schedule.campaignRef},
          ${schedule.timeframeRef}, ${schedule.templateRef}, ${schedule.timezone}, ${schedule.localTime},
          ${schedule.frequency}, ${schedule.frequency === "weekly" ? schedule.dayOfWeek : null},
          ${schedule.enabled}, ${schedule.catchUpPolicy}, ${schedule.tickGraceMinutes}, ${normalizedNext}::timestamptz
        )
      `);
      return schedule;
    });
  }

  async get(scheduleRef: string): Promise<Readonly<{
    schedule: DecisionRoomSchedule;
    revision: number;
    definitionHash: string;
    lastScheduledFor: string | null;
    nextRunAt: string | null;
  }> | null> {
    const ref = opaqueRef(scheduleRef);
    await assertActiveWorkspace(this.database, this.workspaceId);
    const row = rows<ScheduleRow>(await this.database.execute(sql`
      select schedule_ref, revision, definition_hash, workspace_ref, account_ref, campaign_ref, timeframe_ref, template_ref,
        timezone, local_time, frequency, day_of_week, enabled, catch_up_policy, tick_grace_minutes,
        last_scheduled_for, next_run_at
      from decision_room_schedules
      where workspace_id = ${this.workspaceId}::uuid and schedule_ref = ${ref}
        and superseded_at is null
      limit 1
    `))[0];
    return row ? Object.freeze({
      schedule: restoreSchedule(row), revision: row.revision, definitionHash: row.definition_hash,
      lastScheduledFor: iso(row.last_scheduled_for), nextRunAt: iso(row.next_run_at),
    }) : null;
  }

  async listDue(now: string, limit = 25): Promise<readonly DecisionRoomDueSchedule[]> {
    const dueAt = instant(now);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new DecisionRoomPersistenceError("invalid_input");
    }
    await assertActiveWorkspace(this.database, this.workspaceId);
    const due = rows<ScheduleRow>(await this.database.execute(sql`
      select schedule_ref, revision, definition_hash, workspace_ref, account_ref, campaign_ref,
        timeframe_ref, template_ref, timezone, local_time, frequency, day_of_week, enabled,
        catch_up_policy, tick_grace_minutes, last_scheduled_for, next_run_at
      from decision_room_schedules
      where workspace_id = ${this.workspaceId}::uuid
        and superseded_at is null and enabled is true
        and next_run_at is not null and next_run_at <= ${dueAt}::timestamptz
      order by next_run_at, schedule_ref, revision
      limit ${limit}
    `));
    return Object.freeze(due.map((row) => {
      const nextRunAt = iso(row.next_run_at);
      if (nextRunAt === null || decisionRoomScheduleDefinitionHash(restoreSchedule(row)) !== row.definition_hash) {
        throw new DecisionRoomPersistenceError("corrupt_store");
      }
      return Object.freeze({
        schedule: restoreSchedule(row),
        revision: row.revision,
        definitionHash: row.definition_hash,
        lastScheduledFor: iso(row.last_scheduled_for),
        nextRunAt,
      });
    }));
  }

  async recordTick(input: Readonly<{
    scheduleRef: string;
    revision: number;
    definitionHash: string;
    scheduledFor: string;
    nextRunAt: string | null;
  }>): Promise<boolean> {
    if (!input || Object.keys(input).some((key) => ![
      "scheduleRef", "revision", "definitionHash", "scheduledFor", "nextRunAt",
    ].includes(key)) || !Number.isSafeInteger(input.revision) || input.revision < 1
      || !/^[a-f0-9]{64}$/.test(input.definitionHash)) {
      throw new DecisionRoomPersistenceError("invalid_input");
    }
    const scheduleRef = opaqueRef(input.scheduleRef);
    const scheduledFor = instant(input.scheduledFor);
    const nextRunAt = input.nextRunAt === null ? null : instant(input.nextRunAt);
    if (nextRunAt !== null && Date.parse(nextRunAt) <= Date.parse(scheduledFor)) {
      throw new DecisionRoomPersistenceError("invalid_input");
    }
    const result = await this.database.execute(sql`
      update decision_room_schedules set
        last_scheduled_for = ${scheduledFor}::timestamptz,
        next_run_at = ${nextRunAt}::timestamptz,
        updated_at = now()
      where id = (
        select id from decision_room_schedules
        where workspace_id = ${this.workspaceId}::uuid and schedule_ref = ${scheduleRef}
          and revision = ${input.revision} and definition_hash = ${input.definitionHash}
          and superseded_at is null
        limit 1
      )
        and (last_scheduled_for is null or last_scheduled_for < ${scheduledFor}::timestamptz)
      returning id
    `);
    return rows(result).length === 1;
  }
}

export type DecisionRoomInboxItem = Readonly<{
  notificationRef: string;
  runRef: string;
  analysisRef: string;
  summaryCode: string;
  createdAt: string;
  readAt: string | null;
}>;

/** In-app-only, deduplicated inbox and per-reader read state. */
export class DrizzleDecisionRoomInbox implements DecisionRoomInboxPort {
  private readonly workspaceId: string;

  constructor(private readonly database: PersistenceDatabase, workspaceId: string) {
    this.workspaceId = workspace(workspaceId);
  }

  async publish(notification: Parameters<DecisionRoomInboxPort["publish"]>[0]): Promise<void> {
    if (!notification || Object.keys(notification).some((key) => ![
      "notificationRef", "channel", "runRef", "analysisRef", "summaryCode", "actionAuthority",
    ].includes(key)) || notification.channel !== "in_app_inbox" || notification.actionAuthority !== "none"
      || !INBOX_REF_PATTERN.test(notification.notificationRef) || !/^run_[a-f0-9]{20}$/.test(notification.runRef)
      || !OPAQUE_REF_PATTERN.test(notification.analysisRef) || !MACHINE_CODE_PATTERN.test(notification.summaryCode)) {
      throw new DecisionRoomPersistenceError("invalid_input");
    }
    await this.database.transaction(async (transaction) => {
      await assertActiveWorkspace(transaction, this.workspaceId);
      const inserted = rows(await transaction.execute(sql`
        insert into decision_room_inbox_items (
          workspace_id, run_id, notification_ref, channel, analysis_ref, summary_code
        )
        select ${this.workspaceId}::uuid, run.id, ${notification.notificationRef}, 'in_app_inbox',
          ${notification.analysisRef}, ${notification.summaryCode}
        from decision_room_runs run
        where run.workspace_id = ${this.workspaceId}::uuid and run.run_ref = ${notification.runRef}
          and run.state = 'completed' and run.analysis_ref = ${notification.analysisRef}
          and run.summary_code = ${notification.summaryCode}
        on conflict (workspace_id, notification_ref) do nothing
        returning id
      `));
      if (inserted.length === 1) return;
      const existing = rows<{ run_ref: string; analysis_ref: string; summary_code: string }>(await transaction.execute(sql`
        select run.run_ref, item.analysis_ref, item.summary_code
        from decision_room_inbox_items item
        join decision_room_runs run
          on run.workspace_id = item.workspace_id and run.id = item.run_id
        where item.workspace_id = ${this.workspaceId}::uuid and item.notification_ref = ${notification.notificationRef}
        limit 1
      `))[0];
      if (!existing) throw new DecisionRoomPersistenceError("run_missing");
      if (existing.run_ref !== notification.runRef || existing.analysis_ref !== notification.analysisRef
        || existing.summary_code !== notification.summaryCode) {
        throw new DecisionRoomPersistenceError("notification_conflict");
      }
    });
  }

  async list(readerRef: string, limit = 100): Promise<readonly DecisionRoomInboxItem[]> {
    const reader = opaqueRef(readerRef);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 200) throw new DecisionRoomPersistenceError("invalid_input");
    await assertActiveWorkspace(this.database, this.workspaceId);
    const result = rows<InboxRow>(await this.database.execute(sql`
      select item.id, item.notification_ref, run.run_ref, item.analysis_ref, item.summary_code,
        item.created_at, read_state.read_at
      from decision_room_inbox_items item
      join decision_room_runs run on run.workspace_id = item.workspace_id and run.id = item.run_id
      left join decision_room_inbox_reads read_state
        on read_state.workspace_id = item.workspace_id and read_state.inbox_item_id = item.id
        and read_state.reader_ref = ${reader}
      where item.workspace_id = ${this.workspaceId}::uuid
      order by item.created_at desc, item.id desc
      limit ${limit}
    `));
    return Object.freeze(result.map((row) => Object.freeze({
      notificationRef: row.notification_ref,
      runRef: row.run_ref,
      analysisRef: row.analysis_ref,
      summaryCode: row.summary_code,
      createdAt: iso(row.created_at)!,
      readAt: iso(row.read_at),
    })));
  }

  async markRead(input: Readonly<{ notificationRef: string; readerRef: string; readAt: string }>): Promise<boolean> {
    if (!input || Object.keys(input).some((key) => !["notificationRef", "readerRef", "readAt"].includes(key))
      || !INBOX_REF_PATTERN.test(input.notificationRef)) throw new DecisionRoomPersistenceError("invalid_input");
    const reader = opaqueRef(input.readerRef);
    const readAt = instant(input.readAt);
    const result = await this.database.execute(sql`
      insert into decision_room_inbox_reads (workspace_id, inbox_item_id, reader_ref, read_at)
      select ${this.workspaceId}::uuid, item.id, ${reader}, ${readAt}::timestamptz
      from decision_room_inbox_items item
      where item.workspace_id = ${this.workspaceId}::uuid and item.notification_ref = ${input.notificationRef}
      on conflict (workspace_id, inbox_item_id, reader_ref) do nothing
      returning id
    `);
    return rows(result).length === 1;
  }
}

type ReadAfter = Readonly<{ ref: string; sortAt: string | null }>;

type ScheduleReadSource = Readonly<{
  schedule_ref: string;
  revision: number;
  definition_version: string;
  definition_hash: string;
  ad_account_id: string;
  campaign_id: string;
  account_ref: string;
  campaign_ref: string;
  timeframe_ref: string;
  template_ref: string;
  frequency: "daily" | "weekly";
  day_of_week: number | null;
  timezone: string;
  local_time: string;
  enabled: boolean;
  last_scheduled_for: Date | string | null;
  next_run_at: Date | string | null;
}>;

type RunReadSource = Readonly<{
  run_ref: string;
  state: "running" | "completed" | "failed";
  trigger_kind: "manual" | "scheduled";
  trigger_ref: string;
  schedule_ref: string | null;
  schedule_definition_hash: string | null;
  ad_account_id: string;
  campaign_id: string;
  account_ref: string | null;
  campaign_ref: string | null;
  timeframe_ref: string;
  template_ref: string;
  attempt: number;
  started_at: Date | string;
  completed_at: Date | string | null;
  failed_at: Date | string | null;
}>;

type InboxReadSource = Readonly<{
  notification_ref: string;
  run_ref: string;
  analysis_ref: string;
  summary_code: string;
  created_at: Date | string;
  read_at: Date | string | null;
}>;

function exactReadInput(value: unknown, allowed: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new DecisionRoomPersistenceError("invalid_input");
  }
}

function readLimit(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 101) {
    throw new DecisionRoomPersistenceError("invalid_input");
  }
  return value as number;
}

function readAfter(value: unknown, temporal: boolean): ReadAfter | null {
  if (value === null) return null;
  exactReadInput(value, ["ref", "sortAt"]);
  const ref = opaqueRef(value.ref);
  const sortAt = temporal ? instant(value.sortAt) : value.sortAt === null
    ? null
    : (() => { throw new DecisionRoomPersistenceError("invalid_input"); })();
  return Object.freeze({ ref, sortAt });
}

function storedOpaqueRef(value: unknown): string {
  try {
    return opaqueRef(value);
  } catch {
    throw new DecisionRoomPersistenceError("corrupt_store");
  }
}

function publicAssetRef(kind: "account" | "campaign", workspaceId: string, internalId: unknown): string {
  if (typeof internalId !== "string" || !UUID_PATTERN.test(internalId)) {
    throw new DecisionRoomPersistenceError("corrupt_store");
  }
  return `${kind}_${sha256(`${workspaceId}:${kind}:${internalId}`).slice(0, 20)}`;
}

/**
 * Server-private read repository. The constructor binds one internal workspace
 * UUID to one opaque public workspace ref; neither database IDs nor Meta IDs
 * cross the repository boundary.
 */
export class DrizzleDecisionRoomReadRepository implements DecisionRoomReadRepository {
  private readonly workspaceId: string;
  private readonly workspaceRef: string;

  constructor(private readonly database: PersistenceDatabase, workspaceId: string, workspaceRef: string) {
    this.workspaceId = workspace(workspaceId);
    this.workspaceRef = opaqueRef(workspaceRef);
  }

  private bound(input: unknown, reader = false, temporal = false): Readonly<{
    after: ReadAfter | null;
    limit: number;
    readerRef: string | null;
    campaignRef: string | null;
  }> {
    exactReadInput(input, reader ? ["workspaceRef", "readerRef", "after", "limit"] : ["workspaceRef", "campaignRef", "after", "limit"]);
    if (input.workspaceRef !== this.workspaceRef) throw new DecisionRoomPersistenceError("workspace_scope_mismatch");
    return Object.freeze({
      after: readAfter(input.after, temporal),
      limit: readLimit(input.limit),
      readerRef: reader ? opaqueRef(input.readerRef) : null,
      campaignRef: reader || input.campaignRef === undefined || input.campaignRef === null ? null : (() => {
        if (typeof input.campaignRef !== "string" || !/^campaign_[a-f0-9]{20}$/.test(input.campaignRef)) {
          throw new DecisionRoomPersistenceError("invalid_input");
        }
        return input.campaignRef;
      })(),
    });
  }

  async listSchedules(input: Parameters<DecisionRoomReadRepository["listSchedules"]>[0]): Promise<readonly DecisionRoomScheduleReadRow[]> {
    const valid = this.bound(input);
    await assertActiveWorkspace(this.database, this.workspaceId);
    const result = rows<ScheduleReadSource>(await this.database.execute(sql`
      select schedule_ref, revision, definition_version, definition_hash, ad_account_id, campaign_id,
        account_ref, campaign_ref,
        timeframe_ref, template_ref, frequency, day_of_week, timezone, local_time, enabled,
        last_scheduled_for, next_run_at
      from decision_room_schedules
      where workspace_id = ${this.workspaceId}::uuid and workspace_ref = ${this.workspaceRef}
        and superseded_at is null
        and (${valid.campaignRef}::text is null or concat('campaign_', substring(encode(digest(concat(${this.workspaceId}, ':campaign:', campaign_id::text), 'sha256'), 'hex') from 1 for 20)) = ${valid.campaignRef})
        and (${valid.after?.ref ?? null}::text is null or schedule_ref > ${valid.after?.ref ?? null})
      order by schedule_ref asc
      limit ${valid.limit}
    `));
    return Object.freeze(result.map((row) => Object.freeze({
      workspaceRef: this.workspaceRef,
      version: row.definition_version as typeof DECISION_ROOM_SCHEDULE_VERSION,
      scheduleRef: storedOpaqueRef(row.schedule_ref),
      revision: row.revision,
      definitionHash: row.definition_hash,
      accountRef: publicAssetRef("account", this.workspaceId, row.ad_account_id),
      campaignRef: publicAssetRef("campaign", this.workspaceId, row.campaign_id),
      timeframeRef: storedOpaqueRef(row.timeframe_ref),
      templateRef: storedOpaqueRef(row.template_ref),
      frequency: row.frequency,
      dayOfWeek: row.day_of_week,
      timezone: row.timezone,
      localTime: row.local_time,
      enabled: row.enabled,
      lastScheduledFor: iso(row.last_scheduled_for),
      nextRunAt: iso(row.next_run_at),
    })));
  }

  async listRuns(input: Parameters<DecisionRoomReadRepository["listRuns"]>[0]): Promise<readonly DecisionRoomRunReadRow[]> {
    const valid = this.bound(input, false, true);
    await assertActiveWorkspace(this.database, this.workspaceId);
    const result = rows<RunReadSource>(await this.database.execute(sql`
      select run.run_ref, run.state, run.trigger_kind, run.trigger_ref,
        schedule.schedule_ref, run.schedule_definition_hash, run.ad_account_id, run.campaign_id,
        run.account_ref, run.campaign_ref, run.timeframe_ref, run.template_ref,
        run.attempt, run.started_at, run.completed_at, run.failed_at
      from decision_room_runs run
      left join decision_room_schedules schedule
        on schedule.workspace_id = run.workspace_id and schedule.id = run.schedule_id
      where run.workspace_id = ${this.workspaceId}::uuid
        and (${valid.campaignRef}::text is null or concat('campaign_', substring(encode(digest(concat(${this.workspaceId}, ':campaign:', run.campaign_id::text), 'sha256'), 'hex') from 1 for 20)) = ${valid.campaignRef})
        and (${valid.after?.sortAt ?? null}::timestamptz is null
          or (run.started_at, run.run_ref) < (${valid.after?.sortAt ?? null}::timestamptz, ${valid.after?.ref ?? null}::text))
      order by run.started_at desc, run.run_ref desc
      limit ${valid.limit}
    `));
    return Object.freeze(result.map((row) => Object.freeze({
      workspaceRef: this.workspaceRef,
      runRef: storedOpaqueRef(row.run_ref),
      status: row.state,
      triggerKind: row.trigger_kind,
      triggerRef: storedOpaqueRef(row.trigger_ref),
      scheduleRef: row.schedule_ref === null ? null : storedOpaqueRef(row.schedule_ref),
      scheduleDefinitionHash: row.schedule_definition_hash,
      accountRef: publicAssetRef("account", this.workspaceId, row.ad_account_id),
      campaignRef: publicAssetRef("campaign", this.workspaceId, row.campaign_id),
      timeframeRef: storedOpaqueRef(row.timeframe_ref),
      templateRef: storedOpaqueRef(row.template_ref),
      attempt: row.attempt,
      startedAt: iso(row.started_at)!,
      completedAt: iso(row.completed_at),
      failedAt: iso(row.failed_at),
    })));
  }

  async listInbox(input: Parameters<DecisionRoomReadRepository["listInbox"]>[0]): Promise<readonly DecisionRoomInboxReadRow[]> {
    const valid = this.bound(input, true, true);
    await assertActiveWorkspace(this.database, this.workspaceId);
    const result = rows<InboxReadSource>(await this.database.execute(sql`
      select item.notification_ref, run.run_ref, item.analysis_ref, item.summary_code,
        item.created_at, read_state.read_at
      from decision_room_inbox_items item
      join decision_room_runs run on run.workspace_id = item.workspace_id and run.id = item.run_id
      left join decision_room_inbox_reads read_state
        on read_state.workspace_id = item.workspace_id and read_state.inbox_item_id = item.id
        and read_state.reader_ref = ${valid.readerRef}
      where item.workspace_id = ${this.workspaceId}::uuid
        and (${valid.after?.sortAt ?? null}::timestamptz is null
          or (item.created_at, item.notification_ref) < (${valid.after?.sortAt ?? null}::timestamptz, ${valid.after?.ref ?? null}::text))
      order by item.created_at desc, item.notification_ref desc
      limit ${valid.limit}
    `));
    return Object.freeze(result.map((row) => Object.freeze({
      workspaceRef: this.workspaceRef,
      notificationRef: storedOpaqueRef(row.notification_ref),
      runRef: storedOpaqueRef(row.run_ref),
      analysisRef: storedOpaqueRef(row.analysis_ref),
      summaryCode: row.summary_code,
      createdAt: iso(row.created_at)!,
      readAt: iso(row.read_at),
    })));
  }

  async markInboxRead(input: Parameters<DecisionRoomReadRepository["markInboxRead"]>[0]) {
    exactReadInput(input, ["workspaceRef", "readerRef", "notificationRef", "readAt"]);
    if (input.workspaceRef !== this.workspaceRef) throw new DecisionRoomPersistenceError("workspace_scope_mismatch");
    const readerRef = opaqueRef(input.readerRef);
    const notificationRef = opaqueRef(input.notificationRef);
    if (!INBOX_REF_PATTERN.test(notificationRef)) throw new DecisionRoomPersistenceError("invalid_input");
    const readAt = instant(input.readAt);
    return this.database.transaction(async (transaction) => {
      await assertActiveWorkspace(transaction, this.workspaceId);
      await transaction.execute(sql`
        select pg_advisory_xact_lock(hashtextextended(
          ${`${this.workspaceId}:inbox-read:${notificationRef}:${readerRef}`}, 0
        ))
      `);
      const inserted = rows<{ notification_ref: string; read_at: Date | string }>(await transaction.execute(sql`
        insert into decision_room_inbox_reads (workspace_id, inbox_item_id, reader_ref, read_at)
        select ${this.workspaceId}::uuid, item.id, ${readerRef}, ${readAt}::timestamptz
        from decision_room_inbox_items item
        where item.workspace_id = ${this.workspaceId}::uuid and item.notification_ref = ${notificationRef}
        on conflict (workspace_id, inbox_item_id, reader_ref) do nothing
        returning ${notificationRef}::text as notification_ref, read_at
      `))[0];
      const stored = inserted ?? rows<{ notification_ref: string; read_at: Date | string }>(await transaction.execute(sql`
        select item.notification_ref, read_state.read_at
        from decision_room_inbox_items item
        join decision_room_inbox_reads read_state
          on read_state.workspace_id = item.workspace_id and read_state.inbox_item_id = item.id
          and read_state.reader_ref = ${readerRef}
        where item.workspace_id = ${this.workspaceId}::uuid and item.notification_ref = ${notificationRef}
        limit 1
      `))[0];
      if (!stored) return null;
      return Object.freeze({
        workspaceRef: this.workspaceRef,
        readerRef,
        notificationRef: storedOpaqueRef(stored.notification_ref),
        readAt: iso(stored.read_at)!,
        changed: Boolean(inserted),
      });
    });
  }
}
