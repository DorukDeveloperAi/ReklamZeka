import { describe, expect, it, vi } from "vitest";
import { CategoryInventoryService, type CategoryInventoryRepository } from "@/application/category-inventory-service";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const principal = { actor: { userId }, workspaceId, workspaceRef: "workspace_test", readerRef: "reader_test" } as const;
const snapshot = { dimensions: [{ ref: "dimension_1234567890abcdef12345678", key: "campaign_type",
  name: "Kampanya türü", description: null, cardinality: "single" as const,
  allowedEntityLevels: ["campaign" as const], version: 1, definitions: [{
    ref: "category_1234567890abcdef12345678", key: "evergreen", label: "Evergreen",
    description: null, version: 1, assignments: { total: 2, manualLocked: 1, manual: 1,
      agent: 1, deterministic: 0, add: 2, override: 0, deny: 0 },
    confidence: { minimumBasisPoints: 6_500, averageBasisPoints: 8_250, belowReviewThreshold: 1 },
    evidenceHealth: { evidenceRecords: 3, assignmentsWithObservedAt: 1,
      invalidEvidenceAssignments: 0, kinds: [{ kind: "owner_instruction", count: 2 }] },
  }], coverage: [{ level: "campaign" as const, totalEntities: 5, directlyAssignedEntities: 2,
    unmatchedEntities: 3, coverageBasisPoints: 4_000, deniedAssignments: 0 }] }],
  health: { dimensionsWithoutDefinitions: 0, definitionsWithoutDirectAssignments: 0,
    staleTargetAssignments: 1, assignmentsUnderArchivedRegistry: 0 } } as const;

describe("CategoryInventoryService", () => {
  it("returns direct coverage and health with zero mutation authority", async () => {
    const repository: CategoryInventoryRepository = { list: vi.fn(async () => snapshot) };
    const result = await new CategoryInventoryService(repository, [{ userId, workspaceId, role: "viewer" }]).list(principal);
    expect(result).toMatchObject({ summary: { dimensions: 1, definitions: 1,
      directlyAssignedEntities: 2, manualLocks: 1, lowConfidenceAssignments: 1,
      invalidEvidenceAssignments: 0 }, classificationPolicy: {
      minimumTrustedConfidenceBasisPoints: 7_000, purpose: "review_signal_only" },
    health: { staleTargetAssignments: 1 },
    authority: { canAssign: false, canWriteMeta: false, canAuthorizeAction: false } });
    expect(repository.list).toHaveBeenCalledWith(workspaceId);
  });

  it("rejects a principal outside the workspace before repository access", async () => {
    const repository: CategoryInventoryRepository = { list: vi.fn() };
    await expect(new CategoryInventoryService(repository, []).list(principal))
      .rejects.toMatchObject({ name: "AuthorizationError" });
    expect(repository.list).not.toHaveBeenCalled();
  });
});
