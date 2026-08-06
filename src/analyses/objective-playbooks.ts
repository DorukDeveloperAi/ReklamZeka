import {
  EXECUTABLE_ANALYSIS_METRICS,
  validateAnalysisDefinition,
  type AnalysisDefinition,
  type AnalysisMetric,
  type CampaignObjective,
} from "./schema";

export const OBJECTIVE_PLAYBOOK_VERSION = "objective-playbooks/1.0.0" as const;

export type ObjectivePlaybook = Readonly<{
  version: typeof OBJECTIVE_PLAYBOOK_VERSION;
  objective: CampaignObjective;
  label: string;
  allowedFunnelStages: readonly AnalysisDefinition["campaignContext"]["funnelStage"][];
  allowedOptimizationEvents: readonly AnalysisDefinition["campaignContext"]["optimizationEvent"][];
  primaryMetrics: readonly AnalysisMetric[];
  diagnosticMetrics: readonly AnalysisMetric[];
  guardrailMetrics: readonly AnalysisMetric[];
  minimumSamples: readonly Readonly<{ metric: AnalysisMetric; value: number }>[];
  defaultTimeframeDays: number;
  defaultSchedule: "daily" | "weekly";
  evaluationQuestions: readonly string[];
  decisionGuide: readonly string[];
}>;

export const OBJECTIVE_PLAYBOOKS: Readonly<Record<CampaignObjective, ObjectivePlaybook>> = {
  awareness: {
    version: OBJECTIVE_PLAYBOOK_VERSION,
    objective: "awareness",
    label: "Bilinirlik",
    allowedFunnelStages: ["awareness"],
    allowedOptimizationEvents: ["impressions", "reach"],
    primaryMetrics: ["reach", "impressions"],
    diagnosticMetrics: ["frequency", "cpmMinor"],
    guardrailMetrics: ["spendMinor", "ctr"],
    minimumSamples: [{ metric: "impressions", value: 10_000 }],
    defaultTimeframeDays: 7,
    defaultSchedule: "weekly",
    evaluationQuestions: ["Hedef kitleye yeterli ölçekte ulaşıldı mı?", "Frekans yaratıcı yorgunluk riski taşıyor mu?"],
    decisionGuide: ["Erişim düşükse hedef kitle ve teslimat kısıtlarını incele.", "Frekans yüksekse yaratıcı rotasyonu veya kitle genişletmeyi değerlendir."],
  },
  traffic: {
    version: OBJECTIVE_PLAYBOOK_VERSION,
    objective: "traffic",
    label: "Trafik",
    allowedFunnelStages: ["awareness", "consideration"],
    allowedOptimizationEvents: ["link_click", "landing_page_view"],
    primaryMetrics: ["landingPageViews", "cpcMinor"],
    diagnosticMetrics: ["ctr", "clicks"],
    guardrailMetrics: ["spendMinor", "conversionRate"],
    minimumSamples: [{ metric: "clicks", value: 100 }],
    defaultTimeframeDays: 7,
    defaultSchedule: "daily",
    evaluationQuestions: ["Tıklamalar gerçek açılış sayfası ziyaretine dönüşüyor mu?", "Trafik maliyeti hedef aralıkta mı?"],
    decisionGuide: ["Tıklama–LPV farkı açılıyorsa sayfa hızı ve izlemeyi kontrol et.", "CTR düşükse mesaj–kitle uyumunu test et."],
  },
  engagement: {
    version: OBJECTIVE_PLAYBOOK_VERSION,
    objective: "engagement",
    label: "Etkileşim",
    allowedFunnelStages: ["awareness", "consideration"],
    allowedOptimizationEvents: ["engagement"],
    primaryMetrics: ["engagementRate", "cpeMinor"],
    diagnosticMetrics: ["engagements", "ctr"],
    guardrailMetrics: ["frequency", "spendMinor"],
    minimumSamples: [{ metric: "impressions", value: 5_000 }],
    defaultTimeframeDays: 7,
    defaultSchedule: "weekly",
    evaluationQuestions: ["İçerik hedef kitlenin anlamlı etkileşimini çekiyor mu?", "Etkileşim maliyeti yaratıcılar arasında nasıl dağılıyor?"],
    decisionGuide: ["Etkileşim oranı zayıfsa yaratıcı format ve ilk mesajı test et.", "Ucuz fakat niteliksiz etkileşimi alt huni sonucu gibi yorumlama."],
  },
  lead_generation: {
    version: OBJECTIVE_PLAYBOOK_VERSION,
    objective: "lead_generation",
    label: "Potansiyel müşteri",
    allowedFunnelStages: ["consideration", "conversion"],
    allowedOptimizationEvents: ["lead", "qualified_lead"],
    primaryMetrics: ["qualifiedLeads", "cpaMinor"],
    diagnosticMetrics: ["leads", "qualifiedLeadRate", "conversionRate"],
    guardrailMetrics: ["spendMinor", "cpcMinor"],
    minimumSamples: [{ metric: "leads", value: 30 }],
    defaultTimeframeDays: 14,
    defaultSchedule: "daily",
    evaluationQuestions: ["Lead hacmi kadar kalite de korunuyor mu?", "Hangi segment nitelikli lead maliyetini iyileştiriyor?"],
    decisionGuide: ["CPL iyileşirken kalite düşüyorsa bütçe artırma.", "Yeterli hacim yoksa kararı ertele ve veri toplamaya devam et."],
  },
  app_growth: {
    version: OBJECTIVE_PLAYBOOK_VERSION,
    objective: "app_growth",
    label: "Uygulama büyümesi",
    allowedFunnelStages: ["conversion", "retention"],
    allowedOptimizationEvents: ["app_install"],
    primaryMetrics: ["appInstalls", "cpiMinor"],
    diagnosticMetrics: ["conversionRate", "retentionD7"],
    guardrailMetrics: ["spendMinor", "cpcMinor"],
    minimumSamples: [{ metric: "appInstalls", value: 50 }],
    defaultTimeframeDays: 14,
    defaultSchedule: "daily",
    evaluationQuestions: ["Kurulumlar hedef maliyetle geliyor mu?", "Kurulum sonrası D7 kalıcılık korunuyor mu?"],
    decisionGuide: ["CPI düşük ama retention zayıfsa kanalı başarılı sayma.", "Attribution ve uygulama event kalitesini ölçeklemeden önce doğrula."],
  },
  sales: {
    version: OBJECTIVE_PLAYBOOK_VERSION,
    objective: "sales",
    label: "Satış",
    allowedFunnelStages: ["conversion"],
    allowedOptimizationEvents: ["purchase", "conversion_value"],
    primaryMetrics: ["purchases", "revenueMinor", "roas"],
    diagnosticMetrics: ["conversionRate", "averageOrderValueMinor", "cpaMinor", "conversions"],
    guardrailMetrics: ["spendMinor", "frequency"],
    minimumSamples: [{ metric: "purchases", value: 20 }],
    defaultTimeframeDays: 7,
    defaultSchedule: "daily",
    evaluationQuestions: ["Gelir ve edinme maliyeti birlikte hedefi karşılıyor mu?", "ROAS değişimi hacim veya sepet değerinden mi kaynaklanıyor?"],
    decisionGuide: ["ROAS tek başına değil satın alma hacmi ve marj bağlamıyla yorumlanır.", "Düşük örneklemde bütçe kararı verme."],
  },
};

