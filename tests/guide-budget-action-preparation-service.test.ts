import { describe, expect, it } from "vitest";

import { GuideBudgetActionPreparationService, type GuideBudgetActionTrustedContextReadPort } from "@/application/guide-budget-action-preparation-service";
import type { GuideBudgetEvidenceBundle, GuideBudgetEvidenceReadPort } from "@/application/guide-budget-dry-run-service";
import { ACTION_APPROVAL_POLICY_VERSION, type ApprovalPolicy } from "@/domain/actions/approval-lifecycle";
import type { AutonomyRule } from "@/domain/actions/autonomy-valve";
import { createGuideBudgetContractV2 } from "@/domain/guides/guide-budget-contract-v2";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const revisionId = "22222222-2222-4222-8222-222222222222";
const at = "2026-08-17T06:00:00.000Z";
const hash = "a".repeat(64);
const policy: ApprovalPolicy = { version: ACTION_APPROVAL_POLICY_VERSION, policyRef: "policy_guide_budget", revision: 1,
  autonomyMode: "approval_only", requesterRoles: ["owner"], approverRoles: [{ risk: "K2", roles: ["admin", "owner"] }, { risk: "K3", roles: ["owner"] }],
  grantConsumerRoles: ["owner"], separationOfDutiesRisks: ["K3"], maximumProtectionEvidenceAgeSeconds: 3600,
  maximumProposalLifetimeSeconds: 86400, maximumGrantLifetimeSeconds: 300 };
const rule = (mode: AutonomyRule["mode"] = "approval_only"): AutonomyRule => ({ ruleRef: "autonomy_workspace", workspaceRef: "workspace_main",
  scope: { level: "workspace", ref: "workspace_main" }, mode, state: "published", effectiveFrom: "2026-08-01T00:00:00.000Z", expiresAt: null, killSwitch: false, maximumActionsPerRun: null });
function bundle(overrides: Partial<GuideBudgetEvidenceBundle> = {}): GuideBudgetEvidenceBundle {
  return { contract: createGuideBudgetContractV2({ guideRevisionHash: hash, market: "yerli", currency: "TRY", targetScopeRef: "campaign_main",
    expression: { kind: "money", amountDecimal: "120", currency: "TRY" }, maximumEvidenceAgeSeconds: 600,
    overlapEnvelope: { restrictionsComplete: true, actionAllowlist: ["budget_increase", "budget_decrease"], restrictions: [], numericCaps: [], unresolvedConflictRefs: [] } }),
  targetCurrentBudgetDecimal: "100", scopeEvidence: [
    { scopeLayer: "organization_campaign", scopeRef: "organization_campaign_main", market: "yerli", currency: "TRY", budgetOwnerRef: "campaign_main", budgetOwnerKind: "campaign", budgetKind: "daily", currentBudgetDecimal: "100", freshness: "fresh", observedAt: at, evidenceHash: hash },
    { scopeLayer: "campaign_ad_set", scopeRef: "campaign_main", market: "yerli", currency: "TRY", budgetOwnerRef: "campaign_main", budgetOwnerKind: "campaign", budgetKind: "daily", currentBudgetDecimal: "100", freshness: "fresh", observedAt: at, evidenceHash: "b".repeat(64) },
  ], constraints: [
    { guideRef: "guide_effective", action: "budget_increase", allowed: true, requiresHumanApproval: true, maximumAbsoluteDeltaDecimal: "25", maximumRelativeDeltaBasisPoints: 3000, parentCeilingDecimal: "125", guideMode: "prepare_human_approval", actionDisposition: "human_approval" },
    { guideRef: "guide_effective", action: "budget_decrease", allowed: true, requiresHumanApproval: true, maximumAbsoluteDeltaDecimal: "25", maximumRelativeDeltaBasisPoints: 3000, parentCeilingDecimal: "125", guideMode: "prepare_human_approval", actionDisposition: "human_approval" },
  ], ...overrides };
}
function port(current: () => GuideBudgetEvidenceBundle): GuideBudgetEvidenceReadPort { return { load: async () => current() }; }
function contexts(overrides: Record<string, unknown> = {}): GuideBudgetActionTrustedContextReadPort { return { load: async () => ({ runtime: { workspaceRef: "workspace_main", accountGroupRef: null, accountRef: "account_main", accountExternalRef: "account_main", ownerPublicRef: "campaign_main", ownerEntityExternalRef: "campaign_main", internalCategoryRefs: [], campaignRef: "campaign_main", rules: [rule()], protection: { protectedInternalCategoryRefs: [], affectedGeoRefs: [], protectedGeoRefs: [], changeDisposition: "allowed" as const, policyRefs: [] }, frozenContextHash: "c".repeat(64), dataHealthReady: true, dataHealthReportHash: "d".repeat(64), ...overrides }, approvalPolicy: policy }) }; }
function input(overrides: Record<string, unknown> = {}) { return { workspaceId, guideRevisionId: revisionId, requester: { actorRef: "actor_owner", role: "owner" as const }, proposedAt: at, expiresAt: "2026-08-17T07:00:00.000Z",
  ...overrides }; }

