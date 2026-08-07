import { createHash } from "node:crypto";

import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import {
  evaluateExistingPostPromotionEligibility,
  type EligibilityFact,
  type ExistingPostLifecycle,
  type PromotionActorType,
  type PromotionCapability,
} from "@/domain/meta/promotion/existing-post-eligibility";

export const EXISTING_POST_PROMOTION_PUBLIC_PREFLIGHT_VERSION = "existing-post-promotion-public-preflight/1.0.0" as const;

export type ExistingPostPromotionPreflightRequest = Readonly<{
  accountRef: string;
  adSetRef: string;
  actorRef: string;
  postRef: string;
  promotionTemplateRef: string;
  audiencePresetRef: string;
  budgetPlanRef: string;
  timeframeRef: string;
  objectiveRef: string;
  internalCategoryRef: string;
}>;

type ResourceState = "active" | "inactive" | "unknown";

export type ExistingPostPromotionPreflightContext = Readonly<{
  workspaceId: string;
  workspaceRef: string;
  account: Readonly<{ ref: string; externalId: string; ownership: EligibilityFact }>;
  adSet: Readonly<{ ref: string; accountRef: string; campaignRef: string; state: ResourceState }>;
  actor: Readonly<{
    ref: string;
    type: PromotionActorType;
    externalId: string;
    ownership: EligibilityFact;
    permission: EligibilityFact;
    advertisingCapability: PromotionCapability;
  }>;
  post: Readonly<{
    ref: string;
    actorRef: string;
    identity: "known" | "missing" | "unknown";
    externalPostId: string | null;
    actorExternalId: string | null;
    lifecycle: ExistingPostLifecycle;
    contentHash: string | null;
    promotionCapability: PromotionCapability;
  }>;
  template: Readonly<{
    ref: string;
    state: ResourceState;
    requiredAudiencePresetRef: string;
    accountRefs: readonly string[];
    actorRefs: readonly string[];
    internalCategoryRefs: readonly string[];
    objectiveRefs: readonly string[];
    actorTypes: readonly Exclude<PromotionActorType, "unsupported">[];
    budgetKinds: readonly ("daily" | "lifetime")[];
    currencies: readonly string[];
    minimumBudgetMinor: number | null;
    maximumBudgetMinor: number | null;
    minimumDurationDays: number;
    maximumDurationDays: number;
    compatibility: Readonly<{
      destination: EligibilityFact;
      optimization: EligibilityFact;
      placement: EligibilityFact;
      specialCategory: EligibilityFact;
      tracking: EligibilityFact;
    }>;
  }>;
  audiencePreset: Readonly<{
    ref: string;
    state: ResourceState;
    accountRefs: readonly string[];
    actorTypes: readonly Exclude<PromotionActorType, "unsupported">[];
    internalCategoryRefs: readonly string[];
  }>;
  budgetPlan: Readonly<{
    ref: string;
    state: ResourceState;
    kind: "daily" | "lifetime";
    currency: string;
    amountMinor: number;
  }>;
  timeframe: Readonly<{
    ref: string;
    state: ResourceState;
    scheduleMode: "continuous" | "fixed_duration";
    startAt: string | null;
    endAt: string | null;
    timezone: string;
    durationDays: number | null;
  }>;
  objective: Readonly<{ ref: string; state: ResourceState }>;
  internalCategory: Readonly<{ ref: string; state: ResourceState }>;
  guidance: readonly Readonly<{
    guidanceRef: string;
    state: "active" | "inactive";
    disposition: "allow" | "block" | "review_required";
    reasonCode: string;
    objectiveRefs: readonly string[];
    internalCategoryRefs: readonly string[];
  }>[];
}>;

export type ExistingPostPromotionPreflightRepository = Readonly<{
  resolve(input: Readonly<{
    workspaceId: string;
    workspaceRef: string;
    request: ExistingPostPromotionPreflightRequest;
  }>): Promise<ExistingPostPromotionPreflightContext | null>;
}>;

