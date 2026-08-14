import { createSliceOperatingRuleDraft, type SliceOperatingRuleDraft } from "./slice-operating-rule";

/**
 * First operator-confirmed portfolio rule:
 * pazar is the primary split. This preserves current domestic/international
 * operating boundaries without renaming entities, moving budget, or opening
 * any Meta/action authority.
 */
export const MEVCUT_PORTFOY_PAZAR_SINIRI_RULE: SliceOperatingRuleDraft = createSliceOperatingRuleDraft({
  slice: { campaignCategoryRef: "category_portfolio" },
  rule: {
    kind: "pazar_siniri",
    pazarlar: ["yerli", "yabanci"],
    birlikte_yonetilemez: true,
    ayrik_tutulacak_kararlar: ["butce", "sonuc_degerlendirmesi", "otomasyon"],
  },
  automationMode: "observe_only",
  priority: 1000,
  verification: {
    metric: "delivery_health",
    reviewCadence: "weekly",
    rollbackWhen: "Bir öneri yerli ve yabancı pazarlar arasında açık insan onayı olmadan bütçe, sonuç karşılaştırması veya otomasyon etkisi taşımaya çalışırsa.",
  },
});
