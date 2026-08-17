import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { parseScopeReport, ScopeReportPanel, scopeReportMatchesSubmitted } from "@/app/dashboard/scope-report-panel";

const report = Object.freeze({ version: "scope-report/1.0.0", scope: { sliceRef: "slice_yerli", revisionRef: "slice_revision_yerli_1", revisionNumber: 1, definitionHash: "a".repeat(64), market: { dimensionRef: "dimension_market", valueRef: "category_yerli", key: "yerli" } }, rows: [{ entityRef: "campaign_public", entityLevel: "campaign", membership: "included", reason: "dynamic_filter", marketEvidenceRefs: ["assignment_market"], matchedDimensionRefs: [], matchedDimensionEvidenceRefs: [] }], rawMetrics: [], pivot: [], coverage: [], appliedFilters: { granularity: "day", startDate: "2026-08-01", endDate: "2026-08-02", entityLevel: null, metricKey: null, actionType: null, sort: "bucket", direction: "asc" }, counts: { included: 1, excluded: 0, missingMarket: 0, ambiguousMarket: 0 }, authority: { canWriteMeta: false, canExecute: false, canApprove: false } } as const);

describe("scope report dashboard panel", () => {
  it("accepts only the public, read-only scope report contract", () => {
    expect(parseScopeReport(report)?.scope.sliceRef).toBe("slice_yerli");
    expect(parseScopeReport({ ...report, authority: { canWriteMeta: true, canExecute: false, canApprove: false } })).toBeNull();
    expect(parseScopeReport({ ...report, scope: { ...report.scope, sliceRef: "workspace_internal" } })).toBeNull();
    expect(parseScopeReport({ ...report, rows: [{ ...report.rows[0], membership: "pending" }] })).toBeNull();
    expect(parseScopeReport({ ...report, scope: { ...report.scope, market: { key: "yerli" } } })).toBeNull();
    expect(parseScopeReport({ ...report, counts: { included: "1", excluded: 0, missingMarket: 0, ambiguousMarket: 0 } })).toBeNull();
    expect(parseScopeReport({ ...report, pivot: [{ entityRef: "campaign_public" }] })).toBeNull();
    expect(parseScopeReport({ ...report, rows: [{ ...report.rows[0], entityLevel: "organization_campaign" }] })?.rows[0]?.entityLevel).toBe("organization_campaign");
    expect(parseScopeReport({ ...report, appliedFilters: { ...report.appliedFilters, metricKey: true } })).toBeNull();
    for (const field of ["marketEvidenceRefs", "matchedDimensionRefs", "matchedDimensionEvidenceRefs"] as const) {
      expect(parseScopeReport({ ...report, rows: [{ ...report.rows[0], [field]: ["11111111-1111-4111-8111-111111111111"] }] })).toBeNull();
      expect(parseScopeReport({ ...report, rows: [{ ...report.rows[0], [field]: ["raw internal id"] }] })).toBeNull();
    }
  });

  it("binds a valid response to the exact submitted slice and filter snapshot", () => {
    const submitted = { slice: "slice_yerli", start: "2026-08-01", end: "2026-08-02", granularity: "day", level: "", metric: "", action: "", sort: "bucket", direction: "asc" } as const;
    expect(scopeReportMatchesSubmitted(report, submitted)).toBe(true);
    expect(scopeReportMatchesSubmitted({ ...report, scope: { ...report.scope, sliceRef: "slice_other" } }, submitted)).toBe(false);
    expect(scopeReportMatchesSubmitted({ ...report, appliedFilters: { ...report.appliedFilters, endDate: "2026-08-03" } }, submitted)).toBe(false);
    expect(scopeReportMatchesSubmitted({ ...report, appliedFilters: { ...report.appliedFilters, metricKey: "spend" } }, submitted)).toBe(false);
  });

  it("renders a table-first, keyboard-native request surface without fake data or saved-report claims", () => {
    const html = renderToStaticMarkup(createElement(ScopeReportPanel, { onConnect: vi.fn(async () => true) }));
    expect(html).toContain("Kapsam raporu");
    expect(html).toContain("Slice public ref");
    expect(html).toContain("Raporu getir");
    expect(html).toContain("Bu yüzey kaydedilmiş rapor oluşturmaz");
    expect(html).toContain('type="date"');
    expect(html).not.toContain("demo");
  });

  it("keeps the narrow viewport and focus-visible structural contract", () => {
    const css = require("node:fs").readFileSync("src/app/dashboard/scope-report-panel.module.css", "utf8");
    expect(css).toContain("@media (max-width:360px)");
    expect(css).toContain(":focus-visible");
    expect(css).toContain("overflow-x:auto");
  });

  it("keeps result tables keyboard reachable with scoped headers and uses no duplicate IDs", () => {
    const source = require("node:fs").readFileSync("src/app/dashboard/scope-report-panel.tsx", "utf8");
    expect(source).toContain('role="status" aria-live="polite"');
    expect(source).toContain('role="region" aria-label="Public üyelik kanıtı tablosu" tabIndex={0}');
    expect(source).toContain('role="region" aria-label="Pivot ve drill özeti tablosu" tabIndex={0}');
    expect(source).toContain('role="region" aria-label="Ham metrik kanıtı tablosu" tabIndex={0}');
    expect((source.match(/scope="col"/g) ?? []).length).toBe(16);
    expect((source.match(/id="scope-report-help"/g) ?? []).length).toBe(1);
    expect(source).toContain('idPrefix="scope-report-session"');
    expect(source).toContain('const sequence = ++requestSequence.current');
    expect(source).toContain('query(submitted, format)');
    expect(source).toContain('scopeReportMatchesSubmitted(parsed, submitted)');
    expect(source).toContain('metric.bucket === row.drill.bucket');
    expect(require("node:fs").readFileSync("src/app/dashboard/scope-report-panel.module.css", "utf8")).toContain("overflow-wrap:anywhere");
    expect(require("node:fs").readFileSync("src/app/dashboard/scope-report-panel.module.css", "utf8")).toContain("min-width:0");
    expect(source).toContain("exportAbort.current?.abort()");
    expect(source).toContain("signal: controller.signal");
  });
});
