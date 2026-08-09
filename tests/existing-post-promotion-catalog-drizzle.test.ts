import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

import { DrizzleExistingPostPromotionCatalogRepository } from "@/connectors/meta/promotion/existing-post-promotion-catalog-drizzle-repository";
import { promotionRegistryPublicRef } from "@/connectors/meta/promotion/promotion-registry-drizzle-repository";
import {
  AUDIENCE_PRESET_VERSION,
  PROMOTION_TEMPLATE_BINDING_VERSION,
  PROMOTION_TEMPLATE_VERSION,
  createAudiencePresetRevision,
  createPromotionTemplateBinding,
  createPromotionTemplateRevision,
} from "@/domain/meta/promotion/promotion-template";

const workspaceId = "11111111-1111-4111-a111-111111111111";
const accountId = "22222222-2222-4222-a222-222222222222";
const actorId = "33333333-3333-4333-a333-333333333333";
const categoryId = "44444444-4444-4444-a444-444444444444";
const postId = "55555555-5555-4555-a555-555555555555";
const adSetId = "77777777-7777-4777-a777-777777777777";
const campaignId = "88888888-8888-4888-a888-888888888888";
const accountRef = promotionRegistryPublicRef("account", workspaceId, accountId);
const actorRef = promotionRegistryPublicRef("actor", workspaceId, actorId);
const categoryRef = promotionRegistryPublicRef("category", workspaceId, categoryId);

function registryRow(input: Readonly<{
  accountId?: string;
  templateRef?: string;
  bindingRef?: string;
  overrides?: Record<string, unknown>;
}> = {}) {
  const rowAccountId = input.accountId ?? accountId;
  const rowAccountRef = promotionRegistryPublicRef("account", workspaceId, rowAccountId);
  const preset = createAudiencePresetRevision({
    version: AUDIENCE_PRESET_VERSION, workspaceRef: "workspace_local", presetRef: "audience_preset_hair", revision: 4,
    aliases: ["İstanbul Saç Ekimi"], state: "published",
    source: { kind: "frozen_targeting_spec", sourceRef: "source_hair", targetingHash: "a".repeat(64), provenanceHash: "b".repeat(64) },
    targeting: { geoRefs: ["geo_istanbul"], languages: ["language_tr"], ageMin: 25, ageMax: 55,
      inclusionRefs: ["interest_hair"], exclusionRefs: [] }, publishedAt: "2026-08-06T07:00:00.000Z",
  });
  const template = createPromotionTemplateRevision({
    version: PROMOTION_TEMPLATE_VERSION, workspaceRef: "workspace_local", templateRef: input.templateRef ?? "template_existing_post", revision: 3,
    aliases: ["Mevcut gönderi öne çıkarma"], state: "published", accountRefs: [rowAccountRef], actorTypes: ["instagram"],
    internalCategoryRefs: [categoryRef], postTypes: ["image"], objectiveRef: "objective_messages",
    optimizationGoalRef: "optimization_conversations", destinationRef: "destination_instagram", placementRefs: ["placement_feed"],
    namingRuleRef: "naming_default", trackingRuleRef: "tracking_default", adSetPolicy: "existing_only",
    audiencePreset: { presetRef: preset.presetRef, revision: preset.revision, presetHash: preset.presetHash },
    budget: { ownerLevel: "adset", currency: "TRY", kind: "daily", defaultDecimal: "1200",
      minimumDecimal: "100", maximumDecimal: "5000", budgetPlanVersionRef: "budget_plan_daily_v3" },
    timeframe: { timeframeRef: "timeframe_seven_days", scheduleMode: "fixed_duration", durationDays: 7 },
    publishedAt: "2026-08-06T07:01:00.000Z",
  });
  const binding = createPromotionTemplateBinding({
    version: PROMOTION_TEMPLATE_BINDING_VERSION, workspaceRef: "workspace_local", bindingRef: input.bindingRef ?? "binding_hair_instagram",
    template: { templateRef: template.templateRef, revision: template.revision, templateHash: template.templateHash },
    accountRef: rowAccountRef, actor: { actorRef, type: "instagram" }, internalCategoryRefs: [categoryRef], campaignRef: null,
    effectiveFrom: "2026-08-06T07:02:00.000Z", expiresAt: null,
  }, template);
  return {
    account_id: rowAccountId, account_name: "Doruk Hastaneleri 1234567890",
    actor_id: actorId, actor_type: "instagram", asset_type: "instagram_account",
    actor_name: "Doruk Hastaneleri", actor_username: "dorukhastaneleri",
    binding_payload: binding, binding_hash: binding.bindingHash,
    template_ref: template.templateRef, template_revision: template.revision,
    template_payload: template, template_hash: template.templateHash,
    preset_ref: preset.presetRef, preset_revision: preset.revision,
    preset_payload: preset, preset_hash: preset.presetHash,
    category_id: categoryId, category_ref: categoryRef, category_label: "Saç ekimi · İstanbul",
    objective_ref: "objective_messages", budget_plan_ref: "budget_plan_daily_v3",
    budget_kind: "daily", budget_currency: "TRY", budget_default: "1200.000000000000",
    timeframe_ref: "timeframe_seven_days", schedule_mode: "fixed_duration", duration_days: 7,
    ...input.overrides,
  };
}

