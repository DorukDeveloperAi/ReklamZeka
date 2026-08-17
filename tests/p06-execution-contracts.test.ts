import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { admitP06LimitedAutonomy, createP06ExecutionContract, createP06KillGate, createP06RollbackProposal, resolveP06HumanDecision, type P06AdmissionInput, type P06ExecutionObservation, type P06ExecutionPath } from "@/domain/actions/p06-execution-contracts";

const now = "2026-08-17T09:00:00.000Z"; const later = "2026-08-17T10:00:00.000Z";
const gate = (stage: "admission" | "post_claim" | "pre_dispatch" | "read_after_write", enabled = false, sequence = 1, previousReceiptHash: string | null = null, capturedAt = now) => createP06KillGate({ source: "server_trusted_runtime", sequence, previousReceiptHash, stage, workspaceRef: "workspace_main", enabled, capturedAt, expiresAt: later });
const guideSetHash = createHash("sha256").update("[]").digest("hex");
const overlap = { workspaceRef: "workspace_main", entityRef: "campaign_main", market: "yerli", effectiveMode: "limited_autonomy", guideEvidence: [], effectiveGuideSetHash: guideSetHash, resolutionHash: "b".repeat(64), autonomousActions: ["budget_decrease"] } as unknown as P06AdmissionInput["effectiveGuideOverlap"];
const admission = (overrides: Partial<P06AdmissionInput> = {}): P06AdmissionInput => ({ workspaceRef: "workspace_main", accountRef: "account_main", entityRef: "campaign_main", sliceRef: "slice_main", market: "yerli", action: "budget_decrease", mode: "limited_autonomy", activeGuide: true, guideSliceRef: "slice_main", guideMarket: "yerli", effectiveGuideSetHash: guideSetHash, resolutionHash: "b".repeat(64), effectiveGuideOverlap: overlap, window: { opensAt: "2026-08-17T08:00:00.000Z", closesAt: later }, evaluatedAt: now, allowlist: ["budget_decrease"], currentBudgetMinor: 1000, absoluteDeltaMinor: 100, relativeDeltaBasisPoints: 100, maximumAbsoluteDeltaMinor: 100, maximumRelativeDeltaBasisPoints: 100, actionsAlreadyInRun: 0, maximumActionsPerRun: 1, killGates: [gate("admission")], ...overrides });
const steps = ["lease", "idempotency", "current_read", "expected_before", "typed_mutation", "read_after_write", "already_applied_no_write", "ambiguous_read_before_retry", "immutable_terminal", "release"] as const;
const outcomes: Record<P06ExecutionPath, readonly P06ExecutionObservation["outcome"][]> = { normal_write: ["ok", "ok", "ok", "ok", "ok", "ok", "skipped", "skipped", "terminal", "ok"], already_applied: ["ok", "ok", "already_applied", "skipped", "skipped", "skipped", "already_applied", "skipped", "terminal", "ok"], ambiguous_transport: ["ok", "ok", "ok", "ok", "ambiguous_transport", "ambiguous_transport", "skipped", "resolved_after_read", "terminal", "ok"] };
const trace = (path: P06ExecutionPath, replace: Partial<Record<(typeof steps)[number], P06ExecutionObservation["outcome"]>> = {}) => steps.map((step, i) => ({ step, outcome: replace[step] ?? outcomes[path][i]! }));
const executionGates = () => { const first = gate("post_claim", false, 1, null, "2026-08-17T08:57:00.000Z"); const second = gate("pre_dispatch", false, 2, first.snapshotHash, "2026-08-17T08:58:00.000Z"); return [first, second, gate("read_after_write", false, 3, second.snapshotHash, "2026-08-17T08:59:00.000Z")]; };
const executionIdentity = { leaseRef: "lease_main", leaseTokenHash: "e".repeat(64), epoch: 1, fenceHash: "f".repeat(64) };
const humanBinding = { actionUnitHash: "1".repeat(64), proposalHash: "2".repeat(64), freshnessHash: "3".repeat(64), humanPresence: { authorizationRef: "authorization_main", issuedAt: now, expiresAt: later, present: true as const } };

