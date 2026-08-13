import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  createApprovalPolicyDraft,
  publishApprovalPolicy,
} from "@/domain/actions/approval-policy-registry";
import type { ApprovalPolicy } from "@/domain/actions/approval-lifecycle";
import { ACTION_APPROVAL_POLICY_VERSION } from "@/domain/actions/approval-lifecycle";
import { resolveSliceRuleBudgetActionApprovalPolicy } from "@/connectors/campaigns/slice-rule-budget-action-unit-materializer";

function budgetPolicy(): ApprovalPolicy {
  return {
    version: ACTION_APPROVAL_POLICY_VERSION,
    policyRef: "policy_budget_decrease",
    revision: 1,
    autonomyMode: "approval_only",
    requesterRoles: ["owner", "admin"],
    approverRoles: [{ risk: "K2", roles: ["owner", "admin"] }],
    grantConsumerRoles: ["owner", "admin"],
    separationOfDutiesRisks: ["K2"],
    maximumProtectionEvidenceAgeSeconds: 3_600,
    maximumProposalLifetimeSeconds: 86_400,
    maximumGrantLifetimeSeconds: 900,
  };
}

function published(workspaceRef = "workspace_alpha") {
  const draft = createApprovalPolicyDraft({
    workspaceRef,
    policy: budgetPolicy(),
    applicability: { actionType: "budget_decrease", risk: "K2" },
    effectiveFrom: "2026-08-01T00:00:00.000Z",
    expiresAt: null,
    normalizedBy: { actorRef: "actor_analyst", role: "analyst" },
  });
  return [draft, publishApprovalPolicy({
    draft,
    actor: { actorRef: "actor_owner", role: "owner" },
    decisionRef: "decision_budget_review", reasonRef: "reason_budget_review",
    publishedAt: "2026-08-01T01:00:00.000Z",
  })] as const;
}

describe("slice-rule budget ActionUnit policy resolution", () => {
  it("binds the queued action plan only to the persisted frozen context resolved server-side", () => {
    const source = readFileSync("src/connectors/campaigns/slice-rule-budget-action-unit-materializer.ts", "utf8");
    expect(source).toContain("frozenContextHash: contexts[0]!.contextHash");
    expect(source).toContain("const contexts = await tx.select()");
    expect(source).not.toContain("frozenContextHash: input.");
  });

  it("uses the persisted public workspace reference, never a fabricated UUID-derived ref", () => {
    const artifacts = published();
    const resolved = resolveSliceRuleBudgetActionApprovalPolicy({
      evaluatedAt: "2026-08-02T00:00:00.000Z",
      applicability: { actionType: "budget_decrease", risk: "K2" },
      rows: artifacts.map((artifact) => ({ workspaceRef: "workspace_alpha", artifactPayload: artifact })),
    });
    expect(resolved).toMatchObject({ workspaceRef: "workspace_alpha", policy: { policyRef: "policy_budget_decrease" } });
  });

  it("fails closed for a mismatched workspace or budget applicability", () => {
    const artifacts = published();
    expect(resolveSliceRuleBudgetActionApprovalPolicy({
      evaluatedAt: "2026-08-02T00:00:00.000Z",
      applicability: { actionType: "budget_decrease", risk: "K2" },
      rows: [
        { workspaceRef: "workspace_alpha", artifactPayload: artifacts[0] },
        { workspaceRef: "workspace_bravo", artifactPayload: artifacts[1] },
      ],
    })).toBeNull();
    expect(resolveSliceRuleBudgetActionApprovalPolicy({
      evaluatedAt: "2026-08-02T00:00:00.000Z",
      applicability: { actionType: "budget_increase", risk: "K3" },
      rows: artifacts.map((artifact) => ({ workspaceRef: "workspace_alpha", artifactPayload: artifact })),
    })).toBeNull();
  });
});
