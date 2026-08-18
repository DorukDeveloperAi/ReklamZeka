import { createHash } from "node:crypto";
import { createBudgetCeilingPolicy, type BudgetCeilingPolicy, type BudgetCeilingPolicyDraft } from "@/domain/budget/budget-ceiling-policy";
import { canonicalGuideWorkspaceRef } from "@/domain/guides/guide-revision";

export type PublishBudgetCeilingPolicyInput = Readonly<{ workspaceId: string }> & Omit<BudgetCeilingPolicyDraft, "workspaceRef" | "publishedByActorRef" | "publishedAt">;
export interface BudgetCeilingPolicyRevisionPort {
  append(input: Readonly<{ workspaceId: string; actorId: string; policy: BudgetCeilingPolicy }>): Promise<Readonly<{ outcome: "inserted" | "unchanged"; auditAppended: boolean }>>;
}
export class BudgetCeilingPolicyServiceError extends Error {
  constructor(readonly code: "invalid_input" | "persistence_rejected") { super(`Bütçe ceiling yayını reddedildi: ${code}`); }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const budgetCeilingPublisherRef = (actorId: string): string => {
  if (!UUID.test(actorId)) throw new BudgetCeilingPolicyServiceError("invalid_input");
  return `user_${createHash("sha256").update(actorId).digest("hex").slice(0, 24)}`;
};

export class BudgetCeilingPolicyService {
  constructor(private readonly revisions: BudgetCeilingPolicyRevisionPort, private readonly now: () => string = () => new Date().toISOString()) {}
  async publish(actorId: string, input: PublishBudgetCeilingPolicyInput) {
    if (!UUID.test(actorId) || !input || typeof input !== "object") throw new BudgetCeilingPolicyServiceError("invalid_input");
    let policy: BudgetCeilingPolicy;
    try { const { workspaceId, ...draft } = input; policy = createBudgetCeilingPolicy({ ...draft, workspaceRef: canonicalGuideWorkspaceRef(workspaceId), publishedByActorRef: budgetCeilingPublisherRef(actorId), publishedAt: this.now() }); }
    catch { throw new BudgetCeilingPolicyServiceError("invalid_input"); }
    let persisted;
    try { persisted = await this.revisions.append({ workspaceId: input.workspaceId, actorId, policy }); }
    catch { throw new BudgetCeilingPolicyServiceError("persistence_rejected"); }
    return Object.freeze({ version: "budget-ceiling-policy-publication/1.0.0" as const, policy, persistence: persisted.outcome,
      auditAppended: persisted.auditAppended, authority: Object.freeze({ canApprove: false as const, canExecute: false as const, canWriteMeta: false as const }) });
  }
}
