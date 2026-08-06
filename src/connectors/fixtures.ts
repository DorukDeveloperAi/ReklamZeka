import { ConnectorError, type ConnectorPage, type ReadOnlyAdConnector, type SourceRecord } from "./contract";
import {
  CANONICAL_AD_METRIC_VERSION,
  decimalMoneyToMinor,
  microsToMinor,
  validateCanonicalMetric,
  type CanonicalDailyMetric,
} from "@/domain/ads/canonical";

export type MetaAdsFixture = Readonly<{
  account_id: string;
  account_name: string;
  campaign_id: string;
  campaign_name: string;
  date_start: string;
  currency: string;
  timezone: string;
  spend: string;
  impressions: string;
  clicks: string;
  purchases: string;
  purchase_value: string;
  attribution_click_days: string;
  attribution_view_days: string;
}>;

export type GoogleAdsFixture = Readonly<{
  customer_id: string;
  customer_name: string;
  campaign_id: string;
  campaign_name: string;
  segments_date: string;
  currency_code: string;
  timezone: string;
  cost_micros: string;
  impressions: string;
  clicks: string;
  conversions: string;
  conversions_value_micros: string;
  attribution_model: "last_click" | "data_driven";
  attribution_click_days: string;
}>;

abstract class PagedFixtureConnector<TPayload> implements ReadOnlyAdConnector<TPayload> {
  abstract readonly platform: "meta_ads" | "google_ads";
  readonly access = "read_only" as const;
  readonly rateLimit = { maxRequests: 10, windowMs: 1_000 } as const;

  constructor(private readonly pages: readonly (readonly SourceRecord<TPayload>[])[]) {}

  async fetchPage(cursor?: string): Promise<ConnectorPage<TPayload>> {
    const index = cursor === undefined ? 0 : Number(cursor);
    if (!Number.isSafeInteger(index) || index < 0) {
      throw new ConnectorError("invalid_data", `Geçersiz fixture cursor: ${cursor}`, false);
    }
    const records = this.pages[index] ?? [];
    return {
      records,
      nextCursor: index + 1 < this.pages.length ? String(index + 1) : undefined,
      observedAt: "2026-08-06T12:00:00.000Z",
    };
  }

  abstract toCanonical(record: SourceRecord<TPayload>, workspaceId: string): CanonicalDailyMetric;
}

function integer(value: string, field: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new ConnectorError("invalid_data", `${field} geçersiz`, false);
  }
  return parsed;
}

function decimal(value: string, field: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new ConnectorError("invalid_data", `${field} geçersiz`, false);
  }
  return parsed;
}

export class MetaAdsFixtureConnector extends PagedFixtureConnector<MetaAdsFixture> {
  readonly platform = "meta_ads" as const;

  toCanonical(record: SourceRecord<MetaAdsFixture>, workspaceId: string): CanonicalDailyMetric {
    const row = record.payload;
    return validateCanonicalMetric({
      schemaVersion: CANONICAL_AD_METRIC_VERSION,
      workspaceId,
      platform: this.platform,
      sourceAccountId: row.account_id,
      sourceCampaignId: row.campaign_id,
      sourceRowId: record.id,
      sourceUpdatedAt: record.updatedAt,
      accountName: row.account_name,
      campaignName: row.campaign_name,
      metricDate: row.date_start,
      currency: row.currency,
      timezone: row.timezone,
      attribution: {
        model: "platform_default",
        clickDays: integer(row.attribution_click_days, "attribution_click_days"),
        viewDays: integer(row.attribution_view_days, "attribution_view_days"),
      },
      spendMinor: decimalMoneyToMinor(row.spend),
      impressions: integer(row.impressions, "impressions"),
      clicks: integer(row.clicks, "clicks"),
      conversions: decimal(row.purchases, "purchases"),
      conversionValueMinor: decimalMoneyToMinor(row.purchase_value),
    });
  }
}

export class GoogleAdsFixtureConnector extends PagedFixtureConnector<GoogleAdsFixture> {
  readonly platform = "google_ads" as const;

  toCanonical(record: SourceRecord<GoogleAdsFixture>, workspaceId: string): CanonicalDailyMetric {
    const row = record.payload;
    return validateCanonicalMetric({
      schemaVersion: CANONICAL_AD_METRIC_VERSION,
      workspaceId,
      platform: this.platform,
      sourceAccountId: row.customer_id,
      sourceCampaignId: row.campaign_id,
      sourceRowId: record.id,
      sourceUpdatedAt: record.updatedAt,
      accountName: row.customer_name,
      campaignName: row.campaign_name,
      metricDate: row.segments_date,
      currency: row.currency_code,
      timezone: row.timezone,
      attribution: {
        model: row.attribution_model,
        clickDays: integer(row.attribution_click_days, "attribution_click_days"),
        viewDays: 0,
      },
      spendMinor: microsToMinor(row.cost_micros),
      impressions: integer(row.impressions, "impressions"),
      clicks: integer(row.clicks, "clicks"),
      conversions: decimal(row.conversions, "conversions"),
      conversionValueMinor: microsToMinor(row.conversions_value_micros),
    });
  }
}
