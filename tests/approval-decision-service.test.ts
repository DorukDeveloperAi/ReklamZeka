import { describe, expect, it, vi } from "vitest";

import {
  ApprovalDecisionError,
  ApprovalDecisionService,
  type ApprovalDecisionRepository,
  type ApprovalDecisionSnapshot,
} from "@/application/approval-decision-service";
import {
  ACTION_APPROVAL_POLICY_VERSION,
  createActionBundle,
  decideActionUnit,
  initializeApprovalLifecycle,
  type ApprovalLifecycle,
  type UnitFreshness,
} from "@/domain/actions/approval-lifecycle";
import { SingleUseHumanPresenceChallengeStore } from "@/security/human-presence-challenge";

const workspaceId = "11111111-1111-4111-a111-111111111111";
const userId = "22222222-2222-4222-a222-222222222222";
const unitRef = "action_unit_aaaaaaaaaaaaaaaaaaaa";
const principal = Object.freeze({
  actor: Object.freeze({ userId }), workspaceId, workspaceRef: "workspace_local", readerRef: "actor_owner",
});
const owner = Object.freeze({ userId, workspaceId, role: "owner" as const });
const hash = (character: string) => character.repeat(64);

function lifecycle(requesterRef = "actor_operator"): ApprovalLifecycle {
  const bundle = createActionBundle({
    bundleRef: "action_bundle_bbbbbbbbbbbbbbbbbbbb",
    plan: { planRef: "plan_daily", revision: 1, planHash: hash("a") },
    units: [{
      unitRef,
      scope: { workspaceRef: "workspace_local", accountRef: "account_safe", entityRef: "entity_safe", actionType: "status_pause" },
      risk: "K3",
      sourceHash: hash("b"), contextHash: hash("c"), specHash: hash("d"), dependencies: [],
      requester: { actorRef: requesterRef, role: "operator" },
      proposedAt: "2026-08-07T18:00:00.000Z", expiresAt: "2026-08-08T18:00:00.000Z",
    }],
  });
  return initializeApprovalLifecycle({
    bundle,
    policy: {
      version: ACTION_APPROVAL_POLICY_VERSION, policyRef: "policy_approval", revision: 1,
      requesterRoles: ["operator"], approverRoles: [{ risk: "K3", roles: ["owner", "admin"] }],
      grantConsumerRoles: ["owner"], separationOfDutiesRisks: ["K3"], maximumGrantLifetimeSeconds: 300,
    },
    initializedAt: "2026-08-07T18:00:01.000Z", eventRef: "event_initialized",
  }).lifecycle;
}

function freshness(source: ApprovalLifecycle): readonly UnitFreshness[] {
  return source.bundle.units.map((unit) => ({
    unitRef: unit.unitRef, planRevision: unit.plan.revision, planHash: unit.plan.planHash,
    sourceHash: unit.sourceHash, contextHash: unit.contextHash, specHash: unit.specHash,
  }));
}

function atomicRepository(initial = lifecycle()): ApprovalDecisionRepository & { calls: number } {
  const repository = {
    calls: 0,
    loadForDecision: async () => ({ lifecycle: initial, freshness: freshness(initial) }),
    decideAtomically: async (input) => {
      repository.calls += 1;
      const locked: ApprovalDecisionSnapshot = { lifecycle: initial, freshness: freshness(initial) };
      if (input.expectedTraceHash !== initial.traceHash) throw new Error("concurrency_conflict");
      const command = await input.buildCommand(locked);
      const transition = decideActionUnit(initial, command);
      return {
        outcome: "inserted" as const, lifecycle: transition.lifecycle,
        executionAuthority: "none" as const, executionPerformed: false as const,
      };
    },
  } satisfies ApprovalDecisionRepository & { calls: number };
  return repository;
}

function issued(store: SingleUseHumanPresenceChallengeStore, action: "approve" | "reject" | "request_changes" = "approve") {
  return store.issue({ workspaceId, actorRef: "actor_owner", unitRef, action, now: "2026-08-07T19:00:00.000Z" }).proof;
}

function service(repository: ApprovalDecisionRepository, store: SingleUseHumanPresenceChallengeStore) {
  let sequence = 0;
  return new ApprovalDecisionService(repository, store, () => "2026-08-07T19:00:01.000Z", (prefix) => `${prefix}_test_${++sequence}`);
}

