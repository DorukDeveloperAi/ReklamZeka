import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assessInstructionPolicyJsonbCatalog, INSTRUCTION_POLICY_JSONB_MANIFEST } from
  "@/domain/policies/instruction-policy-dependency-manifest";

describe("instruction policy dependency manifest", () => {
  it("classifies the strict contract, effective projection and opaque action payloads", () => {
    const byKey = new Map(INSTRUCTION_POLICY_JSONB_MANIFEST.map((entry) => [`${entry.table}.${entry.column}`, entry.policy]));
    expect(byKey.get("strict_instruction_policy_revisions.policy_payload")).toBe("policy_contract");
    expect(byKey.get("progressive_formalization_revisions.revision_payload")).toBe("policy_contract");
    expect(byKey.get("effective_campaign_contexts.context_payload")).toBe("policy_projection");
    expect(byKey.get("action_proposal_units.unit_payload")).toBe("opaque_policy_context");
    const source = readFileSync("src/db/schema.ts", "utf8"); let table = "";
    const actual: { table: string; column: string }[] = [];
    for (const line of source.split("\n")) {
      const tableMatch = line.match(/pgTable\("([^"]+)"/); if (tableMatch) table = tableMatch[1]!;
      for (const columnMatch of line.matchAll(/jsonb\("([^"]+)"/g)) {
        actual.push({ table, column: columnMatch[1]! });
      }
    }
    expect(assessInstructionPolicyJsonbCatalog(actual)).toEqual({
      unclassifiedColumns: 0, missingManifestColumns: 0,
    });
  });

  it("fails drift closed for unknown and missing JSONB columns", () => {
    const actual = INSTRUCTION_POLICY_JSONB_MANIFEST.slice(1).map(({ table, column }) => ({ table, column }));
    expect(assessInstructionPolicyJsonbCatalog([...actual, { table: "future_policy_assets", column: "payload" }]))
      .toEqual({ unclassifiedColumns: 1, missingManifestColumns: 1 });
  });
});
