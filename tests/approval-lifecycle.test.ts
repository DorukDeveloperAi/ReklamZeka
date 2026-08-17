import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ACTION_APPROVAL_POLICY_VERSION,
  ActionApprovalLifecycleError,
  consumeApprovalGrant,
  createActionBundle,
  decideActionUnit,
  initializeApprovalLifecycle,
  refreshApprovalLifecycle,
  type ActionBundle,
  type ActionActor,
  type ActionUnitInput,
  type ApprovalDecisionCommand,
  type ApprovalLifecycle,
  type HumanApprovalAuthorization,
  type UnitFreshness,
} from "@/domain/actions/approval-lifecycle";

const h = (value: string) => value.repeat(64).slice(0, 64);
const plan = { planRef: "plan_daily", revision: 1, planHash: h("a") };
const owner = { actorRef: "actor_owner", role: "owner" as const };
const admin = { actorRef: "actor_admin", role: "admin" as const };
const operator = { actorRef: "actor_operator", role: "operator" as const };
const agent = { actorRef: "actor_agent", role: "agent" as const };

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stableValue(child)]));
  }
  return value;
}

function digest(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(stableValue(value))).digest("hex");
}

function rehashGrant(grant: NonNullable<ApprovalLifecycle["units"][number]["grant"]>) {
  const { grantHash: _grantHash, ...core } = grant;
  return { ...core, grantHash: digest(core) };
}

function validationProbe(lifecycle: ApprovalLifecycle, eventRef: string): void {
  refreshApprovalLifecycle({
    lifecycle, checkedAt: "2026-08-07T10:04:00Z", freshness: freshness(lifecycle.bundle), eventRef,
  });
}

function unit(unitRef: string, dependencies: readonly string[] = [], risk: ActionUnitInput["risk"] = "K3"): ActionUnitInput {
  return {
    unitRef,
    scope: { workspaceRef: "workspace_safe", accountRef: "account_safe", entityRef: `entity_${unitRef}`, actionType: "budget_update" },
    risk,
    sourceHash: h("b"), contextHash: h("c"), specHash: h(unitRef === "unit_parent" ? "d" : "e"),
    dependencies, requester: operator,
    proposedAt: "2026-08-07T10:00:00.000Z", expiresAt: "2026-08-08T10:00:00.000Z",
  };
}

function bundle(units: readonly ActionUnitInput[] = [
  unit("unit_parent"), unit("unit_child", ["unit_parent"], "K4"), unit("unit_independent", [], "K1"),
]): ActionBundle {
  return createActionBundle({ bundleRef: "bundle_daily", plan, units });
}

function start(source = bundle()): ApprovalLifecycle {
  return initializeApprovalLifecycle({
    bundle: source,
    policy: {
      version: ACTION_APPROVAL_POLICY_VERSION,
      policyRef: "policy_approval_only",
      revision: 1,
      requesterRoles: ["operator"],
      approverRoles: [
        { risk: "K1", roles: ["owner", "admin"] },
        { risk: "K3", roles: ["owner", "admin"] },
        { risk: "K4", roles: ["owner"] },
      ],
      grantConsumerRoles: ["owner", "admin"],
      separationOfDutiesRisks: ["K3", "K4"],
      maximumProtectionEvidenceAgeSeconds: 3_600,
      maximumProposalLifetimeSeconds: 86_400,
      maximumGrantLifetimeSeconds: 300,
    },
    initializedAt: "2026-08-07T10:01:00.000Z",
    eventRef: "event_initialized",
  }).lifecycle;
}

function freshness(source: ActionBundle): readonly UnitFreshness[] {
  return source.units.map((entry) => ({
    unitRef: entry.unitRef,
    planRevision: entry.plan.revision,
    planHash: entry.plan.planHash,
    sourceHash: entry.sourceHash,
    contextHash: entry.contextHash,
    specHash: entry.specHash,
  }));
}

function auth(lifecycle: ApprovalLifecycle, unitRef: string, actor: ActionActor = owner): HumanApprovalAuthorization {
  const definition = lifecycle.bundle.units.find((entry) => entry.unitRef === unitRef)!;
  return {
    authorizationRef: `presence_${unitRef}`,
    unitRef,
    unitHash: definition.unitHash,
    scopeHash: definition.scopeHash,
    actor,
    issuedAt: "2026-08-07T10:01:30.000Z",
    expiresAt: "2026-08-07T10:10:00.000Z",
    humanPresence: true,
    canExecute: false,
  };
}

