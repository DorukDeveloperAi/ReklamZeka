import { describe, expect, it } from "vitest";

import { evaluateGuideAgentOperation, guideAgentConversationRef, GuideAgentBoundaryError } from "@/domain/guides/guide-agent-boundary";
import { canonicalGuideWorkspaceRef } from "@/domain/guides/guide-revision";

const workspaceRef = canonicalGuideWorkspaceRef("11111111-1111-4111-a111-111111111111");
const base = { workspaceRef, guideMode: "recommend" as const, dataQuality: "ready" as const, userTransferRef: null };

describe("two Guide agent boundary", () => {
  it("keeps Guide and Daily Agent conversation histories cryptographically distinct", () => {
    const guide = guideAgentConversationRef(workspaceRef, "guide_policy");
    const daily = guideAgentConversationRef(workspaceRef, "daily_analysis");
    expect(guide).not.toBe(daily);
    expect(guide).toMatch(/^guide_conversation_guide_policy_[a-f0-9]{24}$/);
    expect(daily).toMatch(/^guide_conversation_daily_analysis_[a-f0-9]{24}$/);
  });

  it("lets the Guide Agent suggest but requires an explicit user transfer even for form preview", () => {
    const suggestion = evaluateGuideAgentOperation({ ...base, agentKind: "guide_policy",
      operation: "suggest_guide_revision" });
    expect(suggestion).toMatchObject({ decision: "allowed", reason: "ephemeral_suggestion", persistence: "none" });
    expect(evaluateGuideAgentOperation({ ...base, agentKind: "guide_policy",
      operation: "transfer_form_preview" })).toMatchObject({ decision: "denied", reason: "user_action_required" });
    expect(evaluateGuideAgentOperation({ ...base, agentKind: "guide_policy", operation: "transfer_form_preview",
      userTransferRef: `transfer_${"b".repeat(24)}` })).toMatchObject({ decision: "allowed",
      reason: "explicit_user_transfer_preview", persistence: "none" });
  });

  it("lets the Daily Agent record run-owned analysis but never modify a Guide", () => {
    expect(evaluateGuideAgentOperation({ ...base, agentKind: "daily_analysis",
      operation: "analyze_member" })).toMatchObject({ decision: "allowed", persistence: "server_run_ledger" });
    expect(evaluateGuideAgentOperation({ ...base, agentKind: "daily_analysis",
      operation: "record_finding" })).toMatchObject({ decision: "allowed", reason: "run_owned_ledger_record" });
    expect(evaluateGuideAgentOperation({ ...base, agentKind: "daily_analysis",
      operation: "suggest_guide_revision" })).toMatchObject({ decision: "denied", reason: "wrong_agent" });
  });

  it("mode- and data-gates action candidates without granting approval or execution", () => {
    const staged = evaluateGuideAgentOperation({ ...base, agentKind: "daily_analysis",
      operation: "stage_action_candidate", guideMode: "prepare_human_approval" });
    expect(staged).toMatchObject({ decision: "allowed", reason: "mode_allows_candidate",
      authority: { canSaveGuide: false, canActivateGuide: false, canApprove: false, canExecute: false, canWriteMeta: false } });
    expect(evaluateGuideAgentOperation({ ...base, agentKind: "daily_analysis",
      operation: "stage_action_candidate", dataQuality: "partial", guideMode: "limited_autonomy" }))
      .toMatchObject({ decision: "held", reason: "data_quality_hold" });
    expect(evaluateGuideAgentOperation({ ...base, agentKind: "daily_analysis",
      operation: "stage_action_candidate", guideMode: "recommend" }))
      .toMatchObject({ decision: "denied", reason: "mode_forbids_candidate" });
    expect(evaluateGuideAgentOperation({ ...base, agentKind: "daily_analysis",
      operation: "record_recommendation", guideMode: "observe_analyze" }))
      .toMatchObject({ decision: "denied", reason: "mode_forbids_candidate" });
    expect(evaluateGuideAgentOperation({ ...base, agentKind: "daily_analysis",
      operation: "record_recommendation", guideMode: "recommend", dataQuality: "empty" }))
      .toMatchObject({ decision: "held", reason: "data_quality_hold" });
  });

  it("denies Guide save/activation, approval, execution and Meta write to both agents", () => {
    for (const agentKind of ["guide_policy", "daily_analysis"] as const) {
      for (const operation of ["save_guide_revision", "activate_guide_revision", "approve_action", "execute_action", "write_meta"] as const) {
        expect(evaluateGuideAgentOperation({ ...base, agentKind, operation })).toMatchObject({
          decision: "denied", reason: "authority_forbidden", persistence: "none",
        });
      }
    }
  });

  it("rejects malformed scope and transfer references", () => {
    expect(() => evaluateGuideAgentOperation({ ...base, workspaceRef: "workspace_raw", agentKind: "guide_policy",
      operation: "suggest_guide_revision" })).toThrowError(GuideAgentBoundaryError);
    expect(() => evaluateGuideAgentOperation({ ...base, agentKind: "guide_policy",
      operation: "transfer_form_preview", userTransferRef: "transfer_raw" })).toThrowError(GuideAgentBoundaryError);
  });
});