describe("P06 schema-free closed contracts", () => {
  it("keeps defer distinct; action-bound rename is human-only and create/raw are denied even to human", () => {
    expect(resolveP06HumanDecision({ decision: "defer", actorRef: "operator_main", action: "campaign_rename", ...humanBinding }).disposition).toBe("deferred");
    expect(resolveP06HumanDecision({ decision: "request_changes", actorRef: "operator_main", action: "campaign_rename", ...humanBinding }).disposition).toBe("changes_requested");
    expect(resolveP06HumanDecision({ decision: "approve", actorRef: "operator_main", action: "create", ...humanBinding }).disposition).toBe("denied");
    expect(admitP06LimitedAutonomy(admission({ action: "adset_rename" })).reasons).toContain("rename_human_only");
  });
  it("fails autonomy closed for missing caps and all Guide/scope/market/window/quota rechecks", () => {
    expect(admitP06LimitedAutonomy(admission({ maximumAbsoluteDeltaMinor: null })).reasons).toContain("absolute_cap");
    expect(admitP06LimitedAutonomy(admission({ maximumRelativeDeltaBasisPoints: null })).reasons).toContain("relative_cap");
    const result = admitP06LimitedAutonomy(admission({ activeGuide: false, mode: "recommend", guideMarket: "yabanci", guideSliceRef: "slice_other", actionsAlreadyInRun: 1 }));
    expect(result.reasons).toEqual(expect.arrayContaining(["active_guide_missing", "mode_not_limited_autonomy", "market_mismatch", "slice_mismatch", "per_run_limit"]));
  });
  it("authenticates versioned timed kill snapshots at every required boundary", () => {
    expect(admitP06LimitedAutonomy(admission({ killGates: [gate("admission", true)] })).reasons).toContain("kill_switch_admission");
    const first = gate("post_claim", true, 1, null, "2026-08-17T08:57:00.000Z"); const second = gate("pre_dispatch", false, 2, first.snapshotHash, "2026-08-17T08:58:00.000Z"); const third = gate("read_after_write", false, 3, second.snapshotHash, "2026-08-17T08:59:00.000Z");
    expect(createP06ExecutionContract({ workspaceRef: "workspace_main", evaluatedAt: now, path: "normal_write", ...executionIdentity, trace: trace("normal_write"), killGates: [first, second, third] }).reasons).toContain("kill_switch_post_claim");
    const forged = { ...gate("admission"), enabled: true };
    expect(() => admitP06LimitedAutonomy(admission({ killGates: [forged] }))).toThrow();
  });
  it("accepts exactly the three closed ten-step variants and never universalizes already-applied", () => {
    for (const path of Object.keys(outcomes) as P06ExecutionPath[]) expect(createP06ExecutionContract({ workspaceRef: "workspace_main", evaluatedAt: now, path, ...executionIdentity, trace: trace(path), killGates: executionGates() }).disposition).toBe("ready_for_disabled_executor");
    expect(createP06ExecutionContract({ workspaceRef: "workspace_main", evaluatedAt: now, path: "normal_write", ...executionIdentity, trace: trace("normal_write", { already_applied_no_write: "already_applied" }), killGates: executionGates() }).reasons).toContain("path_outcome_mismatch");
  });
  it("requires kill or stale after lease to go immutable-terminal then release", () => {
    const good = trace("normal_write", { typed_mutation: "stale_fence", read_after_write: "skipped", already_applied_no_write: "skipped", ambiguous_read_before_retry: "skipped" });
    expect(createP06ExecutionContract({ workspaceRef: "workspace_main", evaluatedAt: now, path: "normal_write", ...executionIdentity, trace: good, killGates: executionGates() }).reasons).toEqual(["interrupt_must_terminal_then_release", "stale_fence"]);
    const precise = [{ step: "lease", outcome: "ok" }, { step: "idempotency", outcome: "ok" }, { step: "current_read", outcome: "kill" }, { step: "immutable_terminal", outcome: "terminal" }, { step: "release", outcome: "ok" }] as const;
    expect(createP06ExecutionContract({ workspaceRef: "workspace_main", evaluatedAt: now, path: "normal_write", ...executionIdentity, trace: precise, killGates: executionGates() }).reasons).toEqual(["kill_switch_trace"]);
  });
  it("creates an immutable deterministic rollback proposal before, never instead of, separate approval", () => {
    const input = { executionRef: "execution_main", executionTerminalHash: "c".repeat(64), actionCorrelationRef: "correlation_main", targetRef: "campaign_main", action: "budget_decrease" as const, currency: "TRY", observedPreviousValue: "100", proposedValue: "100", observationHash: "d".repeat(64), failureClass: "verification_mismatch" as const, verificationClass: "mismatch" as const, executionTerminal: true, killGates: [gate("admission")], workspaceRef: "workspace_main", evaluatedAt: now };
    const first = createP06RollbackProposal(input); const second = createP06RollbackProposal(input);
    expect(first).toEqual(second); expect(first.disposition).toBe("requires_new_human_approval"); expect(Object.isFrozen(first)).toBe(true);
    expect(createP06RollbackProposal({ ...input, proposedValue: "99" }).reasons).toContain("rollback_not_observed_previous_value");
  });
});
