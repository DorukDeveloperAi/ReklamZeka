import { categoryDimensionPublicRef } from "@/domain/categories/public-reference";
import {
  CATEGORY_INSPECTION_REASONS,
  inspectEffectiveCategory,
  type CategoryAssignment,
  type CategoryDefinition,
  type CategoryDimension,
  type CategoryEntityPath,
  type CategoryInspectionReason,
} from "@/domain/categories/registry";

export const EFFECTIVE_CATEGORY_HEALTH_SCAN_LIMITS = Object.freeze({
  maxHierarchyPaths: 20_000,
  maxDimensions: 100,
} as const);

export class EffectiveCategoryHealthScanError extends Error {
  constructor(
    readonly code: "capacity_exceeded",
    readonly limit: "hierarchy_paths" | "dimensions",
  ) {
    super(`effective_category_health_scan_${limit}_capacity_exceeded`);
    this.name = "EffectiveCategoryHealthScanError";
  }
}

export type EffectiveCategoryHealthCounts = Readonly<{
  total: number;
  applied: number;
  unmatched: number;
  parkedConflict: number;
}>;

export type EffectiveCategoryHealthReasonCount = Readonly<{
  reason: CategoryInspectionReason;
  count: number;
}>;

export type EffectiveCategoryHealthScanInput = Readonly<{
  dimensions: readonly CategoryDimension[];
  definitions: readonly CategoryDefinition[];
  assignments: readonly CategoryAssignment[];
  hierarchyPaths: readonly CategoryEntityPath[];
}>;

export type EffectiveCategoryHealthScan = Readonly<{
  status: "complete";
  evaluationBasis: "hierarchy_path";
  limits: typeof EFFECTIVE_CATEGORY_HEALTH_SCAN_LIMITS;
  counts: Readonly<{
    dimensions: number;
    hierarchyPaths: number;
    evaluations: number;
    applied: number;
    unmatched: number;
    parkedConflict: number;
  }>;
  reasonBreakdown: readonly EffectiveCategoryHealthReasonCount[];
  dimensions: readonly Readonly<{
    dimension: Readonly<{ key: string; ref: string }>;
    evaluationBasis: "hierarchy_path";
    counts: EffectiveCategoryHealthCounts;
    reasonBreakdown: readonly EffectiveCategoryHealthReasonCount[];
  }>[];
}>;

type MutableCounts = {
  total: number;
  applied: number;
  unmatched: number;
  parkedConflict: number;
};

function emptyCounts(): MutableCounts {
  return { total: 0, applied: 0, unmatched: 0, parkedConflict: 0 };
}

function emptyReasons(): Map<CategoryInspectionReason, number> {
  return new Map(CATEGORY_INSPECTION_REASONS.map((reason) => [reason, 0]));
}

function reasonBreakdown(counts: ReadonlyMap<CategoryInspectionReason, number>): readonly EffectiveCategoryHealthReasonCount[] {
  return Object.freeze(CATEGORY_INSPECTION_REASONS.map((reason) => Object.freeze({
    reason,
    count: counts.get(reason) ?? 0,
  })));
}

function nodeKey(level: CategoryAssignment["entity"]["level"], id: string): string {
  return `${level}:${id}`;
}

function increment(
  counts: MutableCounts,
  reasons: Map<CategoryInspectionReason, number>,
  state: "applied" | "unmatched" | "parked_conflict",
  reason: CategoryInspectionReason,
): void {
  counts.total += 1;
  if (state === "applied") counts.applied += 1;
  else if (state === "unmatched") counts.unmatched += 1;
  else counts.parkedConflict += 1;
  reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
}

/**
 * Scans effective category health without exposing private canonical entity or
 * registry identifiers. A reused creative is evaluated once per complete Meta
 * hierarchy path, because inherited category context can differ by parent.
 */
export function scanPortfolioEffectiveCategoryHealth(
  input: EffectiveCategoryHealthScanInput,
): EffectiveCategoryHealthScan {
  if (input.hierarchyPaths.length > EFFECTIVE_CATEGORY_HEALTH_SCAN_LIMITS.maxHierarchyPaths) {
    throw new EffectiveCategoryHealthScanError("capacity_exceeded", "hierarchy_paths");
  }
  if (input.dimensions.length > EFFECTIVE_CATEGORY_HEALTH_SCAN_LIMITS.maxDimensions) {
    throw new EffectiveCategoryHealthScanError("capacity_exceeded", "dimensions");
  }

  const definitionsByDimension = new Map<string, CategoryDefinition[]>();
  for (const definition of input.definitions) {
    const definitions = definitionsByDimension.get(definition.dimensionId) ?? [];
    definitions.push(definition);
    definitionsByDimension.set(definition.dimensionId, definitions);
  }

  const assignmentsByDimensionAndNode = new Map<string, Map<string, CategoryAssignment[]>>();
  for (const assignment of input.assignments) {
    let byNode = assignmentsByDimensionAndNode.get(assignment.dimensionId);
    if (!byNode) {
      byNode = new Map();
      assignmentsByDimensionAndNode.set(assignment.dimensionId, byNode);
    }
    const key = nodeKey(assignment.entity.level, assignment.entity.id);
    const assignments = byNode.get(key) ?? [];
    assignments.push(assignment);
    byNode.set(key, assignments);
  }

  const aggregateCounts = emptyCounts();
  const aggregateReasons = emptyReasons();
  const dimensions = input.dimensions.map((dimension) => {
    const counts = emptyCounts();
    const reasons = emptyReasons();
    const byNode = assignmentsByDimensionAndNode.get(dimension.id);
    const definitions = definitionsByDimension.get(dimension.id) ?? [];

    for (const path of input.hierarchyPaths) {
      const pathAssignments: CategoryAssignment[] = [];
      if (byNode) {
        for (const node of path.nodes) {
          const assignments = byNode.get(nodeKey(node.level, node.id));
          if (assignments) pathAssignments.push(...assignments);
        }
      }
      const inspection = inspectEffectiveCategory({ dimension, definitions, assignments: pathAssignments, path });
      increment(counts, reasons, inspection.state, inspection.reason);
      increment(aggregateCounts, aggregateReasons, inspection.state, inspection.reason);
    }

    return Object.freeze({
      dimension: Object.freeze({ key: dimension.key, ref: categoryDimensionPublicRef(dimension.key) }),
      evaluationBasis: "hierarchy_path" as const,
      counts: Object.freeze(counts),
      reasonBreakdown: reasonBreakdown(reasons),
    });
  });

  return Object.freeze({
    status: "complete" as const,
    evaluationBasis: "hierarchy_path" as const,
    limits: EFFECTIVE_CATEGORY_HEALTH_SCAN_LIMITS,
    counts: Object.freeze({
      dimensions: input.dimensions.length,
      hierarchyPaths: input.hierarchyPaths.length,
      evaluations: aggregateCounts.total,
      applied: aggregateCounts.applied,
      unmatched: aggregateCounts.unmatched,
      parkedConflict: aggregateCounts.parkedConflict,
    }),
    reasonBreakdown: reasonBreakdown(aggregateReasons),
    dimensions: Object.freeze(dimensions),
  });
}
