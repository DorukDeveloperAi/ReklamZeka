import { createHash } from "node:crypto";

/**
 * Draft-only commercial rule language for the operating model:
 * portfolio -> slice -> guardrail -> recommendation/approval -> verification.
 *
 * It intentionally does not create an ActionUnit, a policy, or a Meta write.
 * A later reviewed promotion may translate a rule into those bounded systems.
 */
export const SLICE_OPERATING_RULE_VERSION = "slice-operating-rule/1.0.0" as const;

export type SliceAutomationMode =
  | "observe_only"
  | "recommendation_only"
  | "approval_required"
  | "bounded_automatic_candidate";

export type CampaignSlice = Readonly<{
  market?: "domestic" | "international";
  language?: string;
  serviceRef?: string;
  countryOrRegion?: string;
  businessGoal?: "lead_acquisition" | "upper_funnel_education" | "market_service_learning";
  conversionRoute?: "lead_form" | "whatsapp" | "landing_page";
  campaignCategoryRef?: string;
}>;

export type SliceRule =
  | Readonly<{
    kind: "period_budget_cap";
    period: "daily" | "weekly" | "monthly";
    currency: string;
    maximumDecimal: string;
  }>
  | Readonly<{
    kind: "budget_distribution";
    dimension: "countryOrRegion" | "campaignCategory" | "conversionRoute";
    allocations: readonly Readonly<{ key: string; basisPoints: number }> [];
  }>
  | Readonly<{
    kind: "winner_continuation_rotation";
    metric: "qualified_leads" | "cost_per_qualified_lead" | "engagement_rate";
    continuationBasisPoints: number;
    explorationBasisPoints: number;
    evaluationWindowDays: number;
  }>
  | Readonly<{
    kind: "delivery_guardrail";
    condition: "delivery_interrupted" | "capacity_constrained" | "payment_or_account_review";
    response: "hold_recommendations" | "pause_candidate" | "needs_human_review";
  }>
  | Readonly<{
    /** Preserves a human-reviewed current distribution before any optimization. */
    kind: "targeting_budget_preservation";
    currency: string;
    totalDailyBudgetDecimal: string;
    allocations: readonly Readonly<{
      allocationRef: string;
      dailyBudgetDecimal: string;
      territory: string;
      countryCodes: readonly string[];
      platform: "ios" | "android" | "all_platforms" | "unknown";
      publisherPlatforms: readonly ("facebook" | "instagram")[] | null;
      audienceStrategy: string;
      targetingEvidence: "adset_name_inference" | "live_targeting_verified";
    }>[];
  }>;

export type SliceOperatingRuleDraft = Readonly<{
  version: typeof SLICE_OPERATING_RULE_VERSION;
  slice: CampaignSlice;
  rule: SliceRule;
  automationMode: SliceAutomationMode;
  priority: number;
  verification: Readonly<{
    metric: "qualified_leads" | "cost_per_qualified_lead" | "engagement_rate" | "delivery_health";
    reviewCadence: "daily" | "weekly" | "monthly";
    rollbackWhen: string;
  }>;
  requiresHumanReview: true;
  promotionRequired: true;
  authority: Readonly<{
    canPublish: false;
    canApprove: false;
    canExecute: false;
    canWriteMeta: false;
    canEnableAutomation: false;
  }>;
  draftHash: string;
}>;

export class SliceOperatingRuleError extends Error {
  constructor(readonly code: "invalid_input" | "invalid_slice" | "invalid_rule") {
    super(`Slice operating rule rejected: ${code}`);
    this.name = "SliceOperatingRuleError";
  }
}

const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const DECIMAL = /^(0|[1-9]\d{0,29})(?:\.\d{1,12})?$/;
const CURRENCY = /^[A-Z]{3}$/;
const AUTHORITY = Object.freeze({ canPublish: false as const, canApprove: false as const, canExecute: false as const,
  canWriteMeta: false as const, canEnableAutomation: false as const });

function fail(code: SliceOperatingRuleError["code"]): never { throw new SliceOperatingRuleError(code); }
function exact(value: unknown, keys: readonly string[], code: SliceOperatingRuleError["code"]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail(code);
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) fail(code);
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 160): string {
  if (typeof value !== "string" || value.trim() !== value || value.length < 1 || value.length > max || /\u0000/.test(value)) fail("invalid_input");
  return value;
}
function integer(value: unknown): number {
  if (!Number.isInteger(value)) fail("invalid_input");
  return value as number;
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, stable(child)]));
  return value;
}
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }

