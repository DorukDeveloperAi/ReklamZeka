import { describe, expect, it } from "vitest";
import { CategoryEffectiveHealthService } from "@/application/category-effective-health-service";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const principal = { actor: { userId }, workspaceId, workspaceRef: "workspace_test", readerRef: "reader_test" } as const;

describe("CategoryEffectiveHealthService", () => {
  it("authorizes a registry reader and returns aggregate-only authority-free health", async () => {
    const service = new CategoryEffectiveHealthService({ load: async () => ({
      dimensions: [{ id: "private-dimension", workspaceId, key: "campaign_type", version: 1,
        cardinality: "single", allowedEntityLevels: ["campaign"], archivedAt: null }],
      definitions: [], assignments: [], hierarchyPaths: [{ workspaceId,
        nodes: [{ level: "campaign", id: "private-campaign" }] }],
    }) }, [{ workspaceId, userId, role: "viewer" }]);
    const result = await service.inspect(principal);
    expect(result).toMatchObject({ contractVersion: "category-effective-health/1.0.0", status: "complete",
      evaluationBasis: "hierarchy_path", counts: { dimensions: 1, hierarchyPaths: 1, evaluations: 1,
        unmatched: 1, parkedConflict: 0 }, authority: { canAssign: false, canWriteMeta: false } });
    expect(JSON.stringify(result)).not.toContain("private-campaign");
    expect(JSON.stringify(result)).not.toContain("private-dimension");
  });
});
