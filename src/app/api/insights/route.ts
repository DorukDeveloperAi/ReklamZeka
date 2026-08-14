import { NextResponse } from "next/server";
import { dashboardResponse } from "@/app/api/dashboard/route";
import type { DashboardState } from "@/app/dashboard/fixture-state";
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
  void request;
  return NextResponse.json({
    error: "Bu legacy demo endpoint'i kullanımdan kaldırıldı. Gerçek analiz kayıtları için /dashboard kullanın.",
    code: "legacy_demo_retired",
  }, { status: 410, headers: { "Cache-Control": "no-store" } });
}
