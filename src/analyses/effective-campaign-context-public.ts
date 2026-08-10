import { createHash } from "node:crypto";
import {
  buildEffectiveCampaignContext,
  EFFECTIVE_CAMPAIGN_CONTEXT_VERSION,
  type EffectiveCampaignContext,
} from "@/analyses/effective-campaign-context";

export const PUBLIC_CAMPAIGN_CONTEXT_VERSION = "public-campaign-context/1.0.0" as const;

export class PublicCampaignContextError extends Error {
  constructor() {
    super("Public campaign context yalnız authentic frozen context'ten üretilebilir");
    this.name = "PublicCampaignContextError";
  }
}

function publicRef(value: string): string {
  return `ref_${createHash("sha256").update(value).digest("hex").slice(0, 12)}`;
}

function projectObservedRef(
  observation: Readonly<{ state: "known"; value: string | null }> | Readonly<{ state: "unknown"; reason: string }>,
) {
  return observation.state === "unknown"
    ? observation
    : { state: "known" as const, value: observation.value === null ? null : publicRef(observation.value) };
}

/**
 * UI/agent-safe L5 projection. Tenant identity and internal entity/source references
 * become stable opaque aliases; user-authored guidance and source citations remain visible.
 */
export function projectEffectiveCampaignContext(context: EffectiveCampaignContext) {
  const { schemaVersion, contextHash, capabilities, ...input } = context;
  let authentic: EffectiveCampaignContext;
  try {
    authentic = buildEffectiveCampaignContext(input);
  } catch {
    throw new PublicCampaignContextError();
  }
  if (schemaVersion !== EFFECTIVE_CAMPAIGN_CONTEXT_VERSION
    || authentic.contextHash !== contextHash
    || capabilities.containsRawL0 !== false
    || capabilities.canAuthorizeAction !== false
    || capabilities.canExecuteWrite !== false) {
    throw new PublicCampaignContextError();
  }
  context = authentic;
  return Object.freeze({
    schemaVersion: PUBLIC_CAMPAIGN_CONTEXT_VERSION,
    contextRef: context.contextHash,
    capturedAt: context.capturedAt,
    identity: {
      connectionRef: publicRef(context.identity.connectionRef),
      accountRef: publicRef(context.identity.accountRef),
      campaignRef: publicRef(context.identity.campaignRef),
      entityRef: publicRef(context.identity.entityRef),
      entityType: context.identity.entityType,
      hierarchyRefs: context.identity.hierarchyRefs.map(publicRef),
    },
    meta: {
      objective: context.meta.objective,
      optimizationEvent: context.meta.optimizationEvent,
      configuredStatus: context.meta.configuredStatus,
      effectiveStatus: context.meta.effectiveStatus,
      budgetOwnerRef: projectObservedRef(context.meta.budgetOwnerRef),
      targetingSignature: context.meta.targetingSignature,
      actorRef: projectObservedRef(context.meta.actorRef),
      destinationRef: projectObservedRef(context.meta.destinationRef),
    },
    categories: context.categories.map((category) => ({
      dimensionKey: category.dimension.key,
      cardinality: category.dimension.cardinality,
      effectiveDefinitions: category.effectiveDefinitions.map((definition) => ({
        key: definition.key,
        version: definition.version,
      })),
      resolutionRef: category.resolutionHash,
    })),
    guidance: {
      evaluatedAt: context.guidance.evaluatedAt,
      applied: context.guidance.applied.map((card) => ({
        cardRef: publicRef(card.cardId),
        title: card.title,
        body: card.body,
        strength: card.strength,
        topic: card.topic,
        sourceRefs: card.sourceIds.map(publicRef),
        sourceType: card.sourceType,
        scopeReason: card.scopeReason,
        mode: card.mode,
        priority: card.priority,
        authority: card.authority,
        trustLevel: card.trustLevel,
      })),
      suppressed: context.guidance.suppressed.map((card) => ({ cardRef: publicRef(card.cardId), reason: card.reason })),
      conflicting: context.guidance.conflicting.map((conflict) => ({
        decisionKey: conflict.decisionKey,
        cardRefs: conflict.cardIds.map(publicRef),
        reason: conflict.reason,
      })),
      missing: context.guidance.missing,
      sources: context.guidance.sources.map((source) => ({
        sourceRef: source.sourceRef,
        sourceType: source.sourceType,
        sourceUrl: source.sourceUrl,
        capturedAt: source.capturedAt,
        reviewedAt: source.reviewedAt,
        reviewBy: source.reviewBy,
        freshness: source.freshness,
      })),
      budget: context.guidance.budget,
      capabilities: context.guidance.capabilities,
    },
    policies: context.policies.map((policy) => ({
      policyRef: publicRef(policy.policyRef),
      state: policy.state,
      reason: policy.reason,
    })),
    cadence: { ...context.cadence, profileRef: publicRef(context.cadence.profileRef) },
    data: {
      trustStatus: context.data.trustStatus,
      snapshotRefs: context.data.snapshotRefs.map(publicRef),
      featureRefs: context.data.featureRefs.map(publicRef),
      windowRefs: context.data.windowRefs.map(publicRef),
      blockers: context.data.blockers,
    },
    history: {
      changeRefs: context.history.changeRefs.map(publicRef),
      decisionRefs: context.history.decisionRefs.map(publicRef),
      experimentRefs: context.history.experimentRefs.map(publicRef),
      practiceRefs: context.history.practiceRefs.map(publicRef),
      outcomeRefs: context.history.outcomeRefs.map(publicRef),
      ...(context.history.outcomeEvidence === undefined ? {} : { outcomeEvidence: context.history.outcomeEvidence.map((evidence) => ({
        evidenceRef: publicRef(evidence.evidenceRef), windowStart: evidence.windowStart, windowEnd: evidence.windowEnd,
        materializedAt: evidence.materializedAt, summary: evidence.summary,
      })) }),
    },
    versions: context.versions,
    capabilities: context.capabilities,
    writeOperations: 0 as const,
  });
}
