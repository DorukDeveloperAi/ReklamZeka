import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createGuideRevision } from "@/domain/guides/guide-revision";
import { resolveEffectiveGuideOverlap } from "@/domain/guides/effective-guide-overlap";
import {
  createP06ExecutionContractService,
  type P06KillGate,
  type P06TrustedPort,
} from "@/domain/actions/p06-execution-contracts";
const now = "2026-08-17T09:00:00.000Z",
  later = "2026-08-17T10:00:00.000Z";
const stable = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(stable)
    : v && typeof v === "object"
      ? Object.fromEntries(
          Object.entries(v)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, x]) => [k, stable(x)]),
        )
      : v;
const h = (v: unknown) =>
  createHash("sha256")
    .update(JSON.stringify(stable(v)))
    .digest("hex");
const rev = createGuideRevision({
  workspaceRef: "workspace_main",
  guideRef: "guide_main",
  revision: 1,
  previousRevisionHash: null,
  sliceRef: "slice_main",
  market: "yerli",
  freeText: "Kanıt.",
  strict: {
    budgetRefs: [],
    rollbackConditions: [],
    budgetInterpretation: null,
  },
  schedule: {
    frequency: "daily",
    timezone: "Europe/Istanbul",
    localTime: "09:00",
  },
  mode: "limited_autonomy",
  actionAllowlist: ["budget_decrease"],
});
const bindings = [
  {
    revision: rev,
    restrictions: [],
    numericCaps: [
      {
        capRef: "cap_q",
        action: "budget_decrease" as const,
        kind: "maximum_actions_per_run" as const,
        value: 2,
        currency: null,
      },
      {
        capRef: "cap_a",
        action: "budget_decrease" as const,
        kind: "maximum_absolute_budget_delta_minor" as const,
        value: 100,
        currency: "TRY" as const,
      },
      {
        capRef: "cap_r",
        action: "budget_decrease" as const,
        kind: "maximum_relative_budget_delta_basis_points" as const,
        value: 100,
        currency: null,
      },
    ],
    unresolvedConflictRefs: [],
  },
];
const overlap = resolveEffectiveGuideOverlap({
  workspaceRef: "workspace_main",
  entityRef: "campaign_main",
  market: "yerli",
  guides: bindings,
});
const gates = (
  stages: readonly any[],
  ex: string,
  lease: string,
  fence: string,
  enabled = false,
): readonly P06KillGate[] => {
  let p: string | null = null;
  return stages.map((stage, i) => {
    const core = {
      version: "p06-kill-gate/1.3.0" as const,
      source: "trusted_receipt_port" as const,
      sequence: i + 1,
      previousReceiptHash: p,
      stage,
      workspaceRef: "workspace_main",
      executionRef: ex,
      leaseTokenHash: lease,
      fenceHash: fence,
      enabled,
      capturedAt: `2026-08-17T08:${55 + i}:00.000Z`,
      expiresAt: later,
    };
    p = h(core);
    return { ...core, snapshotHash: p };
  });
};
const port: P06TrustedPort = {
  admission: (q) => {
    const budget = {
      currentBudgetMinor: 1000,
      absoluteDeltaMinor: 10,
      relativeDeltaBasisPoints: 10,
      actionsAlreadyInRun: 0,
    };
    const receiptCore = {
      version: "p06-active-head/1.0",
      workspaceRef: q.workspaceRef,
      accountRef: q.accountRef,
      entityRef: q.entityRef,
      sliceRef: q.sliceRef,
      market: q.market,
      guideEvidence: overlap.guideEvidence,
      budget,
    };
    const receiptHash = h(receiptCore);
    return {
      activeHead: {
        workspaceRef: q.workspaceRef,
        accountRef: q.accountRef,
        entityRef: q.entityRef,
        sliceRef: q.sliceRef,
        market: q.market,
        bindings,
        overlap,
        receiptCore,
        receiptHash,
      },
      budget,
      gates: gates(
        ["admission"],
        `execution_${receiptHash.slice(0, 16)}`,
        receiptHash,
        receiptHash,
      ),
    };
  },
  human: (q) => ({
    authorizationRef: "authorization_main",
    issuedAt: now,
    expiresAt: later,
    bindingHash: h({
      actorRef: q.actorRef,
      action: q.action,
      decision: q.decision,
      actionUnitRef: q.actionUnitRef,
      actionUnitHash: q.actionUnitHash,
      proposalRef: q.proposalRef,
      proposalHash: q.proposalHash,
      evaluatedAt: q.evaluatedAt,
    }),
  }),
  execution: (q) =>
    gates(
      ["post_claim", "pre_dispatch", "read_after_write"],
      q.executionRef,
      q.leaseTokenHash,
      q.fenceHash,
    ),
  rollback: (q) => {
    const terminalCore = {
      version: "p06-terminal/1.0",
      workspaceRef: q.workspaceRef,
      executionRef: q.executionRef,
      targetRef: q.targetRef,
      action: q.action,
      failure: "verification_mismatch",
      verification: "mismatch",
    };
    const observationCore = {
      version: "p06-observation/1.0",
      workspaceRef: q.workspaceRef,
      executionRef: q.executionRef,
      targetRef: q.targetRef,
      action: q.action,
      currency: "TRY",
      previousMinor: 100,
      postMinor: 90,
      previousStatus: null,
      postStatus: null,
    };
    return {
      terminalHash: h(terminalCore),
      terminalCore,
      observationRef: "observation_main",
      observationHash: h(observationCore),
      observationCore,
      currency: "TRY",
      previousMinor: 100,
      postMinor: 90,
      previousStatus: null,
      postStatus: null,
      failure: "verification_mismatch",
      verification: "mismatch",
    };
  },
};
const s = createP06ExecutionContractService(port);
describe("P06 trusted boundary", () => {
  it("does not expose per-call trusted evidence and admits only active exact head", () =>
    expect(
      s.admit({
        workspaceRef: "workspace_main",
        accountRef: "account_main",
        entityRef: "campaign_main",
        sliceRef: "slice_main",
        market: "yerli",
        action: "budget_decrease",
        window: { opensAt: "2026-08-17T08:00:00.000Z", closesAt: later },
        evaluatedAt: now,
      }).disposition,
    ).toBe("admitted_for_disabled_executor"));
  it("binds human proof and holds raw/ambiguous drift", () => {
    expect(
      s.humanDecision({
        decision: "defer",
        actorRef: "operator_main",
        action: "budget_decrease",
        actionUnitRef: "actionunit_main",
        actionUnitHash: "1".repeat(64),
        proposalRef: "proposal_main",
        proposalHash: "2".repeat(64),
        evaluatedAt: now,
      }).disposition,
    ).toBe("deferred");
    expect(
      s.execution({
        workspaceRef: "workspace_main",
        executionRef: "execution_main",
        leaseTokenHash: "d".repeat(64),
        fenceHash: "e".repeat(64),
        epoch: 1,
        path: "ambiguous_transport",
        trace: [],
        evaluatedAt: now,
      }).disposition,
    ).toBe("held");
  });
});
describe("P06 hostile inputs", () => {
  it("keeps raw graph and create actions human-denied", () => {
    expect(
      s.humanDecision({
        decision: "approve",
        actorRef: "operator_main",
        action: "raw_graph",
        actionUnitRef: "actionunit_main",
        actionUnitHash: "1".repeat(64),
        proposalRef: "proposal_main",
        proposalHash: "2".repeat(64),
        evaluatedAt: now,
      }).disposition,
    ).toBe("denied");
  });
  it("rejects malformed references and non-canonical trusted evidence", () => {
    expect(() =>
      s.admit({
        workspaceRef: "bad",
        accountRef: "account_main",
        entityRef: "campaign_main",
        sliceRef: "slice_main",
        market: "yerli",
        action: "budget_decrease",
        window: { opensAt: "2026-08-17T08:00:00.000Z", closesAt: later },
        evaluatedAt: now,
      }),
    ).toThrow();
    const forged = createP06ExecutionContractService({
      ...port,
      admission: () => null,
    });
    expect(() =>
      forged.admit({
        workspaceRef: "workspace_main",
        accountRef: "account_main",
        entityRef: "campaign_main",
        sliceRef: "slice_main",
        market: "yerli",
        action: "budget_decrease",
        window: { opensAt: "2026-08-17T08:00:00.000Z", closesAt: later },
        evaluatedAt: now,
      }),
    ).toThrow();
  });
});

