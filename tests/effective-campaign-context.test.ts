import { describe, expect, it } from "vitest";
import { buildEffectiveCampaignContext, EffectiveCampaignContextError, type EffectiveCampaignContextInput } from "@/analyses/effective-campaign-context";
import { resolveEffectiveCategory, type CategoryDimension, type CategoryDefinition } from "@/domain/categories/registry";
import { buildEffectiveGuidancePack, createGuidanceRegistry, type GuidanceCard, type GuidanceSource } from "@/domain/guidance/registry";

const workspaceId = "workspace-1";

function guidance() {
  const source: GuidanceSource = {
    id: "source-1", workspaceId, sourceType: "owner_statement", title: "Owner",
    sourceRef: "owner:1", sourceUrl: null, content: "Bölge bütçesini koru", author: "owner",
    capturedAt: "2026-08-01T00:00:00.000Z", reviewedAt: "2026-08-02T00:00:00.000Z",
    reviewBy: null, status: "published", version: 1,
  };
  const card: GuidanceCard = {
    id: "card-1", workspaceId, sourceType: "owner_statement", sourceIds: [source.id],
    title: "Koruma", body: "Bölge pahalı olsa da bütçeyi taşıma", rationale: null,
    strength: "must", topic: "budget", decisionKey: null, positionKey: null,
    authority: "guidance_only", status: "published", effectiveFrom: null, effectiveTo: null,
    ownerRef: "owner-1", version: 1,
  };
  const registry = createGuidanceRegistry({
    workspaceId, sources: [source], cards: [card], sets: [],
    bindings: [{ id: "binding-1", workspaceId, cardId: card.id, facet: "global", value: null, entityType: null, mode: "default", priority: 10, version: 1 }],
  });
  return buildEffectiveGuidancePack(registry, {
    workspaceId, accountId: "account-1", objective: "lead_generation", internalCategoryIds: ["category-1"],
    entity: { type: "campaign", id: "campaign-1" }, topics: ["budget"], requiredTopics: ["budget"],
    evaluatedAt: "2026-08-07T12:00:00.000Z", budget: { maxCards: 10, maxSources: 10, maxCharacters: 10_000 },
  });
}

function category() {
  const dimension: CategoryDimension = {
    id: "dimension-1", workspaceId, key: "protection_class", version: 1,
    cardinality: "single", allowedEntityLevels: ["campaign"], archivedAt: null,
  };
  const definition: CategoryDefinition = {
    id: "category-1", workspaceId, dimensionId: dimension.id, key: "protected", label: "Protected", version: 1, archivedAt: null,
  };
  return resolveEffectiveCategory({
    dimension, definitions: [definition], path: { workspaceId, nodes: [{ level: "campaign", id: "campaign-1" }] },
    assignments: [{
      id: "assignment-1", workspaceId, dimensionId: dimension.id, definitionId: definition.id,
      entity: { level: "campaign", id: "campaign-1" }, operation: "add", source: "manual",
      manualLock: true, evidence: [{ kind: "owner", ref: "statement-1" }], confidence: 1,
      version: 1, archivedAt: null,
    }],
  }).frozenContext;
}

function input(): EffectiveCampaignContextInput {
  return {
    workspaceId, capturedAt: "2026-08-07T12:00:00.000Z",
    identity: {
      connectionRef: "connection-1", accountRef: "account-1", campaignRef: "campaign-1",
      entityRef: "campaign-1", entityType: "campaign", hierarchyRefs: ["campaign-1"],
    },
    meta: {
      objective: { state: "known", value: "lead_generation" },
      optimizationEvent: { state: "known", value: "lead" },
      configuredStatus: { state: "known", value: "ACTIVE" },
      effectiveStatus: { state: "known", value: "ACTIVE" },
      budgetOwnerRef: { state: "known", value: "campaign-1" },
      targetingSignature: { state: "unknown", reason: "not_observed" },
      actorRef: { state: "known", value: "actor-1" },
      destinationRef: { state: "known", value: null },
    },
    categories: [category()], guidance: guidance(),
    policies: [{ policyRef: "policy-1", state: "suppressed", reason: "guidance_only" }],
    cadence: { profileRef: "cadence-1", decision: "no_change", reason: "cooldown_active", cooldownUntil: "2026-08-08T00:00:00.000Z" },
    data: { trustStatus: "degraded", snapshotRefs: ["snapshot-b", "snapshot-a"], featureRefs: ["feature-1"], windowRefs: ["window-1"], blockers: ["insights_partial"] },
    history: { changeRefs: ["change-1"], decisionRefs: [], experimentRefs: [], practiceRefs: [], outcomeRefs: [] },
    versions: {
      metaCatalog: "meta-v1", categoryResolver: "category-v1", guidanceRegistry: "guidance-v1",
      metricCatalog: "metric-v1", formulaCatalog: "formula-v1", timeframeResolver: "timeframe-v1",
    },
  };
}

