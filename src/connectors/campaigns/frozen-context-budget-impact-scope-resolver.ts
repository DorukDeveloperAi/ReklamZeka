import {
  buildEffectiveCampaignContext,
  type EffectiveCampaignContext,
  type EffectiveCampaignContextInput,
} from "@/analyses/effective-campaign-context";
import type { BudgetImpactScopeEvidencePort } from "@/application/slice-rule-budget-impact-service";
import type { ExactSliceRuleScope } from "@/application/slice-rule-workspace-service";
import type { BudgetFrozenContextPort } from "@/application/budget-proposal-service";
import { BudgetProposalRepositoryError } from "@/connectors/budget/budget-proposal-drizzle-repository";
import type { FrozenCategoryContext } from "@/domain/categories/registry";

const SERVICE_REF = /^service_[a-z0-9][a-z0-9_.:-]{0,119}$/;
const CAMPAIGN_FAMILY_REF = /^campaign_family_[a-z0-9][a-z0-9_.:-]{0,111}$/;

const REQUIRED_DIMENSIONS = Object.freeze({
  market: "market",
  service: "service_line",
  campaignFamily: "campaign_family",
} as const);

const OPTIONAL_DIMENSIONS = Object.freeze({
  countryOrRegion: "geo_market",
  audienceStrategy: "audience_strategy",
  platform: "publisher_platform",
  conversionRoute: "conversion_route",
} as const);

function contextInput(context: EffectiveCampaignContext): EffectiveCampaignContextInput {
  const { schemaVersion: _schemaVersion, contextHash: _contextHash, capabilities: _capabilities, ...input } = context;
  return input;
}

function authentic(context: EffectiveCampaignContext, workspaceId: string, contextHash: string): boolean {
  try {
    const rebuilt = buildEffectiveCampaignContext(contextInput(context));
    return rebuilt.contextHash === contextHash && context.contextHash === contextHash
      && rebuilt.workspaceId === workspaceId && rebuilt.identity.entityType === "campaign"
      && rebuilt.identity.entityRef === rebuilt.identity.campaignRef
      && rebuilt.data.trustStatus === "ready" && rebuilt.data.blockers.length === 0;
  } catch {
    return false;
  }
}

function categoriesFor(
  context: EffectiveCampaignContext,
  dimensionKey: string,
): readonly FrozenCategoryContext[] {
  return context.categories.filter((category) => category.dimension.key === dimensionKey);
}

function exactDefinition(
  context: EffectiveCampaignContext,
  dimensionKey: string,
): Readonly<{ state: "ready"; category: FrozenCategoryContext; key: string }>
  | Readonly<{ state: "missing" | "ambiguous" }> {
  const categories = categoriesFor(context, dimensionKey);
  if (categories.length === 0) return Object.freeze({ state: "missing" as const });
  if (categories.length !== 1) return Object.freeze({ state: "ambiguous" as const });
  const category = categories[0]!;
  if (category.path.length !== 1 || category.path[0]?.level !== "campaign"
    || category.path[0].id !== context.identity.campaignRef) {
    return Object.freeze({ state: "ambiguous" as const });
  }
  if (category.effectiveDefinitions.length === 0) return Object.freeze({ state: "missing" as const });
  if (category.dimension.cardinality !== "single" || category.effectiveDefinitions.length !== 1) {
    return Object.freeze({ state: "ambiguous" as const });
  }
  return Object.freeze({ state: "ready" as const, category, key: category.effectiveDefinitions[0]!.key });
}

/**
 * Optional slice facets are membership constraints, not a claim that a
 * campaign has no other geo/platform labels.  The requested key itself still
 * has to occur exactly once on one exact campaign-level frozen category.
 */
function exactOptionalDefinition(
  context: EffectiveCampaignContext,
  dimensionKey: string,
  expectedKey: string,
): Readonly<{ state: "ready"; category: FrozenCategoryContext; key: string }>
  | Readonly<{ state: "missing" | "ambiguous" }> {
  const categories = categoriesFor(context, dimensionKey);
  if (categories.length === 0) return Object.freeze({ state: "missing" as const });
  if (categories.length !== 1) return Object.freeze({ state: "ambiguous" as const });
  const category = categories[0]!;
  if (category.path.length !== 1 || category.path[0]?.level !== "campaign"
    || category.path[0].id !== context.identity.campaignRef || category.effectiveDefinitions.length === 0) {
    return Object.freeze({ state: "ambiguous" as const });
  }
  const matches = category.effectiveDefinitions.filter((definition) => definition.key === expectedKey);
  // A dimension exists but excludes the requested slice: this is an exact
  // scope conflict, not an invitation to silently omit the facet.
  if (matches.length === 0) return Object.freeze({ state: "ambiguous" as const });
  if (matches.length !== 1) return Object.freeze({ state: "ambiguous" as const });
  return Object.freeze({ state: "ready" as const, category, key: expectedKey });
}

