import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("slice rule scenario selection boundaries", () => {
  it("re-resolves frozen domestic/international scope and delivery holds inside the append transaction", () => {
    const source = readFileSync("src/connectors/campaigns/unified-action-preparation-gate.ts", "utf8");
    expect(source).toContain("FrozenContextBudgetImpactScopeResolver");
    expect(source).toContain("resolved.scope.market !== draft.draftPayload.scope.market");
    expect(source).toContain("delivery_health_alert_ledger_records");
    const selection = readFileSync("src/connectors/campaigns/slice-rule-scenario-allocation-selection-drizzle-repository.ts", "utf8");
    expect(selection).toContain("pg_advisory_xact_lock");
    expect(selection.indexOf("await assertAdmission(tx, input, source)")).toBeLessThan(selection.indexOf("const replay ="));
  });
  it("keeps selection outside agent, ActionUnit, approval, executor, and Meta write authority", () => {
    const repository = readFileSync("src/connectors/campaigns/slice-rule-scenario-allocation-selection-drizzle-repository.ts", "utf8");
    const http = readFileSync("src/server/slice-rule-scenario-selection-http.ts", "utf8");
    const agent = readFileSync("src/application/guidance-agent-contract.ts", "utf8");
    expect(repository).not.toContain("fetch(");
    expect(repository).not.toContain("actionProposalUnits");
    expect(repository).not.toContain("approvalDecision");
    expect(http).toContain('"X-ReklamZeka-Meta-Write": "disabled"');
    expect(http).toContain('"X-ReklamZeka-Action-Authority": "none"');
    expect(agent).not.toContain("slice-rule-scenario-select");
  });
  it("retains private append-only RLS selection storage", () => {
    const migration = readFileSync("drizzle/20260813173211_cooing_inertia.sql", "utf8");
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("FORCE ROW LEVEL SECURITY");
    expect(migration).toContain("REVOKE ALL PRIVILEGES ON TABLE \"slice_rule_scenario_allocation_selections\"");
  });
});
