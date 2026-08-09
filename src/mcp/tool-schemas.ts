import { z } from "zod/v4";

const ref = z.string().regex(/^[a-z][a-z0-9_.:-]{0,127}$/);
const publicRef = z.string().regex(/^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,94}$/);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const instant = z.string().datetime({ offset: true });
const nonnegative = z.number().int().nonnegative().safe();
const bps = z.number().int().min(0).max(10_000);
const optionalPage = { limit: z.number().int().min(1).max(100).optional(), cursor: z.string().nullable().optional() };

const selector = z.object({
  allocationRefs: z.array(ref).min(1).optional(),
  categoryRefs: z.array(ref).min(1).optional(),
  geoRefs: z.array(ref).min(1).optional(),
}).strict().refine((item) => Object.keys(item).length > 0);
const allocation = z.object({ ref, currentAmountMinor: nonnegative, categoryRef: ref,
  geoRef: ref, groupRefs: z.array(ref) }).strict();
const constraint = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("floor"), selector, amountMinor: nonnegative }).strict(),
  z.object({ kind: z.literal("cap"), selector, amountMinor: nonnegative }).strict(),
  z.object({ kind: z.literal("fixed"), selector, amountMinor: nonnegative.optional() }).strict(),
  z.object({ kind: z.literal("reserve"), amountMinor: nonnegative }).strict(),
  z.object({ kind: z.literal("transfer_allow"), from: selector, to: selector }).strict(),
  z.object({ kind: z.literal("transfer_deny"), from: selector, to: selector }).strict(),
  z.object({ kind: z.literal("transfer_only_within_group"), dimension: z.enum(["category", "geo", "group"]) }).strict(),
  z.object({ kind: z.literal("protected"), dimension: z.enum(["category", "geo"]), refs: z.array(ref).min(1),
    behavior: z.enum(["no_outflow", "fixed"]) }).strict(),
]);
const strategy = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("fixed"), targets: z.array(z.object({ ref, amountMinor: nonnegative }).strict()).min(1) }).strict(),
  z.object({ mode: z.literal("proportional"), weights: z.array(z.object({ ref, weight: z.number().int().positive().safe() }).strict()).min(1) }).strict(),
  z.object({ mode: z.literal("priority"), orderedRefs: z.array(ref).min(1) }).strict(),
  z.object({ mode: z.literal("ladder"), rungs: z.array(z.object({ ref, upToMinor: nonnegative }).strict()).min(1) }).strict(),
]);
const pacing = z.object({
  period: z.object({ startDate: z.string().date(), endDate: z.string().date(), timezone: z.string().min(1).max(128) }).strict(),
  asOfAt: instant,
  amounts: z.object({ currency: z.string().regex(/^[A-Z]{3}$/), plannedDecimal: z.string(), committedDecimal: z.string(),
    actualDecimal: z.string(), requestedCommitmentDecimal: z.string() }).strict(),
  signal: z.object({ kind: z.enum(["business_outcome", "proxy"]), metricRef: ref, sampleSize: nonnegative,
    coverageBps: bps, observedThroughAt: instant, retrievedAt: instant, learningPhase: z.boolean(),
    lastMaterialChangeAt: instant.nullable() }).strict(),
  policy: z.object({ moneyScale: z.number().int().min(0).max(12), moneyRounding: z.enum(["down", "up", "half_up", "half_even"]),
    minimumElapsedBps: bps, conservativeRemainingRateBps: bps, forecastMinimumDecimal: z.string(),
    forecastMaximumDecimal: z.string(), maximumFreshnessMinutes: nonnegative, minimumCoverageBps: bps,
    minimumSampleSize: nonnegative, attributionLagMinutes: nonnegative, suppressDuringLearning: z.boolean(),
    cooldownMinutes: nonnegative, allowProxyAction: z.boolean(), maximumChangeBps: bps,
    maximumChangeAbsoluteDecimal: z.string() }).strict(),
}).strict();
const scenario = z.object({ scenarioRef: ref, kind: z.enum(["keep", "conservative", "target_seeking"]),
  minorUnitScale: z.number().int().min(0).max(12), requestedBudgetMinor: nonnegative,
  allocations: z.array(allocation).min(1), constraints: z.array(constraint), strategy, pacing }).strict();

const outcomeTarget = z.object({ targetRef: ref, outcomeRef: ref, direction: z.enum(["maximize", "minimize", "maintain"]),
  targetValueDecimal: z.string(), unitRef: ref, timeframeRef: ref }).strict();
