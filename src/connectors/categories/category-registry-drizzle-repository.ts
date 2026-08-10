import { and, eq, inArray, isNull } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import {
  CategoryResolutionError,
  resolveEffectiveCategory,
  type CategoryAssignment,
  type CategoryDefinition,
  type CategoryDimension,
  type CategoryEntityPath,
  type EffectiveCategoryResolution,
  type FrozenCategoryContext,
} from "@/domain/categories/registry";
import {
  CategoryRegistryPersistenceError,
  type CategoryAssignmentDraft,
  type CategoryDefinitionDraft,
  type CategoryDimensionDraft,
  type CategoryHierarchyTarget,
  type CategoryRegistryRepository,
} from "@/domain/categories/service";

type Database = NodePgDatabase<typeof schema>;
type DimensionRow = typeof schema.categoryDimensions.$inferSelect;
type DefinitionRow = typeof schema.categoryDefinitions.$inferSelect;
type AssignmentRow = typeof schema.categoryAssignments.$inferSelect;

function iso(value: Date | null): string | null { return value?.toISOString() ?? null; }

function mapDimension(row: DimensionRow): CategoryDimension {
  return Object.freeze({
    id: row.id,
    workspaceId: row.workspaceId,
    key: row.key,
    version: row.version,
    cardinality: row.cardinality,
    allowedEntityLevels: Object.freeze([...row.allowedEntityLevels]),
    archivedAt: iso(row.archivedAt),
  });
}

function mapDefinition(row: DefinitionRow): CategoryDefinition {
  return Object.freeze({
    id: row.id,
    workspaceId: row.workspaceId,
    dimensionId: row.dimensionId,
    key: row.key,
    label: row.label,
    version: row.version,
    archivedAt: iso(row.archivedAt),
  });
}

function mapAssignment(row: AssignmentRow): CategoryAssignment {
  const id = row.entityLevel === "campaign" ? row.campaignId
    : row.entityLevel === "ad_set" ? row.adSetId
      : row.entityLevel === "ad" ? row.adId : row.creativeId;
  if (!id) throw new CategoryRegistryPersistenceError("invalid_hierarchy");
  return Object.freeze({
    id: row.id,
    workspaceId: row.workspaceId,
    dimensionId: row.dimensionId,
    definitionId: row.definitionId,
    entity: Object.freeze({ level: row.entityLevel, id }),
    operation: row.operation,
    source: row.source,
    manualLock: row.manualLock,
    evidence: Object.freeze(row.evidence.map((entry) => Object.freeze({ ...entry }))),
    confidence: row.confidence,
    version: row.version,
    archivedAt: iso(row.archivedAt),
  });
}

function targetEntity(target: CategoryHierarchyTarget) {
  return { level: target.level, id: target.id } as const;
}

function assignmentEntityColumns(target: CategoryHierarchyTarget) {
  return {
    entityLevel: target.level,
    campaignId: target.level === "campaign" ? target.id : null,
    adSetId: target.level === "ad_set" ? target.id : null,
    adId: target.level === "ad" ? target.id : null,
    creativeId: target.level === "creative" ? target.id : null,
  } as const;
}

function samePath(left: CategoryEntityPath, right: CategoryEntityPath): boolean {
  return left.workspaceId === right.workspaceId
    && left.nodes.length === right.nodes.length
    && left.nodes.every((node, index) => (
      node.level === right.nodes[index]?.level && node.id === right.nodes[index]?.id
    ));
}

function translateResolution(error: unknown): never {
  if (error instanceof CategoryResolutionError) {
    if (error.code === "parked_conflict") throw new CategoryRegistryPersistenceError("manual_lock");
    if (error.code === "scope_mismatch") throw new CategoryRegistryPersistenceError("scope_violation");
    if (error.code === "invalid_path" || error.code === "unsupported_level") {
      throw new CategoryRegistryPersistenceError("invalid_hierarchy");
    }
    throw new CategoryRegistryPersistenceError("invalid_input");
  }
  throw error;
}

/** Server-side, workspace-scoped persistence adapter for the internal category registry. */
export class DrizzleCategoryRegistryRepository implements CategoryRegistryRepository {
  constructor(private readonly database: Database) {}

