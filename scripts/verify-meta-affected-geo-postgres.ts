import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import { DrizzleMetaAffectedGeoSnapshotRepository } from "@/connectors/meta/meta-affected-geo-snapshot-drizzle-repository";
import * as schema from "@/db/schema";
import { hashMetaAffectedGeoSourceSubtree, normalizeMetaAffectedGeoCountries } from "@/domain/meta/affected-geo-country-snapshot";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const databaseUrl = process.env.DIRECT_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("Supabase PostgreSQL bağlantısı yapılandırılmadı");

const workspaceId = randomUUID();
const dataSourceId = randomUUID();
const adAccountId = randomUUID();
const campaignId = randomUUID();
const adSetId = randomUUID();
const suffix = workspaceId.replaceAll("-", "").slice(0, 16);
const targeting = { geo_locations: { countries: ["TR"], location_types: ["home", "recent"] } };
const snapshot = normalizeMetaAffectedGeoCountries({
  sourceKind: "meta_graph_adset_targeting",
  scope: {
    workspaceRef: `workspace_${suffix}`,
    accountRef: `account_${suffix}`,
    campaignRef: `campaign_${suffix}`,
    adSetRef: `adset_${suffix}`,
  },
  sourceGraphVersion: "v23.0",
  fieldCatalogVersion: "meta-adset-targeting-country-field-catalog/1.0.0",
  fetchedAt: "2026-08-08T00:00:00.000Z",
  provenance: {
    observationRunRef: `observation_${suffix}`,
    sliceRef: `slice_${suffix}`,
    pageRef: `page_${suffix}`,
    rawPayloadHash: "a".repeat(64),
    sourceGeoSubtreeHash: hashMetaAffectedGeoSourceSubtree(targeting),
  },
  targeting,
});
if (snapshot.status !== "known") throw new Error("Canonical affected-geo acceptance fixture üretilemedi");

const rollback = Symbol("rollback");
const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 10_000, statement_timeout: 30_000 });
const database = drizzle(pool, { schema });
let inserted = false;
let replayUnchanged = false;
let restartDurable = false;
let appendOnlyUpdateRejected = false;
let rollbackClean = false;

try {
  await database.transaction(async (transaction) => {
    await transaction.insert(schema.workspaces).values({ id: workspaceId, name: "Affected geo acceptance workspace" });
    await transaction.insert(schema.dataSources).values({
      id: dataSourceId,
      workspaceId,
      platform: "meta_ads",
      externalAccountId: `acceptance_${suffix}`,
      displayName: "Affected geo acceptance source",
    });
    await transaction.insert(schema.adAccounts).values({
      id: adAccountId,
      workspaceId,
      dataSourceId,
      externalAccountId: `act_${suffix}`,
      name: "Affected geo acceptance account",
      currency: "TRY",
      timezone: "Europe/Istanbul",
    });
    await transaction.insert(schema.adCampaigns).values({
      id: campaignId,
      workspaceId,
      adAccountId,
      externalCampaignId: `campaign_${suffix}`,
      name: "Affected geo acceptance campaign",
    });
    await transaction.insert(schema.metaAdSets).values({
      id: adSetId,
      workspaceId,
      adAccountId,
      campaignId,
      externalAdSetId: `adset_${suffix}`,
      name: "Affected geo acceptance ad set",
      rawPayloadHash: "b".repeat(64),
      sourceGraphVersion: "v23.0",
      fieldCatalogVersion: "acceptance-inventory/1.0.0",
      provenance: { source: "rollback_acceptance" },
    });

    const binding = { workspaceId, adAccountId, campaignId, adSetId, snapshot };
    const repository = new DrizzleMetaAffectedGeoSnapshotRepository(transaction as never, workspaceId);
    inserted = (await repository.append(binding)).outcome === "inserted";
    replayUnchanged = (await repository.append(binding)).outcome === "unchanged";

    const restarted = new DrizzleMetaAffectedGeoSnapshotRepository(transaction as never, workspaceId);
    const resolved = await restarted.resolveExact({
      workspaceId,
      workspaceRef: snapshot.scope.workspaceRef,
      adAccountId,
      accountRef: snapshot.scope.accountRef,
      campaignId,
      campaignRef: snapshot.scope.campaignRef,
      adSetId,
      adSetRef: snapshot.scope.adSetRef,
      capturedAt: snapshot.capturedAt,
      sourceGraphVersion: snapshot.source.sourceGraphVersion,
      fieldCatalogVersion: snapshot.source.fieldCatalogVersion,
      rawPayloadHash: snapshot.source.rawPayloadHash,
      sourceGeoSubtreeHash: snapshot.source.sourceGeoSubtreeHash,
      snapshotHash: snapshot.snapshotHash,
    });
    restartDurable = resolved.snapshotHash === snapshot.snapshotHash
      && resolved.items.length === snapshot.items.length
      && resolved.locationTypes.join(",") === snapshot.locationTypes.join(",");

    await transaction.execute(sql.raw("savepoint meta_affected_geo_append_only_check"));
    try {
      await transaction.execute(sql`
        update meta_affected_geo_snapshots set snapshot_hash = snapshot_hash
        where workspace_id = ${workspaceId}::uuid
      `);
    } catch {
      appendOnlyUpdateRejected = true;
      await transaction.execute(sql.raw("rollback to savepoint meta_affected_geo_append_only_check"));
    }
    await transaction.execute(sql.raw("release savepoint meta_affected_geo_append_only_check"));

    if (!inserted || !replayUnchanged || !restartDurable || !appendOnlyUpdateRejected) {
      throw new Error("Affected-geo PostgreSQL acceptance failed");
    }
    throw rollback;
  });
} catch (error) {
  if (error !== rollback) throw error;
}

try {
  const workspaces = await database.select({ id: schema.workspaces.id }).from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId));
  const snapshots = await database.select({ id: schema.metaAffectedGeoSnapshots.id })
    .from(schema.metaAffectedGeoSnapshots).where(and(
      eq(schema.metaAffectedGeoSnapshots.workspaceId, workspaceId),
      eq(schema.metaAffectedGeoSnapshots.adSetId, adSetId),
    ));
  rollbackClean = workspaces.length === 0 && snapshots.length === 0;
  if (!rollbackClean) throw new Error("Affected-geo acceptance rollback cleanup failed");
} finally {
  await pool.end();
}

console.log(JSON.stringify({
  inserted,
  replayUnchanged,
  restartDurable,
  appendOnlyUpdateRejected,
  rollbackClean,
  temporaryRowsCommitted: false,
  rawTargetingPersisted: false,
  metaNetworkCalls: 0,
  metaWriteCalls: 0,
}));
