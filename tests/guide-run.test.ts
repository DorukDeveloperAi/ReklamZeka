import { describe, expect, it } from "vitest";

import {
  GuideRunError, appendGuideRunTransition, createGuideRun, manualGuideRunIdempotencyKey,
  resolveGuideRunDisposition, scheduledGuideRunIdempotencyKey, verifyGuideRun,
} from "@/domain/guides/guide-run";

const revisionHash = "a".repeat(64);
const leaseToken = "123e4567-e89b-42d3-a456-426614174000";

function scheduledRun() {
  return createGuideRun({ workspaceRef: "workspace_main", guideRef: "guide_main", guideRevisionHash: revisionHash,
    trigger: { kind: "scheduled", scheduledFor: "2026-08-17T06:00:00.000Z" }, occurredAt: "2026-08-17T06:00:01.000Z" });
}

function next<T extends ReturnType<typeof scheduledRun>>(run: T, toState: Parameters<typeof appendGuideRunTransition>[1]["toState"], at: string,
  reasonCode: string | null = null) {
  return appendGuideRunTransition(run, { expectedHeadHash: run.headEventHash, toState, occurredAt: at,
    ...(toState === "claimed" ? { leaseToken, leaseUntil: "2026-08-17T06:10:00.000Z" }
      : run.state === "due" ? {} : { leaseToken }), reasonCode });
}

