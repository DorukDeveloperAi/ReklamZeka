import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type { GuideRunArtifact, GuideRunArtifactPort, GuideRunStorePort } from "@/application/guide-run-orchestration-service";
import { verifyAnyGuideRun, type AnyGuideRun } from "@/domain/guides/guide-run";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
type Executor = Pick<Database, "execute">;
type Row = Record<string, unknown>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const closed = Object.freeze({ canMutateGuide: false as const, canApprove: false as const, canExecute: false as const, canWriteMeta: false as const });
const EVENT_JSON_MAX = 16_000;
const HEAD_JSON_MAX = 1_040_000;

export class GuideRunDrizzleRepositoryError extends Error {
  constructor(readonly code: "invalid_input" | "corrupt_store" | "conflict" | "not_found") { super(`Guide run persistence rejected: ${code}`); }
}
function fail(code: GuideRunDrizzleRepositoryError["code"]): never { throw new GuideRunDrizzleRepositoryError(code); }
function rows(value: unknown): readonly Row[] { if (!value || typeof value !== "object" || !("rows" in value) || !Array.isArray(value.rows)) fail("corrupt_store"); return value.rows as readonly Row[]; }
function one(value: readonly Row[]): Row | null { if (value.length > 1) fail("corrupt_store"); return value[0] ?? null; }
function run(value: unknown): AnyGuideRun { if (!value || typeof value !== "object" || !verifyAnyGuideRun(value as AnyGuideRun)) fail("corrupt_store"); return value as AnyGuideRun; }
function artifact(value: unknown): GuideRunArtifact { if (!value || typeof value !== "object") fail("corrupt_store"); return value as GuideRunArtifact; }
function at(value: string): string { if (!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) || new Date(value).toISOString() !== value) fail("invalid_input"); return value; }
function digest(value: unknown): string { const stable = (item: unknown): unknown => Array.isArray(item) ? item.map(stable) : item && typeof item === "object" ? Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, stable(child)])) : item; return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
const closedHash = digest(closed);
function jsonWithin(value: unknown, maximum: number, code: GuideRunDrizzleRepositoryError["code"]): void {
  let encoded: string;
  try { encoded = JSON.stringify(value); } catch { fail(code); }
  // PostgreSQL jsonb::text adds structural whitespace. Keep a fixed safety
  // margin so every repository write is accepted by the matching SQL CHECK.
  if (typeof encoded !== "string" || Buffer.byteLength(encoded, "utf8") > maximum) fail(code);
}
function persistedRun(value: unknown): AnyGuideRun {
  const parsed = run(value);
  jsonWithin(parsed, HEAD_JSON_MAX, "corrupt_store");
  jsonWithin(parsed.trigger, EVENT_JSON_MAX, "corrupt_store");
  parsed.events.forEach((event) => jsonWithin(event, EVENT_JSON_MAX, "corrupt_store"));
  return parsed;
}

