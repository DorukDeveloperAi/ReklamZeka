import { createSliceOperatingRuleDraft, type SliceOperatingRuleDraft } from "./slice-operating-rule";

/**
 * Human-confirmed preservation draft from the supplied 2026-08 workbook.
 * Countries and operating-system segmentation were re-read from the live,
 * read-only Meta ad-set targeting on 2026-08-12. Publisher platform absence is
 * retained as unknown rather than inferred from an ad-set name.
 */
export const INTERNATIONAL_PHYSICAL_THERAPY_WORKBOOK_RULE: SliceOperatingRuleDraft = createSliceOperatingRuleDraft({
  slice: {
    market: "international", serviceRef: "service_physical_therapy_rehab", businessGoal: "lead_acquisition",
  },
  rule: {
    kind: "targeting_budget_preservation", currency: "TRY", totalDailyBudgetDecimal: "48000",
    allocations: [
      { allocationRef: "allocation_ru_kazakhstan_all", dailyBudgetDecimal: "9000", territory: "Kazakistan", countryCodes: ["KZ"], platform: "all_platforms", publisherPlatforms: ["facebook", "instagram"], audienceStrategy: "cold_kombine2", targetingEvidence: "live_targeting_verified" },
      { allocationRef: "allocation_ru_kyrgyz_tajik_ios", dailyBudgetDecimal: "3000", territory: "Kırgızistan + Tacikistan", countryCodes: ["KG", "TJ"], platform: "ios", publisherPlatforms: ["facebook", "instagram"], audienceStrategy: "cold_kombine2", targetingEvidence: "live_targeting_verified" },
      { allocationRef: "allocation_ru_kyrgyz_tajik_belarus_georgia_android", dailyBudgetDecimal: "3000", territory: "Kırgızistan + Tacikistan + Belarus + Gürcistan", countryCodes: ["BY", "GE", "KG", "TJ"], platform: "android", publisherPlatforms: ["facebook", "instagram"], audienceStrategy: "cold_kombine2", targetingEvidence: "live_targeting_verified" },
      { allocationRef: "allocation_ru_uzbekistan_android", dailyBudgetDecimal: "2500", territory: "Özbekistan", countryCodes: ["UZ"], platform: "android", publisherPlatforms: ["facebook", "instagram"], audienceStrategy: "cold_kombine2", targetingEvidence: "live_targeting_verified" },
      { allocationRef: "allocation_ru_uzbekistan_ios", dailyBudgetDecimal: "2500", territory: "Özbekistan", countryCodes: ["UZ"], platform: "ios", publisherPlatforms: ["facebook", "instagram"], audienceStrategy: "cold_kombine2", targetingEvidence: "live_targeting_verified" },
      { allocationRef: "allocation_ru_belarus_georgia_ios", dailyBudgetDecimal: "3000", territory: "Belarus + Gürcistan", countryCodes: ["BY", "GE"], platform: "ios", publisherPlatforms: ["facebook", "instagram"], audienceStrategy: "cold_kombine2", targetingEvidence: "live_targeting_verified" },
      { allocationRef: "allocation_ar_uae_ios", dailyBudgetDecimal: "4500", territory: "BAE", countryCodes: ["AE"], platform: "ios", publisherPlatforms: null, audienceStrategy: "whatsapp_luks", targetingEvidence: "live_targeting_verified" },
      { allocationRef: "allocation_ar_bahrain_oman_ios", dailyBudgetDecimal: "3500", territory: "Bahreyn + Umman", countryCodes: ["BH", "OM"], platform: "ios", publisherPlatforms: null, audienceStrategy: "whatsapp_luks", targetingEvidence: "live_targeting_verified" },
      { allocationRef: "allocation_ar_qatar_ios", dailyBudgetDecimal: "3000", territory: "Katar", countryCodes: ["QA"], platform: "ios", publisherPlatforms: null, audienceStrategy: "whatsapp_luks", targetingEvidence: "live_targeting_verified" },
      { allocationRef: "allocation_ar_kuwait_ios", dailyBudgetDecimal: "11000", territory: "Kuveyt", countryCodes: ["KW"], platform: "ios", publisherPlatforms: null, audienceStrategy: "whatsapp_luks", targetingEvidence: "live_targeting_verified" },
      { allocationRef: "allocation_ar_bahrain_kuwait_qatar_android", dailyBudgetDecimal: "3000", territory: "Bahreyn + Kuveyt + Katar", countryCodes: ["BH", "KW", "QA"], platform: "android", publisherPlatforms: null, audienceStrategy: "whatsapp_luks", targetingEvidence: "live_targeting_verified" },
    ],
  },
  automationMode: "recommendation_only", priority: 100,
  verification: { metric: "qualified_leads", reviewCadence: "weekly", rollbackWhen: "Canlı hedefleme, teslimat veya nitelikli lead doğrulaması mevcut dağılımla çelişirse insan incelemesi gerekir." },
});
