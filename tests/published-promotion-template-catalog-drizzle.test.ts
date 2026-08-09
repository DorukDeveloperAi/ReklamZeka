import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

import { DrizzlePublishedPromotionTemplateCatalog } from
  "@/connectors/meta/promotion/published-promotion-template-catalog-drizzle";
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
const workspaceRef = "workspace_local";
const evaluatedAt = "2026-08-09T18:00:00.000Z";

function row(overrides: Record<string, unknown> = {}) {
  const accountRef = promotionRegistryPublicRef("account", workspaceId, accountId);
  const actorRef = promotionRegistryPublicRef("actor", workspaceId, actorId);
  const categoryRef = promotionRegistryPublicRef("category", workspaceId, categoryId);
  const preset = createAudiencePresetRevision({
    version: AUDIENCE_PRESET_VERSION, workspaceRef, presetRef: "audience_hair", revision: 2,
    aliases: ["Türkiye sağlık kitlesi"], state: "published",
    source: { kind: "frozen_targeting_spec", sourceRef: "source_hair", targetingHash: "a".repeat(64), provenanceHash: "b".repeat(64) },
    targeting: { geoRefs: ["geo_turkey"], languages: ["language_tr"], ageMin: 25, ageMax: 55,
      inclusionRefs: ["interest_health"], exclusionRefs: [] }, publishedAt: "2026-08-09T16:00:00.000Z",
  });
  const template = createPromotionTemplateRevision({
    version: PROMOTION_TEMPLATE_VERSION, workspaceRef, templateRef: "template_hair", revision: 4,
    aliases: ["Saç ekimi gönderisini öne çıkar"], state: "published", accountRefs: [accountRef], actorTypes: ["instagram"],
    internalCategoryRefs: [categoryRef], postTypes: ["image"], objectiveRef: "objective_messages",
    optimizationGoalRef: "optimization_conversations", destinationRef: "destination_instagram",
    placementRefs: ["placement_automatic"], namingRuleRef: "naming_standard", trackingRuleRef: "tracking_standard",
    adSetPolicy: "existing_only", audiencePreset: { presetRef: preset.presetRef, revision: preset.revision,
      presetHash: preset.presetHash }, budget: { ownerLevel: "adset", currency: "TRY", kind: "daily", defaultDecimal: "1000",
      minimumDecimal: "500", maximumDecimal: "2000", budgetPlanVersionRef: "budget_plan_v4" },
    timeframe: { timeframeRef: "timeframe_seven_days", scheduleMode: "fixed_duration", durationDays: 7 },
    publishedAt: "2026-08-09T16:01:00.000Z",
  });
  const binding = createPromotionTemplateBinding({
    version: PROMOTION_TEMPLATE_BINDING_VERSION, workspaceRef, bindingRef: "binding_hair",
    template: { templateRef: template.templateRef, revision: template.revision, templateHash: template.templateHash },
    accountRef, actor: { type: "instagram", actorRef }, internalCategoryRefs: [categoryRef], campaignRef: null,
    effectiveFrom: "2026-08-09T16:02:00.000Z", expiresAt: null,
  }, template);
  return { account_id: accountId, actor_id: actorId, actor_type: "instagram", asset_type: "instagram_account",
    category_id: categoryId, category_ref: categoryRef, binding_payload: binding, binding_hash: binding.bindingHash,
    template_ref: template.templateRef, template_revision: template.revision, template_payload: template,
    template_hash: template.templateHash, preset_ref: preset.presetRef, preset_revision: preset.revision,
    preset_payload: preset, preset_hash: preset.presetHash, objective_ref: template.objectiveRef,
    budget_plan_ref: template.budget.budgetPlanVersionRef, budget_kind: template.budget.kind,
    budget_currency: template.budget.currency, budget_default: "1000.000000000000", timeframe_ref: template.timeframe.timeframeRef,
    schedule_mode: template.timeframe.scheduleMode, duration_days: template.timeframe.durationDays, ...overrides };
}

describe("published PromotionTemplate Drizzle catalog", () => {
  it("reconstructs one tenant-bound candidate while keeping relational IDs inside the adapter", async () => {
    const execute = vi.fn().mockResolvedValue({ rows: [row()] });
    const result = await new DrizzlePublishedPromotionTemplateCatalog({ execute } as never, workspaceId, workspaceRef)
      .listPublished({ workspaceRef, evaluatedAt });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ template: { templateRef: "template_hair" }, preset: { presetRef: "audience_hair" },
      binding: { bindingRef: "binding_hair" } });
    expect(execute).toHaveBeenCalledTimes(1);
    const rendered = new PgDialect().sqlToQuery(execute.mock.calls[0]![0] as never).sql;
    expect(rendered).toMatch(/effective_event\.status = 'published'/);
    expect(rendered).toMatch(/newer_event\.status in \('published', 'archived'\)/);
  });

  it("fails closed on forged public relations, payload hashes, duplicate edges and truncation", async () => {
    for (const rows of [
      [row({ category_ref: "category_forged" })],
      [row({ template_hash: "f".repeat(64) })],
      [row(), row()],
      Array(10001).fill(row()),
    ]) {
      const execute = vi.fn().mockResolvedValue({ rows });
      await expect(new DrizzlePublishedPromotionTemplateCatalog({ execute } as never, workspaceId, workspaceRef)
        .listPublished({ workspaceRef, evaluatedAt })).rejects.toMatchObject({ code: "catalog_integrity_rejected" });
    }
  });

  it("rejects a caller workspace before touching PostgreSQL", async () => {
    const execute = vi.fn();
    await expect(new DrizzlePublishedPromotionTemplateCatalog({ execute } as never, workspaceId, workspaceRef)
      .listPublished({ workspaceRef: "workspace_other", evaluatedAt })).rejects.toMatchObject({ code: "catalog_integrity_rejected" });
    expect(execute).not.toHaveBeenCalled();
  });
});
