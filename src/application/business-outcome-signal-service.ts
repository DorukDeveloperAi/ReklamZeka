import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import { createBusinessOutcomeSignalBatch, type BusinessOutcomeSignal, type BusinessOutcomeSignalBatch } from "@/analyses/business-outcome-signal";
import { authorizeWorkspace, type WorkspaceMembership } from "@/security/authorization";

export const BUSINESS_OUTCOME_SIGNAL_SERVICE_VERSION = "business-outcome-signal-service/1.0.0" as const;
export type BusinessOutcomeSignalCommand = Readonly<{ source: BusinessOutcomeSignalBatch["source"]; signals: readonly BusinessOutcomeSignal[] }>;
export type BusinessOutcomeSignalWriter = Readonly<{ record(input: Readonly<{ workspaceId: string; actorId: string; actorRef: string;
  role: "owner" | "admin" | "analyst"; batch: BusinessOutcomeSignalBatch; occurredAt: string }>): Promise<Readonly<{
    outcome: "inserted" | "unchanged"; batchId: string; summary: ReturnType<typeof import("@/analyses/business-outcome-signal").summarizeBusinessOutcomeSignals>;
    capabilities: Readonly<{ canPublish: false; canApprove: false; canExecute: false; canWriteMeta: false }>;
  }>> }>;

export function businessOutcomeSignalAuthority(role: WorkspaceMembership["role"]) {
  return Object.freeze({ canRecordEvidence: role !== "viewer", canPublish: false as const, canApprove: false as const,
    canExecute: false as const, canWriteMeta: false as const, canGrantApproval: false as const, metaProxyEligible: false as const });
}

/** Makes the batch identity, actor and clock server-owned without retaining raw CSV. */
export class BusinessOutcomeSignalService {
  constructor(private readonly writer: BusinessOutcomeSignalWriter, private readonly memberships: readonly WorkspaceMembership[], private readonly now = () => new Date()) {}
  async record(principal: TrustedDecisionRoomPrincipal, command: BusinessOutcomeSignalCommand) {
    const membership = authorizeWorkspace(principal.actor, principal.workspaceId, "business_outcome:record", this.memberships);
    const role = membership.role as "owner" | "admin" | "analyst";
    let batch: BusinessOutcomeSignalBatch;
    try { batch = createBusinessOutcomeSignalBatch(command); } catch { throw new Error("invalid_input"); }
    const result = await this.writer.record({ workspaceId: principal.workspaceId, actorId: principal.actor.userId, actorRef: principal.readerRef,
      role, batch, occurredAt: this.now().toISOString() });
    return Object.freeze({ contractVersion: BUSINESS_OUTCOME_SIGNAL_SERVICE_VERSION, ...result, authority: businessOutcomeSignalAuthority(role) });
  }
}
