import { aggregateMetaMetrics, type MetaAggregatedMetric } from "@/domain/meta/insights/metric-engine";
import type { CanonicalMetaDailyInsight } from "@/domain/meta/insights/contract";
import { metaPublicReference } from "@/domain/meta/public-reference";

export const CANONICAL_PERFORMANCE_READ_VERSION = "canonical-performance-read/1.0.0" as const;
export type PerformanceState = "ready" | "partial" | "unavailable";
export type PerformanceSource = Readonly<{ accountId: string; accountName: string; campaignId: string; campaignName: string; row: CanonicalMetaDailyInsight }>;

const day = (date: Date) => date.toISOString().slice(0, 10);
const shift = (date: string, days: number) => day(new Date(new Date(`${date}T00:00:00.000Z`).valueOf() + days * 86_400_000));

type PublicMetric = Readonly<{ valueDecimal: string; currency?: string }>;
type Window = Readonly<{
  days: 7 | 30; state: PerformanceState; startDate: string | null; endDate: string | null;
  observedDays: number; missingDays: readonly string[]; freshnessAt: string | null; attribution: string | null; currency: string | null;
  spend: PublicMetric | null; outcome: PublicMetric | null; cpa: PublicMetric | null; reasonCodes: readonly string[];
}>;
export type CanonicalPerformanceReadProjection = Readonly<{
  version: typeof CANONICAL_PERFORMANCE_READ_VERSION; state: PerformanceState; accounts: readonly Readonly<{
    accountRef: string; name: string; currency: string | null; windows: readonly Window[]; campaigns: readonly Readonly<{ campaignRef: string; name: string; windows: readonly Window[] }>[];
  }>[];
  authority: Readonly<{ actionAuthority: "none"; canPublish: false; canApprove: false; canExecute: false; canWriteMeta: false }>;
}>;

function available(metric: MetaAggregatedMetric | undefined): PublicMetric | null {
  return metric?.status === "available" ? Object.freeze({ valueDecimal: metric.valueDecimal, ...(metric.currency ? { currency: metric.currency } : {}) }) : null;
}
function buildWindow(rows: readonly PerformanceSource[], days: 7 | 30): Window {
  const endDate = rows.map(({ row }) => row.dateStop).sort().at(-1) ?? null;
  if (!endDate) return Object.freeze({ days, state: "unavailable", startDate: null, endDate: null, observedDays: 0, missingDays: [], freshnessAt: null, attribution: null, currency: null, spend: null, outcome: null, cpa: null, reasonCodes: ["canonical_insights_empty"] });
  const startDate = shift(endDate, -(days - 1));
  const scoped = rows.filter(({ row }) => row.dateStart >= startDate && row.dateStop <= endDate && row.entityLevel === "campaign");
  const observed = new Set(scoped.map(({ row }) => row.dateStart));
  const missingDays = Array.from({ length: days }, (_, index) => shift(startDate, index)).filter((value) => !observed.has(value));
  const currencies = new Set(scoped.map(({ row }) => row.currency).filter((value): value is string => Boolean(value)));
  const attribution = new Set(scoped.map(({ row }) => row.attributionLabel));
  const freshnessAt = scoped.map(({ row }) => row.sourceUpdatedAt ?? null).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
  const reasons: string[] = [];
  if (missingDays.length) reasons.push("coverage_incomplete");
  if (currencies.size !== 1) reasons.push(currencies.size > 1 ? "mixed_currency" : "currency_unknown");
  if (attribution.size !== 1) reasons.push("attribution_mismatch");
  // Outcome is intentionally restricted to the exact Meta action type `lead`.
  const exactLeadRows = scoped.map(({ row }) => ({ ...row, metrics: row.metrics.filter((metric) => metric.metricKey === "spend" || metric.metricKey === "actions" && metric.actionType === "lead") }));
  const result = aggregateMetaMetrics({ rows: exactLeadRows, metrics: ["spendMinor", "leads", "cplMinor"] });
  const byMetric = new Map(result.metrics.map((metric) => [metric.metric, metric]));
  const safe = reasons.length === 0 && missingDays.length === 0;
  const spend = safe ? available(byMetric.get("spendMinor")) : null;
  const outcome = safe ? available(byMetric.get("leads")) : null;
  const cpa = safe ? available(byMetric.get("cplMinor")) : null;
  if (safe && !outcome) reasons.push("exact_lead_action_unavailable");
  if (safe && !cpa) reasons.push("exact_lead_cpa_unavailable");
  return Object.freeze({ days, state: !safe ? "partial" : spend ? "ready" : "partial", startDate, endDate, observedDays: observed.size,
    missingDays: Object.freeze(missingDays), freshnessAt, attribution: attribution.size === 1 ? [...attribution][0]! : null,
    currency: currencies.size === 1 ? [...currencies][0]! : null, spend, outcome, cpa, reasonCodes: Object.freeze(reasons.sort()) });
}

/** Public, source-backed aggregate. It has no comparison, recommendation or action semantics. */
export function buildCanonicalPerformanceReadModel(rows: readonly PerformanceSource[], workspaceId?: string): CanonicalPerformanceReadProjection {
  const scopedWorkspaceId = workspaceId ?? rows[0]?.row.workspaceId ?? null;
  if (rows.length && (!scopedWorkspaceId || rows.some((source) => source.row.workspaceId !== scopedWorkspaceId))) {
    throw new Error("canonical performance rejected: workspace_scope");
  }
  const accounts = new Map<string, PerformanceSource[]>();
  for (const source of rows) { const group = accounts.get(source.accountId) ?? []; group.push(source); accounts.set(source.accountId, group); }
  const accountRows = [...accounts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([accountId, sources]) => {
    const campaigns = new Map<string, PerformanceSource[]>();
    for (const source of sources) { const group = campaigns.get(source.campaignId) ?? []; group.push(source); campaigns.set(source.campaignId, group); }
    const campaignRows = [...campaigns.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([campaignId, campaignSources]) => Object.freeze({
      campaignRef: metaPublicReference("campaign", scopedWorkspaceId!, campaignId), name: campaignSources[0]!.campaignName,
      windows: Object.freeze([buildWindow(campaignSources, 7), buildWindow(campaignSources, 30)]),
    }));
    const windows = Object.freeze([buildWindow(sources, 7), buildWindow(sources, 30)]);
    return Object.freeze({ accountRef: metaPublicReference("account", scopedWorkspaceId!, accountId), name: sources[0]!.accountName,
      currency: new Set(sources.map(({ row }) => row.currency).filter(Boolean)).size === 1 ? sources[0]!.row.currency ?? null : null,
      windows, campaigns: Object.freeze(campaignRows) });
  });
  const state: PerformanceState = !accountRows.length ? "unavailable" : accountRows.every((account) => account.windows.every((window) => window.state === "ready")) ? "ready" : "partial";
  return Object.freeze({ version: CANONICAL_PERFORMANCE_READ_VERSION, state, accounts: Object.freeze(accountRows), authority: Object.freeze({ actionAuthority: "none", canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false }) });
}
