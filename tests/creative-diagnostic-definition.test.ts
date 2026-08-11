import { describe, expect, it } from "vitest";
import { CreativeDiagnosticDefinitionError, createCreativeDiagnosticDefinition } from "@/analyses/creative-diagnostic-definition";
function input() { return { definitionRef: `creative_definition_${"a".repeat(24)}`, revision: 1, previousHash: null, state: "published" as const, minimumImpressions: 1_000, minimumFrequencyIncreaseFraction: 0.2, minimumCtrDeclineFraction: 0.15, maximumCoverageGapDays: 0 }; }
describe("creative diagnostic definition", () => {
  it("creates deterministic revision-hashed thresholds", () => { expect(createCreativeDiagnosticDefinition(input())).toEqual(createCreativeDiagnosticDefinition(input())); });
  it("rejects caller-shaped unknown fields and unsafe thresholds", () => {
    expect(() => createCreativeDiagnosticDefinition({ ...input(), minimumImpressions: 0 })).toThrow(CreativeDiagnosticDefinitionError);
    expect(() => createCreativeDiagnosticDefinition({ ...input(), maximumCoverageGapDays: 32 })).toThrow(CreativeDiagnosticDefinitionError);
    expect(() => createCreativeDiagnosticDefinition({ ...input(), extra: true } as never)).toThrow("exact shape");
  });
});