function market(key: string): "domestic" | "international" | null {
  if (key === "yerli") return "domestic";
  if (key === "yabanci") return "international";
  return null;
}

/**
 * Converts only exact category resolutions already frozen in one persisted
 * campaign context. Names, caller scope and live/current category state are
 * deliberately unavailable to this adapter.
 */
export class FrozenContextBudgetImpactScopeResolver implements BudgetImpactScopeEvidencePort {
  constructor(private readonly contexts: Pick<BudgetFrozenContextPort, "loadExact">) {}

  async loadExact(input: Parameters<BudgetImpactScopeEvidencePort["loadExact"]>[0]) {
    let frozen: Awaited<ReturnType<BudgetFrozenContextPort["loadExact"]>>;
    try {
      frozen = await this.contexts.loadExact({ workspaceId: input.workspaceId,
        adAccountId: input.adAccountId, campaignId: input.campaignId, contextHash: input.contextHash });
    } catch (reason) {
      if (reason instanceof BudgetProposalRepositoryError && reason.code === "corrupt_store") {
        return Object.freeze({ state: "stale" as const, scope: null, evidenceRefs: Object.freeze([]) });
      }
      if (reason instanceof BudgetProposalRepositoryError && ["context_scope_mismatch", "workspace_scope_mismatch",
        "not_found"].includes(reason.code)) {
        return Object.freeze({ state: "missing" as const, scope: null, evidenceRefs: Object.freeze([]) });
      }
      throw reason;
    }
    if (frozen.invalidated || frozen.scope.workspaceId !== input.workspaceId
      || frozen.scope.adAccountId !== input.adAccountId || frozen.scope.campaignId !== input.campaignId
      || frozen.scope.contextHash !== input.contextHash
      || !authentic(frozen.context, input.workspaceId, input.contextHash)) {
      return Object.freeze({ state: "stale" as const, scope: null, evidenceRefs: Object.freeze([]) });
    }

    const required = [
      exactDefinition(frozen.context, REQUIRED_DIMENSIONS.market),
      exactDefinition(frozen.context, REQUIRED_DIMENSIONS.service),
      exactDefinition(frozen.context, REQUIRED_DIMENSIONS.campaignFamily),
    ] as const;
    if (required.some((entry) => entry.state === "ambiguous")) {
      return Object.freeze({ state: "ambiguous" as const, scope: null, evidenceRefs: Object.freeze([]) });
    }
    if (required.some((entry) => entry.state === "missing")) {
      return Object.freeze({ state: "missing" as const, scope: null, evidenceRefs: Object.freeze([]) });
    }
    const [marketEvidence, serviceEvidence, familyEvidence] = required as readonly Readonly<{
      state: "ready"; category: FrozenCategoryContext; key: string;
    }>[];
    const canonicalMarket = market(marketEvidence!.key);
    if (canonicalMarket === null || !SERVICE_REF.test(serviceEvidence!.key)
      || !CAMPAIGN_FAMILY_REF.test(familyEvidence!.key)) {
      return Object.freeze({ state: "ambiguous" as const, scope: null, evidenceRefs: Object.freeze([]) });
    }
    const scope: Record<string, string> = { market: canonicalMarket, serviceRef: serviceEvidence!.key,
      campaignFamilyRef: familyEvidence!.key };
    const evidenceRefs = [
        `context_${frozen.context.contextHash}`,
        `category_resolution_${marketEvidence!.category.resolutionHash}`,
        `category_resolution_${serviceEvidence!.category.resolutionHash}`,
        `category_resolution_${familyEvidence!.category.resolutionHash}`,
      ];
    for (const [facet, dimensionKey] of Object.entries(OPTIONAL_DIMENSIONS) as readonly [keyof typeof OPTIONAL_DIMENSIONS, string][]) {
      const expected = input.expectedScope[facet];
      if (expected === undefined) continue;
      const evidence = exactOptionalDefinition(frozen.context, dimensionKey, expected);
      if (evidence.state !== "ready") {
        return Object.freeze({ state: evidence.state, scope: null, evidenceRefs: Object.freeze([]) });
      }
      if (evidence.key !== expected) {
        return Object.freeze({ state: "ambiguous" as const, scope: null, evidenceRefs: Object.freeze([]) });
      }
      scope[facet] = evidence.key;
      evidenceRefs.push(`category_resolution_${evidence.category.resolutionHash}`);
    }
    return Object.freeze({ state: "ready" as const,
      scope: Object.freeze(scope) as ExactSliceRuleScope,
      evidenceRefs: Object.freeze(evidenceRefs) });
  }
}
