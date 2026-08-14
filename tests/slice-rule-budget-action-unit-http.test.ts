import { describe, expect, it, vi } from "vitest";

import { createSliceRuleBudgetActionUnitHttpHandlers, selectionRef } from "@/server/slice-rule-budget-action-unit-http";

const principal = Object.freeze({ actor: { userId: "22222222-2222-4222-8222-222222222222" }, workspaceId: "11111111-1111-4111-8111-111111111111", workspaceRef: "workspace_primary", readerRef: "reader_primary" });
const evidenceHash = "a".repeat(64);
function request(method: "GET" | "POST", body?: unknown, intent = method === "GET" ? "slice-rule-budget-action-unit-read" : "slice-rule-budget-action-unit-materialize") {
  return new Request("https://local.test/api/slice-rule-budget-action-units", { method, headers: { cookie: "rz=local", "sec-fetch-site": "same-origin", "x-reklamzeka-intent": intent, ...(method === "POST" ? { origin: "https://local.test", "content-type": "application/json" } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
function reader(rows: unknown[], traceRows: unknown[] = []) { return {
  select: vi.fn(() => ({ from: () => ({ where: () => ({ limit: async () => rows }) }) })),
  execute: vi.fn(async () => ({ rows: traceRows })),
}; }

describe("Slice Rule budget ActionUnit HTTP boundary", () => {
  it("projects selected scenarios through a public evidence-hash reference, never the internal UUID", async () => {
    const database = reader([{ id: "33333333-3333-4333-8333-333333333333", selectionEvidenceHash: evidenceHash, selectedAt: new Date("2026-08-13T12:00:00.000Z") }], [{
      selection_id: "33333333-3333-4333-8333-333333333333", selection_evidence_hash: evidenceHash, selected_at: "2026-08-13T12:00:00.000Z",
      binding_id: null, action_proposal_unit_id: null, action_unit_id: null, bundle_id: null, unit_ref: null, proposed_at: null,
      decision_events: [], execution_attempt_count: 0, execution_safe_count: 0,
    }]);
    const handlers = createSliceRuleBudgetActionUnitHttpHandlers({ database: database as never, resolvePrincipal: async () => principal });
    const response = await handlers.GET(request("GET"));
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.selections).toEqual([{ selectionRef: selectionRef(evidenceHash), selectedAt: "2026-08-13T12:00:00.000Z" }]);
    expect(payload.decisionTrace).toEqual({ contractVersion: "slice-rule-decision-trace/1.0.0", items: [{
      selectionRef: selectionRef(evidenceHash), selectedAt: "2026-08-13T12:00:00.000Z",
      actionUnit: { presence: false, status: "not_materialized" }, decisionHistory: [],
      execution: { safetyState: "server_disabled", closure: "not_admitted" },
    }] });
    expect(payload.actionPreparation).toEqual({ visible: true, enabled: false, reason: "server_disabled" });
    expect(JSON.stringify(payload)).not.toContain("33333333-3333-4333-8333-333333333333");
    expect(response.headers.get("X-ReklamZeka-Meta-Write")).toBe("disabled");
  });

  it("rejects injected budget, entity, policy and caller identity before any lookup", async () => {
    const database = reader([]); const resolvePrincipal = vi.fn(async () => principal);
    const handlers = createSliceRuleBudgetActionUnitHttpHandlers({ database: database as never, resolvePrincipal });
    const response = await handlers.POST(request("POST", { command: { selectionRef: selectionRef(evidenceHash), idempotencyKey: "approval_test", proposedAt: "2026-08-13T12:00:00.000Z", expiresAt: "2026-08-14T12:00:00.000Z", beforeAmountMinor: 1 } }));
    expect(response.status).toBe(400); expect(database.select).not.toHaveBeenCalled();
  });
});