function approve(lifecycle: ApprovalLifecycle, unitRef: string, actor: ActionActor = owner, at = "2026-08-07T10:02:00.000Z") {
  return decideActionUnit(lifecycle, {
    kind: "approve", commandRef: `approve_${unitRef}`, unitRef, actor, decidedAt: at,
    reasonCode: "reviewed_and_approved", freshness: freshness(lifecycle.bundle),
    authorization: auth(lifecycle, unitRef, actor), grantRef: `grant_${unitRef}`,
  });
}

describe("ActionUnit approval lifecycle", () => {
  it("keeps bundle as an immutable DAG and approves only one selected unit", () => {
    const first = bundle();
    const second = bundle();
    expect(first.bundleHash).toBe(second.bundleHash);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.units[0])).toBe(true);
    expect(first.units.find((entry) => entry.unitRef === "unit_child")?.risk).toBe("K4");
    expect(first).not.toHaveProperty("approval");
    expect(first).not.toHaveProperty("execute");

    const result = approve(start(first), "unit_parent");
    expect(result.lifecycle.units.map((entry) => [entry.unitRef, entry.state])).toEqual([
      ["unit_child", "awaiting_approval"],
      ["unit_independent", "awaiting_approval"],
      ["unit_parent", "approved"],
    ]);
    expect(result.lifecycle.units.find((entry) => entry.unitRef === "unit_parent")?.grant).toMatchObject({
      singleUse: true, capability: "approval_evidence_only", canExecute: false, consumedAt: null,
    });
    expect(result).toMatchObject({ executionAuthority: "none", executionPerformed: false });
    expect(result.auditEventIntents.every((event) => event.persistRequested && !event.persisted)).toBe(true);
  });

  it("allows analyst proposal ownership but never treats analyst as an approver", () => {
    const analyst = { actorRef: "actor_analyst", role: "analyst" as const };
    const analystBundle = bundle([{ ...unit("unit_parent"), requester: analyst }]);
    const lifecycle = initializeApprovalLifecycle({
      bundle: analystBundle,
      policy: {
        version: ACTION_APPROVAL_POLICY_VERSION, policyRef: "policy_analyst_request", revision: 1,
        requesterRoles: ["analyst"], approverRoles: [{ risk: "K3", roles: ["owner"] }],
        grantConsumerRoles: ["owner"], separationOfDutiesRisks: ["K3"], maximumProtectionEvidenceAgeSeconds: 3_600,
        maximumProposalLifetimeSeconds: 86_400,
        maximumGrantLifetimeSeconds: 300,
      },
      initializedAt: "2026-08-07T10:01:00Z", eventRef: "event_analyst_request",
    }).lifecycle;
    expect(lifecycle.bundle.units[0]?.requester).toEqual(analyst);
    expect(() => approve(lifecycle, "unit_parent", analyst))
      .toThrowError(expect.objectContaining({ code: "policy_denied" }));
    expect(() => initializeApprovalLifecycle({
      bundle: analystBundle,
      policy: {
        version: ACTION_APPROVAL_POLICY_VERSION, policyRef: "policy_bad_approver", revision: 1,
        requesterRoles: ["analyst"], approverRoles: [{ risk: "K3", roles: ["analyst"] as never }],
        grantConsumerRoles: ["owner"], separationOfDutiesRisks: [], maximumProtectionEvidenceAgeSeconds: 3_600,
        maximumProposalLifetimeSeconds: 86_400,
        maximumGrantLifetimeSeconds: 300,
      },
      initializedAt: "2026-08-07T10:01:00Z", eventRef: "event_bad_approver",
    })).toThrowError(expect.objectContaining({ code: "invalid_input" }));
  });

  it("requires an explicit bounded protection evidence age in the exact lifecycle policy", () => {
    const { policyHash: _policyHash, ...validPolicy } = start().policy;
    for (const maximumProtectionEvidenceAgeSeconds of [0, 604_801, 1.5]) {
      expect(() => initializeApprovalLifecycle({ bundle: bundle(),
        policy: { ...validPolicy, maximumProtectionEvidenceAgeSeconds },
        initializedAt: "2026-08-07T10:01:00.000Z", eventRef: "event_invalid_evidence_age" }))
        .toThrowError(expect.objectContaining({ code: "invalid_input" }));
    }
    const { maximumProtectionEvidenceAgeSeconds: _missing, ...legacyPolicy } = validPolicy;
    expect(() => initializeApprovalLifecycle({ bundle: bundle(), policy: legacyPolicy as never,
      initializedAt: "2026-08-07T10:01:00.000Z", eventRef: "event_missing_evidence_age" }))
      .toThrowError(expect.objectContaining({ code: "invalid_input" }));
  });

  it("cascades rejected, deferred, and changes-requested dependencies without affecting independent units", () => {
    const initial = start();
    const rejected = decideActionUnit(initial, {
      kind: "reject", commandRef: "reject_parent", unitRef: "unit_parent", actor: admin,
      decidedAt: "2026-08-07T10:02:00Z", reasonCode: "budget_constraint",
      freshness: freshness(initial.bundle),
    });
    expect(rejected.lifecycle.units.find((entry) => entry.unitRef === "unit_parent")?.state).toBe("rejected");
    expect(rejected.lifecycle.units.find((entry) => entry.unitRef === "unit_child")?.state).toBe("dependency_failed");
    expect(rejected.lifecycle.units.find((entry) => entry.unitRef === "unit_independent")?.state).toBe("awaiting_approval");

    const changedInitial = start();
    const changed = decideActionUnit(changedInitial, {
      kind: "request_changes", commandRef: "changes_parent", unitRef: "unit_parent", actor: owner,
      decidedAt: "2026-08-07T10:02:00Z", reasonCode: "revise_spec",
      freshness: freshness(changedInitial.bundle),
    });
    expect(changed.lifecycle.units.find((entry) => entry.unitRef === "unit_parent")?.state).toBe("changes_requested");
    expect(changed.lifecycle.units.find((entry) => entry.unitRef === "unit_child")?.state).toBe("dependency_failed");

    const deferredInitial = start();
    const deferred = decideActionUnit(deferredInitial, {
      kind: "defer", commandRef: "defer_parent", unitRef: "unit_parent", actor: owner,
      decidedAt: "2026-08-07T10:02:00Z", reasonCode: "human.deferred",
      freshness: freshness(deferredInitial.bundle),
    });
    expect(deferred.lifecycle.units.find((entry) => entry.unitRef === "unit_parent")?.state).toBe("deferred");
    expect(deferred.lifecycle.units.find((entry) => entry.unitRef === "unit_child")?.state).toBe("dependency_failed");
  });

  it("rejects bundle-wide approval and approve-plus-execute injection", () => {
    const lifecycle = start();
    expect(() => decideActionUnit(lifecycle, {
      kind: "approve", commandRef: "approve_bundle", bundleRef: "bundle_daily", actor: owner,
      decidedAt: "2026-08-07T10:02:00Z", reasonCode: "approve_all", freshness: freshness(lifecycle.bundle),
      authorization: auth(lifecycle, "unit_parent"), grantRef: "grant_bundle",
    } as unknown as ApprovalDecisionCommand)).toThrowError(expect.objectContaining({ code: "invalid_input" }));
    expect(() => decideActionUnit(lifecycle, {
      kind: "approve", commandRef: "approve_execute", unitRef: "unit_parent", actor: owner,
      decidedAt: "2026-08-07T10:02:00Z", reasonCode: "approve", freshness: freshness(lifecycle.bundle),
      authorization: auth(lifecycle, "unit_parent"), grantRef: "grant_execute", execute: true,
    } as unknown as ApprovalDecisionCommand)).toThrowError(expect.objectContaining({ code: "invalid_input" }));
  });

  it("never permits an agent to decide, including defer", () => {
    const lifecycle = start();
    expect(() => decideActionUnit(lifecycle, {
      kind: "defer", commandRef: "defer_by_agent", unitRef: "unit_parent", actor: agent,
      decidedAt: "2026-08-07T10:02:00Z", reasonCode: "human.deferred",
      freshness: freshness(lifecycle.bundle),
    })).toThrowError(expect.objectContaining({ code: "policy_denied" }));
  });

  it("fails stale source/context/spec, superseded revisions and expiry closed with downstream invalidation", () => {
    const initial = start();
    for (const [field, eventRef] of [["sourceHash", "refresh_source"], ["contextHash", "refresh_context"], ["specHash", "refresh_spec"]] as const) {
      const changed = freshness(initial.bundle).map((entry) => entry.unitRef === "unit_parent"
        ? { ...entry, [field]: h("f") } : entry);
      const stale = refreshApprovalLifecycle({
        lifecycle: initial, checkedAt: "2026-08-07T10:02:00Z", freshness: changed, eventRef,
      });
      expect(stale.lifecycle.units.find((entry) => entry.unitRef === "unit_parent")?.state).toBe("stale");
      expect(stale.lifecycle.units.find((entry) => entry.unitRef === "unit_child")?.state).toBe("dependency_failed");
    }

    const newer = freshness(initial.bundle).map((entry) => entry.unitRef === "unit_independent"
      ? { ...entry, planRevision: 2 } : entry);
    expect(refreshApprovalLifecycle({
      lifecycle: initial, checkedAt: "2026-08-07T10:02:00Z", freshness: newer, eventRef: "refresh_revision",
    }).lifecycle.units.find((entry) => entry.unitRef === "unit_independent")?.state).toBe("superseded");

    const expired = refreshApprovalLifecycle({
      lifecycle: initial, checkedAt: "2026-08-08T10:00:00Z",
      freshness: freshness(initial.bundle), eventRef: "refresh_expiry",
    });
    expect(expired.lifecycle.units.every((entry) => entry.state === "expired" || entry.state === "dependency_failed")).toBe(true);
  });

  it("enforces actor role, separation of duties and exact human-presence scope/hash", () => {
    const lifecycle = start();
    expect(() => approve(lifecycle, "unit_child", admin)).toThrowError(expect.objectContaining({ code: "policy_denied" }));
    const requesterAsApprover = { ...lifecycle.bundle.units.find((entry) => entry.unitRef === "unit_parent")!.requester, role: "owner" as const };
    const sameActorBundle = bundle([{
      ...unit("unit_parent"), requester: requesterAsApprover,
    }]);
    const sameActorLifecycle = initializeApprovalLifecycle({
      bundle: sameActorBundle,
      policy: {
        version: ACTION_APPROVAL_POLICY_VERSION, policyRef: "policy_strict", revision: 1,
        requesterRoles: ["owner"], approverRoles: [{ risk: "K3", roles: ["owner"] }],
        grantConsumerRoles: ["owner"], separationOfDutiesRisks: ["K3"], maximumProtectionEvidenceAgeSeconds: 3_600,
        maximumProposalLifetimeSeconds: 86_400,
        maximumGrantLifetimeSeconds: 300,
      },
      initializedAt: "2026-08-07T10:01:00Z", eventRef: "event_same_actor",
    }).lifecycle;
    expect(() => approve(sameActorLifecycle, "unit_parent", requesterAsApprover))
      .toThrowError(expect.objectContaining({ code: "separation_of_duties" }));

    const wrongScope = auth(lifecycle, "unit_parent");
    expect(() => decideActionUnit(lifecycle, {
      kind: "approve", commandRef: "approve_wrong_scope", unitRef: "unit_parent", actor: owner,
      decidedAt: "2026-08-07T10:02:00Z", reasonCode: "reviewed_reason", freshness: freshness(lifecycle.bundle),
      authorization: { ...wrongScope, scopeHash: h("9") }, grantRef: "grant_wrong_scope",
    })).toThrowError(expect.objectContaining({ code: "authorization_mismatch" }));
    expect(() => decideActionUnit(lifecycle, {
      kind: "approve", commandRef: "approve_wrong_actor", unitRef: "unit_parent", actor: owner,
      decidedAt: "2026-08-07T10:02:00Z", reasonCode: "reviewed_reason", freshness: freshness(lifecycle.bundle),
      authorization: { ...auth(lifecycle, "unit_parent"), actor: admin }, grantRef: "grant_wrong_actor",
    })).toThrowError(expect.objectContaining({ code: "authorization_mismatch" }));
  });

  it("binds a single-use approval grant to exact unit/hash/scope/plan and never executes", () => {
    const approved = approve(start(), "unit_parent").lifecycle;
    const definition = approved.bundle.units.find((entry) => entry.unitRef === "unit_parent")!;
    const base = {
      lifecycle: approved, grantRef: "grant_unit_parent", unitRef: "unit_parent",
      unitHash: definition.unitHash, scopeHash: definition.scopeHash,
      planRef: definition.plan.planRef, planRevision: definition.plan.revision, planHash: definition.plan.planHash,
      consumer: admin, consumedAt: "2026-08-07T10:03:00Z", freshness: freshness(approved.bundle),
      eventRef: "consume_parent", purpose: "present_to_action_valve" as const, execute: false as const,
    };
    expect(() => consumeApprovalGrant({ ...base, unitHash: h("9") }))
      .toThrowError(expect.objectContaining({ code: "authorization_mismatch" }));
    expect(() => consumeApprovalGrant({ ...base, scopeHash: h("8") }))
      .toThrowError(expect.objectContaining({ code: "authorization_mismatch" }));
    expect(() => consumeApprovalGrant({ ...base, planHash: h("7") }))
      .toThrowError(expect.objectContaining({ code: "authorization_mismatch" }));
    expect(() => consumeApprovalGrant({ ...base, execute: true } as never))
      .toThrowError(expect.objectContaining({ code: "invalid_input" }));

    const consumed = consumeApprovalGrant(base);
    expect(consumed).toMatchObject({ executionAuthority: "none", executionPerformed: false });
    expect(consumed.lifecycle.units.find((entry) => entry.unitRef === "unit_parent")?.grant).toMatchObject({
      consumedAt: "2026-08-07T10:03:00.000Z", consumedBy: admin, canExecute: false,
    });
    expect(() => consumeApprovalGrant({ ...base, lifecycle: consumed.lifecycle, eventRef: "consume_replay" }))
      .toThrowError(expect.objectContaining({ code: "grant_used" }));
  });

  it("rejects consumption when dependencies are not approved or the grant is expired", () => {
    const childApproved = approve(start(), "unit_child").lifecycle;
    const child = childApproved.bundle.units.find((entry) => entry.unitRef === "unit_child")!;
    expect(() => consumeApprovalGrant({
      lifecycle: childApproved, grantRef: "grant_unit_child", unitRef: child.unitRef,
      unitHash: child.unitHash, scopeHash: child.scopeHash,
      planRef: child.plan.planRef, planRevision: child.plan.revision, planHash: child.plan.planHash,
      consumer: owner, consumedAt: "2026-08-07T10:03:00Z", freshness: freshness(childApproved.bundle),
      eventRef: "consume_child", purpose: "present_to_action_valve", execute: false,
    })).toThrowError(expect.objectContaining({ code: "dependency_failed" }));

    const approved = approve(start(), "unit_parent").lifecycle;
    const parent = approved.bundle.units.find((entry) => entry.unitRef === "unit_parent")!;
    expect(() => consumeApprovalGrant({
      lifecycle: approved, grantRef: "grant_unit_parent", unitRef: parent.unitRef,
      unitHash: parent.unitHash, scopeHash: parent.scopeHash,
      planRef: parent.plan.planRef, planRevision: parent.plan.revision, planHash: parent.plan.planHash,
      consumer: owner, consumedAt: "2026-08-07T10:07:01Z", freshness: freshness(approved.bundle),
      eventRef: "consume_expired", purpose: "present_to_action_valve", execute: false,
    })).toThrowError(expect.objectContaining({ code: "grant_expired" }));
  });

  it("rejects missing dependencies, cycles, wildcards and unstable replay inputs", () => {
    expect(() => bundle([unit("unit_child", ["unit_missing"])]))
      .toThrowError(expect.objectContaining({ code: "missing_dependency" }));
    expect(() => bundle([unit("unit_a", ["unit_b"]), unit("unit_b", ["unit_a"])]))
      .toThrowError(expect.objectContaining({ code: "dependency_cycle" }));
    expect(() => bundle([{ ...unit("unit_parent"), scope: { ...unit("unit_parent").scope, accountRef: "*" } }]))
      .toThrow(ActionApprovalLifecycleError);

    const lifecycle = start();
    expect(() => approve(lifecycle, "unit_parent", owner, "2026-08-07T10:02:00Z")).not.toThrow();
    expect(approve(lifecycle, "unit_parent", owner, "2026-08-07T10:02:00Z").lifecycle.traceHash)
      .toBe(approve(start(), "unit_parent", owner, "2026-08-07T10:02:00Z").lifecycle.traceHash);
  });

  it("rejects duplicate event and grant references even when attacker recomputes hashes", () => {
    const initial = start();
    expect(() => decideActionUnit(initial, {
      kind: "approve", commandRef: "event_initialized", unitRef: "unit_parent", actor: owner,
      decidedAt: "2026-08-07T10:02:00Z", reasonCode: "duplicate_event_ref",
      freshness: freshness(initial.bundle), authorization: auth(initial, "unit_parent"), grantRef: "grant_unique",
    })).toThrowError(expect.objectContaining({ code: "invalid_transition" }));

    const parentApproved = approve(initial, "unit_parent").lifecycle;
    const bothApproved = decideActionUnit(parentApproved, {
      kind: "approve", commandRef: "approve_independent", unitRef: "unit_independent", actor: admin,
      decidedAt: "2026-08-07T10:03:00Z", reasonCode: "reviewed_independent",
      freshness: freshness(parentApproved.bundle), authorization: auth(parentApproved, "unit_independent", admin),
      grantRef: "grant_independent",
    }).lifecycle;
    const parentGrant = bothApproved.units.find((entry) => entry.unitRef === "unit_parent")!.grant!;
    const forgedUnits = bothApproved.units.map((entry) => entry.unitRef !== "unit_independent" ? entry : {
      ...entry, grant: rehashGrant({ ...entry.grant!, grantRef: parentGrant.grantRef }),
    });
    expect(() => validationProbe({ ...bothApproved, units: forgedUnits }, "probe_duplicate_grant"))
      .toThrowError(expect.objectContaining({ code: "invalid_input" }));

    const forgedTrace = bothApproved.trace.map((event, index) => {
      if (index !== 1) return event;
      const { eventHash: _eventHash, ...core } = event;
      const changedCore = { ...core, eventRef: bothApproved.trace[0]!.eventRef };
      return { ...changedCore, eventHash: digest(changedCore) };
    });
    expect(() => validationProbe({ ...bothApproved, trace: forgedTrace, traceHash: digest(forgedTrace) }, "probe_duplicate_event"))
      .toThrowError(expect.objectContaining({ code: "invalid_input" }));
  });

  it("rejects forged grant actors, consumption pairs, and decision metadata", () => {
    const approved = approve(start(), "unit_parent").lifecycle;
    const approvedIndex = approved.units.findIndex((entry) => entry.unitRef === "unit_parent");
    const approvedUnit = approved.units[approvedIndex]!;
    const analyst = { actorRef: "actor_analyst", role: "analyst" as const };
    const forgeUnit = (changes: Record<string, unknown>): ApprovalLifecycle => ({
      ...approved,
      units: approved.units.map((entry, index) => index === approvedIndex ? { ...entry, ...changes } : entry),
    }) as ApprovalLifecycle;

    expect(() => validationProbe(forgeUnit({
      decisionActor: analyst,
      grant: rehashGrant({ ...approvedUnit.grant!, approver: analyst }),
    }), "probe_forged_approver")).toThrowError(expect.objectContaining({ code: "invalid_input" }));

    expect(() => validationProbe(forgeUnit({
      grant: rehashGrant({ ...approvedUnit.grant!, consumedAt: "2026-08-07T10:03:00.000Z", consumedBy: null }),
    }), "probe_incomplete_consumption")).toThrowError(expect.objectContaining({ code: "invalid_input" }));

    expect(() => validationProbe(forgeUnit({
      grant: rehashGrant({
        ...approvedUnit.grant!, consumedAt: "2026-08-07T10:03:00.000Z", consumedBy: analyst,
      }),
    }), "probe_forged_consumer")).toThrowError(expect.objectContaining({ code: "invalid_input" }));

    expect(() => validationProbe(forgeUnit({ decisionRef: null }), "probe_incomplete_decision"))
      .toThrowError(expect.objectContaining({ code: "invalid_input" }));
    expect(() => validationProbe(forgeUnit({ decisionActor: admin }), "probe_incoherent_decision"))
      .toThrowError(expect.objectContaining({ code: "invalid_input" }));
  });
});
