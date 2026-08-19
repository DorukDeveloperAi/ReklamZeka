import { describe, expect, it, vi } from "vitest";
import { createScopeReportHttpHandler, scopeReportCsv } from "@/server/scope-report-http";
import { MAX_SCOPE_REPORT_EXPORT_PACKAGE_BYTES, scopeReportSpreadsheetText, scopeReportXlsx, scopeReportXlsxPreflight } from "@/server/scope-report-xlsx";
import type { ScopeReport } from "@/domain/slices/scope-report";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const report = Object.freeze({ version: "scope-report/1.0.0", scope: { sliceRef: "slice_yerli", revisionRef: "slice_revision_yerli_1", revisionNumber: 1,
  definitionHash: "a".repeat(64), market: { dimensionRef: "dimension_market", valueRef: "category_yerli", key: "yerli" } },
  rows: [{ entityRef: "campaign_safe", entityLevel: "campaign", membership: "included", reason: "dynamic_filter", marketEvidenceRefs: ["assignment_safe"], matchedDimensionRefs: ["dimension_service"], matchedDimensionEvidenceRefs: ["assignment_service"] }],
  rawMetrics: [], pivot: [], coverage: [], appliedFilters: { granularity: "day", startDate: "2026-08-01", endDate: "2026-08-02", entityLevel: null, metricKey: null, actionType: null, sort: "bucket", direction: "asc" },
  counts: { included: 1, excluded: 0, missingMarket: 0, ambiguousMarket: 0 }, authority: { canWriteMeta: false, canExecute: false, canApprove: false } } as const);
const request = (url = "http://localhost/api/scope-report?slice=slice_yerli&start=2026-08-01&end=2026-08-02", headers: HeadersInit = {}) => new Request(url, { headers: { cookie: "local=x", "sec-fetch-site": "same-origin", "x-reklamzeka-intent": "scope-report-read", ...headers } });

