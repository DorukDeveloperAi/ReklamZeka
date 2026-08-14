import { describe, expect, it } from "vitest";

import { admitActionExecution } from "@/domain/actions/action-execution-admission";
import { assessActionExecutionVerification, createActionExecutionVerificationContract } from "@/domain/actions/action-execution-verification";
import { buildActionPlan } from "@/domain/actions/autonomy-valve";
import { createActionBundle, decideActionUnit, initializeApprovalLifecycle, type ActionUnitInput } from "@/domain/actions/approval-lifecycle";

const at = "2026-08-10T12:00:00.000Z";
const plan = buildActionPlan({ kind: "status_change", entity: { level: "campaign", ref: "campaign_main" }, fromStatus: "ACTIVE", toStatus: "PAUSED" }, {
  workspaceRef: "workspace_alpha", accountGroupRef: null, accountRef: "account_main", internalCategoryRefs: [], campaignRef: "campaign_main",
  entity: { level: "campaign", ref: "campaign_main" }, evaluatedAt: at, rules: [], budgetLimits: null,
  protection: { protectedInternalCategoryRefs: [], affectedGeoRefs: [], protectedGeoRefs: [], changeDisposition: "allowed", policyRefs: [] },
});
const input: ActionUnitInput = { unitRef: `action_unit_${"a".repeat(20)}`,
  scope: { workspaceRef: "workspace_alpha", accountRef: "account_main", entityRef: "campaign_main", actionType: "status_pause" },
  risk: "K2", sourceHash: plan.planHash, contextHash: plan.contextHash, specHash: "1".repeat(64), dependencies: [],
  requester: { actorRef: "actor_requester", role: "operator" }, proposedAt: at, expiresAt: "2026-08-10T13:00:00.000Z" };

function contract() {
  const bundle = createActionBundle({ bundleRef: "bundle_one", plan: { planRef: "plan_one", revision: 1, planHash: "2".repeat(64) }, units: [input] });
  const unit = bundle.units[0]!;
  const initial = initializeApprovalLifecycle({ bundle, initializedAt: at, eventRef: "event_one", policy: {
    version: "action-approval-policy/1.0.0", policyRef: "approval_policy_one", revision: 1, requesterRoles: ["operator"],
    approverRoles: [{ risk: "K2", roles: ["owner"] }], grantConsumerRoles: ["owner"], separationOfDutiesRisks: [],
    maximumProtectionEvidenceAgeSeconds: 3600, maximumProposalLifetimeSeconds: 7200, maximumGrantLifetimeSeconds: 600,
  } }).lifecycle;
  const lifecycle = decideActionUnit(initial, { kind: "approve", commandRef: "decision_one", unitRef: unit.unitRef,
    actor: { actorRef: "actor_owner", role: "owner" }, decidedAt: at, reasonCode: "reviewed",
    freshness: [{ unitRef: unit.unitRef, planRevision: unit.plan.revision, planHash: unit.plan.planHash, sourceHash: unit.sourceHash, contextHash: unit.contextHash, specHash: unit.specHash }],
    authorization: { authorizationRef: "presence_approval", unitRef: unit.unitRef, unitHash: unit.unitHash, scopeHash: unit.scopeHash,
      actor: { actorRef: "actor_owner", role: "owner" }, issuedAt: at, expiresAt: "2026-08-10T12:01:00.000Z", humanPresence: true, canExecute: false }, grantRef: "grant_one" }).lifecycle;
  const admission = admitActionExecution({ lifecycle, unitRef: unit.unitRef, actionPlan: plan,
    eligibilitySnapshot: { workspaceRef: "workspace_alpha", accountRef: "account_main", capturedAt: at, sourceSnapshotHash: "3".repeat(64),
      target: { entityLevel: "campaign", entityRef: "campaign_main", configuredStatus: "ACTIVE", effectiveStatus: "ACTIVE", budgetOwnerRef: "campaign_main" }, ancestors: [] },
    currentFreshness: [{ unitRef: unit.unitRef, planRevision: unit.plan.revision, planHash: unit.plan.planHash, sourceHash: unit.sourceHash, contextHash: unit.contextHash, specHash: unit.specHash }],
    executionPresence: { authorizationRef: "presence_execute", unitRef: unit.unitRef, unitHash: unit.unitHash, scopeHash: unit.scopeHash,
      actor: { actorRef: "actor_owner", role: "owner" }, issuedAt: at, expiresAt: "2026-08-10T12:01:00.000Z", humanPresence: true }, evaluatedAt: "2026-08-10T12:00:30.000Z" });
  return createActionExecutionVerificationContract({ admission, actionPlan: plan });
}

function observation(overrides: Record<string, unknown> = {}) {
  return { target: { entityLevel: "campaign" as const, entityRef: "campaign_main" }, capturedAt: "2026-08-10T12:00:31.000Z", sourceSnapshotHash: "4".repeat(64),
    configuredStatus: "PAUSED" as const, dailyBudgetDecimal: null, lifetimeBudgetDecimal: null, platformReview: "pending" as const, delivery: "pending" as const, ...overrides };
}

describe("action execution verification", () => {
  it("separates accepted write, exact read-after-write, and later platform review/delivery", () => {
    const result = assessActionExecutionVerification({ contract: contract(), dispatch: { state: "accepted", error: null }, observation: observation() });
    expect(result).toMatchObject({ disposition: "verified", readAfterWrite: "matched", platformReview: "pending", delivery: "pending",
      rollback: { disposition: "requires_new_approved_action", reason: "new_human_approval_required" },
      capabilities: { canExecute: false, canWriteMeta: false, canDispatchNetwork: false } });
  });

  it("parks unavailable/retryable reads and fails expected-value mismatches without autonomous rollback", () => {
    const frozen = contract();
    expect(assessActionExecutionVerification({ contract: frozen, dispatch: { state: "rejected", error: "rate_limited" }, observation: null }))
      .toMatchObject({ disposition: "parked", reason: "retryable_transport", readAfterWrite: "not_attempted" });
    expect(assessActionExecutionVerification({ contract: frozen, dispatch: { state: "accepted", error: null }, observation: null }))
      .toMatchObject({ disposition: "parked", reason: "read_unavailable" });
    expect(assessActionExecutionVerification({ contract: frozen, dispatch: { state: "accepted", error: null }, observation: observation({ configuredStatus: "ACTIVE", platformReview: "limited", delivery: "limited" }) }))
      .toMatchObject({ disposition: "failed", reason: "expected_value_mismatch", rollback: { disposition: "manual_recovery_required" }, capabilities: { canExecute: false } });
  });
});
