import { describe, expect, it, vi } from "vitest";

import type { ExistingPostPromotionCanonicalMaterial } from
  "@/application/existing-post-promotion-canonical-submitter";
import { ExistingPostPromotionProtectionEvidenceMaterializer } from
  "@/application/existing-post-promotion-protection-evidence-materializer";
import { ACTION_APPROVAL_POLICY_VERSION } from "@/domain/actions/approval-lifecycle";
import { EXISTING_POST_SOURCE_BINDING_VERSION } from "@/domain/actions/autonomy-valve";
import { AUDIENCE_PRESET_VERSION, PROMOTION_TEMPLATE_BINDING_VERSION, PROMOTION_TEMPLATE_VERSION,
  createAudiencePresetRevision, createPromotionTemplateBinding, createPromotionTemplateRevision } from
  "@/domain/meta/promotion/promotion-template";
import { ExistingPostPromotionPolicyAdapter } from "@/server/existing-post-promotion-policy-adapter";

const h = (value: string) => value.repeat(64).slice(0, 64);
const now = "2026-08-07T12:00:00.000Z";
const principal = Object.freeze({ actor: Object.freeze({ userId: "11111111-1111-4111-a111-111111111111" }),
  workspaceId: "22222222-2222-4222-a222-222222222222", workspaceRef: "workspace_alpha",
  readerRef: "actor_local_owner" });

function material(): ExistingPostPromotionCanonicalMaterial {
  const preset = createAudiencePresetRevision({ version: AUDIENCE_PRESET_VERSION, workspaceRef: principal.workspaceRef,
    presetRef: "audience_turkey", revision: 1, aliases: ["Türkiye"], state: "published",
    source: { kind: "meta_saved_audience", sourceRef: "saved_audience_tr", targetingHash: h("1"), provenanceHash: h("2") },
    targeting: { geoRefs: ["geo_turkey"], languages: ["language_tr"], ageMin: 25, ageMax: 55,
      inclusionRefs: ["interest_health"], exclusionRefs: [] }, publishedAt: "2026-08-07T10:00:00.000Z" });
  const template = createPromotionTemplateRevision({ version: PROMOTION_TEMPLATE_VERSION,
    workspaceRef: principal.workspaceRef, templateRef: "promotion_lead_tr", revision: 1, aliases: ["TR lead"],
    state: "published", accountRefs: ["account_doruk"], actorTypes: ["instagram"],
    internalCategoryRefs: ["category_hair"], postTypes: ["image"], objectiveRef: "objective_leads",
    optimizationGoalRef: "optimization_leads", destinationRef: "destination_lead_form",
    placementRefs: ["placement_feed"], namingRuleRef: "naming_default", trackingRuleRef: "tracking_default",
    adSetPolicy: "existing_only", audiencePreset: { presetRef: preset.presetRef, revision: preset.revision,
      presetHash: preset.presetHash }, budget: { ownerLevel: "adset", currency: "TRY", kind: "daily",
      defaultDecimal: "1000", minimumDecimal: "500", maximumDecimal: "2000", budgetPlanVersionRef: "budget_plan_v1" },
    timeframe: { timeframeRef: "timeframe_week", scheduleMode: "fixed_duration", durationDays: 7 },
    publishedAt: "2026-08-07T10:01:00.000Z" });
  const binding = createPromotionTemplateBinding({ version: PROMOTION_TEMPLATE_BINDING_VERSION,
    workspaceRef: principal.workspaceRef, bindingRef: "promotion_binding_main",
    template: { templateRef: template.templateRef, revision: template.revision, templateHash: template.templateHash },
    accountRef: "account_doruk", actor: { type: "instagram", actorRef: "actor_doruk_ig" },
    internalCategoryRefs: ["category_hair"], campaignRef: "campaign_leads",
    effectiveFrom: "2026-08-07T10:02:00.000Z", expiresAt: "2026-08-07T14:00:00.000Z" }, template);
  return Object.freeze({ template, preset, binding, accountRef: "account_doruk", campaignRef: "campaign_leads",
    eligibility: { workspaceId: principal.workspaceId, adAccountExternalId: "act_masked",
      requestedActor: { type: "instagram" as const, externalId: "ig_masked" }, post: { identity: "known" as const,
        externalPostId: "post_masked", actorExternalId: "ig_masked", lifecycle: "published" as const, contentHash: h("a") },
      ownership: { adAccount: "confirmed" as const, actor: "confirmed" as const }, permission: "confirmed" as const,
      capabilities: { actorAdvertising: "supported" as const, postPromotion: "supported" as const } },
    postBinding: { verification: "verified" as const, sourceType: "existing_post" as const, postRef: "post_existing",
      actorRef: "actor_doruk_ig", actorType: "instagram" as const, postType: "image" as const,
      sourceBinding: { version: EXISTING_POST_SOURCE_BINDING_VERSION, kind: "organic_post_binding" as const,
        sourceRef: "source_instagram_post", sourceHash: h("b"), postIdentityHash: h("3"), objectStorySpecHash: h("4") } },
    adSetRef: "adset_leads", destinationRef: template.destinationRef, budgetPlanVersionRef: "budget_plan_v1",
    internalCategoryRefs: ["category_hair"], adSetSnapshotHash: h("c"), campaignSnapshotHash: h("d") });
}

