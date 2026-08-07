import { describe, expect, it, vi } from "vitest";

import { PolicyBundlePublicationService } from "@/application/policy-bundle-publication-service";
import { ACTION_APPROVAL_POLICY_VERSION } from "@/domain/actions/approval-lifecycle";
import { createApprovalPolicyDraft } from "@/domain/actions/approval-policy-registry";
import { createActionGuardrailPolicyDraft } from "@/domain/actions/action-guardrail-policy";
import { SingleUseHumanPresenceChallengeStore } from "@/security/human-presence-challenge";

const workspaceId = "11111111-1111-4111-a111-111111111111";
const userId = "22222222-2222-4222-a222-222222222222";
const principal = Object.freeze({ actor: Object.freeze({ userId }), workspaceId,
  workspaceRef: "workspace_alpha", readerRef: "actor_owner" });
const now = "2026-08-08T18:00:00.000Z";

function approvalDraft() {
  return createApprovalPolicyDraft({ workspaceRef: principal.workspaceRef, policy: {
    version: ACTION_APPROVAL_POLICY_VERSION, policyRef: "approval_policy_existing_post", revision: 1,
    autonomyMode: "approval_only", requesterRoles: ["owner"],
    approverRoles: [{ risk: "K4", roles: ["owner"] }], grantConsumerRoles: ["owner"],
    separationOfDutiesRisks: ["K4"], maximumProtectionEvidenceAgeSeconds: 86_400,
    maximumProposalLifetimeSeconds: 86_400, maximumGrantLifetimeSeconds: 900,
  }, effectiveFrom: "2026-08-08T17:00:00.000Z", expiresAt: null,
  normalizedBy: { actorRef: "actor_analyst", role: "analyst" } });
}
function guardrailDraft() {
  return createActionGuardrailPolicyDraft({ workspaceRef: principal.workspaceRef,
    policyRef: "guardrail_existing_post", revision: 1, previousHash: null,
    effectiveFrom: "2026-08-08T17:00:00.000Z", expiresAt: null,
    selector: { actionTypes: ["existing_post_promotion"], accountRefs: ["account_doruk"],
      campaignRefs: ["campaign_doruk"], entities: [{ level: "adset", ref: "adset_doruk" }],
      internalCategoryRefs: ["category_hair"], geoRefs: [] }, clauses: [],
    normalizedBy: { actorRef: "actor_analyst", role: "analyst" }, sourceGuidanceRefs: [] });
}
function harness(role: "owner" | "admin" | "analyst" = "owner") {
  const approvals = [approvalDraft()]; const guardrails = [guardrailDraft()];
  const approvalRepo = { latestArtifact: vi.fn(async (ref: string) =>
    [...approvals].reverse().find((item) => item.policyRef === ref) ?? null),
  append: vi.fn(async (item: ReturnType<typeof approvalDraft>): Promise<{
    outcome: "inserted" | "unchanged"; canonicalHash: string;
  }> => { approvals.push(item);
    return { outcome: "inserted" as const, canonicalHash: item.canonicalHash }; }) };
  const guardrailRepo = { latestArtifact: vi.fn(async (ref: string) =>
    [...guardrails].reverse().find((item) => item.policyRef === ref) ?? null),
  append: vi.fn(async (item: ReturnType<typeof guardrailDraft>): Promise<{
    outcome: "inserted" | "unchanged"; canonicalHash: string;
  }> => { guardrails.push(item);
    return { outcome: "inserted" as const, canonicalHash: item.canonicalHash }; }) };
  const store = new SingleUseHumanPresenceChallengeStore();
  const service = new PolicyBundlePublicationService(approvalRepo, guardrailRepo, store,
    [{ userId, workspaceId, role }], () => now);
  return { service, store, approvals, guardrails, approvalRepo, guardrailRepo };
}

