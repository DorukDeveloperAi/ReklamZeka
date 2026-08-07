import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { and, count, eq, isNotNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { MetaGraphClient, type MetaFetch } from "@/connectors/meta/graph-client";
import { MetaGraphSyncTransport } from "@/connectors/meta/sync/graph-transport";
import { DrizzleMetaInventoryPagePersistence } from "@/connectors/meta/sync/inventory-drizzle-repository";
import { parseMetaInventoryPage } from "@/connectors/meta/sync/inventory-materialization";
import * as schema from "@/db/schema";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const databaseUrl = process.env.DIRECT_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
const token = process.env.META_ACCESS_TOKEN?.trim();
if (!databaseUrl || !token) throw new Error("Meta/Supabase canlı kabul yapılandırması eksik");

type GraphList = Readonly<{ data?: readonly Readonly<Record<string, unknown>>[] }>;
let getNetworkCalls = 0;
let writeNetworkCalls = 0;
const trackedFetch: MetaFetch = async (input, init) => {
  const method = (init?.method ?? "GET").toUpperCase();
  if (method !== "GET") { writeNetworkCalls += 1; throw new Error("Meta write canlı kabulde yasaktır"); }
  getNetworkCalls += 1;
  return fetch(input, init);
};

const client = new MetaGraphClient(token, trackedFetch, { graphApiVersion: "v23.0" });
const accounts = await client.get<GraphList>("/me/adaccounts", { fields: "id", limit: "1" });
const externalAccountId = accounts.data?.[0]?.id;
if (typeof externalAccountId !== "string" || !/^act_[0-9]{1,32}$/.test(externalAccountId)) {
  throw new Error("Canlı kabul için reklam hesabı bulunamadı");
}
const transport = new MetaGraphSyncTransport(client);
const rawPage = await transport.get({
  method: "GET",
  stream: "inventory",
  accountId: externalAccountId,
  entityLevel: "ad_set",
  dateStart: null,
  dateStop: null,
  cursor: null,
  limit: 3,
  correlation: { parentRunId: "geo_live_acceptance", streamRunId: "geo_live_acceptance_stream",
    accountId: externalAccountId, sliceId: "geo_live_acceptance_slice", cursorId: "a".repeat(64) },
});
if (!rawPage.records.length || !rawPage.sourceGraphVersion || !rawPage.fieldCatalogVersion) {
  throw new Error("Canlı AdSet sayfası canonical provenance üretmedi");
}

const workspaceId = randomUUID();
const connectionId = randomUUID();
const dataSourceId = randomUUID();
const adAccountId = randomUUID();
const suffix = workspaceId.replaceAll("-", "").slice(0, 16);
const observedAt = new Date().toISOString();
const page = parseMetaInventoryPage({
  workspaceId,
  connectionId,
  externalAccountId,
  parentRunId: `geo_live_${suffix}`,
  sliceId: `inventory:${externalAccountId}:ad_set:all:all`,
  cursorId: createHash("sha256").update(`geo-live:${suffix}`).digest("hex"),
  entityLevel: "ad_set",
  observedAt,
  sourceGraphVersion: rawPage.sourceGraphVersion,
  fieldCatalogVersion: rawPage.fieldCatalogVersion,
  terminal: true,
  records: rawPage.records,
});

const campaignExternalIds = [...new Set(page.records.map((record) => {
  if (record.level !== "ad_set") throw new Error("Canlı kabul AdSet dışı kayıt içeriyor");
  return record.externalCampaignId;
}))];
const campaignIds = new Map(campaignExternalIds.map((id) => [id, randomUUID()]));
const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 30_000 });
const database = drizzle(pool, { schema });
let canonicalAdSets = 0;
let affectedGeoSnapshots = 0;
let affectedGeoItems = 0;
let rawTargetingColumns = 0;
let temporaryWorkspaceRemoved = false;

try {
  await database.insert(schema.workspaces).values({ id: workspaceId, name: "Meta affected geo live acceptance" });
  await database.insert(schema.metaConnections).values({
    id: connectionId,
    workspaceId,
    externalConnectionKey: `geo_live_${suffix}`,
    displayName: "Meta affected geo live acceptance",
    graphApiVersion: "v23.0",
    fieldCatalogVersion: rawPage.fieldCatalogVersion,
    accessMode: "read_only",
    status: "active",
  });
  await database.insert(schema.dataSources).values({
    id: dataSourceId,
    workspaceId,
    metaConnectionId: connectionId,
    platform: "meta_ads",
    externalAccountId,
    displayName: "Meta affected geo live acceptance account",
  });
  await database.insert(schema.adAccounts).values({
    id: adAccountId,
    workspaceId,
    dataSourceId,
    externalAccountId,
    name: "Meta affected geo live acceptance account",
    currency: "TRY",
    timezone: "Europe/Istanbul",
  });
  await database.insert(schema.adCampaigns).values(campaignExternalIds.map((externalCampaignId) => ({
    id: campaignIds.get(externalCampaignId)!,
    workspaceId,
    adAccountId,
    externalCampaignId,
    name: "Meta affected geo live acceptance campaign",
  })));
  await new DrizzleMetaInventoryPagePersistence(database).writePage(page, { records: rawPage.records });

  canonicalAdSets = (await database.select({ value: count() }).from(schema.metaAdSets)
    .where(eq(schema.metaAdSets.workspaceId, workspaceId)))[0]?.value ?? 0;
  affectedGeoSnapshots = (await database.select({ value: count() }).from(schema.metaAffectedGeoSnapshots)
    .where(eq(schema.metaAffectedGeoSnapshots.workspaceId, workspaceId)))[0]?.value ?? 0;
  affectedGeoItems = (await database.select({ value: count() }).from(schema.metaAffectedGeoSnapshotItems)
    .where(eq(schema.metaAffectedGeoSnapshotItems.workspaceId, workspaceId)))[0]?.value ?? 0;
  rawTargetingColumns = (await database.select({ value: count() }).from(schema.metaAdSets).where(
    and(eq(schema.metaAdSets.workspaceId, workspaceId), isNotNull(schema.metaAdSets.targetingSummary)),
  ))[0]?.value ?? 0;
  if (canonicalAdSets !== rawPage.records.length || affectedGeoSnapshots < 1 || affectedGeoItems < 1
    || rawTargetingColumns !== 0 || writeNetworkCalls !== 0) {
    throw new Error("Canlı affected-geo inventory acceptance başarısız");
  }
} finally {
  await database.delete(schema.workspaces).where(eq(schema.workspaces.id, workspaceId));
  temporaryWorkspaceRemoved = (await database.select({ value: count() }).from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId)))[0]?.value === 0;
  await pool.end();
}

if (!temporaryWorkspaceRemoved) throw new Error("Canlı affected-geo geçici workspace temizlenemedi");
console.log(JSON.stringify({
  status: "ok",
  getNetworkCalls,
  writeNetworkCalls,
  sampledAdSets: rawPage.records.length,
  canonicalAdSets,
  affectedGeoSnapshots,
  affectedGeoItems,
  rawTargetingColumns,
  temporaryWorkspaceRemoved,
}));
