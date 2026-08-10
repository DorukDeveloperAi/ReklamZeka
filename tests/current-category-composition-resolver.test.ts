import { describe, expect, it, vi } from "vitest";
import { CurrentCategoryCompositionError, CurrentCategoryCompositionResolver,
  DrizzleCurrentCategoryCompositionReader, resolveCurrentCategoryCompositionInSnapshot,
  type CurrentCategoryCompositionReader } from "@/application/current-category-composition-resolver";
import { PgDialect } from "drizzle-orm/pg-core";
import { createCategoryProfile } from "@/domain/categories/category-profile";
import { resolveEffectiveCategory, type CategoryDefinition, type CategoryDimension,
  type EffectiveCategoryResolution } from "@/domain/categories/registry";
import { categoryDefinitionPublicRef } from "@/domain/categories/public-reference";
import { DrizzleCategoryRegistryRepository } from "@/connectors/categories/category-registry-drizzle-repository";

const workspaceId = "workspace_category_composition";
const target = { level: "campaign", id: "campaign-1" } as const;
const path = { workspaceId, nodes: [{ level: "campaign", id: "campaign-1" }] } as const;

function resolution(id: string, key: string): EffectiveCategoryResolution {
  const dimension: CategoryDimension = { id: `dimension-${id}`, workspaceId, key: `dimension_${key}`,
    version: 1, cardinality: "single", allowedEntityLevels: ["campaign"], archivedAt: null };
  const definition: CategoryDefinition = { id: `definition-${id}`, workspaceId, dimensionId: dimension.id,
    key: `definition_${key}`, label: key, version: 1, archivedAt: null };
  return resolveEffectiveCategory({ dimension, definitions: [definition], path, assignments: [{
    id: `assignment-${id}`, workspaceId, dimensionId: dimension.id, definitionId: definition.id,
    entity: { level: "campaign", id: "campaign-1" }, operation: "add", source: "manual", manualLock: false,
    evidence: [{ kind: "owner_instruction", ref: `instruction_${id}` }], confidence: 1, version: 1, archivedAt: null,
  }] });
}

function activeProfile(result: EffectiveCategoryResolution) {
  const definition = result.values[0]!;
  return createCategoryProfile({ workspaceRef: workspaceId, profileRef: `category_profile_${definition.id}`,
    categoryRef: categoryDefinitionPublicRef(result.frozenContext.dimension.key, definition.key), parentCategoryRef: null,
    label: definition.label, description: "Complete category evidence", color: "#A31F34", ownerRef: "actor_owner",
    status: "active", bindings: { analysisPlaybookRefs: ["analysis_playbook_safe"],
      ruleInstructionBundleRefs: ["instruction_bundle_safe"], budgetPolicyRefs: ["budget_policy_safe"],
      transferPolicyRefs: ["transfer_policy_safe"], schedulePolicyRefs: ["schedule_policy_safe"],
      actionPolicyRefs: ["action_policy_safe"], creativePolicyRefs: ["creative_policy_safe"] },
  });
}

function reader(results: readonly EffectiveCategoryResolution[], profiles = results.flatMap((result) => result.values.map((definition) => ({
  categoryDefinitionId: definition.id, profile: activeProfile(result),
})))): CurrentCategoryCompositionReader {
  let value: CurrentCategoryCompositionReader;
  value = {
    resolveAllCurrent: vi.fn(async () => results), currentActiveArtifacts: vi.fn(async () => profiles),
    withConsistentSnapshot: async (work) => work(value),
  };
  return value;
}