const proxyMapping = z.object({
  mappingRef: ref, outcomeRef: ref, timeframeRef: ref,
  proxy: z.object({ metricRef: ref, entityLevel: z.enum(["campaign", "adset", "ad"]),
    aggregation: z.enum(["sum", "average", "ratio"]), attributionWindowRef: ref }).strict(),
  scope: z.object({ categoryRefs: z.array(ref).min(1), objectiveRefs: z.array(ref).min(1) }).strict(),
  evidence: z.object({ sampleSize: nonnegative, coverageBps: bps, observedFromAt: instant, observedThroughAt: instant,
    retrievedAt: instant, proxyToOutcomeLagMinutes: nonnegative, confidenceBps: bps }).strict(),
  review: z.object({ status: z.enum(["pending", "approved", "rejected"]), reviewerRef: ref.nullable(),
    reviewedAt: instant.nullable(), reviewDueAt: instant }).strict(),
  provenance: z.object({ sourceKind: z.enum(["owner_instruction", "validated_observation", "external_research"]),
    sourceRef: ref, configuredByRef: ref, configuredAt: instant }).strict(),
}).strict();
const outcomeProxy = z.object({
  target: outcomeTarget,
  context: z.object({ categoryRef: ref, objectiveRef: ref }).strict(),
  asOfAt: instant,
  mappings: z.array(proxyMapping),
  policy: z.object({ minimumSampleSize: nonnegative, minimumCoverageBps: bps, maximumLagMinutes: nonnegative,
    minimumConfidenceBps: bps, maximumEvidenceFreshnessMinutes: nonnegative }).strict(),
}).strict();
const budgetCommand = z.object({
  scope: z.object({ adAccountId: z.string().uuid(), campaignId: z.string().uuid(), contextHash: hash }).strict(),
  seriesRef: ref, revision: z.number().int().positive(), previousProposalHash: z.union([z.literal("GENESIS"), hash]),
  idempotencyKey: ref, createdAt: instant, scenarios: z.array(scenario).min(1).max(3), outcomeProxy: outcomeProxy.nullable(),
}).strict();

const promotionSelection = z.object({
  accountRef: publicRef, adSetRef: publicRef, actorRef: publicRef, postRef: publicRef,
  promotionTemplateRef: publicRef, audiencePresetRef: publicRef, budgetPlanRef: publicRef,
  timeframeRef: publicRef, objectiveRef: publicRef, internalCategoryRef: publicRef,
}).strict();

const guidanceEntity = z.object({
  type: z.enum(["campaign", "ad_set", "ad", "creative", "post"]),
  ref: publicRef,
}).strict();
const guidanceTimeframe = z.object({
  ref: publicRef,
  kind: z.enum(["rolling", "fixed", "calendar", "lifetime", "learning", "action_relative"]),
}).strict();
const guidanceBudget = z.object({
  maxCards: z.number().int().min(1).max(100),
  maxSources: z.number().int().min(1).max(100),
  maxCharacters: z.number().int().min(1).max(100_000),
}).strict();
const guidanceTopic = z.string().regex(/^[a-z][a-z0-9_.:-]{0,79}$/);
const uniqueArray = <T>(schema: z.ZodType<T>, max: number) => z.array(schema).max(max)
  .refine((items) => new Set(items).size === items.length, { message: "refs must be unique" });

export const MCP_TOOL_SCHEMAS = Object.freeze({
  register_agent_session: z.object({}).strict(),
  heartbeat_agent_session: z.object({}).strict(),
  get_handoff_context: z.object({ handoffRef: z.string().regex(/^handoff_[a-f0-9]{32}$/) }).strict(),
  decision_room_list: z.object({ view: z.enum(["schedules", "runs", "inbox"]), ...optionalPage }).strict(),
  decision_room_mark_inbox_read: z.object({ notificationRef: z.string().min(1).max(128) }).strict(),
  approval_queue_list: z.object(optionalPage).strict(),
  approval_queue_get: z.object({ unitRef: z.string().regex(/^action_unit_[a-f0-9]{20}$/) }).strict(),
  policy_bundle_read: z.object({}).strict(),
  budget_lab_list: z.object(optionalPage).strict(),
  budget_lab_get: z.object({ seriesRef: ref, revision: z.number().int().positive().optional() }).strict(),
  budget_lab_dry_run: z.object({ command: budgetCommand }).strict(),
  budget_lab_save_draft: z.object({ command: budgetCommand }).strict(),
  practice_lab_list: z.object(optionalPage).strict(),
  practice_lab_get: z.object({ practiceRef: z.string().regex(/^practice_[a-z0-9][a-z0-9_-]{0,86}$/) }).strict(),
  practice_lab_prepare_draft: z.object({ practiceRef: z.string().regex(/^practice_[a-z0-9][a-z0-9_-]{0,86}$/) }).strict(),
  guidance_registry_list: z.object({ status: z.enum(["draft", "published", "archived"]).optional() }).strict(),
  guidance_effective_preview: z.object({
    accountRef: publicRef,
    accountGroupRefs: uniqueArray(publicRef, 25),
    objective: z.string().regex(/^[A-Z][A-Z0-9_]{1,79}$/).nullable(),
    funnel: guidanceTopic.nullable(),
    optimization: z.string().regex(/^[A-Z][A-Z0-9_]{1,79}$/).nullable(),
    internalCategoryRefs: uniqueArray(z.string().regex(/^category_[a-f0-9]{24}$/), 100),
    lifecycle: guidanceTopic.nullable(),
    entity: guidanceEntity.nullable(),
    promotionTemplateRefs: uniqueArray(publicRef, 50),
    topics: uniqueArray(guidanceTopic, 100),
    requiredTopics: uniqueArray(guidanceTopic, 100),
    evaluatedAt: instant,
    timeframe: guidanceTimeframe,
    budget: guidanceBudget.optional(),
  }).strict(),
  existing_post_promotion_preflight: promotionSelection,
});

export type ReklamZekaMcpToolName = keyof typeof MCP_TOOL_SCHEMAS;
