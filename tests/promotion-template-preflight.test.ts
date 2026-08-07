import { describe, expect, it } from "vitest";

import { ExistingPostPromotionPreflightService } from "@/application/existing-post-promotion-preflight";
import { ACTION_APPROVAL_POLICY_VERSION } from "@/domain/actions/approval-lifecycle";
import { EXISTING_POST_SOURCE_BINDING_VERSION, type ActionValveContext, type AutonomyRule } from "@/domain/actions/autonomy-valve";
import {
  AUDIENCE_PRESET_VERSION,
  PROMOTION_TEMPLATE_BINDING_VERSION,
  PROMOTION_TEMPLATE_VERSION,
  createAudiencePresetRevision,
  createPromotionTemplateBinding,
  createPromotionTemplateRevision,
} from "@/domain/meta/promotion/promotion-template";

const h = (character: string) => character.repeat(64);
function registry() {
  const preset = createAudiencePresetRevision({
    version: AUDIENCE_PRESET_VERSION, workspaceRef: "workspace_alpha", presetRef: "audience_turkey", revision: 1,
    aliases: ["Türkiye sağlık kitlesi"], state: "published",
    source: { kind: "meta_saved_audience", sourceRef: "saved_audience_tr", targetingHash: h("1"), provenanceHash: h("2") },
    targeting: { geoRefs: ["geo_turkey"], languages: ["language_tr"], ageMin: 25, ageMax: 55,
      inclusionRefs: ["interest_health"], exclusionRefs: ["audience_existing_patient"] },
    publishedAt: "2026-08-07T18:00:00.000Z",
  });
  const template = createPromotionTemplateRevision({
    version: PROMOTION_TEMPLATE_VERSION, workspaceRef: "workspace_alpha", templateRef: "promotion_lead_tr", revision: 3,
    aliases: ["TR lead gönderi öne çıkarma"], state: "published", accountRefs: ["account_doruk"],
    actorTypes: ["instagram", "page"], internalCategoryRefs: ["category_health_lead"], postTypes: ["image", "reel"],
    objectiveRef: "objective_leads", optimizationGoalRef: "optimization_lead", destinationRef: "destination_lead_form",
    placementRefs: ["placement_automatic"], namingRuleRef: "naming_standard", trackingRuleRef: "tracking_standard",
    adSetPolicy: "existing_only", audiencePreset: { presetRef: preset.presetRef, revision: preset.revision, presetHash: preset.presetHash },
    budget: { ownerLevel: "adset", currency: "TRY", kind: "daily", defaultDecimal: "1000.00",
      minimumDecimal: "500", maximumDecimal: "2000", budgetPlanVersionRef: "budget_plan_v3" },
    timeframe: { timeframeRef: "timeframe_rolling_7d", scheduleMode: "continuous", durationDays: null },
    publishedAt: "2026-08-07T18:05:00.000Z",
  });
  const binding = createPromotionTemplateBinding({
    version: PROMOTION_TEMPLATE_BINDING_VERSION, workspaceRef: "workspace_alpha", bindingRef: "promotion_binding_main",
    template: { templateRef: template.templateRef, revision: template.revision, templateHash: template.templateHash },
    accountRef: "account_doruk", actor: { type: "instagram", actorRef: "actor_doruk_ig" },
    internalCategoryRefs: ["category_health_lead"], campaignRef: "campaign_health_tr",
    effectiveFrom: "2026-08-07T18:06:00.000Z", expiresAt: null,
  }, template);
  return { preset, template, binding };
}

