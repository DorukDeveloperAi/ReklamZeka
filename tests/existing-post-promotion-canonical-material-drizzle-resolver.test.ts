import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { DrizzleExistingPostPromotionCanonicalMaterialResolver } from "@/connectors/meta/promotion/existing-post-promotion-canonical-material-drizzle-resolver";
import { promotionRegistryPublicRef } from "@/connectors/meta/promotion/promotion-registry-drizzle-repository";
import { EXISTING_POST_SOURCE_BINDING_VERSION } from "@/domain/actions/autonomy-valve";
import { AUDIENCE_PRESET_VERSION, PROMOTION_TEMPLATE_BINDING_VERSION, PROMOTION_TEMPLATE_VERSION,
  createAudiencePresetRevision, createPromotionTemplateBinding, createPromotionTemplateRevision } from "@/domain/meta/promotion/promotion-template";

const workspaceId = "11111111-1111-4111-a111-111111111111";
const accountId = "22222222-2222-4222-a222-222222222222";
const actorId = "33333333-3333-4333-a333-333333333333";
const postId = "44444444-4444-4444-a444-444444444444";
const adSetId = "55555555-5555-4555-a555-555555555555";
const campaignId = "66666666-6666-4666-a666-666666666666";
const categoryId = "77777777-7777-4777-a777-777777777777";
const hash = (value: string) => value.repeat(64).slice(0, 64);
const accountRef = promotionRegistryPublicRef("account", workspaceId, accountId);
const actorRef = promotionRegistryPublicRef("actor", workspaceId, actorId);
const postRef = promotionRegistryPublicRef("post", workspaceId, postId);
const adSetRef = promotionRegistryPublicRef("adset", workspaceId, adSetId);
const campaignRef = promotionRegistryPublicRef("campaign", workspaceId, campaignId);
const categoryRef = promotionRegistryPublicRef("category", workspaceId, categoryId);
const selection = { accountRef, adSetRef, actorRef, postRef, promotionTemplateRef: "template_existing_post",
  audiencePresetRef: "audience_hair", budgetPlanRef: "budget_daily", timeframeRef: "timeframe_week",
  objectiveRef: "objective_messages", internalCategoryRef: categoryRef } as const;
const principal = { actor: { userId: "user_owner" }, workspaceId, workspaceRef: "workspace_local",
  readerRef: "actor_local_owner" } as const;
const evaluatedAt = "2026-08-07T12:00:00.000Z";

function canonicalDocuments() {
  const preset = createAudiencePresetRevision({ version: AUDIENCE_PRESET_VERSION, workspaceRef: principal.workspaceRef,
    presetRef: selection.audiencePresetRef, revision: 1, aliases: ["Hair"], state: "published",
    source: { kind: "frozen_targeting_spec", sourceRef: "source_hair", targetingHash: hash("a"), provenanceHash: hash("b") },
    targeting: { geoRefs: ["geo_tr"], languages: ["language_tr"], ageMin: 25, ageMax: 55,
      inclusionRefs: [], exclusionRefs: [] }, publishedAt: "2026-08-06T10:00:00.000Z" });
  const template = createPromotionTemplateRevision({ version: PROMOTION_TEMPLATE_VERSION, workspaceRef: principal.workspaceRef,
    templateRef: selection.promotionTemplateRef, revision: 1, aliases: ["Existing post"], state: "published",
    accountRefs: [accountRef], actorTypes: ["instagram"], internalCategoryRefs: [categoryRef], postTypes: ["image"],
    objectiveRef: selection.objectiveRef, optimizationGoalRef: "optimization_messages", destinationRef: "destination_instagram",
    placementRefs: ["placement_feed"], namingRuleRef: "naming_default", trackingRuleRef: "tracking_default",
    adSetPolicy: "existing_only", audiencePreset: { presetRef: preset.presetRef, revision: preset.revision, presetHash: preset.presetHash },
    budget: { ownerLevel: "adset", currency: "TRY", kind: "daily", defaultDecimal: "1200", minimumDecimal: "100",
      maximumDecimal: "5000", budgetPlanVersionRef: selection.budgetPlanRef },
    timeframe: { timeframeRef: selection.timeframeRef, scheduleMode: "fixed_duration", durationDays: 7 },
    publishedAt: "2026-08-06T10:01:00.000Z" });
  const binding = createPromotionTemplateBinding({ version: PROMOTION_TEMPLATE_BINDING_VERSION, workspaceRef: principal.workspaceRef,
    bindingRef: "binding_existing_post", template: { templateRef: template.templateRef, revision: template.revision,
      templateHash: template.templateHash }, accountRef, actor: { type: "instagram", actorRef },
    internalCategoryRefs: [categoryRef], campaignRef, effectiveFrom: "2026-08-06T10:02:00.000Z", expiresAt: null }, template);
  return { preset, template, binding };
}

