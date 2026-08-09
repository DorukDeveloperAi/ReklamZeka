import { describe, expect, it, vi } from "vitest";

import {
  PromotionTemplateSelectorService,
  type PublishedPromotionTemplateCatalog,
} from "@/application/promotion-template-selector-service";
import {
  PROMOTION_TEMPLATE_SELECTOR_VERSION,
  PromotionTemplateSelectorError,
  dryRunPromotionTemplateSelection,
  type PromotionTemplateSelectorCandidate,
  type PromotionTemplateSelectorInput,
} from "@/domain/meta/promotion/promotion-template-selector";
import {
  AUDIENCE_PRESET_VERSION,
  PROMOTION_TEMPLATE_BINDING_VERSION,
  PROMOTION_TEMPLATE_VERSION,
  createAudiencePresetRevision,
  createPromotionTemplateBinding,
  createPromotionTemplateRevision,
} from "@/domain/meta/promotion/promotion-template";

const workspaceRef = "workspace_selector";
const evaluatedAt = "2026-08-09T15:00:00.000Z";

function candidate(input: Readonly<{
  suffix: string;
  templateAliases?: readonly string[];
  presetAliases?: readonly string[];
  accountRef?: string;
  actorType?: "page" | "instagram";
  actorRef?: string;
  categoryRef?: string;
  postType?: "image" | "video" | "carousel" | "reel";
  publishedAt?: string;
}>): PromotionTemplateSelectorCandidate {
  const accountRef = input.accountRef ?? "account_doruk";
  const actorType = input.actorType ?? "instagram";
  const actorRef = input.actorRef ?? "actor_doruk_ig";
  const categoryRef = input.categoryRef ?? "category_hair";
  const postType = input.postType ?? "image";
  const preset = createAudiencePresetRevision({
    version: AUDIENCE_PRESET_VERSION,
    workspaceRef,
    presetRef: `audience_${input.suffix}`,
    revision: 2,
    aliases: input.presetAliases ?? ["Türkiye sağlık kitlesi"],
    state: "published",
    source: {
      kind: "frozen_targeting_spec",
      sourceRef: `source_${input.suffix}`,
      targetingHash: "a".repeat(64),
      provenanceHash: "b".repeat(64),
    },
    targeting: {
      geoRefs: ["geo_turkey"],
      languages: ["language_tr"],
      ageMin: 25,
      ageMax: 55,
      inclusionRefs: ["interest_health"],
      exclusionRefs: [],
    },
    publishedAt: input.publishedAt ?? "2026-08-09T14:00:00.000Z",
  });
  const template = createPromotionTemplateRevision({
    version: PROMOTION_TEMPLATE_VERSION,
    workspaceRef,
    templateRef: `template_${input.suffix}`,
    revision: 4,
    aliases: input.templateAliases ?? ["Saç ekimi gönderisini öne çıkar"],
    state: "published",
    accountRefs: [accountRef],
    actorTypes: [actorType],
    internalCategoryRefs: [categoryRef],
    postTypes: [postType],
    objectiveRef: "objective_messages",
    optimizationGoalRef: "optimization_conversations",
    destinationRef: "destination_instagram",
    placementRefs: ["placement_automatic"],
    namingRuleRef: "naming_standard",
    trackingRuleRef: "tracking_standard",
    adSetPolicy: "existing_only",
    audiencePreset: { presetRef: preset.presetRef, revision: preset.revision, presetHash: preset.presetHash },
    budget: {
      ownerLevel: "adset",
      currency: "TRY",
      kind: "daily",
      defaultDecimal: "1000",
      minimumDecimal: "500",
      maximumDecimal: "2000",
      budgetPlanVersionRef: "budget_plan_v4",
    },
    timeframe: { timeframeRef: "timeframe_seven_days", scheduleMode: "fixed_duration", durationDays: 7 },
    publishedAt: input.publishedAt ?? "2026-08-09T14:01:00.000Z",
  });
  const binding = createPromotionTemplateBinding({
    version: PROMOTION_TEMPLATE_BINDING_VERSION,
    workspaceRef,
    bindingRef: `binding_${input.suffix}`,
    template: { templateRef: template.templateRef, revision: template.revision, templateHash: template.templateHash },
    accountRef,
    actor: { type: actorType, actorRef },
    internalCategoryRefs: [categoryRef],
    campaignRef: null,
    effectiveFrom: "2026-08-09T14:02:00.000Z",
    expiresAt: null,
  }, template);
  return { preset, template, binding };
}

function request(overrides: Partial<PromotionTemplateSelectorInput> = {}): PromotionTemplateSelectorInput {
  return {
    version: PROMOTION_TEMPLATE_SELECTOR_VERSION,
    workspaceRef,
    evaluatedAt,
    accountRef: "account_doruk",
    actor: { type: "instagram", actorRef: "actor_doruk_ig" },
    internalCategoryRefs: ["category_hair"],
    postType: "image",
    instruction: "Saç ekimi gönderisini öne çıkar",
    ...overrides,
  };
}

