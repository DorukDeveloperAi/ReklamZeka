import { describe, expect, it, vi } from "vitest";

import { ExistingPostPromotionProposalService } from "@/application/existing-post-promotion-proposal-service";
import { ExistingPostPromotionPreflightService, type ExistingPostPromotionPreflightInput,
  type VerifiedExistingPostBinding } from "@/application/existing-post-promotion-preflight";
import { ACTION_APPROVAL_POLICY_VERSION, type ApprovalPolicy } from "@/domain/actions/approval-lifecycle";
import { EXISTING_POST_SOURCE_BINDING_VERSION } from "@/domain/actions/autonomy-valve";
import {
  AUDIENCE_PRESET_VERSION, PROMOTION_TEMPLATE_BINDING_VERSION, PROMOTION_TEMPLATE_VERSION,
  createAudiencePresetRevision, createPromotionTemplateBinding, createPromotionTemplateRevision,
} from "@/domain/meta/promotion/promotion-template";

const h = (value: string) => value.repeat(64).slice(0, 64);
const policy: ApprovalPolicy = {
  version: ACTION_APPROVAL_POLICY_VERSION, policyRef: "policy_promotion", revision: 1,
  autonomyMode: "approval_only", requesterRoles: ["operator"],
  approverRoles: [{ risk: "K4", roles: ["owner", "admin"] }], grantConsumerRoles: ["owner"],
  separationOfDutiesRisks: ["K4"], maximumProtectionEvidenceAgeSeconds: 3_600,
  maximumProposalLifetimeSeconds: 86_400,
  maximumGrantLifetimeSeconds: 300,
};

function fixture(): ExistingPostPromotionPreflightInput {
  const preset = createAudiencePresetRevision({
    version: AUDIENCE_PRESET_VERSION, workspaceRef: "workspace_alpha", presetRef: "audience_turkey", revision: 1,
    aliases: ["Türkiye"], state: "published", source: { kind: "meta_saved_audience", sourceRef: "saved_audience_tr",
      targetingHash: h("1"), provenanceHash: h("2") }, targeting: { geoRefs: ["geo_turkey"], languages: ["language_tr"],
      ageMin: 25, ageMax: 55, inclusionRefs: ["interest_health"], exclusionRefs: [] },
    publishedAt: "2026-08-07T10:00:00.000Z",
  });
  const template = createPromotionTemplateRevision({
    version: PROMOTION_TEMPLATE_VERSION, workspaceRef: "workspace_alpha", templateRef: "promotion_lead_tr", revision: 1,
    aliases: ["TR lead"], state: "published", accountRefs: ["account_doruk"], actorTypes: ["instagram"],
    internalCategoryRefs: ["category_hair"], postTypes: ["image"], objectiveRef: "objective_leads",
    optimizationGoalRef: "optimization_leads", destinationRef: "destination_lead_form",
    placementRefs: ["placement_feed"], namingRuleRef: "naming_default", trackingRuleRef: "tracking_default",
    adSetPolicy: "existing_only", audiencePreset: { presetRef: preset.presetRef, revision: preset.revision,
      presetHash: preset.presetHash }, budget: { ownerLevel: "adset", currency: "TRY", kind: "daily",
      defaultDecimal: "1000", minimumDecimal: "500", maximumDecimal: "2000", budgetPlanVersionRef: "budget_plan_v1" },
    timeframe: { timeframeRef: "timeframe_week", scheduleMode: "fixed_duration", durationDays: 7 },
    publishedAt: "2026-08-07T10:01:00.000Z",
  });
  const binding = createPromotionTemplateBinding({
    version: PROMOTION_TEMPLATE_BINDING_VERSION, workspaceRef: "workspace_alpha", bindingRef: "promotion_binding_main",
    template: { templateRef: template.templateRef, revision: template.revision, templateHash: template.templateHash },
    accountRef: "account_doruk", actor: { type: "instagram", actorRef: "actor_doruk_ig" },
    internalCategoryRefs: ["category_hair"], campaignRef: "campaign_leads",
    effectiveFrom: "2026-08-07T10:02:00.000Z", expiresAt: null,
  }, template);
  return {
    template, preset, binding,
    eligibility: { workspaceId: "11111111-1111-4111-a111-111111111111", adAccountExternalId: "act_masked",
      requestedActor: { type: "instagram", externalId: "ig_masked" },
      post: { identity: "known", externalPostId: "post_masked", actorExternalId: "ig_masked", lifecycle: "published", contentHash: h("a") },
      ownership: { adAccount: "confirmed", actor: "confirmed" }, permission: "confirmed",
      capabilities: { actorAdvertising: "supported", postPromotion: "supported" } },
    postBinding: { verification: "verified", sourceType: "existing_post", postRef: "post_existing",
      actorRef: "actor_doruk_ig", actorType: "instagram", postType: "image",
      sourceBinding: { version: EXISTING_POST_SOURCE_BINDING_VERSION, kind: "organic_post_binding",
        sourceRef: "source_instagram_post", sourceHash: h("b"), postIdentityHash: h("6"), objectStorySpecHash: h("7") } },
    adSetRef: "adset_leads", destinationRef: "destination_lead_form", budgetPlanVersionRef: "budget_plan_v1",
    internalCategoryRefs: ["category_hair"], plan: { planRef: "plan_promotion", revision: 1, planHash: h("c") },
    requester: { actorRef: "user_operator", role: "operator" }, proposedAt: "2026-08-07T11:00:00.000Z",
    expiresAt: "2026-08-07T12:00:00.000Z", actionContext: { workspaceRef: "workspace_alpha", accountGroupRef: null,
      accountRef: "account_doruk", internalCategoryRefs: ["category_hair"], campaignRef: "campaign_leads",
      entity: { level: "adset", ref: "adset_leads" }, evaluatedAt: "2026-08-07T11:00:00.000Z", rules: [],
      budgetLimits: null, protection: { protectedInternalCategoryRefs: [], affectedGeoRefs: [], protectedGeoRefs: [],
        changeDisposition: "allowed", policyRefs: [] } },
    summary: { safety: "public_safe", before: { label: "Önce", value: "Mevcut gönderi" },
      after: { label: "Sonra", value: "K4 reklam önerisi" },
      evidence: [{ evidenceRef: "evidence_post", label: "Gönderi doğrulandı" }] },
  };
}

