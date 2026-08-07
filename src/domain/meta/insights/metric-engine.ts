import { createHash } from "node:crypto";
import type { AnalysisMetric } from "@/analyses/schema";
import type {
  CanonicalMetaDailyInsight,
  MetaMetricAggregation,
  MetaMetricValue,
} from "@/domain/meta/insights/contract";

export const META_METRIC_FORMULA_CATALOG_VERSION = "meta-metric-formulas/1.0.0" as const;

type SourceSelector = Readonly<{
  metricKey: string;
  actionType?: string;
  valueKind: "decimal" | "minor";
}>;

type SourceFormula = Readonly<{
  kind: "source";
  aggregation: "additive" | "non_additive";
  selectors: readonly SourceSelector[];
  money: boolean;
}>;

type RatioFormula = Readonly<{
  kind: "ratio";
  aggregation: "derived";
  numerator: AnalysisMetric;
  denominator: AnalysisMetric;
  factor: number;
  money: boolean;
  matchCurrency: boolean;
}>;

export type MetaMetricFormula = SourceFormula | RatioFormula;

const source = (
  aggregation: SourceFormula["aggregation"],
  selectors: readonly SourceSelector[],
  money = false,
): SourceFormula => Object.freeze({ kind: "source", aggregation, selectors, money });

const ratio = (
  numerator: AnalysisMetric,
  denominator: AnalysisMetric,
  factor = 1,
  money = false,
  matchCurrency = false,
): RatioFormula => Object.freeze({ kind: "ratio", aggregation: "derived", numerator, denominator, factor, money, matchCurrency });

/** Minimal executable catalog used by the current objective playbooks. */
export const META_METRIC_FORMULA_CATALOG: Readonly<Record<AnalysisMetric, MetaMetricFormula>> = Object.freeze({
  spendMinor: source("additive", [{ metricKey: "spend", valueKind: "minor" }], true),
  impressions: source("additive", [{ metricKey: "impressions", valueKind: "decimal" }]),
  clicks: source("additive", [{ metricKey: "clicks", valueKind: "decimal" }]),
  conversions: source("additive", [
    { metricKey: "conversions", valueKind: "decimal" },
    { metricKey: "actions", actionType: "conversion", valueKind: "decimal" },
    { metricKey: "actions", actionType: "offsite_conversion", valueKind: "decimal" },
    { metricKey: "actions", actionType: "purchase", valueKind: "decimal" },
  ]),
  conversionValueMinor: source("additive", [
    { metricKey: "conversion_value", valueKind: "minor" },
    { metricKey: "action_values", actionType: "purchase", valueKind: "minor" },
  ], true),
  reach: source("non_additive", [{ metricKey: "reach", valueKind: "decimal" }]),
  frequency: source("non_additive", [{ metricKey: "frequency", valueKind: "decimal" }]),
  landingPageViews: source("additive", [
    { metricKey: "landing_page_views", valueKind: "decimal" },
    { metricKey: "actions", actionType: "landing_page_view", valueKind: "decimal" },
  ]),
  engagements: source("additive", [
    { metricKey: "engagements", valueKind: "decimal" },
    { metricKey: "actions", actionType: "post_engagement", valueKind: "decimal" },
  ]),
  leads: source("additive", [
    { metricKey: "leads", valueKind: "decimal" },
    { metricKey: "actions", actionType: "lead", valueKind: "decimal" },
  ]),
  qualifiedLeads: source("additive", [
    { metricKey: "qualified_leads", valueKind: "decimal" },
    { metricKey: "actions", actionType: "qualified_lead", valueKind: "decimal" },
  ]),
  messages: source("additive", [
    { metricKey: "messages", valueKind: "decimal" },
    { metricKey: "actions", actionType: "onsite_conversion.messaging_conversation_started_7d", valueKind: "decimal" },
    { metricKey: "actions", actionType: "messaging_conversation_started", valueKind: "decimal" },
  ]),
  appInstalls: source("additive", [
    { metricKey: "app_installs", valueKind: "decimal" },
    { metricKey: "actions", actionType: "app_install", valueKind: "decimal" },
  ]),
  retentionD7: source("non_additive", [{ metricKey: "retention_d7", valueKind: "decimal" }]),
  purchases: source("additive", [
    { metricKey: "purchases", valueKind: "decimal" },
    { metricKey: "actions", actionType: "purchase", valueKind: "decimal" },
  ]),
  revenueMinor: source("additive", [
    { metricKey: "revenue", valueKind: "minor" },
    { metricKey: "action_values", actionType: "purchase", valueKind: "minor" },
  ], true),
  ctr: ratio("clicks", "impressions"),
  cpcMinor: ratio("spendMinor", "clicks", 1, true),
  cpmMinor: ratio("spendMinor", "impressions", 1_000, true),
  cpaMinor: ratio("spendMinor", "conversions", 1, true),
  cplMinor: ratio("spendMinor", "leads", 1, true),
  costPerMessageMinor: ratio("spendMinor", "messages", 1, true),
  roas: ratio("revenueMinor", "spendMinor", 1, false, true),
  engagementRate: ratio("engagements", "impressions"),
  cpeMinor: ratio("spendMinor", "engagements", 1, true),
  qualifiedLeadRate: ratio("qualifiedLeads", "leads"),
  cpiMinor: ratio("spendMinor", "appInstalls", 1, true),
  conversionRate: ratio("conversions", "clicks"),
  averageOrderValueMinor: ratio("revenueMinor", "purchases", 1, true),
});