export type PromotionPreflightReason = Readonly<{
  code: string;
  source: "binding" | "meta_eligibility" | "ad_set" | "template" | "audience_preset" | "budget_plan" | "timeframe" | "objective" | "internal_category" | "guidance";
  disposition: "blocked" | "unknown";
}>;

export type ExistingPostPromotionPreflightResult = Readonly<{
  contractVersion: typeof EXISTING_POST_PROMOTION_PUBLIC_PREFLIGHT_VERSION;
  status: "ready_for_approval_proposal" | "blocked" | "unknown";
  selection: ExistingPostPromotionPreflightRequest;
  reasons: readonly PromotionPreflightReason[];
  proposalPreview: Readonly<{
    previewRef: string;
    actionType: "existing_post_promotion";
    risk: "K4";
    disposition: "approval_required";
    actorType: "page" | "instagram";
    postFingerprintRef: string;
    budget: Readonly<{ kind: "daily" | "lifetime"; currency: string; amountMinor: number }>;
    timeframe: Readonly<{
      scheduleMode: "continuous" | "fixed_duration";
      startAt: string;
      endAt: string | null;
      timezone: string;
      durationDays: number | null;
    }>;
  }> | null;
  authority: Readonly<{
    ephemeral: true;
    canPersistProposal: false;
    canApprove: false;
    canExecute: false;
    canWriteMeta: false;
    canGenerateCreative: false;
  }>;
}>;

export class ExistingPostPromotionPublicPreflightError extends Error {
  constructor(readonly code: "invalid_input" | "not_found" | "unsafe_source" | "source_unavailable") {
    super("Mevcut gönderi öne çıkarma ön kontrolü güvenli biçimde tamamlanamadı");
    this.name = "ExistingPostPromotionPublicPreflightError";
  }
}

const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,94}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH = /^[a-f0-9]{64}$/i;
const CODE = /^[a-z][a-z0-9_.:-]{0,127}$/;
const AUTHORITY = Object.freeze({
  ephemeral: true as const, canPersistProposal: false as const, canApprove: false as const,
  canExecute: false as const, canWriteMeta: false as const, canGenerateCreative: false as const,
});

function fail(code: ExistingPostPromotionPublicPreflightError["code"]): never { throw new ExistingPostPromotionPublicPreflightError(code); }
function exact(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) fail("invalid_input");
}
function exactSource(value: unknown, keys: readonly string[]): asserts value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) fail("unsafe_source");
}
function reference(value: unknown): string {
  if (typeof value !== "string" || !REF.test(value) || /(token|secret|prompt|raw)/i.test(value)) fail("invalid_input");
  return value;
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([key, child]) => [key, stable(child)]));
  return value;
}
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function iso(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail("unsafe_source");
  return value;
}
function days(start: string, end: string): number {
  const duration = (Date.parse(end) - Date.parse(start)) / 86_400_000;
  if (!Number.isInteger(duration) || duration < 1 || duration > 366) fail("unsafe_source");
  return duration;
}
function reason(code: string, source: PromotionPreflightReason["source"], disposition: PromotionPreflightReason["disposition"]): PromotionPreflightReason {
  if (!CODE.test(code)) fail("unsafe_source");
  return Object.freeze({ code, source, disposition });
}
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function refList(value: unknown, maximum = 100): asserts value is readonly string[] {
  if (!Array.isArray(value) || value.length > maximum || new Set(value).size !== value.length
    || value.some((item) => typeof item !== "string" || !REF.test(item))) fail("unsafe_source");
}

