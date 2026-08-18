import { describe, expect, it } from "vitest";

import { createP06LimitedAutonomyAdmission, P06LimitedAutonomyAdmissionError } from "@/domain/actions/p06-limited-autonomy-admission";
import type { ActionPlan } from "@/domain/actions/autonomy-valve";

const hash = "a".repeat(64);
const plan = Object.freeze({ schemaVersion: "action-plan/1.0.0", actionType: "status_pause", risk: "K2",
  action: Object.freeze({ kind: "status_change", entity: Object.freeze({ level: "adset", ref: "adset_external" }), fromStatus: "ACTIVE", toStatus: "PAUSED" }),
  effectiveAutonomy: "policy_limited", disposition: "policy_limited_candidate", reasonCodes: Object.freeze(["bounded_policy_candidate_only"]), trace: Object.freeze([]), budgetDelta: null,
  capabilities: Object.freeze({ canExecute: false, canWriteMeta: false, canGrantApproval: false, canAccessRawGraph: false }), contextHash: hash, planHash: hash }) as ActionPlan;
const input = { memberRef: "ad_set_public", membershipHash: hash, entityRef: "adset_external", accountRef: "account_external", campaignRef: "campaign_external",
  actionPlan: plan, contextHash: hash, effectiveGuideSetHash: hash, resolutionHash: hash, dataHealthReportHash: hash, protectionHash: hash,
  autonomyEvidenceHash: hash, maximumActionsPerRun: 2, actionsAlreadyReserved: 0, admittedAt: "2026-08-18T10:00:00.000Z", expiresAt: "2026-08-18T10:05:00.000Z" };

describe("P06 limited autonomy admission", () => {
  it("creates a frozen authority-none atomic quota reservation intent", () => {
    const result = createP06LimitedAutonomyAdmission(input);
    expect(result.payload).toMatchObject({ action: "status_pause", quotaOrdinal: 1, maximumActionsPerRun: 2,
      authority: { canApprove: false, canExecute: false, canWriteMeta: false, canDispatchNetwork: false } });
    expect(result.admissionHash).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.isFrozen(result.payload)).toBe(true);
  });
  it("fails closed for exhausted quota and approval-only or malformed direction", () => {
    expect(() => createP06LimitedAutonomyAdmission({ ...input, actionsAlreadyReserved: 2 })).toThrowError(P06LimitedAutonomyAdmissionError);
    expect(() => createP06LimitedAutonomyAdmission({ ...input, actionPlan: { ...plan, disposition: "approval_required" } })).toThrowError(P06LimitedAutonomyAdmissionError);
    expect(() => createP06LimitedAutonomyAdmission({ ...input, actionPlan: { ...plan, action: { ...plan.action, fromStatus: "PAUSED", toStatus: "ACTIVE" } } as ActionPlan })).toThrowError(P06LimitedAutonomyAdmissionError);
  });
});