function harness(overrides: Readonly<{ membershipRole?: "owner" | "admin" | "analyst" | "viewer";
  notBefore?: string | null; workspaceRule?: boolean; killSwitch?: boolean; disposition?: "allowed" | "denied" | "unresolved" }> = {}) {
  const category = { resolveCandidates: vi.fn(async (scope) => [Object.freeze({ sourceKind: "effective_category_context",
    workspaceId: principal.workspaceId, workspaceRef: principal.workspaceRef, accountRef: "account_doruk",
    campaignRef: "campaign_leads", entity: scope.entity, capturedAt: "2026-08-07T11:30:00.000Z",
    contextHash: h("e"), categoryRefs: ["category_hair"], sourceRevisions: [{ sourceRef: "category_source",
      revision: 1, sourceHash: h("f") }] })]) };
  const geo = { resolveCandidates: vi.fn(async (scope) => [Object.freeze({ sourceKind: "canonical_meta_affected_geo_snapshot",
    workspaceId: principal.workspaceId, workspaceRef: principal.workspaceRef, accountRef: "account_doruk",
    campaignRef: "campaign_leads", entity: scope.entity, capturedAt: "2026-08-07T11:45:00.000Z",
    geoRefs: ["geo_turkey"], sourceRevisions: [{ sourceRef: "geo_source", revision: 1, sourceHash: h("0") }] })]) };
  const approval = { resolveExistingPostPolicy: vi.fn(async () => ({ policy: { version: ACTION_APPROVAL_POLICY_VERSION,
    policyRef: "approval_policy_main", revision: 2, autonomyMode: "approval_only", requesterRoles: ["owner", "admin", "analyst"],
    approverRoles: [{ risk: "K4", roles: ["owner", "admin"] }], grantConsumerRoles: ["owner"],
    separationOfDutiesRisks: ["K4"], maximumProposalLifetimeSeconds: 3_600, maximumGrantLifetimeSeconds: 300 },
    policyHash: h("1"), source: { workspaceRef: principal.workspaceRef, policyRef: "approval_policy_main", revision: 2,
      canonicalHash: h("2"), applicability: { actionType: "existing_post_promotion", risk: "K4" },
      definitionId: "33333333-3333-4333-a333-333333333333", effectiveFrom: "2026-08-07T10:00:00.000Z",
      expiresAt: "2026-08-07T13:30:00.000Z" } })) };
  const autonomy = { resolve: vi.fn(async () => overrides.workspaceRule === false ? [] : [{ ruleRef: "autonomy_workspace",
    workspaceRef: principal.workspaceRef, scope: { level: "workspace" as const, ref: principal.workspaceRef },
    mode: "approval_only" as const, state: "published" as const, effectiveFrom: "2026-08-07T10:00:00.000Z",
    expiresAt: "2026-08-07T12:45:00.000Z", killSwitch: overrides.killSwitch ?? false, maximumActionsPerRun: 1 }]) };
  const protection = { resolve: vi.fn(async (input) => ({ version: "protection-resolution/1.0.0" as const,
    workspaceRef: principal.workspaceRef, evaluatedAt: now, actionHash: input.action.actionHash,
    actionType: "existing_post_promotion" as const, disposition: overrides.disposition ?? "allowed", reasonCodes: [],
    protectedInternalCategoryRefs: [], affectedGeoRefs: ["geo_turkey"], protectedGeoRefs: [],
    categoryEvidenceHash: h("3"), affectedGeoEvidenceHash: h("4"), evaluationContextHash: h("5"), policySetHash: h("6"),
    policyEvidence: [{ policyRef: "guardrail_existing_post", revision: 2, canonicalHash: h("7"),
      expiresAt: "2026-08-07T12:30:00.000Z", clauseRefs: [] }], capabilities: { canApprove: false as const,
      canExecute: false as const, canWriteMeta: false as const, canGrantApproval: false as const }, resolutionHash: h("8") })) };
  const memberships = { resolve: vi.fn(async () => ({ userId: principal.actor.userId, workspaceId: principal.workspaceId,
    role: overrides.membershipRole ?? "owner" })) };
  const freshness = { resolveNotBefore: vi.fn(async () => overrides.notBefore === undefined
    ? "2026-08-07T11:00:00.000Z" : overrides.notBefore) };
  return { approval, autonomy, protection, memberships, freshness, category, geo,
    adapter: new ExistingPostPromotionPolicyAdapter(approval as never, autonomy,
      new ExistingPostPromotionProtectionEvidenceMaterializer(category, geo), protection as never, memberships, freshness) };
}

