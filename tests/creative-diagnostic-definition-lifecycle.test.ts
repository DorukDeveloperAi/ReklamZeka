import { describe, expect, it } from "vitest";
import { createCreativeDiagnosticDefinition } from "@/analyses/creative-diagnostic-definition";
import { CreativeDiagnosticDefinitionLifecycleError, advanceCreativeDiagnosticDefinition } from "@/analyses/creative-diagnostic-definition-lifecycle";
const base = { definitionRef: `creative_definition_${"a".repeat(24)}`, revision: 1, previousHash: null, state: "draft" as const, minimumImpressions: 1000, minimumFrequencyIncreaseFraction: .2, minimumCtrDeclineFraction: .2, maximumCoverageGapDays: 0 };
describe("creative diagnostic definition lifecycle", () => {
  it("only advances contiguous immutable revisions", () => { const first=createCreativeDiagnosticDefinition(base); expect(advanceCreativeDiagnosticDefinition({previous:first,next:{...base,revision:2,previousHash:first.definitionHash,state:"published"}}).revision).toBe(2); });
  it("rejects stale, regressive and retired transitions", () => { const first=createCreativeDiagnosticDefinition({...base,state:"published"}); expect(()=>advanceCreativeDiagnosticDefinition({previous:first,next:{...base,revision:2,previousHash:null,state:"published"}})).toThrow(CreativeDiagnosticDefinitionLifecycleError); expect(()=>advanceCreativeDiagnosticDefinition({previous:first,next:{...base,revision:2,previousHash:first.definitionHash,state:"draft"}})).toThrow(CreativeDiagnosticDefinitionLifecycleError); });
});