export type MetaMetricUnknownReason =
  | "missing_metric"
  | "source_unavailable"
  | "zero_denominator"
  | "currency_mismatch"
  | "attribution_mismatch"
  | "non_additive_requery_required"
  | "invalid_value";

export type MetaMetricProvenance = Readonly<{
  catalogVersion: typeof META_METRIC_FORMULA_CATALOG_VERSION;
  aggregationRule: "sum" | "source_grain_only" | "ratio_of_sums";
  sourceMetricKey?: string;
  actionType?: string;
  formulaVersion?: string;
  numerator?: AnalysisMetric;
  denominator?: AnalysisMetric;
  factor?: number;
  components?: Readonly<{
    numerator: Readonly<{
      metric: AnalysisMetric;
      sourceMetricKey?: string;
      actionType?: string;
      sourceAvailability?: readonly string[];
    }>;
    denominator: Readonly<{
      metric: AnalysisMetric;
      sourceMetricKey?: string;
      actionType?: string;
      sourceAvailability?: readonly string[];
    }>;
  }>;
  inputRowCount: number;
  sourceAvailability?: readonly string[];
}>;

type MetricResultBase = Readonly<{
  metric: AnalysisMetric;
  aggregation: MetaMetricAggregation;
  provenance: MetaMetricProvenance;
}>;

export type MetaAggregatedMetric =
  | (MetricResultBase & Readonly<{
    status: "available";
    valueDecimal: string;
    currency?: string;
  }>)
  | (MetricResultBase & Readonly<{
    status: "unknown";
    reason: MetaMetricUnknownReason;
  }>);

export type MetaMetricAggregationResult = Readonly<{
  catalogVersion: typeof META_METRIC_FORMULA_CATALOG_VERSION;
  metrics: readonly MetaAggregatedMetric[];
  resultHash: string;
}>;

export class MetaMetricAggregationError extends Error {
  constructor(readonly code: "conflicting_revision") {
    super("Meta metrikleri çelişkili canonical revision nedeniyle güvenle toplanamadı");
    this.name = "MetaMetricAggregationError";
  }
}

type Decimal = Readonly<{ coefficient: bigint; scale: number }>;

function codePointCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => codePointCompare(left, right))
      .map(([key, item]) => [key, stableValue(item)]));
  }
  return value;
}

function parseDecimal(value: string): Decimal | null {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) return null;
  const fraction = match[3] ?? "";
  const coefficient = BigInt(`${match[1] ?? ""}${match[2]}${fraction}`);
  return { coefficient, scale: fraction.length };
}

function power10(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}

function addDecimals(values: readonly Decimal[]): Decimal {
  const scale = Math.max(0, ...values.map((value) => value.scale));
  return {
    coefficient: values.reduce(
      (sum, value) => sum + value.coefficient * power10(scale - value.scale),
      0n,
    ),
    scale,
  };
}

