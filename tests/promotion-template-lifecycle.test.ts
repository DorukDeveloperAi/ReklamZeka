import { describe, expect, it, vi } from "vitest";

import { nextAudiencePresetDraft, nextPromotionTemplateDraft, PromotionTemplateLifecycleService } from
  "@/application/promotion-template-lifecycle-service";
import { createAudiencePresetRevision, createPromotionTemplateBinding, createPromotionTemplateRevision } from
  "@/domain/meta/promotion/promotion-template";
import { publishAudiencePresetDraftMaterial } from "@/domain/meta/promotion/promotion-template-draft";
import { createPromotionTemplateLifecycleHttpHandlers } from "@/server/promotion-template-authoring-http";
import { AuthorizationError } from "@/security/authorization";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const workspaceRef = "workspace_test";
const at = "2026-08-09T22:00:00.000Z";
const origin = "http://localhost:3000";

function candidate(templateRef = "template_hair") {
  const preset = createAudiencePresetRevision({ version: "audience-preset/1.0.0", workspaceRef,
    presetRef: "audience_hair", revision: 1, aliases: ["Saç"], state: "published",
    source: { kind: "frozen_targeting_spec", sourceRef: "source_hair", targetingHash: "a".repeat(64),
      provenanceHash: "b".repeat(64) }, targeting: { geoRefs: ["geo_tr"], languages: ["language_tr"],
      ageMin: 25, ageMax: 55, inclusionRefs: ["interest_hair"], exclusionRefs: [] }, publishedAt: at });
  const template = createPromotionTemplateRevision({ version: "promotion-template/1.0.0", workspaceRef,
    templateRef, revision: 1, aliases: ["Saç"], state: "published", accountRefs: ["account_main"],
    actorTypes: ["instagram"], internalCategoryRefs: ["category_hair"], postTypes: ["image"],
    objectiveRef: "objective_leads", optimizationGoalRef: "optimization_leads", destinationRef: "destination_form",
    placementRefs: ["placement_feed"], namingRuleRef: "naming_default", trackingRuleRef: "tracking_default",
    adSetPolicy: "existing_only", audiencePreset: { presetRef: preset.presetRef, revision: preset.revision,
      presetHash: preset.presetHash }, budget: { ownerLevel: "adset", currency: "TRY", kind: "daily",
      defaultDecimal: "100", minimumDecimal: "50", maximumDecimal: "500", budgetPlanVersionRef: "budget_plan_v1" },
    timeframe: { timeframeRef: "timeframe_7d", scheduleMode: "fixed_duration", durationDays: 7 }, publishedAt: at });
  const binding = createPromotionTemplateBinding({ version: "promotion-template-binding/1.0.0", workspaceRef,
    bindingRef: `binding_${templateRef}`, template: { templateRef, revision: template.revision,
      templateHash: template.templateHash }, accountRef: "account_main",
    actor: { type: "instagram", actorRef: "actor_main" }, internalCategoryRefs: ["category_hair"], campaignRef: null,
    effectiveFrom: at, expiresAt: null }, template);
  return Object.freeze({ preset, template, binding });
}

