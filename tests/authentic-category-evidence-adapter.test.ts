import { describe, expect, it, vi } from "vitest";
import type { ProtectionEvidenceScope } from "@/application/existing-post-promotion-protection-evidence-materializer";
import {
  AuthenticCategoryEvidenceAdapter,
  createDrizzleAuthenticCategoryEvidenceAdapter,
  type EffectiveCategoryContextEvidenceReader,
  type FrozenCategoryEvidenceReader,
} from "@/connectors/actions/authentic-category-evidence-adapter";
import type { StoredEffectiveCampaignContext } from "@/connectors/analyses/effective-campaign-context-drizzle-repository";
import type { EffectiveCategoryResolution, FrozenCategoryContext } from "@/domain/categories/registry";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const campaignId = "22222222-2222-4222-8222-222222222222";
const dimensionId = "33333333-3333-4333-8333-333333333333";
const definitionId = "44444444-4444-4444-8444-444444444444";
const contextHash = "a".repeat(64);
const resolutionHash = "b".repeat(64);
const categoryRef = "category_6979998fed6edfa188dde49b";

const scope: ProtectionEvidenceScope = Object.freeze({
  workspaceId,
  workspaceRef: "workspace_local",
  accountRef: "account_primary",
  campaignRef: "campaign_primary",
  entity: Object.freeze({ level: "campaign", ref: "campaign_primary" }),
  notBefore: "2026-08-08T08:00:00.000Z",
  evaluatedAt: "2026-08-08T10:00:00.000Z",
});

const frozen: FrozenCategoryContext = Object.freeze({
  schemaVersion: 1,
  workspaceId,
  path: Object.freeze([Object.freeze({ level: "campaign" as const, id: campaignId })]),
  dimension: Object.freeze({ id: dimensionId, key: "internal_campaign_type", version: 3, cardinality: "single" as const }),
  definitionVersions: Object.freeze([Object.freeze({ id: definitionId, key: "category_brand", version: 2 })]),
  effectiveDefinitions: Object.freeze([Object.freeze({ id: definitionId, key: "category_brand", version: 2 })]),
  evaluatedAssignments: Object.freeze([Object.freeze({
    id: "55555555-5555-4555-8555-555555555555", version: 4, operation: "override" as const,
    entityLevel: "campaign" as const, manualLock: true,
  })]),
  resolutionHash,
});

function resolution(hash = resolutionHash, categoryKey = "category_brand"): EffectiveCategoryResolution {
  const nextFrozen = hash === frozen.resolutionHash ? frozen : Object.freeze({ ...frozen, resolutionHash: hash });
  return Object.freeze({
    frozenContext: nextFrozen,
    values: Object.freeze([Object.freeze({
      id: definitionId, workspaceId, dimensionId, key: categoryKey, label: "Brand",
      version: 2, archivedAt: null,
    })]),
  });
}

function record(overrides: Record<string, unknown> = {}): StoredEffectiveCampaignContext {
  return {
    context: {
      workspaceId,
      contextHash,
      capturedAt: "2026-08-08T09:00:00.000Z",
      identity: { accountRef: scope.accountRef, campaignRef: scope.campaignRef,
        entityType: "campaign", entityRef: scope.entity.ref },
      data: { trustStatus: "ready", blockers: [] },
      categories: [frozen],
      ...overrides,
    },
    sourceComponents: Object.freeze([Object.freeze({
      componentType: "category_resolution", componentRef: dimensionId, componentVersion: resolutionHash,
    })]),
    invalidated: false,
  } as unknown as StoredEffectiveCampaignContext;
}

function harness(stored: StoredEffectiveCampaignContext | null = record()) {
  const contexts: EffectiveCategoryContextEvidenceReader = {
    loadLatestValid: vi.fn().mockResolvedValue(stored),
  };
  const categories: FrozenCategoryEvidenceReader = {
    replayFrozen: vi.fn().mockResolvedValue(resolution()),
    resolveCurrent: vi.fn().mockResolvedValue(resolution()),
  };
  return { contexts, categories, adapter: new AuthenticCategoryEvidenceAdapter(
    contexts, categories, workspaceId, scope.workspaceRef,
  ) };
}

describe("AuthenticCategoryEvidenceAdapter", () => {
  it("constructs the production Drizzle composition without querying or exposing mutation methods", () => {
    const database = Object.freeze({ select: vi.fn(), insert: vi.fn(), update: vi.fn(), execute: vi.fn(), transaction: vi.fn() });
    const adapter = createDrizzleAuthenticCategoryEvidenceAdapter({ database: database as never,
      workspaceId, workspaceRef: scope.workspaceRef });
    expect(database.select).not.toHaveBeenCalled(); expect(database.execute).not.toHaveBeenCalled();
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(adapter)).sort()).toEqual(["constructor", "resolveCandidates"]);
  });

  it("materializes one scoped candidate from current hash-valid frozen category evidence", async () => {
    const { adapter, contexts, categories } = harness();

    const candidates = await adapter.resolveCandidates(scope);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      sourceKind: "effective_category_context", workspaceId, workspaceRef: scope.workspaceRef,
      accountRef: scope.accountRef, campaignRef: scope.campaignRef, entity: scope.entity,
      capturedAt: "2026-08-08T09:00:00.000Z", contextHash, categoryRefs: [categoryRef],
    });
    expect(candidates[0]!.sourceRevisions).toHaveLength(3);
    expect(new Set(candidates[0]!.sourceRevisions.map((entry) => entry.sourceRef)).size).toBe(3);
    expect(contexts.loadLatestValid).toHaveBeenCalledWith({
      workspaceId, entityType: "campaign", entityRef: "campaign_primary",
    });
    expect(categories.replayFrozen).toHaveBeenCalledWith(frozen, { level: "campaign", id: campaignId });
  });

  it("fails closed before reads for a cross-tenant workspace binding", async () => {
    const { adapter, contexts } = harness();
    const result = await adapter.resolveCandidates({ ...scope, workspaceRef: "workspace_foreign" });
    expect(result).toEqual([]);
    expect(contexts.loadLatestValid).not.toHaveBeenCalled();
  });

  it.each([
    ["missing context", null, resolution(), "category_brand"],
    ["stale context", record({ capturedAt: "2026-08-08T07:59:59.000Z" }), resolution(), "category_brand"],
    ["wrong account", record({ identity: { accountRef: "account_foreign", campaignRef: scope.campaignRef,
      entityType: "campaign", entityRef: scope.entity.ref } }), resolution(), "category_brand"],
    ["changed current resolution", record(), resolution("c".repeat(64)), "category_brand"],
    ["blank definition key", record(), resolution(), ""],
  ])("returns no candidate for %s", async (_name, stored, current, categoryKey) => {
    const { adapter, categories } = harness(stored as StoredEffectiveCampaignContext | null);
    vi.mocked(categories.resolveCurrent).mockResolvedValue(current as EffectiveCategoryResolution);
    vi.mocked(categories.replayFrozen).mockResolvedValue(resolution(resolutionHash, categoryKey as string));
    await expect(adapter.resolveCandidates(scope)).resolves.toEqual([]);
  });

  it("fails closed when replay is unavailable or corrupt", async () => {
    const { adapter, categories } = harness();
    vi.mocked(categories.replayFrozen).mockRejectedValue(new Error("corrupt_store"));
    await expect(adapter.resolveCandidates(scope)).resolves.toEqual([]);
  });
});
