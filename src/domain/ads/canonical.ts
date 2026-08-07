export const CANONICAL_AD_METRIC_VERSION = 1 as const;

export type SourcePlatform = "meta_ads" | "google_ads" | "csv";

export type Attribution = Readonly<{
  clickDays: number;
  viewDays: number;
  model: "platform_default" | "last_click" | "data_driven";
}>;

export type CanonicalDailyMetric = Readonly<{
  schemaVersion: typeof CANONICAL_AD_METRIC_VERSION;
  workspaceId: string;
  platform: SourcePlatform;
  sourceAccountId: string;
  sourceCampaignId: string;
  sourceRowId: string;
  sourceUpdatedAt: string;
  accountName: string;
  campaignName: string;
  metricDate: string;
  currency: string;
  timezone: string;
  attribution: Attribution;
  spendMinor: number;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionValueMinor: number;
}>;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

function assertNonNegativeNumber(value: number, field: string, integer = true): void {
  if (!Number.isFinite(value) || value < 0 || (integer && !Number.isSafeInteger(value))) {
    throw new CanonicalMetricError(field, `${field} negatif olmayan güvenli bir sayı olmalıdır`);
  }
}

export class CanonicalMetricError extends Error {
  constructor(readonly field: string, message: string) {
    super(message);
    this.name = "CanonicalMetricError";
  }
}

export function validateCanonicalMetric(metric: CanonicalDailyMetric): CanonicalDailyMetric {
  if (metric.schemaVersion !== CANONICAL_AD_METRIC_VERSION) {
    throw new CanonicalMetricError("schemaVersion", "Desteklenmeyen kanonik şema sürümü");
  }
  if (!metric.workspaceId || !metric.sourceAccountId || !metric.sourceCampaignId || !metric.sourceRowId) {
    throw new CanonicalMetricError("identity", "Çalışma alanı ve kaynak kimlikleri zorunludur");
  }
  if (!DATE_PATTERN.test(metric.metricDate)) {
    throw new CanonicalMetricError("metricDate", "metricDate YYYY-MM-DD biçiminde olmalıdır");
  }
  if (!CURRENCY_PATTERN.test(metric.currency)) {
    throw new CanonicalMetricError("currency", "currency üç harfli ISO kodu olmalıdır");
  }
  if (!metric.timezone || !Number.isFinite(Date.parse(metric.sourceUpdatedAt))) {
    throw new CanonicalMetricError("source", "Saat dilimi ve geçerli sourceUpdatedAt zorunludur");
  }

  assertNonNegativeNumber(metric.spendMinor, "spendMinor");
  assertNonNegativeNumber(metric.impressions, "impressions");
  assertNonNegativeNumber(metric.clicks, "clicks");
  assertNonNegativeNumber(metric.conversions, "conversions", false);
  assertNonNegativeNumber(metric.conversionValueMinor, "conversionValueMinor");
  assertNonNegativeNumber(metric.attribution.clickDays, "attribution.clickDays");
  assertNonNegativeNumber(metric.attribution.viewDays, "attribution.viewDays");

  return metric;
}

export function decimalMoneyToMinor(value: string): number {
  const match = /^([0-9]+)(?:\.([0-9]+))?$/.exec(value.trim());
  if (!match) throw new CanonicalMetricError("money", `Geçersiz para değeri: ${value}`);

  const whole = BigInt(match[1]!);
  const fraction = match[2] ?? "";
  const hundredths = BigInt((fraction + "00").slice(0, 2));
  const shouldRoundUp = Number(fraction[2] ?? "0") >= 5;
  const minor = whole * 100n + hundredths + (shouldRoundUp ? 1n : 0n);
  const result = Number(minor);
  if (!Number.isSafeInteger(result)) throw new CanonicalMetricError("money", "Para değeri güvenli sayı aralığını aşıyor");
  return result;
}

export function microsToMinor(value: string): number {
  if (!/^\d+$/.test(value)) throw new CanonicalMetricError("micros", `Geçersiz micros değeri: ${value}`);
  const micros = BigInt(value);
  const minor = (micros + 5_000n) / 10_000n;
  const result = Number(minor);
  if (!Number.isSafeInteger(result)) throw new CanonicalMetricError("micros", "Micros değeri güvenli sayı aralığını aşıyor");
  return result;
}

export function metricIdentity(metric: CanonicalDailyMetric): string {
  const attribution = `${metric.attribution.model}:${metric.attribution.clickDays}:${metric.attribution.viewDays}`;
  return [
    metric.workspaceId,
    metric.platform,
    metric.sourceAccountId,
    metric.sourceCampaignId,
    metric.metricDate,
    attribution,
    metric.schemaVersion,
  ].join("|");
}

export function comparableMetrics(metric: CanonicalDailyMetric) {
  return {
    metricDate: metric.metricDate,
    currency: metric.currency,
    timezone: metric.timezone,
    attribution: metric.attribution,
    spendMinor: metric.spendMinor,
    impressions: metric.impressions,
    clicks: metric.clicks,
    conversions: metric.conversions,
    conversionValueMinor: metric.conversionValueMinor,
  };
}
