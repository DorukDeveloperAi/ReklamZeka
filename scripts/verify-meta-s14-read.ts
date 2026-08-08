import { existsSync } from "node:fs";
import { discoverMetaAssetMirror } from "@/connectors/meta/asset-mirror";
import { MetaGraphClient } from "@/connectors/meta/graph-client";
import { discoverMetaPostMediaInventory } from "@/connectors/meta/post-media-inventory";
import { MetaGraphSyncTransport } from "@/connectors/meta/sync/graph-transport";
import { extractMetaAdContent } from "@/domain/meta/content/extract";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const token = process.env.META_ACCESS_TOKEN?.trim();
if (!token) throw new Error("META_ACCESS_TOKEN yapılandırılmadı");

const client = new MetaGraphClient(token);
const transport = new MetaGraphSyncTransport(client);
const accounts = await client.listAll<Readonly<{ id?: string }>>("/me/adaccounts", {
  fields: "id",
  limit: "100",
});
const accountIds = accounts
  .map((account) => account.id)
  .filter((id): id is string => Boolean(id));

const assetSnapshot = await discoverMetaAssetMirror({
  token,
  workspaceId: "live-acceptance",
  connectionExternalKey: "meta-read-mirror",
});
const postMediaSnapshot = await discoverMetaPostMediaInventory({
  token,
  workspaceId: "live-acceptance",
  connectionExternalKey: "meta-read-mirror",
  maxPagesPerActor: 1,
});

let sampledAds = 0;
let adsWithCopy = 0;
let adsWithPostIdentity = 0;
let adsWithDynamicVariants = 0;
let boundedIssues = 0;

for (const accountId of accountIds) {
  const page = await transport.get({
    method: "GET",
    stream: "creative_post",
    accountId,
    entityLevel: "ad",
    dateStart: null,
    dateStop: null,
    cursor: null,
    limit: 10,
    correlation: {
      parentRunId: "live-acceptance",
      streamRunId: "creative-post",
      accountId,
      sliceId: "sample",
      cursorId: "first-page",
    },
  });
  for (const record of page.records) {
    const content = extractMetaAdContent(record);
    sampledAds += 1;
    if (
      content.creative.primaryText
      || content.creative.headline
      || content.creative.description
      || content.creative.caption
    ) adsWithCopy += 1;
    if (content.post) adsWithPostIdentity += 1;
    if (content.creative.dynamicVariants.length > 0) adsWithDynamicVariants += 1;
    boundedIssues += content.issues.length;
  }
}

if (assetSnapshot.writeOperations !== 0) throw new Error("Asset mirror salt-okunur sınırı ihlal edildi");
if (sampledAds > 0 && adsWithCopy === 0) throw new Error("Canlı örnekte okunabilir reklam metni bulunamadı");

const byType = Object.fromEntries(
  [...new Set(assetSnapshot.assets.map((asset) => asset.assetType))]
    .sort()
    .map((assetType) => [
      assetType,
      assetSnapshot.assets.filter((asset) => asset.assetType === assetType).length,
    ]),
);
const discoveryGaps = assetSnapshot.discoveries.reduce<Record<string, number>>((result, discovery) => {
  if (discovery.status === "verified" || discovery.status === "empty") return result;
  result[discovery.status] = (result[discovery.status] ?? 0) + 1;
  return result;
}, {});
const postDiscoveryStatuses = postMediaSnapshot.discoveries.reduce<Record<string, number>>(
  (result, discovery) => {
    result[discovery.status] = (result[discovery.status] ?? 0) + 1;
    return result;
  },
  {},
);

console.log(JSON.stringify({
  status: "ok",
  accounts: accountIds.length,
  assets: assetSnapshot.assets.length,
  assetEdges: assetSnapshot.edges.length,
  assetTypes: byType,
  discoveryGaps,
  sampledAds,
  adsWithCopy,
  adsWithPostIdentity,
  adsWithDynamicVariants,
  boundedIssues,
  linkedPostMediaItems: postMediaSnapshot.items.length,
  postDiscoveryStatuses,
  writeOperations: 0,
}));