  async createDimension(draft: CategoryDimensionDraft): Promise<CategoryDimension> {
    this.assertDraftIdentity(draft.workspaceId, draft.id);
    const rows = await this.database.insert(schema.categoryDimensions).values({
      id: draft.id, workspaceId: draft.workspaceId, key: draft.key.trim(), name: draft.name.trim(),
      description: draft.description?.trim() || null, cardinality: draft.cardinality,
      allowedEntityLevels: [...draft.allowedEntityLevels], version: 1,
    }).returning();
    if (!rows[0]) throw new CategoryRegistryPersistenceError("conflict");
    return mapDimension(rows[0]);
  }

  async findDimension(workspaceId: string, dimensionId: string, includeArchived = false) {
    const base = and(
      eq(schema.categoryDimensions.workspaceId, workspaceId),
      eq(schema.categoryDimensions.id, dimensionId),
    );
    const rows = await this.database.select().from(schema.categoryDimensions)
      .where(includeArchived ? base : and(base, isNull(schema.categoryDimensions.archivedAt))).limit(1);
    if (!rows[0]) throw new CategoryRegistryPersistenceError("not_found");
    return mapDimension(rows[0]);
  }

  async reviseDimension(input: Parameters<CategoryRegistryRepository["reviseDimension"]>[0]) {
    this.assertDraftIdentity(input.workspaceId, input.nextId);
    return this.database.transaction(async (tx) => {
      const current = await tx.select().from(schema.categoryDimensions).where(and(
        eq(schema.categoryDimensions.workspaceId, input.workspaceId),
        eq(schema.categoryDimensions.id, input.dimensionId),
        eq(schema.categoryDimensions.version, input.expectedVersion),
        isNull(schema.categoryDimensions.archivedAt),
      )).limit(1);
      if (!current[0]) throw new CategoryRegistryPersistenceError("conflict");
      const archived = await tx.update(schema.categoryDimensions).set({ archivedAt: new Date() }).where(and(
        eq(schema.categoryDimensions.workspaceId, input.workspaceId),
        eq(schema.categoryDimensions.id, input.dimensionId),
        eq(schema.categoryDimensions.version, input.expectedVersion),
        isNull(schema.categoryDimensions.archivedAt),
      )).returning({ id: schema.categoryDimensions.id });
      if (!archived[0]) throw new CategoryRegistryPersistenceError("conflict");
      const created = await tx.insert(schema.categoryDimensions).values({
        id: input.nextId, workspaceId: input.workspaceId, key: current[0].key,
        name: input.name.trim(), description: input.description?.trim() || null,
        cardinality: input.cardinality, allowedEntityLevels: [...input.allowedEntityLevels],
        version: input.expectedVersion + 1,
      }).returning();
      return mapDimension(created[0]!);
    });
  }

  async archiveDimension(workspaceId: string, dimensionId: string, expectedVersion: number): Promise<void> {
    const rows = await this.database.update(schema.categoryDimensions).set({ archivedAt: new Date() }).where(and(
      eq(schema.categoryDimensions.workspaceId, workspaceId), eq(schema.categoryDimensions.id, dimensionId),
      eq(schema.categoryDimensions.version, expectedVersion), isNull(schema.categoryDimensions.archivedAt),
    )).returning({ id: schema.categoryDimensions.id });
    if (!rows[0]) throw new CategoryRegistryPersistenceError("conflict");
  }

  async createDefinition(draft: CategoryDefinitionDraft): Promise<CategoryDefinition> {
    this.assertDraftIdentity(draft.workspaceId, draft.id);
    await this.requireActiveDimension(this.database, draft.workspaceId, draft.dimensionId);
    const rows = await this.database.insert(schema.categoryDefinitions).values({
      id: draft.id, workspaceId: draft.workspaceId, dimensionId: draft.dimensionId,
      key: draft.key.trim(), label: draft.label.trim(), description: draft.description?.trim() || null,
      version: 1,
    }).returning();
    if (!rows[0]) throw new CategoryRegistryPersistenceError("conflict");
    return mapDefinition(rows[0]);
  }

  async listDefinitions(workspaceId: string, dimensionId: string, includeArchived = false) {
    const base = and(
      eq(schema.categoryDefinitions.workspaceId, workspaceId),
      eq(schema.categoryDefinitions.dimensionId, dimensionId),
    );
    return (await this.database.select().from(schema.categoryDefinitions)
      .where(includeArchived ? base : and(base, isNull(schema.categoryDefinitions.archivedAt))))
      .map(mapDefinition);
  }