function normalizeSlice(value: unknown): CampaignSlice {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) fail("invalid_slice");
  const input = value as Record<string, unknown>;
  const allowed = ["market", "language", "serviceRef", "countryOrRegion", "businessGoal", "conversionRoute", "campaignCategoryRef"];
  if (Object.keys(input).some((key) => !allowed.includes(key))) fail("invalid_slice");
  const slice: Record<string, string> = {};
  if (input.market !== undefined) {
    if (input.market !== "domestic" && input.market !== "international") fail("invalid_slice");
    slice.market = input.market;
  }
  for (const key of ["language", "countryOrRegion"] as const) if (input[key] !== undefined) slice[key] = text(input[key], 120);
  for (const key of ["serviceRef", "campaignCategoryRef"] as const) {
    if (input[key] !== undefined) {
      const value = text(input[key]);
      if (!REF.test(value)) fail("invalid_slice");
      slice[key] = value;
    }
  }
  if (input.businessGoal !== undefined) {
    if (!["lead_acquisition", "upper_funnel_education", "market_service_learning"].includes(String(input.businessGoal))) fail("invalid_slice");
    slice.businessGoal = input.businessGoal as string;
  }
  if (input.conversionRoute !== undefined) {
    if (!["lead_form", "whatsapp", "landing_page"].includes(String(input.conversionRoute))) fail("invalid_slice");
    slice.conversionRoute = input.conversionRoute as string;
  }
  if (Object.keys(slice).length === 0) fail("invalid_slice");
  return Object.freeze(slice) as CampaignSlice;
}

function normalizeRule(value: unknown): SliceRule {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("invalid_rule");
  const kind = (value as Record<string, unknown>).kind;
  if (kind === "period_budget_cap") {
    const rule = exact(value, ["kind", "period", "currency", "maximumDecimal"], "invalid_rule");
    if (!["daily", "weekly", "monthly"].includes(String(rule.period)) || typeof rule.currency !== "string" || !CURRENCY.test(rule.currency)
      || typeof rule.maximumDecimal !== "string" || !DECIMAL.test(rule.maximumDecimal) || rule.maximumDecimal === "0") fail("invalid_rule");
    return Object.freeze({ kind, period: rule.period as "daily" | "weekly" | "monthly", currency: rule.currency, maximumDecimal: rule.maximumDecimal });
  }
  if (kind === "budget_distribution") {
    const rule = exact(value, ["kind", "dimension", "allocations"], "invalid_rule");
    if (!["countryOrRegion", "campaignCategory", "conversionRoute"].includes(String(rule.dimension)) || !Array.isArray(rule.allocations)
      || rule.allocations.length < 2 || rule.allocations.length > 50) fail("invalid_rule");
    const allocations = rule.allocations.map((item) => {
      const allocation = exact(item, ["key", "basisPoints"], "invalid_rule");
      const key = text(allocation.key); const basisPoints = integer(allocation.basisPoints);
      if (basisPoints < 0 || basisPoints > 10_000) fail("invalid_rule");
      return Object.freeze({ key, basisPoints });
    }).sort((left, right) => left.key.localeCompare(right.key));
    if (new Set(allocations.map((item) => item.key)).size !== allocations.length || allocations.reduce((sum, item) => sum + item.basisPoints, 0) !== 10_000) fail("invalid_rule");
    return Object.freeze({ kind, dimension: rule.dimension as "countryOrRegion" | "campaignCategory" | "conversionRoute", allocations: Object.freeze(allocations) });
  }
  if (kind === "winner_continuation_rotation") {
    const rule = exact(value, ["kind", "metric", "continuationBasisPoints", "explorationBasisPoints", "evaluationWindowDays"], "invalid_rule");
    const continuationBasisPoints = integer(rule.continuationBasisPoints);
    const explorationBasisPoints = integer(rule.explorationBasisPoints);
    const evaluationWindowDays = integer(rule.evaluationWindowDays);
    if (!["qualified_leads", "cost_per_qualified_lead", "engagement_rate"].includes(String(rule.metric))
      || continuationBasisPoints < 0 || explorationBasisPoints < 0
      || continuationBasisPoints + explorationBasisPoints !== 10_000
      || evaluationWindowDays < 1 || evaluationWindowDays > 90) fail("invalid_rule");
    return Object.freeze({ kind, metric: rule.metric as "qualified_leads" | "cost_per_qualified_lead" | "engagement_rate",
      continuationBasisPoints, explorationBasisPoints, evaluationWindowDays });
  }
  if (kind === "delivery_guardrail") {
    const rule = exact(value, ["kind", "condition", "response"], "invalid_rule");
    if (!["delivery_interrupted", "capacity_constrained", "payment_or_account_review"].includes(String(rule.condition))
      || !["hold_recommendations", "pause_candidate", "needs_human_review"].includes(String(rule.response))) fail("invalid_rule");
    return Object.freeze({ kind, condition: rule.condition as "delivery_interrupted" | "capacity_constrained" | "payment_or_account_review",
      response: rule.response as "hold_recommendations" | "pause_candidate" | "needs_human_review" });
  }
  if (kind === "targeting_budget_preservation") {
    const rule = exact(value, ["kind", "currency", "totalDailyBudgetDecimal", "allocations"], "invalid_rule");
    if (typeof rule.currency !== "string" || !CURRENCY.test(rule.currency) || typeof rule.totalDailyBudgetDecimal !== "string"
      || !DECIMAL.test(rule.totalDailyBudgetDecimal) || rule.totalDailyBudgetDecimal === "0" || !Array.isArray(rule.allocations)
      || rule.allocations.length < 1 || rule.allocations.length > 100) fail("invalid_rule");
    const allocations = rule.allocations.map((item) => {
      const allocation = exact(item, ["allocationRef", "dailyBudgetDecimal", "territory", "countryCodes", "platform", "publisherPlatforms", "audienceStrategy", "targetingEvidence"], "invalid_rule");
      const allocationRef = text(allocation.allocationRef);
      if (!REF.test(allocationRef) || typeof allocation.dailyBudgetDecimal !== "string" || !DECIMAL.test(allocation.dailyBudgetDecimal)
        || allocation.dailyBudgetDecimal === "0" || !["ios", "android", "all_platforms", "unknown"].includes(String(allocation.platform))
        || !["adset_name_inference", "live_targeting_verified"].includes(String(allocation.targetingEvidence))) fail("invalid_rule");
      if (!Array.isArray(allocation.countryCodes) || allocation.countryCodes.length < 1 || allocation.countryCodes.length > 250
        || allocation.countryCodes.some((code) => typeof code !== "string" || !/^[A-Z]{2}$/.test(code))
        || new Set(allocation.countryCodes).size !== allocation.countryCodes.length
        || allocation.publisherPlatforms !== null && (!Array.isArray(allocation.publisherPlatforms)
          || allocation.publisherPlatforms.length < 1 || allocation.publisherPlatforms.some((platform) => platform !== "facebook" && platform !== "instagram")
          || new Set(allocation.publisherPlatforms).size !== allocation.publisherPlatforms.length)) fail("invalid_rule");
      return Object.freeze({ allocationRef, dailyBudgetDecimal: allocation.dailyBudgetDecimal, territory: text(allocation.territory),
        countryCodes: Object.freeze([...allocation.countryCodes].sort()), platform: allocation.platform as "ios" | "android" | "all_platforms" | "unknown",
        publisherPlatforms: allocation.publisherPlatforms === null ? null : Object.freeze([...allocation.publisherPlatforms].sort()) as readonly ("facebook" | "instagram")[], audienceStrategy: text(allocation.audienceStrategy),
        targetingEvidence: allocation.targetingEvidence as "adset_name_inference" | "live_targeting_verified" });
    }).sort((left, right) => left.allocationRef.localeCompare(right.allocationRef));
    if (new Set(allocations.map((item) => item.allocationRef)).size !== allocations.length) fail("invalid_rule");
    const units = (value: string) => {
      const [whole, fraction = ""] = value.split("."); return BigInt(`${whole}${fraction.padEnd(12, "0")}`);
    };
    if (allocations.reduce((sum, item) => sum + units(item.dailyBudgetDecimal), 0n) !== units(rule.totalDailyBudgetDecimal)) fail("invalid_rule");
    return Object.freeze({ kind, currency: rule.currency, totalDailyBudgetDecimal: rule.totalDailyBudgetDecimal, allocations: Object.freeze(allocations) });
  }
  fail("invalid_rule");
}

