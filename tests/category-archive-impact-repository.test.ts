import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { DrizzleCategoryArchiveImpactRepository } from "@/connectors/categories/category-archive-impact-drizzle-repository";
import { CATEGORY_JSONB_MANIFEST } from "@/domain/categories/category-dependency-manifest";
import { categoryDefinitionPublicRef, categoryDimensionPublicRef } from "@/domain/categories/public-reference";
import { promotionRegistryPublicRef } from "@/connectors/meta/promotion/promotion-registry-drizzle-repository";

const workspaceId = "11111111-1111-4111-8111-111111111111"; const dimensionId = "22222222-2222-4222-8222-222222222222";
const definitionId = "33333333-3333-4333-8333-333333333333";
const counts = { active_definitions: 1, active_assignments: 2, manual_locks: 1, guidance_drafts: 0,
  guidance_published: 1, archived_guidance: 3, active_promotion_bindings: 1, expired_promotion_bindings: 2,
  active_promotion_template_scopes: 1, superseded_promotion_template_scopes: 2,
  active_advised_practices: 1, retired_advised_practices: 1, superseded_advised_practices: 2,
  active_category_profiles: 1, historical_category_profiles: 2,
  autonomy_drafts: 0, autonomy_published: 1, guardrail_drafts: 0, guardrail_published: 1,
  effective_contexts: 4, invalidated_contexts: 1, budget_proposals: 2, component_count: 2,
  contexts_needing_invalidation: 3, nonterminal_action_units: 1, terminal_action_units: 2,
  unresolved_category_refs: 0, inconsistent_promotion_edges: 0, malformed_category_contracts: 0,
  corrupt_lifecycle_rows: 0 };
const catalog = CATEGORY_JSONB_MANIFEST.map((entry) => ({ table: entry.table, column: entry.column }));
function database(overrides: Partial<typeof counts> = {}, catalogRows = catalog) { const results = [
  { rows: [{ id: workspaceId }] }, { rows: catalogRows }, { rows: [{ id: dimensionId,
    key: "campaign_type", name: "Kampanya türü", version: 1, is_active: true }] }, { rows: [{ id: definitionId,
    dimension_id: dimensionId, dimension_key: "campaign_type", key: "evergreen", label: "Evergreen", version: 1,
    is_active: true, dimension_active: true }] }, { rows: [{ ...counts, ...overrides }] },
]; return { execute: vi.fn(async () => results.shift()) }; }

