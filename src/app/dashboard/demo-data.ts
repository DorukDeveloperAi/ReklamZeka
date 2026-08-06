import { CANONICAL_AD_METRIC_VERSION, type CanonicalDailyMetric } from "@/domain/ads/canonical";

type DemoInput = Readonly<{
  date: string;
  platform: "meta_ads" | "google_ads";
  campaignId: string;
  campaignName: string;
  spendMinor: number;
  impressions: number;
  clicks: number;
  conversions: number;
  valueMinor: number;
}>;

function metric(input: DemoInput): CanonicalDailyMetric {
  return {
    schemaVersion: CANONICAL_AD_METRIC_VERSION,
    workspaceId: "demo-workspace",
    platform: input.platform,
    sourceAccountId: `${input.platform}-account`,
    sourceCampaignId: input.campaignId,
    sourceRowId: `${input.platform}-${input.campaignId}-${input.date}`,
    sourceUpdatedAt: "2026-08-06T08:30:00.000Z",
    accountName: "Demo Marka",
    campaignName: input.campaignName,
    metricDate: input.date,
    currency: "TRY",
    timezone: "Europe/Istanbul",
    attribution: { model: "platform_default", clickDays: 7, viewDays: input.platform === "meta_ads" ? 1 : 0 },
    spendMinor: input.spendMinor,
    impressions: input.impressions,
    clicks: input.clicks,
    conversions: input.conversions,
    conversionValueMinor: input.valueMinor,
  };
}

export const DEMO_METRICS = [
  metric({ date: "2026-08-05", platform: "meta_ads", campaignId: "summer", campaignName: "Yaz fırsatları", spendMinor: 42_500, impressions: 48_000, clicks: 1_320, conversions: 51, valueMinor: 186_000 }),
  metric({ date: "2026-08-04", platform: "google_ads", campaignId: "brand", campaignName: "Marka arama", spendMinor: 27_000, impressions: 21_000, clicks: 1_850, conversions: 74, valueMinor: 238_000 }),
  metric({ date: "2026-07-29", platform: "meta_ads", campaignId: "summer", campaignName: "Yaz fırsatları", spendMinor: 36_000, impressions: 45_000, clicks: 1_180, conversions: 48, valueMinor: 171_000 }),
  metric({ date: "2026-07-28", platform: "google_ads", campaignId: "brand", campaignName: "Marka arama", spendMinor: 25_000, impressions: 20_500, clicks: 1_700, conversions: 69, valueMinor: 219_000 }),
] as const;
