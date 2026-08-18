import { describe, expect, it } from "vitest";

import { buildActionPlan, type ActionValveContext } from "@/domain/actions/autonomy-valve";
import { createActionBundle, initializeApprovalLifecycle, decideActionUnit, type ActionUnitInput } from "@/domain/actions/approval-lifecycle";
import { admitActionExecution, ActionExecutionAdmissionError } from "@/domain/actions/action-execution-admission";

const at = "2026-08-10T12:00:00.000Z";
const plan = buildActionPlan({ kind: "status_change", entity: { level: "campaign", ref: "campaign_main" }, fromStatus: "ACTIVE", toStatus: "PAUSED" }, {
  workspaceRef: "workspace_alpha", accountGroupRef: null, accountRef: "account_main", internalCategoryRefs: [], campaignRef: "campaign_main",
  entity: { level: "campaign", ref: "campaign_main" }, evaluatedAt: at, rules: [], budgetLimits: null,
  protection: { protectedInternalCategoryRefs: [], affectedGeoRefs: [], protectedGeoRefs: [], changeDisposition: "allowed", policyRefs: [] },
});
const unitInput: ActionUnitInput = {
  unitRef: "action_unit_11111111111111111111", scope: { workspaceRef: "workspace_alpha", accountRef: "account_main", entityRef: "campaign_main", actionType: "status_pause" },
  risk: "K2", sourceHash: plan.planHash, contextHash: plan.contextHash, specHash: "b".repeat(64), dependencies: [],
  requester: { actorRef: "actor_requester", role: "operator" }, proposedAt: at, expiresAt: "2026-08-10T13:00:00.000Z",
};
const frozenPlan = { planRef: "plan_one", revision: 1, planHash: "c".repeat(64) } as const;
function bundle() { return createActionBundle({ bundleRef: "bundle_one", plan: frozenPlan, units: [unitInput] }); }
function approved() {
  const frozen = bundle(); const unit = frozen.units[0]!;
  const initialized = initializeApprovalLifecycle({ bundle: frozen, policy: { version: "action-approval-policy/1.0.0", policyRef: "approval_policy_one", revision: 1, requesterRoles: ["operator"], approverRoles: [{ risk: "K2", roles: ["owner"] }], grantConsumerRoles: ["owner"], separationOfDutiesRisks: [], maximumProtectionEvidenceAgeSeconds: 3600, maximumProposalLifetimeSeconds: 7200, maximumGrantLifetimeSeconds: 600 }, initializedAt: at, eventRef: "event_one" });
  return decideActionUnit(initialized.lifecycle, { kind: "approve", commandRef: "decision_one", unitRef: unit.unitRef, actor: { actorRef: "actor_owner", role: "owner" }, decidedAt: at, reasonCode: "reviewed", freshness: [{ unitRef: unit.unitRef, planRevision: 1, planHash: unit.plan.planHash, sourceHash: unit.sourceHash, contextHash: unit.contextHash, specHash: unit.specHash }], authorization: { authorizationRef: "presence_approval", unitRef: unit.unitRef, unitHash: unit.unitHash, scopeHash: unit.scopeHash, actor: { actorRef: "actor_owner", role: "owner" }, issuedAt: at, expiresAt: "2026-08-10T12:01:00.000Z", humanPresence: true, canExecute: false }, grantRef: "grant_one" }).lifecycle;
}
function input() {
  const lifecycle = approved(); const unit = lifecycle.bundle.units[0]!;
  return { lifecycle, unitRef: unit.unitRef, actionPlan: plan,
    eligibilitySnapshot: { workspaceRef: "workspace_alpha", accountRef: "account_main", capturedAt: at,
      target: { entityLevel: "campaign" as const, entityRef: "campaign_main", configuredStatus: "ACTIVE" as const, effectiveStatus: "ACTIVE" as const, budgetOwnerRef: "campaign_main", currentName: "Campaign Main" }, ancestors: [], sourceSnapshotHash: "d".repeat(64) },
    currentFreshness: [{ unitRef: unit.unitRef, planRevision: 1, planHash: unit.plan.planHash, sourceHash: unit.sourceHash, contextHash: unit.contextHash, specHash: unit.specHash }],
    executionPresence: { authorizationRef: "presence_execute", unitRef: unit.unitRef, unitHash: unit.unitHash, scopeHash: unit.scopeHash, actor: { actorRef: "actor_owner", role: "owner" as const }, issuedAt: at, expiresAt: "2026-08-10T12:01:00.000Z", humanPresence: true as const }, evaluatedAt: "2026-08-10T12:00:30.000Z" };
}

describe("action execution admission", () => {
  it("requires separate approved grant, target freshness and human presence but never exposes a write capability", () => {
    const result = admitActionExecution(input());
    expect(result).toMatchObject({ unitRef: unitInput.unitRef, approvalDecisionRef: "decision_one", approvalGrantRef: "grant_one", executionPresenceRef: "presence_execute", disposition: "admitted_for_disabled_executor", writeSpec: { actionType: "status_pause" }, eligibilitySnapshotHash: "d".repeat(64), eligibilityHash: expect.stringMatching(/^[a-f0-9]{64}$/), capabilities: { canExecute: false, canWriteMeta: false, canDispatchNetwork: false } });
  });

  it("fails closed for stale source, bad dependency/presence, or unapproved unit", () => {
    expect(() => admitActionExecution({ ...input(), currentFreshness: [{ ...input().currentFreshness[0]!, sourceHash: "f".repeat(64) }] }))
      .toThrowError(expect.objectContaining({ code: "freshness_mismatch" }));
    expect(() => admitActionExecution({ ...input(), executionPresence: { ...input().executionPresence, unitHash: "f".repeat(64) } }))
      .toThrowError(expect.objectContaining({ code: "execution_presence_invalid" }));
    expect(() => admitActionExecution({ ...input(), eligibilitySnapshot: { ...input().eligibilitySnapshot, target: { ...input().eligibilitySnapshot.target, effectiveStatus: "UNKNOWN" } } }))
      .toThrowError(expect.objectContaining({ code: "write_not_eligible" }));
    expect(() => admitActionExecution({ ...input(), eligibilitySnapshot: { ...input().eligibilitySnapshot, accountRef: "account_other" } }))
      .toThrowError(expect.objectContaining({ code: "write_not_eligible" }));
    const pending = initializeApprovalLifecycle({ bundle: bundle(), policy: { version: "action-approval-policy/1.0.0", policyRef: "approval_policy_one", revision: 1, requesterRoles: ["operator"], approverRoles: [{ risk: "K2", roles: ["owner"] }], grantConsumerRoles: ["owner"], separationOfDutiesRisks: [], maximumProtectionEvidenceAgeSeconds: 3600, maximumProposalLifetimeSeconds: 7200, maximumGrantLifetimeSeconds: 600 }, initializedAt: at, eventRef: "event_one" }).lifecycle;
    expect(() => admitActionExecution({ ...input(), lifecycle: pending })).toThrow(ActionExecutionAdmissionError);
  });
});
