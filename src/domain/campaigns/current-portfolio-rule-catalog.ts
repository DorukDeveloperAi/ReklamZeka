import { INTERNATIONAL_PHYSICAL_THERAPY_MEASUREMENT_RULE } from "./international-physical-therapy-measurement-rule";
import { INTERNATIONAL_PHYSICAL_THERAPY_WORKBOOK_RULE } from "./international-physical-therapy-workbook-rule";
import { MEVCUT_PORTFOY_PAZAR_SINIRI_RULE } from "./mevcut-portfoy-pazar-siniri-rule";
import { createSliceOperatingRuleDraft, type CampaignEvaluationCandidate, type SliceOperatingRuleDraft } from "./slice-operating-rule";

/**
 * The reviewed, current rule set. This is a local operating catalogue, not a
 * policy publication path: every item remains draft-only and authority-free.
 */
export const INTERNATIONAL_INTENSIVE_FTR_EVALUATION_COHORT_RULE: SliceOperatingRuleDraft = createSliceOperatingRuleDraft({
  slice: {
    market: "international",
    serviceRef: "service_physical_therapy_rehab",
    campaignFamilyRef: "campaign_family_intensive_ftr",
    businessGoal: "lead_acquisition",
  },
  rule: {
    kind: "degerlendirme_kumesi",
    grup_boyutlari: ["pazar", "ana_kampanya_hedefi", "kampanya_ailesi", "ulke_bolge", "hedef_kitle_stratejisi", "platform"],
    eksik_kunye: "degerlendirme_disi_tut",
  },
  automationMode: "recommendation_only",
  priority: 850,
  verification: {
    metric: "qualified_leads",
    reviewCadence: "weekly",
    rollbackWhen: "Pazar, aile, ülke/bölge, hedefleme stratejisi veya platform künyesi değişirse; önce grubu yeniden doğrulayın.",
  },
});

export const CURRENT_PORTFOLIO_RULE_CATALOG: readonly SliceOperatingRuleDraft[] = Object.freeze([
  MEVCUT_PORTFOY_PAZAR_SINIRI_RULE,
  INTERNATIONAL_INTENSIVE_FTR_EVALUATION_COHORT_RULE,
  INTERNATIONAL_PHYSICAL_THERAPY_MEASUREMENT_RULE,
  INTERNATIONAL_PHYSICAL_THERAPY_WORKBOOK_RULE,
].sort((left, right) => right.priority - left.priority || left.draftHash.localeCompare(right.draftHash)));

/**
 * Lists only the reviewed draft rules whose explicit scope is satisfied by a
 * candidate's existing labels. The portfolio boundary is global once its
 * market is known; no label is inferred to make a rule apply.
 */
export function currentPortfolioRulesFor(candidate: CampaignEvaluationCandidate): readonly SliceOperatingRuleDraft[] {
  return Object.freeze(CURRENT_PORTFOLIO_RULE_CATALOG.filter((draft) => {
    if (draft.rule.kind === "pazar_siniri") return candidate.market !== undefined;
    return Object.entries(draft.slice).every(([key, value]) => candidate[key as keyof CampaignEvaluationCandidate] === value);
  }));
}
