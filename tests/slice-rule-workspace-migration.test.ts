import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const path = "drizzle/20260813123506_slice_rule_workspace_drafts.sql";
const migration = readFileSync(path, "utf8");

describe("Slice Rule Workspace migration", () => {
  it("persists a first-class exact market, service and family scope", () => {
    expect(migration).toContain('CREATE TABLE "slice_rule_workspace_drafts"');
    for (const column of ['"market" text NOT NULL', '"service_ref" text NOT NULL',
      '"campaign_family_ref" text NOT NULL', '"country_or_region" text',
      '"audience_strategy" text', '"platform" text']) expect(migration).toContain(column);
    expect(migration).toContain("market\" in ('domestic', 'international')");
    expect(migration).toContain("operating_mode\" = 'recommendation_only'");
  });

  it("binds actor membership and exact no-authority payload fields", () => {
    expect(migration).toContain("slice_rule_workspace_drafts_membership_scope_fk");
    for (const authority of ["canPublish", "canApprove", "canExecute", "canWriteMeta", "canEnableAutomation"]) {
      expect(migration).toContain(`\\"${authority}\\": false`.replaceAll("\\", ""));
    }
    expect(migration).toContain("{operatingRule,automationMode}' = 'recommendation_only'");
    expect(migration).not.toMatch(/REFERENCES\s+"public"\."strict_instruction_policy_revisions"/i);
    expect(migration).not.toMatch(/REFERENCES\s+"public"\."action_(proposal|execution)/i);
  });

  it("is server-private, RLS-forced and append-only except workspace tombstoning", () => {
    expect(migration).toContain('ALTER TABLE "slice_rule_workspace_drafts" ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('ALTER TABLE "slice_rule_workspace_drafts" FORCE ROW LEVEL SECURITY');
    expect(migration).toContain('REVOKE ALL PRIVILEGES ON TABLE "slice_rule_workspace_drafts" FROM PUBLIC, anon, authenticated, service_role');
    expect(migration).toContain("slice_rule_workspace_drafts_append_only");
    expect(migration).toContain("lifecycle_state = 'tombstoning'");
  });

  it("is journaled with its generated snapshot", () => {
    const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: { tag: string }[] };
    expect(journal.entries.some((entry) => entry.tag === "20260813123506_slice_rule_workspace_drafts")).toBe(true);
    expect(existsSync("drizzle/meta/20260813123506_snapshot.json")).toBe(true);
  });
});
