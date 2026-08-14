import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

import { DrizzleActionExecutionAdmissionSourceRepository } from "@/connectors/actions/action-execution-admission-source-drizzle-repository";
import { buildActionPlan } from "@/domain/actions/autonomy-valve";
import { createActionBundle, decideActionUnit, initializeApprovalLifecycle, type ActionUnitInput } from "@/domain/actions/approval-lifecycle";

const workspaceId = "00000000-0000-4000-8000-000000000001";
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

function approved() {
  const bundle = createActionBundle({ bundleRef: "bundle_one", plan: { planRef: "plan_one", revision: 1, planHash: "2".repeat(64) }, units: [input] });
  const unit = bundle.units[0]!;
  const initial = initializeApprovalLifecycle({ bundle, initializedAt: at, eventRef: "event_one", policy: {
    version: "action-approval-policy/1.0.0", policyRef: "approval_policy_one", revision: 1,
    requesterRoles: ["operator"], approverRoles: [{ risk: "K2", roles: ["owner"] }], grantConsumerRoles: ["owner"],
    separationOfDutiesRisks: [], maximumProtectionEvidenceAgeSeconds: 3600, maximumProposalLifetimeSeconds: 7200, maximumGrantLifetimeSeconds: 600,
  } }).lifecycle;
  const lifecycle = decideActionUnit(initial, { kind: "approve", commandRef: "decision_one", unitRef: unit.unitRef,
    actor: { actorRef: "actor_owner", role: "owner" }, decidedAt: at, reasonCode: "reviewed",
    freshness: [{ unitRef: unit.unitRef, planRevision: unit.plan.revision, planHash: unit.plan.planHash, sourceHash: unit.sourceHash, contextHash: unit.contextHash, specHash: unit.specHash }],
    authorization: { authorizationRef: "presence_approval", unitRef: unit.unitRef, unitHash: unit.unitHash, scopeHash: unit.scopeHash,
      actor: { actorRef: "actor_owner", role: "owner" }, issuedAt: at, expiresAt: "2026-08-10T12:01:00.000Z", humanPresence: true, canExecute: false }, grantRef: "grant_one" }).lifecycle;
  return Object.freeze({ lifecycle, freshness: Object.freeze([{ unitRef: unit.unitRef, planRevision: unit.plan.revision, planHash: unit.plan.planHash,
    sourceHash: unit.sourceHash, contextHash: unit.contextHash, specHash: unit.specHash }]) });
}

function row(overrides: Record<string, unknown> = {}) {
  return { action_plan_payload: plan, account_ref: "account_main", entity_ref: "campaign_main", action_type: "status_pause",
    campaign_ref: "campaign_main", campaign_configured_status: "ACTIVE", campaign_effective_status: "ACTIVE", campaign_budget_optimization: true,
    ad_set_ref: null, ad_set_configured_status: null, ad_set_effective_status: null,
    ad_ref: null, ad_configured_status: null, ad_effective_status: null,
    source_snapshot_hash: "3".repeat(64), source_snapshot_captured_at: at, database_now: at, ...overrides };
}

describe("DrizzleActionExecutionAdmissionSourceRepository", () => {
  it("loads only persisted proposal/lifecycle data and current Meta mirror proof", async () => {
    const dialect = new PgDialect(); const execute = vi.fn(async () => ({ rows: [row()] }));
    const approval = { loadForDecision: vi.fn(async () => approved()) };
    const repository = new DrizzleActionExecutionAdmissionSourceRepository({ execute, transaction: vi.fn() } as never, workspaceId, approval);
    const result = await repository.loadForAdmission({ workspaceId, unitRef: input.unitRef });
    expect(result).toMatchObject({ actionPlan: { planHash: plan.planHash }, eligibilitySnapshot: {
      workspaceRef: "workspace_alpha", accountRef: "account_main", sourceSnapshotHash: "3".repeat(64),
      target: { entityLevel: "campaign", entityRef: "campaign_main", effectiveStatus: "ACTIVE", budgetOwnerRef: "campaign_main" },
    } });
    expect(approval.loadForDecision).toHaveBeenCalledWith({ workspaceId, unitRef: input.unitRef });
    expect(execute).toHaveBeenCalledTimes(1);
    void dialect;
  });

  it("fails closed for a missing current snapshot or an action plan that no longer matches the immutable unit", async () => {
    const approval = { loadForDecision: vi.fn(async () => approved()) };
    const missing = new DrizzleActionExecutionAdmissionSourceRepository({ execute: vi.fn(async () => ({ rows: [] })), transaction: vi.fn() } as never, workspaceId, approval);
    await expect(missing.loadForAdmission({ workspaceId, unitRef: input.unitRef })).rejects.toMatchObject({ code: "source_missing" });
    const corrupt = new DrizzleActionExecutionAdmissionSourceRepository({ execute: vi.fn(async () => ({ rows: [row({ action_plan_payload: { ...plan, planHash: "4".repeat(64) } })] })), transaction: vi.fn() } as never, workspaceId, approval);
    await expect(corrupt.loadForAdmission({ workspaceId, unitRef: input.unitRef })).rejects.toMatchObject({ code: "source_corrupt" });
  });
});
