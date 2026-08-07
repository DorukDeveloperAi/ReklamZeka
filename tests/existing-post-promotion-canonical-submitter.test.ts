import { describe, expect, it, vi } from "vitest";
import { ExistingPostPromotionCanonicalSubmitter, existingPostPromotionEvidenceSelectionHash, existingPostPromotionSelectionHash,
  type ExistingPostPromotionCanonicalMaterial, type ExistingPostPromotionPolicyResolution } from "@/application/existing-post-promotion-canonical-submitter";
import { ACTION_APPROVAL_POLICY_VERSION } from "@/domain/actions/approval-lifecycle";
import { EXISTING_POST_SOURCE_BINDING_VERSION } from "@/domain/actions/autonomy-valve";
import { META_COMPATIBILITY_DIMENSIONS, type MetaCompatibilityResolution } from "@/domain/meta/promotion/compatibility-artifact";
import { AUDIENCE_PRESET_VERSION, PROMOTION_TEMPLATE_BINDING_VERSION, PROMOTION_TEMPLATE_VERSION,
  createAudiencePresetRevision, createPromotionTemplateBinding, createPromotionTemplateRevision } from "@/domain/meta/promotion/promotion-template";

const h = (value: string) => value.repeat(64).slice(0, 64); const now = "2026-08-07T12:00:00.000Z";
const principal = { actor: { userId: "user_owner" }, workspaceId: "11111111-1111-4111-a111-111111111111",
  workspaceRef: "workspace_alpha", readerRef: "actor_local_owner" } as const;
const selection = { accountRef: "account_doruk", adSetRef: "adset_leads", actorRef: "actor_doruk_ig", postRef: "post_existing",
  promotionTemplateRef: "promotion_lead_tr", audiencePresetRef: "audience_turkey", budgetPlanRef: "budget_plan_v1",
  timeframeRef: "timeframe_week", objectiveRef: "objective_leads", internalCategoryRef: "category_hair" } as const;

function material(): ExistingPostPromotionCanonicalMaterial {
  const preset = createAudiencePresetRevision({ version: AUDIENCE_PRESET_VERSION, workspaceRef: principal.workspaceRef,
    presetRef: selection.audiencePresetRef, revision: 1, aliases: ["Türkiye"], state: "published",
    source: { kind: "meta_saved_audience", sourceRef: "saved_audience_tr", targetingHash: h("1"), provenanceHash: h("2") },
    targeting: { geoRefs: ["geo_turkey"], languages: ["language_tr"], ageMin: 25, ageMax: 55,
      inclusionRefs: ["interest_health"], exclusionRefs: [] }, publishedAt: "2026-08-07T10:00:00.000Z" });
  const template = createPromotionTemplateRevision({ version: PROMOTION_TEMPLATE_VERSION, workspaceRef: principal.workspaceRef,
    templateRef: selection.promotionTemplateRef, revision: 1, aliases: ["TR lead"], state: "published",
    accountRefs: [selection.accountRef], actorTypes: ["instagram"], internalCategoryRefs: [selection.internalCategoryRef],
    postTypes: ["image"], objectiveRef: selection.objectiveRef, optimizationGoalRef: "optimization_leads",
    destinationRef: "destination_lead_form", placementRefs: ["placement_feed"], namingRuleRef: "naming_default",
    trackingRuleRef: "tracking_default", adSetPolicy: "existing_only", audiencePreset: { presetRef: preset.presetRef,
      revision: preset.revision, presetHash: preset.presetHash }, budget: { ownerLevel: "adset", currency: "TRY", kind: "daily",
      defaultDecimal: "1000", minimumDecimal: "500", maximumDecimal: "2000", budgetPlanVersionRef: selection.budgetPlanRef },
    timeframe: { timeframeRef: selection.timeframeRef, scheduleMode: "fixed_duration", durationDays: 7 },
    publishedAt: "2026-08-07T10:01:00.000Z" });
  const binding = createPromotionTemplateBinding({ version: PROMOTION_TEMPLATE_BINDING_VERSION, workspaceRef: principal.workspaceRef,
    bindingRef: "promotion_binding_main", template: { templateRef: template.templateRef, revision: template.revision,
      templateHash: template.templateHash }, accountRef: selection.accountRef,
    actor: { type: "instagram", actorRef: selection.actorRef }, internalCategoryRefs: [selection.internalCategoryRef],
    campaignRef: "campaign_leads", effectiveFrom: "2026-08-07T10:02:00.000Z", expiresAt: null }, template);
  return Object.freeze({ template, preset, binding, accountRef: selection.accountRef, campaignRef: "campaign_leads",
    eligibility: { workspaceId: principal.workspaceId, adAccountExternalId: "act_masked", requestedActor: { type: "instagram" as const, externalId: "ig_masked" },
      post: { identity: "known" as const, externalPostId: "post_masked", actorExternalId: "ig_masked", lifecycle: "published" as const, contentHash: h("a") },
      ownership: { adAccount: "confirmed" as const, actor: "confirmed" as const }, permission: "confirmed" as const,
      capabilities: { actorAdvertising: "supported" as const, postPromotion: "supported" as const } },
    postBinding: { verification: "verified" as const, sourceType: "existing_post" as const, postRef: selection.postRef, actorRef: selection.actorRef,
      actorType: "instagram" as const, postType: "image" as const, sourceBinding: { version: EXISTING_POST_SOURCE_BINDING_VERSION,
        kind: "organic_post_binding" as const, sourceRef: "source_instagram_post", sourceHash: h("b"),
        postIdentityHash: h("3"), objectStorySpecHash: h("4") } }, adSetRef: selection.adSetRef,
    destinationRef: template.destinationRef, budgetPlanVersionRef: selection.budgetPlanRef,
    internalCategoryRefs: [selection.internalCategoryRef], adSetSnapshotHash: h("c"), campaignSnapshotHash: h("d") });
}
function compatibility(hash: string, status: "confirmed" | "unknown" | "rejected" = "confirmed"): MetaCompatibilityResolution {
  return { selectionHash: hash, dimensions: META_COMPATIBILITY_DIMENSIONS.map((dimension, index) => ({ dimension, status,
    reasonCode: `compatibility.${status}`, evidenceHash: status === "confirmed" ? h(String(index + 5)) : null })),
    overallStatus: status, authority: { canExecute: false, canWriteMeta: false, canGrantApproval: false,
      canCreatePolicy: false, canPromoteGuidance: false } };
}
function policy(): ExistingPostPromotionPolicyResolution { return {
  approvalPolicy: { version: ACTION_APPROVAL_POLICY_VERSION, policyRef: "approval_policy_published", revision: 4,
    autonomyMode: "approval_only", requesterRoles: ["owner"], approverRoles: [{ risk: "K4", roles: ["owner", "admin"] }],
    grantConsumerRoles: ["owner"], separationOfDutiesRisks: ["K4"], maximumGrantLifetimeSeconds: 300 },
  rules: [{ ruleRef: "autonomy_workspace_reviewed", workspaceRef: principal.workspaceRef,
    scope: { level: "workspace", ref: principal.workspaceRef }, mode: "approval_only", state: "published",
    effectiveFrom: "2026-08-07T10:00:00.000Z", expiresAt: null, killSwitch: false, maximumActionsPerRun: 1 }],
  protection: { protectedInternalCategoryRefs: [], affectedGeoRefs: [], protectedGeoRefs: [], changeDisposition: "allowed",
    policyRefs: ["protection_policy_published"] }, requester: { actorRef: principal.readerRef, role: "owner" },
  proposalExpiresAt: "2026-08-07T13:00:00.000Z" } as const; }
