import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type { DeliveryHealthAlertLedgerPort } from "@/application/delivery-health-alert-ledger-service";
import {
  transitionDeliveryHealthAlertLedger,
  verifyDeliveryHealthAlertLedger,
  type DeliveryHealthAlertLedgerRecord,
} from "@/domain/meta/delivery-health-alert-ledger";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
type Executor = Pick<Database, "execute">;
type LedgerDatabase = Pick<Database, "execute" | "transaction">;

export class DeliveryHealthAlertLedgerRepositoryError extends Error {
  constructor(readonly code: "invalid_input" | "workspace_unavailable" | "membership_required" | "role_denied"
    | "not_found" | "conflict" | "corrupt_store") {
    super(`Delivery health alert repository rejected: ${code}`);
    this.name = "DeliveryHealthAlertLedgerRepositoryError";
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALERT_REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const HASH = /^[a-f0-9]{64}$/;

function fail(code: DeliveryHealthAlertLedgerRepositoryError["code"]): never {
  throw new DeliveryHealthAlertLedgerRepositoryError(code);
}
function rows<T>(value: unknown): readonly T[] {
  if (!value || typeof value !== "object" || !("rows" in value) || !Array.isArray(value.rows)) fail("corrupt_store");
  return value.rows as readonly T[];
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, stable(child)]));
  return value;
}
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }

async function access(database: Executor, workspaceId: string, actorId: string, write: boolean) {
  if (!UUID.test(workspaceId) || !UUID.test(actorId)) fail("invalid_input");
  const suffix = write ? sql` for update of membership` : sql``;
  const found = rows<{ role: string }>(await database.execute(sql`
    select membership.role::text as role from memberships membership
    join workspaces workspace on workspace.id = membership.workspace_id and workspace.lifecycle_state = 'active'
    where membership.workspace_id = ${workspaceId}::uuid and membership.user_id = ${actorId}::uuid
    limit 2${suffix}
  `));
  if (found.length !== 1) fail(found.length ? "corrupt_store" : "membership_required");
  if (write && found[0]!.role === "viewer") fail("role_denied");
  return found[0]!.role;
}

async function history(database: Executor, workspaceId: string, alertRef: string, lock: boolean) {
  const suffix = lock ? sql` for update` : sql``;
  const stored = rows<{ record_payload: unknown }>(await database.execute(sql`
    select record_payload from delivery_health_alert_ledger_records
    where workspace_id = ${workspaceId}::uuid and alert_ref = ${alertRef}
    order by sequence asc${suffix}
  `));
  const records = stored.map((row) => row.record_payload as DeliveryHealthAlertLedgerRecord);
  if (records.length && !verifyDeliveryHealthAlertLedger(records)) fail("corrupt_store");
  return Object.freeze(records);
}

