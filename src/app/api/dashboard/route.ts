import { NextResponse } from "next/server";
import { dashboardStateView, type DashboardState } from "@/app/dashboard/fixture-state";
import { buildPerformanceSnapshot, type PeriodDays } from "@/domain/ads/performance";

export function dashboardResponse(period: PeriodDays = 7, state: DashboardState = "ready") {
  const fixture = dashboardStateView(state);
  return { fixture: { ...fixture, metrics: undefined }, snapshot: buildPerformanceSnapshot(fixture.metrics, period, "2026-08-06T12:00:00.000Z") };
}

export function GET(request: Request) {
  void request;
  return NextResponse.json({
    error: "Bu legacy demo endpoint'i kullanımdan kaldırıldı. Gerçek kaynak için /dashboard kullanın.",
    code: "legacy_demo_retired",
  }, { status: 410, headers: { "Cache-Control": "no-store" } });
}
