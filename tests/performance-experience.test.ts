import { describe, expect, it } from "vitest";
import { dashboardResponse, GET } from "@/app/api/dashboard/route";
import { DEMO_METRICS } from "@/app/dashboard/demo-data";
import { DASHBOARD_STATES, dashboardStateView } from "@/app/dashboard/fixture-state";
import { buildPerformanceSnapshot } from "@/domain/ads/performance";

describe("performance dashboard contract", () => {
  it("keeps UI/API totals on the canonical golden snapshot", () => {
    const direct = buildPerformanceSnapshot(DEMO_METRICS, 7, "2026-08-06T12:00:00.000Z");
    const api = dashboardResponse(7);
    expect(api.snapshot).toEqual(direct);
    expect(api.snapshot.current).toMatchObject({
      spendMinor: 69_500,
      impressions: 69_000,
      clicks: 3_170,
      conversions: 125,
      conversionValueMinor: 424_000,
    });
    expect(api.snapshot.campaigns).toHaveLength(2);
    expect(api.snapshot.freshness).toMatchObject({ status: "fresh", hours: 3.5 });
  });

  it("keeps the fixture-only API retired instead of publishing demo metrics", async () => {
    const response = GET(new Request("http://localhost/api/dashboard?period=7"));
    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      code: "legacy_demo_retired",
      error: "Bu legacy demo endpoint'i kullanımdan kaldırıldı. Gerçek kaynak için /dashboard kullanın.",
    });
  });

  it("keeps activation, empty, partial, delayed and error states distinct", () => {
    expect(DASHBOARD_STATES).toEqual(["ready", "connecting", "syncing", "empty", "partial", "delayed", "error"]);
    const views = DASHBOARD_STATES.map(dashboardStateView);
    expect(new Set(views.map((view) => view.title)).size).toBe(views.length);
    expect(dashboardStateView("connecting")).toMatchObject({ showPerformance: false, liveRole: "status" });
    expect(dashboardStateView("partial")).toMatchObject({ showPerformance: true, liveRole: "alert", tone: "warning" });
    expect(dashboardResponse(7, "delayed").snapshot.freshness.status).toBe("delayed");
    expect(dashboardResponse(7, "error").snapshot.freshness.status).toBe("stale");
  });

  it("refuses to aggregate mixed currencies without an explicit FX rate", () => {
    const mixed = [{ ...DEMO_METRICS[0], currency: "USD" }, ...DEMO_METRICS.slice(1)];
    expect(() => buildPerformanceSnapshot(mixed, 7, "2026-08-06T12:00:00.000Z"))
      .toThrow(/Farklı para birimleri/);
  });
});
