import { readFileSync } from "node:fs";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { DrizzleBusinessOutcomeEvidenceRepository } from "@/connectors/analyses/business-outcome-evidence-drizzle-repository";
import { WORKSPACE_TOMBSTONE_PURGE_TABLES } from "@/connectors/meta/workspace-tombstone-purge-drizzle-adapter";

const workspaceId = "11111111-1111-4111-8111-111111111111";
function repository(responses: readonly unknown[][]) {
  let index = 0; const execute = vi.fn(async () => ({ rows: responses[index++] ?? [] }));
  return { execute, repository: new DrizzleBusinessOutcomeEvidenceRepository({ execute, transaction: async (work: (transaction: unknown) => Promise<unknown>) => work({ execute }) } as never) };
}
describe("DrizzleBusinessOutcomeEvidenceRepository", () => {
  it("uses immutable tenant-scoped head/snapshot tables with RLS, revoke and append-only guards", () => {
    const migration = readFileSync("drizzle/20260810133352_clear_norrin_radd.sql", "utf8");
    for (const table of ["business_outcome_entity_heads", "business_outcome_evidence_snapshots"]) {
      expect(migration).toContain(`CREATE TABLE "${table}"`); expect(migration).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      expect(migration).toContain(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`); expect(migration).toContain(`REVOKE ALL PRIVILEGES ON TABLE ${table} FROM PUBLIC, anon, authenticated, service_role`);
      expect(WORKSPACE_TOMBSTONE_PURGE_TABLES).toContain(table);
    }
    expect(migration).toContain("business_outcome_entity_head_guard"); expect(migration).toContain("business_outcome_evidence_snapshot_guard");
  });
  it("locks the active workspace/head, derives a compact exact-window snapshot and persists it immutably", async () => {
    const harness = repository([[{ id: workspaceId }], [{ current_head_hash: "a".repeat(64), updated_at: "2026-08-10T12:00:00.000Z" }], [{ batch_id: "outcome_batch_primary", signal_ref: "signal_lead", entity_ref: "campaign_primary", occurred_at: "2026-08-09T00:00:00.000Z", outcome_kind: "qualified_lead", quantity: 2, value_minor: null, currency: null, mapping_status: "unmapped" }], [{ evidence_hash: "b".repeat(64) }]]);
    const result = await harness.repository.materialize({ workspaceId, entityRef: "campaign_primary", windowStart: "2026-08-08T00:00:00.000Z", windowEnd: "2026-08-10T00:00:00.000Z" });
    expect(result).toMatchObject({ entityRef: "campaign_primary", sourceHeadHash: "a".repeat(64), summary: { signalCount: 1, totals: { qualified_lead: 2 }, metaProxyEligible: false } });
    const rendered = (harness.execute.mock.calls as unknown[][]).map(([query]) => new PgDialect().sqlToQuery(query as never).sql).join("\n");
    expect(rendered).toContain("workspaces"); expect(rendered).toContain("for update"); expect(rendered).toContain("for share"); expect(rendered).toContain("business_outcome_evidence_snapshots");
    expect(rendered).not.toMatch(/content_hash|actor_id|raw_csv|audit_events/i);
  });
  it("fails closed when no current source head exists", async () => {
    const harness = repository([[{ id: workspaceId }], []]);
    await expect(harness.repository.materialize({ workspaceId, entityRef: "campaign_primary", windowStart: "2026-08-08T00:00:00.000Z", windowEnd: "2026-08-10T00:00:00.000Z" })).rejects.toMatchObject({ code: "not_found" });
  });
});