function row(overrides: Record<string, unknown> = {}) {
  const { preset, template, binding } = canonicalDocuments();
  const capabilities = { capabilities: [{ operation: "advertise", status: "verified", reason: null },
    { operation: "promote_existing_post", status: "verified", reason: null }] };
  return { account_id: accountId, account_external_id: "act_private", account_currency: "TRY",
    account_timezone: "Europe/Istanbul", account_permissions: ["ADVERTISE"], account_capabilities: capabilities,
    actor_id: actorId, actor_external_id: "ig_private", actor_type: "instagram", asset_type: "instagram_account",
    actor_ownership: "owned", actor_permissions: ["ADVERTISE"], actor_capabilities: capabilities,
    post_id: postId, post_external_id: "post_private", post_content_hash: hash("c"), post_published_at: new Date(evaluatedAt),
    post_eligibility: "eligible", post_eligibility_at: new Date(evaluatedAt), post_raw_payload_hash: hash("d"),
    post_provenance: { existingPostSourceBinding: { version: EXISTING_POST_SOURCE_BINDING_VERSION,
      kind: "organic_post_binding", sourceRef: "source_persisted_post", sourceHash: hash("e"),
      postIdentityHash: hash("f"), objectStorySpecHash: hash("0") }, rawToken: "must_not_escape" }, post_media_type: "IMAGE",
    ad_set_id: adSetId, ad_set_status: "ACTIVE", ad_set_effective_status: "ACTIVE", campaign_id: campaignId,
    binding_payload: binding, binding_hash: binding.bindingHash, template_ref: template.templateRef,
    template_revision: template.revision, template_payload: template, template_hash: template.templateHash,
    preset_ref: preset.presetRef, preset_revision: preset.revision, preset_payload: preset, preset_hash: preset.presetHash,
    category_id: categoryId, category_ref: categoryRef, objective_ref: template.objectiveRef,
    budget_plan_ref: template.budget.budgetPlanVersionRef, budget_kind: template.budget.kind,
    budget_currency: template.budget.currency, budget_default: "1200.000000000000",
    timeframe_ref: template.timeframe.timeframeRef, schedule_mode: template.timeframe.scheduleMode,
    duration_days: template.timeframe.durationDays, ad_set_raw_payload_hash: hash("1"),
    campaign_raw_payload_hash: hash("2"), creative_binding_hash: null, ...overrides };
}

function repository(secondRows: readonly Record<string, unknown>[]) {
  const execute = vi.fn().mockResolvedValueOnce({ rows: [row()] }).mockResolvedValueOnce({ rows: secondRows });
  return { execute, resolver: new DrizzleExistingPostPromotionCanonicalMaterialResolver({ execute } as never) };
}
function resolve(resolver: DrizzleExistingPostPromotionCanonicalMaterialResolver, request = selection) {
  return resolver.resolve({ principal, selection: request, selectionHash: hash("9"), evaluatedAt });
}

