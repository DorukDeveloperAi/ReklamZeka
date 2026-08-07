import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { ConnectorError } from "@/connectors/contract";
import { discoverMetaAssetMirror } from "@/connectors/meta/asset-mirror";
import { MetaGraphClient, META_GRAPH_API_VERSION, type MetaFetch } from "@/connectors/meta/graph-client";
import { discoverMetaPostMediaInventory } from "@/connectors/meta/post-media-inventory";
import { DrizzleMetaAssetContentRepository } from "@/connectors/meta/sync/asset-content-drizzle-repository";
import { MetaAssetContentPersistenceError } from "@/connectors/meta/sync/asset-content-persistence";
import {
  MetaS14LiveAssetContentService,
  repositoryBackedMetaAssetContentRun,
} from "@/connectors/meta/sync/live-asset-content-service";
import { MetaGraphSyncTransport } from "@/connectors/meta/sync/graph-transport";
import {
  DrizzleMetaTrustReadStore,
  MetaTrustReadinessEvidenceAdapter,
} from "@/connectors/meta/sync/trust-readiness-drizzle-adapter";
import { sliceId, stableHash, type MetaReadPage, type MetaReadTransport } from "@/connectors/meta/sync/types";
import * as schema from "@/db/schema";
import { extractMetaAdContent } from "@/domain/meta/content/extract";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

const databaseUrl = process.env.DATABASE_URL?.trim();
const token = process.env.META_ACCESS_TOKEN?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL yapılandırılmadı");
if (!token) throw new Error("META_ACCESS_TOKEN yapılandırılmadı");

const suffix = randomUUID().replaceAll("-", "");
const workspaceId = randomUUID();
const connectionId = randomUUID();
const connectionExternalKey = `s14-live-${suffix}`;
const fieldCatalogVersion = "s14-live-acceptance-v1";
const fetchedAt = new Date();
const creativePageSize = 10;
let getNetworkCalls = 0;
let writeNetworkCalls = 0;
let persistenceFailureCode: string | null = null;

const trackedFetch: MetaFetch = async (input, init) => {
  const method = (init?.method ?? "GET").toUpperCase();
  if (method !== "GET") {
    writeNetworkCalls += 1;
    throw new Error("S1.4 canlı kabulü GET dışı Meta çağrısına izin vermez");
  }
  getNetworkCalls += 1;
  const timeout = AbortSignal.timeout(20_000);
  const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  return fetch(input, { ...init, signal });
};

function openDatabase() {
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 2,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
  });
  return { pool, db: drizzle(pool, { schema }) };
}

type LiveAccount = Readonly<{
  id?: string;
  name?: string;
  currency?: string;
  timezone_name?: string;
  account_status?: number;
}>;

type SeedHierarchy = Readonly<{
  account: LiveAccount & { id: string };
  page: MetaReadPage;
  campaigns: readonly Readonly<Record<string, unknown>>[];
  adSets: readonly Readonly<Record<string, unknown>>[];
}>;

