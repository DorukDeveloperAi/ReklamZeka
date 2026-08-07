import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ActionProposalStagingError,
  ActionProposalStagingService,
  type ActionProposalStagingInput,
  type ActionProposalStagingUnitInput,
} from "@/application/action-proposal-staging-service";
import { ACTION_APPROVAL_POLICY_VERSION, type ApprovalPolicy, type FrozenPlanIdentity } from "@/domain/actions/approval-lifecycle";
import { buildActionPlan, type ActionPlan, type ActionValveContext, type AutonomyRule, type TypedActionIntent } from "@/domain/actions/autonomy-valve";

const h = (value: string) => value.repeat(64).slice(0, 64);
const proposedAt = "2026-08-07T18:00:00.000Z";
const expiresAt = "2026-08-08T18:00:00.000Z";
const frozenPlan: FrozenPlanIdentity = { planRef: "plan_operations_daily", revision: 2, planHash: h("f") };

const policy: ApprovalPolicy = {
  version: ACTION_APPROVAL_POLICY_VERSION,
  policyRef: "policy_approval_only",
  revision: 1,
  autonomyMode: "approval_only",
  requesterRoles: ["operator"],
  approverRoles: [
    { risk: "K2", roles: ["owner", "admin"] },
    { risk: "K3", roles: ["owner"] },
    { risk: "K4", roles: ["owner"] },
  ],
  grantConsumerRoles: ["owner"],
  separationOfDutiesRisks: ["K3", "K4"],
  maximumGrantLifetimeSeconds: 300,
};

function rule(): AutonomyRule {
  return {
    ruleRef: "autonomy_workspace", workspaceRef: "workspace_alpha",
    scope: { level: "workspace", ref: "workspace_alpha" }, mode: "approval_only", state: "published",
    effectiveFrom: "2026-08-01T00:00:00.000Z", expiresAt: null, killSwitch: false, maximumActionsPerRun: null,
  };
}

function valveContext(entity: ActionValveContext["entity"]): ActionValveContext {
  return {
    workspaceRef: "workspace_alpha", accountGroupRef: null, accountRef: "account_main",
    internalCategoryRefs: [], campaignRef: "campaign_main", entity,
    evaluatedAt: "2026-08-07T17:00:00.000Z", rules: [rule()], budgetLimits: null,
    protection: { protectedInternalCategoryRefs: [], affectedGeoRefs: [], protectedGeoRefs: [], changeDisposition: "allowed", policyRefs: [] },
  };
}

function pause(entityRef = "campaign_main"): ActionPlan {
  const action: TypedActionIntent = {
    kind: "status_change", entity: { level: "campaign", ref: entityRef }, fromStatus: "ACTIVE", toStatus: "PAUSED",
  };
  return buildActionPlan(action, valveContext({ level: "campaign", ref: entityRef }));
}

function activate(entityRef = "adset_secondary"): ActionPlan {
  const action: TypedActionIntent = {
    kind: "status_change", entity: { level: "adset", ref: entityRef }, fromStatus: "PAUSED", toStatus: "ACTIVE",
  };
  return buildActionPlan(action, valveContext({ level: "adset", ref: entityRef }));
}

function budgetPlan(): ActionPlan {
  return buildActionPlan({
    kind: "budget_change", entity: { level: "campaign", ref: "campaign_main" }, budgetKind: "daily",
    currency: "TRY", beforeDecimal: "100", afterDecimal: "90", budgetOwnerRef: "campaign_main",
  }, {
    ...valveContext({ level: "campaign", ref: "campaign_main" }),
    budgetLimits: {
      currency: "TRY", maximumAbsoluteDeltaDecimal: "20", maximumRelativeDeltaBasisPoints: 2_000,
      limitRefs: ["policy_budget_cap"],
    },
  });
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)]));
  return value;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function rehashPlan(plan: ActionPlan, patch: Record<string, unknown>): ActionPlan {
  const forged = { ...plan, ...patch } as unknown as Record<string, unknown>;
  const { planHash: _old, ...base } = forged;
  return { ...base, planHash: digest(base) } as unknown as ActionPlan;
}

function summary(label: string) {
  return {
    safety: "public_safe" as const,
    before: { label: "Önce", value: `${label} aktif` },
    after: { label: "Sonra", value: `${label} duraklatılmış` },
    evidence: [{ evidenceRef: `evidence_${label}`, label: "Onaylı durum özeti" }],
  };
}

