import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { createBusinessOutcomeSignalBatch, summarizeBusinessOutcomeSignals, type BusinessOutcomeSignalBatch } from "@/analyses/business-outcome-signal";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
type Row = Readonly<Record<string, unknown>>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class BusinessOutcomeSignalRepositoryError extends Error {
  constructor(readonly code: "invalid_input" | "not_found" | "forbidden" | "conflict" | "corrupt_store") {
    super(`Business outcome signal rejected: ${code}`); this.name = "BusinessOutcomeSignalRepositoryError";
  }
}
function fail(code: BusinessOutcomeSignalRepositoryError["code"]): never { throw new BusinessOutcomeSignalRepositoryError(code); }
function rows<T extends Row = Row>(value: unknown): readonly T[] { if (!value || typeof value !== "object" || !("rows" in value) || !Array.isArray(value.rows)) fail("corrupt_store"); return value.rows as readonly T[]; }
function stable(value: unknown): unknown { return Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)])) : value; }
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function instant(value: unknown): string { if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail("invalid_input"); return value; }

/** Private canonical writer. Raw CSV/CRM payloads are deliberately absent from its input and SQL. */
export class DrizzleBusinessOutcomeSignalRepository {
  constructor(private readonly database: Database) {}
  async record(input: Readonly<{ workspaceId: string; actorId: string; actorRef: string; role: "owner" | "admin" | "analyst";
    batch: BusinessOutcomeSignalBatch; occurredAt: string }>) {
    if (!UUID.test(input.workspaceId) || !UUID.test(input.actorId) || !input.actorRef.trim() || !["owner", "admin", "analyst"].includes(input.role)) fail("invalid_input");
    const occurredAt = instant(input.occurredAt);
    let batch: BusinessOutcomeSignalBatch;
    try { batch = createBusinessOutcomeSignalBatch({ source: input.batch.source, signals: input.batch.signals }); }
    catch { fail("invalid_input"); }
    if (batch.batchId !== input.batch.batchId || batch.contractVersion !== input.batch.contractVersion) fail("invalid_input");
    const summary = summarizeBusinessOutcomeSignals(batch);
    return this.database.transaction(async (transaction) => {
      const tx = transaction as unknown as Database;
      if (rows(await tx.execute(sql`select id from workspaces where id = ${input.workspaceId}::uuid and lifecycle_state = 'active' for update`)).length !== 1) fail("not_found");
      const membership = rows<{ role: unknown }>(await tx.execute(sql`select role::text from memberships where workspace_id = ${input.workspaceId}::uuid and user_id = ${input.actorId}::uuid limit 2`));
      if (membership.length !== 1 || membership[0]!.role !== input.role) fail("forbidden");
      const inserted = rows<{ batch_id: unknown }>(await tx.execute(sql`
        insert into business_outcome_batches (workspace_id, batch_id, source_kind, source_ref, content_hash, observed_at, actor_id, actor_ref, actor_role)
        values (${input.workspaceId}::uuid, ${batch.batchId}, ${batch.source.kind}, ${batch.source.sourceRef}, ${batch.source.contentHash},
          ${batch.source.observedAt}::timestamptz, ${input.actorId}::uuid, ${input.actorRef}, ${input.role})
        on conflict (workspace_id, batch_id) do nothing returning batch_id
      `));
      if (inserted.length > 1) fail("corrupt_store");
      let outcome: "inserted" | "unchanged" = "inserted";
      if (inserted.length === 0) {
        outcome = "unchanged";
        const existing = rows<{ source_kind: unknown; source_ref: unknown; content_hash: unknown; observed_at: Date | string }>(await tx.execute(sql`
          select source_kind, source_ref, content_hash, observed_at from business_outcome_batches
          where workspace_id = ${input.workspaceId}::uuid and batch_id = ${batch.batchId} limit 2 for update
        `));
        const observedAt = existing[0]?.observed_at instanceof Date ? existing[0]!.observed_at.toISOString() : existing[0]?.observed_at;
        if (existing.length !== 1 || existing[0]!.source_kind !== batch.source.kind || existing[0]!.source_ref !== batch.source.sourceRef
          || existing[0]!.content_hash !== batch.source.contentHash || observedAt !== batch.source.observedAt) fail("corrupt_store");
      } else {
        const signals = rows<{ signal_ref: unknown }>(await tx.execute(sql`
          insert into business_outcome_signals (
            workspace_id, batch_id, signal_ref, entity_ref, occurred_at, outcome_kind, quantity,
            value_minor, currency, meta_entity_ref, mapping_status
          )
          select ${input.workspaceId}::uuid, ${batch.batchId}, signal."signalRef", signal."entityRef",
            signal."occurredAt"::timestamptz, signal.outcome, signal.quantity, signal."valueMinor"::bigint,
            signal.currency, signal."metaEntityRef", signal."mappingStatus"
          from jsonb_to_recordset(${JSON.stringify(batch.signals)}::jsonb) as signal(
            "signalRef" text, "entityRef" text, "occurredAt" text, outcome text, quantity integer,
            "valueMinor" bigint, currency text, "metaEntityRef" text, "mappingStatus" text
          ) returning signal_ref
        `));
        if (signals.length !== batch.signals.length || new Set(signals.map((row) => row.signal_ref)).size !== batch.signals.length) fail("corrupt_store");
      }
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`audit:${input.workspaceId}`}, 0))`);
      const previousHash = String(rows<{ event_hash: unknown }>(await tx.execute(sql`select event_hash from audit_events where workspace_id = ${input.workspaceId}::uuid order by occurred_at desc, created_at desc, id desc limit 1`))[0]?.event_hash ?? "GENESIS");
      const audit = { workspaceId: input.workspaceId, actorId: input.actorId, action: "business_outcome.recorded", resourceType: "business_outcome_batch",
        resourceId: batch.batchId, metadata: { sourceKind: batch.source.kind, sourceRef: batch.source.sourceRef, contentHash: batch.source.contentHash,
          signalCount: batch.signals.length, summary }, previousHash, occurredAt };
      await tx.execute(sql`insert into audit_events (workspace_id, actor_id, action, resource_type, resource_id, metadata, previous_hash, event_hash, occurred_at)
        values (${audit.workspaceId}::uuid, ${audit.actorId}::uuid, ${audit.action}, ${audit.resourceType}, ${audit.resourceId},
          ${JSON.stringify(audit.metadata)}::jsonb, ${audit.previousHash}, ${digest(audit)}, ${audit.occurredAt}::timestamptz)`);
      return Object.freeze({ outcome, batchId: batch.batchId, summary, capabilities: Object.freeze({ canPublish: false as const,
        canApprove: false as const, canExecute: false as const, canWriteMeta: false as const }) });
    });
  }

  async listPublic(input: Readonly<{ workspaceId: string; entityRef: string | null; before: Readonly<{ occurredAt: string; signalRef: string }> | null; limit: number }>) {
    if (!UUID.test(input.workspaceId) || !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 100
      || input.entityRef !== null && !/^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/.test(input.entityRef)
      || input.before !== null && (!instant(input.before.occurredAt) || !/^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/.test(input.before.signalRef))) fail("invalid_input");
    const before = input.before ? instant(input.before.occurredAt) : null;
    const rowsFound = rows<{ batch_id: unknown; signal_ref: unknown; entity_ref: unknown; occurred_at: Date | string; outcome_kind: unknown; quantity: unknown;
      value_minor: number | null; currency: unknown; meta_entity_ref: unknown; mapping_status: unknown; source_kind: unknown; source_ref: unknown; observed_at: Date | string }>(await this.database.execute(sql`
      select signal.batch_id, signal.signal_ref, signal.entity_ref, signal.occurred_at, signal.outcome_kind, signal.quantity,
        signal.value_minor, signal.currency, signal.meta_entity_ref, signal.mapping_status, batch.source_kind, batch.source_ref, batch.observed_at
      from business_outcome_signals signal join business_outcome_batches batch
        on batch.workspace_id = signal.workspace_id and batch.batch_id = signal.batch_id
      where signal.workspace_id = ${input.workspaceId}::uuid
        and (${input.entityRef}::text is null or signal.entity_ref = ${input.entityRef})
        and (${before}::timestamptz is null or (signal.occurred_at, signal.signal_ref) < (${before}::timestamptz, ${input.before?.signalRef ?? null}::text))
      order by signal.occurred_at desc, signal.signal_ref desc limit ${input.limit}
    `));
    return rowsFound.map((row) => Object.freeze({ batchId: String(row.batch_id), signalRef: String(row.signal_ref), entityRef: String(row.entity_ref),
      occurredAt: row.occurred_at instanceof Date ? row.occurred_at.toISOString() : instant(row.occurred_at), outcome: String(row.outcome_kind),
      quantity: Number(row.quantity), valueMinor: row.value_minor === null ? null : Number(row.value_minor), currency: row.currency === null ? null : String(row.currency),
      metaEntityRef: row.meta_entity_ref === null ? null : String(row.meta_entity_ref), mappingStatus: String(row.mapping_status), source: Object.freeze({
        kind: String(row.source_kind), sourceRef: String(row.source_ref), observedAt: row.observed_at instanceof Date ? row.observed_at.toISOString() : instant(row.observed_at) }),
    }));
  }
}