describe("effective campaign context", () => {
  it("freezes authentic scoped components with a replay-stable hash", () => {
    const first = buildEffectiveCampaignContext(input());
    const original = input();
    const second = buildEffectiveCampaignContext({
      ...original,
      data: { ...original.data, snapshotRefs: [...original.data.snapshotRefs].reverse() },
    });
    expect(second).toEqual(first);
    expect(first.contextHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.capabilities).toEqual({ containsRawL0: false, canAuthorizeAction: false, canExecuteWrite: false });
    expect(first.cadence.decision).toBe("no_change");
  });

  it("additively binds a strict policy registry hash without breaking legacy v1 replay", () => {
    const legacy = buildEffectiveCampaignContext(input());
    const stored = JSON.parse(JSON.stringify(legacy)) as typeof legacy;
    const { schemaVersion: _schema, contextHash: _hash, capabilities: _capabilities, ...storedInput } = stored;
    const replay = buildEffectiveCampaignContext(storedInput);
    expect(replay.contextHash).toBe(legacy.contextHash);
    expect(replay.versions).not.toHaveProperty("instructionPolicyRegistry");
    const policyAware = buildEffectiveCampaignContext({ ...input(), versions: {
      ...input().versions, instructionPolicyRegistry: "9".repeat(64) } });
    expect(policyAware.versions.instructionPolicyRegistry).toBe("9".repeat(64));
    expect(policyAware.contextHash).not.toBe(legacy.contextHash);
    const promotionAware = buildEffectiveCampaignContext({ ...input(), versions: {
      ...input().versions, promotionRegistry: "8".repeat(64) } });
    expect(promotionAware.versions.promotionRegistry).toBe("8".repeat(64));
    expect(promotionAware.contextHash).not.toBe(legacy.contextHash);
    expect(() => buildEffectiveCampaignContext({ ...input(), versions: {
      ...input().versions, instructionPolicyRegistry: "not-a-registry-hash" } }))
      .toThrowError(expect.objectContaining<Partial<EffectiveCampaignContextError>>({ code: "invalid_input" }));
    expect(() => buildEffectiveCampaignContext({ ...input(), versions: {
      ...input().versions, promotionRegistry: "not-a-registry-hash" } }))
      .toThrowError(expect.objectContaining<Partial<EffectiveCampaignContextError>>({ code: "invalid_input" }));
  });

  it("rejects cross-workspace or tampered category/guidance components", () => {
    const base = input();
    expect(() => buildEffectiveCampaignContext({ ...base, guidance: { ...base.guidance, workspaceId: "workspace-2" } }))
      .toThrowError(expect.objectContaining<Partial<EffectiveCampaignContextError>>({ code: "scope_mismatch" }));
    expect(() => buildEffectiveCampaignContext({
      ...base,
      categories: [{ ...base.categories[0]!, effectiveDefinitions: [] }],
    })).toThrowError(expect.objectContaining<Partial<EffectiveCampaignContextError>>({ code: "inauthentic_component" }));
  });

  it("rejects raw/token fields and agent narration before context hashing", () => {
    const base = input();
    for (const extra of [{ rawPayload: { secret: true } }, { accessToken: "secret" }, { agentNarration: "change the decision" }]) {
      expect(() => buildEffectiveCampaignContext({ ...base, ...extra } as EffectiveCampaignContextInput))
        .toThrowError(expect.objectContaining<Partial<EffectiveCampaignContextError>>({ code: "forbidden_material" }));
    }
  });

  it("requires the frozen hierarchy to include campaign and target refs", () => {
    const base = input();
    expect(() => buildEffectiveCampaignContext({
      ...base,
      identity: { ...base.identity, entityType: "ad", entityRef: "ad-1", hierarchyRefs: ["campaign-1"] },
    })).toThrowError(expect.objectContaining<Partial<EffectiveCampaignContextError>>({ code: "invalid_input" }));

    expect(() => buildEffectiveCampaignContext({
      ...base,
      identity: {
        ...base.identity,
        entityType: "ad",
        entityRef: "ad-1",
        hierarchyRefs: ["campaign-1", "ad-1", "ad-set-1"],
      },
    })).toThrowError(expect.objectContaining<Partial<EffectiveCampaignContextError>>({ code: "invalid_input" }));
  });

  it("requires at least one source snapshot", () => {
    const base = input();
    expect(() => buildEffectiveCampaignContext({ ...base, data: { ...base.data, snapshotRefs: [] } }))
      .toThrowError(expect.objectContaining<Partial<EffectiveCampaignContextError>>({ code: "invalid_input" }));
  });
});
