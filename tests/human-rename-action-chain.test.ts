import { describe, expect, it } from "vitest";

import { admitActionExecution } from "@/domain/actions/action-execution-admission";
import { createActionBundle, decideActionUnit, initializeApprovalLifecycle, type ActionUnitInput } from "@/domain/actions/approval-lifecycle";
import { buildActionPlan } from "@/domain/actions/autonomy-valve";

const proposedAt = "2026-08-18T12:00:00.000Z";

describe("human-only rename action chain", () => {
  it("flows through plan, one-human approval, freshness and admission while retaining zero write authority", () => {
    const actionPlan = buildActionPlan({
      kind: "rename",
      entity: { level: "campaign", ref: "campaign_external_main" },
      beforeName: "Prospecting | Eski",
      afterName: "Prospecting | Yeni",
      namingEvidenceRef: "naming_evidence_main",
    }, {
      workspaceRef: "workspace_alpha", accountGroupRef: null, accountRef: "account_main", internalCategoryRefs: [],
      campaignRef: "campaign_external_main", entity: { level: "campaign", ref: "campaign_external_main" },
      evaluatedAt: proposedAt, rules: [], budgetLimits: null,
      protection: { protectedInternalCategoryRefs: [], affectedGeoRefs: [], protectedGeoRefs: [], changeDisposition: "allowed", policyRefs: [] },
    });
    expect(actionPlan).toMatchObject({ actionType: "campaign_rename", risk: "K3", disposition: "approval_required",
      capabilities: { canExecute: false, canWriteMeta: false, canGrantApproval: false } });

    const input: ActionUnitInput = {
      unitRef: "action_unit_11111111111111111111",
      scope: { workspaceRef: "workspace_alpha", accountRef: "account_main", entityRef: "campaign_external_main", actionType: "campaign_rename" },
      risk: "K3", sourceHash: actionPlan.planHash, contextHash: actionPlan.contextHash, specHash: "b".repeat(64), dependencies: [],
      requester: { actorRef: "actor_requester", role: "operator" }, proposedAt, expiresAt: "2026-08-18T14:00:00.000Z",
    };
    const bundle = createActionBundle({ bundleRef: "bundle_rename", plan: { planRef: "plan_rename", revision: 1, planHash: "c".repeat(64) }, units: [input] });
    const unit = bundle.units[0]!;
    const initialized = initializeApprovalLifecycle({ bundle, policy: {
      version: "action-approval-policy/1.0.0", policyRef: "approval_policy_rename", revision: 1,
      requesterRoles: ["operator"], approverRoles: [{ risk: "K3", roles: ["owner"] }], grantConsumerRoles: ["owner"],
      separationOfDutiesRisks: [], maximumProtectionEvidenceAgeSeconds: 3600,
      maximumProposalLifetimeSeconds: 7200, maximumGrantLifetimeSeconds: 600,
    }, initializedAt: proposedAt, eventRef: "event_rename" });
    const lifecycle = decideActionUnit(initialized.lifecycle, {
      kind: "approve", commandRef: "decision_rename", unitRef: unit.unitRef,
      actor: { actorRef: "actor_owner", role: "owner" }, decidedAt: "2026-08-18T12:01:00.000Z", reasonCode: "human.rename_reviewed",
      freshness: [{ unitRef: unit.unitRef, planRevision: 1, planHash: unit.plan.planHash,
        sourceHash: unit.sourceHash, contextHash: unit.contextHash, specHash: unit.specHash }],
      authorization: { authorizationRef: "presence_rename_approve", unitRef: unit.unitRef, unitHash: unit.unitHash,
        scopeHash: unit.scopeHash, actor: { actorRef: "actor_owner", role: "owner" }, issuedAt: "2026-08-18T12:00:30.000Z",
        expiresAt: "2026-08-18T12:02:00.000Z", humanPresence: true, canExecute: false }, grantRef: "grant_rename",
    }).lifecycle;
    const freshness = [{ unitRef: unit.unitRef, planRevision: 1, planHash: unit.plan.planHash,
      sourceHash: unit.sourceHash, contextHash: unit.contextHash, specHash: unit.specHash }];
    const base = {
      lifecycle, unitRef: unit.unitRef, actionPlan,
      eligibilitySnapshot: { workspaceRef: "workspace_alpha", accountRef: "account_main", capturedAt: "2026-08-18T12:01:10.000Z",
        target: { entityLevel: "campaign" as const, entityRef: "campaign_external_main", configuredStatus: "ACTIVE" as const,
          effectiveStatus: "ACTIVE" as const, budgetOwnerRef: "campaign_external_main", currentName: "Prospecting | Eski" },
        ancestors: [], sourceSnapshotHash: "d".repeat(64) },
      currentFreshness: freshness,
      executionPresence: { authorizationRef: "presence_rename_execute", unitRef: unit.unitRef, unitHash: unit.unitHash,
        scopeHash: unit.scopeHash, actor: { actorRef: "actor_owner", role: "owner" as const }, issuedAt: "2026-08-18T12:01:10.000Z",
        expiresAt: "2026-08-18T12:02:00.000Z", humanPresence: true as const }, evaluatedAt: "2026-08-18T12:01:30.000Z",
    };
    expect(admitActionExecution(base)).toMatchObject({ disposition: "admitted_for_disabled_executor",
      writeSpec: { actionType: "campaign_rename", mutation: { kind: "rename", previousName: "Prospecting | Eski", desiredName: "Prospecting | Yeni" } },
      capabilities: { canExecute: false, canWriteMeta: false, canDispatchNetwork: false } });
    expect(() => admitActionExecution({ ...base, eligibilitySnapshot: { ...base.eligibilitySnapshot,
      target: { ...base.eligibilitySnapshot.target, currentName: "Başka ad" } } })).toThrowError(expect.objectContaining({ code: "write_not_eligible" }));
  });
});
