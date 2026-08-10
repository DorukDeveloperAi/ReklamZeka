import { PgDialect } from "drizzle-orm/pg-core";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { createBusinessOutcomeSignalBatch } from "@/analyses/business-outcome-signal";
import { DrizzleBusinessOutcomeSignalRepository } from "@/connectors/analyses/business-outcome-signal-drizzle-repository";
import { WORKSPACE_TOMBSTONE_PURGE_TABLES } from "@/connectors/meta/workspace-tombstone-purge-drizzle-adapter";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const batch = createBusinessOutcomeSignalBatch({ source: { kind: "csv", sourceRef: "source_outcomes", contentHash: "a".repeat(64), observedAt: "2026-08-10T09:00:00.000Z" },
  signals: [{ signalRef: "signal_lead", entityRef: "campaign_primary", occurredAt: "2026-08-09T09:00:00.000Z", outcome: "qualified_lead", quantity: 2, valueMinor: null, currency: null, metaEntityRef: null, mappingStatus: "unmapped" },
    { signalRef: "signal_revenue", entityRef: "campaign_primary", occurredAt: "2026-08-09T10:00:00.000Z", outcome: "revenue", quantity: 1, valueMinor: 12500, currency: "TRY", metaEntityRef: "meta_campaign_primary", mappingStatus: "verified" }] });
function repository(responses: readonly unknown[][]) {
  let index = 0; const execute = vi.fn(async () => ({ rows: responses[index++] ?? [] }));
  return { execute, repository: new DrizzleBusinessOutcomeSignalRepository({ execute,
    transaction: async (work: (transaction: unknown) => Promise<unknown>) => work({ execute }) } as never) };
}

describe("DrizzleBusinessOutcomeSignalRepository", () => {
  it("persists only normalized evidence behind tenant FKs, RLS, revoke and tombstone guards", () => {
    const migration = readFileSync("drizzle/20260810131842_dizzy_blue_shield.sql", "utf8");
    for (const table of ["business_outcome_batches", "business_outcome_signals"]) {
      expect(migration).toContain(`CREATE TABLE "${table}"`);
      expect(migration).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      expect(migration).toContain(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
      expect(migration).toContain(`REVOKE ALL PRIVILEGES ON TABLE ${table} FROM PUBLIC, anon, authenticated, service_role`);
      expect(WORKSPACE_TOMBSTONE_PURGE_TABLES).toContain(table);
    }
    expect(migration).toContain("business_outcome_signals_batch_scope_fk");
    expect(migration).toContain("business_outcome_immutable_guard");
    expect(migration).not.toMatch(/DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM/);
  });

  it("canonicalizes before active membership, appends normalized rows and an audit event in one transaction", async () => {
    const harness = repository([[{ id: workspaceId }], [{ role: "analyst" }], [{ batch_id: batch.batchId }],
      [{ signal_ref: "signal_lead" }, { signal_ref: "signal_revenue" }], [], [{ current_head_hash: "b".repeat(64) }], [], [], []]);
    await expect(harness.repository.record({ workspaceId, actorId, actorRef: "reader_analyst", role: "analyst", batch,
      occurredAt: "2026-08-10T12:00:00.000Z" })).resolves.toMatchObject({ outcome: "inserted", batchId: batch.batchId,
      summary: { metaProxyEligible: false }, capabilities: { canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false } });
    const rendered = (harness.execute.mock.calls as unknown[][]).map(([query]) => new PgDialect().sqlToQuery(query as never).sql).join("\n");
    expect(rendered).toContain("for update"); expect(rendered).toContain("jsonb_to_recordset");
    expect(rendered).toContain("insert into business_outcome_batches"); expect(rendered).toContain("insert into business_outcome_signals"); expect(rendered).toContain("business_outcome_entity_heads");
    expect(rendered).toContain("pg_advisory_xact_lock"); expect(rendered).toContain("insert into audit_events");
    expect(rendered).not.toMatch(/raw_csv|raw_payload|prompt|token/i);
  });

  it("rejects an unauthenticated role before any outcome batch is appended", async () => {
    const harness = repository([[{ id: workspaceId }], [{ role: "viewer" }]]);
    await expect(harness.repository.record({ workspaceId, actorId, actorRef: "reader_viewer", role: "analyst", batch,
      occurredAt: "2026-08-10T12:00:00.000Z" })).rejects.toMatchObject({ code: "forbidden" });
    const rendered = (harness.execute.mock.calls as unknown[][]).map(([query]) => new PgDialect().sqlToQuery(query as never).sql).join("\n");
    expect(rendered).not.toContain("insert into business_outcome_batches");
  });

  it("reads normalized public rows with tenant and keyset bounds, excluding raw source and actor fields", async () => {
    const harness = repository([[{ batch_id: batch.batchId, signal_ref: "signal_revenue", entity_ref: "campaign_primary", occurred_at: "2026-08-09T10:00:00.000Z", outcome_kind: "revenue", quantity: 1, value_minor: 12500, currency: "TRY", meta_entity_ref: "meta_campaign_primary", mapping_status: "verified", source_kind: "csv", source_ref: "source_outcomes", observed_at: "2026-08-10T09:00:00.000Z" }]]);
    await expect(harness.repository.listPublic({ workspaceId, entityRef: "campaign_primary", before: { occurredAt: "2026-08-10T00:00:00.000Z", signalRef: "signal_z" }, limit: 25 })).resolves.toMatchObject([{ signalRef: "signal_revenue", source: { sourceRef: "source_outcomes" } }]);
    const rendered = new PgDialect().sqlToQuery((harness.execute.mock.calls as unknown[][])[0]![0] as never).sql;
    expect(rendered).toContain("signal.workspace_id"); expect(rendered).toContain("signal.occurred_at, signal.signal_ref");
    expect(rendered).not.toMatch(/content_hash|actor_id|actor_ref|audit_events/i);
  });
});
