import { describe, expect, it } from "vitest";
import { GuideBudgetDryRunService } from "@/application/guide-budget-dry-run-service";
import { createGuideBudgetContractV2, verifyGuideBudgetContractV2 } from "@/domain/guides/guide-budget-contract-v2";

const contract = () => createGuideBudgetContractV2({ guideRevisionHash: "a".repeat(64), market: "yerli", currency: "TRY", targetScopeRef: "organization_campaign_core", expression: { kind: "money", amountDecimal: "101", currency: "TRY" }, maximumEvidenceAgeSeconds: 60, overlapEnvelope:{restrictionsComplete:true,actionAllowlist:["budget_increase","budget_decrease"],unresolvedConflictRefs:[]} });
const row = (overrides: Record<string, unknown> = {}) => ({ scopeLayer: "organization_campaign" as const, scopeRef: "organization_campaign_core", market: "yerli" as const, currency: "TRY", budgetOwnerRef: "campaign_core", budgetOwnerKind: "campaign" as const, currentBudgetDecimal: "100", freshness: "fresh" as const, observedAt: "2026-08-17T00:00:00.000Z", evidenceHash: "b".repeat(64), ...overrides });

describe("guide budget contract v2", () => {
  it("v2 hash is explicit and v1 revisions are not implicitly upgraded", () => {
    expect(contract().schemaVersion).toBe("guide-budget-contract/2.0.0");
    expect(verifyGuideBudgetContractV2(contract())).toBe(true);
    expect(() => createGuideBudgetContractV2({ ...contract(), schemaVersion: "guide-budget-contract/1.0.0" } as never)).toThrow();
  });

  it("read-only service ages otherwise fresh evidence and cannot expose write authority", async () => {
    const service = new GuideBudgetDryRunService({ load: async () => ({ contract: contract(), targetCurrentBudgetDecimal: "100", scopeEvidence: [row()], constraints: [] }) });
    const result = await service.execute({ workspaceId: "11111111-1111-4111-8111-111111111111", guideRevisionId: "22222222-2222-4222-8222-222222222222", at: "2026-08-17T00:02:00.000Z" });
    expect(result).toMatchObject({ status: "held", authority: { writeOperations: 0, canWriteMeta: false, canExecute: false, canPersist: false } });
    expect(result.holdReasons).toContain("data_stale:organization_campaign_core");
  });
});
