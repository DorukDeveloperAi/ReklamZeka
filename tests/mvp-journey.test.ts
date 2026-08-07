import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dashboardResponse } from "@/app/api/dashboard/route";
import { insightsResponse } from "@/app/api/insights/route";
import { CsvAdConnector } from "@/connectors/csv";
import { InMemoryMetricStore } from "@/ingest/idempotent-store";
import { runIngest } from "@/ingest/run-ingest";
import { InsightFeedbackService } from "@/insights/feedback";
import { buildSharedReport, ShareLinkService } from "@/reports/share";
import type { WorkspaceMembership } from "@/security/authorization";
import { AppendOnlyAuditLog } from "@/security/audit";

describe("MVP technical journey", () => {
  it("runs connector → dashboard → insight → feedback → read-only share", async () => {
    const csv = readFileSync(new URL("./fixtures/ads.csv", import.meta.url), "utf8");
    const store = new InMemoryMetricStore();
    const ingest = await runIngest(new CsvAdConnector(csv), store, "workspace-a");
    expect(ingest).toMatchObject({ completed: true, inserted: 1 });

    const performance = dashboardResponse(7, "delayed").snapshot;
    const insights = insightsResponse(7, "delayed");
    expect(performance.current.spendMinor).toBeGreaterThan(0);
    expect(insights.map((insight) => insight.ruleId)).toContain("data-delay");

    const memberships: readonly WorkspaceMembership[] = [
      { userId: "analyst-a", workspaceId: "workspace-a", role: "analyst" },
    ];
    const audit = new AppendOnlyAuditLog();
    const feedback = new InsightFeedbackService(memberships, audit);
    expect(feedback.record({ userId: "analyst-a" }, {
      workspaceId: "workspace-a",
      insightId: insights[0]!.id,
      insightVersion: insights[0]!.calculationVersion,
      value: "helpful",
      recordedAt: "2026-08-06T12:10:00Z",
    }).outcome).toBe("inserted");

    const sharing = new ShareLinkService(randomBytes(32));
    const token = sharing.createAuthorized({ userId: "analyst-a" }, memberships, audit, {
      shareId: "share-journey", workspaceId: "workspace-a", snapshotId: "snapshot-journey",
      expiresAt: "2026-08-07T12:00:00Z",
    }, "2026-08-06T12:15:00Z");
    const claims = sharing.verify(token, "2026-08-06T12:20:00Z");
    const report = buildSharedReport(claims, "snapshot-journey", performance, insights);
    expect(report.metrics).toEqual(performance.current);
    expect(report.access).toBe("read_only");
    expect(audit.list("workspace-a").map((event) => event.action)).toEqual([
      "insight.feedback", "report.shared",
    ]);
  });
});
