import { describe, expect, it, vi } from "vitest";
import { CategoryArchiveImpactService, type CategoryArchiveImpactRepository } from "@/application/category-archive-impact-service";

const workspaceId = "11111111-1111-4111-8111-111111111111"; const userId = "22222222-2222-4222-8222-222222222222";
const principal = { actor: { userId }, workspaceId, workspaceRef: "workspace_test", readerRef: "reader_test" } as const;

describe("CategoryArchiveImpactService", () => {
  it("authorizes read separately and preserves zero archive authority", async () => {
    const impact = { target: { kind: "dimension", ref: "dimension_1234567890abcdef12345678", label: "Tür", version: 1 },
      exactBlockers: { activeDefinitions: 1, activeAssignments: 0, manualLocks: 0, guidanceDrafts: 0,
        guidancePublished: 0, activePromotionBindings: 0, autonomyDrafts: 0, autonomyPublished: 0,
        guardrailDrafts: 0, guardrailPublished: 0 }, historicalImpact: { archivedGuidance: 0,
        expiredPromotionBindings: 0, effectiveContexts: 0, alreadyInvalidatedContexts: 0, budgetProposals: 0 },
      invalidationPlan: { categoryResolutionComponents: 0, contextsNeedingInvalidation: 0 },
      coverage: { complete: false, exactRelational: [], exactContractRef: [], partialOrUnknown: ["unknown"] },
      disposition: "blocked", archiveAllowed: false, authority: { canArchive: false, canAssign: false,
        canAuthorizeAction: false, canWriteMeta: false } } as const;
    const repository: CategoryArchiveImpactRepository = { preview: vi.fn(async () => impact) };
    const result = await new CategoryArchiveImpactService(repository, [{ userId, workspaceId, role: "viewer" }])
      .preview(principal, impact.target.ref);
    expect(result).toMatchObject({ contractVersion: "category-archive-impact/1.0.0", archiveAllowed: false,
      authority: { canArchive: false, canWriteMeta: false } });
  });
});
