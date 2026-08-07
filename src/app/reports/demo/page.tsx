import { dashboardResponse } from "@/app/api/dashboard/route";
import { OperatingDashboard, type OperatingDashboardModel } from "@/app/dashboard/operating-dashboard";

export const metadata = {
  robots: { index: false, follow: false },
};

export default function DemoReportPage() {
  const snapshot = dashboardResponse(7, "ready").snapshot;
  const current = snapshot.current;
  const model: OperatingDashboardModel = {
    periodDays: 7,
    spend: new Intl.NumberFormat("tr-TR", { style: "currency", currency: snapshot.currency, maximumFractionDigits: 0 }).format(current.spendMinor / 100),
    conversions: current.conversions,
    cpa: current.cpaMinor === null ? "—" : new Intl.NumberFormat("tr-TR", { style: "currency", currency: snapshot.currency, maximumFractionDigits: 2 }).format(current.cpaMinor / 100),
    roas: current.roas === null ? "—" : `${current.roas.toFixed(2)}×`,
    freshnessHours: snapshot.freshness.hours ?? 0,
    freshnessLabel: "güncel",
    currency: snapshot.currency,
    timezone: snapshot.timezone,
    attribution: snapshot.attributionLabels.join(" · "),
  };
  return <OperatingDashboard model={model} />;
}
