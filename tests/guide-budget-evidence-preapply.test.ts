import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("Guide budget evidence pre-apply compatibility", () => {
  it("checks the optional ceiling relation before querying it and fails closed with no policies", () => {
    const source = readFileSync("src/connectors/guides/guide-budget-evidence-drizzle-repository.ts", "utf8");
    const probe = source.indexOf("to_regclass('public.budget_ceiling_policy_revisions')");
    const query = source.indexOf("select policy_payload from budget_ceiling_policy_revisions");
    expect(probe).toBeGreaterThan(0); expect(query).toBeGreaterThan(probe);
    expect(source).toContain(": [];"); expect(source).toContain("let ceilingDecimal: string | null = null");
  });
});
