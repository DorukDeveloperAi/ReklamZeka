import Link from "next/link";
import { dashboardResponse } from "@/app/api/dashboard/route";
import { insightsResponse } from "@/app/api/insights/route";

export const metadata = {
  robots: { index: false, follow: false },
};

function money(value: number) {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(value / 100);
}

export default function DemoReportPage() {
  const performance = dashboardResponse(7, "delayed").snapshot;
  const insights = insightsResponse(7, "delayed");
  return <main className="report-shell">
    <header className="report-header"><div><span className="eyebrow">SALT-OKUNUR RAPOR</span><h1>Demo Marka · 7 gün</h1></div><span className="readonly-badge">read_only</span></header>
    <section className="report-source" aria-label="Rapor kaynağı"><span>Snapshot: demo:delayed:7</span><span>{performance.currency} · {performance.timezone}</span><span>Veri {Math.round(performance.freshness.hours ?? 0)} saat önce güncellendi</span><span>24 saat sonra sona erer</span></section>
    <section className="pilot-metrics" aria-label="Rapor metrikleri"><article><span>Harcama</span><strong>{money(performance.current.spendMinor)}</strong></article><article><span>Dönüşüm</span><strong>{performance.current.conversions}</strong></article><article><span>ROAS</span><strong>{performance.current.roas?.toFixed(2)}×</strong></article></section>
    <section className="report-insights" aria-labelledby="report-insight-title"><span className="eyebrow">KANITLI BULGU</span><h2 id="report-insight-title">{insights[0]?.title}</h2><p>{insights[0]?.explanation}</p><p><strong>Öneri:</strong> {insights[0]?.recommendedAction}</p><small>{insights[0]?.calculationVersion} · {insights[0]?.evidence.snapshotId}</small></section>
    <footer className="report-footer"><span>Bu görünüm reklam hesabında değişiklik yapamaz.</span><Link href="/pilot?step=share">Pilot akışına dön</Link></footer>
  </main>;
}
