import type { SliceMembershipEvaluation } from "@/domain/slices/slice-resolver";

export const SCOPE_REPORT_VERSION = "scope-report/1.0.0" as const;
export type ScopeReportRow = Readonly<{
  entityRef: string;
  entityLevel: SliceMembershipEvaluation["entityLevel"];
  membership: "included" | "excluded";
  reason: SliceMembershipEvaluation["reason"];
  marketEvidenceRefs: readonly string[];
  matchedDimensionRefs: readonly string[];
  matchedDimensionEvidenceRefs: readonly string[];
}>;
export type ScopeReport = Readonly<{
  version: typeof SCOPE_REPORT_VERSION;
  scope: Readonly<{
    sliceRef: string;
    revisionRef: string;
    revisionNumber: number;
    definitionHash: string;
    market: Readonly<{ dimensionRef: string; valueRef: string; key: "yerli" | "yabanci" }>;
  }>;
  rows: readonly ScopeReportRow[];
  /** Long-form, attribution-preserving raw metric evidence. No action type is
   * selected as primary or silently dropped. */
  rawMetrics: readonly ScopeReportMetric[];
  pivot: readonly ScopeReportPivotRow[];
  coverage: readonly ScopeReportCoverage[];
  /** The exact bounded projection context.  A report with no rows still has a
   * distinct, replayable period and granularity. */
  appliedFilters: Readonly<{ granularity: "day" | "week" | "month"; startDate: string | null; endDate: string | null; entityLevel: "campaign" | "ad_set" | null; metricKey: string | null; actionType: string | null; sort: "bucket" | "entity" | "metric"; direction: "asc" | "desc" }>;
  counts: Readonly<{ included: number; excluded: number; missingMarket: number; ambiguousMarket: number }>;
  authority: Readonly<{ canWriteMeta: false; canExecute: false; canApprove: false }>;
}>;
export type ScopeReportMetric = Readonly<{
  entityRef: string;
  entityLevel: "campaign" | "ad_set";
  bucket: string;
  date: string;
  attribution: string;
  metricKey: string;
  actionType: string | null;
  valueDecimal: string | null;
  valueMinor: string | null;
  currency: string | null;
  availability: "available" | "unavailable";
}>;
export type ScopeReportPivotRow = Readonly<{
  entityRef: string;
  entityLevel: "campaign" | "ad_set";
  bucket: string;
  subtotal: Readonly<{ metricCount: number; availableMetricCount: number }>;
  /** Ratios are present only when a denominator is exactly known. */
  ratios: Readonly<{ spendPerAction: Readonly<{ numeratorMinor: string; denominatorAction: string }> | null }>;
  drill: Readonly<{ entityRef: string; bucket: string }>;
}>;
export type ScopeReportCoverage = Readonly<{
  entityRef: string;
  entityLevel: "campaign" | "ad_set";
  actionType: string;
  expectedDays: readonly string[];
  observedDays: readonly string[];
  missingDays: readonly string[];
  sourceState: "ready" | "partial" | "unavailable";
  reasonCodes: readonly ("coverage_incomplete" | "action_unavailable" | "selector_required")[];
}>;
export type ScopeReportEvidence = Readonly<{
  sliceId: string | null;
  resolution: Readonly<{ memberships: readonly SliceMembershipEvaluation[] }> | null;
  sliceRef: string | null;
  revisionRef: string | null;
  revisionNumber: number | null;
  definitionHash: string | null;
  market: Readonly<{ dimensionRef: string; valueRef: string; key: "yerli" | "yabanci" }> | null;
  catalogActionTypes?: readonly string[];
}>;
export type ScopeReportMetricInput = Omit<ScopeReportMetric, "bucket">;
export type ScopeReportOptions = Readonly<{ granularity: "day" | "week" | "month"; startDate?: string; endDate?: string; entityLevel?: "campaign" | "ad_set"; metricKey?: string; actionType?: string; sort?: "bucket" | "entity" | "metric"; direction?: "asc" | "desc" }>;

function bucket(date: string, granularity: ScopeReportOptions["granularity"]): string {
  if (granularity === "day") return date;
  const instant = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(instant.getTime())) throw new Error("scope report rejected: metric");
  if (granularity === "month") return `${date.slice(0, 7)}-01`;
  const day = instant.getUTCDay() || 7;
  instant.setUTCDate(instant.getUTCDate() - day + 1);
  return instant.toISOString().slice(0, 10);
}
function dates(start: string | undefined, end: string | undefined): readonly string[] {
  if (!start || !end) return Object.freeze([]);
  const values: string[] = [];
  for (let time = Date.parse(`${start}T00:00:00Z`), endTime = Date.parse(`${end}T00:00:00Z`); time <= endTime; time += 86_400_000)
    values.push(new Date(time).toISOString().slice(0, 10));
  return Object.freeze(values);
}
type Decimal = Readonly<{ coefficient: bigint; scale: number }>;
function decimal(value: string | null): Decimal | null {
  if (value === null || !/^(0|[1-9]\d*)(?:\.(\d{1,18}))?$/.test(value)) return null;
  const [integer, fraction = ""] = value.split(".");
  return { coefficient: BigInt(`${integer}${fraction}`), scale: fraction.length };
}
function canonicalDecimal(value: Decimal): string {
  const digits = value.coefficient.toString().padStart(value.scale + 1, "0");
  return value.scale === 0 ? digits : `${digits.slice(0, -value.scale)}.${digits.slice(-value.scale)}`.replace(/\.0+$/, "");
}

