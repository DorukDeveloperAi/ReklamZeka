import { createHash } from "node:crypto";

import {
  ActionProposalStagingService,
  type PublicSafeActionSummary,
  type StagedActionProposal,
} from "@/application/action-proposal-staging-service";
import { type ApprovalPolicy, type ActionActor, type FrozenPlanIdentity } from "@/domain/actions/approval-lifecycle";
import { buildActionPlan, type ActionValveContext, type TypedActionIntent } from "@/domain/actions/autonomy-valve";
import {
  evaluateExistingPostPromotionEligibility,
  type ExistingPostPromotionEligibilityInput,
} from "@/domain/meta/promotion/existing-post-eligibility";
import {
  assertPromotionRegistryLink,
  audiencePresetVersionRef,
  promotionTemplateVersionRef,
  type AudiencePresetRevision,
  type PromotionTemplateBinding,
  type PromotionTemplateRevision,
} from "@/domain/meta/promotion/promotion-template";

export const EXISTING_POST_PROMOTION_PREFLIGHT_VERSION = "existing-post-promotion-preflight/1.0.0" as const;

export type VerifiedExistingPostBinding = Readonly<{
  verification: "verified";
  sourceType: "existing_post";
  postRef: string;
  actorRef: string;
  actorType: "page" | "instagram";
  postType: "image" | "video" | "carousel" | "reel";
  creativeBindingRef: string;
  creativeBindingHash: string;
}>;

export type ExistingPostPromotionPreflightInput = Readonly<{
  template: PromotionTemplateRevision;
  preset: AudiencePresetRevision;
  binding: PromotionTemplateBinding;
  eligibility: ExistingPostPromotionEligibilityInput;
  postBinding: VerifiedExistingPostBinding;
  adSetRef: string;
  destinationRef: string;
  budgetPlanVersionRef: string;
  internalCategoryRefs: readonly string[];
  plan: FrozenPlanIdentity;
  requester: ActionActor;
  proposedAt: string;
  expiresAt: string;
  actionContext: ActionValveContext;
  summary: PublicSafeActionSummary;
}>;

export type ExistingPostPromotionPreflight = Readonly<{
  version: typeof EXISTING_POST_PROMOTION_PREFLIGHT_VERSION;
  registry: Readonly<{
    templateHash: string;
    presetHash: string;
    bindingHash: string;
  }>;
  source: Readonly<{
    postFingerprint: string;
    creativeBindingHash: string;
  }>;
  proposal: StagedActionProposal;
  preflightHash: string;
  creativeGeneration: "disabled";
  capabilities: Readonly<{
    canExecute: false;
    canWriteMeta: false;
    canGenerateCreative: false;
    canChangeTargeting: false;
    canGrantApproval: false;
  }>;
}>;

export class ExistingPostPromotionPreflightError extends Error {
  constructor(readonly code:
    | "invalid_input"
    | "post_not_verified"
    | "registry_mismatch"
    | "scope_mismatch"
    | "template_mismatch"
    | "creative_generation_forbidden") {
    super(`Existing-post promotion preflight reddedildi: ${code}`);
    this.name = "ExistingPostPromotionPreflightError";
  }
}

const REF = /^[a-z][a-z0-9]{0,31}_[a-z0-9][a-z0-9_.:-]{0,126}$/;
const HASH = /^[a-f0-9]{64}$/;
function fail(code: ExistingPostPromotionPreflightError["code"]): never { throw new ExistingPostPromotionPreflightError(code); }
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => [key, stable(child)]));
  return value;
}
function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex"); }
function freeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
  }
  return value;
}
function exact(value: unknown, keys: readonly string[]): void {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype
    || Object.keys(value).length !== keys.length || Object.keys(value).some((key) => !keys.includes(key))) fail("invalid_input");
}
function ref(value: unknown): string { if (typeof value !== "string" || !REF.test(value)) fail("invalid_input"); return value; }
function hash(value: unknown): string { if (typeof value !== "string" || !HASH.test(value)) fail("invalid_input"); return value; }

/** Pure preflight: it resolves no audience, creates no creative and performs no network or persistence call. */
export class ExistingPostPromotionPreflightService {
  private readonly staging: ActionProposalStagingService;
  constructor(policy: ApprovalPolicy) { this.staging = new ActionProposalStagingService(policy); }

