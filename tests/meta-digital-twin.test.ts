import { describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";
import goldenFixture from "./fixtures/meta-digital-twin.json";
import { metaAdSets, metaAds, metaAssetEdges, metaAssets, metaCreatives } from "@/db/schema";
import { resolveMetaBudgetOwner, stableTwinSnapshotHash, validateMetaHierarchy } from "@/domain/meta/digital-twin";

const fixture = goldenFixture;

describe("Meta digital twin core", () => {
  it("has the canonical hierarchy, creative identity and asset-edge tables", () => {
    expect([metaAdSets, metaAds, metaCreatives, metaAssets, metaAssetEdges].map(getTableName)).toEqual([
      "meta_ad_sets", "meta_ads", "meta_creatives", "meta_assets", "meta_asset_edges",
    ]);
  });

  it("resolves CBO, ABO and unresolved budget owners deterministically", () => {
    expect(resolveMetaBudgetOwner(fixture)).toMatchObject({ level: "campaign", ownerExternalId: "cmp-golden-1", dailyBudgetMinor: 15_000 });
    expect(resolveMetaBudgetOwner({ campaign: { externalId: "cmp-2", budgetOptimizationEnabled: false, dailyBudgetMinor: null, lifetimeBudgetMinor: null }, adSet: { externalId: "set-2", dailyBudgetMinor: null, lifetimeBudgetMinor: 90_000 } })).toMatchObject({ level: "ad_set", ownerExternalId: "set-2" });
    expect(resolveMetaBudgetOwner({ campaign: { externalId: "cmp-3", budgetOptimizationEnabled: null, dailyBudgetMinor: null, lifetimeBudgetMinor: null }, adSet: { externalId: "set-3", dailyBudgetMinor: null, lifetimeBudgetMinor: null } })).toMatchObject({ level: "unknown", reason: "budget_not_returned_by_source" });
  });

  it("rejects invalid ad-level budgets and detects orphan hierarchy", () => {
    expect(() => resolveMetaBudgetOwner({ ...fixture, ad: { externalId: "ad-1", dailyBudgetMinor: 1 } })).toThrow("Meta ad-level budget");
    expect(validateMetaHierarchy([{ externalId: "cmp-1", parentExternalId: null }], [{ externalId: "set-1", parentExternalId: "missing" }], [{ externalId: "ad-1", parentExternalId: "missing" }])).toEqual(["orphan_ad_set:set-1", "orphan_ad:ad-1"]);
  });

  it("accepts the golden hierarchy without orphans", () => {
    expect(validateMetaHierarchy(fixture.hierarchy.campaigns, fixture.hierarchy.adSets, fixture.hierarchy.ads)).toEqual([]);
  });

  it("replays an unchanged golden fixture with the same canonical hash", () => {
    const reordered = { hierarchy: fixture.hierarchy, adSet: fixture.adSet, campaign: fixture.campaign };
    expect(stableTwinSnapshotHash(fixture)).toBe(stableTwinSnapshotHash(reordered));
  });
});
