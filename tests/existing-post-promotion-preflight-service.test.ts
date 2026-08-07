import { describe, expect, it, vi } from "vitest";

import {
  ExistingPostPromotionPublicPreflightError,
  ExistingPostPromotionPublicPreflightService,
  type ExistingPostPromotionPreflightContext,
  type ExistingPostPromotionPreflightRepository,
  type ExistingPostPromotionPreflightRequest,
} from "@/application/existing-post-promotion-preflight-service";

const workspaceId = "11111111-1111-4111-a111-111111111111";
const principal = Object.freeze({ actor: Object.freeze({ userId: "user_owner" }), workspaceId, workspaceRef: "workspace_local", readerRef: "reader_owner" });
const selection: ExistingPostPromotionPreflightRequest = Object.freeze({
  accountRef: "account_primary", actorRef: "actor_instagram", postRef: "post_existing",
  promotionTemplateRef: "template_messages", audiencePresetRef: "audience_doruk",
  budgetPlanRef: "budget_safe", timeframeRef: "timeframe_week", objectiveRef: "objective_messages",
  internalCategoryRef: "category_healthcare",
});

function context(): ExistingPostPromotionPreflightContext {
  return {
    workspaceId, workspaceRef: "workspace_local",
    account: { ref: selection.accountRef, externalId: "act_123456", ownership: "confirmed" },
    actor: {
      ref: selection.actorRef, type: "instagram", externalId: "178414000000001",
      ownership: "confirmed", permission: "confirmed", advertisingCapability: "supported",
    },
    post: {
      ref: selection.postRef, actorRef: selection.actorRef, identity: "known", externalPostId: "179000000000001",
      actorExternalId: "178414000000001", lifecycle: "published", contentHash: "a".repeat(64), promotionCapability: "supported",
    },
    template: {
      ref: selection.promotionTemplateRef, state: "active", requiredAudiencePresetRef: selection.audiencePresetRef,
      accountRefs: [selection.accountRef], actorRefs: [selection.actorRef], internalCategoryRefs: [selection.internalCategoryRef],
      objectiveRefs: [selection.objectiveRef], actorTypes: ["instagram"],
      budgetKinds: ["daily"], currencies: ["TRY"], minimumBudgetMinor: 10_000, maximumBudgetMinor: 100_000,
      minimumDurationDays: 3, maximumDurationDays: 30,
      compatibility: { destination: "confirmed", optimization: "confirmed", placement: "confirmed", specialCategory: "confirmed", tracking: "confirmed" },
    },
    audiencePreset: {
      ref: selection.audiencePresetRef, state: "active", accountRefs: [selection.accountRef], actorTypes: ["instagram"],
      internalCategoryRefs: [selection.internalCategoryRef],
    },
    budgetPlan: { ref: selection.budgetPlanRef, state: "active", kind: "daily", currency: "TRY", amountMinor: 25_000 },
    timeframe: { ref: selection.timeframeRef, state: "active", startAt: "2026-08-10T00:00:00.000Z", endAt: "2026-08-17T00:00:00.000Z", timezone: "Europe/Istanbul" },
    objective: { ref: selection.objectiveRef, state: "active" },
    internalCategory: { ref: selection.internalCategoryRef, state: "active" },
    guidance: [{
      guidanceRef: "guidance_stable", state: "active", disposition: "allow", reasonCode: "guidance.allowed",
      objectiveRefs: [selection.objectiveRef], internalCategoryRefs: [selection.internalCategoryRef],
    }],
  };
}

function service(value = context()) {
  const repository: ExistingPostPromotionPreflightRepository = { resolve: vi.fn(async () => value) };
  return { repository, service: new ExistingPostPromotionPublicPreflightService(repository) };
}

