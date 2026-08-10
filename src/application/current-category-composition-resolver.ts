import { bindCategoryProfiles, type CategoryProfileRevision } from "@/domain/categories/category-profile";
import { DrizzleCategoryProfileRepository } from "@/connectors/categories/category-profile-drizzle-repository";
import { DrizzleCategoryRegistryRepository } from "@/connectors/categories/category-registry-drizzle-repository";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import * as schema from "@/db/schema";
import type { EffectiveCategoryResolution } from "@/domain/categories/registry";
import { categoryDefinitionPublicRef } from "@/domain/categories/public-reference";
import type { CategoryHierarchyTarget } from "@/domain/categories/service";

const MAX_ACTIVE_DIMENSIONS = 100;
const MAX_EFFECTIVE_DEFINITIONS = 500;

export class CurrentCategoryCompositionError extends Error {
  constructor(readonly code: "invalid_input" | "incomplete_context" | "ambiguous_profile" | "stale_profile" | "parked_conflict" | "capacity_exceeded") {
    super(`current_category_composition_${code}`);
    this.name = "CurrentCategoryCompositionError";
  }
}

export type CurrentCategoryProfileBinding = Readonly<{
  categoryDefinitionId: string;
  profile: CategoryProfileRevision;
}>;

/** Read-only port; implementations may only return tenant-bound current data. */
export type CurrentCategoryCompositionReader = Readonly<{
  resolveAllCurrent(workspaceId: string, target: CategoryHierarchyTarget): Promise<readonly EffectiveCategoryResolution[]>;
  currentActiveArtifacts(workspaceId: string, categoryDefinitionIds: readonly string[]): Promise<readonly CurrentCategoryProfileBinding[]>;
  withConsistentSnapshot<T>(work: (reader: CurrentCategoryCompositionReader) => Promise<T>): Promise<T>;
}>;

export type CurrentCategoryComposition = Readonly<{
  workspaceId: string;
  dimensions: readonly EffectiveCategoryResolution[];
}>;

function samePath(left: EffectiveCategoryResolution["frozenContext"]["path"], right: EffectiveCategoryResolution["frozenContext"]["path"]): boolean {
  return left.length === right.length && left.every((node, index) =>
    node.level === right[index]?.level && node.id === right[index]?.id);
}

/**
 * Resolves a complete current category set.  It has no policy, HTTP, UI, or
 * action authority. Any missing, stale, archived, ambiguous, or conflicting
 * component rejects the whole read rather than returning a partial context.
 */
export class CurrentCategoryCompositionResolver {
  constructor(private readonly reader: CurrentCategoryCompositionReader) {}

  async resolve(workspaceId: string, target: CategoryHierarchyTarget): Promise<CurrentCategoryComposition> {
    return this.reader.withConsistentSnapshot((reader) => new CurrentCategoryCompositionResolver(reader)
      .resolveWithoutSnapshot(workspaceId, target));
  }

