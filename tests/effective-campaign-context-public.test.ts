import { describe, expect, it } from "vitest";
import { projectEffectiveCampaignContext, PublicCampaignContextError } from "@/analyses/effective-campaign-context-public";
import { buildEffectiveCampaignContext } from "@/analyses/effective-campaign-context";
import { buildEffectiveGuidancePack, createGuidanceRegistry } from "@/domain/guidance/registry";

const workspaceId = "workspace-secret";
const source = {
  id: "source-secret", workspaceId, sourceType: "owner_statement" as const,
  title: "Owner", sourceRef: "owner:statement:1", sourceUrl: null,
  content: "Bölge bütçesini koru", author: "owner", capturedAt: "2026-08-01T00:00:00.000Z",
  reviewedAt: null, reviewBy: null, status: "published" as const, version: 1,
};
const card = {
  id: "card-secret", workspaceId, sourceType: "owner_statement" as const, sourceIds: [source.id],
  title: "Bölge bütçesi", body: "Pahalı olsa da başka bölgeye taşıma.", rationale: null,
  strength: "must" as const, topic: "budget", decisionKey: null, positionKey: null,
  authority: "guidance_only" as const, status: "published" as const, effectiveFrom: null,
  effectiveTo: null, ownerRef: "owner-secret", version: 1,
};
const registry = createGuidanceRegistry({
  workspaceId, sources: [source], cards: [card], sets: [],
  bindings: [{
    id: "binding-secret", workspaceId, cardId: card.id, facet: "global", value: null,
    entityType: null, mode: "default", priority: 90, version: 1,
  }],
});
const guidance = buildEffectiveGuidancePack(registry, {
  workspaceId, accountId: "act_123456789", objective: "lead_generation", internalCategoryIds: [],
  entity: { type: "campaign", id: "campaign-secret" }, topics: ["budget"], requiredTopics: ["budget"],
  evaluatedAt: "2026-08-07T11:00:00.000Z",
  budget: { maxCards: 10, maxSources: 10, maxCharacters: 1000 },
});
const internal = buildEffectiveCampaignContext({
  workspaceId,
  capturedAt: "2026-08-07T12:00:00.000Z",
  identity: {
    connectionRef: "connection-secret", accountRef: "act_123456789", campaignRef: "campaign-secret",
    entityRef: "campaign-secret", entityType: "campaign", hierarchyRefs: ["campaign-secret"],
  },
  meta: {
    objective: { state: "known", value: "lead_generation" },
    optimizationEvent: { state: "known", value: "lead" },
    configuredStatus: { state: "known", value: "ACTIVE" },
    effectiveStatus: { state: "known", value: "ACTIVE" },
    budgetOwnerRef: { state: "known", value: "campaign-secret" },
    targetingSignature: { state: "unknown", reason: "not_observed" },
    actorRef: { state: "known", value: "page-secret" },
    destinationRef: { state: "known", value: null },
  },
  categories: [], guidance,
  policies: [{ policyRef: "policy-secret", state: "suppressed", reason: "guidance_only" }],
  cadence: { profileRef: "cadence-secret", decision: "no_change", reason: "cooldown", cooldownUntil: null },
  data: { trustStatus: "ready", snapshotRefs: ["snapshot-secret"], featureRefs: [], windowRefs: [], blockers: [] },
  history: { changeRefs: ["change-secret"], decisionRefs: [], experimentRefs: [], practiceRefs: [], outcomeRefs: [] },
  versions: { metaCatalog: "1", categoryResolver: "1", guidanceRegistry: "1", metricCatalog: "1", formulaCatalog: "1", timeframeResolver: "1" },
});

describe("public effective campaign context", () => {
  it("keeps usable guidance and citations while redacting tenant and internal refs", () => {
    const projection = projectEffectiveCampaignContext(internal);
    const serialized = JSON.stringify(projection);
    expect(projection.contextRef).toBe(internal.contextHash);
    expect(projection.guidance.applied[0]).toMatchObject({
      body: "Pahalı olsa da başka bölgeye taşıma.", authority: "guidance_only",
    });
    expect(projection.guidance.sources[0]?.sourceRef).toBe("owner:statement:1");
    for (const secret of ["workspace-secret", "connection-secret", "act_123456789", "campaign-secret", "card-secret", "source-secret", "policy-secret"]) {
      expect(serialized).not.toContain(secret);
    }
    expect(projection.identity.accountRef).toMatch(/^ref_[a-f0-9]{12}$/);
    expect(projection.writeOperations).toBe(0);
  });

  it("produces stable aliases without exposing short references", () => {
    const first = projectEffectiveCampaignContext(internal);
    const second = projectEffectiveCampaignContext(internal);
    expect(second).toEqual(first);
    expect(first.identity.entityRef).toBe(first.identity.campaignRef);
    expect(first.identity.entityRef).not.toContain("campaign");
  });

  it("rejects a tampered internal context before projection", () => {
    expect(() => projectEffectiveCampaignContext({
      ...internal,
      data: { ...internal.data, blockers: ["forged"] },
    })).toThrowError(PublicCampaignContextError);
  });
});
