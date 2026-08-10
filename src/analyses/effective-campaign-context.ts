import { createHash } from "node:crypto";
import {
  CAMPAIGN_OBJECTIVES,
  OPTIMIZATION_EVENTS,
  type CampaignObjective,
  type OptimizationEvent,
} from "@/analyses/schema";
import type { FrozenCategoryContext } from "@/domain/categories/registry";
import type { EffectiveGuidancePack } from "@/domain/guidance/registry";
import { inspectMetaPersistenceWrite } from "@/domain/meta/data-lifecycle";

export const EFFECTIVE_CAMPAIGN_CONTEXT_VERSION = "effective-campaign-context/1.0.0" as const;
export const EFFECTIVE_CONTEXT_INSTRUCTION_POLICY_COMPONENT_REF = "instruction-policy-registry" as const;
export const EFFECTIVE_CONTEXT_PROMOTION_REGISTRY_COMPONENT_REF = "promotion_registry_workspace" as const;
export const EFFECTIVE_CONTEXT_POLICY_AUTHORITY_COMPONENT_REF = "policy_authority_workspace" as const;

type Observed<T> =
  | Readonly<{ state: "known"; value: T }>
  | Readonly<{ state: "unknown"; reason: string }>;

export type EffectiveCampaignContextInput = Readonly<{
  workspaceId: string;
  capturedAt: string;
  identity: Readonly<{
    connectionRef: string;
    accountRef: string;
    campaignRef: string;
    entityRef: string;
    entityType: "campaign" | "ad_set" | "ad" | "creative";
    hierarchyRefs: readonly string[];
  }>;
  meta: Readonly<{
    objective: Observed<CampaignObjective>;
    optimizationEvent: Observed<OptimizationEvent>;
    configuredStatus: Observed<string | null>;
    effectiveStatus: Observed<string | null>;
    budgetOwnerRef: Observed<string | null>;
    targetingSignature: Observed<string | null>;
    actorRef: Observed<string | null>;
    destinationRef: Observed<string | null>;
  }>;
  categories: readonly FrozenCategoryContext[];
  guidance: EffectiveGuidancePack;
  policies: readonly Readonly<{
    policyRef: string;
    state: "applied" | "suppressed" | "parked_conflict";
    reason: string;
  }>[];
  cadence: Readonly<{
    profileRef: string;
    decision: "eligible" | "observe" | "no_change" | "blocked";
    reason: string;
    cooldownUntil: string | null;
  }>;
  data: Readonly<{
    trustStatus: "ready" | "degraded" | "not_ready";
    snapshotRefs: readonly string[];
    featureRefs: readonly string[];
    windowRefs: readonly string[];
    blockers: readonly string[];
  }>;
  history: Readonly<{
    changeRefs: readonly string[];
    decisionRefs: readonly string[];
    experimentRefs: readonly string[];
    practiceRefs: readonly string[];
    outcomeRefs: readonly string[];
  }>;
  versions: Readonly<{
    metaCatalog: string;
    categoryResolver: string;
    guidanceRegistry: string;
    metricCatalog: string;
    formulaCatalog: string;
    timeframeResolver: string;
    /** Optional only for replaying contexts frozen before the A09 policy registry existed. */
    instructionPolicyRegistry?: string;
    /** Optional only for replaying contexts frozen before PromotionTemplate lifecycle binding existed. */
    promotionRegistry?: string;
    policyAuthority?: string;
  }>;
  /** Present only for contexts composed through the repository-verified A09 authority loader. */
  policyAuthorityEvidence?: Readonly<{
    snapshotRef: string;
    snapshotHash: string;
    catalogHash: string;
    scopeHash: string;
    accountGroupBindingHashes: readonly string[];
    topicBindingHashes: readonly string[];
    manualLockBindingHashes: readonly string[];
    semanticBindingHashes: readonly string[];
  }>;
}>;

export type EffectiveCampaignContext = Readonly<EffectiveCampaignContextInput & {
  schemaVersion: typeof EFFECTIVE_CAMPAIGN_CONTEXT_VERSION;
  contextHash: string;
  capabilities: Readonly<{
    containsRawL0: false;
    canAuthorizeAction: false;
    canExecuteWrite: false;
  }>;
}>;

