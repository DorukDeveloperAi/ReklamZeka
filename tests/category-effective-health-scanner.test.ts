import { describe, expect, it } from "vitest";
import {
  EFFECTIVE_CATEGORY_HEALTH_SCAN_LIMITS,
  EffectiveCategoryHealthScanError,
  scanPortfolioEffectiveCategoryHealth,
} from "@/application/category-effective-health-scanner";
import type {
  CategoryAssignment,
  CategoryDefinition,
  CategoryDimension,
  CategoryEntityPath,
} from "@/domain/categories/registry";

const workspaceId = "workspace-private";

function dimension(cardinality: "single" | "multi" = "single"): CategoryDimension {
  return {
    id: "dimension-private-id",
    workspaceId,
    key: "internal_campaign_type",
    version: 1,
    cardinality,
    allowedEntityLevels: ["campaign", "ad_set", "ad", "creative"],
    archivedAt: null,
  };
}

const definitions: readonly CategoryDefinition[] = [
  { id: "definition-brand-private", workspaceId, dimensionId: "dimension-private-id", key: "brand",
    label: "Brand", version: 1, archivedAt: null },
  { id: "definition-growth-private", workspaceId, dimensionId: "dimension-private-id", key: "growth",
    label: "Growth", version: 1, archivedAt: null },
];

function assignment(
  id: string,
  definitionId: string,
  level: CategoryAssignment["entity"]["level"],
  entityId: string,
  operation: CategoryAssignment["operation"],
): CategoryAssignment {
  return { id, workspaceId, dimensionId: "dimension-private-id", definitionId,
    entity: { level, id: entityId }, operation, source: "manual", manualLock: false,
    evidence: [{ kind: "owner_instruction", ref: `private:${id}` }],
    confidence: 1, version: 1, archivedAt: null };
}

function path(campaignId: string, creativeId = "creative-reused-private"): CategoryEntityPath {
  return { workspaceId, nodes: [
    { level: "campaign", id: campaignId },
    { level: "ad_set", id: `ad-set-${campaignId}` },
    { level: "ad", id: `ad-${campaignId}` },
    { level: "creative", id: creativeId },
  ] };
}

function reasonCount(result: ReturnType<typeof scanPortfolioEffectiveCategoryHealth>, reason: string): number {
  return result.reasonBreakdown.find((entry) => entry.reason === reason)?.count ?? -1;
}

describe("portfolio effective category health scanner", () => {
  it("aggregates parent-child conflicts and explicit overrides with consistent totals", () => {
    const conflictPath = path("campaign-conflict");
    const overridePath = path("campaign-override", "creative-other-private");
    const result = scanPortfolioEffectiveCategoryHealth({
      dimensions: [dimension()], definitions,
      assignments: [
        assignment("a-parent-conflict", "definition-brand-private", "campaign", "campaign-conflict", "add"),
        assignment("a-child-conflict", "definition-growth-private", "ad_set", "ad-set-campaign-conflict", "add"),
        assignment("a-parent-override", "definition-brand-private", "campaign", "campaign-override", "add"),
        assignment("a-child-override", "definition-growth-private", "ad_set", "ad-set-campaign-override", "override"),
      ],
      hierarchyPaths: [conflictPath, overridePath],
    });

    expect(result.counts).toEqual({ dimensions: 1, hierarchyPaths: 2, evaluations: 2,
      applied: 1, unmatched: 0, parkedConflict: 1 });
    expect(result.dimensions[0]?.counts).toEqual({ total: 2, applied: 1, unmatched: 0, parkedConflict: 1 });
    expect(reasonCount(result, "single_child_add_requires_override")).toBe(1);
    expect(reasonCount(result, "effective_definition")).toBe(1);
  });

  it("allows multi inheritance", () => {
    const result = scanPortfolioEffectiveCategoryHealth({
      dimensions: [dimension("multi")], definitions,
      assignments: [
        assignment("a-parent", "definition-brand-private", "campaign", "campaign-multi", "add"),
        assignment("a-child", "definition-growth-private", "ad_set", "ad-set-campaign-multi", "add"),
      ],
      hierarchyPaths: [path("campaign-multi")],
    });
    expect(result.dimensions[0]?.counts).toEqual({ total: 1, applied: 1, unmatched: 0, parkedConflict: 0 });
  });

  it("evaluates a reused creative once per hierarchy path without exposing private IDs", () => {
    const reusedCreative = "creative-reused-private";
    const result = scanPortfolioEffectiveCategoryHealth({
      dimensions: [dimension()], definitions,
      assignments: [
        assignment("a-first", "definition-brand-private", "campaign", "campaign-first", "add"),
        assignment("a-second", "definition-growth-private", "campaign", "campaign-second", "add"),
      ],
      hierarchyPaths: [path("campaign-first", reusedCreative), path("campaign-second", reusedCreative)],
    });

    expect(result.evaluationBasis).toBe("hierarchy_path");
    expect(result.counts).toMatchObject({ hierarchyPaths: 2, evaluations: 2, applied: 2 });
    expect(result.dimensions[0]).toMatchObject({
      dimension: { key: "internal_campaign_type" }, evaluationBasis: "hierarchy_path",
      counts: { total: 2, applied: 2 },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(reusedCreative);
    expect(serialized).not.toContain("campaign-first");
    expect(serialized).not.toContain("dimension-private-id");
  });

  it("fails closed before scanning when a hard capacity is exceeded", () => {
    const tooManyPaths = Array.from(
      { length: EFFECTIVE_CATEGORY_HEALTH_SCAN_LIMITS.maxHierarchyPaths + 1 },
      () => path("campaign-cap"),
    );
    expect(() => scanPortfolioEffectiveCategoryHealth({
      dimensions: [dimension()], definitions, assignments: [], hierarchyPaths: tooManyPaths,
    })).toThrowError(expect.objectContaining<Partial<EffectiveCategoryHealthScanError>>({
      code: "capacity_exceeded", limit: "hierarchy_paths",
    }));

    const tooManyDimensions = Array.from(
      { length: EFFECTIVE_CATEGORY_HEALTH_SCAN_LIMITS.maxDimensions + 1 },
      (_, index) => ({ ...dimension(), id: `dimension-${index}`, key: `dimension_${index}` }),
    );
    expect(() => scanPortfolioEffectiveCategoryHealth({
      dimensions: tooManyDimensions, definitions: [], assignments: [], hierarchyPaths: [],
    })).toThrowError(expect.objectContaining<Partial<EffectiveCategoryHealthScanError>>({
      code: "capacity_exceeded", limit: "dimensions",
    }));
  });
});
