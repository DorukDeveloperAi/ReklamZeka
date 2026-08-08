import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { count, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { FINDING_OBSERVATION_BUILDER_VERSION, type FindingObservationReadQuery } from "@/analyses/finding-observation-builder";
import {
  DrizzleFindingObservationReadPort,
  FINDING_OBSERVATION_SETTLEMENT_POLICY_VERSION,
} from "@/connectors/analyses/finding-observation-drizzle-read-port";
import * as schema from "@/db/schema";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL yapılandırılmadı");

const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  connectionTimeoutMillis: 10_000,
  statement_timeout: 20_000,
});
const database = drizzle(pool, { schema });
const rollback = Symbol("rollback");
const ids = {
  workspace: randomUUID(),
  foreignWorkspace: randomUUID(),
  connection: randomUUID(),
  foreignConnection: randomUUID(),
  source: randomUUID(),
  foreignSource: randomUUID(),
  account: randomUUID(),
  foreignAccount: randomUUID(),
  stream: randomUUID(),
  run: randomUUID(),
  slice: randomUUID(),
  insightOne: randomUUID(),
  insightTwo: randomUUID(),
  crossCombinationInsight: randomUUID(),
};

let appliedTablesVerified = false;
let exactScopeVerified = false;
let canonicalHashesVerified = false;
let deterministicReplayVerified = false;
let rowCapVerified = false;
let conservativeSettlementVerified = false;
let attributionFinalityVerified = false;
let internalIdsRedacted = false;
let temporaryRowsCommitted = true;

function query(overrides: Partial<FindingObservationReadQuery> = {}): FindingObservationReadQuery {
  return {
    builderVersion: FINDING_OBSERVATION_BUILDER_VERSION,
    queryRef: "observation_applied_table_safe",
    workspaceId: ids.workspace,
    metaConnectionId: ids.connection,
    adAccountId: ids.account,
    entityLevel: "campaign",
    externalEntityId: "campaign-safe",
    attributionLabel: "7d_click_1d_view",
    expectedCurrency: "TRY",
    role: "primary",
    startDate: "2026-08-01",
    endDate: "2026-08-02",
    timezone: "Europe/Istanbul",
    maxRows: 10,
    ...overrides,
  };
}

