/**
 * A bounded planning aid derived from the operating taxonomy, not a Meta
 * campaign writer. It turns a human-confirmed commercial intent into the
 * questions and review sequence needed before a campaign may be proposed.
 */
export const INTERACTIVE_CAMPAIGN_TEMPLATE_VERSION = "interactive-campaign-template/1.0.0" as const;

export type CampaignBusinessGoal =
  | "lead_acquisition"
  | "upper_funnel_education"
  | "market_service_learning"
  | "continuity_recovery"
  | "classification_triage";
export type CampaignMarket = "domestic" | "international";
export type ConversionRoute = "lead_form" | "whatsapp" | "landing_page" | "not_applicable" | "unknown";
export type DeliveryHealth = "healthy" | "interrupted" | "unknown";
export type ClassificationState = "classified" | "unclassified";
export type CapacityState = "confirmed" | "constrained" | "unknown";
export type CampaignTemplateRef =
  | "lead_acquisition"
  | "upper_funnel_education"
  | "market_service_learning"
  | "continuity_recovery"
  | "classification_triage";

export type InteractiveCampaignTemplateRequest = Readonly<{
  businessGoal: CampaignBusinessGoal;
  market: CampaignMarket;
  language: string | null;
  serviceRef: string | null;
  countryOrRegion: string | null;
  conversionRoute: ConversionRoute;
  deliveryHealth: DeliveryHealth;
  classification: ClassificationState;
  capacity: CapacityState;
  creativeReady: boolean;
}>;

export type InteractiveCampaignBrief = Readonly<{
  version: typeof INTERACTIVE_CAMPAIGN_TEMPLATE_VERSION;
  templateRef: CampaignTemplateRef;
  readiness: "blocked" | "needs_input" | "ready_for_human_review";
  humanReviewRequired: true;
  classification: Readonly<{
    market: CampaignMarket;
    language: string | null;
    serviceRef: string | null;
    countryOrRegion: string | null;
    conversionRoute: ConversionRoute;
  }>;
  questions: readonly string[];
  launchSequence: readonly Readonly<{ step: string; reason: string }> [];
  measurement: Readonly<{ primaryOutcome: string; doNotCompareWith: readonly string[] }>;
  authority: Readonly<{
    canCreateCampaign: false;
    canPublish: false;
    canApprove: false;
    canExecute: false;
    canWriteMeta: false;
  }>;
}>;

export class InteractiveCampaignTemplateError extends Error {
  constructor(readonly code: "invalid_input") {
    super(`Interactive campaign template rejected: ${code}`);
    this.name = "InteractiveCampaignTemplateError";
  }
}

const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const AUTHORITY = Object.freeze({ canCreateCampaign: false as const, canPublish: false as const,
  canApprove: false as const, canExecute: false as const, canWriteMeta: false as const });

function question(value: string, questions: string[]): void { if (!questions.includes(value)) questions.push(value); }
function validText(value: string | null): boolean { return value !== null && value.trim().length > 0 && value.length <= 120; }

function assertRequest(input: InteractiveCampaignTemplateRequest): void {
  if (!input || typeof input !== "object"
    || !["lead_acquisition", "upper_funnel_education", "market_service_learning", "continuity_recovery", "classification_triage"].includes(input.businessGoal)
    || !["domestic", "international"].includes(input.market)
    || !["lead_form", "whatsapp", "landing_page", "not_applicable", "unknown"].includes(input.conversionRoute)
    || !["healthy", "interrupted", "unknown"].includes(input.deliveryHealth)
    || !["classified", "unclassified"].includes(input.classification)
    || !["confirmed", "constrained", "unknown"].includes(input.capacity)
    || typeof input.creativeReady !== "boolean"
    || input.language !== null && !validText(input.language)
    || input.countryOrRegion !== null && !validText(input.countryOrRegion)
    || input.serviceRef !== null && !REF.test(input.serviceRef)) throw new InteractiveCampaignTemplateError("invalid_input");
}

/**
 * Chooses a review template deterministically. Delivery health and
 * classification deliberately override commercial ambition: the brief never
 * turns an incomplete account state into a scaling recommendation.
 */
