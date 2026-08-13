import { existsSync } from "node:fs";
import { discoverMetaAssetMirror } from "@/connectors/meta/asset-mirror";
import type { MetaFetch } from "@/connectors/meta/graph-client";
import {
  MetaS14LiveAssetContentService,
  type MetaAssetContentPageWriter,
} from "@/connectors/meta/sync/live-asset-content-service";
import type { MetaAssetContentPage, MetaAssetContentWriteSummary } from "@/connectors/meta/sync/asset-content-persistence";
import { planMetaReadSync } from "@/connectors/meta/sync/planner";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const token = process.env.META_ACCESS_TOKEN?.trim();
const workspaceId = process.env.META_S14_RECOVERY_WORKSPACE_ID?.trim();
const connectionId = process.env.META_S14_RECOVERY_CONNECTION_ID?.trim();
const connectionExternalKey = process.env.META_S14_RECOVERY_CONNECTION_EXTERNAL_KEY?.trim();
const maxAccounts = Number(process.env.META_S14_RECOVERY_MAX_ACCOUNTS ?? "2");

if (!token) throw new Error("META_ACCESS_TOKEN yapılandırılmadı");
if (process.env.META_TOKEN_SECURITY_STATUS !== "rotated") {
  throw new Error("META_TOKEN_SECURITY_STATUS=rotated olmadan canlı recovery doğrulaması çalışmaz");
}
if (!workspaceId || !connectionId || !connectionExternalKey) {
  throw new Error("META_S14_RECOVERY_WORKSPACE_ID, META_S14_RECOVERY_CONNECTION_ID ve META_S14_RECOVERY_CONNECTION_EXTERNAL_KEY yapılandırılmalı");
}
if (!Number.isSafeInteger(maxAccounts) || maxAccounts < 1 || maxAccounts > 5) {
  throw new Error("META_S14_RECOVERY_MAX_ACCOUNTS 1-5 aralığında olmalı");
}

let getNetworkCalls = 0;
let writeNetworkCalls = 0;
const trackedFetch: MetaFetch = async (input, init) => {
  const method = (init?.method ?? "GET").toUpperCase();
  if (method !== "GET") {
    writeNetworkCalls += 1;
    throw new Error("S1.4 recovery doğrulaması GET dışı Meta çağrısını reddetti");
  }
  getNetworkCalls += 1;
  const timeout = AbortSignal.timeout(20_000);
  const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  return fetch(input, { ...init, signal });
};

/** In-memory canonical boundary: observes only Graph-verified persistence candidates. */
class CapturingWriter implements MetaAssetContentPageWriter {
  readonly pages: MetaAssetContentPage[] = [];

  async writePage(page: MetaAssetContentPage): Promise<MetaAssetContentWriteSummary> {
    this.pages.push(structuredClone(page));
    const recordCount = (page.assetSnapshot?.assets.length ?? 0)
      + (page.assetSnapshot?.edges.length ?? 0)
      + (page.assetSnapshot?.discoveries.length ?? 0)
      + (page.postMediaInventory?.items.length ?? 0)
      + (page.postMediaInventory?.discoveries.length ?? 0)
      + page.content.length;
    return { inserted: recordCount, updated: 0, unchanged: 0, stale: 0, cursor: page.cursor, recordCount };
  }
}

// Server-owned account discovery is the only source of selected accounts. No
// account, actor, post, raw ID or token is accepted from a client or printed.
const assetSnapshot = await discoverMetaAssetMirror({
  token,
  workspaceId,
  connectionExternalKey,
  fetchImpl: trackedFetch,
});
const selectedAccounts = assetSnapshot.adAccountExternalIds.slice(0, maxAccounts);
if (selectedAccounts.length === 0) {
  console.log(JSON.stringify({
    schemaVersion: "meta-s14-recovery-live-v2",
    status: "partial",
    reason: "no_server_discovered_ad_accounts",
    discovery: { selectedAccounts: 0, assets: assetSnapshot.assets.length, edges: assetSnapshot.edges.length },
    recovery: { targetActors: 0, recoveredItems: 0 },
    metaNetwork: { getCalls: getNetworkCalls, writeCalls: writeNetworkCalls },
    localDatabaseWrites: 0,
  }));
  process.exitCode = 2;
} else {
  const plan = planMetaReadSync({
    accountIds: selectedAccounts,
    dateStart: "2026-01-01",
    dateStop: "2026-01-01",
  });
  const creativeByAdAccountExternalId = Object.fromEntries(plan
    .filter((slice) => slice.stream === "creative_post")
    .map((slice) => [slice.accountId, slice.id]));
  const writer = new CapturingWriter();
  const service = new MetaS14LiveAssetContentService({
    secretResolver: { resolve: async () => token },
    beginPersistenceRun: async () => writer,
    fetchImpl: trackedFetch,
    // Reuse the authoritative server-owned `/me/accounts` snapshot collected
    // above; the service then performs bounded creative + exact recovery reads.
    discoverAssets: async () => assetSnapshot,
    maxPagesPerAccount: 1,
    maxPagesPerActor: 1,
    accountConcurrency: 1,
    initialPageSize: 25,
    minPageSize: 25,
    maxAttempts: 1,
  });
  const result = await service.run({
    runId: "meta-s14-recovery-live",
    workspaceId,
    connectionId,
    connectionExternalKey,
    secretReference: "env:META_ACCESS_TOKEN",
    selectedAdAccountExternalIds: selectedAccounts,
    sliceKeys: {
      asset: "meta-s14-recovery:asset",
      postMedia: "meta-s14-recovery:post-media",
      creativeByAdAccountExternalId,
    },
  });
  const recoveredInventory = writer.pages.find((page) => page.postMediaInventory)?.postMediaInventory;
  const recoveredItems = recoveredInventory?.items.length ?? 0;
  const status = writeNetworkCalls !== 0
    ? "unavailable"
    : recoveredItems === 0 || result.postInventoryEvidence.partialDiscoveries > 0
      ? "partial"
      : "completed";
  console.log(JSON.stringify({
    schemaVersion: "meta-s14-recovery-live-v2",
    status,
    reason: recoveredItems === 0 ? "no_exact_actor_post_returned" : status === "partial" ? "some_actor_edges_unavailable" : null,
    discovery: {
      selectedAccounts: selectedAccounts.length,
      assets: assetSnapshot.assets.length,
      edges: assetSnapshot.edges.length,
      creativeRecords: result.creativeEvidence.contentRecords,
      existingPostBindings: result.creativeEvidence.existingPostBindings,
    },
    recovery: {
      targetActors: result.postInventoryEvidence.recoveryTargetActors,
      recoveredItems,
      verifiedDiscoveries: result.postInventoryEvidence.verifiedDiscoveries,
      partialDiscoveries: result.postInventoryEvidence.partialDiscoveries,
      graphVerifiedOnly: true,
    },
    metaNetwork: { getCalls: getNetworkCalls, writeCalls: writeNetworkCalls },
    localDatabaseWrites: 0,
  }));
  if (status !== "completed") process.exitCode = 2;
}