  preflight(input: ExistingPostPromotionPreflightInput): ExistingPostPromotionPreflight {
    exact(input, ["template", "preset", "binding", "eligibility", "postBinding", "adSetRef", "destinationRef",
      "budgetPlanVersionRef", "internalCategoryRefs", "plan", "requester", "proposedAt", "expiresAt", "actionContext", "summary"]);
    exact(input.postBinding, ["verification", "sourceType", "postRef", "actorRef", "actorType", "postType",
      "creativeBindingRef", "creativeBindingHash"]);
    try { assertPromotionRegistryLink(input.preset, input.template, input.binding, input.actionContext.evaluatedAt); }
    catch { return fail("registry_mismatch"); }
    const eligibility = evaluateExistingPostPromotionEligibility(input.eligibility);
    if (eligibility.status !== "promotable" || !eligibility.contentFreeze) fail("post_not_verified");
    if (!input.postBinding || input.postBinding.verification !== "verified"
      || input.postBinding.sourceType !== "existing_post") fail("post_not_verified");
    ref(input.postBinding.postRef); ref(input.postBinding.actorRef); ref(input.postBinding.creativeBindingRef);
    hash(input.postBinding.creativeBindingHash);
    if (input.postBinding.actorType !== input.binding.actor.type || input.postBinding.actorRef !== input.binding.actor.actorRef
      || input.eligibility.requestedActor.type !== input.postBinding.actorType
      || !input.template.postTypes.includes(input.postBinding.postType)) fail("template_mismatch");
    if (input.actionContext.workspaceRef !== input.template.workspaceRef
      || input.actionContext.accountRef !== input.binding.accountRef
      || (input.binding.campaignRef !== null && input.actionContext.campaignRef !== input.binding.campaignRef)
      || input.actionContext.entity.level !== "adset" || input.actionContext.entity.ref !== input.adSetRef
      || input.internalCategoryRefs.length !== new Set(input.internalCategoryRefs).size
      || (input.binding.internalCategoryRefs.length > 0
        && input.internalCategoryRefs.some((category) => !input.binding.internalCategoryRefs.includes(category)))
      || input.actionContext.internalCategoryRefs.some((category) => !input.internalCategoryRefs.includes(category))) fail("scope_mismatch");
    if (input.destinationRef !== input.template.destinationRef
      || input.budgetPlanVersionRef !== input.template.budget.budgetPlanVersionRef) fail("template_mismatch");

    const action: TypedActionIntent = freeze({
      kind: "existing_post_promotion" as const,
      entity: freeze({ level: "adset" as const, ref: ref(input.adSetRef) }),
      placeholderOnly: true as const,
      postRef: input.postBinding.postRef,
      postContentHash: eligibility.contentFreeze.contentHash,
      creativeBindingHash: input.postBinding.creativeBindingHash,
      actorRef: input.postBinding.actorRef,
      promotionTemplateVersionRef: promotionTemplateVersionRef(input.template),
      audiencePresetVersionRef: audiencePresetVersionRef(input.preset),
      destinationRef: ref(input.destinationRef),
      budgetPlanVersionRef: ref(input.budgetPlanVersionRef),
      timeframeRef: input.template.timeframe.timeframeRef,
      scheduleMode: input.template.timeframe.scheduleMode,
      durationDays: input.template.timeframe.durationDays,
    });
    const actionPlan = buildActionPlan(action, input.actionContext);
    if (actionPlan.risk !== "K4" || actionPlan.disposition !== "approval_required"
      || actionPlan.capabilities.canExecute || actionPlan.capabilities.canWriteMeta
      || actionPlan.capabilities.canGrantApproval || actionPlan.capabilities.canAccessRawGraph) fail("template_mismatch");
    const proposal = this.staging.stage({
      plan: input.plan, workspaceRef: input.actionContext.workspaceRef, accountRef: input.actionContext.accountRef,
      requester: input.requester, proposedAt: input.proposedAt, expiresAt: input.expiresAt,
      units: [{
        unitKey: "existing_post_promotion", plan: input.plan, actionPlan,
        workspaceRef: input.actionContext.workspaceRef, accountRef: input.actionContext.accountRef,
        entityRef: input.adSetRef, actionType: "existing_post_promotion", risk: "K4",
        actionHash: digest(action), dependencies: [], summary: input.summary,
      }],
    });
    const core = {
      version: EXISTING_POST_PROMOTION_PREFLIGHT_VERSION,
      registry: freeze({ templateHash: input.template.templateHash, presetHash: input.preset.presetHash,
        bindingHash: input.binding.bindingHash }),
      source: freeze({ postFingerprint: eligibility.contentFreeze.fingerprint,
        creativeBindingHash: input.postBinding.creativeBindingHash }),
      proposal,
      creativeGeneration: "disabled" as const,
      capabilities: freeze({ canExecute: false as const, canWriteMeta: false as const,
        canGenerateCreative: false as const, canChangeTargeting: false as const, canGrantApproval: false as const }),
    };
    return freeze({ ...core, preflightHash: digest(core) });
  }
}
