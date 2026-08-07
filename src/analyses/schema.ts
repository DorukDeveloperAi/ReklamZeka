export const CAMPAIGN_OBJECTIVES = [
  "awareness",
  "traffic",
  "engagement",
  "lead_generation",
  "app_growth",
  "sales",
] as const;

export const FUNNEL_STAGES = ["awareness", "consideration", "conversion", "retention"] as const;
export const CLASSIFICATION_SOURCES = ["user_confirmed", "platform_mapping", "uncertain"] as const;
export const OPTIMIZATION_EVENTS = [
  "impressions",
  "reach",
  "link_click",
  "landing_page_view",
  "engagement",
  "lead",
  "qualified_lead",
  "app_install",
  "purchase",
  "conversion_value",
] as const;

export const ANALYSIS_METRICS = [
  "spendMinor",
  "impressions",
  "clicks",
  "conversions",
  "conversionValueMinor",
  "ctr",
  "cpcMinor",
  "cpmMinor",
  "cpaMinor",
  "roas",
  "reach",
  "frequency",
  "landingPageViews",
  "engagements",
  "engagementRate",
  "cpeMinor",
  "leads",
  "qualifiedLeads",
  "qualifiedLeadRate",
  "cplMinor",
  "messages",
  "costPerMessageMinor",
  "appInstalls",
  "cpiMinor",
  "retentionD7",
  "purchases",
  "revenueMinor",
  "conversionRate",
  "averageOrderValueMinor",
] as const;

export const EXECUTABLE_ANALYSIS_METRICS = [
  "spendMinor",
  "impressions",
  "clicks",
  "conversions",
  "conversionValueMinor",
  "ctr",
  "cpaMinor",
  "roas",
] as const satisfies readonly AnalysisMetric[];

export const RULE_OPERATORS = ["gt", "gte", "lt", "lte", "change_gt", "change_lt"] as const;

export type CampaignObjective = (typeof CAMPAIGN_OBJECTIVES)[number];
export type FunnelStage = (typeof FUNNEL_STAGES)[number];
export type ClassificationSource = (typeof CLASSIFICATION_SOURCES)[number];
export type OptimizationEvent = (typeof OPTIMIZATION_EVENTS)[number];
export type AnalysisMetric = (typeof ANALYSIS_METRICS)[number];
export type RuleOperator = (typeof RULE_OPERATORS)[number];

export type CampaignContext = Readonly<{
  objective: CampaignObjective;
  funnelStage: FunnelStage;
  optimizationEvent: OptimizationEvent;
  classificationSource: ClassificationSource;
}>;

export type AnalysisRule = Readonly<{
  id: string;
  name: string;
  metric: AnalysisMetric;
  operator: RuleOperator;
  threshold: number;
  minimumSample: Readonly<{ metric: AnalysisMetric; value: number }>;
  severity: "info" | "warning" | "critical";
  enabled: boolean;
}>;

export type AnalysisTimeframe =
  | Readonly<{ kind: "rolling"; days: number; timezone: string }>
  | Readonly<{ kind: "fixed"; startDate: string; endDate: string; timezone: string }>
  | Readonly<{ kind: "calendar"; unit: "week" | "month" | "quarter"; offset: number; timezone: string }>
  | Readonly<{ kind: "lifetime"; timezone: string }>
  | Readonly<{ kind: "learning"; timezone: string }>
  | Readonly<{ kind: "action_relative"; beforeDays: number; afterDays: number; timezone: string }>;

export type AnalysisComparison = "previous_period" | "previous_year" | "weekday_matched" | "none";

export type AnalysisSchedule =
  | Readonly<{ frequency: "manual" }>
  | Readonly<{
    frequency: "hourly";
    minute: number;
    timezone: string;
    enabled: boolean;
    misfirePolicy: "skip" | "run_once";
  }>
  | Readonly<{
    frequency: "daily";
    at: string;
    timezone: string;
    enabled: boolean;
    misfirePolicy: "skip" | "run_once";
  }>
  | Readonly<{
    frequency: "weekly";
    dayOfWeek: number;
    at: string;
    timezone: string;
    enabled: boolean;
    misfirePolicy: "skip" | "run_once";
  }>
  | Readonly<{
    frequency: "monthly";
    dayOfMonth: number;
    at: string;
    timezone: string;
    enabled: boolean;
    misfirePolicy: "skip" | "run_once";
  }>;

export type NarrativeConfiguration = Readonly<{
  mode: "disabled" | "narrative_only";
  userGuidance: string;
  tone: "concise" | "balanced" | "detailed";
  sections: readonly ("summary" | "findings" | "recommendations" | "caveats")[];
}>;