/** A report projection is only an explainable view of the canonical current
 * resolver evidence. It never re-evaluates predicates or market boundaries. */
export function buildScopeReport(evidence: ScopeReportEvidence, metrics: readonly ScopeReportMetricInput[] = [], options: ScopeReportOptions = { granularity: "day" }): ScopeReport {
  const resolution = evidence.resolution;
  if (!resolution || evidence.sliceId === null || !evidence.sliceRef || !evidence.revisionRef
    || evidence.revisionNumber === null || !evidence.definitionHash || !evidence.market) throw new Error("scope report rejected: slice");
  const rows = Object.freeze(resolution.memberships.map((membership) => Object.freeze({
    entityRef: membership.entityRef,
    entityLevel: membership.entityLevel,
    membership: membership.included ? "included" as const : "excluded" as const,
    reason: membership.reason,
    marketEvidenceRefs: Object.freeze([...membership.marketEvidenceRefs]),
    matchedDimensionRefs: Object.freeze([...membership.matchedDimensionIds]),
    matchedDimensionEvidenceRefs: Object.freeze([...membership.matchedDimensionEvidenceRefs]),
  })));
  const filters = Object.freeze({ granularity: options.granularity, startDate: options.startDate ?? null, endDate: options.endDate ?? null,
    entityLevel: options.entityLevel ?? null, metricKey: options.metricKey ?? null, actionType: options.actionType ?? null, sort: options.sort ?? "bucket", direction: options.direction ?? "asc" });
  /** Coverage is selector evidence, not a rendering artifact.  In particular a
   * metric column filter must never make an action look unavailable (or vice
   * versa) merely because it is hidden from the long-form display. */
  const selectorMetrics = metrics.filter((metric) => (filters.entityLevel === null || metric.entityLevel === filters.entityLevel)
    && (filters.actionType === null || metric.metricKey !== "actions" || metric.actionType === filters.actionType));
  const rawMetrics = Object.freeze(selectorMetrics.filter((metric) => filters.metricKey === null || metric.metricKey === filters.metricKey).map((metric) => Object.freeze({ ...metric, bucket: bucket(metric.date, options.granularity) }))
    .sort((left, right) => {
      const field = filters.sort === "entity" ? "entityRef" : filters.sort === "metric" ? "metricKey" : "bucket";
      const compared = left[field].localeCompare(right[field]);
      return filters.direction === "asc" ? compared : -compared;
    }));
  const expectedDays = dates(options.startDate, options.endDate);
  const pivotGroups = new Map<string, ScopeReportMetric[]>();
  for (const metric of rawMetrics) {
    const key = `${metric.entityRef}\u0000${metric.entityLevel}\u0000${metric.bucket}`;
    pivotGroups.set(key, [...(pivotGroups.get(key) ?? []), metric]);
  }
  const pivot = Object.freeze([...pivotGroups.values()].map((items) => {
    const first = items[0]!;
    const available = items.filter((item) => item.availability === "available");
    const spendRows = available.filter((item) => item.metricKey === "spend");
    const actionRows = available.filter((item) => item.metricKey === "actions" && item.actionType !== null);
    const currencies = new Set(spendRows.map((item) => item.currency));
    const attributions = new Set([...spendRows, ...actionRows].map((item) => item.attribution));
    const actionTypes = new Set(actionRows.map((item) => item.actionType));
    const spend = spendRows.map((item) => decimal(item.valueMinor));
    const actions = actionRows.map((item) => decimal(item.valueDecimal));
    const spendTotal = spend.every((value) => value !== null) ? spend.reduce<bigint>((sum, value) => sum + value!.coefficient, 0n) : null;
    const commonScale = actions.every((value) => value !== null) ? Math.max(...actions.map((value) => value!.scale), 0) : 0;
    const actionTotal = actions.every((value) => value !== null) ? actions.reduce<bigint>((sum, value) => sum + value!.coefficient * 10n ** BigInt(commonScale - value!.scale), 0n) : null;
    const bucketDays = expectedDays.filter((day) => bucket(day, options.granularity) === first.bucket);
    // Pure domain callers may intentionally omit a period; in that case the
    // supplied bucket is the only bounded evidence available.
    const requiredDays = bucketDays.length ? bucketDays : [...new Set(selectorMetrics.filter((metric) => metric.entityRef === first.entityRef && metric.entityLevel === first.entityLevel && bucket(metric.date, options.granularity) === first.bucket).map((metric) => metric.date))];
    const complete = (metricKey: "spend" | "actions") => requiredDays.length > 0 && requiredDays.every((day) => {
      const matching = selectorMetrics.filter((metric) => metric.entityRef === first.entityRef && metric.entityLevel === first.entityLevel && metric.date === day && metric.metricKey === metricKey
        && (metricKey !== "actions" || metric.actionType === filters.actionType));
      return matching.length > 0 && matching.every((metric) => metric.availability === "available");
    });
    const ratio = filters.actionType !== null && complete("spend") && complete("actions") && spendTotal !== null && actionTotal !== null && actionTotal > 0n && currencies.size === 1 && !currencies.has(null) && attributions.size === 1 && actionTypes.size === 1 && actionTypes.has(filters.actionType)
      ? Object.freeze({ numeratorMinor: spendTotal.toString(), denominatorAction: canonicalDecimal({ coefficient: actionTotal, scale: commonScale }) }) : null;
    return Object.freeze({ entityRef: first.entityRef, entityLevel: first.entityLevel, bucket: first.bucket,
      subtotal: Object.freeze({ metricCount: items.length, availableMetricCount: available.length }),
      ratios: Object.freeze({ spendPerAction: ratio }),
      drill: Object.freeze({ entityRef: first.entityRef, bucket: first.bucket }),
    });
  }).sort((left, right) => {
    const field = filters.sort === "entity" ? "entityRef" : "bucket";
    const compared = left[field].localeCompare(right[field]) || left.bucket.localeCompare(right.bucket) || left.entityRef.localeCompare(right.entityRef);
    return filters.direction === "asc" ? compared : -compared;
  }));
  const observedCoverage = [...new Map(selectorMetrics.filter((metric) => metric.metricKey === "actions" && metric.actionType !== null)
    .map((metric) => [`${metric.entityRef}\u0000${metric.entityLevel}\u0000${metric.actionType}`, metric] as const)).entries()].map(([key, first]) => {
      const [entityRef, entityLevel, actionType] = key.split("\u0000") as [string, "campaign" | "ad_set", string];
      const actions = selectorMetrics.filter((metric) => metric.entityRef === entityRef && metric.entityLevel === entityLevel && metric.metricKey === "actions" && metric.actionType === actionType);
      const observedDays = Object.freeze([...new Set(actions.filter((metric) => metric.availability === "available").map((metric) => metric.date))].sort());
      const missingDays = Object.freeze(expectedDays.filter((day) => !observedDays.includes(day)));
      const unavailable = actions.some((metric) => metric.availability !== "available");
      const reasonCodes = Object.freeze([...(missingDays.length ? ["coverage_incomplete" as const] : []), ...(unavailable ? ["action_unavailable" as const] : [])]);
      return Object.freeze({ entityRef, entityLevel, actionType, expectedDays, observedDays, missingDays,
        sourceState: unavailable ? "unavailable" as const : missingDays.length ? "partial" as const : "ready" as const, reasonCodes });
    });
  const requestedCoverage = filters.actionType === null ? [] : rows.filter((row): row is ScopeReportRow & Readonly<{ entityLevel: "campaign" | "ad_set" }> => row.membership === "included" && (row.entityLevel === "campaign" || row.entityLevel === "ad_set") && (filters.entityLevel === null || row.entityLevel === filters.entityLevel))
    .filter((row) => !observedCoverage.some((coverage) => coverage.entityRef === row.entityRef && coverage.actionType === filters.actionType))
    .map((row) => Object.freeze({ entityRef: row.entityRef, entityLevel: row.entityLevel, actionType: filters.actionType!, expectedDays, observedDays: Object.freeze([]), missingDays: expectedDays,
      sourceState: "unavailable" as const, reasonCodes: Object.freeze(["coverage_incomplete" as const, "action_unavailable" as const]) }));
  const coverage = Object.freeze([...observedCoverage, ...requestedCoverage]);
  return Object.freeze({
    version: SCOPE_REPORT_VERSION,
    scope: Object.freeze({
      sliceRef: evidence.sliceRef,
      revisionRef: evidence.revisionRef,
      revisionNumber: evidence.revisionNumber,
      definitionHash: evidence.definitionHash,
      market: Object.freeze({ ...evidence.market }),
    }),
    rows,
    rawMetrics,
    pivot,
    coverage,
    appliedFilters: filters,
    counts: Object.freeze({
      included: rows.filter((row) => row.membership === "included").length,
      excluded: rows.filter((row) => row.membership === "excluded").length,
      missingMarket: rows.filter((row) => row.reason === "excluded_market_missing").length,
      ambiguousMarket: rows.filter((row) => row.reason === "excluded_market_ambiguous" || row.reason === "excluded_market_conflicting").length,
    }),
    authority: Object.freeze({ canWriteMeta: false, canExecute: false, canApprove: false }),
  });
}
