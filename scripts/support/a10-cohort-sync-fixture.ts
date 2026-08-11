import { createHash } from "node:crypto";

import { and, count, eq, inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import {
  DrizzleMetaChangeSnapshotStore,
  MetaChangeSnapshotDrizzleAdapter,
} from "@/connectors/meta/sync/change-snapshot-drizzle-adapter";
import {
  DrizzleMetaChangeTimelinePersistenceStore,
  MetaChangeTimelinePersistenceService,
} from "@/connectors/meta/sync/change-timeline-persistence";
import { META_INVENTORY_FIELD_CATALOG_VERSION } from "@/connectors/meta/sync/inventory-materialization";
import { DrizzleMetaInventoryPagePersistence } from "@/connectors/meta/sync/inventory-drizzle-repository";
import { DrizzleMetaInsightPagePersistence } from "@/connectors/meta/sync/insights-drizzle-repository";
import { TransactionBackedMetaSyncPersistenceAdapter, DrizzleMetaSyncTransactionManager } from "@/connectors/meta/sync/persistence-adapter";
import { MetaPartialReadSyncRuntime } from "@/connectors/meta/sync/runtime";
import { diffMetaChangeSnapshots, normalizeMetaChangeSnapshot } from "@/domain/meta/snapshot-diff";
import * as schema from "@/db/schema";
import type { MetaReadRequest, MetaReadTransport, MetaSyncSlice } from "@/connectors/meta/sync/types";

type Database = NodePgDatabase<typeof schema>;

export type A10CohortFixtureRootScope = Readonly<{
  workspaceId: string;
  connectionId: string;
  adAccountId: string;
  externalAccountId: string;
}>;

export type A10CohortSyncFixtureInput = Readonly<{
  /** Transaction-pooler URL; each normal sync slice gets its own short-lived boundary. */
  connectionString: string;
  root: A10CohortFixtureRootScope;
  /** Caller-owned idempotency identity; must be unique for each isolated fixture. */
  parentRunId: string;
  observedAt?: Date;
}>;

export type A10CohortSyncFixtureResult = Readonly<{
  campaignExternalIds: readonly string[];
  adSetExternalIds: readonly string[];
  parentRunId: string;
  runtimeStatus: "completed";
  persisted: Readonly<{ campaigns: number; adSets: number; campaignInsights: number }>;
  snapshot: Readonly<{ snapshotRef: string; snapshotHash: string; insertedSnapshots: number }>;
  transport: Readonly<{ requestCount: number; writeNetworkCalls: 0 }>;
}>;

const FIXTURE_DATE = "2026-08-09";

function suffix(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

function assertFixtureRunRef(value: string): void {
  if (!/^[a-z][a-z0-9_.:-]{0,127}$/.test(value)) {
    throw new Error("A10 cohort fixture parentRunId geçersiz");
  }
}

/**
 * Private, GET-only Graph-shaped source records.  These are deliberately not
 * database rows: the normal inventory and L1 writers own every canonical row.
 */
export function a10CohortSyncFixtureRecords(input: Pick<A10CohortSyncFixtureInput, "root" | "parentRunId">) {
  assertFixtureRunRef(input.parentRunId);
  const key = suffix(`${input.root.workspaceId}:${input.root.externalAccountId}:${input.parentRunId}`);
  const campaigns = Array.from({ length: 5 }, (_, index) => {
    const ordinal = index + 1;
    return {
      id: `a10_campaign_${key}_${ordinal}`,
      name: `A10 cohort campaign ${ordinal}`,
      status: "ACTIVE",
      effective_status: "ACTIVE",
      objective: ordinal === 5 ? "OUTCOME_AWARENESS" : "OUTCOME_LEADS",
      buying_type: "AUCTION",
      special_ad_categories: [],
      daily_budget: "12000",
      lifetime_budget: null,
      updated_time: "2026-08-09T09:00:00.000Z",
    } as const;
  });
  const adSets = campaigns.map((campaign, index) => ({
    id: `a10_adset_${key}_${index + 1}`,
    name: `A10 cohort ad set ${index + 1}`,
    status: "ACTIVE",
    effective_status: "ACTIVE",
    campaign_id: campaign.id,
    optimization_goal: "LEAD_GENERATION",
    billing_event: "IMPRESSIONS",
    bid_strategy: "LOWEST_COST_WITHOUT_CAP",
    bid_amount: null,
    daily_budget: "12000",
    lifetime_budget: null,
    attribution_spec: [],
    promoted_object: {},
    targeting: {},
    updated_time: "2026-08-09T09:00:00.000Z",
  } as const));
  const insights = campaigns.map((campaign, index) => ({
    account_id: input.root.externalAccountId,
    campaign_id: campaign.id,
    date_start: FIXTURE_DATE,
    date_stop: FIXTURE_DATE,
    spend: `${10 + index}.00`,
    impressions: `${100 + index}`,
    reach: `${80 + index}`,
    frequency: "1.25",
    clicks: `${4 + index}`,
    actions: [{ action_type: "lead", value: "1" }],
    action_values: [],
  } as const));
  return Object.freeze({ campaigns: Object.freeze(campaigns), adSets: Object.freeze(adSets), insights: Object.freeze(insights) });
}

function fixturePlan(externalAccountId: string): readonly MetaSyncSlice[] {
  return Object.freeze([
    { id: `inventory:${externalAccountId}:campaign:all:all`, stream: "inventory", accountId: externalAccountId, entityLevel: "campaign", dateStart: null, dateStop: null, pageSize: 10 },
    { id: `inventory:${externalAccountId}:ad_set:all:all`, stream: "inventory", accountId: externalAccountId, entityLevel: "ad_set", dateStart: null, dateStop: null, pageSize: 10 },
    { id: `insights:${externalAccountId}:campaign:${FIXTURE_DATE}:${FIXTURE_DATE}`, stream: "insights", accountId: externalAccountId, entityLevel: "campaign", dateStart: FIXTURE_DATE, dateStop: FIXTURE_DATE, pageSize: 10 },
  ]);
}

class A10CohortFixtureTransport implements MetaReadTransport {
  readonly requests: MetaReadRequest[] = [];

  constructor(private readonly records: ReturnType<typeof a10CohortSyncFixtureRecords>) {}

  async get(request: MetaReadRequest) {
    this.requests.push(request);
    if (request.method !== "GET" || request.cursor !== null) throw new Error("A10 cohort fixture yalnız ilk GET sayfasını destekler");
    const records = request.stream === "inventory" && request.entityLevel === "campaign" ? this.records.campaigns
      : request.stream === "inventory" && request.entityLevel === "ad_set" ? this.records.adSets
        : request.stream === "insights" && request.entityLevel === "campaign" ? this.records.insights
          : null;
    if (!records) throw new Error("A10 cohort fixture plan kapsamı dışına çıktı");
    return {
      records,
      nextCursor: null,
      usageHeadroom: 0.5,
      ...(request.stream === "inventory" ? {
        sourceGraphVersion: "v23.0",
        fieldCatalogVersion: META_INVENTORY_FIELD_CATALOG_VERSION,
      } : {}),
    };
  }
}

/**
 * Materializes an A10 five-member cohort using only ordinary, GET-only sync
 * writers. The caller supplies an already-created isolated fixture root; this
 * helper never inserts workspace/account/campaign/ad-set/insight rows itself.
 */
export async function materializeA10CohortSyncFixture(
  input: A10CohortSyncFixtureInput,
): Promise<A10CohortSyncFixtureResult> {
  assertFixtureRunRef(input.parentRunId);
  if (!input.connectionString.trim()) throw new Error("A10 cohort fixture connectionString zorunludur");
  const records = a10CohortSyncFixtureRecords(input);
  const observedAt = input.observedAt ?? new Date("2026-08-10T12:00:00.000Z");
  const withBoundary = async <T>(work: (database: Database) => Promise<T>): Promise<T> => {
    const pool = new Pool({ connectionString: input.connectionString, max: 2, connectionTimeoutMillis: 10_000, statement_timeout: 30_000 });
    try { return await work(drizzle(pool, { schema })); } finally { await pool.end(); }
  };
  const runSlice = async (parentRunId: string, slice: MetaSyncSlice, now: Date) => withBoundary(async (database) => {
    const transport = new A10CohortFixtureTransport(records);
    const run = await new MetaPartialReadSyncRuntime({
      transport, now: () => now,
      persistence: new TransactionBackedMetaSyncPersistenceAdapter(new DrizzleMetaSyncTransactionManager(database)),
      inventoryPagePersistence: new DrizzleMetaInventoryPagePersistence(database),
      insightPagePersistence: new DrizzleMetaInsightPagePersistence(database), maxAttempts: 1,
    }).run({ parentRunId, workspaceId: input.root.workspaceId, connectionId: input.root.connectionId, plan: [slice] });
    if (run.parentRun.status !== "completed" || transport.requests.some((request) => request.method !== "GET")) {
      throw new Error("A10 cohort fixture normal read-sync işlemi tamamlanamadı");
    }
    return transport.requests.length;
  });
  const [campaignSlice, adSetSlice, insightSlice] = fixturePlan(input.root.externalAccountId);
  if (!campaignSlice || !adSetSlice || !insightSlice) throw new Error("A10 cohort fixture dilimleri bulunamadı");
  const requests = await runSlice(`${input.parentRunId}.campaign`, campaignSlice, observedAt)
    + await runSlice(`${input.parentRunId}.adset`, adSetSlice, observedAt)
    + await runSlice(`${input.parentRunId}.insights`, insightSlice, observedAt);

  const persisted = await withBoundary(async (database) => {
    const [campaignRows, adSetRows, insightRows] = await Promise.all([
      database.select({ value: count() }).from(schema.adCampaigns).where(and(
      eq(schema.adCampaigns.workspaceId, input.root.workspaceId),
      eq(schema.adCampaigns.adAccountId, input.root.adAccountId),
      inArray(schema.adCampaigns.externalCampaignId, records.campaigns.map((record) => record.id)),
    )),
    database.select({ value: count() }).from(schema.metaAdSets).where(and(
      eq(schema.metaAdSets.workspaceId, input.root.workspaceId),
      eq(schema.metaAdSets.adAccountId, input.root.adAccountId),
      inArray(schema.metaAdSets.externalAdSetId, records.adSets.map((record) => record.id)),
    )),
    database.select({ value: count() }).from(schema.metaDailyInsights).where(and(
      eq(schema.metaDailyInsights.workspaceId, input.root.workspaceId),
      eq(schema.metaDailyInsights.adAccountId, input.root.adAccountId),
      eq(schema.metaDailyInsights.entityLevel, "campaign"),
      inArray(schema.metaDailyInsights.externalEntityId, records.campaigns.map((record) => record.id)),
      eq(schema.metaDailyInsights.dateStart, FIXTURE_DATE),
      eq(schema.metaDailyInsights.dateStop, FIXTURE_DATE),
    )),
    ]);
    return {
    campaigns: campaignRows[0]?.value ?? 0,
    adSets: adSetRows[0]?.value ?? 0,
    campaignInsights: insightRows[0]?.value ?? 0,
    };
  });
  if (persisted.campaigns !== 5 || persisted.adSets !== 5 || persisted.campaignInsights !== 5) {
    throw new Error("A10 cohort fixture normal writer kanıtı 5+5+5 değil");
  }

  const initialSnapshotScope = {
    workspaceId: input.root.workspaceId,
    connectionId: input.root.connectionId,
    externalAccountId: input.root.externalAccountId,
    capturedAt: observedAt.toISOString(),
  } as const;
  const previous = await withBoundary(async (database) => normalizeMetaChangeSnapshot(await new MetaChangeSnapshotDrizzleAdapter(
    new DrizzleMetaChangeSnapshotStore(database),
  ).buildInput(initialSnapshotScope)));
  const changedAt = new Date(observedAt.valueOf() + 60_000);
  const changedRequests = await runSlice(`${input.parentRunId}.snapshot_campaign`, campaignSlice, changedAt)
    + await runSlice(`${input.parentRunId}.snapshot_adset`, adSetSlice, changedAt);
  const snapshotScope = {
    workspaceId: input.root.workspaceId,
    connectionId: input.root.connectionId,
    externalAccountId: input.root.externalAccountId,
    capturedAt: changedAt.toISOString(),
  } as const;
  const snapshot = await withBoundary(async (database) => normalizeMetaChangeSnapshot(await new MetaChangeSnapshotDrizzleAdapter(
    new DrizzleMetaChangeSnapshotStore(database),
  ).buildInput(snapshotScope)));
  const timeline = diffMetaChangeSnapshots({ previous, current: snapshot });
  const persistedTimeline = await withBoundary(async (database) => new MetaChangeTimelinePersistenceService(
    new DrizzleMetaChangeTimelinePersistenceStore(database),
  ).persist({
    scope: { workspaceId: input.root.workspaceId, connectionId: input.root.connectionId, adAccountId: input.root.adAccountId },
    previous,
    current: snapshot,
    timeline,
    // A timeline cannot be detected before its newest persisted snapshot.
    detectedAt: changedAt.toISOString(),
  }));
  if (persistedTimeline.insertedSnapshots !== 2 || persistedTimeline.currentSnapshotRef === persistedTimeline.previousSnapshotRef) {
    throw new Error("A10 cohort fixture canonical snapshot kanıtı tamamlanamadı");
  }
  return Object.freeze({
    campaignExternalIds: Object.freeze(records.campaigns.map((record) => record.id)),
    adSetExternalIds: Object.freeze(records.adSets.map((record) => record.id)),
    parentRunId: input.parentRunId,
    runtimeStatus: "completed",
    persisted: Object.freeze(persisted),
    snapshot: Object.freeze({ snapshotRef: persistedTimeline.currentSnapshotRef, snapshotHash: snapshot.snapshotHash, insertedSnapshots: persistedTimeline.insertedSnapshots }),
    transport: Object.freeze({ requestCount: requests + changedRequests, writeNetworkCalls: 0 }),
  });
}