export function createInteractiveCampaignBrief(input: InteractiveCampaignTemplateRequest): InteractiveCampaignBrief {
  assertRequest(input);
  const questions: string[] = [];
  const missingCore = !validText(input.language) || input.serviceRef === null;
  let templateRef: CampaignTemplateRef = input.businessGoal;
  if (input.classification === "unclassified") templateRef = "classification_triage";
  else if (input.deliveryHealth === "interrupted") templateRef = "continuity_recovery";

  if (templateRef === "classification_triage") {
    question("Kampanyayı pazar, dil, hizmet, iş amacı ve dönüşüm yoluna bağlayın.", questions);
    return Object.freeze({ version: INTERACTIVE_CAMPAIGN_TEMPLATE_VERSION, templateRef, readiness: "blocked",
      humanReviewRequired: true, classification: Object.freeze({ market: input.market, language: input.language,
        serviceRef: input.serviceRef, countryOrRegion: input.countryOrRegion, conversionRoute: input.conversionRoute }),
      questions: Object.freeze(questions), launchSequence: Object.freeze([{ step: "Sınıflandırmayı doğrula", reason: "Sınıflandırılmamış kampanya ölçekleme veya kıyas için güvenilir değildir." }]),
      measurement: Object.freeze({ primaryOutcome: "Sınıflandırma tamamlanması", doNotCompareWith: Object.freeze(["lead CPL", "üst huni erişimi"]) }), authority: AUTHORITY });
  }
  if (templateRef === "continuity_recovery") {
    question("Teslimat kesintisinin bitişini ve hesap sağlığını doğrulayın.", questions);
    question("Toparlanma penceresi bitmeden performans hükmü vermeyin.", questions);
    return Object.freeze({ version: INTERACTIVE_CAMPAIGN_TEMPLATE_VERSION, templateRef, readiness: "blocked",
      humanReviewRequired: true, classification: Object.freeze({ market: input.market, language: input.language,
        serviceRef: input.serviceRef, countryOrRegion: input.countryOrRegion, conversionRoute: input.conversionRoute }),
      questions: Object.freeze(questions), launchSequence: Object.freeze([{ step: "Teslimatı geri doğrula", reason: "Kesinti günleri performans sinyalini yanıltabilir." },
        { step: "Yeni öğrenme penceresi aç", reason: "Toparlanma sonrası ölçüm, kesinti öncesi ve sırası sonuçlarından ayrılmalıdır." }]),
      measurement: Object.freeze({ primaryOutcome: "Sağlıklı teslimat sürekliliği", doNotCompareWith: Object.freeze(["kesinti günü CPL", "kesinti günü erişim"]) }), authority: AUTHORITY });
  }

  if (missingCore) question("Dil ve hizmet sınıflandırmasını doğrulayın.", questions);
  if (input.market === "international" && !validText(input.countryOrRegion)) question("Ülke/bölgeyi netleştirin.", questions);
  if (input.capacity !== "confirmed") question("Randevu/operasyon kapasitesini insan onayıyla doğrulayın.", questions);
  if (!input.creativeReady) question("Kreatif varlık ve mesajı incelemeye hazır hale getirin.", questions);
  if (templateRef === "lead_acquisition" && !["lead_form", "whatsapp"].includes(input.conversionRoute)) {
    question("Lead kampanyası için form veya WhatsApp dönüşüm yolunu seçin.", questions);
  }
  if (templateRef === "upper_funnel_education" && input.conversionRoute !== "not_applicable") {
    question("Üst huni sonucu lead sonucundan ayrı ölçülecektir; dönüşüm yolunu başarı KPI'ı yapmayın.", questions);
  }

  const ready = questions.length === 0;
  const primaryOutcome = templateRef === "lead_acquisition" ? (input.conversionRoute === "whatsapp" ? "Nitelikli WhatsApp talebi" : "Nitelikli form talebi")
    : templateRef === "upper_funnel_education" ? "Amaçla uyumlu erişim/etkileşim"
      : "Önceden tanımlı öğrenme hipotezi";
  const sequence = templateRef === "lead_acquisition"
    ? [{ step: "Dönüşüm yolunu sabitle", reason: "Form ve WhatsApp sonuçları varsayılan olarak aynı kalite havuzu değildir." },
      { step: "Kapasiteyi onayla", reason: "Talep hacmi operasyonel karşılığa bağlanmalıdır." },
      { step: "İnsan incelemeli taslak oluştur", reason: "Bu brief hiçbir Meta yazma yetkisi taşımaz." }]
    : templateRef === "upper_funnel_education"
      ? [{ step: "Eğitim mesajını ve hedef kitleyi doğrula", reason: "Üst huni kampanyası lead başarısı gibi değerlendirilmez." },
        { step: "Ölçüm penceresini belirle", reason: "Erişim, frekans ve etkileşim birlikte yorumlanır." }]
      : [{ step: "Hipotezi yaz", reason: "Yeni pazar/hizmet deneyi tek bir öğrenme sorusuna bağlanır." },
        { step: "İnsan incelemeli küçük test taslağı oluştur", reason: "Bütçe veya yayın önerisi otomatik üretilmez." }];
  return Object.freeze({ version: INTERACTIVE_CAMPAIGN_TEMPLATE_VERSION, templateRef,
    readiness: ready ? "ready_for_human_review" : "needs_input", humanReviewRequired: true,
    classification: Object.freeze({ market: input.market, language: input.language, serviceRef: input.serviceRef,
      countryOrRegion: input.countryOrRegion, conversionRoute: input.conversionRoute }), questions: Object.freeze(questions),
    launchSequence: Object.freeze(sequence), measurement: Object.freeze({ primaryOutcome,
      doNotCompareWith: Object.freeze(templateRef === "lead_acquisition" ? ["üst huni erişimi", "farklı dönüşüm yolu"] : ["lead CPL"]) }), authority: AUTHORITY });
}