  async reviseDefinition(input: Parameters<CategoryRegistryRepository["reviseDefinition"]>[0]) {
    this.assertDraftIdentity(input.workspaceId, input.nextId);
    return this.database.transaction(async (tx) => {
      const current = await tx.select().from(schema.categoryDefinitions).where(and(
        eq(schema.categoryDefinitions.workspaceId, input.workspaceId),
        eq(schema.categoryDefinitions.id, input.definitionId),
        eq(schema.categoryDefinitions.version, input.expectedVersion),
        isNull(schema.categoryDefinitions.archivedAt),
      )).limit(1);
      if (!current[0]) throw new CategoryRegistryPersistenceError("conflict");
      const activeAssignments = await tx.select({ id: schema.categoryAssignments.id })
        .from(schema.categoryAssignments).where(and(
          eq(schema.categoryAssignments.workspaceId, input.workspaceId),
          eq(schema.categoryAssignments.definitionId, input.definitionId),
          isNull(schema.categoryAssignments.archivedAt),
        )).limit(1);
      if (activeAssignments[0]) throw new CategoryRegistryPersistenceError("conflict");
      const archived = await tx.update(schema.categoryDefinitions).set({ archivedAt: new Date() }).where(and(
        eq(schema.categoryDefinitions.workspaceId, input.workspaceId),
        eq(schema.categoryDefinitions.id, input.definitionId),
        eq(schema.categoryDefinitions.version, input.expectedVersion),
        isNull(schema.categoryDefinitions.archivedAt),
      )).returning({ id: schema.categoryDefinitions.id });
      if (!archived[0]) throw new CategoryRegistryPersistenceError("conflict");
      const created = await tx.insert(schema.categoryDefinitions).values({
        id: input.nextId, workspaceId: input.workspaceId, dimensionId: current[0].dimensionId,
        key: current[0].key, label: input.label.trim(), description: input.description?.trim() || null,
        version: input.expectedVersion + 1,
      }).returning();
      return mapDefinition(created[0]!);
    });
  }

  async archiveDefinition(workspaceId: string, definitionId: string, expectedVersion: number): Promise<void> {
    await this.database.transaction(async (tx) => {
      const activeAssignments = await tx.select({ id: schema.categoryAssignments.id })
        .from(schema.categoryAssignments).where(and(
          eq(schema.categoryAssignments.workspaceId, workspaceId),
          eq(schema.categoryAssignments.definitionId, definitionId),
          isNull(schema.categoryAssignments.archivedAt),
        )).limit(1);
      if (activeAssignments[0]) throw new CategoryRegistryPersistenceError("conflict");
      const rows = await tx.update(schema.categoryDefinitions).set({ archivedAt: new Date() }).where(and(
        eq(schema.categoryDefinitions.workspaceId, workspaceId), eq(schema.categoryDefinitions.id, definitionId),
        eq(schema.categoryDefinitions.version, expectedVersion), isNull(schema.categoryDefinitions.archivedAt),
      )).returning({ id: schema.categoryDefinitions.id });
      if (!rows[0]) throw new CategoryRegistryPersistenceError("conflict");
    });
  }

  async createAssignment(draft: CategoryAssignmentDraft): Promise<CategoryAssignment> {
    this.assertDraftIdentity(draft.workspaceId, draft.id);
    return this.database.transaction(async (tx) => {
      const path = await this.canonicalPath(tx as Database, draft.workspaceId, draft.target);
      const candidate: CategoryAssignment = Object.freeze({
        id: draft.id, workspaceId: draft.workspaceId, dimensionId: draft.dimensionId,
        definitionId: draft.definitionId, entity: targetEntity(draft.target), operation: draft.operation,
        source: draft.source, manualLock: draft.manualLock, evidence: draft.evidence,
        confidence: draft.confidence, version: 1, archivedAt: null,
      });
      await this.assertProspectiveResolution(tx as Database, draft.workspaceId, draft.dimensionId, path, candidate);
      const rows = await tx.insert(schema.categoryAssignments).values({
        id: draft.id, workspaceId: draft.workspaceId, dimensionId: draft.dimensionId,
        definitionId: draft.definitionId, ...assignmentEntityColumns(draft.target),
        operation: draft.operation, source: draft.source, manualLock: draft.manualLock,
        evidence: [...draft.evidence], confidence: draft.confidence, version: 1,
      }).returning();
      return mapAssignment(rows[0]!);
    });
  }

