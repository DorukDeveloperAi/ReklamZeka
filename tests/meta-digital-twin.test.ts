import { getTableColumns, getTableName } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import goldenFixture from "./fixtures/meta-digital-twin.json";
import {
  adAccounts,
  adCampaigns,
  dataSources,
  metaAdCreativeBindings,
  metaAds,
  metaAdSets,
  metaAssetEdges,
  metaAssets,
  metaConnections,
  metaCreatives,
  metaPosts,
} from "@/db/schema";
import {
  BudgetOwnerResolutionError,
  resolveBudgetOwners,
} from "@/domain/meta/budget-owner";
import {
  type MetaDigitalTwinSnapshotInput,
  MetaDigitalTwinValidationError,
  normalizeMetaDigitalTwinSnapshot,
} from "@/domain/meta/digital-twin";

function fixture(): MetaDigitalTwinSnapshotInput {
  return structuredClone(goldenFixture) as MetaDigitalTwinSnapshotInput;
}

describe("Meta digital twin persistence contract", () => {
  it("keeps connection, hierarchy, content identity, assets and bindings explicit", () => {
    expect([
      metaConnections,
      metaAdSets,
      metaAds,
      metaCreatives,
      metaPosts,
      metaAssets,
      metaAssetEdges,
      metaAdCreativeBindings,
    ].map(getTableName)).toEqual([
      "meta_connections",
      "meta_ad_sets",
      "meta_ads",
      "meta_creatives",
      "meta_posts",
      "meta_assets",
      "meta_asset_edges",
      "meta_ad_creative_bindings",
    ]);

    expect(getTableColumns(dataSources)).toHaveProperty("metaConnectionId");
    expect(getTableColumns(adAccounts)).toMatchObject({
      sourceUpdatedAt: expect.anything(),
      fetchedAt: expect.anything(),
      rawPayloadHash: expect.anything(),
      firstSeenAt: expect.anything(),
      lastSeenAt: expect.anything(),
      disappearedAt: expect.anything(),
      configuredStatus: expect.anything(),
      effectiveStatus: expect.anything(),
    });
    expect(getTableColumns(adCampaigns)).toMatchObject({
      objectiveSource: expect.anything(),
      legacyObjectiveSource: expect.anything(),
      objectiveMappingVersion: expect.anything(),
      buyingType: expect.anything(),
      specialAdCategories: expect.anything(),
      campaignBudgetOptimization: expect.anything(),
      dailyBudgetMinor: expect.anything(),
      lifetimeBudgetMinor: expect.anything(),
    });
    expect(getTableColumns(metaAdSets)).toMatchObject({
      optimizationGoal: expect.anything(),
      billingEvent: expect.anything(),
      costCapMinor: expect.anything(),
      attributionSpec: expect.anything(),
      promotedObject: expect.anything(),
      targetingSummary: expect.anything(),
      targetingSignature: expect.anything(),
    });
    expect(getTableColumns(metaCreatives)).toMatchObject({
      primaryText: expect.anything(),
      headline: expect.anything(),
      contentProvenance: expect.anything(),
      dynamicVariants: expect.anything(),
    });
    expect(getTableColumns(metaAds)).not.toHaveProperty("dailyBudgetMinor");
    expect(getTableColumns(metaAds)).not.toHaveProperty("lifetimeBudgetMinor");
  });
});

