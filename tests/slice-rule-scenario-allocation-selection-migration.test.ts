import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const path = "drizzle/20260813173211_cooing_inertia.sql";
const migration = readFileSync(path, "utf8");

describe("slice rule scenario allocation selection migration", () => {
  it("records one exact planned allocation choice with bound draft/proposal sources", () => {
    expect(migration).toContain('CREATE TABLE "slice_rule_scenario_allocation_selections"');
    for (const column of ["draft_hash", "proposal_hash", "proposal_ref", "scenario_ref", "allocation_ref", "before_amount_minor", "after_amount_minor"]) {
      expect(migration).toContain(`"${column}"`);
    }
    expect(migration).toContain('slice_rule_scenario_allocation_selections_draft_scope_fk');
    expect(migration).toContain('slice_rule_scenario_allocation_selections_proposal_scope_fk');
    expect(migration).toContain('slice_rule_scenario_allocation_selections_allocation_binding_fk');
    expect(migration).toContain('slice_rule_scenario_allocation_selections_allocation_unique');
  });

  it("is private, append-only and cannot confer action authority", () => {
    expect(migration).toContain('ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('FORCE ROW LEVEL SECURITY');
    expect(migration).toContain('REVOKE ALL PRIVILEGES ON TABLE "slice_rule_scenario_allocation_selections"');
    expect(migration).toContain('slice_rule_scenario_allocation_selection_append_only_guard');
    expect(migration).toContain("lifecycle_state = 'tombstoning'");
    expect(migration).toContain('"recommendationOnly":true,"canPublish":false,"canApprove":false,"canExecute":false,"canWriteMeta":false,"canEnableAutomation":false');
    expect(migration).not.toMatch(/action_(proposal|execution|approval)/i);
  });

  it("is journaled with its generated snapshot", () => {
    const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: { tag: string }[] };
    expect(journal.entries.some((entry) => entry.tag === "20260813173211_cooing_inertia")).toBe(true);
    expect(existsSync("drizzle/meta/20260813173211_snapshot.json")).toBe(true);
  });
});