function database(registry: readonly unknown[] = [registryRow()], posts: readonly unknown[] = [{
  post_id: postId, actor_id: actorId, asset_type: "instagram_account",
  media_type: "IMAGE", published_at: new Date("2026-08-06T09:00:00.000Z"),
}], adSets: readonly unknown[] = [{ ad_set_id: adSetId, ad_set_name: "TR Lead Mesaj",
  account_id: accountId, campaign_id: campaignId }]) {
  const execute = vi.fn().mockResolvedValueOnce({ rows: registry }).mockResolvedValueOnce({ rows: posts })
    .mockResolvedValueOnce({ rows: adSets });
  return { execute };
}

describe("Drizzle existing-post promotion catalog", () => {
  it("projects only authentic opaque references and never exposes copy, IDs or immutable hashes", async () => {
    const db = database();
    const result = await new DrizzleExistingPostPromotionCatalogRepository(db as never).list({ workspaceId });
    expect(result).toMatchObject({
      accounts: [{ ref: accountRef, label: "Doruk Hastaneleri •••" }],
      actors: [{ ref: actorRef, accountRef, type: "instagram", label: "@dorukhastaneleri" }],
      posts: [{ ref: promotionRegistryPublicRef("post", workspaceId, postId), actorRef }],
      adSets: [{ ref: promotionRegistryPublicRef("adset", workspaceId, adSetId), accountRef,
        campaignRef: promotionRegistryPublicRef("campaign", workspaceId, campaignId), label: "TR Lead Mesaj" }],
      templates: [{ ref: "template_existing_post", accountRefs: [accountRef], actorRefs: [actorRef],
        internalCategoryRefs: [categoryRef], objectiveRefs: ["objective_messages"], requiredAudiencePresetRef: "audience_preset_hair" }],
      audiencePresets: [{ ref: "audience_preset_hair", label: "İstanbul Saç Ekimi · r4" }],
      budgetPlans: [{ ref: "budget_plan_daily_v3", label: "TRY 1200 / gün" }],
      timeframes: [{ ref: "timeframe_seven_days", label: "7 gün" }],
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(accountId);
    expect(serialized).not.toContain(actorId);
    expect(serialized).not.toContain(postId);
    expect(serialized).not.toContain("source_message");
    expect(serialized).not.toMatch(/[a-f0-9]{64}/);
    expect(db.execute).toHaveBeenCalledTimes(3);
    const registrySql = new PgDialect().sqlToQuery(db.execute.mock.calls[0]![0] as never).sql;
    expect(registrySql).toMatch(/managed_event\.status in \('published', 'archived'\)/);
    expect(registrySql).toMatch(/effective_event\.status = 'published'/);
    expect(registrySql).toMatch(/effective_event\.published_template_hash = template\.template_hash/);
    expect(registrySql).toMatch(/effective_event\.published_binding_hash = binding\.binding_hash/);
    expect(registrySql).toMatch(/newer_event\.status in \('published', 'archived'\)/);
  });

  it("omits actors bound ambiguously to multiple accounts instead of inventing a relation", async () => {
    const otherAccountId = "66666666-6666-4666-a666-666666666666";
    const ambiguous = registryRow({ accountId: otherAccountId, templateRef: "template_other_post", bindingRef: "binding_other_instagram",
      overrides: { account_name: "Diğer hesap" } });
    const result = await new DrizzleExistingPostPromotionCatalogRepository(database([registryRow(), ambiguous]) as never)
      .list({ workspaceId });
    expect(result).toEqual({ accounts: [], actors: [], posts: [], adSets: [], templates: [], audiencePresets: [],
      internalCategories: [], objectives: [], budgetPlans: [], timeframes: [] });
  });

  it("fails closed when a persisted category edge does not match the registry opaque-ref algorithm", async () => {
    const db = database([registryRow({ overrides: { category_ref: "category_forged" } })]);
    await expect(new DrizzleExistingPostPromotionCatalogRepository(db as never).list({ workspaceId }))
      .rejects.toMatchObject({ code: "unsafe_source" });
  });

  it("reconstructs immutable registry documents and rejects forged payloads or stored hashes", async () => {
    const base = registryRow();
    const templatePayload = { ...(base.template_payload as Record<string, unknown>), aliases: ["Forged alias"] };
    const presetPayload = { ...(base.preset_payload as Record<string, unknown>), aliases: ["Forged preset"] };
    for (const forged of [
      { ...base, template_hash: "f".repeat(64) },
      { ...base, preset_hash: "f".repeat(64) },
      { ...base, binding_hash: "f".repeat(64) },
      { ...base, template_payload: templatePayload },
      { ...base, preset_payload: presetPayload },
    ]) {
      await expect(new DrizzleExistingPostPromotionCatalogRepository(database([forged]) as never).list({ workspaceId }))
        .rejects.toMatchObject({ code: "unsafe_source" });
    }
  });

  it("fails closed instead of trusting a truncated registry or post query", async () => {
    const row = registryRow();
    await expect(new DrizzleExistingPostPromotionCatalogRepository(database(Array(10001).fill(row), []) as never).list({ workspaceId }))
      .rejects.toMatchObject({ code: "source_unavailable" });
    const post = { post_id: postId, actor_id: actorId, asset_type: "instagram_account",
      media_type: "IMAGE", published_at: new Date("2026-08-06T09:00:00.000Z") };
    await expect(new DrizzleExistingPostPromotionCatalogRepository(database([], Array(1001).fill(post)) as never).list({ workspaceId }))
      .rejects.toMatchObject({ code: "source_unavailable" });
    const adSet = { ad_set_id: adSetId, ad_set_name: "TR Lead", account_id: accountId, campaign_id: campaignId };
    await expect(new DrizzleExistingPostPromotionCatalogRepository(database([], [], Array(1001).fill(adSet)) as never).list({ workspaceId }))
      .rejects.toMatchObject({ code: "source_unavailable" });
  });
});
