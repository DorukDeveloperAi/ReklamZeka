import Link from "next/link";
import { dashboardResponse } from "@/app/api/dashboard/route";
import { DASHBOARD_STATES, parseDashboardState } from "@/app/dashboard/fixture-state";
import { insightsResponse } from "@/app/api/insights/route";
import { percentageChange, type MetricTotals, type PeriodDays } from "@/domain/ads/performance";

function money(value: number, currency: string) {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency, maximumFractionDigits: 0 }).format(value / 100);
}

function changeLabel(current: number, previous: number) {
  const change = percentageChange(current, previous);
  return change === null ? "Önceki dönem verisi yok" : `${change >= 0 ? "+" : ""}${new Intl.NumberFormat("tr-TR", { style: "percent", maximumFractionDigits: 1 }).format(change)} önceki döneme göre`;
}

function MetricCard({ label, value, comparison }: { label: string; value: string; comparison: string }) {
  return <article className="metric-card"><span>{label}</span><strong>{value}</strong><small>{comparison}</small></article>;
}

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ period?: string; state?: string }> }) {
  const params = await searchParams;
  const parsed = Number(params.period ?? "7");
  const period = ([7, 30, 90].includes(parsed) ? parsed : 7) as PeriodDays;
  const state = parseDashboardState(params.state);
  const { fixture, snapshot } = dashboardResponse(period, state);
  const insights = insightsResponse(period, state);
  const current: MetricTotals = snapshot.current;
  return (
    <main className="dashboard-shell">
      <header className="dashboard-header">
        <div><span className="eyebrow">DEMO ÇALIŞMA ALANI</span><h1>Performans genel bakış</h1></div>
        <Link href="/" className="quiet-link">Ürün özeti</Link>
      </header>
      <nav aria-label="Rapor dönemi" className="period-tabs">
        {[7, 30, 90].map((days) => <Link key={days} href={`/dashboard?period=${days}&state=${state}`} aria-current={period === days ? "page" : undefined}>{days} gün</Link>)}
      </nav>
      <details className="fixture-switcher">
        <summary>Demo veri durumları</summary>
        <nav aria-label="Demo veri durumu">{DASHBOARD_STATES.map((item) => <Link key={item} href={`/dashboard?period=${period}&state=${item}`} aria-current={state === item ? "page" : undefined}>{dashboardResponse(period, item).fixture.label}</Link>)}</nav>
      </details>
      <section className="state-banner" data-tone={fixture.tone} aria-labelledby="state-title" role={fixture.liveRole}>
        <div><span className="state-label">{fixture.label}</span><h2 id="state-title">{fixture.title}</h2><p>{fixture.description}</p></div>
        {fixture.action ? <Link href={fixture.action.href}>{fixture.action.label}</Link> : null}
      </section>
      {fixture.showPerformance ? <>
      <section className="data-note" aria-label="Veri durumu">
        <span data-state={snapshot.freshness.status}>Veri {snapshot.freshness.status === "fresh" ? "taze" : snapshot.freshness.status === "delayed" ? "gecikmiş" : "eski"} · {Math.round(snapshot.freshness.hours ?? 0)} saat önce güncellendi</span>
        <span>{snapshot.currency} · {snapshot.timezone}</span>
        <span>{snapshot.attributionLabels.join(" · ")}</span>
      </section>
      <section className="metric-grid" aria-label="Temel metrikler">
        <MetricCard label="Harcama" value={money(current.spendMinor, snapshot.currency)} comparison={changeLabel(current.spendMinor, snapshot.previous.spendMinor)} />
        <MetricCard label="Dönüşüm" value={new Intl.NumberFormat("tr-TR").format(current.conversions)} comparison={changeLabel(current.conversions, snapshot.previous.conversions)} />
        <MetricCard label="CPA" value={current.cpaMinor === null ? "—" : money(current.cpaMinor, snapshot.currency)} comparison="Dönüşüm başına maliyet" />
        <MetricCard label="ROAS" value={current.roas === null ? "—" : `${current.roas.toFixed(2)}×`} comparison={changeLabel(current.conversionValueMinor, snapshot.previous.conversionValueMinor)} />
      </section>
      <section className="insight-panel" aria-labelledby="insight-title">
        <div><span className="eyebrow">AÇIKLANABİLİR İÇGÖRÜ</span><h2 id="insight-title">Dikkat isteyen değişimler</h2></div>
        {insights.length === 0 ? <p className="empty-insight" role="status">Bu snapshot için eşikleri aşan güvenilir bir sapma bulunmadı.</p> :
          <div className="insight-list">{insights.map((insight) => <article key={insight.id} className="insight-card" data-severity={insight.severity}>
            <div><span>{insight.severity === "critical" ? "Kritik" : "İncele"} · Güven %{Math.round(insight.confidence.score * 100)}</span><h3>{insight.title}</h3><p>{insight.explanation}</p></div>
            <dl><div><dt>Kanıt</dt><dd>{insight.evidence.metric}: {insight.evidence.current.toFixed(1)} / önceki {insight.evidence.previous.toFixed(1)}</dd></div><div><dt>Eşik</dt><dd>{insight.evidence.threshold}</dd></div><div><dt>Sonraki güvenli adım</dt><dd>{insight.recommendedAction}</dd></div></dl>
            <small>{insight.calculationVersion} · {insight.evidence.snapshotId}</small>
          </article>)}</div>}
      </section>
      <section className="campaign-panel" aria-labelledby="campaign-title">
        <div><span className="eyebrow">DRILL-DOWN</span><h2 id="campaign-title">Kampanyalar</h2></div>
        <div className="table-scroll" tabIndex={0} aria-label="Kampanya performansı kaydırılabilir tablo">
          <table><thead><tr><th>Kampanya</th><th>Kanal</th><th>Harcama</th><th>Dönüşüm</th><th>CPA</th><th>ROAS</th></tr></thead>
          <tbody>{snapshot.campaigns.map((campaign) => <tr key={campaign.id}><th scope="row">{campaign.name}</th><td>{campaign.platform === "meta_ads" ? "Meta Ads" : "Google Ads"}</td><td>{money(campaign.totals.spendMinor, snapshot.currency)}</td><td>{campaign.totals.conversions}</td><td>{campaign.totals.cpaMinor === null ? "—" : money(campaign.totals.cpaMinor, snapshot.currency)}</td><td>{campaign.totals.roas?.toFixed(2) ?? "—"}×</td></tr>)}</tbody></table>
        </div>
      </section>
      </> : null}
    </main>
  );
}