/** Creates only a deterministic human-review draft; no action path is exposed. */
export function createSliceOperatingRuleDraft(input: Readonly<{
  slice: CampaignSlice;
  rule: SliceRule;
  automationMode: SliceAutomationMode;
  priority: number;
  verification: Readonly<{ metric: SliceOperatingRuleDraft["verification"]["metric"]; reviewCadence: SliceOperatingRuleDraft["verification"]["reviewCadence"]; rollbackWhen: string }>;
}>): SliceOperatingRuleDraft {
  const source = exact(input, ["slice", "rule", "automationMode", "priority", "verification"], "invalid_input");
  const slice = normalizeSlice(source.slice);
  const rule = normalizeRule(source.rule);
  const priority = integer(source.priority);
  if (!["observe_only", "recommendation_only", "approval_required", "bounded_automatic_candidate"].includes(String(source.automationMode))
    || priority < 0 || priority > 1000) fail("invalid_input");
  const verification = exact(source.verification, ["metric", "reviewCadence", "rollbackWhen"], "invalid_input");
  if (!["qualified_leads", "cost_per_qualified_lead", "engagement_rate", "delivery_health"].includes(String(verification.metric))
    || !["daily", "weekly", "monthly"].includes(String(verification.reviewCadence))) fail("invalid_input");
  const core = Object.freeze({ version: SLICE_OPERATING_RULE_VERSION, slice, rule, automationMode: source.automationMode as SliceAutomationMode,
    priority, verification: Object.freeze({ metric: verification.metric as SliceOperatingRuleDraft["verification"]["metric"],
      reviewCadence: verification.reviewCadence as SliceOperatingRuleDraft["verification"]["reviewCadence"], rollbackWhen: text(verification.rollbackWhen, 500) }),
    requiresHumanReview: true as const, promotionRequired: true as const, authority: AUTHORITY });
  return Object.freeze({ ...core, draftHash: digest(core) });
}