export class EffectiveCampaignContextError extends Error {
  constructor(readonly code: "invalid_input" | "scope_mismatch" | "inauthentic_component" | "forbidden_material") {
    super(`Effective campaign context oluşturulamadı: ${code}`);
    this.name = "EffectiveCampaignContextError";
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => compareText(left, right))
      .map(([key, entry]) => [key, stableValue(entry)]));
  }
  return value;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function exactKeys(value: object, allowed: readonly string[]): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new EffectiveCampaignContextError("forbidden_material");
  }
}

function required(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 256) throw new EffectiveCampaignContextError("invalid_input");
  return normalized;
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  const normalized = values.map(required).sort(compareText);
  if (new Set(normalized).size !== normalized.length) throw new EffectiveCampaignContextError("invalid_input");
  return Object.freeze(normalized);
}

function hierarchy(values: readonly string[], campaignRef: string, entityRef: string, entityType: EffectiveCampaignContextInput["identity"]["entityType"]): readonly string[] {
  const normalized = values.map(required);
  if (new Set(normalized).size !== normalized.length) throw new EffectiveCampaignContextError("invalid_input");
  const expectedLength = { campaign: 1, ad_set: 2, ad: 3, creative: 4 }[entityType];
  if (normalized.length !== expectedLength || normalized[0] !== campaignRef || normalized.at(-1) !== entityRef) {
    throw new EffectiveCampaignContextError("invalid_input");
  }
  return Object.freeze(normalized);
}

function validateObserved(observation: Observed<unknown>, validateKnown: (value: unknown) => boolean): void {
  exactKeys(observation, observation.state === "known" ? ["state", "value"] : ["state", "reason"]);
  if (observation.state === "unknown") {
    required(observation.reason);
    return;
  }
  if (observation.state !== "known" || !validateKnown(observation.value)) {
    throw new EffectiveCampaignContextError("invalid_input");
  }
}

function authenticCategory(context: FrozenCategoryContext): boolean {
  const { resolutionHash, ...core } = context;
  return /^[a-f0-9]{64}$/.test(resolutionHash) && digest(core) === resolutionHash;
}

function authenticGuidance(pack: EffectiveGuidancePack): boolean {
  const { packHash, ...core } = pack;
  return /^[a-f0-9]{64}$/.test(packHash) && digest(core) === packHash;
}

/**
 * Freezes the server-private L5 campaign context. It accepts only typed references and
 * authentic category/guidance components; public/agent projections must redact tenant IDs.
 */
