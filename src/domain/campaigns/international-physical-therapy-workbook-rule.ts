import { createSliceOperatingRuleDraft, type SliceOperatingRuleDraft } from "./slice-operating-rule";

/**
 * Human-confirmed preservation draft from the supplied 2026-08 workbook.
 * `targetingEvidence` is intentionally name-derived: live targeting must be
 * verified before a future reviewed policy may rely on platform/audience data.
 */
export const INTERNATIONAL_PHYSICAL_THERAPY_WORKBOOK_RULE: SliceOperatingRuleDraft = createSliceOperatingRuleDraft({
  slice: {
    market: "international", serviceRef: "service_physical_therapy_rehab", businessGoal: "lead_acquisition",
  },
  rule: {
    kind: "targeting_budget_preservation", currency: "TRY", totalDailyBudgetDecimal: "48000",
    allocations: [
      { allocationRef: "allocation_ru_kazakhstan_all", dailyBudgetDecimal: "9000", territory: "Kazakistan", platform: "all_platforms", audienceStrategy: "cold_kombine2", targetingEvidence: "adset_name_inference" },
      { allocationRef: "allocation_ru_kyrgyz_tajik_ios", dailyBudgetDecimal: "3000", territory: "Kırgızistan + Tacikistan", platform: "ios", audienceStrategy: "cold_kombine2", targetingEvidence: "adset_name_inference" },
      { allocationRef: "allocation_ru_kyrgyz_tajik_belarus_georgia_android", dailyBudgetDecimal: "3000", territory: "Kırgızistan + Tacikistan + Belarus + Gürcistan", platform: "android", audienceStrategy: "cold_kombine2", targetingEvidence: "adset_name_inference" },
      { allocationRef: "allocation_ru_uzbekistan_android", dailyBudgetDecimal: "2500", territory: "Özbekistan", platform: "android", audienceStrategy: "cold_kombine2", targetingEvidence: "adset_name_inference" },
      { allocationRef: "allocation_ru_uzbekistan_ios", dailyBudgetDecimal: "2500", territory: "Özbekistan", platform: "ios", audienceStrategy: "cold_kombine2", targetingEvidence: "adset_name_inference" },
      { allocationRef: "allocation_ru_belarus_georgia_ios", dailyBudgetDecimal: "3000", territory: "Belarus + Gürcistan", platform: "ios", audienceStrategy: "cold_kombine2", targetingEvidence: "adset_name_inference" },
      { allocationRef: "allocation_ar_uae_ios", dailyBudgetDecimal: "4500", territory: "BAE", platform: "ios", audienceStrategy: "whatsapp_luks", targetingEvidence: "adset_name_inference" },
      { allocationRef: "allocation_ar_bahrain_oman_ios", dailyBudgetDecimal: "3500", territory: "Bahreyn + Umman", platform: "ios", audienceStrategy: "whatsapp_luks", targetingEvidence: "adset_name_inference" },
      { allocationRef: "allocation_ar_qatar_ios", dailyBudgetDecimal: "3000", territory: "Katar", platform: "ios", audienceStrategy: "whatsapp_luks", targetingEvidence: "adset_name_inference" },
      { allocationRef: "allocation_ar_kuwait_ios", dailyBudgetDecimal: "11000", territory: "Kuveyt", platform: "ios", audienceStrategy: "whatsapp_luks", targetingEvidence: "adset_name_inference" },
      { allocationRef: "allocation_ar_kuwait_qatar_android", dailyBudgetDecimal: "3000", territory: "Kuveyt + Katar", platform: "android", audienceStrategy: "whatsapp_luks", targetingEvidence: "adset_name_inference" },
    ],
  },
  automationMode: "recommendation_only", priority: 100,
  verification: { metric: "qualified_leads", reviewCadence: "weekly", rollbackWhen: "Canlı hedefleme, teslimat veya nitelikli lead doğrulaması mevcut dağılımla çelişirse insan incelemesi gerekir." },
});
