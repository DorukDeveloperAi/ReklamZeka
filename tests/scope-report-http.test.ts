import { describe, expect, it, vi } from "vitest";
import { createScopeReportHttpHandler, scopeReportCsv } from "@/server/scope-report-http";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const report = Object.freeze({ version: "scope-report/1.0.0", scope: { sliceRef: "slice_yerli", revisionRef: "slice_revision_yerli_1", revisionNumber: 1,
  definitionHash: "a".repeat(64), market: { dimensionRef: "dimension_market", valueRef: "category_yerli", key: "yerli" } },
  rows: [{ entityRef: "campaign_safe", entityLevel: "campaign", membership: "included", reason: "dynamic_filter", marketEvidenceRefs: ["assignment_safe"], matchedDimensionRefs: ["dimension_service"], matchedDimensionEvidenceRefs: ["assignment_service"] }],
  rawMetrics: [], pivot: [], coverage: [], appliedFilters: { entityLevel: null, metricKey: null, actionType: null, sort: "bucket", direction: "asc" },
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
    const response = await createScopeReportHttpHandler({ service: { read: vi.fn(async () => report) } as never, workspaceId: async () => workspaceId })(request("http://localhost/api/scope-report?slice=slice_yerli&start=2026-08-01&end=2026-08-02&format=csv"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toContain("attachment");
  });

  it("rejects cross-origin, bearer, arbitrary export, and missing slice requests fail-closed", async () => {
    const handler = createScopeReportHttpHandler({ service: { read: vi.fn() } as never, workspaceId: async () => workspaceId });
    expect((await handler(request("http://localhost/api/scope-report?slice=slice_yerli&start=2026-08-01&end=2026-08-02&format=xlsx"))).status).toBe(400);
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
  });
});
