import { describe, expect, it, vi } from "vitest";
import {
  BudgetPoolHierarchyService,
  createBudgetPoolHierarchyRevision,
  type BudgetPoolHierarchyRevisionPort,
} from "@/application/budget-pool-hierarchy-service";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const actorId = "00000000-0000-4000-8000-000000000002";
const at = "2026-08-13T00:00:00.000Z";
const until = "2026-09-13T00:00:00.000Z";
const input = {
  workspaceId, revision: 1, previousHierarchyHash: "GENESIS" as const, idempotencyKey: "initial-pools",
  nodes: [
    { poolRef: "budget_pool_domestic", parentPoolRef: null, layer: "market" as const, market: "domestic" as const, currency: "TRY", hardCapDecimal: "10", effectiveFrom: at, effectiveTo: until },
    { poolRef: "budget_pool_international", parentPoolRef: null, layer: "market" as const, market: "international" as const, currency: "TRY", hardCapDecimal: "10", effectiveFrom: at, effectiveTo: until },
  ],
};

describe("budget pool hierarchy revision service", () => {
  it("pins the complete hierarchy in a recommendation-only revision", async () => {
    const append = vi.fn(async () => ({ outcome: "inserted" as const, auditAppended: true }));
    const service = new BudgetPoolHierarchyService({ append } satisfies BudgetPoolHierarchyRevisionPort);
    const result = await service.save(actorId, input);
    expect(result.persistence).toBe("inserted");
    expect(result.revision.hierarchy.nodes).toHaveLength(2);
    expect(result.authority).toEqual({ recommendationOnly: true, canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false, canEnableAutomation: false });
    expect(append).toHaveBeenCalledWith(expect.objectContaining({ actorId }));
  });

  it("requires the exact prior hash after genesis", () => {
    expect(() => createBudgetPoolHierarchyRevision({ ...input, revision: 2, previousHierarchyHash: "GENESIS" })).toThrow();
  });
});
