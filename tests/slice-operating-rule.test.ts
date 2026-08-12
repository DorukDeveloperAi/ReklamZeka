import { describe, expect, it } from "vitest";

import { SliceOperatingRuleError, createSliceOperatingRuleDraft } from "@/domain/campaigns/slice-operating-rule";

const slice = Object.freeze({ market: "international" as const, language: "ar", serviceRef: "service_physical_therapy",
  countryOrRegion: "sa", businessGoal: "lead_acquisition" as const, conversionRoute: "whatsapp" as const });

describe("slice operating rule draft", () => {
  it("keeps an international service budget ceiling as a deterministic review-only draft", () => {
    const first = createSliceOperatingRuleDraft({ slice, rule: { kind: "period_budget_cap", period: "monthly", currency: "TRY", maximumDecimal: "250000" },
      automationMode: "recommendation_only", priority: 20,
      verification: { metric: "cost_per_qualified_lead", reviewCadence: "weekly", rollbackWhen: "Nitelikli lead maliyeti sınırı iki inceleme dönemi aşarsa." } });
    const second = createSliceOperatingRuleDraft({ slice, rule: { kind: "period_budget_cap", period: "monthly", currency: "TRY", maximumDecimal: "250000" },
      automationMode: "recommendation_only", priority: 20,
      verification: { metric: "cost_per_qualified_lead", reviewCadence: "weekly", rollbackWhen: "Nitelikli lead maliyeti sınırı iki inceleme dönemi aşarsa." } });
    expect(first.draftHash).toBe(second.draftHash);
    expect(first.authority).toEqual({ canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false, canEnableAutomation: false });
    expect(first.promotionRequired).toBe(true);
  });

  it("requires an exact 100 percent allocation and never opens bounded automation", () => {
    const draft = createSliceOperatingRuleDraft({ slice, rule: { kind: "budget_distribution", dimension: "countryOrRegion",
      allocations: [{ key: "sa", basisPoints: 7000 }, { key: "ae", basisPoints: 3000 }] }, automationMode: "bounded_automatic_candidate", priority: 5,
      verification: { metric: "qualified_leads", reviewCadence: "daily", rollbackWhen: "Teslimat veya kapasite doğrulanamazsa." } });
    expect(draft.rule).toMatchObject({ kind: "budget_distribution", allocations: [{ key: "ae", basisPoints: 3000 }, { key: "sa", basisPoints: 7000 }] });
    expect(draft.authority.canEnableAutomation).toBe(false);
    expect(draft.authority.canWriteMeta).toBe(false);
    expect(() => createSliceOperatingRuleDraft({ slice, rule: { kind: "budget_distribution", dimension: "countryOrRegion",
      allocations: [{ key: "sa", basisPoints: 6000 }, { key: "ae", basisPoints: 3000 }] }, automationMode: "recommendation_only", priority: 5,
      verification: { metric: "qualified_leads", reviewCadence: "daily", rollbackWhen: "Teslimat yok." } })).toThrow(SliceOperatingRuleError);
  });

  it("models engagement winner continuation and discovery rotation without creating an action", () => {
    const draft = createSliceOperatingRuleDraft({ slice: { market: "domestic", campaignCategoryRef: "category_brand_doctor" }, rule: {
      kind: "winner_continuation_rotation", metric: "engagement_rate", continuationBasisPoints: 7500, explorationBasisPoints: 2500, evaluationWindowDays: 14,
    }, automationMode: "approval_required", priority: 10,
    verification: { metric: "engagement_rate", reviewCadence: "weekly", rollbackWhen: "Etki sinyali yeterli değilse keşif payı korunur." } });
    expect(draft.rule.kind).toBe("winner_continuation_rotation");
    expect(draft.authority.canExecute).toBe(false);
  });
});