/** Server-only implementation. The complete verified domain envelope is the head payload; events/artifacts remain independently immutable. */
export class DrizzleGuideRunRepository implements GuideRunStorePort, GuideRunArtifactPort {
  constructor(private readonly database: Pick<Database, "execute" | "transaction">) {}
  async findByIdempotencyKey(input: Readonly<{ workspaceRef: string; idempotencyKey: string }>): Promise<AnyGuideRun | null> {
    const result = one(rows(await this.database.execute(sql`select h.run_payload from guide_runs r join guide_run_heads h on h.workspace_id=r.workspace_id and h.run_id=r.id where r.idempotency_key=${input.idempotencyKey} and h.run_payload->>'workspaceRef'=${input.workspaceRef} limit 2`)));
    return result ? persistedRun(result.run_payload) : null;
  }
  async insertIfAbsent(input: AnyGuideRun): Promise<AnyGuideRun> {
    if (!verifyAnyGuideRun(input) || input.version !== "guide-run/1.2.0") fail("invalid_input");
    jsonWithin(input, HEAD_JSON_MAX, "invalid_input"); jsonWithin(input.trigger, EVENT_JSON_MAX, "invalid_input"); input.events.forEach((event) => jsonWithin(event, EVENT_JSON_MAX, "invalid_input"));
    return this.database.transaction(async tx => {
      const existing = one(rows(await tx.execute(sql`select h.run_payload from guide_runs r join guide_run_heads h on h.workspace_id=r.workspace_id and h.run_id=r.id where r.idempotency_key=${input.idempotencyKey} and h.run_payload->>'workspaceRef'=${input.workspaceRef} for update limit 2`)));
      if (existing) return persistedRun(existing.run_payload);
      const revision = one(rows(await tx.execute(sql`select r.id::text revision_id,r.guide_id::text guide_id,r.workspace_id::text workspace_id from guide_revisions r join guides g on g.workspace_id=r.workspace_id and g.id=r.guide_id and g.tombstoned_at is null join guide_heads h on h.workspace_id=r.workspace_id and h.guide_id=r.guide_id and h.current_active_revision_id=r.id join workspaces w on w.id=r.workspace_id and w.lifecycle_state='active' where r.guide_ref=${input.guideRef} and r.revision_hash=${input.guideRevisionHash} limit 2`)));
      if (!revision || typeof revision.revision_id !== "string" || typeof revision.guide_id !== "string") fail("not_found");
      if (typeof revision.workspace_id !== "string" || `workspace_${createHash("sha256").update(revision.workspace_id).digest("hex").slice(0, 24)}` !== input.workspaceRef) fail("not_found");
      const created = one(rows(await tx.execute(sql`insert into guide_runs(workspace_id,guide_id,guide_revision_id,run_ref,guide_revision_hash,idempotency_key,run_version,trigger_payload,created_at) values(${revision.workspace_id}::uuid,${revision.guide_id}::uuid,${revision.revision_id}::uuid,${input.runRef},${input.guideRevisionHash},${input.idempotencyKey},${input.version},${JSON.stringify(input.trigger)}::jsonb,${input.events[0]!.occurredAt}::timestamptz) on conflict(workspace_id,idempotency_key) do nothing returning id::text,workspace_id::text`)));
      if (!created) { const won = one(rows(await tx.execute(sql`select h.run_payload from guide_runs r join guide_run_heads h on h.workspace_id=r.workspace_id and h.run_id=r.id where r.workspace_id=${revision.workspace_id}::uuid and r.idempotency_key=${input.idempotencyKey} for update limit 2`))); if (!won) fail("conflict"); return persistedRun(won.run_payload); }
      if (!created || typeof created.id !== "string" || typeof created.workspace_id !== "string") fail("corrupt_store");
      await this.event(tx, created.workspace_id, created.id, input.events[0]!);
      await tx.execute(sql`insert into guide_run_heads(workspace_id,run_id,state,sequence,head_event_hash,lease_token,lease_epoch,lease_expires_at,run_payload,updated_at) values(${created.workspace_id}::uuid,${created.id}::uuid,${input.state},${input.sequence},${input.headEventHash},null,null,null,${JSON.stringify(input)}::jsonb,${input.events[0]!.occurredAt}::timestamptz)`);
      return input;
    });
  }
  async compareAndSet(input: Readonly<{ run: AnyGuideRun; expectedHeadHash: string }>): Promise<AnyGuideRun | null> {
    if (!verifyAnyGuideRun(input.run) || input.run.version !== "guide-run/1.2.0" || !HASH.test(input.expectedHeadHash) || input.run.events.length < 2) fail("invalid_input");
    jsonWithin(input.run, HEAD_JSON_MAX, "invalid_input"); input.run.events.forEach((event) => jsonWithin(event, EVENT_JSON_MAX, "invalid_input"));
    return this.database.transaction(async tx => {
      const current = one(rows(await tx.execute(sql`select r.id::text run_id,r.workspace_id::text workspace_id from guide_runs r join guide_run_heads h on h.workspace_id=r.workspace_id and h.run_id=r.id where r.run_ref=${input.run.runRef} and h.head_event_hash=${input.expectedHeadHash} for update limit 2`)));
      if (!current || typeof current.run_id !== "string" || typeof current.workspace_id !== "string") return null;
      const event = input.run.events.at(-1)!; await this.event(tx, current.workspace_id, current.run_id, event);
      const lease = input.run.lease;
      const saved = rows(await tx.execute(sql`update guide_run_heads set state=${input.run.state},sequence=${input.run.sequence},head_event_hash=${input.run.headEventHash},lease_token=${lease?.token ?? null}::uuid,lease_epoch=${lease?.epoch ?? null},lease_expires_at=${lease?.expiresAt ?? null}::timestamptz,run_payload=${JSON.stringify(input.run)}::jsonb,updated_at=${event.occurredAt}::timestamptz where workspace_id=${current.workspace_id}::uuid and run_id=${current.run_id}::uuid and head_event_hash=${input.expectedHeadHash} returning run_payload`));
      return saved.length === 1 ? persistedRun(saved[0]!.run_payload) : null;
    });
  }
  async fence(input: Readonly<{ runRef: string; expectedHeadHash: string; leaseToken: string; leaseEpoch: number; now: string }>): Promise<AnyGuideRun | null> {
    if (!HASH.test(input.expectedHeadHash) || !UUID.test(input.leaseToken) || !Number.isSafeInteger(input.leaseEpoch) || input.leaseEpoch < 1) fail("invalid_input");
    const found = one(rows(await this.database.execute(sql`select h.run_payload from guide_runs r join guide_run_heads h on h.workspace_id=r.workspace_id and h.run_id=r.id where r.run_ref=${input.runRef} and h.head_event_hash=${input.expectedHeadHash} and h.lease_token=${input.leaseToken}::uuid and h.lease_epoch=${input.leaseEpoch} and h.lease_expires_at>${at(input.now)}::timestamptz limit 2`)));
    return found ? persistedRun(found.run_payload) : null;
  }
  async list(runRef: string): Promise<readonly GuideRunArtifact[]> {
    const values = rows(await this.database.execute(sql`select a.artifact_ref,a.kind,a.payload,a.payload_hash,a.occurred_at::text,a.authority,r.run_ref from guide_run_artifacts a join guide_runs r on r.workspace_id=a.workspace_id and r.id=a.run_id where r.run_ref=${runRef} order by a.occurred_at,a.artifact_ref limit 30006`));
    if (values.length > 30005) fail("corrupt_store");
    return Object.freeze(values.map(row => artifact({ artifactRef: row.artifact_ref, runRef: row.run_ref, kind: row.kind, payload: row.payload, payloadHash: row.payload_hash, occurredAt: new Date(String(row.occurred_at)).toISOString(), authority: row.authority, immutable: true })));
  }
  async append(input: GuideRunArtifact): Promise<void> {
    if (!input.immutable || digest(input.authority) !== closedHash || !HASH.test(input.payloadHash) || input.payloadHash !== digest(input.payload)) fail("invalid_input");
    jsonWithin(input.payload, EVENT_JSON_MAX, "invalid_input");
    await this.database.transaction(async tx => {
      const target = one(rows(await tx.execute(sql`select id::text,workspace_id::text from guide_runs where run_ref=${input.runRef} for update limit 2`)));
      if (!target || typeof target.id !== "string" || typeof target.workspace_id !== "string") fail("not_found");
      const inserted = rows(await tx.execute(sql`insert into guide_run_artifacts(workspace_id,run_id,artifact_ref,kind,payload_hash,payload,occurred_at,authority) values(${target.workspace_id}::uuid,${target.id}::uuid,${input.artifactRef},${input.kind},${input.payloadHash},${JSON.stringify(input.payload)}::jsonb,${input.occurredAt}::timestamptz,${JSON.stringify(closed)}::jsonb) on conflict(workspace_id,artifact_ref) do nothing returning id`));
      if (!inserted.length) { const existing = one(rows(await tx.execute(sql`select kind,payload_hash,payload,occurred_at::text,authority from guide_run_artifacts where workspace_id=${target.workspace_id}::uuid and artifact_ref=${input.artifactRef} limit 2`))); if (!existing || existing.kind !== input.kind || existing.payload_hash !== input.payloadHash || digest(existing.payload) !== digest(input.payload) || digest(existing.authority) !== closedHash || new Date(String(existing.occurred_at)).toISOString() !== input.occurredAt) fail("conflict"); }
    });
  }
  /** Durable replay-safe scheduler fire, including the coalesced missed range. */
  async recordScheduleReceipt(input: Readonly<{ workspaceId: string; guideRevisionId: string; scheduledFor: string; missedFrom: string | null; missedTo: string | null; missedCount: number; runRef: string | null; createdAt: string }>): Promise<void> {
    if (!UUID.test(input.workspaceId) || !UUID.test(input.guideRevisionId) || (input.missedFrom === null) !== (input.missedTo === null)) fail("invalid_input");
    const scheduledFor = at(input.scheduledFor), missedFrom = input.missedFrom === null ? null : at(input.missedFrom), missedTo = input.missedTo === null ? null : at(input.missedTo), createdAt = at(input.createdAt);
    if (!Number.isSafeInteger(input.missedCount) || input.missedCount < 0 || input.missedCount > 1_000_000 || missedFrom && (!missedTo || input.missedCount < 1 || Date.parse(missedFrom) > Date.parse(missedTo) || Date.parse(missedTo) > Date.parse(scheduledFor)) || !missedFrom && input.missedCount !== 0) fail("invalid_input");
    const fireRef = `guide_fire_${digest({ workspaceId: input.workspaceId, guideRevisionId: input.guideRevisionId, scheduledFor }).slice(0, 64)}`;
    const receiptHash = digest({ version: "guide-run-schedule-receipt/1.0.0", fireRef, guideRevisionId: input.guideRevisionId, scheduledFor, missedFrom, missedTo, missedCount: input.missedCount, runRef: input.runRef });
    await this.database.transaction(async tx => {
      const target = input.runRef === null ? null : one(rows(await tx.execute(sql`select id::text from guide_runs where workspace_id=${input.workspaceId}::uuid and run_ref=${input.runRef} limit 2`)));
      if (input.runRef !== null && (!target || typeof target.id !== "string")) fail("not_found");
      const inserted = rows(await tx.execute(sql`insert into guide_run_schedule_receipts(workspace_id,guide_revision_id,fire_ref,scheduled_for,missed_from,missed_to,missed_count,run_id,receipt_hash,created_at) values(${input.workspaceId}::uuid,${input.guideRevisionId}::uuid,${fireRef},${scheduledFor}::timestamptz,${missedFrom}::timestamptz,${missedTo}::timestamptz,${input.missedCount},${target?.id ?? null}::uuid,${receiptHash},${createdAt}::timestamptz) on conflict(workspace_id,fire_ref) do nothing returning id`));
      if (!inserted.length) { const existing = one(rows(await tx.execute(sql`select receipt_hash from guide_run_schedule_receipts where workspace_id=${input.workspaceId}::uuid and fire_ref=${fireRef} limit 2`))); if (!existing || existing.receipt_hash !== receiptHash) fail("conflict"); }
    });
  }
  private async event(tx: Executor, workspaceId: string, runId: string, event: AnyGuideRun["events"][number]): Promise<void> {
    const inserted = rows(await tx.execute(sql`insert into guide_run_events(workspace_id,run_id,event_ref,event_hash,sequence,previous_event_hash,payload,occurred_at) values(${workspaceId}::uuid,${runId}::uuid,${event.eventRef},${event.eventHash},${event.sequence},${event.previousEventHash},${JSON.stringify(event)}::jsonb,${event.occurredAt}::timestamptz) on conflict(workspace_id,event_hash) do nothing returning id`));
    if (!inserted.length) { const existing = one(rows(await tx.execute(sql`select run_id::text,event_ref,sequence,previous_event_hash,payload,occurred_at::text from guide_run_events where workspace_id=${workspaceId}::uuid and event_hash=${event.eventHash} limit 2`))); if (!existing || existing.run_id !== runId || existing.event_ref !== event.eventRef || Number(existing.sequence) !== event.sequence || existing.previous_event_hash !== event.previousEventHash || digest(existing.payload) !== digest(event) || new Date(String(existing.occurred_at)).toISOString() !== event.occurredAt) fail("conflict"); }
  }
}