describe("ExistingPostPromotionProposalService", () => {
  it("persists one approval-required K4 unit and returns no action authority", async () => {
    const appendInitial = vi.fn(async (candidate) => ({ outcome: "inserted" as const,
      lifecycleHash: candidate.lifecycle.traceHash }));
    const service = new ExistingPostPromotionProposalService(new ExistingPostPromotionPreflightService(policy), { appendInitial });
    const result = await service.submit(fixture());
    expect(appendInitial).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ outcome: "inserted", disposition: "approval_required", risk: "K4",
      authority: { canApprove: false, canExecute: false, canWriteMeta: false, canGenerateCreative: false,
        canChangeTargeting: false } });
    const staged = appendInitial.mock.calls[0]![0];
    expect(staged.summaries[0]!.actionPlan.action).toMatchObject({
      sourceBinding: { kind: "organic_post_binding", sourceHash: h("b"), postIdentityHash: h("6"), objectStorySpecHash: h("7") },
      timeframeRef: "timeframe_week", scheduleMode: "fixed_duration", durationDays: 7 });
    expect(staged.summaries[0]!.actionPlan.action).not.toHaveProperty("creativeBindingHash");
  });

  it("replays idempotently and source changes cannot reuse the old proposal", async () => {
    const seen = new Set<string>();
    const appendInitial = vi.fn(async (candidate) => {
      const ref = candidate.lifecycle.bundle.bundleRef;
      const outcome = seen.has(ref) ? "unchanged" as const : "inserted" as const;
      seen.add(ref);
      return { outcome, lifecycleHash: candidate.lifecycle.traceHash };
    });
    const service = new ExistingPostPromotionProposalService(new ExistingPostPromotionPreflightService(policy), { appendInitial });
    const first = await service.submit(fixture());
    expect((await service.submit(fixture())).outcome).toBe("unchanged");
    const changed = fixture();
    const sourceBinding = (changed.postBinding as VerifiedExistingPostBinding).sourceBinding;
    if (sourceBinding.kind !== "organic_post_binding") throw new Error("organic fixture expected");
    const next = await service.submit({ ...changed,
      postBinding: { ...changed.postBinding, sourceBinding: {
        ...sourceBinding, objectStorySpecHash: h("d") } } });
    expect(next.proposalRef).not.toBe(first.proposalRef);
    expect(next.preflightRef).not.toBe(first.preflightRef);
  });

  it("fails closed on persistence failure and exposes no partial result", async () => {
    const service = new ExistingPostPromotionProposalService(new ExistingPostPromotionPreflightService(policy), {
      appendInitial: vi.fn(async () => { throw new Error("database detail"); }),
    });
    await expect(service.submit(fixture())).rejects.toMatchObject({ code: "persistence_failed",
      message: "Mevcut gönderi öne çıkarma önerisi güvenli biçimde kaydedilemedi" });
  });
});