  private async resolveWithoutSnapshot(workspaceId: string, target: CategoryHierarchyTarget): Promise<CurrentCategoryComposition> {
    if (!workspaceId.trim()) throw new CurrentCategoryCompositionError("invalid_input");
    let resolved: readonly EffectiveCategoryResolution[];
    try { resolved = await this.reader.resolveAllCurrent(workspaceId, target); }
    catch (error) {
      const code = error && typeof error === "object" && "code" in error ? (error as { code?: unknown }).code : null;
      if (code === "manual_lock" || code === "parked_conflict") throw new CurrentCategoryCompositionError("parked_conflict");
      throw new CurrentCategoryCompositionError("incomplete_context");
    }
    resolved = Object.freeze([...resolved].sort((left, right) =>
      left.frozenContext.dimension.key.localeCompare(right.frozenContext.dimension.key)
      || left.frozenContext.dimension.id.localeCompare(right.frozenContext.dimension.id)));
    if (resolved.length === 0) throw new CurrentCategoryCompositionError("incomplete_context");
    if (resolved.length > MAX_ACTIVE_DIMENSIONS) throw new CurrentCategoryCompositionError("capacity_exceeded");
    const firstPath = resolved[0]!.frozenContext.path;
    if (resolved.some((entry) => entry.frozenContext.workspaceId !== workspaceId
      || !samePath(entry.frozenContext.path, firstPath)
      || entry.values.length === 0)
      || new Set(resolved.map((entry) => entry.frozenContext.dimension.id)).size !== resolved.length
      || new Set(resolved.map((entry) => entry.frozenContext.dimension.key)).size !== resolved.length) {
      throw new CurrentCategoryCompositionError("incomplete_context");
    }
    const definitions = resolved.flatMap((entry) => entry.values.map((definition) => Object.freeze({
      id: definition.id, categoryRef: categoryDefinitionPublicRef(entry.frozenContext.dimension.key, definition.key),
    })));
    if (definitions.length === 0 || definitions.length > MAX_EFFECTIVE_DEFINITIONS
      || new Set(definitions.map((definition) => definition.id)).size !== definitions.length
      || new Set(definitions.map((definition) => definition.categoryRef)).size !== definitions.length) {
      throw new CurrentCategoryCompositionError("capacity_exceeded");
    }
    let bindings: readonly CurrentCategoryProfileBinding[];
    try { bindings = await this.reader.currentActiveArtifacts(workspaceId, definitions.map((definition) => definition.id)); }
    catch { throw new CurrentCategoryCompositionError("stale_profile"); }
    const expected = new Map(definitions.map((definition) => [definition.id, definition.categoryRef]));
    const byDefinition = new Map<string, CategoryProfileRevision>();
    for (const binding of bindings) {
      const expectedRef = expected.get(binding.categoryDefinitionId);
      if (!expectedRef || byDefinition.has(binding.categoryDefinitionId)) {
        throw new CurrentCategoryCompositionError("ambiguous_profile");
      }
      if (binding.profile.status !== "active" || binding.profile.categoryRef !== expectedRef) {
        throw new CurrentCategoryCompositionError("stale_profile");
      }
      byDefinition.set(binding.categoryDefinitionId, binding.profile);
    }
    if (bindings.length !== definitions.length) throw new CurrentCategoryCompositionError("incomplete_context");
    if (byDefinition.size !== expected.size) throw new CurrentCategoryCompositionError("incomplete_context");
    try {
      const dimensions = resolved.map((entry) => Object.freeze({ ...entry,
        frozenContext: bindCategoryProfiles(entry.frozenContext,
          entry.values.map((definition) => byDefinition.get(definition.id)!)),
      }));
      return Object.freeze({ workspaceId, dimensions: Object.freeze(dimensions) });
    } catch { throw new CurrentCategoryCompositionError("stale_profile"); }
  }
}

/** Concrete server-private adapter; it exposes no mutation or action method. */
export class DrizzleCurrentCategoryCompositionReader implements CurrentCategoryCompositionReader {
  constructor(private readonly database: NodePgDatabase<typeof schema>, private readonly workspaceRef: string) {}

  resolveAllCurrent(workspaceId: string, target: CategoryHierarchyTarget) {
    return new DrizzleCategoryRegistryRepository(this.database).resolveAllCurrent(workspaceId, target);
  }

  currentActiveArtifacts(workspaceId: string, categoryDefinitionIds: readonly string[]) {
    return new DrizzleCategoryProfileRepository(this.database, workspaceId, this.workspaceRef)
      .currentActiveArtifacts(categoryDefinitionIds);
  }

  async withConsistentSnapshot<T>(work: (reader: CurrentCategoryCompositionReader) => Promise<T>): Promise<T> {
    return this.database.transaction(async (transaction) => {
      await transaction.execute(sql`set transaction isolation level repeatable read, read only`);
      let reader: CurrentCategoryCompositionReader;
      reader = Object.freeze({
        resolveAllCurrent: (workspaceId, target) => new DrizzleCategoryRegistryRepository(transaction as never)
          .resolveAllCurrent(workspaceId, target),
        currentActiveArtifacts: (workspaceId, definitionIds) => new DrizzleCategoryProfileRepository(
          transaction as never, workspaceId, this.workspaceRef).currentActiveArtifacts(definitionIds),
        withConsistentSnapshot: (nestedWork) => nestedWork(reader),
      });
      return work(reader);
    });
  }
}
