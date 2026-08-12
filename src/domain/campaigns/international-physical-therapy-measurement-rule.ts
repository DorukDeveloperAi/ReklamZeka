import { createSliceOperatingRuleDraft, type SliceOperatingRuleDraft } from "./slice-operating-rule";

/**
 * Current live evidence distinguishes Arabic WhatsApp acquisition from Russian
 * form-lead acquisition. Their platform results have different meanings, so
 * they remain separate recommendation lanes until an owner-approved common
 * qualified-lead definition is available.
 */
export const INTERNATIONAL_PHYSICAL_THERAPY_MEASUREMENT_RULE: SliceOperatingRuleDraft = createSliceOperatingRuleDraft({
  slice: {
    market: "international", serviceRef: "service_physical_therapy_rehab", businessGoal: "lead_acquisition",
  },
  rule: {
    kind: "sonuc_olcum_siniri",
    ayri_degerlendir: ["donusum_rotasi", "ulke_bolge", "hedef_kitle_stratejisi"],
    birlikte_karsilastirilamaz: true,
  },
  automationMode: "recommendation_only",
  priority: 110,
  verification: {
    metric: "qualified_leads",
    reviewCadence: "weekly",
    rollbackWhen: "WhatsApp konuşması ile form lead sonucu aynı ölçüm havuzunda sıralanırsa veya nitelikli lead kanıtı olmadan rota, ülke/bölge ya da hedef kitle bütçesi değiştirmeye çalışırsa.",
  },
});