  async listAssignments(workspaceId: string, dimensionId: string, includeArchived = false) {
    const base = and(
      eq(schema.categoryAssignments.workspaceId, workspaceId),
      eq(schema.categoryAssignments.dimensionId, dimensionId),
    );
    return (await this.database.select().from(schema.categoryAssignments)
      .where(includeArchived ? base : and(base, isNull(schema.categoryAssignments.archivedAt))))
      .map(mapAssignment);
  }

  async reviseAssignment(input: Parameters<CategoryRegistryRepository["reviseAssignment"]>[0]) {
    this.assertDraftIdentity(input.workspaceId, input.nextId);
    return this.database.transaction(async (tx) => {
      const rows = await tx.select().from(schema.categoryAssignments).where(and(
        eq(schema.categoryAssignments.workspaceId, input.workspaceId),
        eq(schema.categoryAssignments.id, input.assignmentId),
        eq(schema.categoryAssignments.version, input.expectedVersion),
        isNull(schema.categoryAssignments.archivedAt),
      )).limit(1);
      if (!rows[0]) throw new CategoryRegistryPersistenceError("conflict");
      const current = mapAssignment(rows[0]);
      // Until the role-aware mutation API can provide an application-owned
      // authority capability, a caller cannot self-assert permission to edit a lock.
      if (current.manualLock) {
        throw new CategoryRegistryPersistenceError("manual_lock");
      }
      if (current.entity.level !== input.target.level || current.entity.id !== input.target.id) {
        throw new CategoryRegistryPersistenceError("invalid_hierarchy");
      }
      const path = await this.canonicalPath(tx as Database, input.workspaceId, input.target);
      const candidate: CategoryAssignment = Object.freeze({
        ...current, id: input.nextId, operation: input.operation, source: input.source,
        manualLock: input.manualLock, evidence: input.evidence, confidence: input.confidence,
        version: input.expectedVersion + 1, archivedAt: null,
      });
      await this.assertProspectiveResolution(
        tx as Database, input.workspaceId, current.dimensionId, path, candidate, current.id,
      );
      const archived = await tx.update(schema.categoryAssignments).set({ archivedAt: new Date() }).where(and(
        eq(schema.categoryAssignments.workspaceId, input.workspaceId),
        eq(schema.categoryAssignments.id, input.assignmentId),
        eq(schema.categoryAssignments.version, input.expectedVersion),
        isNull(schema.categoryAssignments.archivedAt),
      )).returning({ id: schema.categoryAssignments.id });
      if (!archived[0]) throw new CategoryRegistryPersistenceError("conflict");
      const created = await tx.insert(schema.categoryAssignments).values({
        id: input.nextId, workspaceId: input.workspaceId, dimensionId: current.dimensionId,
        definitionId: current.definitionId, ...assignmentEntityColumns(input.target),
        operation: input.operation, source: input.source, manualLock: input.manualLock,
        evidence: [...input.evidence], confidence: input.confidence,
        version: input.expectedVersion + 1, supersedesAssignmentId: current.id,
      }).returning();
      return mapAssignment(created[0]!);
    });
  }

