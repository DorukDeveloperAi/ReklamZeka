import { notFound } from "next/navigation";
import { demoReportRuntime, isReportRuntimeConfigurationError } from "@/reports/demo-share";
import { isShareLinkError } from "@/reports/share";
import { ReportUnavailable, ReportView } from "../../report-view";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const metadata = { robots: { index: false, follow: false } };

export default async function SharedDemoReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  try {
    const report = demoReportRuntime().read(token, new Date().toISOString());
    const expiryText = `${new Intl.DateTimeFormat("tr-TR", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Istanbul" }).format(new Date(report.expiresAt))} tarihinde sona erer`;
    return <ReportView
      report={report}
      eyebrow="İMZALI SALT-OKUNUR RAPOR"
      expiryText={expiryText}
      csvHref={`/api/reports/shared/${encodeURIComponent(token)}/csv`}
    />;
  } catch (error) {
    if (isReportRuntimeConfigurationError(error)) return <ReportUnavailable reason="configuration" />;
    if (isShareLinkError(error)) notFound();
    throw error;
  }
}
