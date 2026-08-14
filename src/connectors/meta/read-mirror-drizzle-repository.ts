import { sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import * as schema from "@/db/schema";
import {
  buildMetaReadMirrorProjection,
  type MetaReadMirrorFact,
  type MetaReadMirrorProjection,
} from "@/domain/meta/read-mirror-projection";

type Database = NodePgDatabase<typeof schema>;
type Row = Readonly<Record<string, unknown>>;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const QUERY_LIMIT = 5_001;

function rows(result: unknown): readonly Row[] {
  if (!result || typeof result !== "object" || !("rows" in result) || !Array.isArray(result.rows)) {
    throw new Error("Meta read mirror rejected: corrupt_store");
  }
  return result.rows as readonly Row[];
}
function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
function timestamp(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  if (typeof value === "string" && Number.isFinite(Date.parse(value))) return new Date(value).toISOString();
  throw new Error("Meta read mirror rejected: corrupt_store");
}
function minor(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("Meta read mirror rejected: corrupt_store");
  return parsed;
}
function count(value: unknown): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" && /^\d+$/.test(value) ? Number(value) : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new Error("Meta read mirror rejected: corrupt_store");
  return parsed;
}
function object(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("Meta read mirror rejected: corrupt_store");
  return value as Record<string, unknown>;
}
function fact(row: Row): MetaReadMirrorFact {
  return {
    connectionId: text(row.connection_id) ?? "",
    connectionName: text(row.connection_name) ?? "",
    connectionStatus: text(row.connection_status) as MetaReadMirrorFact["connectionStatus"],
    accessMode: text(row.access_mode) as "read_only",
    accountId: text(row.account_id),
    accountName: text(row.account_name),
    currency: text(row.currency),
    timezone: text(row.timezone),
    accountFetchedAt: timestamp(row.account_fetched_at),
    inventoryStreamStatus: text(row.inventory_stream_status) as MetaReadMirrorFact["inventoryStreamStatus"],
    inventoryStreamUpdatedAt: timestamp(row.inventory_stream_updated_at),
    creativeStreamStatus: text(row.creative_stream_status) as MetaReadMirrorFact["creativeStreamStatus"],
    creativeStreamUpdatedAt: timestamp(row.creative_stream_updated_at),
    insightStreamStatus: text(row.insight_stream_status) as MetaReadMirrorFact["insightStreamStatus"],
    insightStreamUpdatedAt: timestamp(row.insight_stream_updated_at),
    insightCanonicalRowCount: count(row.insight_canonical_row_count),
    campaignId: text(row.campaign_id),
    campaignName: text(row.campaign_name),
    campaignStatus: text(row.campaign_status),
    campaignObjective: text(row.campaign_objective),
    campaignDailyBudgetMinor: minor(row.campaign_daily_budget_minor),
    campaignLifetimeBudgetMinor: minor(row.campaign_lifetime_budget_minor),
    campaignFetchedAt: timestamp(row.campaign_fetched_at),
    adSetId: text(row.ad_set_id),
    adSetName: text(row.ad_set_name),
    adSetStatus: text(row.ad_set_status),
    optimizationGoal: text(row.optimization_goal),
    targetingSummary: object(row.targeting_summary),
    adSetDailyBudgetMinor: minor(row.ad_set_daily_budget_minor),
    adSetLifetimeBudgetMinor: minor(row.ad_set_lifetime_budget_minor),
    adSetFetchedAt: timestamp(row.ad_set_fetched_at),
    adId: text(row.ad_id),
    adName: text(row.ad_name),
    adStatus: text(row.ad_status),
    adFetchedAt: timestamp(row.ad_fetched_at),
    creativeId: text(row.creative_id),
    creativeName: text(row.creative_name),
    creativeSourceType: text(row.creative_source_type),
    primaryText: text(row.primary_text),
    headline: text(row.headline),
    description: text(row.description),
    caption: text(row.caption),
    callToActionType: text(row.call_to_action_type),
    destinationUrl: text(row.destination_url),
    creativeFormat: text(row.creative_format),
    creativeFetchedAt: timestamp(row.creative_fetched_at),
    postId: text(row.post_id),
    postMediaType: text(row.post_media_type),
    postPermalink: text(row.post_permalink),
    postMessage: text(row.post_message),
    postCaption: text(row.post_caption),
    postPublishedAt: timestamp(row.post_published_at),
    postFetchedAt: timestamp(row.post_fetched_at),
  };
}

/**
 * Session scope is resolved before this adapter is invoked. This repository only
 * reads the canonical digital twin; it never loads a connection secret or calls Graph.
 */
export class DrizzleMetaReadMirrorRepository {
  constructor(private readonly database: Pick<Database, "transaction">, private readonly now: () => Date = () => new Date()) {}