  async unlockAssignment(input: Parameters<CategoryRegistryRepository["unlockAssignment"]>[0]) {
    this.assertDraftIdentity(input.workspaceId, input.nextId);
    return this.database.transaction(async (tx) => {
      const rows = await tx.select().from(schema.categoryAssignments).where(and(
        eq(schema.categoryAssignments.workspaceId, input.workspaceId),
        eq(schema.categoryAssignments.id, input.assignmentId),
        eq(schema.categoryAssignments.version, input.expectedVersion),
        isNull(schema.categoryAssignments.archivedAt),
      )).limit(1);
      const current = rows[0];
      if (!current) throw new CategoryRegistryPersistenceError("conflict");
      if (current.source !== "manual" || current.manualLock !== true) {
        throw new CategoryRegistryPersistenceError("manual_lock");
      }
      const archived = await tx.update(schema.categoryAssignments).set({ archivedAt: new Date() }).where(and(
        eq(schema.categoryAssignments.workspaceId, input.workspaceId),
        eq(schema.categoryAssignments.id, input.assignmentId),
        eq(schema.categoryAssignments.version, input.expectedVersion),
        isNull(schema.categoryAssignments.archivedAt),
      )).returning({ id: schema.categoryAssignments.id });
      if (!archived[0]) throw new CategoryRegistryPersistenceError("conflict");
      const created = await tx.insert(schema.categoryAssignments).values({
        id: input.nextId, workspaceId: input.workspaceId, dimensionId: current.dimensionId,
        definitionId: current.definitionId, entityLevel: current.entityLevel,
        campaignId: current.campaignId, adSetId: current.adSetId, adId: current.adId, creativeId: current.creativeId,
        operation: current.operation, source: "manual", manualLock: false, evidence: [...input.evidence],
        confidence: current.confidence, version: input.expectedVersion + 1, supersedesAssignmentId: current.id,
      }).returning();
      if (!created[0]) throw new CategoryRegistryPersistenceError("conflict");
      return mapAssignment(created[0]);
    });
  }

  async archiveAssignment(input: Parameters<CategoryRegistryRepository["archiveAssignment"]>[0]): Promise<void> {
    await this.database.transaction(async (tx) => {
      const current = await tx.select().from(schema.categoryAssignments).where(and(
        eq(schema.categoryAssignments.workspaceId, input.workspaceId),
        eq(schema.categoryAssignments.id, input.assignmentId),
        eq(schema.categoryAssignments.version, input.expectedVersion),
        isNull(schema.categoryAssignments.archivedAt),
      )).limit(1);
      if (!current[0]) throw new CategoryRegistryPersistenceError("conflict");
      if (current[0].manualLock) {
        throw new CategoryRegistryPersistenceError("manual_lock");
      }
      const archived = await tx.update(schema.categoryAssignments).set({ archivedAt: new Date() }).where(and(
        eq(schema.categoryAssignments.workspaceId, input.workspaceId),
        eq(schema.categoryAssignments.id, input.assignmentId),
        eq(schema.categoryAssignments.version, input.expectedVersion),
        isNull(schema.categoryAssignments.archivedAt),
      )).returning({ id: schema.categoryAssignments.id });
      if (!archived[0]) throw new CategoryRegistryPersistenceError("conflict");
    });
  }

  async resolveCurrent(workspaceId: string, dimensionId: string, target: CategoryHierarchyTarget) {
    const path = await this.canonicalPath(this.database, workspaceId, target);
    return this.resolveWith(this.database, workspaceId, dimensionId, path, "current");
  }

  /**
   * Private composition read primitive.  It intentionally resolves every
   * active dimension from one canonical hierarchy path; callers must not
   * independently reconstruct a path for each dimension.
   */
  async resolveAllCurrent(workspaceId: string, target: CategoryHierarchyTarget): Promise<readonly EffectiveCategoryResolution[]> {
    const path = await this.canonicalPath(this.database, workspaceId, target);
    const dimensions = (await this.database.select().from(schema.categoryDimensions).where(and(
      eq(schema.categoryDimensions.workspaceId, workspaceId), isNull(schema.categoryDimensions.archivedAt),
    ))).map(mapDimension).sort((left, right) => left.key.localeCompare(right.key) || left.id.localeCompare(right.id));
    if (dimensions.length === 0 || dimensions.length > 100) throw new CategoryRegistryPersistenceError("invalid_input");
    return Object.freeze(await Promise.all(dimensions.map((dimension) =>
      this.resolveWith(this.database, workspaceId, dimension.id, path, "current"))));
  }

