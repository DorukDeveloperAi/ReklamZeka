import { describe, expect, it } from "vitest";

import { SliceOperatingRuleError, createSliceOperatingRuleDraft } from "@/domain/campaigns/slice-operating-rule";
import { INTERNATIONAL_PHYSICAL_THERAPY_WORKBOOK_RULE } from "@/domain/campaigns/international-physical-therapy-workbook-rule";
import { INTERNATIONAL_PHYSICAL_THERAPY_MEASUREMENT_RULE } from "@/domain/campaigns/international-physical-therapy-measurement-rule";
import { MEVCUT_PORTFOY_PAZAR_SINIRI_RULE } from "@/domain/campaigns/mevcut-portfoy-pazar-siniri-rule";

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

  it("preserves the workbook's international physical-therapy country and platform segmentation as recommendation-only", () => {
    const rule = INTERNATIONAL_PHYSICAL_THERAPY_WORKBOOK_RULE.rule;
    expect(rule).toMatchObject({ kind: "targeting_budget_preservation", currency: "TRY", totalDailyBudgetDecimal: "48000" });
    if (rule.kind !== "targeting_budget_preservation") throw new Error("unexpected rule");
    expect(rule.allocations).toHaveLength(11);
    expect(rule.allocations.reduce((sum, item) => sum + Number(item.dailyBudgetDecimal), 0)).toBe(48_000);
    expect(rule.allocations.filter((item) => item.platform === "ios")).toHaveLength(7);
    expect(rule.allocations.every((item) => item.targetingEvidence === "live_targeting_verified")).toBe(true);
    expect(rule.allocations.find((item) => item.allocationRef === "allocation_ar_bahrain_kuwait_qatar_android")?.countryCodes).toEqual(["BH", "KW", "QA"]);
    expect(INTERNATIONAL_PHYSICAL_THERAPY_WORKBOOK_RULE.automationMode).toBe("recommendation_only");
    expect(INTERNATIONAL_PHYSICAL_THERAPY_WORKBOOK_RULE.authority.canWriteMeta).toBe(false);
  });

  it("keeps domestic and foreign portfolio decisions apart as an observe-only rule", () => {
    expect(MEVCUT_PORTFOY_PAZAR_SINIRI_RULE.rule).toEqual({
      kind: "pazar_siniri", pazarlar: ["yabanci", "yerli"],
      birlikte_yonetilemez: true,
      ayrik_tutulacak_kararlar: ["butce", "otomasyon", "sonuc_degerlendirmesi"],
    });
    expect(MEVCUT_PORTFOY_PAZAR_SINIRI_RULE.automationMode).toBe("observe_only");
    expect(MEVCUT_PORTFOY_PAZAR_SINIRI_RULE.authority).toEqual({
      canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false, canEnableAutomation: false,
    });
  });

  it("rejects a market boundary that permits domestic and foreign to be managed together", () => {
    expect(() => createSliceOperatingRuleDraft({
      slice,
      rule: {
        kind: "pazar_siniri", pazarlar: ["yerli", "yabanci"],
        birlikte_yonetilemez: false as never,
        ayrik_tutulacak_kararlar: ["butce"],
      },
      automationMode: "observe_only", priority: 1,
      verification: { metric: "delivery_health", reviewCadence: "weekly", rollbackWhen: "test" },
    })).toThrow(SliceOperatingRuleError);
  });

  it("keeps international physical-therapy routes, territories, and audience strategies in separate result lanes", () => {
    expect(INTERNATIONAL_PHYSICAL_THERAPY_MEASUREMENT_RULE.rule).toEqual({
      kind: "sonuc_olcum_siniri",
      ayri_degerlendir: ["donusum_rotasi", "hedef_kitle_stratejisi", "ulke_bolge"],
      birlikte_karsilastirilamaz: true,
    });
    expect(INTERNATIONAL_PHYSICAL_THERAPY_MEASUREMENT_RULE.automationMode).toBe("recommendation_only");
    expect(INTERNATIONAL_PHYSICAL_THERAPY_MEASUREMENT_RULE.verification).toMatchObject({
      metric: "qualified_leads", reviewCadence: "weekly",
    });
    expect(INTERNATIONAL_PHYSICAL_THERAPY_MEASUREMENT_RULE.zamansalDegerlendirme).toEqual({
      mevcutDurum: "incelemeye_kadar_koru", olcumPenceresiGun: 7,
      yenidenIncelemeTetikleyicileri: ["kapsam_veya_hedefleme_degisimi", "teslimat_kesintisi", "yeni_sonuc_kaniti"],
      kararModu: "insan_incelemeli_oneri",
    });
  });

  it("rejects a result boundary that would permit unlike routes to be compared together", () => {
    expect(() => createSliceOperatingRuleDraft({
      slice,
      rule: {
        kind: "sonuc_olcum_siniri", ayri_degerlendir: ["donusum_rotasi"],
        birlikte_karsilastirilamaz: false as never,
      },
      automationMode: "recommendation_only", priority: 1,
      verification: { metric: "qualified_leads", reviewCadence: "weekly", rollbackWhen: "test" },
    })).toThrow(SliceOperatingRuleError);
  });

  it("lets a rule choose its own comparable cohort while always retaining the market boundary", () => {
    const rule = createSliceOperatingRuleDraft({
      slice: { market: "international", campaignCategoryRef: "category_ftr" },
      rule: {
        kind: "degerlendirme_kumesi",
        grup_boyutlari: ["pazar", "ana_kampanya_hedefi", "ulke_bolge", "hedef_kitle_stratejisi"],
        eksik_kunye: "degerlendirme_disi_tut",
      },
      automationMode: "recommendation_only", priority: 10,
      verification: { metric: "qualified_leads", reviewCadence: "weekly", rollbackWhen: "Eksik künye" },
    });
    expect(rule.rule).toEqual({
      kind: "degerlendirme_kumesi",
      grup_boyutlari: ["ana_kampanya_hedefi", "hedef_kitle_stratejisi", "pazar", "ulke_bolge"],
      eksik_kunye: "degerlendirme_disi_tut",
    });
  });

  it("rejects a comparable cohort that drops the mandatory market boundary", () => {
    expect(() => createSliceOperatingRuleDraft({
      slice,
      rule: {
        kind: "degerlendirme_kumesi", grup_boyutlari: ["ana_kampanya_hedefi"],
        eksik_kunye: "degerlendirme_disi_tut",
      },
      automationMode: "observe_only", priority: 1,
      verification: { metric: "delivery_health", reviewCadence: "weekly", rollbackWhen: "test" },
    })).toThrow(SliceOperatingRuleError);
  });
});
