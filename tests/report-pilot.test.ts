import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dashboardResponse } from "@/app/api/dashboard/route";
import { insightsResponse } from "@/app/api/insights/route";
import { OperationalMonitor } from "@/operations/monitor";
import { buildPilotReport, type PilotWorkspace } from "@/pilot/report";
import { buildSharedReport, reportCsv, ShareLinkError, ShareLinkService } from "@/reports/share";
import { AuthorizationError, type WorkspaceMembership } from "@/security/authorization";
import { AppendOnlyAuditLog } from "@/security/audit";

const pilot = JSON.parse(readFileSync(new URL("./fixtures/pilot.json", import.meta.url), "utf8")) as PilotWorkspace[];

describe("read-only report sharing", () => {
  it("keeps dashboard metrics, source and freshness under a signed expiring token", () => {
    const service = new ShareLinkService(randomBytes(32));
    const token = service.create({
      shareId: "share-a", workspaceId: "demo-workspace", snapshotId: "snapshot-a",
      expiresAt: "2026-08-06T13:00:00Z",
    }, "2026-08-06T12:00:00Z");
    const claims = service.verify(token, "2026-08-06T12:30:00Z");
    const performance = dashboardResponse(7, "delayed").snapshot;
    const report = buildSharedReport(claims, "snapshot-a", performance, insightsResponse(7, "delayed"));
    expect(report.access).toBe("read_only");
    expect(report.metrics).toEqual(performance.current);
    expect(report.source).toMatchObject({ currency: "TRY", freshness: { status: "delayed" } });
    expect(reportCsv(report)).toContain('"Yaz fırsatları","meta_ads"');
  });

  it("requires share permission and writes an audit event", () => {
    const memberships: readonly WorkspaceMembership[] = [
      { userId: "analyst-a", workspaceId: "workspace-a", role: "analyst" },
      { userId: "viewer-a", workspaceId: "workspace-a", role: "viewer" },
    ];
    const service = new ShareLinkService(randomBytes(32));
    const audit = new AppendOnlyAuditLog();
    const claims = { shareId: "share-b", workspaceId: "workspace-a", snapshotId: "snapshot-a", expiresAt: "2026-08-06T13:00:00Z" };
    expect(() => service.createAuthorized({ userId: "viewer-a" }, memberships, audit, claims, "2026-08-06T12:00:00Z"))
      .toThrow(AuthorizationError);
    service.createAuthorized({ userId: "analyst-a" }, memberships, audit, claims, "2026-08-06T12:00:00Z");
    expect(audit.list("workspace-a")[0]).toMatchObject({ action: "report.shared", resourceId: "share-b" });
  });

  it("rejects tampered, expired and revoked links", () => {
    const service = new ShareLinkService(randomBytes(32));
    const token = service.create({
      shareId: "share-a", workspaceId: "workspace-a", snapshotId: "snapshot-a",
      expiresAt: "2026-08-06T13:00:00Z",
    }, "2026-08-06T12:00:00Z");
    expect(() => service.verify(`${token.slice(0, -1)}x`, "2026-08-06T12:10:00Z")).toThrow(ShareLinkError);
    expect(() => service.verify(token, "2026-08-06T13:00:00Z")).toThrowError(expect.objectContaining({ code: "expired" }));
    service.revoke("share-a");
    expect(() => service.verify(token, "2026-08-06T12:10:00Z")).toThrowError(expect.objectContaining({ code: "revoked" }));
  });

  it("authorizes and audits revocation without recording the bearer token", () => {
    const memberships: readonly WorkspaceMembership[] = [
      { userId: "analyst-a", workspaceId: "workspace-a", role: "analyst" },
    ];
    const service = new ShareLinkService(randomBytes(32));
    const audit = new AppendOnlyAuditLog();
    const token = service.createAuthorized({ userId: "analyst-a" }, memberships, audit, {
      shareId: "share-revoke", workspaceId: "workspace-a", snapshotId: "snapshot-a",
      expiresAt: "2026-08-06T13:00:00Z",
    }, "2026-08-06T12:00:00Z");
    service.revokeAuthorized({ userId: "analyst-a" }, memberships, audit, token, "2026-08-06T12:10:00Z");
    expect(audit.list("workspace-a").map((event) => event.action)).toEqual(["report.shared", "report.revoked"]);
    expect(JSON.stringify(audit.list("workspace-a"))).not.toContain(token);
  });
});

describe("operational alarms", () => {
  it("opens the correct alarms with runbooks and resolves them after recovery", () => {
    const monitor = new OperationalMonitor();
    const opened = monitor.evaluate({
      at: "2026-08-06T12:00:00Z", syncLagMinutes: 90, syncAttempts: 10, syncFailures: 3,
      rateLimitRemainingRatio: 0.05, expectedInsights: true, insightsGenerated: 0,
    });
    expect(opened.map((alarm) => [alarm.code, alarm.status])).toEqual([
      ["insight_generation", "open"], ["rate_limit", "open"], ["sync_error_rate", "open"], ["sync_lag", "open"],
    ]);
    expect(opened.every((alarm) => alarm.runbook.length > 20)).toBe(true);
    const recovered = monitor.evaluate({
      at: "2026-08-06T12:30:00Z", syncLagMinutes: 10, syncAttempts: 10, syncFailures: 0,
      rateLimitRemainingRatio: 0.8, expectedInsights: true, insightsGenerated: 2,
    });
    expect(recovered.every((alarm) => alarm.status === "resolved")).toBe(true);
  });
});

describe("pilot measurement", () => {
  it("computes the declared readiness thresholds for 3 workspaces and 10 accounts", () => {
    const report = buildPilotReport(pilot, "2026-08-06T12:00:00Z", "fixture_readiness");
    expect(report).toMatchObject({
      mode: "fixture_readiness", workspaceCount: 3, accountCount: 10,
      freshWithin60MinutesRate: 1, medianActivationMinutes: 10.5,
      usefulOrActedRate: 9 / 12, openCriticalSecurityIncidents: 0, verdict: "pass",
    });
    expect(Object.values(report.thresholds).every(Boolean)).toBe(true);
  });
});
