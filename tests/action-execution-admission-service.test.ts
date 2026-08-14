import { describe, expect, it } from "vitest";

import { ActionExecutionAdmissionService, ActionExecutionAdmissionServiceError } from "@/application/action-execution-admission-service";
import { buildActionPlan } from "@/domain/actions/autonomy-valve";
import { createActionBundle, decideActionUnit, initializeApprovalLifecycle, type ActionUnitInput } from "@/domain/actions/approval-lifecycle";
import { SingleUseHumanPresenceChallengeStore } from "@/security/human-presence-challenge";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const at = "2026-08-10T12:00:00.000Z";
const unitInput: ActionUnitInput = {
  unitRef: `action_unit_${"a".repeat(20)}`,
  scope: { workspaceRef: "workspace_alpha", accountRef: "account_main", entityRef: "campaign_main", actionType: "status_pause" },
  risk: "K2", sourceHash: "0".repeat(64), contextHash: "1".repeat(64), specHash: "2".repeat(64), dependencies: [],
  requester: { actorRef: "actor_requester", role: "operator" }, proposedAt: at, expiresAt: "2026-08-10T13:00:00.000Z",
};
const plan = buildActionPlan({ kind: "status_change", entity: { level: "campaign", ref: "campaign_main" }, fromStatus: "ACTIVE", toStatus: "PAUSED" }, {
  workspaceRef: "workspace_alpha", accountGroupRef: null, accountRef: "account_main", internalCategoryRefs: [], campaignRef: "campaign_main",
  entity: { level: "campaign", ref: "campaign_main" }, evaluatedAt: at, rules: [], budgetLimits: null,
  protection: { protectedInternalCategoryRefs: [], affectedGeoRefs: [], protectedGeoRefs: [], changeDisposition: "allowed", policyRefs: [] },
});
const boundUnit: ActionUnitInput = { ...unitInput, sourceHash: plan.planHash, contextHash: plan.contextHash };

function source() {
  const bundle = createActionBundle({ bundleRef: "bundle_one", plan: { planRef: "plan_one", revision: 1, planHash: "3".repeat(64) }, units: [boundUnit] });
  const unit = bundle.units[0]!;
  const initialized = initializeApprovalLifecycle({ bundle, initializedAt: at, eventRef: "event_one", policy: {
    version: "action-approval-policy/1.0.0", policyRef: "approval_policy_one", revision: 1,
    requesterRoles: ["operator"], approverRoles: [{ risk: "K2", roles: ["owner"] }], grantConsumerRoles: ["owner"],
    separationOfDutiesRisks: [], maximumProtectionEvidenceAgeSeconds: 3600, maximumProposalLifetimeSeconds: 7200, maximumGrantLifetimeSeconds: 600,
  } }).lifecycle;
  const lifecycle = decideActionUnit(initialized, { kind: "approve", commandRef: "decision_one", unitRef: unit.unitRef,
    actor: { actorRef: "actor_owner", role: "owner" }, decidedAt: at, reasonCode: "reviewed",
    freshness: [{ unitRef: unit.unitRef, planRevision: unit.plan.revision, planHash: unit.plan.planHash, sourceHash: unit.sourceHash, contextHash: unit.contextHash, specHash: unit.specHash }],
    authorization: { authorizationRef: "presence_approval", unitRef: unit.unitRef, unitHash: unit.unitHash, scopeHash: unit.scopeHash,
      actor: { actorRef: "actor_owner", role: "owner" }, issuedAt: at, expiresAt: "2026-08-10T12:01:00.000Z", humanPresence: true, canExecute: false }, grantRef: "grant_one" }).lifecycle;
  return Object.freeze({ lifecycle, freshness: [{ unitRef: unit.unitRef, planRevision: unit.plan.revision, planHash: unit.plan.planHash,
    sourceHash: unit.sourceHash, contextHash: unit.contextHash, specHash: unit.specHash }], actionPlan: plan,
  eligibilitySnapshot: { workspaceRef: "workspace_alpha", accountRef: "account_main", capturedAt: at,
    target: { entityLevel: "campaign" as const, entityRef: "campaign_main", configuredStatus: "ACTIVE" as const, effectiveStatus: "ACTIVE" as const, budgetOwnerRef: "campaign_main" },
    ancestors: [], sourceSnapshotHash: "4".repeat(64) } });
}

function setup() {
  const store = new SingleUseHumanPresenceChallengeStore();
  const saved: unknown[] = [];
  const service = new ActionExecutionAdmissionService({ loadForAdmission: async () => source() }, store, {
    admit: async ({ admission }) => { saved.push(admission); return Object.freeze({ outcome: "inserted" as const, executionRef: "action_execution_11111111111111111111", admissionHash: admission.admissionHash,
      capabilities: Object.freeze({ canExecute: false as const, canWriteMeta: false as const, canDispatchNetwork: false as const }) }); },
  }, () => "2026-08-10T12:00:30.000Z");
  const proof = store.issue({ workspaceId, actorRef: "actor_owner", unitRef: boundUnit.unitRef, action: "admit_execution", now: at }).proof;
  return { service, proof, saved };
}

const principal = { actor: { userId: "00000000-0000-4000-8000-000000000002" }, workspaceId, workspaceRef: "workspace_alpha", readerRef: "actor_owner" } as const;
const membership = { userId: principal.actor.userId, workspaceId, role: "owner" as const };

describe("ActionExecutionAdmissionService", () => {
  it("consumes a distinct execution ceremony and persists only a disabled admission", async () => {
    const { service, proof, saved } = setup();
    const result = await service.admit({ principal, membership, unitRef: boundUnit.unitRef, humanPresenceProof: proof });
    expect(result).toMatchObject({ outcome: "inserted", authority: { admissionRecorded: true, canExecute: false, canWriteMeta: false, canDispatchNetwork: false } });
    expect(saved).toHaveLength(1);
  });

  it("rejects replayed execution proof and never lets a viewer enter the source path", async () => {
    const { service, proof, saved } = setup();
    await service.admit({ principal, membership, unitRef: boundUnit.unitRef, humanPresenceProof: proof });
    await expect(service.admit({ principal, membership, unitRef: boundUnit.unitRef, humanPresenceProof: proof }))
      .rejects.toMatchObject({ code: "human_presence_rejected" });
    await expect(service.admit({ principal, membership: { ...membership, role: "viewer" }, unitRef: boundUnit.unitRef, humanPresenceProof: "presence_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" }))
      .rejects.toEqual(expect.any(ActionExecutionAdmissionServiceError));
    expect(saved).toHaveLength(1);
  });
});