export type AnalysisDefinition = Readonly<{
  id: string;
  workspaceId: string;
  ownerId: string;
  version: number;
  status: "draft" | "published" | "archived";
  name: string;
  campaignContext: CampaignContext;
  timeframe: AnalysisTimeframe;
  comparison: AnalysisComparison;
  rules: readonly AnalysisRule[];
  schedule: AnalysisSchedule;
  narrative: NarrativeConfiguration;
}>;

export class AnalysisDefinitionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalysisDefinitionValidationError";
  }
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function requireExactKeys(value: object, allowed: readonly string[], label: string): void {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unexpected.length > 0) throw new AnalysisDefinitionValidationError(`${label} bilinmeyen alan taşıyor: ${unexpected.join(", ")}`);
}

function isOneOf<T extends readonly string[]>(value: unknown, allowed: T): value is T[number] {
  return typeof value === "string" && allowed.includes(value as T[number]);
}

function isCalendarDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function isValidIanaTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    return timezone.includes("/") || timezone === "UTC";
  } catch {
    return false;
  }
}

function validateTimeframe(timeframe: AnalysisTimeframe): void {
  if (!isValidIanaTimezone(timeframe.timezone)) throw new AnalysisDefinitionValidationError("Timeframe geçerli bir IANA timezone taşımalıdır");
  if (timeframe.kind === "rolling") {
    requireExactKeys(timeframe, ["kind", "days", "timezone"], "Rolling timeframe");
    if (!Number.isInteger(timeframe.days) || timeframe.days < 1 || timeframe.days > 365) {
      throw new AnalysisDefinitionValidationError("Rolling timeframe 1–365 gün olmalıdır");
    }
  } else if (timeframe.kind === "fixed") {
    requireExactKeys(timeframe, ["kind", "startDate", "endDate", "timezone"], "Fixed timeframe");
    if (!isCalendarDate(timeframe.startDate) || !isCalendarDate(timeframe.endDate) || timeframe.startDate > timeframe.endDate) {
      throw new AnalysisDefinitionValidationError("Fixed timeframe geçerli ve sıralı tarihler taşımalıdır");
    }
  } else if (timeframe.kind === "calendar") {
    requireExactKeys(timeframe, ["kind", "unit", "offset", "timezone"], "Calendar timeframe");
    if (!["week", "month", "quarter"].includes(timeframe.unit) || !Number.isInteger(timeframe.offset) || timeframe.offset > 0 || timeframe.offset < -24) {
      throw new AnalysisDefinitionValidationError("Calendar timeframe unit ve offset değeri geçersizdir");
    }
  } else if (timeframe.kind === "lifetime" || timeframe.kind === "learning") {
    requireExactKeys(timeframe, ["kind", "timezone"], `${timeframe.kind} timeframe`);
  } else {
    requireExactKeys(timeframe, ["kind", "beforeDays", "afterDays", "timezone"], "Action-relative timeframe");
    if (!Number.isInteger(timeframe.beforeDays) || timeframe.beforeDays < 0 || timeframe.beforeDays > 365 ||
        !Number.isInteger(timeframe.afterDays) || timeframe.afterDays < 0 || timeframe.afterDays > 365 ||
        timeframe.beforeDays + timeframe.afterDays < 1) {
      throw new AnalysisDefinitionValidationError("Action-relative timeframe günleri 0–365 aralığında ve toplamda pozitif olmalıdır");
    }
  }
}

function validateSchedule(schedule: AnalysisSchedule): void {
  if (schedule.frequency === "manual") {
    requireExactKeys(schedule, ["frequency"], "Manual schedule");
    return;
  }
  if (!isValidIanaTimezone(schedule.timezone)) throw new AnalysisDefinitionValidationError("Schedule geçerli bir IANA timezone taşımalıdır");
  if (!["skip", "run_once"].includes(schedule.misfirePolicy)) throw new AnalysisDefinitionValidationError("Misfire policy geçersizdir");
  if (typeof schedule.enabled !== "boolean") throw new AnalysisDefinitionValidationError("Schedule enabled boolean olmalıdır");
  if (schedule.frequency === "hourly") {
    requireExactKeys(schedule, ["frequency", "minute", "timezone", "enabled", "misfirePolicy"], "Hourly schedule");
    if (!Number.isInteger(schedule.minute) || schedule.minute < 0 || schedule.minute > 59) throw new AnalysisDefinitionValidationError("Hourly minute 0–59 olmalıdır");
    return;
  }
  const allowed = ["frequency", "at", "timezone", "enabled", "misfirePolicy"];
  if (schedule.frequency === "weekly") allowed.push("dayOfWeek");
  if (schedule.frequency === "monthly") allowed.push("dayOfMonth");
  requireExactKeys(schedule, allowed, `${schedule.frequency} schedule`);
  if (!TIME_PATTERN.test(schedule.at)) throw new AnalysisDefinitionValidationError("Schedule saati HH:mm olmalıdır");
  if (schedule.frequency === "weekly" && (!Number.isInteger(schedule.dayOfWeek) || schedule.dayOfWeek < 1 || schedule.dayOfWeek > 7)) {
    throw new AnalysisDefinitionValidationError("Haftanın günü 1–7 olmalıdır");
  }
  if (schedule.frequency === "monthly" && (!Number.isInteger(schedule.dayOfMonth) || schedule.dayOfMonth < 1 || schedule.dayOfMonth > 28)) {
    throw new AnalysisDefinitionValidationError("Ayın günü 1–28 olmalıdır");
  }
}

