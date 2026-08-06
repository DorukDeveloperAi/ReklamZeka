import { NextResponse } from "next/server";
import { dashboardResponse } from "@/app/api/dashboard/route";
import { parseDashboardState, type DashboardState } from "@/app/dashboard/fixture-state";
import type { PeriodDays } from "@/domain/ads/performance";
import { runInsightEngine } from "@/insights/rules";

export function insightsResponse(period: PeriodDays = 7, state: DashboardState = "ready") {
  const { snapshot } = dashboardResponse(period, state);
  const sourcePlatforms = [...new Set(snapshot.campaigns.map((campaign) => campaign.platform))];
  return runInsightEngine({
    id: `demo:${state}:${period}:${snapshot.asOf}`,
    workspaceId: "demo-workspace",
    sourcePlatforms: sourcePlatforms.length > 0 ? sourcePlatforms : ["demo_fixture"],
    performance: snapshot,
  });
}

export function GET(request: Request) {
  const url = new URL(request.url);
  const value = Number(url.searchParams.get("period") ?? "7");
  if (![7, 30, 90].includes(value)) return NextResponse.json({ error: "period 7, 30 veya 90 olmalıdır" }, { status: 400 });
  const rawState = url.searchParams.get("state");
  const state = parseDashboardState(rawState);
  if (rawState && rawState !== state) return NextResponse.json({ error: "Geçersiz dashboard durumu" }, { status: 400 });
  return NextResponse.json({ insights: insightsResponse(value as PeriodDays, state) });
}