describe("existing-post promotion preflight service", () => {
  it("returns only a public-safe ephemeral K4 approval preview for an owned existing post", async () => {
    const result = await service().service.evaluate(principal, selection);
    expect(result).toMatchObject({
      status: "ready_for_approval_proposal", reasons: [],
      proposalPreview: {
        previewRef: expect.stringMatching(/^promotion_preview_[a-f0-9]{20}$/),
        actionType: "existing_post_promotion", risk: "K4", disposition: "approval_required",
        actorType: "instagram", postFingerprintRef: expect.stringMatching(/^post_fingerprint_[a-f0-9]{16}$/),
        budget: { kind: "daily", currency: "TRY", amountMinor: 25_000 },
        timeframe: { durationDays: 7 },
      },
      authority: { ephemeral: true, canPersistProposal: false, canApprove: false, canExecute: false, canWriteMeta: false, canGenerateCreative: false },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("act_123456");
    expect(serialized).not.toContain("178414000000001");
    expect(serialized).not.toContain("179000000000001");
    expect(serialized).not.toContain("a".repeat(64));
    expect(serialized).not.toMatch(/targeting|headline|primaryText|imageUrl|videoUrl|access_token|Bearer/i);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("validates Page actors with the same ownership and post binding rules", async () => {
    const value = context();
    const page: ExistingPostPromotionPreflightContext = {
      ...value,
      actor: { ...value.actor, type: "page", ref: "actor_page", externalId: "101000000001" },
      post: { ...value.post, actorRef: "actor_page", actorExternalId: "101000000001" },
      template: { ...value.template, actorTypes: ["page"], actorRefs: ["actor_page"] },
      audiencePreset: { ...value.audiencePreset, actorTypes: ["page"] },
    };
    const selected = { ...selection, actorRef: "actor_page" };
    expect(await service(page).service.evaluate(principal, selected)).toMatchObject({
      status: "ready_for_approval_proposal", proposalPreview: { actorType: "page", risk: "K4" },
    });
  });

  it("blocks ownership, actor/post mismatch, objective, audience, budget, timeframe and guidance incompatibilities", async () => {
    const value = context();
    const blocked: ExistingPostPromotionPreflightContext = {
      ...value,
      account: { ...value.account, ownership: "rejected" },
      post: { ...value.post, actorRef: "actor_other" },
      template: { ...value.template, requiredAudiencePresetRef: "audience_other", accountRefs: [], actorRefs: [], internalCategoryRefs: [],
        objectiveRefs: ["objective_other"], maximumBudgetMinor: 20_000, maximumDurationDays: 5 },
      audiencePreset: { ...value.audiencePreset, accountRefs: [], internalCategoryRefs: [] },
      guidance: [{ guidanceRef: "guidance_block", state: "active", disposition: "block", reasonCode: "guidance.geo_fixed",
        objectiveRefs: [selection.objectiveRef], internalCategoryRefs: [selection.internalCategoryRef] }],
    };
    const result = await service(blocked).service.evaluate(principal, selection);
    expect(result.status).toBe("blocked");
    expect(result.proposalPreview).toBeNull();
    expect(result.reasons.map((item) => item.code)).toEqual(expect.arrayContaining([
      "binding.post_actor_mismatch", "meta.ad_account_not_owned", "template.objective_incompatible",
      "template.audience_preset_incompatible", "template.account_incompatible", "template.actor_ref_incompatible", "template.category_incompatible",
      "audience_preset.account_incompatible", "audience_preset.category_incompatible",
      "template.budget_out_of_bounds", "template.timeframe_out_of_bounds", "guidance.geo_fixed",
    ]));
  });

  it("keeps unknown capability or review-required guidance fail-closed without a proposal", async () => {
    const value = context();
    const unresolved: ExistingPostPromotionPreflightContext = {
      ...value,
      actor: { ...value.actor, permission: "unknown" },
      template: { ...value.template, compatibility: { ...value.template.compatibility, tracking: "unknown" } },
      guidance: [{ guidanceRef: "guidance_review", state: "active", disposition: "review_required", reasonCode: "guidance.owner_review",
        objectiveRefs: [selection.objectiveRef], internalCategoryRefs: [selection.internalCategoryRef] }],
    };
    const result = await service(unresolved).service.evaluate(principal, selection);
    expect(result.status).toBe("unknown");
    expect(result.proposalPreview).toBeNull();
    expect(result.reasons).toEqual(expect.arrayContaining([
      { code: "meta.permission_unknown", source: "meta_eligibility", disposition: "unknown" },
      { code: "template.tracking_unknown", source: "template", disposition: "unknown" },
      { code: "guidance.owner_review", source: "guidance", disposition: "unknown" },
    ]));
  });

  it("rejects raw targeting/creative/body fields and caller workspace overrides before repository access", async () => {
    const setup = service();
    for (const bad of [
      { ...selection, targeting: { countries: ["TR"] } },
      { ...selection, creative: { text: "new ad" } },
      { ...selection, body: "raw copy" },
      { ...selection, workspaceId },
      { ...selection, accountRef: "*" },
    ]) await expect(setup.service.evaluate(principal, bad as never)).rejects.toEqual(expect.objectContaining({ code: "invalid_input" }));
    expect(setup.repository.resolve).not.toHaveBeenCalled();
  });

  it("fails closed on cross-workspace sources and redacts repository failures", async () => {
    const crossed = context();
    await expect(service({ ...crossed, workspaceId: "22222222-2222-4222-a222-222222222222" }).service.evaluate(principal, selection))
      .rejects.toEqual(expect.objectContaining({ code: "unsafe_source" }));
    const broken = new ExistingPostPromotionPublicPreflightService({ resolve: async () => { throw new Error("private token and graph payload"); } });
    await expect(broken.evaluate(principal, selection)).rejects.toEqual(expect.objectContaining<Partial<ExistingPostPromotionPublicPreflightError>>({
      code: "source_unavailable", message: "Mevcut gönderi öne çıkarma ön kontrolü güvenli biçimde tamamlanamadı",
    }));
  });

  it("rejects repository payload extensions such as raw targeting or creative material", async () => {
    const value = context();
    await expect(service({
      ...value,
      post: { ...value.post, rawPayload: { targeting: {}, creativeBody: "unsafe" } },
    } as never).service.evaluate(principal, selection)).rejects.toEqual(expect.objectContaining({ code: "unsafe_source" }));
  });
});
