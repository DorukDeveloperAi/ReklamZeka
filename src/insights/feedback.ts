import { authorizeWorkspace, type Actor, type WorkspaceMembership } from "@/security/authorization";
import type { AppendOnlyAuditLog } from "@/security/audit";

export type InsightFeedbackValue = "helpful" | "unhelpful" | "acted";
export type InsightFeedback = Readonly<{
  workspaceId: string;
  insightId: string;
  insightVersion: string;
  userId: string;
  value: InsightFeedbackValue;
  recordedAt: string;
}>;

export class InsightFeedbackService {
  private readonly records = new Map<string, InsightFeedback>();

  constructor(private readonly memberships: readonly WorkspaceMembership[], private readonly audit: AppendOnlyAuditLog) {}

  record(actor: Actor, input: Omit<InsightFeedback, "userId">): Readonly<{ outcome: "inserted" | "updated" | "unchanged"; feedback: InsightFeedback }> {
    authorizeWorkspace(actor, input.workspaceId, "insight:feedback", this.memberships);
    const key = `${input.workspaceId}|${input.insightId}|${actor.userId}`;
    const feedback: InsightFeedback = { ...input, userId: actor.userId };
    const current = this.records.get(key);
    if (current && current.value === feedback.value && current.insightVersion === feedback.insightVersion) {
      return { outcome: "unchanged", feedback: current };
    }
    const outcome = current ? "updated" : "inserted";
    this.records.set(key, feedback);
    this.audit.append({
      workspaceId: input.workspaceId,
      actorId: actor.userId,
      action: "insight.feedback",
      resourceType: "insight",
      resourceId: input.insightId,
      occurredAt: input.recordedAt,
      metadata: { value: input.value, insightVersion: input.insightVersion, outcome },
    });
    return { outcome, feedback };
  }

  list(workspaceId: string): readonly InsightFeedback[] {
    return [...this.records.values()].filter((record) => record.workspaceId === workspaceId).map((record) => ({ ...record }));
  }
}
