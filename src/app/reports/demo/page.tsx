import { dashboardResponse } from "@/app/api/dashboard/route";
import { insightsResponse } from "@/app/api/insights/route";
import { buildSharedReport } from "@/reports/share";
import { DEMO_REPORT_SNAPSHOT_ID, DEMO_REPORT_WORKSPACE_ID } from "@/reports/demo-share";
import { ReportView } from "../report-view";

export const metadata = {
  robots: { index: false, follow: false },
};

export default function DemoReportPage() {
  const performance = dashboardResponse(7, "delayed").snapshot;
  const insights = insightsResponse(7, "delayed");
  const report = buildSharedReport({
    shareId: "demo-preview",
    workspaceId: DEMO_REPORT_WORKSPACE_ID,
    snapshotId: DEMO_REPORT_SNAPSHOT_ID,
    expiresAt: "9999-12-31T23:59:59.999Z",
    access: "read_only",
  }, DEMO_REPORT_SNAPSHOT_ID, performance, insights);
  return <ReportView report={report} eyebrow="SALT-OKUNUR DEMO ÖNİZLEME" expiryText="Önizleme bağlantısı · süre uygulanmaz" />;
}
