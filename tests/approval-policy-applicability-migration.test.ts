import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("approval policy applicability forward migration", () => {
  it("permits only the explicitly reviewed K4/K2/K3 action-risk pairs", () => {
    const migration = readFileSync(resolve(process.cwd(), "drizzle/20260813172604_yellow_puck.sql"), "utf8");
    expect(migration).toContain('DROP CONSTRAINT "approval_policy_definition_revisions_applicability"');
    expect(migration).toContain("'existing_post_promotion'");
    expect(migration).toContain("'budget_decrease'");
    expect(migration).toContain("'budget_increase'");
    expect(migration).toContain("'K4'");
    expect(migration).toContain("'K2'");
    expect(migration).toContain("'K3'");
    expect(migration).not.toContain("action_type in");
  });
});
