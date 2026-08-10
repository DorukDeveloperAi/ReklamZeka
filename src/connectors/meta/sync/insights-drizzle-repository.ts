import { and, eq, inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { parseMetaInsightPage, type CanonicalMetaInsightPage, type MetaInsightPagePersistencePort, type MetaInsightSourcePage, type MetaInsightSourcePagePersistencePort } from "./insights-materialization";

type Database = NodePgDatabase<typeof schema>;

/** Server-private L1 writer. It accepts only canonical parser output and never calls Meta. */
export class DrizzleMetaInsightPagePersistence implements MetaInsightPagePersistencePort, MetaInsightSourcePagePersistencePort {
  constructor(private readonly database: Database) {}

  async writeSourcePage(source: MetaInsightSourcePage): Promise<Readonly<{ inserted: number; updated: number; unchanged: number; stale: number; pageHash: string }>> {
    const accounts = await this.database.select({ id: schema.adAccounts.id, currency: schema.adAccounts.currency, timezone: schema.adAccounts.timezone })
      .from(schema.adAccounts).innerJoin(schema.dataSources, and(eq(schema.adAccounts.dataSourceId, schema.dataSources.id), eq(schema.adAccounts.workspaceId, schema.dataSources.workspaceId)))
      .where(and(eq(schema.adAccounts.workspaceId, source.workspaceId), eq(schema.dataSources.metaConnectionId, source.connectionId),
        eq(schema.adAccounts.externalAccountId, source.externalAccountId))).limit(2);
    const account = accounts[0];
    if (accounts.length !== 1 || !account?.currency || !account.timezone) throw new Error("Canonical insight account currency/timezone çözülemedi");
    const page = parseMetaInsightPage({ ...source, adAccountId: account.id, currency: account.currency, timezone: account.timezone, minorUnitScale: 2 });
    return this.writePage(page);
  }

  async writePage(page: CanonicalMetaInsightPage): Promise<Readonly<{ inserted: number; updated: number; unchanged: number; stale: number; pageHash: string }>> {
    return this.database.transaction(async (transaction) => {
      const database = transaction as Database;
      const account = await database.select({ id: schema.adAccounts.id }).from(schema.adAccounts)
        .innerJoin(schema.dataSources, and(eq(schema.adAccounts.dataSourceId, schema.dataSources.id), eq(schema.adAccounts.workspaceId, schema.dataSources.workspaceId)))
        .where(and(eq(schema.adAccounts.id, page.adAccountId), eq(schema.adAccounts.workspaceId, page.workspaceId),
          eq(schema.dataSources.metaConnectionId, page.connectionId), eq(schema.adAccounts.externalAccountId, page.externalAccountId))).limit(2);
      if (account.length !== 1) throw new Error("Canonical insight account scope çözülemedi");

      const run = await database.select({ id: schema.metaSyncRuns.id }).from(schema.metaSyncRuns)
        .innerJoin(schema.metaPortfolioSyncRuns, eq(schema.metaSyncRuns.portfolioRunId, schema.metaPortfolioSyncRuns.id))
        .where(and(eq(schema.metaSyncRuns.workspaceId, page.workspaceId), eq(schema.metaSyncRuns.metaConnectionId, page.connectionId),
          eq(schema.metaSyncRuns.adAccountId, page.adAccountId), eq(schema.metaSyncRuns.streamType, "insights"),
          eq(schema.metaPortfolioSyncRuns.idempotencyKey, page.parentRunId))).limit(2);
      if (run.length !== 1) throw new Error("Canonical insight sync run çözülemedi");
      const slice = await database.select({ id: schema.metaSyncSlices.id }).from(schema.metaSyncSlices)
        .where(and(eq(schema.metaSyncSlices.runId, run[0]!.id), eq(schema.metaSyncSlices.sliceKey, page.sliceId))).limit(2);
      if (slice.length !== 1) throw new Error("Canonical insight sync slice çözülemedi");

      const existing = page.records.length === 0 ? [] : await database.select({
        id: schema.metaDailyInsights.id, entityLevel: schema.metaDailyInsights.entityLevel,
        externalEntityId: schema.metaDailyInsights.externalEntityId, dateStart: schema.metaDailyInsights.dateStart,
        dateStop: schema.metaDailyInsights.dateStop, attributionLabel: schema.metaDailyInsights.attributionLabel,
        sourcePayloadHash: schema.metaDailyInsights.sourcePayloadHash,
      }).from(schema.metaDailyInsights).where(and(eq(schema.metaDailyInsights.workspaceId, page.workspaceId),
        eq(schema.metaDailyInsights.adAccountId, page.adAccountId), inArray(schema.metaDailyInsights.externalEntityId, page.records.map((record) => record.externalEntityId))));
      const key = (record: { entityLevel: string; externalEntityId: string; dateStart: string; dateStop: string; attributionLabel: string }) =>
        `${record.entityLevel}:${record.externalEntityId}:${record.dateStart}:${record.dateStop}:${record.attributionLabel}`;
      const current = new Map(existing.map((record) => [key(record), record]));
      const changed = page.records.filter((record) => current.get(key(record))?.sourcePayloadHash !== record.sourcePayloadHash);
      const unchanged = page.records.length - changed.length;
      if (changed.length === 0) return { inserted: 0, updated: 0, unchanged, stale: 0, pageHash: page.pageHash } as const;

      await database.insert(schema.metaDailyInsights).values(changed.map((record) => ({
        workspaceId: page.workspaceId, metaConnectionId: page.connectionId, adAccountId: page.adAccountId,
        syncRunId: run[0]!.id, syncSliceId: slice[0]!.id, entityLevel: record.entityLevel,
        externalEntityId: record.externalEntityId, dateStart: record.dateStart, dateStop: record.dateStop,
        attributionLabel: record.attributionLabel, attributionWindow: record.attributionWindow ?? null,
        currency: record.currency ?? null, timezone: record.timezone ?? null,
        fieldAvailability: Object.fromEntries(record.metrics.filter((metric) => metric.availability).map((metric) => [`${metric.metricKey}:${metric.actionType ?? ""}`, metric.availability!])),
        sourceRevision: record.sourceRevision, sourcePayloadHash: record.sourcePayloadHash,
        sourceUpdatedAt: record.sourceUpdatedAt ? new Date(record.sourceUpdatedAt) : null,
        metricProvenance: record.metricProvenance, lastSeenAt: new Date(page.observedAt),
      }))).onConflictDoUpdate({
        target: [schema.metaDailyInsights.workspaceId, schema.metaDailyInsights.adAccountId, schema.metaDailyInsights.entityLevel,
          schema.metaDailyInsights.externalEntityId, schema.metaDailyInsights.dateStart, schema.metaDailyInsights.dateStop, schema.metaDailyInsights.attributionLabel],
        set: { syncRunId: sql`excluded.sync_run_id`, syncSliceId: sql`excluded.sync_slice_id`, attributionWindow: sql`excluded.attribution_window`,
          currency: sql`excluded.currency`, timezone: sql`excluded.timezone`, fieldAvailability: sql`excluded.field_availability`,
          sourceRevision: sql`excluded.source_revision`, sourcePayloadHash: sql`excluded.source_payload_hash`, sourceUpdatedAt: sql`excluded.source_updated_at`,
          metricProvenance: sql`excluded.metric_provenance`, lastSeenAt: new Date(page.observedAt) },
      });
      const resolved = await database.select({ id: schema.metaDailyInsights.id, entityLevel: schema.metaDailyInsights.entityLevel,
        externalEntityId: schema.metaDailyInsights.externalEntityId, dateStart: schema.metaDailyInsights.dateStart,
        dateStop: schema.metaDailyInsights.dateStop, attributionLabel: schema.metaDailyInsights.attributionLabel }).from(schema.metaDailyInsights)
        .where(and(eq(schema.metaDailyInsights.workspaceId, page.workspaceId), eq(schema.metaDailyInsights.adAccountId, page.adAccountId),
          inArray(schema.metaDailyInsights.externalEntityId, changed.map((record) => record.externalEntityId))));
      const byKey = new Map(resolved.map((record) => [key(record), record.id]));
      const ids = changed.map((record) => byKey.get(key(record))).filter((id): id is string => Boolean(id));
      if (ids.length !== changed.length) throw new Error("Canonical insight satırı yeniden çözülemedi");
      await database.delete(schema.metaDailyInsightMetrics).where(inArray(schema.metaDailyInsightMetrics.dailyInsightId, ids));
      await database.insert(schema.metaDailyInsightMetrics).values(changed.flatMap((record) => record.metrics.map((metric) => ({
        dailyInsightId: byKey.get(key(record))!, metricKey: metric.metricKey, actionType: metric.actionType ?? "",
        aggregation: metric.aggregation, valueDecimal: metric.valueDecimal ?? null, valueMinor: metric.valueMinor ?? null,
        valueJson: metric.valueJson ?? null, currency: metric.currency ?? null, provenance: metric.provenance,
        availability: metric.availability ?? {}, sourceRevision: record.sourceRevision, sourcePayloadHash: record.sourcePayloadHash,
        sourceUpdatedAt: record.sourceUpdatedAt ? new Date(record.sourceUpdatedAt) : null, lastSeenAt: new Date(page.observedAt),
      }))));
      const inserted = changed.filter((record) => !current.has(key(record))).length;
      return { inserted, updated: changed.length - inserted, unchanged, stale: 0, pageHash: page.pageHash } as const;
    });
  }
}