describe("Drizzle existing-post canonical material resolver", () => {
  it("resolves exact tenant/public refs and retains only the typed persisted organic source binding", async () => {
    const api = repository([row()]); const value = await resolve(api.resolver);
    expect(value).toMatchObject({ accountRef, campaignRef, adSetRef, internalCategoryRefs: [categoryRef],
      template: { templateRef: selection.promotionTemplateRef }, preset: { presetRef: selection.audiencePresetRef },
      postBinding: { postRef, actorRef, sourceBinding: { kind: "organic_post_binding", sourceRef: "source_persisted_post",
        sourceHash: hash("e"), postIdentityHash: hash("f"), objectStorySpecHash: hash("0") } } });
    expect(JSON.stringify(value)).not.toContain("must_not_escape");
    expect(api.execute).toHaveBeenCalledTimes(2);
    const rendered = new PgDialect().sqlToQuery(api.execute.mock.calls[1]![0] as never).sql;
    expect(rendered).toMatch(/effective_event\.status = 'published'/);
    expect(rendered).toMatch(/effective_event\.published_template_hash = template\.template_hash/);
    expect(rendered).toMatch(/effective_event\.published_binding_hash = binding\.binding_hash/);
    expect(rendered).toMatch(/newer_event\.status in \('published', 'archived'\)/);
  });

  it("uses a persisted existing-ad binding hash without synthesizing a binding ref", async () => {
    const value = await resolve(repository([row({ creative_binding_hash: hash("7") })]).resolver);
    expect(value?.postBinding.sourceBinding).toEqual({ version: EXISTING_POST_SOURCE_BINDING_VERSION,
      kind: "existing_ad_binding", bindingRef: null, bindingHash: hash("7") });
  });

  it.each([
    ["missing provenance", { post_provenance: {} }],
    ["malformed source hash", { post_provenance: { existingPostSourceBinding: { version: EXISTING_POST_SOURCE_BINDING_VERSION,
      kind: "organic_post_binding", sourceRef: "source_persisted_post", sourceHash: "bad",
      postIdentityHash: hash("f"), objectStorySpecHash: hash("0") } } }],
    ["malformed raw hash", { post_raw_payload_hash: "bad" }],
    ["missing post content hash", { post_content_hash: null }],
    ["missing ad set snapshot hash", { ad_set_raw_payload_hash: null }],
    ["missing campaign snapshot hash", { campaign_raw_payload_hash: null }],
    ["malformed creative binding hash", { creative_binding_hash: "bad" }],
    ["unknown media", { post_media_type: "STORY" }],
    ["missing media", { post_media_type: null }],
  ])("returns null for %s", async (_label, override) => {
    await expect(resolve(repository([row(override)]).resolver)).resolves.toBeNull();
  });

  it("returns null when the second read no longer belongs to the preflight campaign hierarchy", async () => {
    const otherCampaign = "88888888-8888-4888-a888-888888888888";
    await expect(resolve(repository([row({ campaign_id: otherCampaign })]).resolver)).resolves.toBeNull();
  });

  it("returns null for distinct canonical candidates and for multiple creative binding hashes", async () => {
    await expect(resolve(repository([row(), row({ binding_hash: hash("8") })]).resolver)).resolves.toBeNull();
    await expect(resolve(repository([row({ creative_binding_hash: hash("6") }),
      row({ creative_binding_hash: hash("7") })]).resolver)).resolves.toBeNull();
    await expect(resolve(repository([row({ creative_binding_hash: hash("7") }),
      row({ creative_binding_hash: hash("7") })]).resolver)).resolves.toBeNull();
  });

  it("returns null for a cross-ref selection before the canonical query", async () => {
    const api = repository([row()]);
    const otherWorkspaceId = "99999999-9999-4999-a999-999999999999";
    await expect(resolve(api.resolver, { ...selection,
      postRef: promotionRegistryPublicRef("post", otherWorkspaceId, postId) })).resolves.toBeNull();
    expect(api.execute).toHaveBeenCalledTimes(1);
  });

  it("returns null on canonical candidate overflow", async () => {
    await expect(resolve(repository(Array.from({ length: 101 }, () => row())).resolver)).resolves.toBeNull();
  });
});
