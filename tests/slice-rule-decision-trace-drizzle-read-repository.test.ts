import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

import { DrizzleSliceRuleDecisionTraceReadRepository } from "@/connectors/campaigns/slice-rule-decision-trace-drizzle-read-repository";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const selectionId = "10000000-0000-4000-8000-000000000001";
const bindingId = "20000000-0000-4000-8000-000000000001";
const unitId = "30000000-0000-4000-8000-000000000001";
const bundleId = "40000000-0000-4000-8000-000000000001";
const evidenceHash = "a".repeat(64);

function row(patch: Record<string, unknown> = {}) {
  return {
    rule_series_ref: "slice_rule.demo", rule_revision: 2,
    selection_id: selectionId, selection_evidence_hash: evidenceHash, selected_at: "2026-08-14T10:00:00.000Z",
    binding_id: bindingId, action_proposal_unit_id: unitId, action_unit_id: unitId, bundle_id: bundleId,
    unit_ref: "action_unit_bbbbbbbbbbbbbbbbbbbb", proposed_at: "2026-08-14T10:01:00.000Z",
    decision_events: [{ command_kind: "approve", decided_at: "2026-08-14T10:02:00.000Z", reason_code: "human.confirmed",
      execution_authority: "none", execution_performed: false }], execution_attempt_count: 1, execution_safe_count: 1,
    ...patch,
  };
}

function database(rows: readonly unknown[]) {
  const dialect = new PgDialect(); const queries: ReturnType<PgDialect["sqlToQuery"]>[] = [];
  return { queries, db: { execute: vi.fn(async (query: Parameters<PgDialect["sqlToQuery"]>[0]) => {
    queries.push(dialect.sqlToQuery(query)); return { rows };
  }) } };
}

describe("Slice Rule decision trace Drizzle reader", () => {
  it("projects only an opaque, closed execution trace from canonical tenant-bound bindings", async () => {
    const fixture = database([row()]);
    const result = await new DrizzleSliceRuleDecisionTraceReadRepository(fixture.db as never).list(workspaceId);
    expect(result).toEqual([{
      ruleSeriesRef: "slice_rule.demo", ruleRevision: 2,
      selectionRef: `selection_${evidenceHash}`, selectedAt: "2026-08-14T10:00:00.000Z",
      actionUnit: { presence: true, status: "approved" },
      decisionHistory: [{ decision: "proposed", occurredAt: "2026-08-14T10:01:00.000Z", reasonCode: null },
        { decision: "approved", occurredAt: "2026-08-14T10:02:00.000Z", reasonCode: "human.confirmed" }],
      execution: { safetyState: "server_disabled", closure: "admission_closed" },
    }]);
    const serialized = JSON.stringify(result);
    for (const value of [workspaceId, selectionId, bindingId, unitId, bundleId, "action_unit_bbbbbbbbbbbbbbbbbbbb"]) expect(serialized).not.toContain(value);
    expect(fixture.queries[0]?.sql).toContain("binding.workspace_id = selection.workspace_id and binding.selection_id = selection.id");
    expect(fixture.queries[0]?.sql).toContain("draft.workspace_id = selection.workspace_id and draft.draft_hash = selection.draft_hash");
    expect(fixture.queries[0]?.sql).toContain("attempt.admission_payload #>> '{capabilities,canWriteMeta}' = 'false'");
    expect(fixture.queries[0]?.params).toEqual([workspaceId]);
  });

  it("omits tenant-local rows with drift, opened execution evidence, or an impossible unbound admission", async () => {
    const fixture = database([
      row({ action_proposal_unit_id: "50000000-0000-4000-8000-000000000001" }),
      row({ selection_id: "60000000-0000-4000-8000-000000000001", selection_evidence_hash: "b".repeat(64), execution_attempt_count: 1, execution_safe_count: 0 }),
      row({ selection_id: "70000000-0000-4000-8000-000000000001", selection_evidence_hash: "c".repeat(64), binding_id: null, action_proposal_unit_id: null, action_unit_id: null, bundle_id: null, unit_ref: null, proposed_at: null, decision_events: [], execution_attempt_count: 1, execution_safe_count: 1 }),
    ]);
    await expect(new DrizzleSliceRuleDecisionTraceReadRepository(fixture.db as never).list(workspaceId)).resolves.toEqual([]);
  });

  it("omits duplicate selection rows rather than choosing an ambiguous trace", async () => {
    const fixture = database([row(), row({ decision_events: [] })]);
    await expect(new DrizzleSliceRuleDecisionTraceReadRepository(fixture.db as never).list(workspaceId)).resolves.toEqual([]);
  });
});
