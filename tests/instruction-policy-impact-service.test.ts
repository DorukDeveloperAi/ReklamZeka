import { describe, expect, it, vi } from "vitest";
import { InstructionPolicyImpactService, type InstructionPolicyImpactRepository } from
  "@/application/instruction-policy-impact-service";
import { AuthorizationError } from "@/security/authorization";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const users = { viewer: "22222222-2222-4222-8222-222222222222", outsider: "33333333-3333-4333-8333-333333333333" };
const principal = (userId: string) => ({ actor: { userId }, workspaceId, workspaceRef: "workspace_test",
  readerRef: "actor_test" }) as const;

describe("InstructionPolicyImpactService", () => {
  it("allows a viewer to inspect but never conveys mutation authority", async () => {
    const repository: InstructionPolicyImpactRepository = { preview: vi.fn(async () => ({
      impactHash: "a".repeat(64), operation: "archive", registryHash: "b".repeat(64),
      target: { policyRef: "policy_health", policyVersion: 1, policyHash: "c".repeat(64), status: "published" },
      exactBlockers: { currentInboundExceptions: 0, enabledSchedules: 0, nonTerminalActionUnits: 0 },
      historicalImpact: { historicalInboundExceptions: 0, directAppliedContexts: 0, directSuppressedContexts: 0,
        directParkedContexts: 0, alreadyInvalidatedContexts: 0, budgetProposals: 0, currentAnalysisTemplates: 0,
        supersededAnalysisTemplates: 0, runAssets: 0, decisionLedgerRecords: 0, terminalActionUnits: 0 },
      invalidationPlan: { registryComponents: 0, contextsNeedingInvalidation: 0 }, coverage: { complete: false,
        manifestVersion: "instruction-policy-dependency-manifest/1.0.0", exactRelational: [], exactContractRef: [],
        partialOrUnknown: ["manual_policy_locks"], nonAuthoritativeNotes: ["action_context_hash_index_explain_not_verified"],
        integrity: { unclassifiedJsonbColumns: 0,
          missingManifestJsonbColumns: 0, brokenPolicyRevisionChains: 0, unresolvedExceptionRefs: 0,
          malformedContextPolicies: 0, inconsistentContextComponents: 0, corruptActionLifecycleRows: 0,
          rowCapExceeded: 0 } }, disposition: "blocked", mutationAllowed: false, authority: { canPublish: false,
        canPause: false, canArchive: false, canApprove: false, canExecute: false, canSchedule: false,
        canCallTool: false, canWriteMeta: false },
    } as const)) };
    const result = await new InstructionPolicyImpactService(repository,
      [{ userId: users.viewer, workspaceId, role: "viewer" }]).preview(principal(users.viewer), "policy_health", "archive");
    expect(result).toMatchObject({ contractVersion: "instruction-policy-impact/1.0.0", mutationAllowed: false,
      coverage: { complete: false }, authority: { canArchive: false, canExecute: false, canWriteMeta: false } });
  });

  it("denies a cross-workspace principal before repository access", async () => {
    const repository = { preview: vi.fn() };
    await expect(new InstructionPolicyImpactService(repository, []).preview(principal(users.outsider),
      "policy_health", "publish")).rejects.toBeInstanceOf(AuthorizationError);
    expect(repository.preview).not.toHaveBeenCalled();
  });
});