describe("GuideBudgetActionPreparationService", () => {
  it("hazır CBO dry-run'ını mevcut approval-only ActionUnit hattında stage eder", async () => {
    const service = new GuideBudgetActionPreparationService(port(() => bundle()), contexts());
    const result = await service.prepare(input());
    expect(result).toMatchObject({ disposition: "staged", intent: { entity: { level: "campaign", ref: "campaign_main" }, budgetOwnerRef: "campaign_main", beforeDecimal: "100", afterDecimal: "120" }, authority: { canExecute: false, canWriteMeta: false, canApprove: false } });
    if (result.disposition !== "staged") throw new Error("expected staged");
    expect(result.staged.lifecycle.units[0]?.state).toBe("awaiting_approval");
    expect(result.staged.summaries[0]?.actionPlan.disposition).toBe("approval_required");
  });

  it("ABO lifetime owner'ını campaign'e dönüştürmeden exact adset intent olarak taşır", async () => {
    const service = new GuideBudgetActionPreparationService(port(() => bundle({ scopeEvidence: bundle().scopeEvidence.map((row) => ({ ...row, budgetOwnerRef: "adset_main", budgetOwnerKind: "adset" as const, budgetKind: "lifetime" as const })) })), contexts({ ownerPublicRef: "adset_main", ownerEntityExternalRef: "adset_main" }));
    const result = await service.prepare(input());
    expect(result).toMatchObject({ disposition: "staged", intent: { entity: { level: "adset", ref: "adset_main" }, budgetOwnerRef: "adset_main", budgetKind: "lifetime" } });
  });

  it("stale/health/cap/mode koşullarını held yapar ve limited autonomy'yi kuyruklamaz", async () => {
    const stale = new GuideBudgetActionPreparationService(port(() => bundle({ scopeEvidence: bundle().scopeEvidence.map((row) => ({ ...row, freshness: "stale" as const })) })), contexts());
    await expect(stale.prepare(input())).resolves.toMatchObject({ disposition: "held", holdReasons: expect.arrayContaining(["data_stale:campaign_main"]) });
    const health = new GuideBudgetActionPreparationService(port(() => bundle()), contexts({ dataHealthReady: false }));
    await expect(health.prepare(input())).resolves.toMatchObject({ disposition: "held", holdReasons: ["data_health_hold"] });
    const autonomy = new GuideBudgetActionPreparationService(port(() => bundle()), contexts({ rules: [rule("policy_limited")] }));
    await expect(autonomy.prepare(input())).resolves.toMatchObject({ disposition: "held", holdReasons: expect.arrayContaining(["mode_or_autonomy_hold"]) });
    const ceiling = new GuideBudgetActionPreparationService(port(() => bundle({ constraints: bundle().constraints.map((row) => ({ ...row, parentCeilingDecimal: null })) })), contexts());
    await expect(ceiling.prepare(input())).resolves.toMatchObject({ disposition: "held", holdReasons: ["parent_ceiling_unavailable"] });
    const aliasMismatch = new GuideBudgetActionPreparationService(port(() => bundle()), contexts({ ownerPublicRef: "campaign_other" }));
    await expect(aliasMismatch.prepare(input())).resolves.toMatchObject({ disposition: "held", holdReasons: ["budget_owner_public_alias_mismatch"] });
  });

  it("admission öncesinde fresh active guide/evidence yeniden hesaplanır; hash veya unit değişirse fail-closed olur", async () => {
    let current = bundle();
    const service = new GuideBudgetActionPreparationService(port(() => current), contexts());
    const staged = await service.prepare(input());
    if (staged.disposition !== "staged") throw new Error("expected staged");
    const first = await service.revalidateForAdmission({ ...input(), evaluatedAt: "2026-08-17T06:05:00.000Z", expectedDryRunHash: staged.dryRun.dryRunHash, expectedActionUnitRef: staged.staged.summaries[0]!.unitRef });
    expect(first.disposition).toBe("admission_ready");
    current = bundle({ targetCurrentBudgetDecimal: "100", scopeEvidence: bundle().scopeEvidence.map((row) => row.scopeRef === "campaign_main" ? { ...row, currentBudgetDecimal: "110" } : row) });
    const second = await service.revalidateForAdmission({ ...input(), evaluatedAt: "2026-08-17T06:05:00.000Z", expectedDryRunHash: staged.dryRun.dryRunHash, expectedActionUnitRef: staged.staged.summaries[0]!.unitRef });
    expect(second).toMatchObject({ disposition: "held", holdReasons: expect.arrayContaining(["target_current_budget_evidence_conflict"]) });
    expect(second.authority).toEqual({ canAdmitExecution: false, canApprove: false, canExecute: false, canWriteMeta: false });
  });

  it("kalıcı birim, tutar aynı kalsa bile constraint/policy/kill-switch/protection driftinde yeniden üretilen kimlikle eşleşmez", async () => {
    let current = bundle();
    let runtime: Record<string, unknown> = {};
    let activePolicy = policy;
    const dynamicContexts: GuideBudgetActionTrustedContextReadPort = { load: async () => ({
      runtime: { workspaceRef: "workspace_main", accountGroupRef: null, accountRef: "account_main", internalCategoryRefs: [], campaignRef: "campaign_main",
        ownerPublicRef: "campaign_main", ownerEntityExternalRef: "campaign_main", accountExternalRef: "account_main", rules: [rule()], protection: { protectedInternalCategoryRefs: [], affectedGeoRefs: [], protectedGeoRefs: [], changeDisposition: "allowed" as const, policyRefs: [] },
        frozenContextHash: "c".repeat(64), dataHealthReady: true, dataHealthReportHash: "d".repeat(64), ...runtime }, approvalPolicy: activePolicy,
    }) };
    const service = new GuideBudgetActionPreparationService(port(() => current), dynamicContexts);
    const staged = await service.prepare(input());
    if (staged.disposition !== "staged") throw new Error("expected staged");
    const unit = staged.staged.lifecycle.bundle.units[0]!;
    const summary = staged.staged.summaries[0]!;
    const binding = () => ({ unitRef: unit.unitRef, plan: unit.plan, sourceHash: unit.sourceHash, contextHash: unit.contextHash,
      actionPlanHash: summary.actionPlanHash, actionHash: summary.actionHash,
      action: summary.actionPlan.action as Extract<typeof summary.actionPlan.action, { kind: "budget_change" }>, expiresAt: unit.expiresAt });
    const probe = () => service.revalidatePersisted({ workspaceId, guideRevisionId: revisionId, binding: binding(), evaluatedAt: "2026-08-17T06:05:00.000Z" });
    await expect(probe()).resolves.toBe(true);

    // Same 100 -> 120 action, stricter constraint envelope: only evidence/plan identity changes.
    current = bundle({ constraints: bundle().constraints.map((row) => ({ ...row, maximumRelativeDeltaBasisPoints: 4000 })) });
    await expect(probe()).resolves.toBe(false);
    current = bundle();
    // The human policy snapshot is likewise an immutable proposal fact.
    activePolicy = { ...policy, maximumGrantLifetimeSeconds: 301 };
    await expect(probe()).resolves.toBe(false);
    activePolicy = policy;
    runtime = { rules: [{ ...rule(), killSwitch: true }] };
    await expect(probe()).resolves.toBe(false);
    runtime = { protection: { protectedInternalCategoryRefs: [], affectedGeoRefs: [], protectedGeoRefs: [], changeDisposition: "denied", policyRefs: ["policy_protection"] } };
    await expect(probe()).resolves.toBe(false);
    runtime = { dataHealthReportHash: "e".repeat(64) };
    await expect(probe()).resolves.toBe(false);
  });
});