describe("ApprovalDecisionService", () => {
  it.each([
    ["approve", "approved"],
    ["reject", "rejected"],
    ["request_changes", "changes_requested"],
  ] as const)("records exactly one %s decision without execution or Meta authority", async (kind, state) => {
    const repository = atomicRepository();
    const store = new SingleUseHumanPresenceChallengeStore();
    const result = await service(repository, store).decide({
      principal, membership: owner, unitRef, kind, reasonCode: "human_reviewed", humanPresenceProof: issued(store, kind),
    });
    expect(result).toEqual({
      version: "approval-decision-service/1.0.0",
      decision: { unitRef, state, reasonCode: "human_reviewed", decidedAt: "2026-08-07T19:00:01.000Z" },
      authority: { approvalRecorded: true, canGrant: false, canExecute: false, canWriteMeta: false },
    });
    expect(repository.calls).toBe(1);
    expect(JSON.stringify(result)).not.toMatch(/grantRef|authorizationRef|unitHash|scopeHash/);
  });

  it("denies analyst/viewer and caller identity mismatches before reading or consuming proof", async () => {
    for (const membership of [
      { ...owner, role: "analyst" as const },
      { ...owner, role: "viewer" as const },
      { ...owner, userId: "33333333-3333-4333-a333-333333333333" },
      { ...owner, workspaceId: "44444444-4444-4444-a444-444444444444" },
    ]) {
      const repository = atomicRepository();
      const store = new SingleUseHumanPresenceChallengeStore();
      await expect(service(repository, store).decide({
        principal, membership, unitRef, kind: "approve", reasonCode: "reviewed", humanPresenceProof: issued(store),
      })).rejects.toBeInstanceOf(ApprovalDecisionError);
      expect(repository.calls).toBe(0);
    }
  });

  it("re-enforces separation of duties and policy inside the locked domain transition", async () => {
    const store = new SingleUseHumanPresenceChallengeStore();
    await expect(service(atomicRepository(lifecycle("actor_owner")), store).decide({
      principal, membership: owner, unitRef, kind: "approve", reasonCode: "reviewed", humanPresenceProof: issued(store),
    })).rejects.toEqual(expect.objectContaining({ code: "forbidden" }));
  });

  it("rejects replay and action-mismatched human presence proofs", async () => {
    const store = new SingleUseHumanPresenceChallengeStore();
    const replay = issued(store);
    await service(atomicRepository(), store).decide({
      principal, membership: owner, unitRef, kind: "approve", reasonCode: "reviewed", humanPresenceProof: replay,
    });
    await expect(service(atomicRepository(), store).decide({
      principal, membership: owner, unitRef, kind: "approve", reasonCode: "reviewed", humanPresenceProof: replay,
    })).rejects.toEqual(expect.objectContaining({ code: "human_presence_rejected" }));

    const mismatched = issued(store, "reject");
    await expect(service(atomicRepository(), store).decide({
      principal, membership: owner, unitRef, kind: "approve", reasonCode: "reviewed", humanPresenceProof: mismatched,
    })).rejects.toEqual(expect.objectContaining({ code: "human_presence_rejected" }));
  });

  it("does not consume human proof when atomic freshness revalidation fails before the callback", async () => {
    const initial = lifecycle();
    const store = new SingleUseHumanPresenceChallengeStore();
    const proof = issued(store);
    const conflicting: ApprovalDecisionRepository = {
      loadForDecision: async () => ({ lifecycle: initial, freshness: freshness(initial) }),
      decideAtomically: async () => { throw new Error("stale_trace"); },
    };
    await expect(service(conflicting, store).decide({
      principal, membership: owner, unitRef, kind: "approve", reasonCode: "reviewed", humanPresenceProof: proof,
    })).rejects.toEqual(expect.objectContaining({ code: "conflict" }));
    await expect(service(atomicRepository(), store).decide({
      principal, membership: owner, unitRef, kind: "approve", reasonCode: "reviewed", humanPresenceProof: proof,
    })).resolves.toMatchObject({ decision: { state: "approved" } });
  });

  it("fails closed and never leaks a source error", async () => {
    const store = new SingleUseHumanPresenceChallengeStore();
    const repository: ApprovalDecisionRepository = {
      loadForDecision: async () => { throw new Error("postgres://secret@internal"); },
      decideAtomically: vi.fn(),
    };
    await expect(service(repository, store).decide({
      principal, membership: owner, unitRef, kind: "approve", reasonCode: "reviewed", humanPresenceProof: issued(store),
    })).rejects.toEqual(expect.objectContaining({ code: "source_unavailable", message: "Onay kararı güvenli biçimde işlenemedi" }));
  });
});