function unit(unitKey: string, actionPlan: ActionPlan, dependencies: readonly string[] = []): ActionProposalStagingUnitInput {
  return {
    unitKey, plan: frozenPlan, actionPlan, workspaceRef: "workspace_alpha", accountRef: "account_main",
    entityRef: actionPlan.action.entity.ref, actionType: actionPlan.actionType, risk: actionPlan.risk,
    actionHash: digest(actionPlan.action), dependencies, summary: summary(unitKey),
  };
}

function input(units = [unit("unit_parent", pause()), unit("unit_child", activate(), ["unit_parent"])]): ActionProposalStagingInput {
  return {
    plan: frozenPlan, workspaceRef: "workspace_alpha", accountRef: "account_main",
    requester: { actorRef: "actor_operator", role: "operator" }, proposedAt, expiresAt, units,
  };
}

describe("ActionProposalStagingService", () => {
  it("typed approval-required planları deterministic bundle ve awaiting lifecycle'a hazırlar", () => {
    const service = new ActionProposalStagingService(policy);
    const first = service.stage(input());
    const second = service.stage(input([...input().units].reverse()));
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      persistenceRequested: true, persisted: false, authority: "none", executionPerformed: false,
      lifecycle: { executionAuthority: "none" },
    });
    expect(first.lifecycle.units.every((item) => item.state === "awaiting_approval")).toBe(true);
    expect(first.auditEventIntents.every((item) => item.persistRequested && !item.persisted && item.executionAuthority === "none")).toBe(true);
    expect(first.bundle.units.find((item) => item.scope.entityRef === "adset_secondary")?.dependencies).toEqual([
      first.bundle.units.find((item) => item.scope.entityRef === "campaign_main")?.unitRef,
    ]);
    expect(first.idempotencyKey).toMatch(/^[a-f0-9]{64}$/);
    expect(first.stagingHash).toMatch(/^[a-f0-9]{64}$/);
    expect(first.bundle.bundleRef).toMatch(/^action_bundle_[a-f0-9]{20}$/);
    expect(first.bundle.units.every((item) => /^action_unit_[a-f0-9]{20}$/.test(item.unitRef))).toBe(true);
    const stagedPlan = first.summaries.find((item) => item.actionPlan.actionType === "status_pause")!.actionPlan;
    expect(stagedPlan.planHash).toBe(pause().planHash);
    expect(Object.isFrozen(stagedPlan)).toBe(true);
    expect(Object.isFrozen(stagedPlan.action)).toBe(true);
    expect(() => { (stagedPlan as { risk: string }).risk = "K4"; }).toThrow();
    expect(stagedPlan.risk).toBe("K2");
  });

  it("K0 no-write ve policy-limited candidate planlarını approval-only write queue'ya almaz", () => {
    const noChange = buildActionPlan({ kind: "no_change", entity: { level: "campaign", ref: "campaign_main" }, reasonRef: "reason_hold" }, valveContext({ level: "campaign", ref: "campaign_main" }));
    expect(() => new ActionProposalStagingService(policy).stage(input([unit("unit_hold", noChange)])))
      .toThrowError(expect.objectContaining({ code: "approval_queue_ineligible" }));

    const actionRule: AutonomyRule = {
      ...rule(), ruleRef: "autonomy_pause", scope: { level: "action_type", actionType: "status_pause" },
      mode: "policy_limited", maximumActionsPerRun: 1,
    };
    const workspacePolicy = { ...rule(), mode: "policy_limited" as const, maximumActionsPerRun: 2 };
    const candidate = buildActionPlan(
      { kind: "status_change", entity: { level: "campaign", ref: "campaign_main" }, fromStatus: "ACTIVE", toStatus: "PAUSED" },
      { ...valveContext({ level: "campaign", ref: "campaign_main" }), rules: [workspacePolicy, actionRule] },
    );
    expect(candidate.disposition).toBe("policy_limited_candidate");
    expect(() => new ActionProposalStagingService(policy).stage(input([unit("unit_candidate", candidate)])))
      .toThrowError(expect.objectContaining({ code: "approval_queue_ineligible" }));
  });

  it("raw Graph action ve recomputed plan hash'i typed boundary'de reddeder", () => {
    const valid = pause();
    const raw = rehashPlan(valid, { action: { kind: "raw_graph", path: "/act_secret", field: "daily_budget" } });
    expect(() => new ActionProposalStagingService(policy).stage(input([{
      ...unit("unit_raw", valid), actionPlan: raw, actionHash: digest(raw.action),
    }]))) .toThrowError(expect.objectContaining({ code: "invalid_plan" }));
  });

  it("forged capability recomputed hash ile dahi geçemez", () => {
    const valid = pause();
    const forged = rehashPlan(valid, { capabilities: { ...valid.capabilities, canExecute: true } });
    expect(() => new ActionProposalStagingService(policy).stage(input([{
      ...unit("unit_forged", forged), actionHash: digest(forged.action),
    }]))) .toThrowError(expect.objectContaining({ code: "invalid_plan" }));
  });

  it("budgetKind eksik veya bilinmiyorsa recomputed hash ile dahi staging'e giremez", () => {
    const valid = budgetPlan();
    const { budgetKind: _budgetKind, ...missingAction } = valid.action as Extract<TypedActionIntent, { kind: "budget_change" }>;
    const missing = rehashPlan(valid, { action: missingAction });
    const unknown = rehashPlan(valid, { action: { ...valid.action, budgetKind: "weekly" } });
    for (const forged of [missing, unknown]) {
      expect(() => new ActionProposalStagingService(policy).stage(input([{
        ...unit("unit_budget_kind", valid), actionPlan: forged, actionHash: digest(forged.action),
      }]))) .toThrowError(expect.objectContaining({ code: "invalid_plan" }));
    }
  });

  it("cross-workspace/account ve mixed frozen plan unitlerini reddeder", () => {
    const valid = unit("unit_scope", pause());
    expect(() => new ActionProposalStagingService(policy).stage(input([{ ...valid, workspaceRef: "workspace_other" }])))
      .toThrowError(expect.objectContaining({ code: "mixed_scope" }));
    expect(() => new ActionProposalStagingService(policy).stage(input([{
      ...valid, plan: { ...frozenPlan, revision: 3 },
    }]))) .toThrowError(expect.objectContaining({ code: "mixed_plan" }));
  });

  it("actionType/risk/entity/action hash tutarsızlıklarını ayrı ayrı reddeder", () => {
    const valid = unit("unit_exact", pause());
    for (const patch of [
      { actionType: "status_activate" }, { risk: "K3" }, { entityRef: "campaign_other" }, { actionHash: h("9") },
    ]) {
      expect(() => new ActionProposalStagingService(policy).stage(input([{ ...valid, ...patch } as never])))
        .toThrowError(expect.objectContaining({ code: "invalid_plan" }));
    }
  });

  it("duplicate/conflicting unit ve dependency topology hatalarını fail-closed reddeder", () => {
    const first = unit("unit_same", pause());
    expect(() => new ActionProposalStagingService(policy).stage(input([first, first])))
      .toThrowError(expect.objectContaining({ code: "duplicate_unit" }));
    const conflicting = unit("unit_conflict", pause());
    expect(() => new ActionProposalStagingService(policy).stage(input([first, conflicting])))
      .toThrowError();
    expect(() => new ActionProposalStagingService(policy).stage(input([unit("unit_missing_dep", pause(), ["unit_absent"])])))
      .toThrowError(expect.objectContaining({ code: "invalid_dependency" }));
    expect(() => new ActionProposalStagingService(policy).stage(input([unit("unit_a", pause(), ["unit_b"]), unit("unit_b", activate("campaign_other"), ["unit_a"])])))
      .toThrowError();
  });

  it("approval/execute/authority injection ve unsafe public summary kabul etmez", () => {
    const service = new ActionProposalStagingService(policy);
    expect(() => service.stage({ ...input(), approval: true, execute: true, authority: "admin" } as never))
      .toThrowError(expect.objectContaining({ code: "invalid_input" }));
    const unsafe = unit("unit_unsafe", pause());
    expect(() => service.stage(input([{
      ...unsafe, summary: { ...unsafe.summary, after: { label: "Sonra", value: "Bearer abcdefghijklmnopqrstuvwxyz" } },
    }]))) .toThrowError(expect.objectContaining({ code: "unsafe_summary" }));
  });

  it("200 unit sınırını aşmaz ve policy requester injection'ını initialize aşamasında kapatır", () => {
    const tooMany = Array.from({ length: 201 }, (_, index) => unit(`unit_many_${index}`, pause(`campaign_many_${index}`)));
    expect(() => new ActionProposalStagingService(policy).stage(input(tooMany)))
      .toThrowError(expect.objectContaining({ code: "invalid_input" }));
    expect(() => new ActionProposalStagingService({ ...policy, requesterRoles: ["owner"] }).stage(input()))
      .toThrowError(expect.objectContaining({ code: "approval_policy_rejected" }));
  });

  it("hata mesajında raw input ayrıntısını yansıtmaz", () => {
    try {
      new ActionProposalStagingService(policy).stage({ ...input(), rawGraph: "secret_payload" } as never);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ActionProposalStagingError);
      expect((error as Error).message).toBe("Eylem önerisi güvenli biçimde kuyruğa hazırlanamadı");
      expect((error as Error).message).not.toContain("secret_payload");
    }
  });
});
