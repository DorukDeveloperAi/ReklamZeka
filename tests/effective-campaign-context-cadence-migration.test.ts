import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("effective campaign context cadence component migration", () => {
  it("expands both exact component contracts forward-only while retaining private table guards", () => {
    const migration = readFileSync("drizzle/20260810173000_effective_context_cadence_component.sql", "utf8");
    expect(migration).toContain("'cadence_profile'");
    expect(migration).toContain("effective_campaign_context_components_type");
    expect(migration).toContain("effective_campaign_context_invalidations_type");
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("FORCE ROW LEVEL SECURITY");
    expect(migration).toContain("PUBLIC, anon, authenticated, service_role");
    expect(migration).not.toMatch(/DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM/);
  });
});