async function append(database: Executor, workspaceId: string, actorId: string, record: DeliveryHealthAlertLedgerRecord) {
  await database.execute(sql`
    insert into delivery_health_alert_ledger_records (
      workspace_id, alert_ref, account_ref, sequence, previous_record_hash, record_hash, alert_hash,
      evidence_hash, evidence_level, official_state, status, recommendation_disposition,
      assigned_actor_ref, checklist_payload, event_type, event_actor_ref, occurred_at,
      created_by_actor_id, record_payload
    ) values (
      ${workspaceId}::uuid, ${record.alert.alertRef}, ${record.alert.accountRef}, ${record.sequence},
      ${record.previousRecordHash}, ${record.recordHash}, ${record.alert.alertHash}, ${record.alert.evidenceHash},
      ${record.alert.evidence.level}, ${record.alert.evidence.level === "confirmed" ? record.alert.evidence.officialState : null},
      ${record.current.status}, ${record.current.recommendationDisposition}, ${record.current.assignedActorRef},
      ${JSON.stringify(record.current.checklist)}::jsonb, ${record.event.kind}, ${record.event.actorRef},
      ${record.event.occurredAt}::timestamptz, ${actorId}::uuid, ${JSON.stringify(record)}::jsonb
    )
  `);
  await database.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`audit:${workspaceId}`}, 0))`);
  const previousHash = String(rows<{ event_hash: unknown }>(await database.execute(sql`
    select event_hash from audit_events where workspace_id = ${workspaceId}::uuid
    order by occurred_at desc, created_at desc, id desc limit 1
  `))[0]?.event_hash ?? "GENESIS");
  const audit = { id: randomUUID(), workspaceId, actorId, action: `delivery_health_alert.${record.event.kind}`,
    resourceType: "delivery_health_alert", resourceId: record.alert.alertRef,
    metadata: { recordHash: record.recordHash, evidenceHash: record.alert.evidenceHash,
      evidenceLevel: record.alert.evidence.level, status: record.current.status,
      recommendationDisposition: record.current.recommendationDisposition }, previousHash,
    occurredAt: record.event.occurredAt };
  await database.execute(sql`
    insert into audit_events (id, workspace_id, actor_id, action, resource_type, resource_id,
      metadata, previous_hash, event_hash, occurred_at)
    values (${audit.id}::uuid, ${workspaceId}::uuid, ${actorId}::uuid, ${audit.action},
      ${audit.resourceType}, ${audit.resourceId}, ${JSON.stringify(audit.metadata)}::jsonb,
      ${previousHash}, ${digest(audit)}, ${audit.occurredAt}::timestamptz)
  `);
}

export class DrizzleDeliveryHealthAlertLedgerRepository implements DeliveryHealthAlertLedgerPort {
  constructor(private readonly database: LedgerDatabase) {}

  async materialize(input: Parameters<DeliveryHealthAlertLedgerPort["materialize"]>[0]) {
    if (!verifyDeliveryHealthAlertLedger([input.record]) || input.record.sequence !== 1
      || input.record.alert.workspaceRef !== input.workspaceRef) fail("invalid_input");
    return this.database.transaction(async (transaction) => {
      const tx = transaction as Executor;
      await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`delivery-alert:${input.workspaceId}:${input.record.alert.alertRef}`}, 0))`);
      const role = await access(tx, input.workspaceId, input.actorId, true);
      if (role !== input.role) fail("role_denied");
      const current = await history(tx, input.workspaceId, input.record.alert.alertRef, true);
      if (current.length) {
        if (current[0]!.alert.alertHash !== input.record.alert.alertHash) fail("conflict");
        return Object.freeze({ outcome: "unchanged" as const, record: current.at(-1)! });
      }
      await append(tx, input.workspaceId, input.actorId, input.record);
      return Object.freeze({ outcome: "inserted" as const, record: input.record });
    });
  }

  async transition(input: Parameters<DeliveryHealthAlertLedgerPort["transition"]>[0]) {
    if (!ALERT_REF.test(input.alertRef) || !HASH.test(input.expectedRecordHash)) fail("invalid_input");
    return this.database.transaction(async (transaction) => {
      const tx = transaction as Executor;
      await transaction.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`delivery-alert:${input.workspaceId}:${input.alertRef}`}, 0))`);
      const role = await access(tx, input.workspaceId, input.actorId, true);
      if (role !== input.role) fail("role_denied");
      const records = await history(tx, input.workspaceId, input.alertRef, true);
      const head = records.at(-1);
      if (!head) fail("not_found");
      let next: DeliveryHealthAlertLedgerRecord;
      try { next = transitionDeliveryHealthAlertLedger({ head, expectedRecordHash: input.expectedRecordHash,
        actorRef: input.actorRef, occurredAt: input.occurredAt, command: input.command }); }
      catch (reason) {
        if (reason && typeof reason === "object" && "code" in reason && reason.code === "stale_head") fail("conflict");
        fail("invalid_input");
      }
      await append(tx, input.workspaceId, input.actorId, next);
      return next;
    });
  }

  async listCurrent(input: Parameters<DeliveryHealthAlertLedgerPort["listCurrent"]>[0]) {
    const limit = input.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) fail("invalid_input");
    await access(this.database, input.workspaceId, input.actorId, false);
    const found = rows<{ alert_ref: string }>(await this.database.execute(sql`
      select alert_ref from delivery_health_alert_ledger_records
      where workspace_id = ${input.workspaceId}::uuid
      group by alert_ref order by max(occurred_at) desc, alert_ref asc limit ${limit}
    `));
    const current: DeliveryHealthAlertLedgerRecord[] = [];
    for (const row of found) {
      const records = await history(this.database, input.workspaceId, row.alert_ref, false);
      const head = records.at(-1);
      if (!head) fail("corrupt_store");
      current.push(head);
    }
    return Object.freeze(current);
  }
}
