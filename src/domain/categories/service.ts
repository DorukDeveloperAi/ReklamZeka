import type {
  CategoryAssignment,
  CategoryAssignmentEvidence,
  CategoryAssignmentOperation,
  CategoryAssignmentSource,
  CategoryCardinality,
  CategoryDefinition,
  CategoryDimension,
  CategoryEntityLevel,
  EffectiveCategoryResolution,
  FrozenCategoryContext,
} from "@/domain/categories/registry";

export type CategoryHierarchyTarget =
  | Readonly<{ level: "campaign"; id: string }>
  | Readonly<{ level: "ad_set"; id: string }>
  | Readonly<{ level: "ad"; id: string }>
  | Readonly<{ level: "creative"; id: string; viaAdId: string }>;

export type CategoryDimensionDraft = Readonly<{
  id: string;
  workspaceId: string;
  key: string;
  name: string;
  description?: string | null;
  cardinality: CategoryCardinality;
  allowedEntityLevels: readonly CategoryEntityLevel[];
}>;

export type CategoryDefinitionDraft = Readonly<{
  id: string;
  workspaceId: string;
  dimensionId: string;
  key: string;
  label: string;
  description?: string | null;
}>;

export type CategoryAssignmentDraft = Readonly<{
  id: string;
  workspaceId: string;
  dimensionId: string;
  definitionId: string;
  target: CategoryHierarchyTarget;
  operation: CategoryAssignmentOperation;
  source: CategoryAssignmentSource;
  manualLock: boolean;
  evidence: readonly CategoryAssignmentEvidence[];
  confidence: number;
}>;

export class CategoryRegistryPersistenceError extends Error {
  constructor(readonly code:
    | "not_found"
    | "conflict"
    | "scope_violation"
    | "invalid_hierarchy"
    | "manual_lock"
    | "invalid_input") {
    super(`Category registry persistence failed: ${code}`);
    this.name = "CategoryRegistryPersistenceError";
  }
}

export interface CategoryRegistryRepository {
  createDimension(draft: CategoryDimensionDraft): Promise<CategoryDimension>;
  findDimension(workspaceId: string, dimensionId: string, includeArchived?: boolean): Promise<CategoryDimension>;
  reviseDimension(input: Readonly<{
    workspaceId: string;
    dimensionId: string;
    expectedVersion: number;
    nextId: string;
    name: string;
    description?: string | null;
    cardinality: CategoryCardinality;
    allowedEntityLevels: readonly CategoryEntityLevel[];
  }>): Promise<CategoryDimension>;
  archiveDimension(workspaceId: string, dimensionId: string, expectedVersion: number): Promise<void>;
  createDefinition(draft: CategoryDefinitionDraft): Promise<CategoryDefinition>;
  listDefinitions(workspaceId: string, dimensionId: string, includeArchived?: boolean): Promise<readonly CategoryDefinition[]>;
  reviseDefinition(input: Readonly<{
    workspaceId: string;
    definitionId: string;
    expectedVersion: number;
    nextId: string;
    label: string;
    description?: string | null;
  }>): Promise<CategoryDefinition>;
  archiveDefinition(workspaceId: string, definitionId: string, expectedVersion: number): Promise<void>;
  createAssignment(draft: CategoryAssignmentDraft): Promise<CategoryAssignment>;
  listAssignments(workspaceId: string, dimensionId: string, includeArchived?: boolean): Promise<readonly CategoryAssignment[]>;
  reviseAssignment(input: Readonly<{
    workspaceId: string;
    assignmentId: string;
    expectedVersion: number;
    nextId: string;
    target: CategoryHierarchyTarget;
    operation: CategoryAssignmentOperation;
    source: CategoryAssignmentSource;
    manualLock: boolean;
    evidence: readonly CategoryAssignmentEvidence[];
    confidence: number;
  }>): Promise<CategoryAssignment>;
  archiveAssignment(input: Readonly<{
    workspaceId: string;
    assignmentId: string;
    expectedVersion: number;
  }>): Promise<void>;
  resolveCurrent(
    workspaceId: string,
    dimensionId: string,
    target: CategoryHierarchyTarget,
  ): Promise<EffectiveCategoryResolution>;
  replayFrozen(
    context: FrozenCategoryContext,
    target: CategoryHierarchyTarget,
  ): Promise<EffectiveCategoryResolution>;
}

/** Minimal application boundary; role authorization and durable audit arrive with the mutation API slice. */
export class CategoryRegistryService {
  constructor(private readonly repository: CategoryRegistryRepository) {}

  createDimension(draft: CategoryDimensionDraft) { return this.repository.createDimension(draft); }
  findDimension(workspaceId: string, dimensionId: string, includeArchived = false) {
    return this.repository.findDimension(workspaceId, dimensionId, includeArchived);
  }
  reviseDimension(input: Parameters<CategoryRegistryRepository["reviseDimension"]>[0]) {
    return this.repository.reviseDimension(input);
  }
  archiveDimension(workspaceId: string, dimensionId: string, expectedVersion: number) {
    return this.repository.archiveDimension(workspaceId, dimensionId, expectedVersion);
  }
  createDefinition(draft: CategoryDefinitionDraft) { return this.repository.createDefinition(draft); }
  listDefinitions(workspaceId: string, dimensionId: string, includeArchived = false) {
    return this.repository.listDefinitions(workspaceId, dimensionId, includeArchived);
  }
  reviseDefinition(input: Parameters<CategoryRegistryRepository["reviseDefinition"]>[0]) {
    return this.repository.reviseDefinition(input);
  }
  archiveDefinition(workspaceId: string, definitionId: string, expectedVersion: number) {
    return this.repository.archiveDefinition(workspaceId, definitionId, expectedVersion);
  }
  createAssignment(draft: CategoryAssignmentDraft) { return this.repository.createAssignment(draft); }
  listAssignments(workspaceId: string, dimensionId: string, includeArchived = false) {
    return this.repository.listAssignments(workspaceId, dimensionId, includeArchived);
  }
  reviseAssignment(input: Parameters<CategoryRegistryRepository["reviseAssignment"]>[0]) {
    return this.repository.reviseAssignment(input);
  }
  archiveAssignment(input: Parameters<CategoryRegistryRepository["archiveAssignment"]>[0]) {
    return this.repository.archiveAssignment(input);
  }
  resolveCurrent(workspaceId: string, dimensionId: string, target: CategoryHierarchyTarget) {
    return this.repository.resolveCurrent(workspaceId, dimensionId, target);
  }
  replayFrozen(context: FrozenCategoryContext, target: CategoryHierarchyTarget) {
    return this.repository.replayFrozen(context, target);
  }
}