  async load(workspaceId: string): Promise<MetaReadMirrorProjection> {
    if (!UUID.test(workspaceId)) throw new Error("Meta read mirror rejected: invalid_scope");
    const raw = await this.database.transaction(async (transaction) => {
      await transaction.execute(sql`set local transaction isolation level repeatable read`);
      await transaction.execute(sql`set local transaction read only`);
      return rows(await transaction.execute(sql`
        with insight_counts as (
          select insight.workspace_id, insight.ad_account_id, count(*)::text as canonical_row_count
          from meta_daily_insights insight
          where insight.workspace_id = ${workspaceId}::uuid
          group by insight.workspace_id, insight.ad_account_id
        )
        select
          connection.id::text as connection_id,
          connection.display_name as connection_name,
          connection.status::text as connection_status,
          connection.access_mode,
          account.id::text as account_id,
          account.name as account_name,
          account.currency,
          account.timezone,
          account.fetched_at as account_fetched_at,
          inventory_stream.status::text as inventory_stream_status,
          inventory_stream.updated_at as inventory_stream_updated_at,
          creative_stream.status::text as creative_stream_status,
          creative_stream.updated_at as creative_stream_updated_at,
          insight_stream.status::text as insight_stream_status,
          insight_stream.updated_at as insight_stream_updated_at,
          coalesce(insight_counts.canonical_row_count, '0') as insight_canonical_row_count,
          campaign.id::text as campaign_id,
          campaign.name as campaign_name,
          coalesce(campaign.effective_status, campaign.configured_status) as campaign_status,
          campaign.canonical_objective as campaign_objective,
          campaign.daily_budget_minor as campaign_daily_budget_minor,
          campaign.lifetime_budget_minor as campaign_lifetime_budget_minor,
          campaign.fetched_at as campaign_fetched_at,
          ad_set.id::text as ad_set_id,
          ad_set.name as ad_set_name,
          coalesce(ad_set.effective_status, ad_set.configured_status) as ad_set_status,
          ad_set.optimization_goal,
          ad_set.targeting_summary,
          ad_set.daily_budget_minor as ad_set_daily_budget_minor,
          ad_set.lifetime_budget_minor as ad_set_lifetime_budget_minor,
          ad_set.fetched_at as ad_set_fetched_at,
          ad.id::text as ad_id,
          ad.name as ad_name,
          coalesce(ad.effective_status, ad.configured_status) as ad_status,
          ad.fetched_at as ad_fetched_at,
          creative.id::text as creative_id,
          creative.name as creative_name,
          creative.source_type as creative_source_type,
          creative.primary_text,
          creative.headline,
          creative.description,
          creative.caption,
          creative.call_to_action_type,
          creative.destination_url,
          creative.creative_format,
          creative.fetched_at as creative_fetched_at,
          post.id::text as post_id,
          post.media_type as post_media_type,
          post.permalink as post_permalink,
          post.source_message as post_message,
          post.source_caption as post_caption,
          post.published_at as post_published_at,
          post.fetched_at as post_fetched_at
        from meta_connections connection
        left join data_sources source
          on source.workspace_id = connection.workspace_id
          and source.meta_connection_id = connection.id
          and source.platform = 'meta_ads'
        left join ad_accounts account
          on account.workspace_id = connection.workspace_id
          and account.data_source_id = source.id
          and account.disappeared_at is null
        left join meta_sync_streams inventory_stream
          on inventory_stream.workspace_id = connection.workspace_id
          and inventory_stream.meta_connection_id = connection.id
          and inventory_stream.ad_account_id = account.id
          and inventory_stream.stream_type = 'inventory'
        left join meta_sync_streams creative_stream
          on creative_stream.workspace_id = connection.workspace_id
          and creative_stream.meta_connection_id = connection.id
          and creative_stream.ad_account_id = account.id
          and creative_stream.stream_type = 'creative'
        left join meta_sync_streams insight_stream
          on insight_stream.workspace_id = connection.workspace_id
          and insight_stream.meta_connection_id = connection.id
          and insight_stream.ad_account_id = account.id
          and insight_stream.stream_type = 'insights'
        left join insight_counts
          on insight_counts.workspace_id = connection.workspace_id
          and insight_counts.ad_account_id = account.id
        left join ad_campaigns campaign
          on campaign.workspace_id = connection.workspace_id
          and campaign.ad_account_id = account.id
          and campaign.disappeared_at is null
        left join meta_ad_sets ad_set
          on ad_set.workspace_id = connection.workspace_id
          and ad_set.ad_account_id = account.id
          and ad_set.campaign_id = campaign.id
          and ad_set.disappeared_at is null
        left join meta_ads ad
          on ad.workspace_id = connection.workspace_id
          and ad.ad_account_id = account.id
          and ad.campaign_id = campaign.id
          and ad.ad_set_id = ad_set.id
          and ad.disappeared_at is null
        left join meta_creatives creative
          on creative.workspace_id = connection.workspace_id
          and creative.ad_account_id = account.id
          and creative.id = ad.creative_id
          and creative.disappeared_at is null
        left join meta_posts post
          on post.workspace_id = connection.workspace_id
          and post.meta_connection_id = connection.id
          and post.id = creative.post_id
          and post.disappeared_at is null
        where connection.workspace_id = ${workspaceId}::uuid
        order by connection.id, account.id, campaign.id, ad_set.id, ad.id
        limit ${QUERY_LIMIT}
      `));
    });
    const limitReached = raw.length === QUERY_LIMIT;
    return buildMetaReadMirrorProjection({ workspaceId, facts: raw.slice(0, QUERY_LIMIT - 1).map(fact),
      observedAt: this.now().toISOString(), limitReached });
  }
}
