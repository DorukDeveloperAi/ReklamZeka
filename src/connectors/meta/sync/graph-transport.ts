import { ConnectorError } from "@/connectors/contract";
import { MetaGraphClient } from "@/connectors/meta/graph-client";
import {
  META_INSIGHT_CAPABILITY_CATALOG_VERSION,
  planMetaInsightQuery,
} from "@/domain/meta/insights/capability-catalog";
import type { MetaReadPage, MetaReadRequest, MetaReadTransport } from "./types";
import { META_INVENTORY_FIELD_CATALOG_VERSION } from "./inventory-materialization";

type GraphPage = Readonly<{
  data?: readonly Readonly<Record<string, unknown>>[];
  paging?: Readonly<{ cursors?: Readonly<{ after?: string }> }>;
}>;

const INVENTORY_FIELDS = {
  account: "id,name,currency,timezone_name,account_status,business",
  campaign: "id,name,status,effective_status,objective,buying_type,special_ad_categories,daily_budget,lifetime_budget,updated_time",
  ad_set: "id,name,status,effective_status,campaign_id,optimization_goal,billing_event,bid_strategy,bid_amount,daily_budget,lifetime_budget,attribution_spec,promoted_object,targeting,updated_time",
  ad: "id,name,status,effective_status,campaign_id,adset_id,creative{id},updated_time",
} as const;

const CREATIVE_POST_FIELDS = [
  "id",
  "name",
  "status",
  "effective_status",
  "campaign_id",
  "adset_id",
  "creative{id,name,title,body,call_to_action_type,link_url,object_type,object_story_id,effective_object_story_id,effective_instagram_story_id,effective_instagram_media_id,instagram_permalink_url,object_story_spec,asset_feed_spec}",
].join(",");

function inventoryPath(accountId: string, level: MetaReadRequest["entityLevel"]): string {
  if (level === "account") return `/${accountId}`;
  return `/${accountId}/${level === "ad_set" ? "adsets" : `${level}s`}`;
}

/** GET-only Graph binding for the deterministic S1.3 planner. */
export class MetaGraphSyncTransport implements MetaReadTransport {
  constructor(private readonly client: MetaGraphClient) {}

  async get(request: MetaReadRequest): Promise<MetaReadPage> {
    if (request.method !== "GET") throw new ConnectorError("invalid_data", "Meta sync transport yalnız GET kabul eder", false);
    if (request.stream === "insights") return this.insights(request);
    if (request.stream === "creative_post") return this.creativePost(request);
    return this.inventory(request);
  }

  private async inventory(request: MetaReadRequest): Promise<MetaReadPage> {
    const response = await this.client.getWithUsage<GraphPage | Readonly<Record<string, unknown>>>(
      inventoryPath(request.accountId, request.entityLevel),
      { fields: INVENTORY_FIELDS[request.entityLevel], limit: String(request.limit), ...(request.cursor ? { after: request.cursor } : {}) },
    );
    if (request.entityLevel === "account") {
      const row = response.data as Readonly<Record<string, unknown>>;
      if (typeof row.id !== "string") throw new ConnectorError("invalid_data", "Meta account yanıtı kimlik içermiyor", false);
      return {
        records: [row], nextCursor: null, usageHeadroom: response.usageHeadroom,
        sourceGraphVersion: this.client.graphApiVersion,
        fieldCatalogVersion: META_INVENTORY_FIELD_CATALOG_VERSION,
      };
    }
    return this.page(response.data as GraphPage, response.usageHeadroom, META_INVENTORY_FIELD_CATALOG_VERSION);
  }

  private async creativePost(request: MetaReadRequest): Promise<MetaReadPage> {
    const response = await this.client.getWithUsage<GraphPage>(`/${request.accountId}/ads`, {
      fields: CREATIVE_POST_FIELDS,
      limit: String(request.limit), ...(request.cursor ? { after: request.cursor } : {}),
    });
    return this.page(response.data, response.usageHeadroom);
  }

  private async insights(request: MetaReadRequest): Promise<MetaReadPage> {
    if (!request.dateStart || !request.dateStop) throw new ConnectorError("invalid_data", "Insight slice tarih aralığı zorunludur", false);
    if (request.entityLevel === "account") throw new ConnectorError("invalid_data", "Insight sync account seviyesi planlamaz", false);
    const plan = planMetaInsightQuery({
      graphApiVersion: this.client.graphApiVersion,
      level: request.entityLevel,
      metrics: ["spendMinor", "impressions", "reach", "clicks", "conversions", "revenueMinor"],
      attribution: { mode: "account_default" },
      timeIncrement: 1,
      // Connection doctor owns permission verification. This fixed value tells the pure
      // planner which already-authorized read capability this transport is invoking.
      grantedPermissions: ["ads_read"],
    });
    if (plan.status !== "planned") {
      throw new ConnectorError("invalid_data", `Meta insight capability planı kullanılamıyor: ${plan.reasonCode}`, false);
    }
    const response = await this.client.getWithUsage<GraphPage>(`/${request.accountId}/insights`, {
      ...plan.parameters,
      time_range: JSON.stringify({ since: request.dateStart, until: request.dateStop }),
      limit: String(request.limit),
      ...(request.cursor ? { after: request.cursor } : {}),
    });
    return this.page(response.data, response.usageHeadroom, META_INSIGHT_CAPABILITY_CATALOG_VERSION);
  }

  private page(page: GraphPage, headroom: number, fieldCatalogVersion?: string): MetaReadPage {
    if (!Array.isArray(page.data)) throw new ConnectorError("invalid_data", "Meta sync liste yanıtı data dizisi içermiyor", false);
    return {
      records: page.data,
      nextCursor: page.paging?.cursors?.after ?? null,
      usageHeadroom: headroom,
      sourceGraphVersion: this.client.graphApiVersion,
      ...(fieldCatalogVersion ? { fieldCatalogVersion } : {}),
    };
  }
}
