import { describe, expect, it, vi } from "vitest";
import { DrizzleExistingPostPromotionPreflightRepository } from "@/connectors/meta/promotion/existing-post-promotion-preflight-drizzle-repository";
import { promotionRegistryPublicRef } from "@/connectors/meta/promotion/promotion-registry-drizzle-repository";
import { AUDIENCE_PRESET_VERSION, PROMOTION_TEMPLATE_BINDING_VERSION, PROMOTION_TEMPLATE_VERSION,
  createAudiencePresetRevision, createPromotionTemplateBinding, createPromotionTemplateRevision } from "@/domain/meta/promotion/promotion-template";

const workspaceId = "11111111-1111-4111-a111-111111111111";
const accountId = "22222222-2222-4222-a222-222222222222";
const actorId = "33333333-3333-4333-a333-333333333333";
const postId = "44444444-4444-4444-a444-444444444444";
const adSetId = "55555555-5555-4555-a555-555555555555";
const campaignId = "66666666-6666-4666-a666-666666666666";
const categoryId = "77777777-7777-4777-a777-777777777777";
const accountRef = promotionRegistryPublicRef("account", workspaceId, accountId);
const actorRef = promotionRegistryPublicRef("actor", workspaceId, actorId);
const categoryRef = promotionRegistryPublicRef("category", workspaceId, categoryId);
const campaignRef = promotionRegistryPublicRef("campaign", workspaceId, campaignId);
const request = { accountRef, adSetRef: promotionRegistryPublicRef("adset", workspaceId, adSetId), actorRef,
  postRef: promotionRegistryPublicRef("post", workspaceId, postId), promotionTemplateRef: "template_existing_post",
  audiencePresetRef: "audience_hair", budgetPlanRef: "budget_daily", timeframeRef: "timeframe_week",
  objectiveRef: "objective_messages", internalCategoryRef: categoryRef } as const;

function row() {
  const preset = createAudiencePresetRevision({ version: AUDIENCE_PRESET_VERSION, workspaceRef: "workspace_local",
    presetRef: request.audiencePresetRef, revision: 1, aliases: ["Hair"], state: "published",
    source: { kind: "frozen_targeting_spec", sourceRef: "source_hair", targetingHash: "a".repeat(64), provenanceHash: "b".repeat(64) },
    targeting: { geoRefs: ["geo_tr"], languages: ["language_tr"], ageMin: 25, ageMax: 55, inclusionRefs: [], exclusionRefs: [] },
    publishedAt: "2026-08-07T10:00:00.000Z" });
  const template = createPromotionTemplateRevision({ version: PROMOTION_TEMPLATE_VERSION, workspaceRef: "workspace_local",
    templateRef: request.promotionTemplateRef, revision: 1, aliases: ["Existing post"], state: "published",
    accountRefs: [accountRef], actorTypes: ["instagram"], internalCategoryRefs: [categoryRef], postTypes: ["image"],
    objectiveRef: request.objectiveRef, optimizationGoalRef: "optimization_messages", destinationRef: "destination_instagram",
    placementRefs: ["placement_feed"], namingRuleRef: "naming_default", trackingRuleRef: "tracking_default",
    adSetPolicy: "existing_only", audiencePreset: { presetRef: preset.presetRef, revision: 1, presetHash: preset.presetHash },
    budget: { ownerLevel: "adset", currency: "TRY", kind: "daily", defaultDecimal: "1200", minimumDecimal: "100",
      maximumDecimal: "5000", budgetPlanVersionRef: request.budgetPlanRef },
    timeframe: { timeframeRef: request.timeframeRef, scheduleMode: "fixed_duration", durationDays: 7 },
    publishedAt: "2026-08-07T10:01:00.000Z" });
  const binding = createPromotionTemplateBinding({ version: PROMOTION_TEMPLATE_BINDING_VERSION, workspaceRef: "workspace_local",
    bindingRef: "binding_existing_post", template: { templateRef: template.templateRef, revision: 1, templateHash: template.templateHash },
    accountRef, actor: { type: "instagram", actorRef }, internalCategoryRefs: [categoryRef], campaignRef,
    effectiveFrom: "2026-08-07T10:02:00.000Z", expiresAt: null }, template);
  const capabilities = { capabilities: [{ operation: "advertise", status: "verified", reason: null },
    { operation: "promote_existing_post", status: "verified", reason: null }] };
  return { account_id: accountId, account_external_id: "act_123", account_currency: "TRY", account_timezone: "Europe/Istanbul",
    account_permissions: ["ADVERTISE"], account_capabilities: capabilities, actor_id: actorId, actor_external_id: "ig_123",
    actor_type: "instagram", asset_type: "instagram_account", actor_ownership: "owned", actor_permissions: ["ADVERTISE"],
    actor_capabilities: capabilities, post_id: postId, post_external_id: "post_123", post_content_hash: "c".repeat(64),
    post_published_at: new Date(), post_eligibility: "eligible", post_eligibility_at: new Date(), ad_set_id: adSetId,
    ad_set_status: "ACTIVE", ad_set_effective_status: "ACTIVE", campaign_id: campaignId,
    binding_payload: binding, binding_hash: binding.bindingHash, template_ref: template.templateRef, template_revision: 1,
    template_payload: template, template_hash: template.templateHash, preset_ref: preset.presetRef, preset_revision: 1,
    preset_payload: preset, preset_hash: preset.presetHash, category_id: categoryId, category_ref: categoryRef,
    objective_ref: template.objectiveRef, budget_plan_ref: request.budgetPlanRef, budget_kind: "daily", budget_currency: "TRY",
    budget_default: "1200.000000000000", timeframe_ref: request.timeframeRef, schedule_mode: "fixed_duration", duration_days: 7 };
}

