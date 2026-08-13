import { describe, expect, it, vi } from "vitest";

import { buildEffectiveCampaignContext, type EffectiveCampaignContextInput } from "@/analyses/effective-campaign-context";
import type { BudgetFrozenContextPort } from "@/application/budget-proposal-service";
import { FrozenContextBudgetImpactScopeResolver } from "@/connectors/campaigns/frozen-context-budget-impact-scope-resolver";
import {
  resolveEffectiveCategory,
  type CategoryDefinition,
  type CategoryDimension,
} from "@/domain/categories/registry";
import {
  buildEffectiveGuidancePack,
  createGuidanceRegistry,
  type GuidanceCard,
  type GuidanceSource,
} from "@/domain/guidance/registry";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const adAccountId = "22222222-2222-4222-8222-222222222222";
const campaignId = "33333333-3333-4333-8333-333333333333";
const requiredScope = Object.freeze({ market: "international" as const,
  serviceRef: "service_physical_therapy_rehab", campaignFamilyRef: "campaign_family_intensive_ftr" });

function category(dimensionKey: string, definitionKey: string, suffix: string) {
  const dimension: CategoryDimension = { id: `dimension-${suffix}`, workspaceId, key: dimensionKey,
    version: 1, cardinality: "single", allowedEntityLevels: ["campaign"], archivedAt: null };
  const definition: CategoryDefinition = { id: `definition-${suffix}`, workspaceId,
    dimensionId: dimension.id, key: definitionKey, label: definitionKey, version: 1, archivedAt: null };
  return resolveEffectiveCategory({ dimension, definitions: [definition],
    path: { workspaceId, nodes: [{ level: "campaign", id: "campaign-1" }] }, assignments: [{
      id: `assignment-${suffix}`, workspaceId, dimensionId: dimension.id, definitionId: definition.id,
      entity: { level: "campaign", id: "campaign-1" }, operation: "add", source: "manual",
      manualLock: true, evidence: [{ kind: "owner", ref: `evidence-${suffix}` }], confidence: 1,
      version: 1, archivedAt: null,
    }] }).frozenContext;
}

function guidance() {
  const source: GuidanceSource = { id: "source-1", workspaceId, sourceType: "owner_statement",
    title: "Owner", sourceRef: "owner:1", sourceUrl: null, content: "Inspect only", author: "owner",
    capturedAt: "2026-08-01T00:00:00.000Z", reviewedAt: "2026-08-02T00:00:00.000Z",
    reviewBy: null, status: "published", version: 1 };
  const card: GuidanceCard = { id: "card-1", workspaceId, sourceType: "owner_statement",
    sourceIds: [source.id], title: "Inspect", body: "Do not infer scope", rationale: null,
    strength: "must", topic: "budget", decisionKey: null, positionKey: null, authority: "guidance_only",
    status: "published", effectiveFrom: null, effectiveTo: null, ownerRef: "owner-1", version: 1 };
  return buildEffectiveGuidancePack(createGuidanceRegistry({ workspaceId, sources: [source], cards: [card], sets: [],
    bindings: [{ id: "binding-1", workspaceId, cardId: card.id, facet: "global", value: null,
      entityType: null, mode: "default", priority: 1, version: 1 }] }), { workspaceId,
    accountId: "account-1", objective: "lead_generation", internalCategoryIds: [],
    entity: { type: "campaign", id: "campaign-1" }, topics: ["budget"], requiredTopics: ["budget"],
    evaluatedAt: "2026-08-07T12:00:00.000Z", budget: { maxCards: 10, maxSources: 10, maxCharacters: 10_000 } });
}

function context(options: Readonly<{ market?: string; categories?: EffectiveCampaignContextInput["categories"] }> = {}) {
  const categories = options.categories ?? [
    category("market", options.market ?? "yabanci", "market"),
    category("service_line", "service_physical_therapy_rehab", "service"),
    category("campaign_family", "campaign_family_intensive_ftr", "family"),
  ];
  return buildEffectiveCampaignContext({ workspaceId, capturedAt: "2026-08-07T12:00:00.000Z",
    identity: { connectionRef: "connection-1", accountRef: "account-1", campaignRef: "campaign-1",
      entityRef: "campaign-1", entityType: "campaign", hierarchyRefs: ["campaign-1"] },
    meta: { objective: { state: "known", value: "lead_generation" },
      optimizationEvent: { state: "known", value: "lead" }, configuredStatus: { state: "known", value: "ACTIVE" },
      effectiveStatus: { state: "known", value: "ACTIVE" }, budgetOwnerRef: { state: "known", value: "campaign-1" },
      targetingSignature: { state: "unknown", reason: "not_observed" }, actorRef: { state: "known", value: null },
      destinationRef: { state: "known", value: null } }, categories, guidance: guidance(), policies: [],
    cadence: { profileRef: "cadence-1", decision: "observe", reason: "stable", cooldownUntil: null },
    data: { trustStatus: "ready", snapshotRefs: ["snapshot_aaaaaaaaaaaaaaaaaaaa"], featureRefs: [],
      windowRefs: [], blockers: [] }, history: { changeRefs: [], decisionRefs: [], experimentRefs: [],
      practiceRefs: [], outcomeRefs: [] }, versions: { metaCatalog: "meta-v1", categoryResolver: "category-v1",
      guidanceRegistry: "guidance-v1", metricCatalog: "metric-v1", formulaCatalog: "formula-v1",
      timeframeResolver: "timeframe-v1" } });
}

