import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { buildBusinessOutcomeEvidence, type BusinessOutcomeEvidenceSnapshot } from "@/analyses/business-outcome-evidence";
import * as schema from "@/db/schema";

type Database = NodePgDatabase<typeof schema>;
type Row = Readonly<Record<string, unknown>>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
export class BusinessOutcomeEvidenceRepositoryError extends Error {
  constructor(readonly code: "invalid_input" | "not_found" | "corrupt_store") { super(`Business outcome evidence rejected: ${code}`); this.name = "BusinessOutcomeEvidenceRepositoryError"; }
}
function fail(code: BusinessOutcomeEvidenceRepositoryError["code"]): never { throw new BusinessOutcomeEvidenceRepositoryError(code); }
function rows<T extends Row = Row>(value: unknown): readonly T[] { if (!value || typeof value !== "object" || !("rows" in value) || !Array.isArray(value.rows)) fail("corrupt_store"); return value.rows as readonly T[]; }
function instant(value: unknown): string { if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail("invalid_input"); return value; }
function stable(value: unknown): unknown { return Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, stable(entry)])) : value; }
function canonical(value: unknown): string { return JSON.stringify(stable(value)); }
/** PostgreSQL may return timestamptz strings in a valid non-ISO rendering; normalize DB results separately from request input. */
function date(value: unknown): string { if (value instanceof Date) return value.toISOString(); if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) fail("corrupt_store"); return new Date(value).toISOString(); }

/** Server-private L4 materializer. It reads one locked source head and writes an immutable, head-bound snapshot. */
export class DrizzleBusinessOutcomeEvidenceRepository {
  constructor(private readonly database: Database) {}
  async materialize(input: Readonly<{ workspaceId: string; entityRef: string; windowStart: string; windowEnd: string }>): Promise<BusinessOutcomeEvidenceSnapshot> {
    if (!UUID.test(input.workspaceId) || !REF.test(input.entityRef)) fail("invalid_input");
    const windowStart = instant(input.windowStart); const windowEnd = instant(input.windowEnd);
    if (Date.parse(windowStart) >= Date.parse(windowEnd)) fail("invalid_input");
    return this.database.transaction(async (transaction) => {
      const tx = transaction as unknown as Database;
      if (rows(await tx.execute(sql`select id from workspaces where id = ${input.workspaceId}::uuid and lifecycle_state = 'active' for update`)).length !== 1) fail("not_found");
      const head = rows<{ current_head_hash: unknown; updated_at: Date | string }>(await tx.execute(sql`
        select current_head_hash, updated_at from business_outcome_entity_heads where workspace_id = ${input.workspaceId}::uuid and entity_ref = ${input.entityRef} limit 2 for share
      `));
      if (head.length !== 1 || typeof head[0]!.current_head_hash !== "string" || !/^[a-f0-9]{64}$/.test(head[0]!.current_head_hash)) fail(head.length === 0 ? "not_found" : "corrupt_store");
      const materializedAt = date(head[0]!.updated_at);
      if (Date.parse(windowEnd) > Date.parse(materializedAt)) fail("invalid_input");
      const source = rows<{ batch_id: unknown; signal_ref: unknown; entity_ref: unknown; occurred_at: Date | string; outcome_kind: unknown; quantity: unknown; value_minor: number | null; currency: unknown; mapping_status: unknown }>(await tx.execute(sql`
        select batch_id, signal_ref, entity_ref, occurred_at, outcome_kind, quantity, value_minor, currency, mapping_status
        from business_outcome_signals where workspace_id = ${input.workspaceId}::uuid and entity_ref = ${input.entityRef}
          and occurred_at >= ${windowStart}::timestamptz and occurred_at < ${windowEnd}::timestamptz
        order by occurred_at asc, signal_ref asc
      `));
      const sourceHeadHash = String(head[0]!.current_head_hash);
      let evidence: BusinessOutcomeEvidenceSnapshot;
      try {
        evidence = buildBusinessOutcomeEvidence({ entityRef: input.entityRef, sourceHeadHash, windowStart, windowEnd, materializedAt,
          signals: source.map((row) => ({ batchId: String(row.batch_id), signalRef: String(row.signal_ref), entityRef: String(row.entity_ref), occurredAt: date(row.occurred_at),
            outcome: String(row.outcome_kind) as never, quantity: Number(row.quantity), valueMinor: row.value_minor === null ? null : Number(row.value_minor),
            currency: row.currency === null ? null : String(row.currency), mappingStatus: String(row.mapping_status) as never })) });
      } catch { fail("corrupt_store"); }
      const inserted = rows<{ evidence_hash: unknown }>(await tx.execute(sql`
        insert into business_outcome_evidence_snapshots (workspace_id, evidence_ref, evidence_hash, entity_ref, source_head_hash, source_manifest_hash, window_start, window_end, materialized_at, evidence_payload)
        values (${input.workspaceId}::uuid, ${evidence.evidenceRef}, ${evidence.evidenceHash}, ${evidence.entityRef}, ${evidence.sourceHeadHash}, ${evidence.sourceManifestHash},
          ${evidence.windowStart}::timestamptz, ${evidence.windowEnd}::timestamptz, ${evidence.materializedAt}::timestamptz, ${JSON.stringify(evidence)}::jsonb)
        on conflict (workspace_id, evidence_hash) do nothing returning evidence_hash
      `));
      if (inserted.length === 1 && typeof inserted[0]!.evidence_hash === "string" && /^[a-f0-9]{64}$/.test(inserted[0]!.evidence_hash)) return evidence;
      if (inserted.length !== 0) fail("corrupt_store");
      const existing = rows<{ evidence_ref: unknown; entity_ref: unknown; source_head_hash: unknown; source_manifest_hash: unknown; window_start: Date | string; window_end: Date | string; materialized_at: Date | string; evidence_payload: unknown }>(await tx.execute(sql`
        select evidence_ref, entity_ref, source_head_hash, source_manifest_hash, window_start, window_end, materialized_at, evidence_payload
        from business_outcome_evidence_snapshots where workspace_id = ${input.workspaceId}::uuid and evidence_hash = ${evidence.evidenceHash} limit 2
      `));
      const row = existing[0];
      if (existing.length !== 1 || !row || row.evidence_ref !== evidence.evidenceRef || row.entity_ref !== evidence.entityRef || row.source_head_hash !== evidence.sourceHeadHash
        || row.source_manifest_hash !== evidence.sourceManifestHash || date(row.window_start) !== evidence.windowStart || date(row.window_end) !== evidence.windowEnd
        || date(row.materialized_at) !== evidence.materializedAt || canonical(row.evidence_payload) !== canonical(evidence)) fail("corrupt_store");
      return evidence;
    });
  }
}
