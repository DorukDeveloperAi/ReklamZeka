import { describe, expect, it, vi } from "vitest";
import { DrizzleCategoryArchiveImpactRepository } from "@/connectors/categories/category-archive-impact-drizzle-repository";
import { categoryDefinitionPublicRef, categoryDimensionPublicRef } from "@/domain/categories/public-reference";

const workspaceId = "11111111-1111-4111-8111-111111111111"; const dimensionId = "22222222-2222-4222-8222-222222222222";
const definitionId = "33333333-3333-4333-8333-333333333333";
const counts = { active_definitions: 1, active_assignments: 2, manual_locks: 1, guidance_drafts: 0,
  guidance_published: 1, archived_guidance: 3, active_promotion_bindings: 1, expired_promotion_bindings: 2,
  autonomy_drafts: 0, autonomy_published: 1, guardrail_drafts: 0, guardrail_published: 1,
  effective_contexts: 4, invalidated_contexts: 1, budget_proposals: 2, component_count: 2,
  contexts_needing_invalidation: 3 };
function database() { const results = [{ rows: [{ id: workspaceId }] }, { rows: [{ id: dimensionId,
  key: "campaign_type", name: "Kampanya türü", version: 1 }] }, { rows: [{ id: definitionId,
  dimension_id: dimensionId, dimension_key: "campaign_type", key: "evergreen", label: "Evergreen", version: 1 }] },
{ rows: [counts] }]; return { execute: vi.fn(async () => results.shift()) }; }

describe("DrizzleCategoryArchiveImpactRepository", () => {
  it("blocks dimension archive on exact dependencies and keeps partial coverage explicit", async () => {
    const db = database(); const result = await new DrizzleCategoryArchiveImpactRepository(db as never)
      .preview(workspaceId, categoryDimensionPublicRef("campaign_type"));
    expect(result).toMatchObject({ target: { kind: "dimension", label: "Kampanya türü" },
      exactBlockers: { activeDefinitions: 1, activeAssignments: 2, manualLocks: 1, guidancePublished: 1,
        activePromotionBindings: 1, autonomyPublished: 1, guardrailPublished: 1 },
      historicalImpact: { effectiveContexts: 4, alreadyInvalidatedContexts: 1, budgetProposals: 2 },
      invalidationPlan: { categoryResolutionComponents: 2, contextsNeedingInvalidation: 3 },
      coverage: { complete: false }, disposition: "blocked", archiveAllowed: false,
      authority: { canArchive: false, canWriteMeta: false } });
    expect(JSON.stringify(result)).not.toContain(workspaceId); expect(JSON.stringify(result)).not.toContain(dimensionId);
  });
  it("resolves definition refs but still never declares archive allowed with partial coverage", async () => {
    const result = await new DrizzleCategoryArchiveImpactRepository(database() as never)
      .preview(workspaceId, categoryDefinitionPublicRef("campaign_type", "evergreen"));
    expect(result).toMatchObject({ target: { kind: "definition" }, exactBlockers: { activeDefinitions: 0 },
      disposition: "blocked", archiveAllowed: false, coverage: { complete: false } });
  });
});