const rule: AutonomyRule = {
  ruleRef: "autonomy_workspace", workspaceRef: "workspace_alpha", scope: { level: "workspace", ref: "workspace_alpha" },
  mode: "approval_only", state: "published", effectiveFrom: "2026-08-01T00:00:00.000Z", expiresAt: null,
  killSwitch: false, maximumActionsPerRun: null,
};
function context(): ActionValveContext {
  return {
    workspaceRef: "workspace_alpha", accountGroupRef: null, accountRef: "account_doruk",
    internalCategoryRefs: ["category_health_lead"], campaignRef: "campaign_health_tr",
    entity: { level: "adset", ref: "adset_health_tr" }, evaluatedAt: "2026-08-07T18:10:00.000Z",
    rules: [rule], budgetLimits: null,
    protection: { protectedInternalCategoryRefs: [], affectedGeoRefs: ["geo_turkey"], protectedGeoRefs: [],
      changeDisposition: "allowed", policyRefs: [] },
  };
}
function input() {
  const values = registry();
  return {
    ...values,
    eligibility: {
      workspaceId: "workspace-db-id", adAccountExternalId: "act-external",
      requestedActor: { type: "instagram" as const, externalId: "ig-external" },
      post: { identity: "known" as const, externalPostId: "post-external", actorExternalId: "ig-external",
        lifecycle: "published" as const, contentHash: h("a") },
      ownership: { adAccount: "confirmed" as const, actor: "confirmed" as const }, permission: "confirmed" as const,
      capabilities: { actorAdvertising: "supported" as const, postPromotion: "supported" as const },
    },
    postBinding: { verification: "verified" as const, sourceType: "existing_post" as const,
      postRef: "post_doruk_ig", actorRef: "actor_doruk_ig", actorType: "instagram" as const, postType: "image" as const,
      sourceBinding: { version: EXISTING_POST_SOURCE_BINDING_VERSION, kind: "organic_post_binding" as const,
        sourceRef: "source_instagram_post", sourceHash: h("b"), postIdentityHash: h("6"), objectStorySpecHash: h("7") } },
    adSetRef: "adset_health_tr", destinationRef: "destination_lead_form", budgetPlanVersionRef: "budget_plan_v3",
    internalCategoryRefs: ["category_health_lead"],
    plan: { planRef: "plan_promotion", revision: 1, planHash: h("c") },
    requester: { actorRef: "actor_operator", role: "operator" as const },
    proposedAt: "2026-08-07T18:11:00.000Z", expiresAt: "2026-08-07T20:11:00.000Z", actionContext: context(),
    summary: { safety: "public_safe" as const, before: { label: "Önce", value: "Yalnız organik gönderi" },
      after: { label: "Sonra", value: "Onay bekleyen mevcut gönderi reklam taslağı" },
      evidence: [{ evidenceRef: "evidence_post_verified", label: "Gönderi ve actor doğrulandı" }] },
  };
}
const policy = {
  version: ACTION_APPROVAL_POLICY_VERSION, policyRef: "policy_promotion", revision: 1,
  autonomyMode: "approval_only" as const, requesterRoles: ["operator" as const],
  approverRoles: [{ risk: "K4" as const, roles: ["owner" as const] }], grantConsumerRoles: ["owner" as const],
  separationOfDutiesRisks: ["K4" as const], maximumProposalLifetimeSeconds: 86_400,
  maximumGrantLifetimeSeconds: 300,
};

describe("PromotionTemplate + AudiencePreset core", () => {
  it("normalizes immutable revisions and binds account, actor, category and campaign", () => {
    const first = registry();
    const replay = registry();
    expect(replay.preset.presetHash).toBe(first.preset.presetHash);
    expect(replay.template.templateHash).toBe(first.template.templateHash);
    expect(replay.binding.bindingHash).toBe(first.binding.bindingHash);
    expect(Object.isFrozen(first.template.budget)).toBe(true);
    expect(first.template).toMatchObject({ budget: { ownerLevel: "adset", currency: "TRY", kind: "daily" },
      timeframe: { timeframeRef: "timeframe_rolling_7d" } });
  });

  it("rejects audience overlap, account mismatch and unbound actor", () => {
    const { preset, template } = registry();
    const { presetHash: _presetHash, ...presetInput } = preset;
    expect(() => createAudiencePresetRevision({ ...presetInput, targeting: { ...preset.targeting,
      exclusionRefs: ["interest_health"] } })).toThrow();
    expect(() => createPromotionTemplateBinding({
      version: PROMOTION_TEMPLATE_BINDING_VERSION, workspaceRef: "workspace_alpha", bindingRef: "binding_invalid",
      template: { templateRef: template.templateRef, revision: template.revision, templateHash: template.templateHash },
      accountRef: "account_other", actor: { type: "instagram", actorRef: "actor_other" }, internalCategoryRefs: [],
      campaignRef: null, effectiveFrom: "2026-08-07T18:06:00.000Z", expiresAt: null,
    }, template)).toThrow();
  });
});