  async replayFrozen(context: FrozenCategoryContext, target: CategoryHierarchyTarget) {
    const path = await this.canonicalPath(this.database, context.workspaceId, target);
    if (!samePath(path, { workspaceId: context.workspaceId, nodes: context.path })) {
      throw new CategoryRegistryPersistenceError("invalid_hierarchy");
    }
    const dimensions = await this.database.select().from(schema.categoryDimensions).where(and(
      eq(schema.categoryDimensions.workspaceId, context.workspaceId),
      eq(schema.categoryDimensions.id, context.dimension.id),
      eq(schema.categoryDimensions.version, context.dimension.version),
    )).limit(1);
    if (!dimensions[0]) throw new CategoryRegistryPersistenceError("not_found");
    const assignmentIds = context.evaluatedAssignments.map((entry) => entry.id);
    const assignmentRows = assignmentIds.length === 0 ? [] : await this.database.select()
      .from(schema.categoryAssignments).where(and(
        eq(schema.categoryAssignments.workspaceId, context.workspaceId),
        eq(schema.categoryAssignments.dimensionId, context.dimension.id),
        inArray(schema.categoryAssignments.id, assignmentIds),
      ));
    const assignments = assignmentRows.map(mapAssignment);
    if (assignments.length !== assignmentIds.length || assignments.some((assignment) => (
      context.evaluatedAssignments.find((entry) => entry.id === assignment.id)?.version !== assignment.version
    ))) throw new CategoryRegistryPersistenceError("conflict");
    const definitionIds = context.definitionVersions.map((entry) => entry.id);
    const definitionRows = definitionIds.length === 0 ? [] : await this.database.select()
      .from(schema.categoryDefinitions).where(and(
        eq(schema.categoryDefinitions.workspaceId, context.workspaceId),
        eq(schema.categoryDefinitions.dimensionId, context.dimension.id),
        inArray(schema.categoryDefinitions.id, definitionIds),
      ));
    const definitions = definitionRows.map(mapDefinition);
    if (definitions.length !== definitionIds.length || definitions.some((definition) => {
      const expected = context.definitionVersions.find((entry) => entry.id === definition.id);
      return expected?.version !== definition.version || expected.key !== definition.key;
    })) throw new CategoryRegistryPersistenceError("conflict");
    let result: EffectiveCategoryResolution;
    try {
      result = resolveEffectiveCategory({
        dimension: mapDimension(dimensions[0]), definitions, assignments, path, mode: "frozen_replay",
      });
    } catch (error) { translateResolution(error); }
    if (result!.frozenContext.resolutionHash !== context.resolutionHash) {
      throw new CategoryRegistryPersistenceError("conflict");
    }
    return result!;
  }

  private async requireActiveDimension(database: Database, workspaceId: string, dimensionId: string) {
    const rows = await database.select().from(schema.categoryDimensions).where(and(
      eq(schema.categoryDimensions.workspaceId, workspaceId), eq(schema.categoryDimensions.id, dimensionId),
      isNull(schema.categoryDimensions.archivedAt),
    )).limit(1);
    if (!rows[0]) throw new CategoryRegistryPersistenceError("not_found");
    return rows[0];
  }

  private async resolveWith(
    database: Database,
    workspaceId: string,
    dimensionId: string,
    path: CategoryEntityPath,
    mode: "current",
  ): Promise<EffectiveCategoryResolution> {
    const dimension = mapDimension(await this.requireActiveDimension(database, workspaceId, dimensionId));
    const definitions = (await database.select().from(schema.categoryDefinitions).where(and(
      eq(schema.categoryDefinitions.workspaceId, workspaceId),
      eq(schema.categoryDefinitions.dimensionId, dimensionId), isNull(schema.categoryDefinitions.archivedAt),
    ))).map(mapDefinition);
    const assignments = (await database.select().from(schema.categoryAssignments).where(and(
      eq(schema.categoryAssignments.workspaceId, workspaceId),
      eq(schema.categoryAssignments.dimensionId, dimensionId), isNull(schema.categoryAssignments.archivedAt),
    ))).map(mapAssignment);
    try { return resolveEffectiveCategory({ dimension, definitions, assignments, path, mode }); }
    catch (error) { translateResolution(error); }
  }