export type AnalysisReadiness = Readonly<{
  ready: boolean;
  blockers: readonly string[];
  warnings: readonly string[];
  playbook: ObjectivePlaybook;
}>;

export function evaluateAnalysisReadiness(
  definition: AnalysisDefinition,
  availableMetrics: readonly AnalysisMetric[] = EXECUTABLE_ANALYSIS_METRICS,
): AnalysisReadiness {
  validateAnalysisDefinition(definition);
  const playbook = OBJECTIVE_PLAYBOOKS[definition.campaignContext.objective];
  const available = new Set(availableMetrics);
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (definition.campaignContext.classificationSource === "uncertain") blockers.push("Kampanya amacı kullanıcı tarafından doğrulanmalıdır.");
  if (!playbook.allowedFunnelStages.includes(definition.campaignContext.funnelStage)) {
    blockers.push(`${playbook.label} amacı ile ${definition.campaignContext.funnelStage} funnel aşaması uyumsuzdur.`);
  }
  if (!playbook.allowedOptimizationEvents.includes(definition.campaignContext.optimizationEvent)) {
    blockers.push(`${playbook.label} amacı ile ${definition.campaignContext.optimizationEvent} optimizasyon eventi uyumsuzdur.`);
  }
  const executablePrimary = playbook.primaryMetrics.filter((metric) => available.has(metric));
  if (executablePrimary.length === 0) blockers.push(`${playbook.label} amacının ana KPI'ları mevcut veri modelinde yok: ${playbook.primaryMetrics.join(", ")}.`);
  const ruleMetrics = new Set(definition.rules.filter((rule) => rule.enabled).map((rule) => rule.metric));
  if (!playbook.primaryMetrics.some((metric) => ruleMetrics.has(metric))) blockers.push("Etkin kurallardan en az biri kampanya amacının ana KPI'ını kapsamalıdır.");
  const missingDiagnostics = playbook.diagnosticMetrics.filter((metric) => !available.has(metric));
  if (missingDiagnostics.length > 0) warnings.push(`Teşhis derinliği için eksik metrikler: ${missingDiagnostics.join(", ")}.`);
  const missingSamples = playbook.minimumSamples.filter((sample) => !available.has(sample.metric));
  if (missingSamples.length > 0) blockers.push(`Minimum örnek kontrolü hesaplanamıyor: ${missingSamples.map((sample) => sample.metric).join(", ")}.`);
  return { ready: blockers.length === 0, blockers, warnings, playbook };
}

export function assertComparableObjectives(left: CampaignObjective, right: CampaignObjective): void {
  if (left !== right) throw new Error(`Farklı kampanya amaçları tek başarı hükmünde karşılaştırılamaz: ${left} / ${right}`);
}