function formatDecimal(value: Decimal): string {
  const negative = value.coefficient < 0n;
  const digits = (negative ? -value.coefficient : value.coefficient).toString().padStart(value.scale + 1, "0");
  if (value.scale === 0) return `${negative ? "-" : ""}${digits}`;
  const whole = digits.slice(0, -value.scale) || "0";
  const fraction = digits.slice(-value.scale).replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

function divideDecimal(numerator: Decimal, denominator: Decimal, factor: number, precision = 12): string | null {
  if (denominator.coefficient === 0n) return null;
  const scaledNumerator = numerator.coefficient * BigInt(factor) * power10(denominator.scale + precision);
  const scaledDenominator = denominator.coefficient * power10(numerator.scale);
  const quotient = scaledNumerator / scaledDenominator;
  const remainder = scaledNumerator % scaledDenominator;
  const rounded = remainder === 0n
    ? quotient
    : quotient + (remainder < 0n ? -1n : 1n) * (2n * (remainder < 0n ? -remainder : remainder) >= (scaledDenominator < 0n ? -scaledDenominator : scaledDenominator) ? 1n : 0n);
  return formatDecimal({ coefficient: rounded, scale: precision });
}

function metricMatches(value: MetaMetricValue, selector: SourceSelector): boolean {
  return value.metricKey === selector.metricKey && (value.actionType ?? "") === (selector.actionType ?? "");
}

function valueOf(metric: MetaMetricValue, selector: SourceSelector): Decimal | null {
  if (selector.valueKind === "minor") {
    return metric.valueMinor === undefined ? null : { coefficient: BigInt(metric.valueMinor), scale: 0 };
  }
  return metric.valueDecimal === undefined ? null : parseDecimal(metric.valueDecimal);
}

function unknown(
  metric: AnalysisMetric,
  aggregation: MetaMetricAggregation,
  reason: MetaMetricUnknownReason,
  provenance: MetaMetricProvenance,
): MetaAggregatedMetric {
  return Object.freeze({ metric, aggregation, status: "unknown", reason, provenance });
}

function distinctAttribution(rows: readonly CanonicalMetaDailyInsight[]): number {
  return new Set(rows.map((row) => JSON.stringify(stableValue({
    label: row.attributionLabel,
    window: row.attributionWindow ?? null,
  })))).size;
}

function deduplicateRows(rows: readonly CanonicalMetaDailyInsight[]): readonly CanonicalMetaDailyInsight[] {
  const byIdentity = new Map<string, CanonicalMetaDailyInsight>();
  for (const row of rows) {
    const existing = byIdentity.get(row.identity);
    if (existing && existing.contentHash !== row.contentHash) {
      throw new MetaMetricAggregationError("conflicting_revision");
    }
    if (!existing) byIdentity.set(row.identity, row);
  }
  return [...byIdentity.values()].sort((left, right) => codePointCompare(
    `${left.identity}:${left.contentHash}`,
    `${right.identity}:${right.contentHash}`,
  ));
}

export function aggregateMetaMetrics(input: Readonly<{
  rows: readonly CanonicalMetaDailyInsight[];
  metrics: readonly AnalysisMetric[];
}>): MetaMetricAggregationResult {
  const rows = deduplicateRows(input.rows);
  const requested = [...new Set(input.metrics)].sort(codePointCompare);
  const cache = new Map<AnalysisMetric, MetaAggregatedMetric>();
  const attributionMismatch = rows.length > 0 && distinctAttribution(rows) > 1;

  const evaluate = (metric: AnalysisMetric): MetaAggregatedMetric => {
    const cached = cache.get(metric);
    if (cached) return cached;
    const formula = META_METRIC_FORMULA_CATALOG[metric];
    const baseProvenance = {
      catalogVersion: META_METRIC_FORMULA_CATALOG_VERSION,
      inputRowCount: rows.length,
    } as const;
    let result: MetaAggregatedMetric;

    if (attributionMismatch) {
      result = unknown(metric, formula.aggregation, "attribution_mismatch", {
        ...baseProvenance,
        aggregationRule: formula.kind === "ratio" ? "ratio_of_sums" : formula.aggregation === "additive" ? "sum" : "source_grain_only",
      });
    } else if (formula.kind === "source") {
      const selected = formula.selectors.find((selector) => rows.some((row) => row.metrics.some((value) => metricMatches(value, selector))));
      const provenance: MetaMetricProvenance = {
        ...baseProvenance,
        aggregationRule: formula.aggregation === "additive" ? "sum" : "source_grain_only",
        sourceMetricKey: selected?.metricKey,
        actionType: selected?.actionType,
      };
      if (!selected) {
        result = unknown(metric, formula.aggregation, "missing_metric", provenance);
      } else if (formula.aggregation === "non_additive" && rows.length !== 1) {
        result = unknown(metric, formula.aggregation, "non_additive_requery_required", provenance);
      } else {
        const matched = rows.flatMap((row) => row.metrics
          .filter((value) => metricMatches(value, selected))
          .map((value) => ({ row, value })));
        const unavailable = matched.filter(({ value }) => value.availability);
        const sourceAvailability = [...new Set(unavailable.map(({ value }) => value.availability!.reason))].sort(codePointCompare);
        const withAvailability = sourceAvailability.length > 0 ? { ...provenance, sourceAvailability } : provenance;
        if (unavailable.length > 0 || matched.length !== rows.length) {
          result = unknown(metric, formula.aggregation, "source_unavailable", withAvailability);
        } else {
          const metricCurrencyConflict = matched.some(({ row, value }) => (
            value.currency !== undefined && row.currency !== undefined && value.currency !== row.currency
          ));
          const currencies = new Set(matched.map(({ row, value }) => value.currency ?? row.currency).filter((value): value is string => Boolean(value)));
          if (metricCurrencyConflict) {
            result = unknown(metric, formula.aggregation, "currency_mismatch", withAvailability);
          } else if (formula.money && currencies.size !== 1) {
            result = unknown(metric, formula.aggregation, currencies.size > 1 ? "currency_mismatch" : "source_unavailable", withAvailability);
          } else {
            const values = matched.map(({ value }) => valueOf(value, selected));
            if (values.some((value) => value === null)) {
              result = unknown(metric, formula.aggregation, "invalid_value", withAvailability);
            } else {
              const summed = formula.aggregation === "additive"
                ? addDecimals(values as Decimal[])
                : values[0]!;
              result = Object.freeze({
                metric,
                aggregation: formula.aggregation,
                status: "available",
                valueDecimal: formatDecimal(summed),
                ...(formula.money ? { currency: [...currencies][0] } : {}),
                provenance: withAvailability,
              });
            }
          }
        }
      }
    } else {
      const numerator = evaluate(formula.numerator);
      const denominator = evaluate(formula.denominator);
      const provenance: MetaMetricProvenance = {
        ...baseProvenance,
        aggregationRule: "ratio_of_sums",
        formulaVersion: `${metric}/${META_METRIC_FORMULA_CATALOG_VERSION}`,
        numerator: formula.numerator,
        denominator: formula.denominator,
        factor: formula.factor,
        components: {
          numerator: {
            metric: formula.numerator,
            sourceMetricKey: numerator.provenance.sourceMetricKey,
            actionType: numerator.provenance.actionType,
            sourceAvailability: numerator.provenance.sourceAvailability,
          },
          denominator: {
            metric: formula.denominator,
            sourceMetricKey: denominator.provenance.sourceMetricKey,
            actionType: denominator.provenance.actionType,
            sourceAvailability: denominator.provenance.sourceAvailability,
          },
        },
      };
      if (numerator.status === "unknown" || denominator.status === "unknown") {
        const reason = numerator.status === "unknown"
          ? numerator.reason
          : denominator.status === "unknown"
          ? denominator.reason
          : "missing_metric";
        result = unknown(metric, "derived", reason, provenance);
      } else if (formula.matchCurrency && numerator.currency !== denominator.currency) {
        result = unknown(metric, "derived", "currency_mismatch", provenance);
      } else {
        const numeratorValue = parseDecimal(numerator.valueDecimal)!;
        const denominatorValue = parseDecimal(denominator.valueDecimal)!;
        const valueDecimal = divideDecimal(numeratorValue, denominatorValue, formula.factor);
        result = valueDecimal === null
          ? unknown(metric, "derived", "zero_denominator", provenance)
          : Object.freeze({
            metric,
            aggregation: "derived",
            status: "available",
            valueDecimal,
            ...(formula.money && numerator.currency ? { currency: numerator.currency } : {}),
            provenance,
          });
      }
    }
    cache.set(metric, result);
    return result;
  };

  const metrics = requested.map(evaluate);
  const envelope = stableValue({ catalogVersion: META_METRIC_FORMULA_CATALOG_VERSION, metrics });
  return Object.freeze({
    catalogVersion: META_METRIC_FORMULA_CATALOG_VERSION,
    metrics: Object.freeze(metrics),
    resultHash: createHash("sha256").update(JSON.stringify(envelope)).digest("hex"),
  });
}