describe("scope report HTTP boundary", () => {
  it("requires the same-origin local-session read contract and returns only the public report", async () => {
    const read = vi.fn(async () => report);
    const response = await createScopeReportHttpHandler({ service: { read } as never, workspaceId: async () => workspaceId })(request());
    expect(response.status).toBe(200);
    expect(read).toHaveBeenCalledWith(workspaceId, { slice: "slice_yerli", start: "2026-08-01", end: "2026-08-02", granularity: "day", level: undefined, metric: undefined, action: undefined, sort: "bucket", direction: "asc" });
    expect(response.headers.get("x-reklamzeka-meta-write")).toBe("disabled");
    expect(await response.json()).toEqual(report);
  });

  it("provides a bounded safe CSV export without spreadsheet formula execution", async () => {
    expect(scopeReportCsv({ ...report, rows: [{ ...report.rows[0], entityRef: " \t=not-a-formula\r\nsecond" }] })).toContain('"\' \t=not-a-formula  second"');
    expect(scopeReportCsv(report)).toContain('"context","granularity","day"');
    const response = await createScopeReportHttpHandler({ service: { read: vi.fn(async () => report) } as never, workspaceId: async () => workspaceId })(request("http://localhost/api/scope-report?slice=slice_yerli&start=2026-08-01&end=2026-08-02&format=csv"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toContain("attachment");
  });

  it("provides a deterministic formula-safe XLSX with public scope, raw, coverage, and pivot sheets", async () => {
    const unsafe: ScopeReport = { ...report, rows: [{ ...report.rows[0], entityRef: " \t=not-a-formula\r\nsecond" }] };
    const first = scopeReportXlsx(unsafe), second = scopeReportXlsx(unsafe);
    expect(Buffer.from(first).equals(Buffer.from(second))).toBe(true);
    expect(Buffer.from(first).subarray(0, 4).toString()).toBe("PK\u0003\u0004");
    expect(scopeReportSpreadsheetText(" \t=not-a-formula\r\nsecond")).toBe("' \t=not-a-formula  second");
    expect(Buffer.from(first).toString("utf8")).toContain("&apos; \t=not-a-formula  second");
    expect(Buffer.from(first).toString("utf8")).toContain("Raw Metrics");
    expect(Buffer.from(first).toString("utf8")).toContain("Coverage");
    expect(Buffer.from(first).toString("utf8")).toContain("Pivot");
    const response = await createScopeReportHttpHandler({ service: { read: vi.fn(async () => unsafe) } as never, workspaceId: async () => workspaceId })(request("http://localhost/api/scope-report?slice=slice_yerli&start=2026-08-01&end=2026-08-02&format=xlsx"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("spreadsheetml.sheet");
    expect(response.headers.get("content-disposition")).toContain("scope-report.xlsx");
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("sanitizes XML-forbidden scalars and rejects overlong cells or bounded export input", () => {
    expect(scopeReportSpreadsheetText(`safe\u0000\ufffe\uffff\ud800end`)).toBe("safe    end");
    expect(() => scopeReportSpreadsheetText("a".repeat(32_768))).toThrow("scope report rejected: export_cell_cap");
    const oversized: ScopeReport = { ...report, rawMetrics: Array.from({ length: 9_000 }, (_, index) => ({ entityRef: `campaign_${index}`, entityLevel: "campaign", bucket: "2026-08-01", date: "2026-08-01", attribution: "x".repeat(1_000), metricKey: "spend", actionType: null, valueDecimal: null, valueMinor: "1", currency: "TRY", availability: "available" as const })) };
    expect(() => scopeReportXlsx(oversized)).toThrow("scope report rejected: export_source_cap");
    const quoteHeavy: ScopeReport = { ...report, rawMetrics: Array.from({ length: 250 }, (_, index) => ({ entityRef: `campaign_${index}`, entityLevel: "campaign", bucket: "2026-08-01", date: "2026-08-01", attribution: '"'.repeat(32_767), metricKey: "spend", actionType: null, valueDecimal: null, valueMinor: "1", currency: "TRY", availability: "available" as const })) };
    // The exact preflight rejects escaping expansion before XML strings are joined.
    expect(() => scopeReportXlsxPreflight(quoteHeavy)).toThrow("scope report rejected: export_package_cap");
    const exact = scopeReportXlsxPreflight(report), output = scopeReportXlsx(report);
    expect(exact.packageBytes).toBe(output.length);
    expect(output.length).toBeLessThanOrEqual(MAX_SCOPE_REPORT_EXPORT_PACKAGE_BYTES);
  });

  it("rejects cross-origin, bearer, arbitrary export, and missing slice requests fail-closed", async () => {
    const handler = createScopeReportHttpHandler({ service: { read: vi.fn() } as never, workspaceId: async () => workspaceId });
    expect((await handler(request("http://localhost/api/scope-report?slice=slice_yerli&slice=slice_other&start=2026-08-01&end=2026-08-02"))).status).toBe(400);
    expect((await handler(request("http://localhost/api/scope-report?slice=slice_yerli", { authorization: "Bearer no" }))).status).toBe(400);
    expect((await handler(request("http://localhost/api/scope-report?slice=slice_yerli", { "sec-fetch-site": "cross-site" }))).status).toBe(400);
    expect((await handler(request("http://localhost/api/scope-report"))).status).toBe(400);
  });

  it("maps source failures to unavailable and malformed service input to invalid input", async () => {
    const unavailable = createScopeReportHttpHandler({ service: { read: vi.fn().mockRejectedValue(new Error("offline")) } as never, workspaceId: async () => workspaceId });
    expect((await unavailable(request())).status).toBe(503);
    const invalid = createScopeReportHttpHandler({ service: { read: vi.fn().mockRejectedValue(new Error("scope report rejected: input")) } as never, workspaceId: async () => workspaceId });
    expect((await invalid(request())).status).toBe(400);
    const overlong: ScopeReport = { ...report, rawMetrics: [{ entityRef: "campaign_safe", entityLevel: "campaign", bucket: "2026-08-01", date: "2026-08-01", attribution: "x".repeat(32_768), metricKey: "spend", actionType: null, valueDecimal: null, valueMinor: "1", currency: "TRY", availability: "available" }] };
    const exportRejected = createScopeReportHttpHandler({ service: { read: vi.fn(async () => overlong) } as never, workspaceId: async () => workspaceId });
    expect((await exportRejected(request("http://localhost/api/scope-report?slice=slice_yerli&start=2026-08-01&end=2026-08-02&format=xlsx"))).status).toBe(400);
  });
});
