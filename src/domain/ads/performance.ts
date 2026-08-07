import type { CanonicalDailyMetric } from "./canonical";

export type PeriodDays = 7 | 30 | 90;

export type MetricTotals = Readonly<{
  spendMinor: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValueMinor: number;
  ctr: number;
  cpaMinor: number | null;
  roas: number | null;
}>;

export type PerformanceSnapshot = Readonly<{
  periodDays: PeriodDays;
  asOf: string;
  currency: string;
  timezone: string;
  attributionLabels: readonly string[];
  freshness: Readonly<{ status: "fresh" | "delayed" | "stale" | "empty"; hours: number | null; latestAt: string | null }>;
  current: MetricTotals;
  previous: MetricTotals;
  campaigns: readonly Readonly<{
    id: string;
    name: string;
    platform: CanonicalDailyMetric["platform"];
    totals: MetricTotals;
  }>[];
}>;

const emptyTotals = () => ({ spendMinor: 0, impressions: 0, clicks: 0, conversions: 0, conversionValueMinor: 0 });

function totals(metrics: readonly CanonicalDailyMetric[]): MetricTotals {
  const sum = metrics.reduce((result, metric) => ({
    spendMinor: result.spendMinor + metric.spendMinor,
    impressions: result.impressions + metric.impressions,
    clicks: result.clicks + metric.clicks,
    conversions: result.conversions + metric.conversions,
    conversionValueMinor: result.conversionValueMinor + metric.conversionValueMinor,
  }), emptyTotals());
  return {
    ...sum,
    ctr: sum.impressions === 0 ? 0 : sum.clicks / sum.impressions,
    cpaMinor: sum.conversions === 0 ? null : Math.round(sum.spendMinor / sum.conversions),
    roas: sum.spendMinor === 0 ? null : sum.conversionValueMinor / sum.spendMinor,
  };
}

function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function buildPerformanceSnapshot(
  metrics: readonly CanonicalDailyMetric[],
  periodDays: PeriodDays,
  asOf: string,
): PerformanceSnapshot {
  const endDate = asOf.slice(0, 10);
  const currentStart = shiftDate(endDate, -(periodDays - 1));
  const previousEnd = shiftDate(currentStart, -1);
  const previousStart = shiftDate(previousEnd, -(periodDays - 1));
  const currentMetrics = metrics.filter((metric) => metric.metricDate >= currentStart && metric.metricDate <= endDate);
  const previousMetrics = metrics.filter((metric) => metric.metricDate >= previousStart && metric.metricDate <= previousEnd);
  const currentCurrencies = new Set(currentMetrics.map((metric) => metric.currency));
  if (currentCurrencies.size > 1) throw new Error("Farklı para birimleri dönüşüm oranı olmadan toplanamaz");

  const campaignMap = new Map<string, CanonicalDailyMetric[]>();
  for (const metric of currentMetrics) {
    const key = `${metric.platform}:${metric.sourceCampaignId}`;
    campaignMap.set(key, [...(campaignMap.get(key) ?? []), metric]);
  }
  const latestAt = metrics.map((metric) => metric.sourceUpdatedAt).sort().at(-1) ?? null;
  const freshnessHours = latestAt ? Math.max(0, (Date.parse(asOf) - Date.parse(latestAt)) / 3_600_000) : null;
  const freshnessStatus = freshnessHours === null ? "empty" : freshnessHours <= 24 ? "fresh" : freshnessHours <= 72 ? "delayed" : "stale";

  return {
    periodDays,
    asOf,
    currency: currentMetrics[0]?.currency ?? metrics[0]?.currency ?? "TRY",
    timezone: currentMetrics[0]?.timezone ?? metrics[0]?.timezone ?? "Europe/Istanbul",
    attributionLabels: [...new Set(currentMetrics.map((metric) =>
      `${metric.attribution.model} · ${metric.attribution.clickDays}g tıklama / ${metric.attribution.viewDays}g görüntüleme`,
    ))].sort(),
    freshness: { status: freshnessStatus, hours: freshnessHours, latestAt },
    current: totals(currentMetrics),
    previous: totals(previousMetrics),
    campaigns: [...campaignMap.entries()].map(([id, campaignMetrics]) => ({
      id,
      name: campaignMetrics[0]!.campaignName,
      platform: campaignMetrics[0]!.platform,
      totals: totals(campaignMetrics),
    })).sort((left, right) => right.totals.spendMinor - left.totals.spendMinor),
  };
}

export function percentageChange(current: number, previous: number): number | null {
  return previous === 0 ? null : (current - previous) / previous;
}
