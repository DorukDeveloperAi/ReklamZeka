/**
 * A bounded planning aid derived from the operating taxonomy, not a Meta
 * campaign writer. It turns a human-confirmed commercial intent into the
 * questions and review sequence needed before a campaign may be proposed.
 */
export const INTERACTIVE_CAMPAIGN_TEMPLATE_VERSION = "interactive-campaign-template/1.3.0" as const;

export type CampaignBusinessGoal =
  | "lead_acquisition"
  | "upper_funnel_education"
  | "market_service_learning"
  | "continuity_recovery"
  | "classification_triage";
export type CampaignMarket = "domestic" | "international" | "unknown";
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
export type CampaignTemplateVariantRef =
  | "domestic_form_lead"
  | "domestic_whatsapp_lead"
  | "international_form_lead"
  | "international_whatsapp_lead"
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
  /** Concrete reviewed operating variant; null until the minimum taxonomy is known. */
  variantRef: CampaignTemplateVariantRef | null;
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
  /** The one deterministic prompt a chat or UI should ask next. */
  nextDecision: Readonly<{
    field: "classification" | "deliveryHealth" | "market" | "language" | "serviceRef" | "countryOrRegion" | "conversionRoute" | "capacity" | "creativeReady";
    question: string;
    reason: string;
  }> | null;
  /**
   * The immediate read-only operating recommendation for this exact brief.
   * It is deliberately a review instruction rather than an ActionUnit or a
   * Meta mutation proposal.
   */
  recommendation: Readonly<{
    status: "blocked" | "needs_input" | "ready_for_human_review";
    kind: "resolve_classification" | "restore_delivery" | "complete_brief" | "review_campaign_structure";
    headline: string;
    rationale: string;
    nextStep: string;
    laneRefs: readonly string[];
  }>;
  /**
   * A human-review-only campaign structure.  These are planning lanes, not
   * Meta objects and never authorize a create, publish, or budget mutation.
   */
  campaignLanes: readonly Readonly<{
    laneRef: string;
    sequence: number;
    purpose: string;
    route: ConversionRoute;
    startCondition: string;
    measurementBoundary: string;
  }>[];
  launchSequence: readonly Readonly<{ step: string; reason: string }> [];
  measurement: Readonly<{ primaryOutcome: string; doNotCompareWith: readonly string[] }>;
  /**
   * Explicitly prevents the Excel taxonomy's independent performance lanes
   * (market/language/service/route) from being silently pooled.
   */
  comparisonBoundary: Readonly<{
    cohortKey: string | null;
    requiredDimensions: readonly ("market" | "language" | "service" | "countryOrRegion" | "businessGoal" | "conversionRoute")[];
    summary: string;
  }>;
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

function nextDecision(input: InteractiveCampaignTemplateRequest, templateRef: CampaignTemplateRef): InteractiveCampaignBrief["nextDecision"] {
  if (input.classification === "unclassified") return Object.freeze({ field: "classification",
    question: "Bu kampanyayı pazar, dil, hizmet, iş amacı ve dönüşüm yoluna bağlayalım mı?",
    reason: "Sınıflandırılmamış kayıt için sağlıklı kıyas veya yeni kampanya şeridi önerilemez." });
  if (input.deliveryHealth === "interrupted") return Object.freeze({ field: "deliveryHealth",
    question: "Teslimat kesintisi bitti mi ve hesap tekrar sağlıklı mı?",
    reason: "Kesinti dönemiyle ölçekleme veya yeni kampanya kararı karıştırılmaz." });
  if (input.deliveryHealth === "unknown") return Object.freeze({ field: "deliveryHealth",
    question: "Teslimat sağlıklı mı, kesintili mi?", reason: "Teslimat durumu bilinmeden performans veya yeni şerit önerilmez." });
  if (input.market === "unknown") return Object.freeze({ field: "market",
    question: "Bu çalışma yurtiçi mi, uluslararası mı?", reason: "Yerli/yabancı pazarlar ve dilleri aynı kıyas veya varsayılan şeritte birleştirilmez." });
  if (!validText(input.language)) return Object.freeze({ field: "language", question: "Hangi dilde ilerleyeceğiz?",
    reason: "Pazar ve dil ayrı bir campaign lane tanımıdır." });
  if (input.serviceRef === null) return Object.freeze({ field: "serviceRef", question: "Hangi hizmet/ana grup için çalışıyoruz?",
    reason: "Hizmet grubu olmadan teklif, mesaj ve ölçüm bağlamı belirsiz kalır." });
  if (input.market === "international" && !validText(input.countryOrRegion)) return Object.freeze({ field: "countryOrRegion",
    question: "Hangi ülke veya bölgeyi hedefliyoruz?", reason: "Uluslararası kampanyada ülke/bölge ayrı planlama eksenidir." });
  if (templateRef === "lead_acquisition" && !["lead_form", "whatsapp"].includes(input.conversionRoute)) return Object.freeze({ field: "conversionRoute",
    question: "Talebi form ile mi, WhatsApp ile mi toplayacağız?", reason: "İki rota aynı kalite veya CPL havuzu değildir." });
  if (input.capacity !== "confirmed") return Object.freeze({ field: "capacity", question: "Talebi karşılayacak operasyonel kapasite onaylı mı?",
    reason: "Kapasite doğrulanmadan lead hacmi hedefi önerilmez." });
  if (!input.creativeReady) return Object.freeze({ field: "creativeReady", question: "İncelenebilir kreatif ve mesaj hazır mı?",
    reason: "Kampanya yapısı, kreatif varlık ve mesajdan bağımsız yayın planına dönüşmez." });
  return null;
}

