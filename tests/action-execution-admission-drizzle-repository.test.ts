import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

import { buildActionPlan } from "@/domain/actions/autonomy-valve";
import { createActionBundle, decideActionUnit, initializeApprovalLifecycle, type ActionUnitInput } from "@/domain/actions/approval-lifecycle";
import { admitActionExecution } from "@/domain/actions/action-execution-admission";
import { DrizzleActionExecutionAdmissionRepository } from "@/connectors/actions/action-execution-admission-drizzle-repository";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const bundleId = "10000000-0000-4000-8000-000000000001";
const unitId = "20000000-0000-4000-8000-000000000001";
const decisionId = "30000000-0000-4000-8000-000000000001";
const grantId = "40000000-0000-4000-8000-000000000001";
const attemptId = "50000000-0000-4000-8000-000000000001";
const at = "2026-08-10T12:00:00.000Z";

const actionPlan = buildActionPlan({ kind: "status_change", entity: { level: "campaign", ref: "campaign_main" }, fromStatus: "ACTIVE", toStatus: "PAUSED" }, {
  workspaceRef: "workspace_alpha", accountGroupRef: null, accountRef: "account_main", internalCategoryRefs: [], campaignRef: "campaign_main",
  entity: { level: "campaign", ref: "campaign_main" }, evaluatedAt: at, rules: [], budgetLimits: null,
  protection: { protectedInternalCategoryRefs: [], affectedGeoRefs: [], protectedGeoRefs: [], changeDisposition: "allowed", policyRefs: [] },
});
const inputUnit: ActionUnitInput = {
  unitRef: `action_unit_${"a".repeat(20)}`,
  scope: { workspaceRef: "workspace_alpha", accountRef: "account_main", entityRef: "campaign_main", actionType: "status_pause" },
  risk: "K2", sourceHash: actionPlan.planHash, contextHash: actionPlan.contextHash, specHash: "b".repeat(64), dependencies: [],
  requester: { actorRef: "actor_requester", role: "operator" }, proposedAt: at, expiresAt: "2026-08-10T13:00:00.000Z",
};
function admission() {
  const bundle = createActionBundle({ bundleRef: "bundle_one", plan: { planRef: "plan_one", revision: 1, planHash: "c".repeat(64) }, units: [inputUnit] });
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
  return admitActionExecution({ lifecycle, unitRef: unit.unitRef, actionPlan,
    eligibilitySnapshot: { workspaceRef: "workspace_alpha", accountRef: "account_main", capturedAt: at,
      target: { entityLevel: "campaign", entityRef: "campaign_main", configuredStatus: "ACTIVE", effectiveStatus: "ACTIVE", budgetOwnerRef: "campaign_main" }, ancestors: [], sourceSnapshotHash: "d".repeat(64) },
    currentFreshness: [{ unitRef: unit.unitRef, planRevision: unit.plan.revision, planHash: unit.plan.planHash, sourceHash: unit.sourceHash, contextHash: unit.contextHash, specHash: unit.specHash }],
    executionPresence: { authorizationRef: "presence_execute", unitRef: unit.unitRef, unitHash: unit.unitHash, scopeHash: unit.scopeHash,
      actor: { actorRef: "actor_owner", role: "owner" }, issuedAt: at, expiresAt: "2026-08-10T12:01:00.000Z", humanPresence: true }, evaluatedAt: "2026-08-10T12:00:30.000Z" });
}

class Database {
  readonly dialect = new PgDialect(); readonly queries: string[] = [];
  readonly attempts: Array<{ execution_ref: string; admission_hash: string; write_spec_hash: string }> = [];
  campaignEffectiveStatus: "ACTIVE" | "PAUSED" | "UNKNOWN" = "ACTIVE";
  events = 0;
  execute = vi.fn(async (query: Parameters<PgDialect["sqlToQuery"]>[0]) => {
    const { sql: statement } = this.dialect.sqlToQuery(query); this.queries.push(statement);
    const admissionValue = admission(); const unit = admissionValue.writeSpec;
    if (statement.includes("from workspaces w")) return { rows: [{ workspace_id: workspaceId, bundle_id: bundleId, unit_id: unitId,
      unit_ref: unit.unitRef, unit_hash: unit.unitHash, entity_ref: "campaign_main", source_hash: actionPlan.planHash,
      context_hash: actionPlan.contextHash, action_type: "status_pause", action_plan_payload: actionPlan,
      unit_payload: { scope: { workspaceRef: "workspace_alpha", accountRef: "account_main", entityRef: "campaign_main", actionType: "status_pause" } },
      account_ref: "account_main", campaign_ref: "campaign_main", ad_set_ref: null, ad_ref: null,
      campaign_configured_status: "ACTIVE", campaign_effective_status: this.campaignEffectiveStatus,
      ad_set_configured_status: null, ad_set_effective_status: null, target_configured_status: null, target_effective_status: null,
      campaign_budget_optimization: true, source_snapshot_hash: "d".repeat(64), source_snapshot_captured_at: at, database_now: at,
      decision_event_id: decisionId, approval_decision_ref: "decision_one", command_kind: "approve", approval_grant_id: grantId, approval_grant_ref: "grant_one" }] };
    if (statement.includes("select execution_ref, admission_hash")) return { rows: this.attempts };
    if (statement.includes("insert into action_execution_attempts")) { this.attempts.push({ execution_ref: `action_execution_${"x".repeat(20)}`, admission_hash: admissionValue.admissionHash, write_spec_hash: admissionValue.writeSpec.specHash }); return { rows: [{ id: attemptId }] }; }
    if (statement.includes("insert into action_execution_events")) { this.events += 1; return { rows: [] }; }
    throw new Error(`unexpected:${statement}`);
  });
  transaction = async <T>(work: (tx: this) => Promise<T>) => work(this);
}

describe("DrizzleActionExecutionAdmissionRepository", () => {
  it("rebinds the immutable unit/approval/grant chain, writes one admission event and remains network-disabled", async () => {
    const database = new Database(); const value = admission();
    const result = await new DrizzleActionExecutionAdmissionRepository(database as never, workspaceId).admit({ workspaceId, admission: value });
    expect(result).toMatchObject({ outcome: "inserted", admissionHash: value.admissionHash, capabilities: { canExecute: false, canWriteMeta: false, canDispatchNetwork: false } });
    expect(database.events).toBe(1);
    expect(database.queries.join("\n")).toContain("for update of w, u, d, g");
    expect(database.queries.join("\n")).not.toMatch(/fetch\(|https?:\/\/|graph\.facebook/i);
  });

  it("fails closed when the current Meta mirror no longer supports the frozen eligibility admission", async () => {
    const database = new Database();
    database.campaignEffectiveStatus = "PAUSED";
    await expect(new DrizzleActionExecutionAdmissionRepository(database as never, workspaceId)
      .admit({ workspaceId, admission: admission() }))
      .rejects.toMatchObject({ code: "source_corrupt" });
    expect(database.events).toBe(0);
    expect(database.attempts).toHaveLength(0);
  });
});
