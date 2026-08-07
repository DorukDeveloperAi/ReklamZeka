import Link from "next/link";
import type { buildSharedReport } from "@/reports/share";

type SharedReport = ReturnType<typeof buildSharedReport>;

function money(value: number) {
  return new Intl.NumberFormat("tr-TR", { style: "currency", currency: "TRY", maximumFractionDigits: 0 }).format(value / 100);
}

export function ReportView({
  report,
  eyebrow,
  expiryText,
  csvHref,
  backHref = "/pilot?step=share",
}: {
  report: SharedReport;
  eyebrow: string;
  expiryText: string;
  csvHref?: string;
  backHref?: string;
}) {
  return <main className="report-shell">
    <header className="report-header"><div><span className="eyebrow">{eyebrow}</span><h1>Demo Marka · 7 gün</h1></div><span className="readonly-badge">read_only</span></header>
    <section className="report-source" aria-label="Rapor kaynağı"><span>Snapshot: {report.snapshotId}</span><span>{report.source.currency} · {report.source.timezone}</span><span>Veri {Math.round(report.source.freshness.hours ?? 0)} saat önce güncellendi</span><span>{expiryText}</span></section>
    <section className="pilot-metrics" aria-label="Rapor metrikleri"><article><span>Harcama</span><strong>{money(report.metrics.spendMinor)}</strong></article><article><span>Dönüşüm</span><strong>{report.metrics.conversions}</strong></article><article><span>ROAS</span><strong>{report.metrics.roas?.toFixed(2)}×</strong></article></section>
    <section className="report-insights" aria-labelledby="report-insight-title"><span className="eyebrow">KANITLI BULGU</span><h2 id="report-insight-title">{report.insights[0]?.title}</h2><p>{report.insights[0]?.explanation}</p><p><strong>Öneri:</strong> {report.insights[0]?.recommendedAction}</p><small>{report.insights[0]?.calculationVersion} · {report.insights[0]?.evidence.snapshotId}</small></section>
    <footer className="report-footer"><span>Bu görünüm reklam hesabında değişiklik yapamaz.</span><nav aria-label="Rapor işlemleri">{csvHref ? <a href={csvHref}>CSV indir</a> : null}<Link href={backHref}>Pilot akışına dön</Link></nav></footer>
  </main>;
}

export function ReportUnavailable({ reason }: { reason: "expired" | "revoked" | "invalid" | "configuration" }) {
  const message = reason === "expired"
    ? "Bu rapor bağlantısının süresi doldu."
    : reason === "revoked"
      ? "Bu rapor bağlantısı iptal edildi."
      : reason === "configuration"
        ? "Rapor paylaşım servisi yapılandırılmadı."
        : "Bu rapor bağlantısı geçerli değil.";
  return <main className="report-shell report-unavailable">
    <span className="eyebrow">RAPOR KULLANILAMIYOR</span>
    <h1>Güvenli erişim durduruldu.</h1>
    <p role="alert">{message}</p>
    <Link className="primary-link" href="/pilot?step=share">Pilot paylaşımına dön</Link>
  </main>;
}