function variantRef(input: InteractiveCampaignTemplateRequest, templateRef: CampaignTemplateRef): CampaignTemplateVariantRef | null {
  if (templateRef === "classification_triage" || templateRef === "continuity_recovery") return templateRef;
  if (input.market === "unknown" || input.deliveryHealth !== "healthy") return null;
  if (templateRef === "upper_funnel_education") return "upper_funnel_education";
  if (templateRef === "market_service_learning") return "market_service_learning";
  if (input.conversionRoute === "lead_form") return input.market === "domestic" ? "domestic_form_lead" : "international_form_lead";
  if (input.conversionRoute === "whatsapp") return input.market === "domestic" ? "domestic_whatsapp_lead" : "international_whatsapp_lead";
  return null;
}

function comparisonBoundary(input: InteractiveCampaignTemplateRequest, templateRef: CampaignTemplateRef): InteractiveCampaignBrief["comparisonBoundary"] {
  const requiredDimensions = Object.freeze(["market", "language", "service", "countryOrRegion", "businessGoal", "conversionRoute"] as const);
  const language = input.language;
  if (input.market === "unknown" || language === null || !validText(language) || input.serviceRef === null
    || (input.market === "international" && !validText(input.countryOrRegion))
    || (templateRef === "lead_acquisition" && !["lead_form", "whatsapp"].includes(input.conversionRoute))) {
    return Object.freeze({ cohortKey: null, requiredDimensions,
      summary: "Pazar, dil, hizmet ve dönüşüm yolu netleşmeden kıyas havuzu kurulmaz." });
  }
  const key = [input.market, language.trim().toLowerCase(), input.countryOrRegion?.trim().toLowerCase() ?? "domestic",
    input.serviceRef, input.businessGoal, input.conversionRoute].join(":");
  return Object.freeze({ cohortKey: key, requiredDimensions,
    summary: "Yalnız aynı pazar, dil, hizmet, iş amacı ve dönüşüm yolundaki sonuçlarla kıyaslayın." });
}

function campaignLanes(input: InteractiveCampaignTemplateRequest, templateRef: CampaignTemplateRef): InteractiveCampaignBrief["campaignLanes"] {
  if (templateRef === "classification_triage" || templateRef === "continuity_recovery") return Object.freeze([]);
  if (templateRef === "lead_acquisition") return Object.freeze([{ laneRef: "conversion_lane", sequence: 1,
    purpose: input.conversionRoute === "whatsapp" ? "Nitelikli WhatsApp talebi" : "Nitelikli form talebi",
    route: input.conversionRoute, startCondition: "Pazar, dil, hizmet, dönüşüm yolu, kapasite ve kreatif insan incelemesinde doğrulanır.",
    measurementBoundary: "Form ve WhatsApp sonucu; ayrıca üst-huni erişimiyle varsayılan olarak karşılaştırılmaz." }]);
  if (templateRef === "upper_funnel_education") return Object.freeze([{ laneRef: "education_lane", sequence: 1,
    purpose: "Hizmet/marka eğitimi ve amaçla uyumlu erişim/etkileşim", route: "not_applicable",
    startCondition: "Pazar, dil, hizmet ve kreatif insan incelemesinde doğrulanır.",
    measurementBoundary: "Başarı lead CPL ile değil erişim, frekans ve etkileşim penceresiyle değerlendirilir." }]);
  return Object.freeze([{ laneRef: "learning_lane", sequence: 1, purpose: "Tek hipotezli pazar-hizmet öğrenmesi",
    route: "not_applicable", startCondition: "Tek öğrenme sorusu, pazar/dil/hizmet ve kapasite insan incelemesinde doğrulanır.",
    measurementBoundary: "Sonuç, aynı anda açılmış dönüşüm kampanyasının sonucu olarak yorumlanmaz." }]);
}