describe("CurrentCategoryCompositionResolver", () => {
  it("uses a repeatable read-only snapshot when the concrete Drizzle reader is selected", async () => {
    const execute = vi.fn(async (_query: unknown) => ({ rows: [] }));
    const database = { execute, transaction: vi.fn(async (work: (tx: { execute: typeof execute }) => Promise<unknown>) => work({ execute })) };
    const concrete = new DrizzleCurrentCategoryCompositionReader(database as never, workspaceId);
    await expect(concrete.withConsistentSnapshot(async () => "consistent")).resolves.toBe("consistent");
    expect(database.transaction).toHaveBeenCalledTimes(1);
    expect(new PgDialect().sqlToQuery(execute.mock.calls[0]![0] as never).sql)
      .toMatch(/set transaction isolation level repeatable read, read only/i);
  });

  it("resolves from a caller-owned reader without starting a nested snapshot", async () => {
    const result = resolution("snapshot", "service");
    const port = reader([result]);
    const withConsistentSnapshot = vi.fn(port.withConsistentSnapshot);
    const callerOwned = { ...port, withConsistentSnapshot };
    const composed = await resolveCurrentCategoryCompositionInSnapshot(callerOwned, workspaceId, target);
    expect(composed.workspaceId).toBe(workspaceId);
    expect(withConsistentSnapshot).not.toHaveBeenCalled();
  });

  it("makes the all-dimension Drizzle read reuse exactly one canonical path", async () => {
    const dimensions = [{ id: "dimension-b", workspaceId, key: "zeta", version: 1, cardinality: "single",
      allowedEntityLevels: ["campaign"], archivedAt: null }, { id: "dimension-a", workspaceId, key: "alpha",
      version: 1, cardinality: "single", allowedEntityLevels: ["campaign"], archivedAt: null }];
    const database = { select: vi.fn(() => ({ from: vi.fn(() => ({ where: vi.fn(async () => dimensions) })) })) };
    const repository = new DrizzleCategoryRegistryRepository(database as never);
    const internal = repository as unknown as { canonicalPath: ReturnType<typeof vi.fn>; resolveWith: ReturnType<typeof vi.fn> };
    const canonicalPath = vi.spyOn(internal, "canonicalPath").mockResolvedValue(path);
    const resolveWith = vi.spyOn(internal, "resolveWith").mockResolvedValue(resolution("result", "service"));
    await repository.resolveAllCurrent(workspaceId, target);
    expect(canonicalPath).toHaveBeenCalledTimes(1);
    expect(resolveWith).toHaveBeenCalledTimes(2);
    expect(resolveWith.mock.calls.map((call) => call[3])).toEqual([path, path]);
    expect(resolveWith.mock.calls.map((call) => call[2])).toEqual(["dimension-a", "dimension-b"]);
  });

  it("binds every active dimension to the exact current active profile from one canonical path", async () => {
    const first = resolution("first", "service");
    const second = resolution("second", "market");
    const port = reader([second, first]);
    const composed = await new CurrentCategoryCompositionResolver(port).resolve(workspaceId, target);
    expect(composed.dimensions).toHaveLength(2);
    expect(composed.dimensions.map((entry) => entry.frozenContext.dimension.key)).toEqual([
      second.frozenContext.dimension.key, first.frozenContext.dimension.key,
    ]);
    expect(composed.dimensions.map((entry) => entry.frozenContext.profileBindings?.[0]?.profileHash))
      .toEqual([activeProfile(second).profileHash, activeProfile(first).profileHash]);
    expect(port.resolveAllCurrent).toHaveBeenCalledWith(workspaceId, target);
    expect(port.currentActiveArtifacts).toHaveBeenCalledWith(workspaceId, expect.arrayContaining([
      first.values[0]!.id, second.values[0]!.id,
    ]));
  });

  it.each([
    ["missing", (result: EffectiveCategoryResolution) => []],
    ["ambiguous", (result: EffectiveCategoryResolution) => {
      const profile = activeProfile(result);
      return [{ categoryDefinitionId: result.values[0]!.id, profile }, { categoryDefinitionId: result.values[0]!.id, profile }];
    }],
    ["stale", (result: EffectiveCategoryResolution) => [{ categoryDefinitionId: result.values[0]!.id,
      profile: { ...activeProfile(result), categoryRef: "category_wrong" } }]],
  ] as const)("fails closed on %s profile evidence", async (kind, profiles) => {
    const result = resolution("only", "service");
    await expect(new CurrentCategoryCompositionResolver(reader([result], profiles(result))).resolve(workspaceId, target))
      .rejects.toEqual(expect.objectContaining<Partial<CurrentCategoryCompositionError>>({
        code: kind === "missing" ? "incomplete_context" : kind === "ambiguous" ? "ambiguous_profile" : "stale_profile",
      }));
  });

  it("rejects any unmatched active dimension and parked conflicts without yielding partial dimensions", async () => {
    const good = resolution("good", "service");
    const unmatched = resolveEffectiveCategory({ dimension: { ...good.frozenContext.dimension, id: "dimension-empty",
      key: "dimension_empty", workspaceId, allowedEntityLevels: ["campaign"], archivedAt: null }, definitions: [], path, assignments: [] });
    await expect(new CurrentCategoryCompositionResolver(reader([good, unmatched])).resolve(workspaceId, target))
      .rejects.toEqual(expect.objectContaining<Partial<CurrentCategoryCompositionError>>({ code: "incomplete_context" }));
    await expect(new CurrentCategoryCompositionResolver({
      resolveAllCurrent: async () => { throw { code: "manual_lock" }; }, currentActiveArtifacts: async () => [],
      withConsistentSnapshot: async (work) => work({
        resolveAllCurrent: async () => { throw { code: "manual_lock" }; }, currentActiveArtifacts: async () => [],
        withConsistentSnapshot: async () => { throw new Error("nested snapshot not allowed"); },
      }),
    }).resolve(workspaceId, target)).rejects.toEqual(expect.objectContaining<Partial<CurrentCategoryCompositionError>>({
      code: "parked_conflict",
    }));
  });
});