function requiredText(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function validCreativeRecord(
  record: Readonly<Record<string, unknown>>,
  knownActors: ReadonlySet<string>,
): boolean {
  const extraction = extractMetaAdContent(record);
  if (
    !extraction.adContext.externalAdId
    || !extraction.adContext.externalCampaignId
    || !extraction.adContext.externalAdSetId
    || !extraction.creative.externalCreativeId
  ) return false;
  if (!extraction.post) return true;
  const actors = [
    extraction.post.actorPageExternalId,
    extraction.post.actorInstagramExternalId,
  ].filter((value): value is string => Boolean(value));
  return actors.length > 0 && actors.every((actor) => knownActors.has(actor));
}

async function prepareHierarchy(
  client: MetaGraphClient,
  transport: MetaGraphSyncTransport,
  account: LiveAccount & { id: string },
  knownActors: ReadonlySet<string>,
): Promise<SeedHierarchy | null> {
  try {
    const page = await transport.get({
      method: "GET",
      stream: "creative_post",
      accountId: account.id,
      entityLevel: "ad",
      dateStart: null,
      dateStop: null,
      cursor: null,
      limit: creativePageSize,
      correlation: {
        parentRunId: "s14-live-preflight",
        streamRunId: "s14-live-preflight",
        accountId: account.id,
        sliceId: "s14-live-preflight",
        cursorId: "first-page",
      },
    });
    const persistableRecords = page.records.filter((record) => validCreativeRecord(record, knownActors));
    if (persistableRecords.length === 0) return null;
    const persistablePage: MetaReadPage = { ...page, records: persistableRecords };

    const campaignIds = [...new Set(persistablePage.records
      .map((record) => requiredText(record.campaign_id))
      .filter((id): id is string => Boolean(id)))];
    const adSetIds = [...new Set(persistablePage.records
      .map((record) => requiredText(record.adset_id))
      .filter((id): id is string => Boolean(id)))];
    const [campaigns, adSets] = await Promise.all([
      Promise.all(campaignIds.map((id) => client.get<Readonly<Record<string, unknown>>>(`/${id}`, {
        fields: "id,name,status,effective_status,objective,buying_type,updated_time",
      }))),
      Promise.all(adSetIds.map((id) => client.get<Readonly<Record<string, unknown>>>(`/${id}`, {
        fields: "id,name,status,effective_status,campaign_id,optimization_goal,billing_event,updated_time",
      }))),
    ]);
    if (
      campaigns.some((row) => !requiredText(row.id))
      || adSets.some((row) => !requiredText(row.id) || !requiredText(row.campaign_id))
    ) return null;
    return { account, page: persistablePage, campaigns, adSets };
  } catch {
    return null;
  }
}

const client = new MetaGraphClient(token, trackedFetch);
const transport = new MetaGraphSyncTransport(client);
const [accountRows, assetSnapshot, postMediaInventory] = await Promise.all([
  client.listAll<LiveAccount>("/me/adaccounts", {
    fields: "id,name,currency,timezone_name,account_status",
    limit: "100",
  }),
  discoverMetaAssetMirror({
    token,
    workspaceId,
    connectionExternalKey,
    fetchImpl: trackedFetch,
  }),
  discoverMetaPostMediaInventory({
    token,
    workspaceId,
    connectionExternalKey,
    fetchImpl: trackedFetch,
    maxPagesPerActor: 1,
  }),
]);
const accounts = accountRows.filter((account): account is LiveAccount & { id: string } => Boolean(account.id?.trim()));
if (accounts.length === 0) throw new Error("Canlı Meta kabulü için erişilebilir reklam hesabı bulunamadı");
if (assetSnapshot.writeOperations !== 0 || postMediaInventory.writeOperations !== 0) {
  throw new Error("Canlı Meta discovery salt-okunur sınırını ihlal etti");
}

const knownActors = new Set(assetSnapshot.assets.map((asset) => asset.externalAssetId));
const selected: SeedHierarchy[] = [];
for (const account of accounts) {
  const prepared = await prepareHierarchy(client, transport, account, knownActors);
  if (prepared) selected.push(prepared);
  if (selected.length === 2) break;
}
if (selected.length === 0) throw new Error("Kalıcılık kabulüne uygun canlı reklam hiyerarşisi bulunamadı");

const accountDbIdByExternal = new Map(accounts.map((account) => [account.id, randomUUID()]));
const dataSourceIdByExternal = new Map(accounts.map((account) => [account.id, randomUUID()]));
const campaignDbIdByExternal = new Map<string, string>();
const adSetDbIdByExternal = new Map<string, string>();
const streamDbIdByExternal = new Map(selected.map(({ account }) => [account.id, randomUUID()]));
const runDbIdByExternal = new Map(selected.map(({ account }) => [account.id, randomUUID()]));
const creativeSliceKeyByAccount = Object.fromEntries(selected.map(({ account }) => [
  account.id,
  sliceId("creative_post", account.id, "ad", null, null),
]));
const assetSliceKey = `s14-live-asset:${suffix}`;
const postMediaSliceKey = `s14-live-post-media:${suffix}`;

for (const hierarchy of selected) {
  for (const campaign of hierarchy.campaigns) {
    const externalId = requiredText(campaign.id)!;
    if (!campaignDbIdByExternal.has(externalId)) campaignDbIdByExternal.set(externalId, randomUUID());
  }
  for (const adSet of hierarchy.adSets) {
    const externalId = requiredText(adSet.id)!;
    if (!adSetDbIdByExternal.has(externalId)) adSetDbIdByExternal.set(externalId, randomUUID());
  }
}

const setup = openDatabase();
try {
  await setup.db.transaction(async (tx) => {
    await tx.insert(schema.workspaces).values({ id: workspaceId, name: "S1.4 live temporary acceptance" });
    await tx.insert(schema.metaConnections).values({
      id: connectionId,
      workspaceId,
      externalConnectionKey: connectionExternalKey,
      displayName: "S1.4 live temporary connection",
      graphApiVersion: META_GRAPH_API_VERSION,
      fieldCatalogVersion,
      enabledCapabilities: ["read_only"],
    });

    await tx.insert(schema.dataSources).values(accounts.map((account) => ({
      id: dataSourceIdByExternal.get(account.id)!,
      workspaceId,
      metaConnectionId: connectionId,
      platform: "meta_ads" as const,
      externalAccountId: account.id,
      displayName: account.name?.trim() || "Meta account",
    })));
    await tx.insert(schema.adAccounts).values(accounts.map((account) => ({
      id: accountDbIdByExternal.get(account.id)!,
      workspaceId,
      dataSourceId: dataSourceIdByExternal.get(account.id)!,
      externalAccountId: account.id,
      name: account.name?.trim() || "Meta account",
      currency: account.currency?.trim() || "UNKNOWN",
      timezone: account.timezone_name?.trim() || "UTC",
      accountStatus: account.account_status === undefined ? "UNKNOWN" : String(account.account_status),
      fetchedAt,
      rawPayloadHash: stableHash(account),
      sourceGraphVersion: META_GRAPH_API_VERSION,
      fieldCatalogVersion,
      provenance: { sourceEdge: "/me/adaccounts", sourceRevision: fetchedAt.toISOString() },
    })));

    for (const hierarchy of selected) {
      const accountDbId = accountDbIdByExternal.get(hierarchy.account.id)!;
      await tx.insert(schema.adCampaigns).values(hierarchy.campaigns.map((campaign) => ({
        id: campaignDbIdByExternal.get(requiredText(campaign.id)!)!,
        workspaceId,
        adAccountId: accountDbId,
        externalCampaignId: requiredText(campaign.id)!,
        name: requiredText(campaign.name) ?? "Meta campaign",
        configuredStatus: requiredText(campaign.status),
        effectiveStatus: requiredText(campaign.effective_status),
        objectiveSource: requiredText(campaign.objective),
        buyingType: requiredText(campaign.buying_type),
        sourceUpdatedAt: requiredText(campaign.updated_time) ? new Date(requiredText(campaign.updated_time)!) : null,
        fetchedAt,
        rawPayloadHash: stableHash(campaign),
        sourceGraphVersion: META_GRAPH_API_VERSION,
        fieldCatalogVersion,
        provenance: { sourceEdge: "/{campaign-id}", sourceRevision: requiredText(campaign.updated_time) ?? fetchedAt.toISOString() },
      })));
      await tx.insert(schema.metaAdSets).values(hierarchy.adSets.map((adSet) => ({
        id: adSetDbIdByExternal.get(requiredText(adSet.id)!)!,
        workspaceId,
        adAccountId: accountDbId,
        campaignId: campaignDbIdByExternal.get(requiredText(adSet.campaign_id)!)!,
        externalAdSetId: requiredText(adSet.id)!,
        name: requiredText(adSet.name) ?? "Meta ad set",
        configuredStatus: requiredText(adSet.status),
        effectiveStatus: requiredText(adSet.effective_status),
        optimizationGoal: requiredText(adSet.optimization_goal),
        billingEvent: requiredText(adSet.billing_event),
        sourceUpdatedAt: requiredText(adSet.updated_time) ? new Date(requiredText(adSet.updated_time)!) : null,
        fetchedAt,
        rawPayloadHash: stableHash(adSet),
        sourceGraphVersion: META_GRAPH_API_VERSION,
        fieldCatalogVersion,
        provenance: { sourceEdge: "/{ad-set-id}", sourceRevision: requiredText(adSet.updated_time) ?? fetchedAt.toISOString() },
      })));
      await tx.insert(schema.metaAds).values(hierarchy.page.records.map((ad) => ({
        workspaceId,
        adAccountId: accountDbId,
        campaignId: campaignDbIdByExternal.get(requiredText(ad.campaign_id)!)!,
        adSetId: adSetDbIdByExternal.get(requiredText(ad.adset_id)!)!,
        externalAdId: requiredText(ad.id)!,
        name: requiredText(ad.name) ?? "Meta ad",
        configuredStatus: requiredText(ad.status),
        effectiveStatus: requiredText(ad.effective_status),
        fetchedAt,
        rawPayloadHash: stableHash(ad),
        sourceGraphVersion: META_GRAPH_API_VERSION,
        fieldCatalogVersion,
        provenance: { sourceEdge: "/{ad-account-id}/ads", sourceRevision: fetchedAt.toISOString() },
      })));

      const streamId = streamDbIdByExternal.get(hierarchy.account.id)!;
      const runId = runDbIdByExternal.get(hierarchy.account.id)!;
      await tx.insert(schema.metaSyncStreams).values({
        id: streamId,
        workspaceId,
        metaConnectionId: connectionId,
        adAccountId: accountDbId,
        streamType: "creative",
        status: "running",
      });
      await tx.insert(schema.metaSyncRuns).values({
        id: runId,
        workspaceId,
        metaConnectionId: connectionId,
        adAccountId: accountDbId,
        streamId,
        streamType: "creative",
        idempotencyKey: `s14-live-${suffix}-${selected.indexOf(hierarchy)}`,
        status: "running",
      });
      await tx.insert(schema.metaSyncSlices).values({
        workspaceId,
        metaConnectionId: connectionId,
        adAccountId: accountDbId,
        runId,
        streamType: "creative",
        entityLevel: "ad",
        sliceKey: creativeSliceKeyByAccount[hierarchy.account.id]!,
        status: "running",
      });
    }

    const globalAccount = selected[0]!.account.id;
    await tx.insert(schema.metaSyncSlices).values([assetSliceKey, postMediaSliceKey].map((sliceKey) => ({
      workspaceId,
      metaConnectionId: connectionId,
      adAccountId: accountDbIdByExternal.get(globalAccount)!,
      runId: runDbIdByExternal.get(globalAccount)!,
      streamType: "creative" as const,
      sliceKey,
      status: "running" as const,
    })));
  });
} finally {
  await setup.pool.end();
}

let temporaryWorkspaceRemoved = false;
let evidence: Record<string, unknown> | null = null;
try {
  const connection = openDatabase();
  try {
    const repository = new DrizzleMetaAssetContentRepository(connection.db);
    const beginRepositoryRun = repositoryBackedMetaAssetContentRun(repository);
    const capturedPageByAccount = new Map(selected.map((hierarchy) => [hierarchy.account.id, hierarchy.page]));
    const injectedFailureAccount = selected[1]?.account.id ?? null;
    const capturedLiveTransport: MetaReadTransport = {
      get: async (request) => {
        if (request.stream !== "creative_post" || request.cursor !== null) {
          throw new ConnectorError("invalid_data", "Canlı kabul transport kapsamı aşıldı", false);
        }
        if (injectedFailureAccount && request.accountId === injectedFailureAccount) {
          throw new ConnectorError("transient", "İzole hesap hatası", true);
        }
        const page = capturedPageByAccount.get(request.accountId);
        if (!page) throw new ConnectorError("invalid_data", "Canlı kabul sayfası bulunamadı", false);
        return page;
      },
    };
    const service = new MetaS14LiveAssetContentService({
      secretResolver: { resolve: async (reference) => reference === "env:META_ACCESS_TOKEN" ? token : "" },
      beginPersistenceRun: async (scope) => {
        const writer = await beginRepositoryRun(scope);
        return {
          writePage: async (page) => {
            try {
              return await writer.writePage(page);
            } catch (error) {
              persistenceFailureCode = error instanceof MetaAssetContentPersistenceError
                ? error.code
                : "database_error";
              throw error;
            }
          },
        };
      },
      fetchImpl: trackedFetch,
      transportFactory: () => capturedLiveTransport,
      discoverAssets: async () => assetSnapshot,
      discoverPostInventory: async () => postMediaInventory,
      maxPagesPerAccount: 1,
      maxPagesPerActor: 1,
      accountConcurrency: 2,
      initialPageSize: creativePageSize,
      minPageSize: creativePageSize,
      maxAttempts: 2,
      sleep: async () => undefined,
    });
    const result = await service.run({
      runId: runDbIdByExternal.get(selected[0]!.account.id)!,
      workspaceId,
      connectionId,
      connectionExternalKey,
      secretReference: "env:META_ACCESS_TOKEN",
      selectedAdAccountExternalIds: selected.map(({ account }) => account.id),
      sliceKeys: {
        asset: assetSliceKey,
        postMedia: postMediaSliceKey,
        creativeByAdAccountExternalId: creativeSliceKeyByAccount,
      },
    });

    const countFor = async (table: typeof schema.metaAssets | typeof schema.metaAssetEdges | typeof schema.metaAssetDiscoveries | typeof schema.metaPosts | typeof schema.metaCreatives | typeof schema.metaAdCreativeBindings) =>
      (await connection.db.select({ value: count() }).from(table).where(eq(table.workspaceId, workspaceId)))[0]?.value ?? 0;
    const [assets, assetEdges, discoveries, posts, creatives, bindings] = await Promise.all([
      countFor(schema.metaAssets),
      countFor(schema.metaAssetEdges),
      countFor(schema.metaAssetDiscoveries),
      countFor(schema.metaPosts),
      countFor(schema.metaCreatives),
      countFor(schema.metaAdCreativeBindings),
    ]);
    const checkpoints = await connection.db.select({ checkpoint: schema.metaSyncSlices.checkpoint })
      .from(schema.metaSyncSlices)
      .where(eq(schema.metaSyncSlices.workspaceId, workspaceId));
    const durableCheckpoints = checkpoints.filter((row) => row.checkpoint.assetContent && typeof row.checkpoint.assetContent === "object").length;
    const trustReport = await new MetaTrustReadinessEvidenceAdapter(
      new DrizzleMetaTrustReadStore(connection.db),
    ).buildReport({
      workspaceId,
      connectionId,
      selectedExternalAccountIds: selected.map(({ account }) => account.id),
      evaluatedAt: new Date().toISOString(),
    });
    const publicTrustJson = JSON.stringify(trustReport);
    const trustAccountCountMatches = trustReport.accounts.length === selected.length;
    const trustIdentityRedacted = selected.every(({ account }) => !publicTrustJson.includes(account.id));
    const trustFailsClosedWithoutInsights = trustReport.status === "not_ready";
    const accountFailureIsolated = injectedFailureAccount === null
      || (result.creativeEvidence.partialAccounts >= 1 && creatives > 0);
    const postPartialIsolated = result.postInventoryEvidence.status !== "partial"
      || (posts > 0 && durableCheckpoints >= 2);
    const partialIsolated = accountFailureIsolated
      && postPartialIsolated
      && result.persistenceEvidence.pagesWritten >= 3
      && assets > 0
      && posts > 0
      && creatives > 0
      && durableCheckpoints >= 3;

    if (writeNetworkCalls !== 0 || result.writeNetworkCalls !== 0) throw new Error("Meta write çağrısı tespit edildi");
    if (!trustAccountCountMatches || !trustIdentityRedacted || !trustFailsClosedWithoutInsights) {
      throw new Error("Trust/readiness canlı DB kanıtı fail-closed veya redaksiyon şartını karşılamadı");
    }
    if (!partialIsolated) {
      throw new Error(JSON.stringify({
        reason: "partial_isolation_evidence_failed",
        serviceStatus: result.status,
        pagesWritten: result.persistenceEvidence.pagesWritten,
        assets,
        posts,
        creatives,
        durableCheckpoints,
        persistenceFailureCode,
      }));
    }
    if (result.creativeEvidence.contentWithCopy === 0) throw new Error("Canlı kreatif metni kalıcılaştırılamadı");

    evidence = {
      status: "ok",
      selectedAccounts: selected.length,
      getNetworkCalls,
      writeNetworkCalls,
      serviceStatus: result.status,
      assetsObserved: result.assetEvidence.assets,
      adsObserved: result.creativeEvidence.adsObserved,
      contentWithCopy: result.creativeEvidence.contentWithCopy,
      existingPostBindings: result.creativeEvidence.existingPostBindings,
      postMediaObserved: result.postInventoryEvidence.items,
      partialAccounts: result.creativeEvidence.partialAccounts,
      partialPostInventory: result.postInventoryEvidence.status === "partial",
      injectedAccountFailure: injectedFailureAccount !== null,
      trust: {
        status: trustReport.status,
        accountCount: trustReport.accounts.length,
        accountCountMatches: trustAccountCountMatches,
        identityRedacted: trustIdentityRedacted,
        failsClosedWithoutInsights: trustFailsClosedWithoutInsights,
      },
      persisted: { assets, assetEdges, discoveries, posts, creatives, bindings, durableCheckpoints },
      persistence: result.persistenceEvidence,
      persistenceFailureCode,
      accountFailureIsolated,
      postPartialIsolated,
      partialIsolated,
    };
  } finally {
    await connection.pool.end();
  }
} finally {
  const cleanup = openDatabase();
  try {
    await cleanup.db.delete(schema.workspaces).where(eq(schema.workspaces.id, workspaceId));
    const remaining = await cleanup.db.select({ value: count() }).from(schema.workspaces)
      .where(eq(schema.workspaces.id, workspaceId));
    temporaryWorkspaceRemoved = (remaining[0]?.value ?? 0) === 0;
  } finally {
    await cleanup.pool.end();
  }
}

if (!temporaryWorkspaceRemoved) throw new Error("Geçici S1.4 workspace temizlenemedi");
console.log(JSON.stringify({ ...evidence, temporaryWorkspaceRemoved }));