try {
  await database.transaction(async (transaction) => {
    const tables = await transaction.execute(sql`
      select
        to_regclass('public.meta_daily_insights')::text as insights,
        to_regclass('public.meta_daily_insight_metrics')::text as metrics,
        to_regclass('public.meta_sync_runs')::text as runs,
        to_regclass('public.meta_sync_slices')::text as slices
    `);
    const tableRow = tables.rows[0] as Record<string, unknown> | undefined;
    appliedTablesVerified = Boolean(tableRow?.insights && tableRow?.metrics && tableRow?.runs && tableRow?.slices);
    if (!appliedTablesVerified) throw new Error("Canonical insight tabloları uygulanmamış");

    await transaction.insert(schema.workspaces).values([
      { id: ids.workspace, name: "Finding observation outer rollback" },
      { id: ids.foreignWorkspace, name: "Foreign finding observation" },
    ]);
    await transaction.insert(schema.metaConnections).values([
      {
        id: ids.connection, workspaceId: ids.workspace, externalConnectionKey: "finding-read-safe",
        displayName: "Finding read safe", graphApiVersion: "v1", fieldCatalogVersion: "fixture-v1",
      },
      {
        id: ids.foreignConnection, workspaceId: ids.foreignWorkspace, externalConnectionKey: "finding-read-foreign",
        displayName: "Finding read foreign", graphApiVersion: "v1", fieldCatalogVersion: "fixture-v1",
      },
    ]);
    await transaction.insert(schema.dataSources).values([
      {
        id: ids.source, workspaceId: ids.workspace, metaConnectionId: ids.connection,
        platform: "meta_ads", externalAccountId: "act-safe", displayName: "Safe account",
      },
      {
        id: ids.foreignSource, workspaceId: ids.foreignWorkspace, metaConnectionId: ids.foreignConnection,
        platform: "meta_ads", externalAccountId: "act-foreign", displayName: "Foreign account",
      },
    ]);
    await transaction.insert(schema.adAccounts).values([
      {
        id: ids.account, workspaceId: ids.workspace, dataSourceId: ids.source,
        externalAccountId: "act-safe", name: "Safe", currency: "TRY", timezone: "Europe/Istanbul",
      },
      {
        id: ids.foreignAccount, workspaceId: ids.foreignWorkspace, dataSourceId: ids.foreignSource,
        externalAccountId: "act-foreign", name: "Foreign", currency: "TRY", timezone: "Europe/Istanbul",
      },
    ]);
    await transaction.insert(schema.metaSyncStreams).values({
      id: ids.stream, workspaceId: ids.workspace, metaConnectionId: ids.connection,
      adAccountId: ids.account, streamType: "insights", status: "completed",
    });
    await transaction.insert(schema.metaSyncRuns).values({
      id: ids.run, workspaceId: ids.workspace, metaConnectionId: ids.connection,
      adAccountId: ids.account, streamId: ids.stream, streamType: "insights",
      idempotencyKey: "finding-observation-fixture", status: "completed",
      startedAt: new Date("2026-08-03T00:00:00.000Z"), finishedAt: new Date("2026-08-03T00:01:00.000Z"),
    });
    await transaction.insert(schema.metaSyncSlices).values({
      id: ids.slice, workspaceId: ids.workspace, metaConnectionId: ids.connection,
      adAccountId: ids.account, runId: ids.run, streamType: "insights", entityLevel: "campaign",
      dateStart: "2026-08-01", dateStop: "2026-08-02", sliceKey: "fixture:campaign:2026-08-01:2026-08-02",
      status: "completed", completedAt: new Date("2026-08-03T00:01:00.000Z"),
    });
    await transaction.insert(schema.metaDailyInsights).values([
      {
        id: ids.insightOne, workspaceId: ids.workspace, metaConnectionId: ids.connection,
        adAccountId: ids.account, syncRunId: ids.run, syncSliceId: ids.slice,
        entityLevel: "campaign", externalEntityId: "campaign-safe", dateStart: "2026-08-01", dateStop: "2026-08-01",
        attributionLabel: "7d_click_1d_view", attributionWindow: { click: 7, view: 1 },
        currency: "TRY", timezone: "Europe/Istanbul", sourceRevision: "revision-1",
        sourcePayloadHash: "payload-hash-1", sourceUpdatedAt: new Date("2026-08-03T00:00:00.000Z"),
        metricProvenance: { source: "meta" },
      },
      {
        id: ids.insightTwo, workspaceId: ids.workspace, metaConnectionId: ids.connection,
        adAccountId: ids.account, syncRunId: ids.run, syncSliceId: ids.slice,
        entityLevel: "campaign", externalEntityId: "campaign-safe", dateStart: "2026-08-02", dateStop: "2026-08-02",
        attributionLabel: "7d_click_1d_view", attributionWindow: { click: 7, view: 1 },
        currency: "TRY", timezone: "Europe/Istanbul", sourceRevision: "revision-2",
        sourcePayloadHash: "payload-hash-2", sourceUpdatedAt: new Date("2026-08-03T00:00:00.000Z"),
        metricProvenance: { source: "meta" },
      },
      // The schema's independent FKs permit this inconsistent combination; the read join must exclude it.
      {
        id: ids.crossCombinationInsight, workspaceId: ids.workspace, metaConnectionId: ids.connection,
        adAccountId: ids.foreignAccount, entityLevel: "campaign", externalEntityId: "campaign-safe",
        dateStart: "2026-08-01", dateStop: "2026-08-01", attributionLabel: "foreign-combination",
        currency: "TRY", timezone: "Europe/Istanbul", sourceRevision: "foreign-revision",
        sourcePayloadHash: "foreign-hash", metricProvenance: { source: "meta" },
      },
    ]);
    await transaction.insert(schema.metaDailyInsightMetrics).values([
      {
        dailyInsightId: ids.insightOne, metricKey: "spend", aggregation: "additive", valueMinor: 100,
        currency: "TRY", provenance: { field: "spend" }, sourceRevision: "revision-1", sourcePayloadHash: "payload-hash-1",
      },
      {
        dailyInsightId: ids.insightTwo, metricKey: "spend", aggregation: "additive", valueMinor: 200,
        currency: "TRY", provenance: { field: "spend" }, sourceRevision: "revision-2", sourcePayloadHash: "payload-hash-2",
      },
      {
        dailyInsightId: ids.crossCombinationInsight, metricKey: "spend", aggregation: "additive", valueMinor: 999,
        currency: "TRY", provenance: { field: "spend" }, sourceRevision: "foreign-revision", sourcePayloadHash: "foreign-hash",
      },
    ]);

    const settlementPolicy = {
      resolve: async () => ({
        policyVersion: FINDING_OBSERVATION_SETTLEMENT_POLICY_VERSION,
        policyRef: "settlement_applied_fixture_v1",
        evaluatedAsOf: "2026-08-03T12:00:00.000+03:00",
        settledThroughDate: "2026-08-02",
      }),
    } as const;
    const port = new DrizzleFindingObservationReadPort(transaction as never, settlementPolicy);
    const first = await port.read(query());
    const replay = await port.read(query());
    const crossCombination = await port.read(query({
      queryRef: "observation_cross_combination",
      adAccountId: ids.foreignAccount,
      attributionLabel: "foreign-combination",
      startDate: "2026-08-01",
      endDate: "2026-08-01",
    }));
    exactScopeVerified = first.rows.length === 2
      && first.rows.every((row) => row.workspaceId === ids.workspace && row.adAccountId === ids.account)
      && first.rows.every((row) => row.attributionLabel === "7d_click_1d_view" && row.currency === "TRY" && row.timezone === "Europe/Istanbul")
      && crossCombination.rows.length === 0;
    canonicalHashesVerified = first.rows.every((row) => /^[a-f0-9]{64}$/.test(row.contentHash) && row.identity.length > 0);
    deterministicReplayVerified = JSON.stringify(first) === JSON.stringify(replay);
    conservativeSettlementVerified = first.qualityStatus === "ready"
      && first.settledThroughDate === "2026-08-02" && first.complete;
    internalIdsRedacted = !JSON.stringify(first).includes(ids.insightOne)
      && !JSON.stringify(first).includes(ids.insightTwo)
      && first.snapshotRefs.every((ref) => /^snapshot_[a-f0-9]{32}$/.test(ref));

    const capped = await port.read(query({ maxRows: 1 }));
    rowCapVerified = capped.rows.length === 1 && !capped.complete
      && capped.qualityStatus === "degraded" && capped.qualityReasonCodes.includes("row_limit_reached");
    const laggingPort = new DrizzleFindingObservationReadPort(transaction as never, {
      resolve: async () => ({
        policyVersion: FINDING_OBSERVATION_SETTLEMENT_POLICY_VERSION,
        policyRef: "settlement_applied_lag_v1",
        evaluatedAsOf: "2026-08-02T12:00:00.000+03:00",
        settledThroughDate: "2026-08-01",
      }),
    });
    const lagging = await laggingPort.read(query());
    attributionFinalityVerified = lagging.complete && lagging.settledThroughDate === "2026-08-01"
      && lagging.qualityStatus === "degraded"
      && lagging.qualityReasonCodes.includes("attribution_settlement_lag");
    if (![exactScopeVerified, canonicalHashesVerified, deterministicReplayVerified, rowCapVerified,
      conservativeSettlementVerified, attributionFinalityVerified, internalIdsRedacted].every(Boolean)) {
      throw new Error("Finding observation applied-table kabulü başarısız");
    }
    throw rollback;
  });
} catch (error) {
  if (error !== rollback) throw error;
} finally {
  const check = await database.select({ value: count() }).from(schema.workspaces).where(eq(schema.workspaces.id, ids.workspace));
  temporaryRowsCommitted = Number(check[0]?.value ?? -1) !== 0;
  await pool.end();
}

const report = {
  appliedTablesVerified,
  exactScopeVerified,
  canonicalHashesVerified,
  deterministicReplayVerified,
  rowCapVerified,
  conservativeSettlementVerified,
  attributionFinalityVerified,
  internalIdsRedacted,
  metaNetworkCalls: 0,
  metaWriteCalls: 0,
  temporaryRowsCommitted,
};
console.log(JSON.stringify(report));
if (temporaryRowsCommitted) throw new Error("Outer rollback fixture satırlarını kalıcı bıraktı");
