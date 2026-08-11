import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("creative window source revision migration", () => {
  it("preserves historical source revisions by making source hash part of the exact key", () => {
    const migration = readFileSync("drizzle/20260811171503_curious_mastermind.sql", "utf8");
    expect(migration).toContain('DROP INDEX "meta_creative_window_insight_snapshots_exact_unique"');
    expect(migration).toContain('"settlement_policy_hash","source_hash"');
  });
});