function recommendation(
  input: InteractiveCampaignTemplateRequest,
  templateRef: CampaignTemplateRef,
  readiness: InteractiveCampaignBrief["readiness"],
  lanes: InteractiveCampaignBrief["campaignLanes"],
): InteractiveCampaignBrief["recommendation"] {
  if (templateRef === "classification_triage") return Object.freeze({
    status: "blocked", kind: "resolve_classification", headline: "Önce kampanya bağlamını doğrulayın",
    rationale: "Sınıflandırılmamış bir kampanya için kıyas, bütçe veya yayın yönü önerilmez.",
    nextStep: "Pazar, dil, hizmet, iş amacı ve dönüşüm yolunu insan incelemesiyle tamamlayın.", laneRefs: Object.freeze([]),
  });
  if (templateRef === "continuity_recovery") return Object.freeze({
    status: "blocked", kind: "restore_delivery", headline: "Önce teslimat kesintisini ayırın",
    rationale: "Kesinti verisiyle ölçekleme ya da yeni şerit kararı güvenilir değildir.",
    nextStep: "Teslimatın ve hesabın sağlığını doğrulayın; ardından yeni gözlem penceresini başlatın.", laneRefs: Object.freeze([]),
  });
  if (readiness === "needs_input") return Object.freeze({
    status: "needs_input", kind: "complete_brief", headline: "Brief'i tamamlayın",
    rationale: "Eksik pazar, hizmet, dönüşüm yolu, kapasite veya kreatif bilgisi kampanya yapısını belirsiz bırakır.",
    nextStep: "Ekrandaki sonraki kararı yanıtlayın; sistem eksik bilgiyle bütçe veya yayın önermez.",
    laneRefs: Object.freeze(lanes.map((lane) => lane.laneRef)),
  });
  return Object.freeze({
    status: "ready_for_human_review", kind: "review_campaign_structure", headline: "Kampanya yapısını insan incelemesine alın",
    rationale: "Bağlam tamam; önerilen şerit ve ölçüm sınırı aynı karar çerçevesinde gözden geçirilebilir.",
    nextStep: input.businessGoal === "lead_acquisition"
      ? "Dönüşüm şeridini, kapasiteyi ve kreatif mesajını birlikte inceleyin; ardından ayrı proposal/onay akışına geçin."
      : "Önerilen şeridi ve ölçüm penceresini inceleyin; herhangi bir aksiyon için ayrı proposal/onay gerekir.",
    laneRefs: Object.freeze(lanes.map((lane) => lane.laneRef)),
  });
}