describe("Drizzle existing-post public preflight resolver", () => {
  it("resolves the exact ten refs and leaves unauthenticated compatibility unknown", async () => {
    const execute = vi.fn(async () => ({ rows: [row()] }));
    const repository = new DrizzleExistingPostPromotionPreflightRepository({ execute } as never,
      () => new Date("2026-08-08T09:00:00.000Z"));
    const value = await repository.resolve({ workspaceId, workspaceRef: "workspace_local", request });
    expect(value).toMatchObject({ adSet: { ref: request.adSetRef, accountRef, campaignRef, state: "active" },
      budgetPlan: { amountMinor: 120000, state: "active" },
      timeframe: { startAt: "2026-08-08T09:00:00.000Z", endAt: "2026-08-15T09:00:00.000Z", durationDays: 7 },
      template: { compatibility: { destination: "unknown", optimization: "unknown", placement: "unknown",
        specialCategory: "unknown", tracking: "unknown" } }, post: { promotionCapability: "supported" } });
    expect(JSON.stringify(value)).not.toContain("targeting");
  });

  it("returns null for a ref mismatch and fails closed on candidate overflow", async () => {
    const repository = new DrizzleExistingPostPromotionPreflightRepository({ execute: vi.fn(async () => ({ rows: [row()] })) } as never);
    await expect(repository.resolve({ workspaceId, workspaceRef: "workspace_local", request: { ...request, adSetRef: "adset_missing" } }))
      .resolves.toBeNull();
    const overflow = new DrizzleExistingPostPromotionPreflightRepository({ execute: vi.fn(async () => ({ rows: Array(1001).fill(row()) })) } as never);
    await expect(overflow.resolve({ workspaceId, workspaceRef: "workspace_local", request })).rejects.toThrow("candidate_overflow");
  });

  it("does not treat a paused or missing-status ad set as active", async () => {
    const paused = { ...row(), ad_set_effective_status: "CAMPAIGN_PAUSED" };
    const unknown = { ...row(), ad_set_status: null, ad_set_effective_status: null };
    await expect(new DrizzleExistingPostPromotionPreflightRepository({ execute: vi.fn(async () => ({ rows: [paused] })) } as never)
      .resolve({ workspaceId, workspaceRef: "workspace_local", request })).resolves.toMatchObject({ adSet: { state: "inactive" } });
    await expect(new DrizzleExistingPostPromotionPreflightRepository({ execute: vi.fn(async () => ({ rows: [unknown] })) } as never)
      .resolve({ workspaceId, workspaceRef: "workspace_local", request })).resolves.toMatchObject({ adSet: { state: "unknown" } });
  });
});