describe("PromotionTemplate and AudiencePreset authoring lifecycle", () => {
  it("keeps draft material authority-free and free of published state/time until explicit publish", () => {
    const source = candidate();
    const draft = nextAudiencePresetDraft({ source: source.preset, current: null, alias: "Saç premium",
      actorRef: "actor_analyst", actorRole: "analyst", recordedAt: "2026-08-09T22:01:00.000Z" });
    expect(draft).toMatchObject({ status: "draft", published: null,
      material: { revision: 2, authority: { canAuthorizeAction: false, canWriteMeta: false } } });
    const serialized = JSON.stringify(draft.material);
    expect(serialized).not.toContain('"state":"published"');
    expect(serialized).not.toContain("publishedAt");
    const published = publishAudiencePresetDraftMaterial(draft.material, "2026-08-09T22:02:00.000Z");
    expect(published).toMatchObject({ state: "published", publishedAt: "2026-08-09T22:02:00.000Z", revision: 2 });
    const revised = nextAudiencePresetDraft({ source: null, current: draft, alias: "Saç premium v2",
      actorRef: "actor_analyst", actorRole: "analyst", recordedAt: "2026-08-09T22:03:00.000Z" });
    expect(revised.material.revision).toBe(draft.material.revision);
    expect(revised.lifecycleVersion).toBe(draft.lifecycleVersion + 1);
  });

  it("reuses one exact immutable preset across independent mutable template drafts", () => {
    const sourceA = candidate("template_hair_a"); const sourceB = candidate("template_hair_b");
    const first = nextPromotionTemplateDraft({ source: sourceA, current: null, preset: sourceA.preset,
      alias: "Şablon A", actorRef: "actor_analyst", actorRole: "analyst", recordedAt: "2026-08-09T22:03:00.000Z" });
    const second = nextPromotionTemplateDraft({ source: sourceB, current: null, preset: sourceA.preset,
      alias: "Şablon B", actorRef: "actor_analyst", actorRole: "analyst", recordedAt: "2026-08-09T22:04:00.000Z" });
    for (const draft of [first, second]) {
      expect(draft.preset).toMatchObject({ presetRef: sourceA.preset.presetRef, revision: sourceA.preset.revision,
        presetHash: sourceA.preset.presetHash });
      expect(draft.templateMaterial.audiencePreset).toEqual({ presetRef: sourceA.preset.presetRef,
        revision: sourceA.preset.revision, presetHash: sourceA.preset.presetHash });
      expect(JSON.stringify(draft.templateMaterial)).not.toContain("publishedAt");
      expect(draft.published).toBeNull();
    }
    expect(first.templateRef).not.toBe(second.templateRef);
  });

  it("allows analyst draft but rejects analyst publication before repository mutation", async () => {
    const state = { registryHash: "c".repeat(64), presetCurrent: [], presetHistory: [],
      templateCurrent: [], templateHistory: [] } as const;
    const repository = { inspect: vi.fn(async () => state), mutate: vi.fn(async () => ({ state,
      auditAppended: true as const, contextInvalidationAppended: false, publishedMaterial: false })) };
    const catalog = { listPublished: vi.fn(async () => [candidate()]) };
    const service = new PromotionTemplateLifecycleService(repository, catalog, [{ workspaceId, userId, role: "analyst" }]);
    const principal = { workspaceId, workspaceRef, actor: { userId }, readerRef: "actor_analyst" };
    await expect(service.mutate(principal, { operation: "publish_preset", expectedRegistryHash: state.registryHash,
      presetRef: "audience_hair", expectedLifecycleVersion: 1, expectedRecordHash: "d".repeat(64),
      expectedPresetRevision: 2, expectedPresetHash: "e".repeat(64), reasonCode: "owner_publish" }))
      .rejects.toBeInstanceOf(AuthorizationError);
    expect(repository.mutate).not.toHaveBeenCalled();
  });

  it("projects only bounded OCC summaries and never exposes preset targeting or template material", async () => {
    const source = candidate();
    const preset = nextAudiencePresetDraft({ source: source.preset, current: null, alias: "Yeni alias",
      actorRef: "actor_analyst", actorRole: "analyst", recordedAt: "2026-08-09T22:05:00.000Z" });
    const state = { registryHash: "c".repeat(64), presetCurrent: [preset], presetHistory: [preset],
      templateCurrent: [], templateHistory: [] } as const;
    const service = new PromotionTemplateLifecycleService({ inspect: vi.fn(async () => state),
      mutate: vi.fn() }, { listPublished: vi.fn() }, [{ workspaceId, userId, role: "analyst" }]);
    const inspected = await service.inspect({ workspaceId, workspaceRef, actor: { userId }, readerRef: "actor_analyst" });
    expect(inspected.presetCurrent[0]).toEqual({ presetRef: preset.presetRef, lifecycleVersion: 1,
      recordHash: preset.recordHash, status: "draft", presetRevision: preset.material.revision,
      presetMaterialHash: preset.material.materialHash, publishedPresetHash: null, actorRole: "analyst",
      reasonCode: "preset_draft_created", recordedAt: "2026-08-09T22:05:00.000Z" });
    const serialized = JSON.stringify(inspected);
    expect(serialized).not.toContain("targeting");
    expect(serialized).not.toContain("aliases");
    expect(serialized).not.toContain("source_hair");
  });

  it("keeps lifecycle mutation cookie-only, same-origin and intent-partitioned", async () => {
    const state = { registryHash: "c".repeat(64), presetCurrent: [], presetHistory: [],
      templateCurrent: [], templateHistory: [] } as const;
    const service = { inspect: vi.fn(async () => ({ contractVersion: "promotion-template-lifecycle-service/1.0.0",
      ...state, authority: { canRead: true, canDraft: true, canRevise: true, canPublish: false, canArchive: false,
        canAuthorizeAction: false, canExecuteWrite: false, canWriteMeta: false, canGrantApproval: false } })),
    mutate: vi.fn(async () => ({ contractVersion: "promotion-template-lifecycle-service/1.0.0", state,
      auditAppended: true as const, contextInvalidationAppended: false, publishedMaterial: false,
      authority: { canRead: true, canDraft: true, canRevise: true, canPublish: false, canArchive: false,
        canAuthorizeAction: false, canExecuteWrite: false, canWriteMeta: false, canGrantApproval: false } })) };
    const principal = { workspaceId, workspaceRef, actor: { userId }, readerRef: "actor_analyst" };
    const resolvePrincipal = vi.fn(async () => principal);
    const api = createPromotionTemplateLifecycleHttpHandlers({ service: service as never, origin, resolvePrincipal });
    const headers = { Host: "localhost:3000", Origin: origin, "Sec-Fetch-Site": "same-origin",
      Cookie: "__Host-rzka_local_session=opaque", "Content-Type": "application/json",
      "X-ReklamZeka-Intent": "promotion-template-lifecycle-draft" };
    const command = { operation: "create_preset_draft", expectedRegistryHash: state.registryHash,
      selection: { scopeRef: null, postType: null, instruction: null }, alias: "Yeni preset" };
    const response = await api.POST(new Request(`${origin}/api/promotion-template-authoring`, { method: "POST", headers,
      body: JSON.stringify({ command }) }));
    expect(response.status).toBe(200); expect(response.headers.get("x-reklamzeka-meta-write")).toBe("disabled");
    expect(service.mutate).toHaveBeenCalledTimes(1);
    for (const unsafe of [
      new Request(`${origin}/api/promotion-template-authoring`, { method: "POST", headers: { ...headers,
        Authorization: "Bearer forged" }, body: JSON.stringify({ command }) }),
      new Request(`${origin}/api/promotion-template-authoring`, { method: "POST", headers: { ...headers,
        Origin: "https://attacker.invalid" }, body: JSON.stringify({ command }) }),
      new Request(`${origin}/api/promotion-template-authoring`, { method: "POST", headers: { ...headers,
        "X-ReklamZeka-Intent": "promotion-template-lifecycle-publish" }, body: JSON.stringify({ command }) }),
    ]) expect((await api.POST(unsafe)).status).toBe(400);
    expect(resolvePrincipal).toHaveBeenCalledTimes(1);
  });
});