function assertRequest(input: InteractiveCampaignTemplateRequest): void {
  if (!input || typeof input !== "object"
    || !["lead_acquisition", "upper_funnel_education", "market_service_learning", "continuity_recovery", "classification_triage"].includes(input.businessGoal)
    || !["domestic", "international", "unknown"].includes(input.market)
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
    const lanes = campaignLanes(input, templateRef);
    return Object.freeze({ version: INTERACTIVE_CAMPAIGN_TEMPLATE_VERSION, templateRef, variantRef: variantRef(input, templateRef), readiness: "blocked",
      humanReviewRequired: true, classification: Object.freeze({ market: input.market, language: input.language,
        serviceRef: input.serviceRef, countryOrRegion: input.countryOrRegion, conversionRoute: input.conversionRoute }),
      questions: Object.freeze(questions), nextDecision: nextDecision(input, templateRef), campaignLanes: lanes, recommendation: recommendation(input, templateRef, "blocked", lanes), launchSequence: Object.freeze([{ step: "Sınıflandırmayı doğrula", reason: "Sınıflandırılmamış kampanya ölçekleme veya kıyas için güvenilir değildir." }]),
      measurement: Object.freeze({ primaryOutcome: "Sınıflandırma tamamlanması", doNotCompareWith: Object.freeze(["lead CPL", "üst huni erişimi"]) }), comparisonBoundary: comparisonBoundary(input, templateRef), authority: AUTHORITY });
  }
  if (templateRef === "continuity_recovery") {
    question("Teslimat kesintisinin bitişini ve hesap sağlığını doğrulayın.", questions);
    question("Toparlanma penceresi bitmeden performans hükmü vermeyin.", questions);
    const lanes = campaignLanes(input, templateRef);
    return Object.freeze({ version: INTERACTIVE_CAMPAIGN_TEMPLATE_VERSION, templateRef, variantRef: variantRef(input, templateRef), readiness: "blocked",
      humanReviewRequired: true, classification: Object.freeze({ market: input.market, language: input.language,
        serviceRef: input.serviceRef, countryOrRegion: input.countryOrRegion, conversionRoute: input.conversionRoute }),
      questions: Object.freeze(questions), nextDecision: nextDecision(input, templateRef), campaignLanes: lanes, recommendation: recommendation(input, templateRef, "blocked", lanes), launchSequence: Object.freeze([{ step: "Teslimatı geri doğrula", reason: "Kesinti günleri performans sinyalini yanıltabilir." },
        { step: "Yeni öğrenme penceresi aç", reason: "Toparlanma sonrası ölçüm, kesinti öncesi ve sırası sonuçlarından ayrılmalıdır." }]),
      measurement: Object.freeze({ primaryOutcome: "Sağlıklı teslimat sürekliliği", doNotCompareWith: Object.freeze(["kesinti günü CPL", "kesinti günü erişim"]) }), comparisonBoundary: comparisonBoundary(input, templateRef), authority: AUTHORITY });
  }

  if (input.deliveryHealth === "unknown" || input.market === "unknown") {
    const reason = input.deliveryHealth === "unknown"
      ? "Teslimat sağlığı belirsiz; kesinti ile performans sinyali ayrıştırılmadan şerit önerilmez."
      : "Pazar belirsiz; yerli/yabancı, dil ve route kıyas sınırı kurulmadan şerit önerilmez.";
    question(input.deliveryHealth === "unknown" ? "Teslimat sağlığını doğrulayın." : "Pazarı yurtiçi veya uluslararası olarak doğrulayın.", questions);
    const lanes = Object.freeze([]) as InteractiveCampaignBrief["campaignLanes"];
    return Object.freeze({ version: INTERACTIVE_CAMPAIGN_TEMPLATE_VERSION, templateRef, variantRef: null, readiness: "needs_input",
      humanReviewRequired: true, classification: Object.freeze({ market: input.market, language: input.language, serviceRef: input.serviceRef,
        countryOrRegion: input.countryOrRegion, conversionRoute: input.conversionRoute }), questions: Object.freeze(questions), nextDecision: nextDecision(input, templateRef), campaignLanes: lanes,
      recommendation: Object.freeze({ status: "needs_input", kind: "complete_brief", headline: "Önce pazar ve teslimat bağlamını doğrulayın", rationale: reason,
        nextStep: "Bir sonraki kararı tamamlayın; sistem şerit, bütçe veya yayın önerisi üretmez.", laneRefs: Object.freeze([]) }),
      launchSequence: Object.freeze([{ step: "Bağlamı doğrula", reason }]), measurement: Object.freeze({ primaryOutcome: "Bağlam doğrulaması", doNotCompareWith: Object.freeze(["lead CPL", "üst huni erişimi"]) }),
      comparisonBoundary: comparisonBoundary(input, templateRef), authority: AUTHORITY });
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
  const lanes = campaignLanes(input, templateRef);
  return Object.freeze({ version: INTERACTIVE_CAMPAIGN_TEMPLATE_VERSION, templateRef, variantRef: variantRef(input, templateRef),
    readiness: ready ? "ready_for_human_review" : "needs_input", humanReviewRequired: true,
    classification: Object.freeze({ market: input.market, language: input.language, serviceRef: input.serviceRef,
      countryOrRegion: input.countryOrRegion, conversionRoute: input.conversionRoute }), questions: Object.freeze(questions),
    nextDecision: nextDecision(input, templateRef), campaignLanes: lanes, recommendation: recommendation(input, templateRef, ready ? "ready_for_human_review" : "needs_input", lanes),
    launchSequence: Object.freeze(sequence), measurement: Object.freeze({ primaryOutcome,
      doNotCompareWith: Object.freeze(templateRef === "lead_acquisition" ? ["üst huni erişimi", "farklı dönüşüm yolu"] : ["lead CPL"]) }),
    comparisonBoundary: comparisonBoundary(input, templateRef), authority: AUTHORITY });
}