describe("PromotionTemplate deterministic selector dry-run", () => {
  it("recommends one published immutable template/preset pair independent of catalog order", () => {
    const selected = candidate({ suffix: "hair" });
    const incompatible = candidate({ suffix: "page", actorType: "page", actorRef: "actor_doruk_page" });
    const first = dryRunPromotionTemplateSelection(request(), [incompatible, selected]);
    const replay = dryRunPromotionTemplateSelection(structuredClone(request()), [selected, incompatible]);

    expect(first).toEqual(replay);
    expect(first).toMatchObject({
      status: "recommended",
      dryRunOnly: true,
      publishReady: true,
      recommendation: {
        promotionTemplate: { templateRef: "template_hair", revision: 4 },
        audiencePreset: { presetRef: "audience_hair", revision: 2 },
      },
      capabilities: {
        canPublish: false,
        canPersist: false,
        canWriteMeta: false,
        canChangeTargeting: false,
        canGenerateCreative: false,
        canProposeAction: false,
        canGrantApproval: false,
      },
    });
    expect(first.questions).toEqual([]);
    expect(first.selectionHash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(first)).not.toContain("targeting");
    expect(JSON.stringify(first)).not.toContain("interest_health");
    expect(Object.isFrozen(first.recommendation)).toBe(true);

    expect(dryRunPromotionTemplateSelection(request({ instruction: "Türkiye sağlık kitlesi" }), [selected]))
      .toMatchObject({ status: "recommended", recommendation: { audiencePreset: { presetRef: "audience_hair" } } });
  });

  it("fails closed with explicit questions for unknown facts, aliases and unsupported targeting/creative requests", () => {
    const selected = candidate({ suffix: "hair" });
    const unknown = dryRunPromotionTemplateSelection(request({ actor: null, postType: null }), [selected]);
    expect(unknown).toMatchObject({ status: "unresolved", publishReady: false, recommendation: null });
    expect(unknown.questions.map((entry) => entry.code)).toEqual(["actor_required", "post_type_required"]);

    const aliasUnknown = dryRunPromotionTemplateSelection(request({ instruction: "Bilinmeyen büyüme şablonu" }), [selected]);
    expect(aliasUnknown.questions).toContainEqual(expect.objectContaining({ code: "alias_not_recognized" }));
    expect(aliasUnknown.recommendation).toBeNull();

    for (const instruction of ["Saç ekimi gönderisinde hedeflemeyi değiştir", "Saç ekimi için yeni görsel üret"]) {
      const blocked = dryRunPromotionTemplateSelection(request({ instruction }), [selected]);
      expect(blocked).toMatchObject({ status: "unresolved", publishReady: false, recommendation: null,
        capabilities: { canChangeTargeting: false, canGenerateCreative: false } });
      expect(blocked.reasons).toContainEqual(expect.objectContaining({ code: "unsupported_instruction" }));
    }
  });

  it("does not invent a winner when equal aliases resolve to multiple published versions", () => {
    const first = candidate({ suffix: "hair_a", templateAliases: ["Saç ekimi"] });
    const second = candidate({ suffix: "hair_b", templateAliases: ["Saç ekimi"] });
    const ambiguous = dryRunPromotionTemplateSelection(request({ instruction: "Saç ekimi" }), [second, first]);
    expect(ambiguous).toMatchObject({ status: "ambiguous", publishReady: false, recommendation: null });
    expect(ambiguous.questions).toEqual([
      expect.objectContaining({ code: "selector_ambiguous", field: "instruction" }),
    ]);
    expect(ambiguous.reasons).toContainEqual(expect.objectContaining({ code: "equal_ranked_match", candidateCount: 2 }));
  });

  it("rejects forged registry documents and malformed selector material before recommending", () => {
    const selected = candidate({ suffix: "hair" });
    expect(() => dryRunPromotionTemplateSelection(request(), [{
      ...selected,
      template: { ...selected.template, templateHash: "f".repeat(64) },
    }])).toThrow(PromotionTemplateSelectorError);
    expect(() => dryRunPromotionTemplateSelection({ ...request(), unexpected: true } as PromotionTemplateSelectorInput, [selected]))
      .toThrow(PromotionTemplateSelectorError);
    expect(() => dryRunPromotionTemplateSelection(request({ internalCategoryRefs: [] }), [selected]))
      .toThrow(PromotionTemplateSelectorError);
    expect(() => dryRunPromotionTemplateSelection(request(), [candidate({
      suffix: "future", publishedAt: "2026-08-09T16:00:00.000Z",
    })])).toThrow(PromotionTemplateSelectorError);
  });
});

describe("PromotionTemplateSelectorService", () => {
  it("binds the workspace and calls only the read-only published catalog port", async () => {
    const listPublished = vi.fn(async () => [candidate({ suffix: "hair" })]);
    const catalog: PublishedPromotionTemplateCatalog = { listPublished };
    const service = new PromotionTemplateSelectorService(catalog, workspaceRef);
    await expect(service.dryRun(request())).resolves.toMatchObject({ status: "recommended", publishReady: true });
    expect(listPublished).toHaveBeenCalledWith({ workspaceRef, evaluatedAt });
    await expect(service.dryRun(request({ workspaceRef: "workspace_other" }))).rejects.toMatchObject({ code: "invalid_input" });
    await expect(service.dryRun({ ...request(), unexpected: true } as PromotionTemplateSelectorInput))
      .rejects.toMatchObject({ code: "invalid_input" });
    expect(listPublished).toHaveBeenCalledTimes(1);
    expect(service).not.toHaveProperty("publish");
  });
});
