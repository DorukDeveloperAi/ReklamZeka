import { NextResponse } from "next/server";
import type { ScopeReportReadService } from "@/application/scope-report-read-service";
import type { ScopeReport } from "@/domain/slices/scope-report";
import { scopeReportXlsx } from "@/server/scope-report-xlsx";

const headers = Object.freeze({
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
  "X-ReklamZeka-Access-Mode": "read-only",
  "X-ReklamZeka-Action-Authority": "none",
  "X-ReklamZeka-Meta-Write": "disabled",
});
const error = (status: number, code: string) => NextResponse.json({ error: { code } }, { status, headers });
export const scopeReportUnavailable = () => NextResponse.json(
  { error: { code: "source_unavailable", message: "Kapsam Raporu kaynağı kullanılamıyor." } },
  { status: 503, headers },
);
export const scopeReportSessionRequired = () => error(401, "local_session_required");
export const scopeReportForbidden = () => error(403, "forbidden");
export const scopeReportInvalidInput = () => error(400, "invalid_input");

type Input = Readonly<{ slice?: string; start?: string; end?: string; granularity?: "day" | "week" | "month"; level?: "campaign" | "ad_set"; metric?: string; action?: string; sort?: "bucket" | "entity" | "metric"; direction?: "asc" | "desc" }>;
type Format = "json" | "csv" | "xlsx";
const SLICE = /^slice_[a-z0-9][a-z0-9_.:-]{0,190}$/;
export function scopeReportRequestInput(request: Request): Readonly<{ input: Input; format: Format }> | null {
  let url: URL;
  try { url = new URL(request.url); } catch { return null; }
  if (request.method !== "GET" || request.headers.has("authorization")
    || request.headers.get("sec-fetch-site") !== "same-origin"
    || request.headers.get("x-reklamzeka-intent") !== "scope-report-read"
    || [...url.searchParams.keys()].some((key) => !["slice", "format", "start", "end", "granularity", "level", "metric", "action", "sort", "direction"].includes(key))
    || [...url.searchParams.keys()].some((key, index, keys) => keys.indexOf(key) !== index)) return null;
  const format = url.searchParams.get("format") ?? "json";
  const slice = url.searchParams.get("slice");
  const start = url.searchParams.get("start"), end = url.searchParams.get("end"), granularity = url.searchParams.get("granularity") ?? "day";
  const level = url.searchParams.get("level"), metric = url.searchParams.get("metric"), action = url.searchParams.get("action"), sort = url.searchParams.get("sort") ?? "bucket", direction = url.searchParams.get("direction") ?? "asc";
  return (format === "json" || format === "csv" || format === "xlsx") && slice !== null && SLICE.test(slice)
    && /^\d{4}-\d{2}-\d{2}$/.test(start ?? "") && /^\d{4}-\d{2}-\d{2}$/.test(end ?? "") && start! <= end!
    && (granularity === "day" || granularity === "week" || granularity === "month")
    && (level === null || level === "campaign" || level === "ad_set") && (metric === null || /^[a-z][a-z0-9_:-]{0,80}$/.test(metric)) && (action === null || /^[a-z][a-z0-9_:-]{0,80}$/.test(action))
    && (sort === "bucket" || sort === "entity" || sort === "metric") && (direction === "asc" || direction === "desc")
    ? Object.freeze({ input: { slice, start: start!, end: end!, granularity: granularity as "day" | "week" | "month", level: level === null ? undefined : level as "campaign" | "ad_set", metric: metric ?? undefined, action: action ?? undefined,
      sort: sort as "bucket" | "entity" | "metric", direction: direction as "asc" | "desc" }, format }) : null;
}
function csvCell(value: string | number): string {
  const text = String(value).replace(/[\r\n]/g, " ");
  // Spreadsheet formula syntax is data, never executable export content.
  const escaped = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${escaped.replaceAll('"', '""')}"`;
}
export function scopeReportCsv(report: ScopeReport): string {
  const header = ["row_type", "context_key", "context_value", "entity_ref", "entity_level", "bucket", "date", "attribution", "metric_key", "action_type", "value_decimal", "value_minor", "currency", "availability", "membership", "reason", "market_evidence_refs", "matched_dimension_refs", "matched_dimension_evidence_refs"];
  const context = [["version", report.version], ["slice_ref", report.scope.sliceRef], ["revision_ref", report.scope.revisionRef], ["granularity", report.appliedFilters.granularity], ["start_date", report.appliedFilters.startDate ?? ""], ["end_date", report.appliedFilters.endDate ?? ""]]
    .map(([key, value]) => ["context", key ?? "", value ?? "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""].map(csvCell).join(","));
  const memberships = report.rows.map((row) => ["membership", "", "", row.entityRef, row.entityLevel, "", "", "", "", "", "", "", "", "", row.membership, row.reason,
    row.marketEvidenceRefs.join(" "), row.matchedDimensionRefs.join(" "), row.matchedDimensionEvidenceRefs.join(" ")]
    .map(csvCell).join(","));
  const metrics = report.rawMetrics.map((row) => ["metric", "", "", row.entityRef, row.entityLevel, row.bucket, row.date, row.attribution, row.metricKey, row.actionType ?? "", row.valueDecimal ?? "", row.valueMinor ?? "", row.currency ?? "", row.availability, "", "", "", "", ""].map(csvCell).join(","));
  const body = [...context, ...memberships, ...metrics];
  return `${header.map(csvCell).join(",")}\r\n${body.join("\r\n")}${body.length ? "\r\n" : ""}`;
}
function rejected(reason: unknown): boolean {
  return reason instanceof Error && reason.message.startsWith("scope report rejected:");
}
export function createScopeReportHttpHandler(input: Readonly<{
  service: Pick<ScopeReportReadService, "read">;
  workspaceId(request: Request): Promise<string | null>;
}>) {
  return async (request: Request) => {
    const parsed = scopeReportRequestInput(request);
    if (!parsed) return scopeReportInvalidInput();
    if (!request.headers.get("cookie")) return scopeReportSessionRequired();
    try {
      const workspaceId = await input.workspaceId(request);
      if (!workspaceId) return scopeReportForbidden();
      const report = await input.service.read(workspaceId, parsed.input);
      return parsed.format === "csv"
        ? new NextResponse(scopeReportCsv(report), { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=scope-report.csv" } })
        : parsed.format === "xlsx"
          ? new NextResponse(scopeReportXlsx(report).buffer as ArrayBuffer, { headers: { ...headers, "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": "attachment; filename=scope-report.xlsx" } })
        : NextResponse.json(report, { headers });
    } catch (reason) {
      return rejected(reason) ? scopeReportInvalidInput() : scopeReportUnavailable();
    }
  };
}