describe("existing-post production policy composition", () => {
  it("binds requester, shared action hash, authentic evidence and the earliest reviewed expiry", async () => {
    const api = harness();
    const resolved = await api.adapter.resolve({ principal, material: material(), evaluatedAt: now });
    expect(resolved).toMatchObject({ requester: { actorRef: principal.readerRef, role: "owner" },
      proposalExpiresAt: "2026-08-07T12:30:00.000Z", protection: { changeDisposition: "allowed",
        affectedGeoRefs: ["geo_turkey"] } });
    expect(resolved?.protection.policyRefs).toEqual(["guardrail_existing_post", `protection_resolution_${h("8").slice(0, 24)}`]);
    expect(api.protection.resolve).toHaveBeenCalledWith(expect.objectContaining({ action: expect.objectContaining({
      actionType: "existing_post_promotion", accountRef: "account_doruk", campaignRef: "campaign_leads",
      entity: { level: "adset", ref: "adset_leads" }, actionHash: expect.stringMatching(/^[a-f0-9]{64}$/) }) }));
    expect(JSON.stringify(resolved)).not.toContain(principal.workspaceId);
  });

  it.each(["owner", "admin", "analyst"] as const)("maps an active %s membership to the requester", async (membershipRole) => {
    await expect(harness({ membershipRole }).adapter.resolve({ principal, material: material(), evaluatedAt: now }))
      .resolves.toMatchObject({ requester: { role: membershipRole } });
  });

  it("fails closed before protection for viewer, absent workspace rule, kill switch or missing freshness", async () => {
    for (const overrides of [{ membershipRole: "viewer" as const }, { workspaceRule: false }, { killSwitch: true },
      { notBefore: null }]) {
      const api = harness(overrides);
      await expect(api.adapter.resolve({ principal, material: material(), evaluatedAt: now })).resolves.toBeNull();
      expect(api.protection.resolve).not.toHaveBeenCalled();
    }
  });

  it.each(["denied", "unresolved"] as const)("does not expose a %s guardrail resolution as proposal policy", async (disposition) => {
    const api = harness({ disposition });
    await expect(api.adapter.resolve({ principal, material: material(), evaluatedAt: now })).resolves.toBeNull();
  });

  it("fails closed on cross-workspace material with no registry or evidence access", async () => {
    const api = harness(); const candidate = material();
    await expect(api.adapter.resolve({ principal, material: { ...candidate,
      template: { ...candidate.template, workspaceRef: "workspace_other" } }, evaluatedAt: now })).resolves.toBeNull();
    expect(api.memberships.resolve).not.toHaveBeenCalled(); expect(api.approval.resolveExistingPostPolicy).not.toHaveBeenCalled();
    expect(api.category.resolveCandidates).not.toHaveBeenCalled(); expect(api.geo.resolveCandidates).not.toHaveBeenCalled();
  });
});
