import { and, eq, inArray, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import { normalizeMetaDailyInsight, type MetaFieldAvailability, type MetaMetricValue } from "@/domain/meta/insights/contract";
import type { PerformanceSource } from "@/domain/meta/performance-read-model";

type Database = NodePgDatabase<typeof schema>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Only canonical persisted rows are read. The query cannot receive account or campaign selectors from the browser. */
export class DrizzleCanonicalPerformanceReadRepository {
  constructor(private readonly database: Pick<Database, "transaction">) {}
  async load(workspaceId: string): Promise<readonly PerformanceSource[]> {
    if (!UUID.test(workspaceId)) throw new Error("canonical performance rejected: invalid_scope");
    return this.database.transaction(async (transaction) => {
      await transaction.execute(sql`set local transaction isolation level repeatable read`);
      await transaction.execute(sql`set local transaction read only`);
      const insights = await transaction.select({
        id: schema.metaDailyInsights.id, connectionId: schema.metaDailyInsights.metaConnectionId, accountId: schema.metaDailyInsights.adAccountId,
        externalEntityId: schema.metaDailyInsights.externalEntityId, entityLevel: schema.metaDailyInsights.entityLevel, dateStart: schema.metaDailyInsights.dateStart,
        dateStop: schema.metaDailyInsights.dateStop, attributionLabel: schema.metaDailyInsights.attributionLabel, attributionWindow: schema.metaDailyInsights.attributionWindow,
        currency: schema.metaDailyInsights.currency, timezone: schema.metaDailyInsights.timezone, fieldAvailability: schema.metaDailyInsights.fieldAvailability,
        sourceRevision: schema.metaDailyInsights.sourceRevision, sourcePayloadHash: schema.metaDailyInsights.sourcePayloadHash, sourceUpdatedAt: schema.metaDailyInsights.sourceUpdatedAt,
        metricProvenance: schema.metaDailyInsights.metricProvenance, accountName: schema.adAccounts.name, campaignName: schema.adCampaigns.name,
      }).from(schema.metaDailyInsights).innerJoin(schema.adAccounts, and(eq(schema.adAccounts.id, schema.metaDailyInsights.adAccountId), eq(schema.adAccounts.workspaceId, schema.metaDailyInsights.workspaceId)))
        .innerJoin(schema.adCampaigns, and(eq(schema.adCampaigns.adAccountId, schema.metaDailyInsights.adAccountId), eq(schema.adCampaigns.externalCampaignId, schema.metaDailyInsights.externalEntityId), eq(schema.adCampaigns.workspaceId, schema.metaDailyInsights.workspaceId)))
        .where(and(eq(schema.metaDailyInsights.workspaceId, workspaceId), eq(schema.metaDailyInsights.entityLevel, "campaign")));
      if (!insights.length) return [];
      const metricRows = await transaction.select().from(schema.metaDailyInsightMetrics).where(inArray(schema.metaDailyInsightMetrics.dailyInsightId, insights.map((item) => item.id)));
      const byInsight = new Map<string, MetaMetricValue[]>();
      for (const metric of metricRows) { const group = byInsight.get(metric.dailyInsightId) ?? []; group.push({ metricKey: metric.metricKey, ...(metric.actionType ? { actionType: metric.actionType } : {}), aggregation: metric.aggregation, ...(metric.valueDecimal !== null ? { valueDecimal: String(metric.valueDecimal) } : {}), ...(metric.valueMinor !== null ? { valueMinor: metric.valueMinor } : {}), ...(metric.valueJson ? { valueJson: metric.valueJson } : {}), ...(metric.currency ? { currency: metric.currency } : {}), provenance: metric.provenance, ...(Object.keys(metric.availability).length ? { availability: metric.availability as MetaMetricValue["availability"] } : {}) }); byInsight.set(metric.dailyInsightId, group); }
      return insights.map((item) => ({ accountId: item.accountId, accountName: item.accountName, campaignId: item.externalEntityId, campaignName: item.campaignName,
        row: normalizeMetaDailyInsight({ schemaVersion: 1, workspaceId, metaConnectionId: item.connectionId, adAccountId: item.accountId, entityLevel: "campaign", externalEntityId: item.externalEntityId, dateStart: item.dateStart, dateStop: item.dateStop, attributionLabel: item.attributionLabel, ...(item.attributionWindow ? { attributionWindow: item.attributionWindow } : {}), ...(item.currency ? { currency: item.currency } : {}), ...(item.timezone ? { timezone: item.timezone } : {}), fieldAvailability: item.fieldAvailability as Record<string, MetaFieldAvailability>, sourceRevision: item.sourceRevision, sourcePayloadHash: item.sourcePayloadHash, ...(item.sourceUpdatedAt ? { sourceUpdatedAt: item.sourceUpdatedAt.toISOString() } : {}), metricProvenance: item.metricProvenance, metrics: byInsight.get(item.id) ?? [] }) }));
    });
  }
}
