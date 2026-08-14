import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("drizzle/20260811163124_simple_northstar.sql", "utf8");

describe("frozen diagnostic cohort profile migration", () => {
  it("adds a forward-only nullable compatibility hash and its exact lookup index", () => {
    expect(migration).toContain('ADD COLUMN "category_cohort_profile_hash" text');
    expect(migration).not.toContain('ADD COLUMN "category_cohort_profile_hash" text NOT NULL');
    expect(migration).toContain('CREATE INDEX "frozen_diagnostic_evidence_cohort_profile_idx"');
    expect(migration).toContain('"category_cohort_profile_hash" is null');
    expect(migration).toContain("^[a-f0-9]{64}$");
    expect(migration).not.toMatch(/\bUPDATE\s+"?frozen_diagnostic_evidence"?/i);
  });
});