function harness(patches: { compatibility?: "confirmed" | "unknown" | "rejected"; policy?: ExistingPostPromotionPolicyResolution | null;
  material?: ExistingPostPromotionCanonicalMaterial | null } = {}) {
  const queue = { appendInitial: vi.fn(async (candidate) => ({ outcome: "inserted" as const, lifecycleHash: candidate.lifecycle.traceHash })) };
  const materialPort = { resolve: vi.fn(async () => patches.material === undefined ? material() : patches.material) };
  const compatibilityPort = { resolve: vi.fn(async (hash: string) => compatibility(hash, patches.compatibility)) };
  const policyPort = { resolve: vi.fn(async () => patches.policy === undefined ? policy() : patches.policy) };
  return { queue, materialPort, compatibilityPort, policyPort,
    submitter: new ExistingPostPromotionCanonicalSubmitter(materialPort, compatibilityPort, policyPort, queue, () => new Date(now)) };
}

describe("existing-post canonical materializer submit port", () => {
  it("binds exact ten refs, immutable provenance and five real compatibility evidence hashes before one K4 queue write", async () => {
    const api = harness(); const canonical = material(); const result = await api.submitter.submitResolved({ principal, selection });
    expect(result).toMatchObject({ outcome: "inserted", risk: "K4", disposition: "approval_required",
      authority: { canApprove: false, canExecute: false, canWriteMeta: false, canGenerateCreative: false, canChangeTargeting: false } });
    expect(api.materialPort.resolve).toHaveBeenCalledWith(expect.objectContaining({ principal, selection,
      selectionHash: existingPostPromotionSelectionHash(selection), evaluatedAt: now }));
    expect(api.compatibilityPort.resolve).toHaveBeenCalledWith(
      existingPostPromotionEvidenceSelectionHash(existingPostPromotionSelectionHash(selection), canonical), now);
    expect(api.queue.appendInitial).toHaveBeenCalledTimes(1);
    const staged = api.queue.appendInitial.mock.calls[0]![0];
    expect(staged.lifecycle.policy).toMatchObject({ policyRef: "approval_policy_published", revision: 4 });
    expect(staged.lifecycle.bundle.units[0]!.expiresAt).toBe("2026-08-07T13:00:00.000Z");
    expect(staged.summaries[0]!.summary.evidence).toEqual(META_COMPATIBILITY_DIMENSIONS.map((dimension, index) => ({
      evidenceRef: `compatibility_evidence_${h(String(index + 5)).slice(0, 24)}`, label: `${dimension} uyumluluğu doğrulandı` })));
    expect(staged.summaries[0]!.actionPlan.action).toMatchObject({ sourceBinding: { kind: "organic_post_binding",
      sourceHash: h("b"), postIdentityHash: h("3"), objectStorySpecHash: h("4") }, timeframeRef: selection.timeframeRef,
      budgetPlanVersionRef: selection.budgetPlanRef });
  });

  it.each(["unknown", "rejected"] as const)("fails closed on %s compatibility with zero policy and queue writes", async (status) => {
    const api = harness({ compatibility: status });
    await expect(api.submitter.submitResolved({ principal, selection })).rejects.toMatchObject({ code: "compatibility_unconfirmed" });
    expect(api.policyPort.resolve).not.toHaveBeenCalled(); expect(api.queue.appendInitial).not.toHaveBeenCalled();
  });

  it("requires a published approval/protection policy resolution and performs zero queue writes when absent", async () => {
    const api = harness({ policy: null });
    await expect(api.submitter.submitResolved({ principal, selection })).rejects.toMatchObject({ code: "policy_unavailable" });
    expect(api.queue.appendInitial).not.toHaveBeenCalled();
  });

  it("fails closed when protection is unresolved and performs zero queue writes", async () => {
    const api = harness({ policy: { ...policy(), protection: { ...policy().protection,
      changeDisposition: "unresolved", policyRefs: [] } } });
    await expect(api.submitter.submitResolved({ principal, selection })).rejects.toMatchObject({ code: "policy_unavailable" });
    expect(api.queue.appendInitial).not.toHaveBeenCalled();
  });

  it("does not treat the action-valve default as policy when no active published workspace rule exists", async () => {
    const api = harness({ policy: { ...policy(), rules: [] } });
    await expect(api.submitter.submitResolved({ principal, selection })).rejects.toMatchObject({ code: "policy_unavailable" });
    expect(api.queue.appendInitial).not.toHaveBeenCalled();
  });

  it.each([
    ["template", (value: ExistingPostPromotionCanonicalMaterial) => ({ ...value, template: { ...value.template, templateHash: h("e") } })],
    ["preset", (value: ExistingPostPromotionCanonicalMaterial) => ({ ...value, preset: { ...value.preset, presetHash: h("f") } })],
    ["binding", (value: ExistingPostPromotionCanonicalMaterial) => ({ ...value, binding: { ...value.binding, bindingHash: h("0") } })],
    ["post content", (value: ExistingPostPromotionCanonicalMaterial) => ({ ...value,
      eligibility: { ...value.eligibility, post: { ...value.eligibility.post, contentHash: h("1") } } })],
    ["source binding", (value: ExistingPostPromotionCanonicalMaterial) => ({ ...value, postBinding: { ...value.postBinding,
      sourceBinding: { ...value.postBinding.sourceBinding, sourceHash: h("2") } } })],
    ["ad set snapshot", (value: ExistingPostPromotionCanonicalMaterial) => ({ ...value, adSetSnapshotHash: h("3") })],
    ["campaign snapshot", (value: ExistingPostPromotionCanonicalMaterial) => ({ ...value, campaignSnapshotHash: h("4") })],
  ] as const)("does not accept old compatibility evidence after the %s hash changes", async (_label, mutate) => {
    const baseline = material(); const oldEvidenceHash = existingPostPromotionEvidenceSelectionHash(
      existingPostPromotionSelectionHash(selection), baseline);
    const changed = mutate(baseline) as ExistingPostPromotionCanonicalMaterial;
    const queue = { appendInitial: vi.fn() }; const compatibilityPort = { resolve: vi.fn(async () => compatibility(oldEvidenceHash)) };
    const submitter = new ExistingPostPromotionCanonicalSubmitter({ resolve: vi.fn(async () => changed) }, compatibilityPort,
      { resolve: vi.fn(async () => policy()) }, queue as never, () => new Date(now));
    await expect(submitter.submitResolved({ principal, selection })).rejects.toMatchObject({ code: "compatibility_unconfirmed" });
    expect(compatibilityPort.resolve).toHaveBeenCalledWith(
      existingPostPromotionEvidenceSelectionHash(existingPostPromotionSelectionHash(selection), changed), now);
    expect(queue.appendInitial).not.toHaveBeenCalled();
  });

  it("rejects missing canonical source material before compatibility or queue access", async () => {
    const api = harness({ material: null });
    await expect(api.submitter.submitResolved({ principal, selection })).rejects.toMatchObject({ code: "material_unavailable" });
    expect(api.compatibilityPort.resolve).not.toHaveBeenCalled(); expect(api.queue.appendInitial).not.toHaveBeenCalled();
  });

  it("rejects a missing canonical snapshot hash before compatibility lookup", async () => {
    const api = harness({ material: { ...material(), campaignSnapshotHash: "" } });
    await expect(api.submitter.submitResolved({ principal, selection })).rejects.toMatchObject({ code: "material_unavailable" });
    expect(api.compatibilityPort.resolve).not.toHaveBeenCalled(); expect(api.queue.appendInitial).not.toHaveBeenCalled();
  });
});
