import { describe, expect, it } from "vitest";

import {
  ACTION_APPROVAL_POLICY_VERSION,
  createActionBundle,
  initializeApprovalLifecycle,
  type ApprovalPolicy,
} from "@/domain/actions/approval-lifecycle";
import {
  ApprovalPolicyRegistryError,
  assertValidApprovalPolicyDefinition,
  createApprovalPolicyDraft,
  disableApprovalPolicy,
  publishApprovalPolicy,
  reviseApprovalPolicyDraft,
  resolvePublishedApprovalPolicy,
  resolvePublishedExistingPostPolicy,
} from "@/domain/actions/approval-policy-registry";

function policy(policyRef = "policy_existing_post", revision = 1): ApprovalPolicy {
  return {
    version: ACTION_APPROVAL_POLICY_VERSION, policyRef, revision, autonomyMode: "approval_only",
    requesterRoles: ["owner", "admin", "analyst"],
    approverRoles: [{ risk: "K4", roles: ["owner", "admin"] }],
    grantConsumerRoles: ["owner", "admin"], separationOfDutiesRisks: ["K4"],
    maximumProtectionEvidenceAgeSeconds: 3_600,
    maximumProposalLifetimeSeconds: 86_400,
    maximumGrantLifetimeSeconds: 900,
  };
}

function draft(policyRef = "policy_existing_post") {
  return createApprovalPolicyDraft({
    workspaceRef: "workspace_alpha", policy: policy(policyRef),
    effectiveFrom: "2026-08-07T00:00:00.000Z", expiresAt: null,
    normalizedBy: { actorRef: "actor_analyst", role: "analyst" },
  });
}

function published(policyRef = "policy_existing_post") {
  return publishApprovalPolicy({
    draft: draft(policyRef), actor: { actorRef: "actor_owner", role: "owner" },
    decisionRef: "decision_publish_policy", reasonRef: "reason_human_reviewed",
    publishedAt: "2026-08-07T10:00:00.000Z",
  });
}

