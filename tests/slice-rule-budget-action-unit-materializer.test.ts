import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  createApprovalPolicyDraft,
  publishApprovalPolicy,
} from "@/domain/actions/approval-policy-registry";
import {
  createActionGuardrailPolicyDraft,
  publishActionGuardrailPolicy,
} from "@/domain/actions/action-guardrail-policy";
import type { ApprovalPolicy } from "@/domain/actions/approval-lifecycle";
import { ACTION_APPROVAL_POLICY_VERSION } from "@/domain/actions/approval-lifecycle";
import {
  resolveSliceRuleBudgetActionApprovalPolicy,
  resolveSliceRuleBudgetActionGuardrails,
  publicSliceRuleBudgetProvenance,
  assertActionDataHealthReady,
} from "@/connectors/campaigns/slice-rule-budget-action-unit-materializer";

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
  it("stops action staging with a typed data-health hold", () => {
    expect(() => assertActionDataHealthReady(false)).toThrowError(expect.objectContaining({ code: "data_health_hold" }));
    expect(() => assertActionDataHealthReady(true)).not.toThrow();
    const source = readFileSync("src/connectors/campaigns/slice-rule-budget-action-unit-materializer.ts", "utf8");
    expect(source).toContain("assertActionDataHealthReady(preparationGate.dataHealthReady)");
    expect(source).toContain("appendActionPreparationGateSnapshot");
  });
  it("builds only bounded public labels from already-verified immutable provenance", () => {
    const evidence = publicSliceRuleBudgetProvenance({ seriesRef: "slice_rule.ftr.ar", revision: 2,
      proposalSeriesRef: "budget.ftr.ar", proposalRevision: 3, market: "international", hasSameMarketPool: true,
      approvalPolicyRevision: 4, hasPublishedGuardrail: true });
    expect(evidence.map((item) => item.label)).toEqual([
      "İnsan seçimiyle sabitlenen bütçe senaryosu",
      "Kullanıcı kuralı · slice_rule.ftr.ar · revizyon 2",
      "Bütçe önerisi · budget.ftr.ar · revizyon 3",
      "Yabancı bütçe havuzu · aynı pazar bağı doğrulandı",
      "Onay politikası · yayınlanmış · revizyon 4",
      "Koruma kuralı · yayınlanmış bütçe limiti doğrulandı",
    ]);
    expect(JSON.stringify(evidence)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/i);
    expect(JSON.stringify(evidence)).not.toMatch(/[a-f0-9]{64}/i);
  });

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

  it("projects only an active published guardrail and authentic evidence into the budget valve", () => {
    const draft = createActionGuardrailPolicyDraft({
      workspaceRef: "workspace_alpha", policyRef: "guardrail_budget_decrease", revision: 1, previousHash: null,
      effectiveFrom: "2026-08-01T00:00:00.000Z", expiresAt: null,
      selector: { actionTypes: ["budget_decrease"], accountRefs: ["account_main"], campaignRefs: ["campaign_main"],
        entities: [{ level: "campaign", ref: "campaign_main" }], internalCategoryRefs: ["category_health"], geoRefs: ["geo_turkey"] },
      clauses: [{ clauseRef: "limit_budget_decrease", kind: "budget_delta_limit", currency: "TRY",
        maximumAbsoluteDeltaDecimal: "20", maximumRelativeDeltaBasisPoints: 2_000 }],
      normalizedBy: { actorRef: "actor_analyst", role: "analyst" }, sourceGuidanceRefs: ["guidance_budget"],
    });
    const published = publishActionGuardrailPolicy({ draft, actor: { actorRef: "actor_owner", role: "owner" },
      decisionRef: "decision_guardrail", reasonRef: "reason_guardrail", publishedAt: "2026-08-01T00:01:00.000Z" });
    const action = { actionHash: "a".repeat(64), actionType: "budget_decrease" as const,
      accountRef: "account_main", campaignRef: "campaign_main", entity: { level: "campaign" as const, ref: "campaign_main" },
      budgetChange: { currency: "TRY", absoluteDeltaDecimal: "10", relativeDeltaBasisPoints: 1_000 } };
    const evidence = { status: "known" as const, refs: ["category_health"], evidenceHash: "b".repeat(64) };
    const geoEvidence = { status: "known" as const, refs: ["geo_turkey"], evidenceHash: "c".repeat(64) };

    const resolved = resolveSliceRuleBudgetActionGuardrails({ workspaceRef: "workspace_alpha", evaluatedAt: "2026-08-02T00:00:00.000Z",
      action, categoryEvidence: evidence, affectedGeoEvidence: geoEvidence, revisions: [draft, published] });
    expect(resolved).toMatchObject({
      internalCategoryRefs: ["category_health"],
      budgetLimits: { currency: "TRY", maximumAbsoluteDeltaDecimal: "20", maximumRelativeDeltaBasisPoints: 2_000,
        limitRefs: ["limit_budget_decrease"] },
      protection: { changeDisposition: "allowed", affectedGeoRefs: ["geo_turkey"] },
    });
    expect(resolved?.protection.policyRefs).toContain("guardrail_budget_decrease");
  });

  it("does not default an unpublished policy or missing evidence to an allowed budget guardrail", () => {
    const draft = createActionGuardrailPolicyDraft({
      workspaceRef: "workspace_alpha", policyRef: "guardrail_budget_draft", revision: 1, previousHash: null,
      effectiveFrom: "2026-08-01T00:00:00.000Z", expiresAt: null,
      selector: { actionTypes: ["budget_decrease"], accountRefs: [], campaignRefs: [], entities: [], internalCategoryRefs: [], geoRefs: [] },
      clauses: [{ clauseRef: "limit_budget_draft", kind: "budget_delta_limit", currency: "TRY",
        maximumAbsoluteDeltaDecimal: "20", maximumRelativeDeltaBasisPoints: null }],
      normalizedBy: { actorRef: "actor_analyst", role: "analyst" }, sourceGuidanceRefs: [],
    });
    const action = { actionHash: "a".repeat(64), actionType: "budget_decrease" as const,
      accountRef: "account_main", campaignRef: "campaign_main", entity: { level: "campaign" as const, ref: "campaign_main" },
      budgetChange: { currency: "TRY", absoluteDeltaDecimal: "10", relativeDeltaBasisPoints: 1_000 } };
    expect(resolveSliceRuleBudgetActionGuardrails({ workspaceRef: "workspace_alpha", evaluatedAt: "2026-08-02T00:00:00.000Z",
      action, categoryEvidence: { status: "unknown", reasonRef: "reason_category_missing" },
      affectedGeoEvidence: { status: "known", refs: ["geo_turkey"], evidenceHash: "c".repeat(64) }, revisions: [draft] })).toBeNull();
  });
});
