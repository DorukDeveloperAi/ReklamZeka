import { describe, expect, it } from "vitest";
import { buildEffectiveCampaignContext } from "@/analyses/effective-campaign-context";
import { CampaignContextReadError, CampaignContextReadService } from "@/application/campaign-context-read-service";
import { buildEffectiveGuidancePack, createGuidanceRegistry } from "@/domain/guidance/registry";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const campaignRef = "ref_fc75620250e2";
const guidance = buildEffectiveGuidancePack(createGuidanceRegistry({ workspaceId, sources: [], cards: [], sets: [], bindings: [] }), { workspaceId, accountId: "account_primary", objective: "lead_generation", internalCategoryIds: [], entity: { type: "campaign", id: "campaign_primary" }, topics: [], requiredTopics: [], evaluatedAt: "2026-08-10T12:00:00.000Z", budget: { maxCards: 1, maxSources: 1, maxCharacters: 1 } });
const context = buildEffectiveCampaignContext({ workspaceId, capturedAt: "2026-08-10T12:00:00.000Z",
  identity: { connectionRef: "connection_primary", accountRef: "account_primary", campaignRef: "campaign_primary", entityRef: "campaign_primary", entityType: "campaign", hierarchyRefs: ["campaign_primary"] },
  meta: { objective: { state: "known", value: "lead_generation" }, optimizationEvent: { state: "known", value: "lead" }, configuredStatus: { state: "known", value: "ACTIVE" }, effectiveStatus: { state: "known", value: "ACTIVE" }, budgetOwnerRef: { state: "known", value: null }, targetingSignature: { state: "unknown", reason: "not_observed" }, actorRef: { state: "known", value: null }, destinationRef: { state: "known", value: null } },
  categories: [], guidance, policies: [], cadence: { profileRef: "cadence_primary", decision: "observe", reason: "stable", cooldownUntil: null }, data: { trustStatus: "not_ready", snapshotRefs: ["snapshot_primary"], featureRefs: [], windowRefs: [], blockers: ["analysis_window_not_bound"] }, history: { changeRefs: [], decisionRefs: [], experimentRefs: [], practiceRefs: [], outcomeRefs: [] }, versions: { metaCatalog: "1", categoryResolver: "1", guidanceRegistry: "1", metricCatalog: "1", formulaCatalog: "1", timeframeResolver: "1" } });

describe("campaign context read service", () => {
  it("returns only the public projection for a matching valid campaign", async () => {
    const service = new CampaignContextReadService({ loadLatestValidCampaignPublic: async () => ({ context, sourceComponents: [], invalidated: false }) });
    const result = await service.get({ workspaceId, campaignRef });
    expect(result).toMatchObject({ view: "context", campaignRef, context: { identity: { campaignRef }, writeOperations: 0 } });
    expect(JSON.stringify(result)).not.toContain("campaign_primary");
  });

  it("fails closed for invalidated or mismatched projections", async () => {
    const invalid = new CampaignContextReadService({ loadLatestValidCampaignPublic: async () => ({ context, sourceComponents: [], invalidated: true }) });
    await expect(invalid.get({ workspaceId, campaignRef })).rejects.toMatchObject({ code: "unsafe_source" } satisfies Partial<CampaignContextReadError>);
    const mismatch = new CampaignContextReadService({ loadLatestValidCampaignPublic: async () => ({ context, sourceComponents: [], invalidated: false }) });
    await expect(mismatch.get({ workspaceId, campaignRef: "ref_000000000000" })).rejects.toMatchObject({ code: "unsafe_source" } satisfies Partial<CampaignContextReadError>);
  });
});