describe("canonical Guide run", () => {
  it("enforces the exact lifecycle and immutable event hash chain", () => {
    let run = scheduledRun();
    run = next(run, "claimed", "2026-08-17T06:00:02.000Z");
    run = next(run, "scope_frozen", "2026-08-17T06:00:03.000Z");
    run = next(run, "analyzing", "2026-08-17T06:00:04.000Z");
    run = next(run, "recorded", "2026-08-17T06:00:05.000Z");
    run = next(run, "staged", "2026-08-17T06:00:06.000Z", "candidate_ready");
    run = next(run, "completed", "2026-08-17T06:00:07.000Z");
    expect(run.events.map((event) => event.toState)).toEqual([
      "due", "claimed", "scope_frozen", "analyzing", "recorded", "staged", "completed",
    ]);
    expect(run.lease).toBeNull();
    expect(verifyGuideRun(run)).toBe(true);
    expect(verifyGuideRun({ ...run, events: run.events.map((event, index) => index === 3
      ? { ...event, reasonCode: "tampered" } : event) })).toBe(false);
  });

  it("rejects skipped states, stale heads, wrong leases and expired leases", () => {
    const due = scheduledRun();
    expect(() => next(due, "scope_frozen", "2026-08-17T06:00:02.000Z")).toThrow(GuideRunError);
    expect(() => appendGuideRunTransition(due, { expectedHeadHash: "b".repeat(64), toState: "claimed",
      occurredAt: "2026-08-17T06:00:02.000Z", leaseToken, leaseUntil: "2026-08-17T06:10:00.000Z" }))
      .toThrowError(expect.objectContaining({ code: "head_conflict" }));
    const claimed = next(due, "claimed", "2026-08-17T06:00:02.000Z");
    expect(() => appendGuideRunTransition(claimed, { expectedHeadHash: claimed.headEventHash, toState: "scope_frozen",
      occurredAt: "2026-08-17T06:00:03.000Z", leaseToken: "223e4567-e89b-42d3-a456-426614174000" }))
      .toThrowError(expect.objectContaining({ code: "lease_required" }));
    expect(() => appendGuideRunTransition(claimed, { expectedHeadHash: claimed.headEventHash, toState: "scope_frozen",
      occurredAt: "2026-08-17T06:10:00.000Z", leaseToken }))
      .toThrowError(expect.objectContaining({ code: "lease_expired" }));
  });

  it("makes missed and failed runs terminal", () => {
    const due = scheduledRun();
    const missed = appendGuideRunTransition(due, { expectedHeadHash: due.headEventHash, toState: "missed",
      occurredAt: "2026-08-17T06:00:02.000Z", reasonCode: "older_due_slot" });
    expect(verifyGuideRun(missed)).toBe(true);
    expect(() => appendGuideRunTransition(missed, { expectedHeadHash: missed.headEventHash, toState: "claimed",
      occurredAt: "2026-08-17T06:00:03.000Z", leaseToken, leaseUntil: "2026-08-17T06:10:00.000Z" }))
      .toThrowError(expect.objectContaining({ code: "invalid_transition" }));

    const claimed = next(due, "claimed", "2026-08-17T06:00:02.000Z");
    const failed = next(claimed, "failed", "2026-08-17T06:00:03.000Z", "analysis_failed");
    expect(failed).toMatchObject({ state: "failed", lease: null });
    expect(verifyGuideRun(failed)).toBe(true);
  });

  it("keeps scheduled and manual idempotency deterministic and separate", () => {
    const scheduled = scheduledGuideRunIdempotencyKey(revisionHash, "2026-08-17T06:00:00Z");
    expect(scheduled).toBe(scheduledGuideRunIdempotencyKey(revisionHash, "2026-08-17T06:00:00.000Z"));
    const manual = manualGuideRunIdempotencyKey(revisionHash, "request_refresh_one");
    expect(manual).not.toBe(scheduled);
    expect(createGuideRun({ workspaceRef: "workspace_main", guideRef: "guide_main", guideRevisionHash: revisionHash,
      trigger: { kind: "manual", requestRef: "request_refresh_one" }, occurredAt: "2026-08-17T06:00:00Z" }).idempotencyKey)
      .toBe(manual);
  });

  it("gates recommendation and authority-free candidates by mode and data quality", () => {
    const authorityFreeCandidate = { candidateRef: "candidate_budget_one", candidateHash: "c".repeat(64), action: "budget_increase" as const };
    expect(resolveGuideRunDisposition({ mode: "observe_analyze", actionAllowlist: [], dataQuality: "ready",
      analysisOutcome: "finding", recommendationRef: null, candidate: null })).toMatchObject({ state: "no_action", reason: "mode_observe" });
    expect(() => resolveGuideRunDisposition({ mode: "observe_analyze", actionAllowlist: [], dataQuality: "ready",
      analysisOutcome: "finding", recommendationRef: "recommendation_one", candidate: null }))
      .toThrowError(expect.objectContaining({ code: "mode_violation" }));
    expect(resolveGuideRunDisposition({ mode: "recommend", actionAllowlist: [], dataQuality: "ready",
      analysisOutcome: "finding", recommendationRef: "recommendation_one", candidate: null }))
      .toMatchObject({ state: "no_action", reason: "recommendation_only", recommendationRef: "recommendation_one" });
    expect(resolveGuideRunDisposition({ mode: "recommend", actionAllowlist: ["budget_increase"], dataQuality: "ready",
      analysisOutcome: "finding", recommendationRef: "recommendation_one", candidate: null }))
      .toMatchObject({ state: "no_action", candidate: null,
        authority: { canApprove: false, canExecute: false, canWriteMeta: false } });
    expect(() => resolveGuideRunDisposition({ mode: "recommend", actionAllowlist: ["budget_increase"], dataQuality: "ready",
      analysisOutcome: "finding", recommendationRef: "recommendation_one", candidate: authorityFreeCandidate }))
      .toThrowError(expect.objectContaining({ code: "mode_violation" }));
    const staged = resolveGuideRunDisposition({ mode: "prepare_human_approval", actionAllowlist: ["budget_increase"], dataQuality: "ready",
      analysisOutcome: "finding", recommendationRef: "recommendation_one", candidate: authorityFreeCandidate });
    expect(staged).toMatchObject({ state: "staged", candidate: { routing: "human_approval" },
      authority: { canApprove: false, canExecute: false, canWriteMeta: false, canEnableAutomation: false } });
    expect(resolveGuideRunDisposition({ mode: "limited_autonomy", actionAllowlist: ["budget_increase"], dataQuality: "ready",
      analysisOutcome: "finding", recommendationRef: "recommendation_one", candidate: authorityFreeCandidate }))
      .toMatchObject({ state: "staged", candidate: { action: "budget_increase", routing: "limited_autonomy_review" } });
    const rename = { candidateRef: "candidate_rename_one", candidateHash: "d".repeat(64), action: "campaign_rename" as const };
    expect(resolveGuideRunDisposition({ mode: "limited_autonomy", actionAllowlist: ["campaign_rename"], dataQuality: "ready",
      analysisOutcome: "finding", recommendationRef: "recommendation_one", candidate: rename }))
      .toMatchObject({ state: "staged", candidate: { action: "campaign_rename", routing: "human_approval" } });
    expect(resolveGuideRunDisposition({ mode: "limited_autonomy", actionAllowlist: ["budget_increase"], dataQuality: "stale",
      analysisOutcome: "finding", recommendationRef: "recommendation_one", candidate: authorityFreeCandidate }))
      .toMatchObject({ state: "held", reason: "data_stale", recommendationRef: null, candidate: null });
  });
});