describe("Meta digital twin canonical replay", () => {
  it("preserves the field matrix and produces the same result for reordered source arrays", () => {
    const original = normalizeMetaDigitalTwinSnapshot(fixture());
    const reorderedInput = fixture();
    const reordered = normalizeMetaDigitalTwinSnapshot({
      ...reorderedInput,
      adSets: [...reorderedInput.adSets].reverse(),
      campaigns: [...reorderedInput.campaigns].reverse(),
      assetEdges: [...reorderedInput.assetEdges].reverse(),
    });

    expect(reordered).toEqual(original);
    expect(original.adSets.map((adSet) => adSet.externalAdSetId)).toEqual(["set_300", "set_301"]);
    expect(original.campaigns[0]).toMatchObject({
      objectiveSource: "OUTCOME_LEADS",
      legacyObjectiveSource: "LEAD_GENERATION",
      canonicalObjective: "LEADS",
      campaignBudgetOptimization: true,
      dailyBudgetMinor: 250000,
    });
    expect(original.adSets[1]).toMatchObject({
      optimizationGoal: "LEAD_GENERATION",
      billingEvent: "IMPRESSIONS",
      targetingSignature: "targeting:istanbul-v1",
    });
    expect(original.creatives[0]).toMatchObject({
      sourceType: "existing_post",
      primaryText: "Mevcut gönderi metni",
      externalPostId: "post_700",
      actorExternalAssetId: "page_600",
    });
    expect(original.snapshotHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("fails closed for orphan hierarchy and cross-account references", () => {
    const orphan = fixture();
    (orphan.adSets[0] as { externalCampaignId: string }).externalCampaignId = "missing_campaign";
    expect(() => normalizeMetaDigitalTwinSnapshot(orphan)).toThrowError(
      expect.objectContaining<Partial<MetaDigitalTwinValidationError>>({ code: "orphan_parent" }),
    );

    const crossAccount = fixture();
    (crossAccount.ads[0] as { externalAccountId: string }).externalAccountId = "act_other";
    expect(() => normalizeMetaDigitalTwinSnapshot(crossAccount)).toThrowError(
      expect.objectContaining<Partial<MetaDigitalTwinValidationError>>({ code: "cross_account_reference" }),
    );

    const mismatchedParent = fixture();
    (mismatchedParent.campaigns as MetaDigitalTwinSnapshotInput["campaigns"][number][]).push({
      ...mismatchedParent.campaigns[0]!,
      externalCampaignId: "cmp_other",
      name: "Other campaign",
    });
    (mismatchedParent.ads[0] as { externalCampaignId: string }).externalCampaignId = "cmp_other";
    expect(() => normalizeMetaDigitalTwinSnapshot(mismatchedParent)).toThrowError(
      expect.objectContaining<Partial<MetaDigitalTwinValidationError>>({ code: "orphan_parent" }),
    );
  });

  it("rejects ad-level budget fields at the canonical boundary", () => {
    const input = fixture();
    Object.assign(input.ads[0]!, { dailyBudgetMinor: 1000 });
    expect(() => normalizeMetaDigitalTwinSnapshot(input)).toThrowError(
      expect.objectContaining<Partial<MetaDigitalTwinValidationError>>({ code: "ad_level_budget_not_supported" }),
    );
  });
});

describe("deterministic Meta budget owner resolver", () => {
  it("resolves one campaign owner for CBO", () => {
    expect(resolveBudgetOwners({
      campaign: {
        externalCampaignId: "cmp_1",
        campaignBudgetOptimization: true,
        dailyBudgetMinor: 50000,
      },
      adSets: [
        { externalAdSetId: "set_2" },
        { externalAdSetId: "set_1" },
      ],
    })).toEqual({
      status: "resolved",
      model: "CBO",
      owners: [{ level: "campaign", externalId: "cmp_1", budgetType: "daily", amountMinor: 50000 }],
    });
  });

  it("resolves sorted ad-set owners for ABO", () => {
    expect(resolveBudgetOwners({
      campaign: { externalCampaignId: "cmp_1", campaignBudgetOptimization: false },
      adSets: [
        { externalAdSetId: "set_2", lifetimeBudgetMinor: 90000 },
        { externalAdSetId: "set_1", dailyBudgetMinor: 10000 },
      ],
    })).toEqual({
      status: "resolved",
      model: "ABO",
      owners: [
        { level: "ad_set", externalId: "set_1", budgetType: "daily", amountMinor: 10000 },
        { level: "ad_set", externalId: "set_2", budgetType: "lifetime", amountMinor: 90000 },
      ],
    });
  });

  it.each([
    {
      campaign: { externalCampaignId: "cmp", campaignBudgetOptimization: true },
      adSets: [{ externalAdSetId: "set" }],
      reason: "campaign_budget_missing",
    },
    {
      campaign: { externalCampaignId: "cmp", campaignBudgetOptimization: false, dailyBudgetMinor: 1 },
      adSets: [{ externalAdSetId: "set", dailyBudgetMinor: 1 }],
      reason: "conflicting_budget_levels",
    },
    {
      campaign: { externalCampaignId: "cmp", campaignBudgetOptimization: false },
      adSets: [{ externalAdSetId: "set" }],
      reason: "ad_set_budget_missing",
    },
    {
      campaign: { externalCampaignId: "cmp", campaignBudgetOptimization: false, dailyBudgetMinor: 1 },
      adSets: [],
      reason: "budget_mode_conflict",
    },
    {
      campaign: {
        externalCampaignId: "cmp",
        campaignBudgetOptimization: true,
        dailyBudgetMinor: 1,
        lifetimeBudgetMinor: 2,
      },
      adSets: [],
      reason: "ambiguous_budget_period",
    },
  ])("returns reasoned unknown state: $reason", ({ campaign, adSets, reason }) => {
    expect(resolveBudgetOwners({ campaign, adSets })).toMatchObject({ status: "unknown", reason });
  });

  it("strictly rejects an ad-level budget", () => {
    expect(() => resolveBudgetOwners({
      campaign: { externalCampaignId: "cmp", campaignBudgetOptimization: false },
      adSets: [{ externalAdSetId: "set", dailyBudgetMinor: 1000 }],
      ads: [{ externalAdId: "ad", dailyBudgetMinor: 100 }],
    })).toThrowError(expect.objectContaining<Partial<BudgetOwnerResolutionError>>({
      code: "ad_level_budget_not_supported",
      entityExternalId: "ad",
    }));
  });
});