  private async assertProspectiveResolution(
    database: Database,
    workspaceId: string,
    dimensionId: string,
    path: CategoryEntityPath,
    candidate: CategoryAssignment,
    replacedAssignmentId?: string,
  ): Promise<void> {
    const dimension = mapDimension(await this.requireActiveDimension(database, workspaceId, dimensionId));
    const definitions = (await database.select().from(schema.categoryDefinitions).where(and(
      eq(schema.categoryDefinitions.workspaceId, workspaceId),
      eq(schema.categoryDefinitions.dimensionId, dimensionId), isNull(schema.categoryDefinitions.archivedAt),
    ))).map(mapDefinition);
    const assignments = (await database.select().from(schema.categoryAssignments).where(and(
      eq(schema.categoryAssignments.workspaceId, workspaceId),
      eq(schema.categoryAssignments.dimensionId, dimensionId), isNull(schema.categoryAssignments.archivedAt),
    ))).map(mapAssignment).filter((assignment) => assignment.id !== replacedAssignmentId);
    try { resolveEffectiveCategory({ dimension, definitions, assignments: [...assignments, candidate], path }); }
    catch (error) { translateResolution(error); }
  }

  private async canonicalPath(database: Database, workspaceId: string, target: CategoryHierarchyTarget): Promise<CategoryEntityPath> {
    const campaignById = async (id: string) => {
      const rows = await database.select({
        id: schema.adCampaigns.id, adAccountId: schema.adCampaigns.adAccountId,
      }).from(schema.adCampaigns).where(and(
        eq(schema.adCampaigns.workspaceId, workspaceId), eq(schema.adCampaigns.id, id),
      )).limit(1);
      if (!rows[0]) throw new CategoryRegistryPersistenceError("not_found");
      return rows[0];
    };
    if (target.level === "campaign") {
      await campaignById(target.id);
      return { workspaceId, nodes: [{ level: "campaign", id: target.id }] };
    }
    const adSetById = async (id: string) => {
      const rows = await database.select({
        id: schema.metaAdSets.id, campaignId: schema.metaAdSets.campaignId,
        adAccountId: schema.metaAdSets.adAccountId,
      }).from(schema.metaAdSets).where(and(
        eq(schema.metaAdSets.workspaceId, workspaceId), eq(schema.metaAdSets.id, id),
      )).limit(1);
      if (!rows[0]) throw new CategoryRegistryPersistenceError("not_found");
      const campaign = await campaignById(rows[0].campaignId);
      if (campaign.adAccountId !== rows[0].adAccountId) throw new CategoryRegistryPersistenceError("invalid_hierarchy");
      return { ...rows[0], campaign };
    };
    if (target.level === "ad_set") {
      const adSet = await adSetById(target.id);
      return { workspaceId, nodes: [
        { level: "campaign", id: adSet.campaignId }, { level: "ad_set", id: adSet.id },
      ] };
    }
    const adId = target.level === "creative" ? target.viaAdId : target.id;
    const ads = await database.select({
      id: schema.metaAds.id, campaignId: schema.metaAds.campaignId, adSetId: schema.metaAds.adSetId,
      creativeId: schema.metaAds.creativeId, adAccountId: schema.metaAds.adAccountId,
    }).from(schema.metaAds).where(and(
      eq(schema.metaAds.workspaceId, workspaceId), eq(schema.metaAds.id, adId),
    )).limit(1);
    if (!ads[0]) throw new CategoryRegistryPersistenceError("not_found");
    const adSet = await adSetById(ads[0].adSetId);
    if (ads[0].campaignId !== adSet.campaignId || ads[0].adAccountId !== adSet.adAccountId) {
      throw new CategoryRegistryPersistenceError("invalid_hierarchy");
    }
    const nodes: CategoryEntityPath["nodes"] = [
      { level: "campaign", id: ads[0].campaignId },
      { level: "ad_set", id: ads[0].adSetId },
      { level: "ad", id: ads[0].id },
    ];
    if (target.level === "ad") return { workspaceId, nodes };
    const creatives = await database.select({
      id: schema.metaCreatives.id, adAccountId: schema.metaCreatives.adAccountId,
    }).from(schema.metaCreatives).where(and(
      eq(schema.metaCreatives.workspaceId, workspaceId), eq(schema.metaCreatives.id, target.id),
    )).limit(1);
    if (!creatives[0] || ads[0].creativeId !== creatives[0].id || creatives[0].adAccountId !== ads[0].adAccountId) {
      throw new CategoryRegistryPersistenceError("invalid_hierarchy");
    }
    return { workspaceId, nodes: [...nodes, { level: "creative", id: creatives[0].id }] };
  }

  private assertDraftIdentity(workspaceId: string, id: string): void {
    if (!workspaceId.trim() || !id.trim()) throw new CategoryRegistryPersistenceError("invalid_input");
  }
}
