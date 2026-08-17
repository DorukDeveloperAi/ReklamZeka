import { buildScopeReport, type ScopeReport, type ScopeReportMetricInput } from "@/domain/slices/scope-report";

const SLICE = /^slice_[a-z0-9][a-z0-9_.:-]{0,190}$/;
const MAX_DAYS = 366;
function calendarDate(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number), parsed = new Date(Date.UTC(year!, month! - 1, day!));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month! - 1 && parsed.getUTCDate() === day;
}
export type ScopeReportReadRepository = Readonly<{
  currentScopeReport(workspaceId: string, sliceRef: string, period: Readonly<{ startDate: string; endDate: string }>, actionType: string | null): Promise<Readonly<{ evidence: Parameters<typeof buildScopeReport>[0]; metrics: readonly ScopeReportMetricInput[] }>>;
}>;

/** Read-only Kapsam Raporu; canonical membership is owned by the P03 resolver. */
export class ScopeReportReadService {
  constructor(private readonly repository: ScopeReportReadRepository) {}
  async read(workspaceId: string, input: Readonly<{ slice?: string; start?: string; end?: string; granularity?: "day" | "week" | "month"; level?: "campaign" | "ad_set"; metric?: string; action?: string; sort?: "bucket" | "entity" | "metric"; direction?: "asc" | "desc" }>): Promise<ScopeReport> {
    if (!input || Object.keys(input).some((key) => !["slice", "start", "end", "granularity", "level", "metric", "action", "sort", "direction"].includes(key)) || !input.slice || !SLICE.test(input.slice)
      || !calendarDate(input.start) || !calendarDate(input.end) || input.start! > input.end!
      || (Date.parse(`${input.end}T00:00:00Z`) - Date.parse(`${input.start}T00:00:00Z`)) / 86_400_000 + 1 > MAX_DAYS
      || !["day", "week", "month"].includes(input.granularity ?? "day"))
      throw new Error("scope report rejected: input");
    if (!(input.level === undefined || input.level === "campaign" || input.level === "ad_set") || !(input.metric === undefined || /^[a-z][a-z0-9_:-]{0,80}$/.test(input.metric)) || !(input.action === undefined || /^[a-z][a-z0-9_:-]{0,80}$/.test(input.action))
      || !["bucket", "entity", "metric"].includes(input.sort ?? "bucket") || !["asc", "desc"].includes(input.direction ?? "asc")) throw new Error("scope report rejected: input");
    const loaded = await this.repository.currentScopeReport(workspaceId, input.slice, { startDate: input.start!, endDate: input.end! }, input.action ?? null);
    return buildScopeReport(loaded.evidence, loaded.metrics, { granularity: input.granularity ?? "day", entityLevel: input.level,
      metricKey: input.metric, actionType: input.action, sort: input.sort, direction: input.direction, startDate: input.start, endDate: input.end });
  }
}
