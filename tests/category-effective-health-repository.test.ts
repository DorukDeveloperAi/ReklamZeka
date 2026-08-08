import { describe, expect, it, vi } from "vitest";
import { DrizzleCategoryEffectiveHealthRepository } from "@/connectors/categories/category-effective-health-drizzle-repository";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const dimensionId = "22222222-2222-4222-8222-222222222222";
const definitionId = "33333333-3333-4333-8333-333333333333";
const campaignId = "44444444-4444-4444-8444-444444444444";
const adSetId = "55555555-5555-4555-8555-555555555555";
const adId = "66666666-6666-4666-8666-666666666666";
const creativeId = "77777777-7777-4777-8777-777777777777";

describe("DrizzleCategoryEffectiveHealthRepository", () => {
  it("loads canonical private material and preserves creative hierarchy paths for in-process scanning", async () => {
    const results = [
      { rows: [{ id: workspaceId }] },
      { rows: [{ id: dimensionId, key: "campaign_type", version: 1, cardinality: "single",
        allowed_entity_levels: ["campaign", "ad_set", "ad", "creative"], archived_at: null }] },
      { rows: [{ id: definitionId, dimension_id: dimensionId, key: "evergreen", label: "Evergreen",
        version: 1, archived_at: null }] },
      { rows: [{ id: "88888888-8888-4888-8888-888888888888", dimension_id: dimensionId,
        definition_id: definitionId, entity_level: "campaign", entity_id: campaignId, operation: "add",
        source: "manual", manual_lock: true, evidence: [{ kind: "owner_instruction", ref: "private:evidence" }],
        confidence: 1, version: 1, archived_at: null }] },
      { rows: [{ campaign_id: campaignId, ad_set_id: adSetId, ad_id: adId, creative_id: creativeId }] },
    ];
    const execute = vi.fn(async () => results.shift());
    const loaded = await new DrizzleCategoryEffectiveHealthRepository({ execute } as never).load(workspaceId);
    expect(loaded).toMatchObject({ dimensions: [{ id: dimensionId }], definitions: [{ id: definitionId }],
      assignments: [{ entity: { level: "campaign", id: campaignId }, manualLock: true }],
      hierarchyPaths: [{ nodes: [{ level: "campaign", id: campaignId }, { level: "ad_set", id: adSetId },
        { level: "ad", id: adId }, { level: "creative", id: creativeId }] }] });
    expect(execute).toHaveBeenCalledTimes(5);
  });

  it("rejects cross-workspace access before loading registry material", async () => {
    const execute = vi.fn(async () => ({ rows: [] }));
    await expect(new DrizzleCategoryEffectiveHealthRepository({ execute } as never).load(workspaceId))
      .rejects.toMatchObject({ code: "workspace_scope_mismatch" });
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
