import { describe, expect, it } from "vitest";
import { InsightFeedbackService } from "@/insights/feedback";
import { AuthorizationError, type WorkspaceMembership } from "@/security/authorization";
import { AppendOnlyAuditLog } from "@/security/audit";

const memberships: readonly WorkspaceMembership[] = [
  { userId: "analyst-a", workspaceId: "workspace-a", role: "analyst" },
  { userId: "viewer-a", workspaceId: "workspace-a", role: "viewer" },
  { userId: "analyst-b", workspaceId: "workspace-b", role: "analyst" },
];

describe("insight feedback", () => {
  it("is authorized, version-bound and idempotent", () => {
    const audit = new AppendOnlyAuditLog();
    const service = new InsightFeedbackService(memberships, audit);
    const input = {
      workspaceId: "workspace-a",
      insightId: "conversion-drop:v1:snapshot-a",
      insightVersion: "insight-engine/1.0.0",
      value: "helpful" as const,
      recordedAt: "2026-08-06T12:00:00Z",
    };
    expect(service.record({ userId: "analyst-a" }, input).outcome).toBe("inserted");
    expect(service.record({ userId: "analyst-a" }, input).outcome).toBe("unchanged");
    expect(service.list("workspace-a")).toHaveLength(1);
    expect(audit.list("workspace-a")).toHaveLength(1);
    expect(service.record({ userId: "analyst-a" }, { ...input, value: "acted", recordedAt: "2026-08-06T13:00:00Z" }).outcome).toBe("updated");
    expect(audit.list("workspace-a")).toHaveLength(2);
  });

  it("rejects viewers and cross-tenant actors", () => {
    const service = new InsightFeedbackService(memberships, new AppendOnlyAuditLog());
    const input = {
      workspaceId: "workspace-a",
      insightId: "insight-a",
      insightVersion: "insight-engine/1.0.0",
      value: "unhelpful" as const,
      recordedAt: "2026-08-06T12:00:00Z",
    };
    expect(() => service.record({ userId: "viewer-a" }, input)).toThrow(AuthorizationError);
    expect(() => service.record({ userId: "analyst-b" }, input)).toThrow(AuthorizationError);
  });
});
