import { readFileSync } from "node:fs";
import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  metaAdCreativeBindings,
  metaAds,
  metaAssetDiscoveries,
  metaAssetDiscoveryResource,
  metaAssetEdges,
  metaAssetOwnershipKind,
  metaAssets,
  metaCreatives,
  metaPosts,
} from "@/db/schema";

function indexNames(table: Parameters<typeof getTableConfig>[0]): readonly string[] {
  return getTableConfig(table).indexes
    .map((entry) => entry.config.name)
    .filter((name): name is string => name !== undefined);
}

describe("S1.4 asset and content persistence contract", () => {
  it("stores canonical asset ownership and post promotion evidence", () => {
    expect(metaAssetOwnershipKind.enumValues).toEqual([
      "owned",
      "shared",
      "linked",
      "accessible",
      "unknown",
    ]);
    expect(metaAssetDiscoveryResource.enumValues).toContain("whatsapp_business_accounts");
    expect(getTableColumns(metaAssets)).toMatchObject({
      username: expect.anything(),
      ownershipKind: expect.anything(),
      ownerBusinessExternalId: expect.anything(),
      ownershipEvidence: expect.anything(),
    });
    expect(getTableColumns(metaPosts)).toMatchObject({
      sourceMessage: expect.anything(),
      sourceCaption: expect.anything(),
      publishedAt: expect.anything(),
      promotionEligibilityStatus: expect.anything(),
      promotionEligibilityReason: expect.anything(),
      promotionEligibilityEvaluatedAt: expect.anything(),
      contentHash: expect.anything(),
    });
  });

  it("persists bounded discoveries with an idempotent natural key", () => {
    expect(getTableName(metaAssetDiscoveries)).toBe("meta_asset_discoveries");
    expect(getTableColumns(metaAssetDiscoveries)).toMatchObject({
      workspaceId: expect.anything(),
      metaConnectionId: expect.anything(),
      adAccountId: expect.anything(),
      discoveryKey: expect.anything(),
      resource: expect.anything(),
      sourceType: expect.anything(),
      sourceExternalId: expect.anything(),
      status: expect.anything(),
      reason: expect.anything(),
      itemCount: expect.anything(),
      rawPayloadHash: expect.anything(),
      sourceGraphVersion: expect.anything(),
      fieldCatalogVersion: expect.anything(),
      fetchedAt: expect.anything(),
    });
    expect(indexNames(metaAssetDiscoveries)).toContain(
      "meta_asset_discoveries_workspace_connection_key_unique",
    );
  });

  it("indexes all leading foreign-key access paths used by the mirror", () => {
    expect(indexNames(metaPosts)).toContain("meta_posts_actor_asset_idx");
    expect(indexNames(metaCreatives)).toEqual(expect.arrayContaining([
      "meta_creatives_post_idx",
      "meta_creatives_actor_asset_idx",
    ]));
    expect(indexNames(metaAds)).toContain("meta_ads_creative_idx");
    expect(indexNames(metaAssetEdges)).toEqual(expect.arrayContaining([
      "meta_asset_edges_ad_account_idx",
      "meta_asset_edges_target_asset_idx",
    ]));
    expect(indexNames(metaAdCreativeBindings)).toEqual(expect.arrayContaining([
      "meta_ad_creative_bindings_creative_idx",
      "meta_ad_creative_bindings_post_idx",
    ]));
  });

  it("keeps the new public table fail-closed for Supabase Data API roles", () => {
    const migration = readFileSync(
      new URL("../drizzle/20260807111957_marvelous_daimon_hellstrom.sql", import.meta.url),
      "utf8",
    );
    expect(migration).toContain('ALTER TABLE "meta_asset_discoveries" ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain(
      'REVOKE ALL PRIVILEGES ON TABLE "meta_asset_discoveries" FROM PUBLIC, anon, authenticated',
    );
  });
});