describe("DrizzleCategoryArchiveImpactRepository", () => {
  it("blocks dimension archive on exact and conservative dependencies with complete coverage", async () => {
    const db = database(); const result = await new DrizzleCategoryArchiveImpactRepository(db as never)
      .preview(workspaceId, categoryDimensionPublicRef("campaign_type"));
    expect(result).toMatchObject({ target: { kind: "dimension", label: "Kampanya türü" },
      exactBlockers: { activeDefinitions: 1, activeAssignments: 2, manualLocks: 1, guidancePublished: 1,
        activePromotionBindings: 1, activePromotionTemplateScopes: 1, activeAdvisedPractices: 1,
        activeCategoryProfiles: 1, autonomyPublished: 1, guardrailPublished: 1 },
      conservativeBlockers: { nonTerminalActionProposalUnits: 1 },
      historicalImpact: { supersededPromotionTemplateScopes: 2, retiredAdvisedPractices: 1,
        supersededAdvisedPractices: 2, historicalCategoryProfiles: 2,
        effectiveContexts: 4, alreadyInvalidatedContexts: 1,
        budgetProposals: 2, terminalActionProposalUnits: 2 },
      invalidationPlan: { categoryResolutionComponents: 2, contextsNeedingInvalidation: 3 },
      coverage: { complete: true, partialOrUnknown: [], precision: "exact_with_conservative_action_queue",
        integrity: { unclassifiedJsonbColumns: 0, missingManifestJsonbColumns: 0 } },
      disposition: "blocked", archiveAllowed: false,
      authority: { canArchive: false, canWriteMeta: false } });
    expect(result?.impactHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(result)).not.toContain(workspaceId); expect(JSON.stringify(result)).not.toContain(dimensionId);
  });
  it("resolves definition refs but still never grants archive authority", async () => {
    const result = await new DrizzleCategoryArchiveImpactRepository(database() as never)
      .preview(workspaceId, categoryDefinitionPublicRef("campaign_type", "evergreen"));
    expect(result).toMatchObject({ target: { kind: "definition" }, exactBlockers: { activeDefinitions: 0 },
      disposition: "blocked", archiveAllowed: false, coverage: { complete: true } });
  });
  it("fails coverage closed when pg_catalog contains an unclassified JSONB column", async () => {
    const result = await new DrizzleCategoryArchiveImpactRepository(database({}, [
      ...catalog, { table: "future_artifacts", column: "payload" },
    ]) as never).preview(workspaceId, categoryDimensionPublicRef("campaign_type"));
    expect(result).toMatchObject({ coverage: { complete: false,
      integrity: { unclassifiedJsonbColumns: 1, missingManifestJsonbColumns: 0 } }, disposition: "blocked" });
  });
  it("produces a deterministic impact hash and changes it when dependency counts change", async () => {
    const target = categoryDimensionPublicRef("campaign_type");
    const first = await new DrizzleCategoryArchiveImpactRepository(database() as never).preview(workspaceId, target);
    const replay = await new DrizzleCategoryArchiveImpactRepository(database() as never).preview(workspaceId, target);
    const changed = await new DrizzleCategoryArchiveImpactRepository(database({ active_assignments: 3 }) as never)
      .preview(workspaceId, target);
    expect(first?.impactHash).toBe(replay?.impactHash);
    expect(changed?.impactHash).not.toBe(first?.impactHash);
  });
  it("fails coverage closed for contract integrity failures", async () => {
    for (const field of ["unresolved_category_refs", "inconsistent_promotion_edges", "malformed_category_contracts",
      "corrupt_lifecycle_rows"] as const) {
      const result = await new DrizzleCategoryArchiveImpactRepository(database({ [field]: 1 }) as never)
        .preview(workspaceId, categoryDimensionPublicRef("campaign_type"));
      expect(result?.coverage.complete).toBe(false);
      expect(result?.disposition).toBe("blocked");
    }
  });
  it("maps canonical and legacy promotion refs across archived lineage", async () => {
    const oldDimensionId = "44444444-4444-4444-8444-444444444444";
    const oldDefinitionId = "55555555-5555-4555-8555-555555555555";
    const results = [{ rows: [{ id: workspaceId }] }, { rows: catalog }, { rows: [
      { id: oldDimensionId, key: "campaign_type", name: "Kampanya türü", version: 1, is_active: false },
      { id: dimensionId, key: "campaign_type", name: "Kampanya türü", version: 2, is_active: true },
    ] }, { rows: [
      { id: oldDefinitionId, dimension_id: oldDimensionId, dimension_key: "campaign_type", key: "evergreen",
        label: "Evergreen", version: 1, is_active: false, dimension_active: false },
      { id: definitionId, dimension_id: dimensionId, dimension_key: "campaign_type", key: "evergreen",
        label: "Evergreen", version: 2, is_active: true, dimension_active: true },
    ] }, { rows: [counts] }];
    const db = { execute: vi.fn(async (_query: unknown) => results.shift()) };
    const result = await new DrizzleCategoryArchiveImpactRepository(db as never)
      .preview(workspaceId, categoryDefinitionPublicRef("campaign_type", "evergreen"));
    const rendered = new PgDialect().sqlToQuery(db.execute.mock.calls[4]![0] as never);
    expect(result).toMatchObject({ target: { version: 2 }, coverage: { integrity: { ambiguousLineage: 0 } } });
    expect(rendered.params).toEqual(expect.arrayContaining([
      categoryDefinitionPublicRef("campaign_type", "evergreen"),
      promotionRegistryPublicRef("category", workspaceId, oldDefinitionId),
      promotionRegistryPublicRef("category", workspaceId, definitionId),
    ]));
    for (const family of ["ranked_templates", "ranked_practices", "direct_budget_proposals",
      "action_states", "contract_refs", "validPromotionEdge"] as const) {
      if (family === "validPromotionEdge") expect(rendered.sql).toContain("inconsistent_promotion_edges");
      else expect(rendered.sql).toContain(family);
    }
  });
});