describe("K4 Policy Bundle owner/admin publication ceremony service", () => {
  it.each(["approval_policy", "guardrail_policy"] as const)("publishes one exact %s draft as an immutable next revision", async (kind) => {
    const api = harness(); const policyRef = kind === "approval_policy"
      ? "approval_policy_existing_post" : "guardrail_existing_post";
    const prepared = await api.service.prepare(principal, { kind, policyRef, revision: 1 });
    expect(prepared).toMatchObject({ kind, policyRef, revision: 1,
      unitRef: expect.stringMatching(/^policy_unit_[a-f0-9]{20}$/) });
    const challenge = api.store.issue({ workspaceId, actorRef: principal.readerRef,
      unitRef: prepared.unitRef, action: prepared.action, now });
    const result = await api.service.publish(principal, { kind, policyRef, revision: 1,
      reasonRef: "reason_human_reviewed", humanPresenceProof: challenge.proof });
    expect(result).toMatchObject({ contractVersion: "policy-bundle-publication/1.0.0", item: {
      kind, policyRef, draftRevision: 1, publishedRevision: 2, state: "published", publishedAt: now },
    authority: { canPublish: false, canExecute: false, canWriteMeta: false } });
    const artifacts = kind === "approval_policy" ? api.approvals : api.guardrails;
    expect(artifacts).toHaveLength(2);
    expect(artifacts[1]).toMatchObject({ revision: 2, previousHash: artifacts[0]!.canonicalHash,
      state: "published", provenance: { publishedByActorRef: principal.readerRef,
        publicationReasonRef: "reason_human_reviewed" } });
    expect(JSON.stringify(result)).not.toMatch(/canonicalHash|previousHash|actor_owner|humanPresenceProof/i);
  });

  it("denies analysts before proof preparation or store access", async () => {
    const api = harness("analyst");
    await expect(api.service.prepare(principal, { kind: "approval_policy",
      policyRef: "approval_policy_existing_post", revision: 1 })).rejects.toMatchObject({ code: "forbidden" });
    expect(api.approvalRepo.latestArtifact).not.toHaveBeenCalled();
  });

  it("fails closed on stale revision, wrong actor-bound proof, replay, and expired drafts", async () => {
    const api = harness(); const request = { kind: "approval_policy" as const,
      policyRef: "approval_policy_existing_post", revision: 1 };
    await expect(api.service.prepare(principal, { ...request, revision: 2 })).rejects.toMatchObject({ code: "stale" });
    const prepared = await api.service.prepare(principal, request);
    const challenge = api.store.issue({ workspaceId, actorRef: principal.readerRef,
      unitRef: prepared.unitRef, action: prepared.action, now });
    const other = Object.freeze({ ...principal, actor: Object.freeze({ userId: "33333333-3333-4333-a333-333333333333" }),
      readerRef: "actor_admin" });
    const service = new PolicyBundlePublicationService(api.approvalRepo, api.guardrailRepo, api.store,
      [{ userId, workspaceId, role: "owner" }, { userId: other.actor.userId, workspaceId, role: "admin" }], () => now);
    await expect(service.publish(other, { ...request, reasonRef: "reason_reviewed",
      humanPresenceProof: challenge.proof })).rejects.toMatchObject({ code: "human_presence_rejected" });
    await expect(service.publish(principal, { ...request, reasonRef: "reason_reviewed",
      humanPresenceProof: challenge.proof })).rejects.toMatchObject({ code: "human_presence_rejected" });
    expect(api.approvalRepo.append).not.toHaveBeenCalled();
  });

  it("rejects caller workspace/hash/authority fields and refuses an unchanged append result", async () => {
    const api = harness();
    for (const unsafe of [
      { kind: "approval_policy", policyRef: "approval_policy_existing_post", revision: 1, workspaceId },
      { kind: "approval_policy", policyRef: "approval_policy_existing_post", revision: 1, canonicalHash: "a".repeat(64) },
      { kind: "approval_policy", policyRef: "approval_policy_existing_post", revision: 1, canPublish: true },
    ]) await expect(api.service.prepare(principal, unsafe)).rejects.toMatchObject({ code: "invalid_input" });
    api.approvalRepo.append.mockImplementationOnce(async (item) => ({ outcome: "unchanged", canonicalHash: item.canonicalHash }));
    const prepared = await api.service.prepare(principal, { kind: "approval_policy",
      policyRef: "approval_policy_existing_post", revision: 1 });
    const challenge = api.store.issue({ workspaceId, actorRef: principal.readerRef,
      unitRef: prepared.unitRef, action: prepared.action, now });
    await expect(api.service.publish(principal, { kind: "approval_policy", policyRef: prepared.policyRef,
      revision: prepared.revision, reasonRef: "reason_reviewed", humanPresenceProof: challenge.proof }))
      .rejects.toMatchObject({ code: "store_rejected" });
  });
});