function harness(value = context(), invalidated = false) {
  const scope = { workspaceId, adAccountId, campaignId, contextHash: value.contextHash };
  const loadExact: BudgetFrozenContextPort["loadExact"] = vi.fn(async () => ({ scope, context: value, invalidated }));
  return { scope, loadExact, resolver: new FrozenContextBudgetImpactScopeResolver({ loadExact }) };
}

describe("frozen context Slice Rule budget impact scope resolver", () => {
  it("maps only exact frozen canonical category evidence", async () => {
    const h = harness();
    await expect(h.resolver.loadExact({ ...h.scope, expectedScope: requiredScope })).resolves.toMatchObject({ state: "ready", scope: {
      market: "international", serviceRef: "service_physical_therapy_rehab",
      campaignFamilyRef: "campaign_family_intensive_ftr",
    }, evidenceRefs: [expect.stringMatching(/^context_[a-f0-9]{64}$/),
      expect.stringMatching(/^category_resolution_[a-f0-9]{64}$/),
      expect.stringMatching(/^category_resolution_[a-f0-9]{64}$/),
      expect.stringMatching(/^category_resolution_[a-f0-9]{64}$/)] });
    expect(h.loadExact).toHaveBeenCalledWith(h.scope);
  });

  it("uses the closed yerli/yabanci mapping and never accepts caller-style market values", async () => {
    const domestic = harness(context({ market: "yerli" }));
    await expect(domestic.resolver.loadExact({ ...domestic.scope, expectedScope: { ...requiredScope, market: "domestic" } })).resolves.toMatchObject({ state: "ready",
      scope: { market: "domestic" } });
    const nonCanonical = harness(context({ market: "international" }));
    await expect(nonCanonical.resolver.loadExact({ ...nonCanonical.scope, expectedScope: requiredScope })).resolves.toEqual({
      state: "ambiguous", scope: null, evidenceRefs: [] });
  });

  it("requires every optional draft facet to be present and identical in frozen category evidence", async () => {
    const value = context({ categories: [
      category("market", "yabanci", "market"),
      category("service_line", "service_physical_therapy_rehab", "service"),
      category("campaign_family", "campaign_family_intensive_ftr", "family"),
      category("geo_market", "Arap Bölgesi", "geo"),
      category("audience_strategy", "Özel hedefleme", "audience"),
      category("publisher_platform", "instagram", "platform"),
    ] });
    const h = harness(value);
    const expected = { ...requiredScope, countryOrRegion: "Arap Bölgesi", audienceStrategy: "Özel hedefleme",
      platform: "instagram" as const };
    await expect(h.resolver.loadExact({ ...h.scope, expectedScope: expected })).resolves.toMatchObject({ state: "ready",
      scope: expected, evidenceRefs: expect.arrayContaining([expect.stringMatching(/^category_resolution_[a-f0-9]{64}$/)]) });
    await expect(h.resolver.loadExact({ ...h.scope, expectedScope: { ...expected, platform: "facebook" } })).resolves.toMatchObject({
      state: "ambiguous", scope: null });
  });

  it("fails closed for missing, duplicate or invalidated frozen evidence", async () => {
    const missingContext = context({ categories: [category("market", "yabanci", "market"),
      category("service_line", "service_physical_therapy_rehab", "service")] });
    const missing = harness(missingContext);
    await expect(missing.resolver.loadExact({ ...missing.scope, expectedScope: requiredScope })).resolves.toMatchObject({ state: "missing", scope: null });

    const duplicateContext = context({ categories: [category("market", "yabanci", "market-a"),
      category("market", "yerli", "market-b"), category("service_line", "service_physical_therapy_rehab", "service"),
      category("campaign_family", "campaign_family_intensive_ftr", "family")] });
    const duplicate = harness(duplicateContext);
    await expect(duplicate.resolver.loadExact({ ...duplicate.scope, expectedScope: requiredScope })).resolves.toMatchObject({ state: "ambiguous", scope: null });

    const stale = harness(context(), true);
    await expect(stale.resolver.loadExact({ ...stale.scope, expectedScope: requiredScope })).resolves.toMatchObject({ state: "stale", scope: null });
  });
});
