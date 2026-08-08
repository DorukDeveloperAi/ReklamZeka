import { describe, expect, it } from "vitest";

import {
  AutonomyRuleRegistryError,
  assertValidAutonomyRuleArtifact,
  createAutonomyRuleDraft,
  disableAutonomyRule,
  publishAutonomyRule,
  resolveAutonomyRules,
  type AutonomyRuleDraftInput,
} from "@/domain/actions/autonomy-rule-registry";

function input(patch: Partial<AutonomyRuleDraftInput> = {}): AutonomyRuleDraftInput {
  return {
    ruleRef: "autonomy_workspace_default",
    revision: 1,
    workspaceRef: "workspace_alpha",
    scope: { level: "workspace", ref: "workspace_alpha" },
    mode: "approval_only",
    effectiveFrom: "2026-08-07T00:00:00.000Z",
    expiresAt: null,
    killSwitch: false,
    maximumActionsPerRun: null,
    normalizedBy: { actorRef: "actor_analyst", role: "analyst" },
    sourceGuidanceRefs: ["guidance_safety", "guidance_budget"],
    ...patch,
  };
}

describe("Autonomy Rule Registry domain", () => {
  it("normalizes deterministic drafts without granting policy, approval, execution, or Meta authority", () => {
    const artifact = createAutonomyRuleDraft(input());
    expect(artifact).toMatchObject({
      state: "draft", revision: 1,
      provenance: {
        sourceGuidanceRefs: ["guidance_budget", "guidance_safety"],
        publishedByActorRef: null,
        publicationDecisionRef: null,
      },
      authority: {
        canExecute: false, canWriteMeta: false, canGrantApproval: false, canPromoteGuidance: false,
      },
    });
    expect(artifact.canonicalHash).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.isFrozen(artifact)).toBe(true);
    expect(Object.isFrozen(artifact.provenance.sourceGuidanceRefs)).toBe(true);
    expect(JSON.stringify(artifact)).not.toContain("freeText");
  });

  it("requires an explicit owner/admin publication decision and produces exact replay", () => {
    const draft = createAutonomyRuleDraft(input());
    const command = {
      draft,
      actor: { actorRef: "actor_owner", role: "owner" as const },
      decisionRef: "decision_publish_rule",
      reasonRef: "reason_owner_confirmed",
      publishedAt: "2026-08-07T12:00:00.000Z",
    };
    const first = publishAutonomyRule(command);
    const replay = publishAutonomyRule(command);
    expect(replay).toEqual(first);
    expect(first).toMatchObject({
      revision: 2, state: "published",
      provenance: {
        publishedByActorRef: "actor_owner", publishedByRole: "owner",
        publicationDecisionRef: "decision_publish_rule", publicationReasonRef: "reason_owner_confirmed",
      },
    });
    expect(() => publishAutonomyRule({ ...command, actor: { actorRef: "actor_analyst", role: "analyst" } as never }))
      .toThrowError(expect.objectContaining({ code: "publish_forbidden" }));
  });

  it("represents disable as a new append-only revision and keeps the last active rule deterministic", () => {
    const published = publishAutonomyRule({
      draft: createAutonomyRuleDraft(input()), actor: { actorRef: "actor_admin", role: "admin" },
      decisionRef: "decision_publish_rule", reasonRef: "reason_reviewed", publishedAt: "2026-08-07T12:00:00.000Z",
    });
    const nextDraft = createAutonomyRuleDraft(input({ revision: 3, mode: "policy_limited", maximumActionsPerRun: 2 }));
    const disabled = disableAutonomyRule({
      current: published, actor: { actorRef: "actor_owner", role: "owner" },
      decisionRef: "decision_disable_rule", reasonRef: "reason_pause_automation", disabledAt: "2026-08-07T13:00:00.000Z",
    });
    expect(disabled).toMatchObject({ revision: 3, state: "disabled" });
    expect(resolveAutonomyRules({ workspaceRef: "workspace_alpha", artifacts: [published, nextDraft] }))
      .toMatchObject([{ ruleRef: published.ruleRef, state: "published", mode: "approval_only" }]);
    expect(resolveAutonomyRules({ workspaceRef: "workspace_alpha", artifacts: [published, disabled] }))
      .toMatchObject([{ ruleRef: published.ruleRef, state: "disabled" }]);
  });

  it.each([
    ["workspace mismatch", () => createAutonomyRuleDraft(input({ scope: { level: "workspace", ref: "workspace_other" } }))],
    ["kill switch widening", () => createAutonomyRuleDraft(input({ mode: "policy_limited", killSwitch: true }))],
    ["raw free text", () => createAutonomyRuleDraft({ ...input(), freeText: "do something" } as never)],
    ["duplicate guidance", () => createAutonomyRuleDraft(input({ sourceGuidanceRefs: ["guidance_one", "guidance_one"] }))],
  ])("rejects %s", (_label, run) => {
    expect(run).toThrow(AutonomyRuleRegistryError);
  });

  it("detects attacker-rehashed authority escalation and cross-workspace resolution", () => {
    const artifact = createAutonomyRuleDraft(input());
    expect(() => assertValidAutonomyRuleArtifact({
      ...artifact, authority: { ...artifact.authority, canWriteMeta: true },
    })).toThrow(AutonomyRuleRegistryError);
    const published = publishAutonomyRule({
      draft: artifact, actor: { actorRef: "actor_owner", role: "owner" },
      decisionRef: "decision_publish_rule", reasonRef: "reason_reviewed", publishedAt: "2026-08-07T12:00:00.000Z",
    });
    expect(() => resolveAutonomyRules({ workspaceRef: "workspace_other", artifacts: [published] }))
      .toThrowError(expect.objectContaining({ code: "workspace_scope_mismatch" }));
  });
});