describe("P06 interruption and active-head repros", () => {
  it("never readies a stale-fence interruption", () => {
    const result = s.execution({
      workspaceRef: "workspace_main",
      executionRef: "execution_main",
      leaseTokenHash: "d".repeat(64),
      fenceHash: "e".repeat(64),
      epoch: 1,
      path: "normal_write",
      evaluatedAt: now,
      trace: [
        { step: "lease", outcome: "ok" },
        {
          step: "idempotency",
          outcome: "stale_fence",
          receiptHash: "e".repeat(64),
        },
        { step: "immutable_terminal", outcome: "terminal" },
        { step: "release", outcome: "ok" },
      ],
    });
    expect(result.disposition).toBe("held");
  });
  it("rejects a self-consistent receipt whose current Guide revision has another slice", () => {
    expect(() =>
      s.admit({
        workspaceRef: "workspace_main",
        accountRef: "account_main",
        entityRef: "campaign_main",
        sliceRef: "slice_other",
        market: "yerli",
        action: "budget_decrease",
        window: { opensAt: "2026-08-17T08:00:00.000Z", closesAt: later },
        evaluatedAt: now,
      }),
    ).toThrow();
  });
  it("marks a release substituted at an interruption index as invalid", () => {
    const result = s.execution({
      workspaceRef: "workspace_main",
      executionRef: "execution_main",
      leaseTokenHash: "d".repeat(64),
      fenceHash: "e".repeat(64),
      epoch: 1,
      path: "normal_write",
      evaluatedAt: now,
      trace: [
        { step: "lease", outcome: "ok" },
        { step: "idempotency", outcome: "ok" },
        { step: "current_read", outcome: "ok" },
        { step: "expected_before", outcome: "ok" },
        {
          step: "release",
          outcome: "stale_fence",
          receiptHash: "e".repeat(64),
        },
        { step: "immutable_terminal", outcome: "terminal" },
        { step: "release", outcome: "ok" },
      ],
    });
    expect(result.reasons).toContain("interrupt");
  });
});