describe("existing-post promotion preflight", () => {
  it("creates only a K4 approval-required placeholder with all capabilities false", () => {
    const result = new ExistingPostPromotionPreflightService(policy).preflight(input());
    const actionPlan = result.proposal.summaries[0]!.actionPlan;
    expect(actionPlan).toMatchObject({ actionType: "existing_post_promotion", risk: "K4",
      disposition: "approval_required", capabilities: { canExecute: false, canWriteMeta: false,
        canGrantApproval: false, canAccessRawGraph: false } });
    expect(actionPlan.action).toMatchObject({ placeholderOnly: true, postContentHash: h("a"),
      sourceBinding: { kind: "organic_post_binding", sourceHash: h("b"), postIdentityHash: h("6"), objectStorySpecHash: h("7") },
      promotionTemplateVersionRef: `promotion_template_version_${input().template.templateHash.slice(0, 24)}`,
      audiencePresetVersionRef: `audience_preset_version_${input().preset.presetHash.slice(0, 24)}`,
      timeframeRef: "timeframe_rolling_7d", scheduleMode: "continuous", durationDays: null });
    expect(result).toMatchObject({ creativeGeneration: "disabled", capabilities: { canExecute: false,
      canWriteMeta: false, canGenerateCreative: false, canChangeTargeting: false, canGrantApproval: false } });
    expect(result.preflightHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("normalizes the v1 creative binding input only as an existing-ad compatibility binding", () => {
    const legacy = input();
    const result = new ExistingPostPromotionPreflightService(policy).preflight({
      ...legacy,
      postBinding: {
        verification: "verified", sourceType: "existing_post", postRef: legacy.postBinding.postRef,
        actorRef: legacy.postBinding.actorRef, actorType: legacy.postBinding.actorType, postType: legacy.postBinding.postType,
        creativeBindingRef: "creative_binding_legacy", creativeBindingHash: h("9"),
      },
    });
    expect(result.proposal.summaries[0]!.actionPlan.action).toMatchObject({
      sourceBinding: { version: EXISTING_POST_SOURCE_BINDING_VERSION, kind: "existing_ad_binding",
        bindingRef: "creative_binding_legacy", bindingHash: h("9") },
    });
    expect(result.proposal.summaries[0]!.actionPlan.action).not.toHaveProperty("creativeBindingHash");
  });

  it("is stable and changes when the frozen post/source/template evidence changes", () => {
    const service = new ExistingPostPromotionPreflightService(policy);
    const first = service.preflight(input());
    expect(service.preflight(input()).preflightHash).toBe(first.preflightHash);
    const contentChanged = input();
    expect(service.preflight({ ...contentChanged, eligibility: { ...contentChanged.eligibility,
      post: { ...contentChanged.eligibility.post, contentHash: h("e") } } }).preflightHash)
      .not.toBe(first.preflightHash);
    const changed = input();
    const sourceChanged = service.preflight({ ...changed,
      postBinding: { ...changed.postBinding, sourceBinding: { ...changed.postBinding.sourceBinding, objectStorySpecHash: h("d") } } });
    expect(sourceChanged.preflightHash).not.toBe(first.preflightHash);
    expect(sourceChanged.proposal.summaries[0]!.actionHash)
      .not.toBe(first.proposal.summaries[0]!.actionHash);
    const revisionChanged = input();
    const { templateHash: _templateHash, ...templateInput } = revisionChanged.template;
    const nextTemplate = createPromotionTemplateRevision({ ...templateInput, revision: 4 });
    const { bindingHash: _bindingHash, ...bindingInput } = revisionChanged.binding;
    const nextBinding = createPromotionTemplateBinding({
      ...bindingInput,
      template: { templateRef: nextTemplate.templateRef, revision: nextTemplate.revision, templateHash: nextTemplate.templateHash },
    }, nextTemplate);
    const next = service.preflight({ ...revisionChanged, template: nextTemplate, binding: nextBinding });
    expect((next.proposal.summaries[0]!.actionPlan.action as { promotionTemplateVersionRef: string }).promotionTemplateVersionRef)
      .not.toBe((first.proposal.summaries[0]!.actionPlan.action as { promotionTemplateVersionRef: string }).promotionTemplateVersionRef);
    expect(next.preflightHash).not.toBe(first.preflightHash);
  });

  it("fails closed for unknown post eligibility, actor/category mismatch and creative-generation injection", () => {
    const service = new ExistingPostPromotionPreflightService(policy);
    const unknown = input();
    expect(() => service.preflight({ ...unknown, eligibility: { ...unknown.eligibility,
      capabilities: { ...unknown.eligibility.capabilities, postPromotion: "unknown" as const } } })).toThrow();
    const actor = input();
    expect(() => service.preflight({ ...actor, postBinding: { ...actor.postBinding, actorRef: "actor_other" } })).toThrow();
    const injected = input();
    expect(() => service.preflight({ ...injected, postBinding: { ...injected.postBinding,
      generateCreative: true } } as never)).toThrow();
  });
});
