import type { TrustedDecisionRoomPrincipal } from "@/application/decision-room-agent-contract";
import { authorizeWorkspace, type WorkspaceMembership } from "@/security/authorization";

export const INSTRUCTION_POLICY_IMPACT_VERSION = "instruction-policy-impact/1.0.0" as const;
export type InstructionPolicyImpactOperation = "publish" | "pause" | "archive";

export type InstructionPolicyImpact = Readonly<{
  impactHash: string;
  operation: InstructionPolicyImpactOperation;
  registryHash: string;
  target: Readonly<{ policyRef: string; policyVersion: number; policyHash: string;
    status: "draft" | "published" | "paused" | "archived" }>;
  exactBlockers: Readonly<{ currentInboundExceptions: number; enabledSchedules: number;
    nonTerminalActionUnits: number; activeManualLocks: number }>;
  historicalImpact: Readonly<{ historicalInboundExceptions: number; directAppliedContexts: number;
    directSuppressedContexts: number; directParkedContexts: number; alreadyInvalidatedContexts: number;
    budgetProposals: number; currentAnalysisTemplates: number; supersededAnalysisTemplates: number;
    runAssets: number; decisionLedgerRecords: number; terminalActionUnits: number;
    invalidatedTerminalActionUnits: number }>;
  invalidationPlan: Readonly<{ registryComponents: number; contextsNeedingInvalidation: number }>;
  coverage: Readonly<{ complete: boolean; manifestVersion: string; exactRelational: readonly string[];
    exactContractRef: readonly string[]; partialOrUnknown: readonly string[]; nonAuthoritativeNotes: readonly string[];
    integrity: Readonly<{
      unclassifiedJsonbColumns: number; missingManifestJsonbColumns: number; brokenPolicyRevisionChains: number;
      unresolvedExceptionRefs: number; malformedContextPolicies: number; inconsistentContextComponents: number;
      corruptActionLifecycleRows: number; rowCapExceeded: number }> }>;
  disposition: "blocked" | "review_required";
  mutationAllowed: boolean;
  authority: Readonly<{ canPublish: false; canPause: false; canArchive: false; canApprove: false;
    canExecute: false; canSchedule: false; canCallTool: false; canWriteMeta: false }>;
}>;

export interface InstructionPolicyImpactRepository {
  preview(workspaceId: string, policyRef: string,
    operation: InstructionPolicyImpactOperation): Promise<InstructionPolicyImpact | null>;
}

export class InstructionPolicyImpactRepositoryError extends Error {
  constructor(readonly code: "invalid_input" | "workspace_scope_mismatch" | "corrupt_store") {
    super(`Instruction policy dependency impact rejected: ${code}`);
    this.name = "InstructionPolicyImpactRepositoryError";
  }
}

export class InstructionPolicyImpactService {
  constructor(private readonly repository: InstructionPolicyImpactRepository,
    private readonly memberships: readonly WorkspaceMembership[]) {}
  async preview(principal: TrustedDecisionRoomPrincipal, policyRef: string,
    operation: InstructionPolicyImpactOperation) {
    authorizeWorkspace(principal.actor, principal.workspaceId, "instruction_policy:read", this.memberships);
    const impact = await this.repository.preview(principal.workspaceId, policyRef, operation);
    return impact === null ? null : Object.freeze({ contractVersion: INSTRUCTION_POLICY_IMPACT_VERSION, ...impact });
  }
}