function validateContext(value: ExistingPostPromotionPreflightContext): void {
  exactSource(value, ["workspaceId", "workspaceRef", "account", "adSet", "actor", "post", "template", "audiencePreset", "budgetPlan", "timeframe", "objective", "internalCategory", "guidance"]);
  exactSource(value.account, ["ref", "externalId", "ownership"]);
  exactSource(value.adSet, ["ref", "accountRef", "campaignRef", "state"]);
  exactSource(value.actor, ["ref", "type", "externalId", "ownership", "permission", "advertisingCapability"]);
  exactSource(value.post, ["ref", "actorRef", "identity", "externalPostId", "actorExternalId", "lifecycle", "contentHash", "promotionCapability"]);
  exactSource(value.template, ["ref", "state", "requiredAudiencePresetRef", "accountRefs", "actorRefs", "internalCategoryRefs", "objectiveRefs", "actorTypes", "budgetKinds", "currencies", "minimumBudgetMinor", "maximumBudgetMinor", "minimumDurationDays", "maximumDurationDays", "compatibility"]);
  exactSource(value.template.compatibility, ["destination", "optimization", "placement", "specialCategory", "tracking"]);
  exactSource(value.audiencePreset, ["ref", "state", "accountRefs", "actorTypes", "internalCategoryRefs"]);
  exactSource(value.budgetPlan, ["ref", "state", "kind", "currency", "amountMinor"]);
  exactSource(value.timeframe, ["ref", "state", "scheduleMode", "startAt", "endAt", "timezone", "durationDays"]);
  exactSource(value.objective, ["ref", "state"]);
  exactSource(value.internalCategory, ["ref", "state"]);
  for (const item of [value.account.ref, value.adSet.ref, value.adSet.accountRef, value.adSet.campaignRef, value.actor.ref, value.post.ref, value.post.actorRef, value.template.ref,
    value.audiencePreset.ref, value.budgetPlan.ref, value.timeframe.ref, value.objective.ref, value.internalCategory.ref]) {
    if (typeof item !== "string" || !REF.test(item)) fail("unsafe_source");
  }
  const safeExternal = (item: unknown) => typeof item === "string" && item.length > 0 && item.length <= 160
    && !/(?:Bearer\s+|access[_-]?token|secret|prompt|raw[_-]?(?:payload|json))/i.test(item);
  if (!safeExternal(value.account.externalId) || !safeExternal(value.actor.externalId)
    || value.post.externalPostId !== null && !safeExternal(value.post.externalPostId)
    || value.post.actorExternalId !== null && !safeExternal(value.post.actorExternalId)
    || value.post.contentHash !== null && !HASH.test(value.post.contentHash)) fail("unsafe_source");
  if (!(["confirmed", "rejected", "unknown"] as const).includes(value.account.ownership)
    || !(["confirmed", "rejected", "unknown"] as const).includes(value.actor.ownership)
    || !(["confirmed", "rejected", "unknown"] as const).includes(value.actor.permission)
    || !(["page", "instagram", "unsupported"] as const).includes(value.actor.type)
    || !(["supported", "denied", "unsupported", "unknown"] as const).includes(value.actor.advertisingCapability)
    || !(["supported", "denied", "unsupported", "unknown"] as const).includes(value.post.promotionCapability)
    || !(["known", "missing", "unknown"] as const).includes(value.post.identity)
    || !(["published", "not_published", "deleted", "unknown"] as const).includes(value.post.lifecycle)) fail("unsafe_source");
  for (const state of [value.adSet.state, value.template.state, value.audiencePreset.state, value.budgetPlan.state,
    value.timeframe.state, value.objective.state, value.internalCategory.state]) {
    if (!(["active", "inactive", "unknown"] as const).includes(state)) fail("unsafe_source");
  }
  if (!REF.test(value.template.requiredAudiencePresetRef)) fail("unsafe_source");
  refList(value.template.accountRefs); refList(value.template.actorRefs); refList(value.template.internalCategoryRefs);
  refList(value.template.objectiveRefs); refList(value.audiencePreset.accountRefs); refList(value.audiencePreset.internalCategoryRefs);
  if (!Array.isArray(value.template.actorTypes) || value.template.actorTypes.some((item) => item !== "page" && item !== "instagram")
    || !Array.isArray(value.audiencePreset.actorTypes) || value.audiencePreset.actorTypes.some((item) => item !== "page" && item !== "instagram")
    || !Array.isArray(value.template.budgetKinds) || value.template.budgetKinds.some((item) => item !== "daily" && item !== "lifetime")
    || !Array.isArray(value.template.currencies) || value.template.currencies.some((item) => typeof item !== "string" || !/^[A-Z]{3}$/.test(item))
    || value.template.minimumBudgetMinor !== null && (!Number.isSafeInteger(value.template.minimumBudgetMinor) || value.template.minimumBudgetMinor < 0)
    || value.template.maximumBudgetMinor !== null && (!Number.isSafeInteger(value.template.maximumBudgetMinor) || value.template.maximumBudgetMinor < 0)
    || value.template.minimumBudgetMinor !== null && value.template.maximumBudgetMinor !== null
      && value.template.maximumBudgetMinor < value.template.minimumBudgetMinor
    || !Number.isSafeInteger(value.template.minimumDurationDays) || value.template.minimumDurationDays < 1
    || !Number.isSafeInteger(value.template.maximumDurationDays) || value.template.maximumDurationDays < value.template.minimumDurationDays
    || !["daily", "lifetime"].includes(value.budgetPlan.kind) || !/^[A-Z]{3}$/.test(value.budgetPlan.currency)
    || !Number.isSafeInteger(value.budgetPlan.amountMinor) || value.budgetPlan.amountMinor < 0
    || !["continuous", "fixed_duration"].includes(value.timeframe.scheduleMode)
    || value.timeframe.durationDays !== null && (!Number.isSafeInteger(value.timeframe.durationDays)
      || value.timeframe.durationDays < 1 || value.timeframe.durationDays > 366)
    || !Array.isArray(value.guidance) || value.guidance.length > 100) fail("unsafe_source");
  for (const fact of Object.values(value.template.compatibility)) {
    if (fact !== "confirmed" && fact !== "rejected" && fact !== "unknown") fail("unsafe_source");
  }
  for (const rule of value.guidance) {
    exactSource(rule, ["guidanceRef", "state", "disposition", "reasonCode", "objectiveRefs", "internalCategoryRefs"]);
    if (typeof rule.guidanceRef !== "string" || !REF.test(rule.guidanceRef)
      || typeof rule.state !== "string" || !["active", "inactive"].includes(rule.state)
      || typeof rule.disposition !== "string" || !["allow", "block", "review_required"].includes(rule.disposition)
      || typeof rule.reasonCode !== "string" || !CODE.test(rule.reasonCode)) fail("unsafe_source");
    refList(rule.objectiveRefs); refList(rule.internalCategoryRefs);
  }
}