export function buildEffectiveCampaignContext(input: EffectiveCampaignContextInput): EffectiveCampaignContext {
  exactKeys(input, ["workspaceId", "capturedAt", "identity", "meta", "categories", "guidance", "policies", "cadence", "data", "history", "versions", "policyAuthorityEvidence"]);
  exactKeys(input.identity, ["connectionRef", "accountRef", "campaignRef", "entityRef", "entityType", "hierarchyRefs"]);
  exactKeys(input.meta, ["objective", "optimizationEvent", "configuredStatus", "effectiveStatus", "budgetOwnerRef", "targetingSignature", "actorRef", "destinationRef"]);
  exactKeys(input.cadence, ["profileRef", "decision", "reason", "cooldownUntil"]);
  exactKeys(input.data, ["trustStatus", "snapshotRefs", "featureRefs", "windowRefs", "blockers"]);
  exactKeys(input.history, ["changeRefs", "decisionRefs", "experimentRefs", "practiceRefs", "outcomeRefs"]);
  exactKeys(input.versions, ["metaCatalog", "categoryResolver", "guidanceRegistry", "metricCatalog", "formulaCatalog",
    "timeframeResolver", "instructionPolicyRegistry", "promotionRegistry", "policyAuthority"]);
  if (input.policyAuthorityEvidence !== undefined) {
    exactKeys(input.policyAuthorityEvidence, ["snapshotRef", "snapshotHash", "catalogHash", "scopeHash", "accountGroupBindingHashes", "topicBindingHashes", "manualLockBindingHashes", "semanticBindingHashes"]);
    if (input.versions.policyAuthority === undefined || !/^authority_snapshot_[a-z0-9][a-z0-9_.:-]{0,126}$/.test(input.policyAuthorityEvidence.snapshotRef)
      || ![input.policyAuthorityEvidence.snapshotHash, input.policyAuthorityEvidence.catalogHash, input.policyAuthorityEvidence.scopeHash,
        ...input.policyAuthorityEvidence.accountGroupBindingHashes, ...input.policyAuthorityEvidence.topicBindingHashes,
        ...input.policyAuthorityEvidence.manualLockBindingHashes, ...input.policyAuthorityEvidence.semanticBindingHashes]
        .every((value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value))) throw new EffectiveCampaignContextError("invalid_input");
    for (const values of [input.policyAuthorityEvidence.accountGroupBindingHashes, input.policyAuthorityEvidence.topicBindingHashes,
      input.policyAuthorityEvidence.manualLockBindingHashes, input.policyAuthorityEvidence.semanticBindingHashes]) uniqueSorted(values);
  } else if (input.versions.policyAuthority !== undefined) throw new EffectiveCampaignContextError("invalid_input");

  const policyReport = inspectMetaPersistenceWrite(input);
  if (!policyReport.compliant) throw new EffectiveCampaignContextError("forbidden_material");
  const workspaceId = required(input.workspaceId);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(input.capturedAt) || !Number.isFinite(Date.parse(input.capturedAt))) {
    throw new EffectiveCampaignContextError("invalid_input");
  }
  for (const value of [input.identity.connectionRef, input.identity.accountRef, input.identity.campaignRef, input.identity.entityRef]) required(value);
  if (!["campaign", "ad_set", "ad", "creative"].includes(input.identity.entityType)) {
    throw new EffectiveCampaignContextError("invalid_input");
  }
  const hierarchyRefs = hierarchy(
    input.identity.hierarchyRefs,
    input.identity.campaignRef,
    input.identity.entityRef,
    input.identity.entityType,
  );

  validateObserved(input.meta.objective, (value) => typeof value === "string" && (CAMPAIGN_OBJECTIVES as readonly string[]).includes(value));
  validateObserved(input.meta.optimizationEvent, (value) => typeof value === "string" && (OPTIMIZATION_EVENTS as readonly string[]).includes(value));
  for (const observation of [input.meta.configuredStatus, input.meta.effectiveStatus]) {
    validateObserved(observation, (value) => value === null || typeof value === "string" && /^[A-Z][A-Z0-9_]{0,63}$/.test(value));
  }
  for (const observation of [input.meta.budgetOwnerRef, input.meta.actorRef, input.meta.destinationRef]) {
    validateObserved(observation, (value) => value === null || typeof value === "string" && value.trim().length > 0 && value.length <= 256);
  }
  validateObserved(input.meta.targetingSignature, (value) => value === null || typeof value === "string" && /^sha256:[a-f0-9]{64}$/.test(value));

  if (input.guidance.workspaceId !== workspaceId) throw new EffectiveCampaignContextError("scope_mismatch");
  if (!authenticGuidance(input.guidance)) throw new EffectiveCampaignContextError("inauthentic_component");
  if (Date.parse(input.guidance.evaluatedAt) > Date.parse(input.capturedAt)) throw new EffectiveCampaignContextError("invalid_input");
  const dimensions = new Set<string>();
  for (const category of input.categories) {
    if (category.workspaceId !== workspaceId) throw new EffectiveCampaignContextError("scope_mismatch");
    if (!authenticCategory(category) || dimensions.has(category.dimension.id)) {
      throw new EffectiveCampaignContextError("inauthentic_component");
    }
    dimensions.add(category.dimension.id);
  }

  const policies = input.policies.map((policy) => {
    exactKeys(policy, ["policyRef", "state", "reason"]);
    if (!["applied", "suppressed", "parked_conflict"].includes(policy.state)) throw new EffectiveCampaignContextError("invalid_input");
    return { policyRef: required(policy.policyRef), state: policy.state, reason: required(policy.reason) };
  }).sort((left, right) => compareText(left.policyRef, right.policyRef) || compareText(left.state, right.state));
  if (new Set(policies.map((policy) => policy.policyRef)).size !== policies.length) throw new EffectiveCampaignContextError("invalid_input");
  if (!["eligible", "observe", "no_change", "blocked"].includes(input.cadence.decision)) throw new EffectiveCampaignContextError("invalid_input");
  if (input.cadence.cooldownUntil !== null && !Number.isFinite(Date.parse(input.cadence.cooldownUntil))) throw new EffectiveCampaignContextError("invalid_input");
  if (!["ready", "degraded", "not_ready"].includes(input.data.trustStatus)) throw new EffectiveCampaignContextError("invalid_input");

  const snapshotRefs = uniqueSorted(input.data.snapshotRefs);
  if (snapshotRefs.length === 0) throw new EffectiveCampaignContextError("invalid_input");
  if (input.versions.instructionPolicyRegistry !== undefined
    && !/^[a-f0-9]{64}$/.test(input.versions.instructionPolicyRegistry)) {
    throw new EffectiveCampaignContextError("invalid_input");
  }
  if (input.versions.promotionRegistry !== undefined && !/^[a-f0-9]{64}$/.test(input.versions.promotionRegistry)) {
    throw new EffectiveCampaignContextError("invalid_input");
  }
  if (input.versions.policyAuthority !== undefined && !/^[a-f0-9]{64}$/.test(input.versions.policyAuthority)) {
    throw new EffectiveCampaignContextError("invalid_input");
  }
  const core = stableValue({
    schemaVersion: EFFECTIVE_CAMPAIGN_CONTEXT_VERSION,
    workspaceId,
    capturedAt: new Date(input.capturedAt).toISOString(),
    identity: { ...input.identity, hierarchyRefs },
    meta: input.meta,
    categories: [...input.categories].sort((left, right) => compareText(left.dimension.key, right.dimension.key) || compareText(left.dimension.id, right.dimension.id)),
    guidance: input.guidance,
    policies,
    cadence: { ...input.cadence, profileRef: required(input.cadence.profileRef), reason: required(input.cadence.reason) },
    data: {
      trustStatus: input.data.trustStatus,
      snapshotRefs,
      featureRefs: uniqueSorted(input.data.featureRefs),
      windowRefs: uniqueSorted(input.data.windowRefs),
      blockers: uniqueSorted(input.data.blockers),
    },
    history: {
      changeRefs: uniqueSorted(input.history.changeRefs),
      decisionRefs: uniqueSorted(input.history.decisionRefs),
      experimentRefs: uniqueSorted(input.history.experimentRefs),
      practiceRefs: uniqueSorted(input.history.practiceRefs),
      outcomeRefs: uniqueSorted(input.history.outcomeRefs),
    },
    ...(input.policyAuthorityEvidence === undefined ? {} : { policyAuthorityEvidence: {
      snapshotRef: input.policyAuthorityEvidence.snapshotRef,
      snapshotHash: input.policyAuthorityEvidence.snapshotHash,
      catalogHash: input.policyAuthorityEvidence.catalogHash,
      scopeHash: input.policyAuthorityEvidence.scopeHash,
      accountGroupBindingHashes: uniqueSorted(input.policyAuthorityEvidence.accountGroupBindingHashes),
      topicBindingHashes: uniqueSorted(input.policyAuthorityEvidence.topicBindingHashes),
      manualLockBindingHashes: uniqueSorted(input.policyAuthorityEvidence.manualLockBindingHashes),
      semanticBindingHashes: uniqueSorted(input.policyAuthorityEvidence.semanticBindingHashes),
    } }),
    versions: Object.fromEntries(Object.entries(input.versions).map(([key, value]) => [key, required(value)])),
    capabilities: { containsRawL0: false, canAuthorizeAction: false, canExecuteWrite: false },
  }) as Omit<EffectiveCampaignContext, "contextHash">;
  return Object.freeze({ ...core, contextHash: digest(core) });
}
