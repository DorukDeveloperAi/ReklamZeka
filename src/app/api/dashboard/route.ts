import { NextResponse } from "next/server";
import { dashboardStateView, parseDashboardState, type DashboardState } from "@/app/dashboard/fixture-state";
import { buildPerformanceSnapshot, type PeriodDays } from "@/domain/ads/performance";

export function dashboardResponse(period: PeriodDays = 7, state: DashboardState = "ready") {
  const fixture = dashboardStateView(state);
  return { fixture: { ...fixture, metrics: undefined }, snapshot: buildPerformanceSnapshot(fixture.metrics, period, "2026-08-06T12:00:00.000Z") };
}

export function GET(request: Request) {
  const url = new URL(request.url);
  const value = Number(url.searchParams.get("period") ?? "7");
  if (![7, 30, 90].includes(value)) return NextResponse.json({ error: "period 7, 30 veya 90 olmalıdır" }, { status: 400 });
  const rawState = url.searchParams.get("state");
  const state = parseDashboardState(rawState);
  if (rawState && rawState !== state) return NextResponse.json({ error: "Geçersiz dashboard durumu" }, { status: 400 });
  return NextResponse.json(dashboardResponse(value as PeriodDays, state));
}
