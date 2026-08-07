import { dashboardResponse } from "@/app/api/dashboard/route";
import { parseDashboardState } from "@/app/dashboard/fixture-state";
import { type PeriodDays } from "@/domain/ads/performance";
import { OperatingDashboard, type OperatingDashboardModel } from "./operating-dashboard";

function money(value: number, currency: string) {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency, maximumFractionDigits: 0 }).format(value / 100);
}

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ period?: string; state?: string }> }) {
  const params = await searchParams;
  const parsed = Number(params.period ?? "7");
  const period = ([7, 30, 90].includes(parsed) ? parsed : 7) as PeriodDays;
  const state = parseDashboardState(params.state);
  const { snapshot } = dashboardResponse(period, state);
  const current = snapshot.current;
  const model: OperatingDashboardModel = {
    periodDays: period,
    spend: money(current.spendMinor, snapshot.currency),
    conversions: current.conversions,
    cpa: current.cpaMinor === null ? "—" : money(current.cpaMinor, snapshot.currency),
    roas: current.roas === null ? "—" : `${current.roas.toFixed(2)}×`,
    freshnessHours: snapshot.freshness.hours ?? 0,
    freshnessLabel: snapshot.freshness.status === "fresh" ? "güncel" : snapshot.freshness.status === "delayed" ? "gecikmiş" : "eski",
    currency: snapshot.currency,
    timezone: snapshot.timezone,
    attribution: snapshot.attributionLabels.join(" · "),
  };
  return <OperatingDashboard model={model} />;
}
