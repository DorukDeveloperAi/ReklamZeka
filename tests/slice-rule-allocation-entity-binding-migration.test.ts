import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const path = "drizzle/20260813165721_remarkable_roulette.sql";
const migration = readFileSync(path, "utf8");

describe("slice rule allocation entity binding migration", () => {
  it("binds each exact draft allocation to one server-resolved canonical hierarchy", () => {
    expect(migration).toContain('CREATE TABLE "slice_rule_allocation_entity_bindings"');
    for (const column of [
      '"draft_hash" text NOT NULL', '"allocation_ref" text NOT NULL',
      '"ad_account_id" uuid NOT NULL', '"campaign_id" uuid NOT NULL', '"ad_set_id" uuid NOT NULL',
      '"budget_owner_level" text NOT NULL', '"budget_owner_entity_id" uuid NOT NULL',
      '"budget_kind" text NOT NULL', '"currency" text NOT NULL', '"current_amount_minor" bigint NOT NULL',
    ]) expect(migration).toContain(column);
    expect(migration).toContain('"slice_rule_allocation_entity_bindings_draft_scope_fk"');
    expect(migration).toContain('"slice_rule_allocation_entity_bindings_canonical_hierarchy_fk"');
    expect(migration).toContain('REFERENCES "public"."meta_ad_sets"("workspace_id","id","campaign_id","ad_account_id")');
    expect(migration).toContain('slice_rule_allocation_entity_bindings_exact_unique');
    expect(migration).toContain("budget_owner_level\" in ('campaign', 'ad_set')");
  });

  it("freezes budget and source evidence while denying every action authority", () => {
    for (const field of ["source_evidence_hash", "source_observed_at", "source_evidence", "rawPayloadHash", "sourceGraphVersion", "fieldCatalogVersion"]) {
      expect(migration).toContain(field);
    }
    expect(migration).toContain("'slice-rule-allocation-entity-binding/1.0.0'");
    expect(migration).toContain('"recommendationOnly":true,"canPublish":false,"canApprove":false,"canExecute":false,"canWriteMeta":false,"canEnableAutomation":false');
    expect(migration).not.toMatch(/action_(proposal|execution|approval)/i);
    expect(migration).not.toMatch(/strict_instruction_policy/i);
  });

  it("is private and append-only until its workspace tombstones", () => {
    expect(migration).toContain('ALTER TABLE "slice_rule_allocation_entity_bindings" ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('ALTER TABLE "slice_rule_allocation_entity_bindings" FORCE ROW LEVEL SECURITY');
    expect(migration).toContain('REVOKE ALL PRIVILEGES ON TABLE "slice_rule_allocation_entity_bindings" FROM PUBLIC, anon, authenticated, service_role');
    expect(migration).toContain('slice_rule_allocation_entity_binding_append_only_guard');
    expect(migration).toContain("lifecycle_state = 'tombstoning'");
  });

  it("is journaled with its generated snapshot", () => {
    const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: { tag: string }[] };
    expect(journal.entries.some((entry) => entry.tag === "20260813165721_remarkable_roulette")).toBe(true);
    expect(existsSync("drizzle/meta/20260813165721_snapshot.json")).toBe(true);
  });
});