describe("reviewed ApprovalPolicy definition registry", () => {
  it("stores the exact supplied roles/lifetime without inventing values or authority", () => {
    const definition = draft();
    expect(definition).toMatchObject({
      state: "draft", applicability: { actionType: "existing_post_promotion", risk: "K4" },
      policy: {
        requesterRoles: ["admin", "analyst", "owner"],
        approverRoles: [{ risk: "K4", roles: ["admin", "owner"] }],
        grantConsumerRoles: ["admin", "owner"], maximumProtectionEvidenceAgeSeconds: 3_600,
        maximumProposalLifetimeSeconds: 86_400,
        maximumGrantLifetimeSeconds: 900,
      },
      authority: { canApprove: false, canGrant: false, canExecute: false, canWriteMeta: false, canPromoteGuidance: false },
    });
    expect(definition.policyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(definition.canonicalHash).toMatch(/^[a-f0-9]{64}$/);
    expect(Object.isFrozen(definition.policy.approverRoles[0]!.roles)).toBe(true);
    const shorter = createApprovalPolicyDraft({ workspaceRef: "workspace_alpha",
      policy: { ...policy(), maximumProposalLifetimeSeconds: 3_600 },
      effectiveFrom: "2026-08-07T00:00:00.000Z", expiresAt: null,
      normalizedBy: { actorRef: "actor_admin", role: "admin" } });
    expect(shorter.policyHash).not.toBe(definition.policyHash);
    expect(shorter.canonicalHash).not.toBe(definition.canonicalHash);
    const fresherEvidence = createApprovalPolicyDraft({ workspaceRef: "workspace_alpha",
      policy: { ...policy(), maximumProtectionEvidenceAgeSeconds: 1_800 },
      effectiveFrom: "2026-08-07T00:00:00.000Z", expiresAt: null,
      normalizedBy: { actorRef: "actor_admin", role: "admin" } });
    expect(fresherEvidence.policyHash).not.toBe(definition.policyHash);
    expect(fresherEvidence.canonicalHash).not.toBe(definition.canonicalHash);
  });

  it("requires explicit owner/admin publication and makes exact command replay deterministic", () => {
    const source = draft();
    const command = {
      draft: source, actor: { actorRef: "actor_admin", role: "admin" as const },
      decisionRef: "decision_publish_policy", reasonRef: "reason_human_reviewed",
      publishedAt: "2026-08-07T10:00:00.000Z",
    };
    const first = publishApprovalPolicy(command);
    expect(publishApprovalPolicy(command)).toEqual(first);
    expect(first).toMatchObject({ revision: 2, state: "published", policy: { revision: 2 },
      provenance: { publishedByRole: "admin", publicationDecisionRef: "decision_publish_policy" } });
    expect(() => publishApprovalPolicy({ ...command, actor: { actorRef: "actor_analyst", role: "analyst" } as never }))
      .toThrowError(expect.objectContaining({ code: "publish_forbidden" }));
    expect(() => publishApprovalPolicy({ ...command, actor: { actorRef: "actor_analyst", role: "owner" } }))
      .toThrowError(expect.objectContaining({ code: "publish_forbidden" }));
  });

  it("requires an explicit K2/K3 applicability and never falls back to the K4 promotion policy", () => {
    const budgetPolicy = {
      ...policy("policy_budget_decrease"),
      approverRoles: [{ risk: "K2" as const, roles: ["owner" as const] }],
      separationOfDutiesRisks: ["K2" as const],
    };
    const draft = createApprovalPolicyDraft({
      workspaceRef: "workspace_alpha", policy: budgetPolicy,
      applicability: { actionType: "budget_decrease", risk: "K2" },
      effectiveFrom: "2026-08-07T00:00:00.000Z", expiresAt: null,
      normalizedBy: { actorRef: "actor_analyst", role: "analyst" },
    });
    const publishedBudget = publishApprovalPolicy({
      draft, actor: { actorRef: "actor_owner", role: "owner" },
      decisionRef: "decision_budget_policy", reasonRef: "reason_budget_policy",
      publishedAt: "2026-08-07T10:00:00.000Z",
    });
    expect(resolvePublishedApprovalPolicy({
      workspaceRef: "workspace_alpha", evaluatedAt: "2026-08-07T12:00:00.000Z",
      applicability: { actionType: "budget_decrease", risk: "K2" },
      definitions: [draft, publishedBudget],
    }).source.applicability).toEqual({ actionType: "budget_decrease", risk: "K2" });
    expect(() => resolvePublishedExistingPostPolicy({
      workspaceRef: "workspace_alpha", evaluatedAt: "2026-08-07T12:00:00.000Z",
      definitions: [draft, publishedBudget],
    })).toThrowError(expect.objectContaining({ code: "not_found" }));
    expect(() => createApprovalPolicyDraft({
      workspaceRef: "workspace_alpha", policy: budgetPolicy,
      applicability: { actionType: "budget_increase", risk: "K3" },
      effectiveFrom: "2026-08-07T00:00:00.000Z", expiresAt: null,
      normalizedBy: { actorRef: "actor_analyst", role: "analyst" },
    })).toThrowError(expect.objectContaining({ code: "invalid_input" }));
  });

  it("resolves exactly one latest published-active policy and produces lifecycle-compatible policyHash", () => {
    const definition = published();
    const resolved = resolvePublishedExistingPostPolicy({
      workspaceRef: "workspace_alpha", evaluatedAt: "2026-08-07T12:00:00.000Z", definitions: [draft(), definition],
    });
    expect(resolved.policyHash).toBe(definition.policyHash);
    expect(resolved.source).toMatchObject({ policyRef: definition.policyRef, revision: definition.revision,
      applicability: { actionType: "existing_post_promotion", risk: "K4" } });
    const bundle = createActionBundle({
      bundleRef: "bundle_policy_test", plan: { planRef: "plan_policy_test", revision: 1, planHash: "a".repeat(64) },
      units: [{
        unitRef: "unit_policy_test", scope: { workspaceRef: "workspace_alpha", accountRef: "account_alpha",
          entityRef: "adset_alpha", actionType: "existing_post_promotion" }, risk: "K4",
        sourceHash: "b".repeat(64), contextHash: "c".repeat(64), specHash: "d".repeat(64), dependencies: [],
        requester: { actorRef: "actor_analyst", role: "analyst" },
        proposedAt: "2026-08-07T12:00:00.000Z", expiresAt: "2026-08-07T13:00:00.000Z",
      }],
    });
    expect(initializeApprovalLifecycle({ bundle, policy: resolved.policy, initializedAt: "2026-08-07T12:00:00.000Z",
      eventRef: "event_policy_initialized" }).lifecycle.policy.policyHash).toBe(definition.policyHash);
  });

  it("disable is a new revision and suppresses the former published policy", () => {
    const current = published();
    const disabled = disableApprovalPolicy({
      current, actor: { actorRef: "actor_owner", role: "owner" },
      decisionRef: "decision_disable_policy", reasonRef: "reason_policy_retired",
      disabledAt: "2026-08-07T11:00:00.000Z",
    });
    expect(disabled).toMatchObject({ revision: 3, state: "disabled", policy: { revision: 3 }, provenance: {
      publishedByActorRef: "actor_owner", publicationDecisionRef: "decision_publish_policy",
      publishedAt: "2026-08-07T10:00:00.000Z", disabledByActorRef: "actor_owner",
      disabledByRole: "owner", disableDecisionRef: "decision_disable_policy",
      disableReasonRef: "reason_policy_retired", disabledAt: "2026-08-07T11:00:00.000Z",
    } });
    expect(() => resolvePublishedExistingPostPolicy({ workspaceRef: "workspace_alpha",
      evaluatedAt: "2026-08-07T12:00:00.000Z", definitions: [draft(), current, disabled] }))
      .toThrowError(expect.objectContaining({ code: "not_found" }));
    expect(() => disableApprovalPolicy({ current: disabled, actor: { actorRef: "actor_owner", role: "owner" },
      decisionRef: "decision_disable_again", reasonRef: "reason_already_disabled",
      disabledAt: "2026-08-07T12:00:00.000Z" })).toThrowError(expect.objectContaining({ code: "invalid_transition" }));
    expect(() => disableApprovalPolicy({ current, actor: { actorRef: "actor_owner", role: "owner" },
      decisionRef: "decision_disable_early", reasonRef: "reason_invalid_clock",
      disabledAt: "2026-08-07T09:59:59.000Z" })).toThrowError(expect.objectContaining({ code: "invalid_input" }));
    expect(reviseApprovalPolicyDraft({ current: disabled, policy: policy(disabled.policyRef, 4),
      effectiveFrom: "2026-08-08T00:00:00.000Z", expiresAt: null,
      normalizedBy: { actorRef: "actor_admin", role: "admin" } }))
      .toMatchObject({ revision: 4, previousHash: disabled.canonicalHash, state: "draft" });
  });

  it("revises the same policy append-only while the old publication remains active until replacement publish", () => {
    const oldPublished = published();
    const revisedDraft = reviseApprovalPolicyDraft({
      current: oldPublished,
      policy: { ...policy(oldPublished.policyRef, 3), maximumProtectionEvidenceAgeSeconds: 1_800,
        maximumProposalLifetimeSeconds: 43_200,
        maximumGrantLifetimeSeconds: 1_800,
        requesterRoles: ["owner", "admin"] },
      effectiveFrom: "2026-08-07T00:00:00.000Z", expiresAt: null,
      normalizedBy: { actorRef: "actor_analyst", role: "analyst" },
    });
    expect(revisedDraft).toMatchObject({ policyRef: oldPublished.policyRef, revision: 3, state: "draft",
      policy: { revision: 3, maximumProtectionEvidenceAgeSeconds: 1_800, maximumProposalLifetimeSeconds: 43_200,
        maximumGrantLifetimeSeconds: 1_800, requesterRoles: ["admin", "owner"] },
      provenance: { publishedByActorRef: null, disabledByActorRef: null } });
    expect(resolvePublishedExistingPostPolicy({ workspaceRef: "workspace_alpha",
      evaluatedAt: "2026-08-07T12:00:00.000Z", definitions: [draft(), oldPublished, revisedDraft] }).source.revision).toBe(2);
    const replacement = publishApprovalPolicy({
      draft: revisedDraft, actor: { actorRef: "actor_admin", role: "admin" },
      decisionRef: "decision_publish_replacement", reasonRef: "reason_reviewed_revision",
      publishedAt: "2026-08-07T11:30:00.000Z",
    });
    const resolved = resolvePublishedExistingPostPolicy({ workspaceRef: "workspace_alpha",
      evaluatedAt: "2026-08-07T12:00:00.000Z", definitions: [draft(), oldPublished, revisedDraft, replacement] });
    expect(resolved).toMatchObject({ policy: { revision: 4, maximumProtectionEvidenceAgeSeconds: 1_800,
      maximumProposalLifetimeSeconds: 43_200,
      maximumGrantLifetimeSeconds: 1_800 },
      source: { policyRef: oldPublished.policyRef, revision: 4 } });
    expect(() => reviseApprovalPolicyDraft({ ...({ current: revisedDraft, policy: policy(oldPublished.policyRef, 4),
      effectiveFrom: "2026-08-07T00:00:00.000Z", expiresAt: null,
      normalizedBy: { actorRef: "actor_analyst", role: "analyst" } }) }))
      .toThrowError(expect.objectContaining({ code: "invalid_transition" }));
  });

  it("fails closed for zero, multiple, future, expired, duplicate, or cross-tenant candidates", () => {
    const one = published("policy_one");
    const two = published("policy_two");
    const resolve = (definitions: readonly typeof one[], evaluatedAt = "2026-08-07T12:00:00.000Z") =>
      resolvePublishedExistingPostPolicy({ workspaceRef: "workspace_alpha", evaluatedAt,
        definitions: definitions.flatMap((definition) => [draft(definition.policyRef), definition]) });
    expect(() => resolve([])).toThrowError(expect.objectContaining({ code: "not_found" }));
    expect(() => resolve([one, two])).toThrowError(expect.objectContaining({ code: "ambiguous" }));
    expect(() => resolve([one], "2026-08-06T12:00:00.000Z")).toThrowError(expect.objectContaining({ code: "not_found" }));
    expect(() => resolve([one, one])).toThrowError(expect.objectContaining({ code: "corrupt_registry" }));
    expect(() => resolvePublishedExistingPostPolicy({ workspaceRef: "workspace_other",
      evaluatedAt: "2026-08-07T12:00:00.000Z", definitions: [draft(one.policyRef), one] }))
      .toThrowError(expect.objectContaining({ code: "workspace_scope_mismatch" }));
    const expiringDraft = createApprovalPolicyDraft({ workspaceRef: "workspace_alpha", policy: policy("policy_expired"),
        effectiveFrom: "2026-08-07T00:00:00.000Z", expiresAt: "2026-08-07T11:00:00.000Z",
        normalizedBy: { actorRef: "actor_admin", role: "admin" } });
    const expiring = publishApprovalPolicy({
      draft: expiringDraft,
      actor: { actorRef: "actor_owner", role: "owner" }, decisionRef: "decision_publish_expiring",
      reasonRef: "reason_timeboxed", publishedAt: "2026-08-07T01:00:00.000Z",
    });
    expect(() => resolvePublishedExistingPostPolicy({ workspaceRef: "workspace_alpha",
      evaluatedAt: "2026-08-07T12:00:00.000Z", definitions: [expiringDraft, expiring] }))
      .toThrowError(expect.objectContaining({ code: "not_found" }));
    expect(() => resolvePublishedExistingPostPolicy({ workspaceRef: "workspace_alpha",
      evaluatedAt: "2026-08-07T12:00:00.000Z", definitions: [one] }))
      .toThrowError(expect.objectContaining({ code: "corrupt_registry" }));
  });

  it("rejects malformed payloads and authority escalation even when object shape is replayed", () => {
    expect(() => createApprovalPolicyDraft({
      workspaceRef: "workspace_alpha", policy: { ...policy(), maximumGrantLifetimeSeconds: 0 },
      effectiveFrom: "2026-08-07T00:00:00.000Z", expiresAt: null,
      normalizedBy: { actorRef: "actor_admin", role: "admin" },
    })).toThrow(ApprovalPolicyRegistryError);
    for (const maximumProposalLifetimeSeconds of [0, 604_801, 1.5]) {
      expect(() => createApprovalPolicyDraft({ workspaceRef: "workspace_alpha",
        policy: { ...policy(), maximumProposalLifetimeSeconds },
        effectiveFrom: "2026-08-07T00:00:00.000Z", expiresAt: null,
        normalizedBy: { actorRef: "actor_admin", role: "admin" } })).toThrow(ApprovalPolicyRegistryError);
    }
    for (const maximumProtectionEvidenceAgeSeconds of [0, 604_801, 1.5]) {
      expect(() => createApprovalPolicyDraft({ workspaceRef: "workspace_alpha",
        policy: { ...policy(), maximumProtectionEvidenceAgeSeconds },
        effectiveFrom: "2026-08-07T00:00:00.000Z", expiresAt: null,
        normalizedBy: { actorRef: "actor_admin", role: "admin" } })).toThrow(ApprovalPolicyRegistryError);
    }
    const { maximumProtectionEvidenceAgeSeconds: _missingEvidenceAge, ...legacyEvidencePolicy } = policy();
    expect(() => createApprovalPolicyDraft({ workspaceRef: "workspace_alpha", policy: legacyEvidencePolicy as never,
      effectiveFrom: "2026-08-07T00:00:00.000Z", expiresAt: null,
      normalizedBy: { actorRef: "actor_admin", role: "admin" } })).toThrow(ApprovalPolicyRegistryError);
    const { maximumProposalLifetimeSeconds: _missing, ...legacyPolicy } = policy();
    expect(() => createApprovalPolicyDraft({ workspaceRef: "workspace_alpha", policy: legacyPolicy as never,
      effectiveFrom: "2026-08-07T00:00:00.000Z", expiresAt: null,
      normalizedBy: { actorRef: "actor_admin", role: "admin" } })).toThrow(ApprovalPolicyRegistryError);
    const definition = draft();
    expect(() => assertValidApprovalPolicyDefinition({ ...definition,
      authority: { ...definition.authority, canApprove: true } })).toThrow(ApprovalPolicyRegistryError);
    expect(() => createApprovalPolicyDraft({ ...({
      workspaceRef: "workspace_alpha", policy: policy(), effectiveFrom: "2026-08-07T00:00:00.000Z",
      expiresAt: null, normalizedBy: { actorRef: "actor_admin", role: "admin" }, freeText: "approve everyone",
    }) } as never)).toThrow(ApprovalPolicyRegistryError);
  });
});