function validateRequest(value: ExistingPostPromotionPreflightRequest): ExistingPostPromotionPreflightRequest {
  exact(value, ["accountRef", "adSetRef", "actorRef", "postRef", "promotionTemplateRef", "audiencePresetRef", "budgetPlanRef", "timeframeRef", "objectiveRef", "internalCategoryRef"]);
  for (const selected of Object.values(value)) reference(selected);
  return deepFreeze({ ...value });
}

function stateReason(state: ResourceState, source: PromotionPreflightReason["source"], code: string, output: PromotionPreflightReason[]) {
  if (state === "inactive") output.push(reason(`${code}.inactive`, source, "blocked"));
  if (state === "unknown") output.push(reason(`${code}.unknown`, source, "unknown"));
}

export class ExistingPostPromotionPublicPreflightService {
  constructor(private readonly repository: ExistingPostPromotionPreflightRepository) {}

  async evaluate(principal: TrustedDecisionRoomPrincipal, requested: ExistingPostPromotionPreflightRequest): Promise<ExistingPostPromotionPreflightResult> {
    const selection = validateRequest(requested);
    if (!UUID.test(principal.workspaceId) || !REF.test(principal.workspaceRef)) fail("invalid_input");
    let context: ExistingPostPromotionPreflightContext | null;
    try {
      context = await this.repository.resolve({ workspaceId: principal.workspaceId, workspaceRef: principal.workspaceRef, request: selection });
    } catch { fail("source_unavailable"); }
    if (!context) fail("not_found");
    validateContext(context);
    if (context.workspaceId !== principal.workspaceId || context.workspaceRef !== principal.workspaceRef) fail("unsafe_source");
    const pairs: readonly [string, string][] = [
      [context.account.ref, selection.accountRef], [context.adSet.ref, selection.adSetRef], [context.actor.ref, selection.actorRef], [context.post.ref, selection.postRef],
      [context.template.ref, selection.promotionTemplateRef], [context.audiencePreset.ref, selection.audiencePresetRef],
      [context.budgetPlan.ref, selection.budgetPlanRef], [context.timeframe.ref, selection.timeframeRef],
      [context.objective.ref, selection.objectiveRef], [context.internalCategory.ref, selection.internalCategoryRef],
    ];
    if (pairs.some(([actual, expected]) => actual !== expected || !REF.test(actual))) fail("unsafe_source");

    const reasons: PromotionPreflightReason[] = [];
    if (context.adSet.accountRef !== context.account.ref) reasons.push(reason("binding.ad_set_account_mismatch", "binding", "blocked"));
    if (context.post.actorRef !== context.actor.ref) reasons.push(reason("binding.post_actor_mismatch", "binding", "blocked"));
    const eligibility = evaluateExistingPostPromotionEligibility({
      workspaceId: context.workspaceId,
      adAccountExternalId: context.account.externalId,
      requestedActor: { type: context.actor.type, externalId: context.actor.externalId },
      post: {
        identity: context.post.identity, externalPostId: context.post.externalPostId,
        actorExternalId: context.post.actorExternalId, lifecycle: context.post.lifecycle, contentHash: context.post.contentHash,
      },
      ownership: { adAccount: context.account.ownership, actor: context.actor.ownership },
      permission: context.actor.permission,
      capabilities: { actorAdvertising: context.actor.advertisingCapability, postPromotion: context.post.promotionCapability },
    });
    if (eligibility.status !== "promotable") {
      for (const code of eligibility.reasons) reasons.push(reason(`meta.${code}`, "meta_eligibility", eligibility.status === "unknown" ? "unknown" : "blocked"));
    }

    stateReason(context.adSet.state, "ad_set", "ad_set", reasons);
    stateReason(context.template.state, "template", "template", reasons);
    stateReason(context.audiencePreset.state, "audience_preset", "audience_preset", reasons);
    stateReason(context.budgetPlan.state, "budget_plan", "budget_plan", reasons);
    stateReason(context.timeframe.state, "timeframe", "timeframe", reasons);
    stateReason(context.objective.state, "objective", "objective", reasons);
    stateReason(context.internalCategory.state, "internal_category", "internal_category", reasons);

    if (!context.template.objectiveRefs.includes(context.objective.ref)) reasons.push(reason("template.objective_incompatible", "template", "blocked"));
    if (context.template.requiredAudiencePresetRef !== context.audiencePreset.ref) reasons.push(reason("template.audience_preset_incompatible", "template", "blocked"));
    if (!context.template.accountRefs.includes(context.account.ref)) reasons.push(reason("template.account_incompatible", "template", "blocked"));
    if (!context.template.actorRefs.includes(context.actor.ref)) reasons.push(reason("template.actor_ref_incompatible", "template", "blocked"));
    if (!context.template.internalCategoryRefs.includes(context.internalCategory.ref)) reasons.push(reason("template.category_incompatible", "template", "blocked"));
    if (!context.template.actorTypes.includes(context.actor.type as "page" | "instagram")) reasons.push(reason("template.actor_incompatible", "template", "blocked"));
    if (!context.audiencePreset.actorTypes.includes(context.actor.type as "page" | "instagram")) reasons.push(reason("audience_preset.actor_incompatible", "audience_preset", "blocked"));
    if (!context.audiencePreset.accountRefs.includes(context.account.ref)) reasons.push(reason("audience_preset.account_incompatible", "audience_preset", "blocked"));
    if (!context.audiencePreset.internalCategoryRefs.includes(context.internalCategory.ref)) reasons.push(reason("audience_preset.category_incompatible", "audience_preset", "blocked"));
    if (!context.template.budgetKinds.includes(context.budgetPlan.kind)) reasons.push(reason("template.budget_kind_incompatible", "budget_plan", "blocked"));
    if (!context.template.currencies.includes(context.budgetPlan.currency)) reasons.push(reason("template.currency_incompatible", "budget_plan", "blocked"));
    if (!Number.isSafeInteger(context.budgetPlan.amountMinor)
      || context.template.minimumBudgetMinor !== null && context.budgetPlan.amountMinor < context.template.minimumBudgetMinor
      || context.template.maximumBudgetMinor !== null && context.budgetPlan.amountMinor > context.template.maximumBudgetMinor) reasons.push(reason("template.budget_out_of_bounds", "budget_plan", "blocked"));
    const startAt = context.timeframe.startAt === null ? null : iso(context.timeframe.startAt);
    const endAt = context.timeframe.endAt === null ? null : iso(context.timeframe.endAt);
    const measuredDays = startAt === null || endAt === null ? null : days(startAt, endAt);
    const durationDays = context.timeframe.durationDays;
    if (!/^[A-Z][A-Za-z_+-]+\/[A-Z][A-Za-z_+-]+$/.test(context.timeframe.timezone)
      || context.timeframe.state === "active" && !startAt
      || context.timeframe.scheduleMode === "continuous" && (endAt !== null || durationDays !== null)
      || context.timeframe.scheduleMode === "fixed_duration" && (!endAt || durationDays === null || measuredDays !== durationDays)) {
      fail("unsafe_source");
    }
    if (durationDays !== null && (durationDays < context.template.minimumDurationDays || durationDays > context.template.maximumDurationDays)) {
      reasons.push(reason("template.timeframe_out_of_bounds", "timeframe", "blocked"));
    }
    for (const [name, fact] of Object.entries(context.template.compatibility)) {
      if (fact === "rejected") reasons.push(reason(`template.${name}_incompatible`, "template", "blocked"));
      if (fact === "unknown") reasons.push(reason(`template.${name}_unknown`, "template", "unknown"));
    }
    for (const rule of context.guidance) {
      if (rule.state !== "active" || !rule.objectiveRefs.includes(context.objective.ref)
        || !rule.internalCategoryRefs.includes(context.internalCategory.ref)) continue;
      if (rule.disposition === "block") reasons.push(reason(rule.reasonCode, "guidance", "blocked"));
      if (rule.disposition === "review_required") reasons.push(reason(rule.reasonCode, "guidance", "unknown"));
    }

    const unique = [...new Map(reasons.map((item) => [`${item.source}:${item.code}:${item.disposition}`, item])).values()];
    const status = unique.some((item) => item.disposition === "blocked") ? "blocked" as const
      : unique.length > 0 ? "unknown" as const : "ready_for_approval_proposal" as const;
    const freeze = eligibility.contentFreeze;
    const proposalPreview = status === "ready_for_approval_proposal" && freeze && startAt ? Object.freeze({
      previewRef: `promotion_preview_${digest({ selection, fingerprint: freeze.fingerprint, budget: context.budgetPlan,
        timeframe: context.timeframe, compatibility: context.template.compatibility }).slice(0, 20)}`,
      actionType: "existing_post_promotion" as const,
      risk: "K4" as const,
      disposition: "approval_required" as const,
      actorType: context.actor.type as "page" | "instagram",
      postFingerprintRef: `post_fingerprint_${freeze.fingerprint.slice(0, 16)}`,
      budget: Object.freeze({ kind: context.budgetPlan.kind, currency: context.budgetPlan.currency, amountMinor: context.budgetPlan.amountMinor }),
      timeframe: Object.freeze({ scheduleMode: context.timeframe.scheduleMode, startAt, endAt,
        timezone: context.timeframe.timezone, durationDays }),
    }) : null;
    return deepFreeze({
      contractVersion: EXISTING_POST_PROMOTION_PUBLIC_PREFLIGHT_VERSION,
      status,
      selection,
      reasons: unique,
      proposalPreview,
      authority: AUTHORITY,
    });
  }
}