export function validateAnalysisDefinition(definition: AnalysisDefinition): AnalysisDefinition {
  requireExactKeys(definition, ["id", "workspaceId", "ownerId", "version", "status", "name", "campaignContext", "timeframe", "comparison", "rules", "schedule", "narrative"], "Analiz tanımı");
  if (!definition.id || !definition.workspaceId || !definition.ownerId || !definition.name.trim()) throw new AnalysisDefinitionValidationError("Kimlik, workspace, owner ve ad zorunludur");
  if (!Number.isInteger(definition.version) || definition.version < 1) throw new AnalysisDefinitionValidationError("Sürüm pozitif tamsayı olmalıdır");
  if (!["draft", "published", "archived"].includes(definition.status)) throw new AnalysisDefinitionValidationError("Durum geçersizdir");
  requireExactKeys(definition.campaignContext, ["objective", "funnelStage", "optimizationEvent", "classificationSource"], "Kampanya bağlamı");
  if (!isOneOf(definition.campaignContext.objective, CAMPAIGN_OBJECTIVES) ||
      !isOneOf(definition.campaignContext.funnelStage, FUNNEL_STAGES) ||
      !isOneOf(definition.campaignContext.optimizationEvent, OPTIMIZATION_EVENTS) ||
      !isOneOf(definition.campaignContext.classificationSource, CLASSIFICATION_SOURCES)) {
    throw new AnalysisDefinitionValidationError("Kampanya bağlamı allowlist dışı değer taşıyor");
  }
  if (definition.status === "published" && definition.campaignContext.classificationSource === "uncertain") {
    throw new AnalysisDefinitionValidationError("Belirsiz kampanya sınıflandırması yayınlanamaz");
  }
  if (!["previous_period", "previous_year", "weekday_matched", "none"].includes(definition.comparison)) throw new AnalysisDefinitionValidationError("Karşılaştırma politikası geçersizdir");
  validateTimeframe(definition.timeframe);
  validateSchedule(definition.schedule);
  const ruleIds = new Set<string>();
  for (const rule of definition.rules) {
    requireExactKeys(rule, ["id", "name", "metric", "operator", "threshold", "minimumSample", "severity", "enabled"], "Analiz kuralı");
    requireExactKeys(rule.minimumSample, ["metric", "value"], "Minimum sample");
    if (!rule.id || !rule.name.trim() || ruleIds.has(rule.id)) throw new AnalysisDefinitionValidationError("Kural kimlikleri dolu ve benzersiz olmalıdır");
    ruleIds.add(rule.id);
    if (!isOneOf(rule.metric, ANALYSIS_METRICS) || !isOneOf(rule.minimumSample.metric, ANALYSIS_METRICS) || !isOneOf(rule.operator, RULE_OPERATORS)) {
      throw new AnalysisDefinitionValidationError("Kural metric/operator allowlist dışında");
    }
    if (!Number.isFinite(rule.threshold) || !Number.isFinite(rule.minimumSample.value) || rule.minimumSample.value < 0) {
      throw new AnalysisDefinitionValidationError("Kural eşiği ve minimum sample sonlu sayı olmalıdır");
    }
    if (!["info", "warning", "critical"].includes(rule.severity) || typeof rule.enabled !== "boolean") throw new AnalysisDefinitionValidationError("Kural severity/enabled geçersizdir");
  }
  requireExactKeys(definition.narrative, ["mode", "userGuidance", "tone", "sections"], "Narrative ayarı");
  if (!["disabled", "narrative_only"].includes(definition.narrative.mode) || !["concise", "balanced", "detailed"].includes(definition.narrative.tone)) {
    throw new AnalysisDefinitionValidationError("Narrative mode/tone geçersizdir");
  }
  if (definition.narrative.userGuidance.length > 4_000) throw new AnalysisDefinitionValidationError("Kullanıcı anlatım talimatı 4000 karakteri aşamaz");
  const allowedSections = ["summary", "findings", "recommendations", "caveats"];
  if (definition.narrative.sections.some((section) => !allowedSections.includes(section))) throw new AnalysisDefinitionValidationError("Narrative bölümü geçersizdir");
  return definition;
}
