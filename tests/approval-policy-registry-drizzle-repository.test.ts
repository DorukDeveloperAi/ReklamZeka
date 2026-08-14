import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

import {
  ApprovalPolicyRegistryRepositoryError,
  DrizzleApprovalPolicyRegistryRepository,
} from "@/connectors/actions/approval-policy-registry-drizzle-repository";
import { ACTION_APPROVAL_POLICY_VERSION, type ApprovalPolicy } from "@/domain/actions/approval-lifecycle";
import {
  createApprovalPolicyDraft,
  publishApprovalPolicy,
  reviseApprovalPolicyDraft,
  type ApprovalPolicyDefinitionRevision,
} from "@/domain/actions/approval-policy-registry";

const workspaceId = "11111111-1111-4111-a111-111111111111";
const definitionId = "22222222-2222-4222-a222-222222222222";
const workspaceRef = "workspace_alpha";

function policy(policyRef = "policy_existing_post", revision = 1): ApprovalPolicy {
  return { version: ACTION_APPROVAL_POLICY_VERSION, policyRef, revision, autonomyMode: "approval_only",
    requesterRoles: ["owner", "analyst"], approverRoles: [{ risk: "K4", roles: ["owner"] }],
    grantConsumerRoles: ["owner"], separationOfDutiesRisks: ["K4"], maximumProtectionEvidenceAgeSeconds: 3_600,
    maximumProposalLifetimeSeconds: 86_400,
    maximumGrantLifetimeSeconds: 600 };
}
function draft(patch: { workspaceRef?: string; policyRef?: string } = {}) {
  const scoped = patch.workspaceRef ?? workspaceRef;
  return createApprovalPolicyDraft({ workspaceRef: scoped, policy: policy(patch.policyRef),
    effectiveFrom: "2026-08-07T00:00:00.000Z", expiresAt: null,
    normalizedBy: { actorRef: "actor_analyst", role: "analyst" } });
}
function published(policyRef?: string) {
  return publishApprovalPolicy({ draft: draft({ policyRef }), actor: { actorRef: "actor_owner", role: "owner" },
    decisionRef: "decision_publish_policy", reasonRef: "reason_reviewed", publishedAt: "2026-08-07T10:00:00.000Z" });
}
function row(definition: ApprovalPolicyDefinitionRevision, id = definitionId) {
  return { id, workspace_ref: definition.workspaceRef, policy_ref: definition.policyRef,
    revision: definition.revision, previous_hash: definition.previousHash, state: definition.state, policy_hash: definition.policyHash,
    canonical_hash: definition.canonicalHash, artifact_payload: definition };
}
function database(results: readonly unknown[]) {
  const execute = vi.fn();
  for (const result of results) execute.mockResolvedValueOnce(result);
  const transaction = vi.fn(async (callback: (tx: { execute: typeof execute }) => Promise<unknown>) => callback({ execute }));
  return { execute, transaction };
}

describe("Drizzle reviewed ApprovalPolicy registry", () => {
  it("serializes and appends the first draft under an active tenant lock", async () => {
    const definition = draft();
    const db = database([{ rows: [{ id: workspaceId, lifecycle_state: "active" }] }, { rows: [] }, { rows: [] },
      { rows: [{ canonical_hash: definition.canonicalHash }] }]);
    await expect(new DrizzleApprovalPolicyRegistryRepository(db as never, workspaceId, workspaceRef).append(definition))
      .resolves.toEqual({ outcome: "inserted", canonicalHash: definition.canonicalHash });
    expect(new PgDialect().sqlToQuery(db.execute.mock.calls[0]![0]).sql).toContain("for update");
  });

  it("returns unchanged for exact replay and rejects same revision with different policy", async () => {
    const definition = published();
    const replay = database([{ rows: [{ id: workspaceId, lifecycle_state: "active" }] }, { rows: [row(definition)] }]);
    await expect(new DrizzleApprovalPolicyRegistryRepository(replay as never, workspaceId, workspaceRef).append(definition))
      .resolves.toMatchObject({ outcome: "unchanged" });
    const other = publishApprovalPolicy({ draft: createApprovalPolicyDraft({ workspaceRef, policy: policy(),
      effectiveFrom: "2026-08-08T00:00:00.000Z", expiresAt: null,
      normalizedBy: { actorRef: "actor_analyst", role: "analyst" } }),
      actor: { actorRef: "actor_owner", role: "owner" }, decisionRef: "decision_publish_other",
      reasonRef: "reason_other_review", publishedAt: "2026-08-08T10:00:00.000Z" });
    const conflict = database([{ rows: [{ id: workspaceId, lifecycle_state: "active" }] },
      { rows: [row(other)] }]);
    await expect(new DrizzleApprovalPolicyRegistryRepository(conflict as never, workspaceId, workspaceRef).append(definition))
      .rejects.toEqual(expect.objectContaining({ code: "revision_conflict" }));
  });

  it("requires contiguous draft-to-published transitions", async () => {
    const source = draft(); const target = published();
    const noSource = database([{ rows: [{ id: workspaceId, lifecycle_state: "active" }] }, { rows: [] }, { rows: [] }]);
    await expect(new DrizzleApprovalPolicyRegistryRepository(noSource as never, workspaceId, workspaceRef).append(target))
      .rejects.toEqual(expect.objectContaining({ code: "revision_conflict" }));
    const valid = database([{ rows: [{ id: workspaceId, lifecycle_state: "active" }] }, { rows: [] }, { rows: [row(source)] },
      { rows: [{ canonical_hash: target.canonicalHash }] }]);
    await expect(new DrizzleApprovalPolicyRegistryRepository(valid as never, workspaceId, workspaceRef).append(target))
      .resolves.toMatchObject({ outcome: "inserted" });
    const wrongPredecessor = createApprovalPolicyDraft({ workspaceRef, policy: policy(),
      effectiveFrom: "2026-08-08T00:00:00.000Z", expiresAt: null,
      normalizedBy: { actorRef: "actor_analyst", role: "analyst" } });
    const broken = database([{ rows: [{ id: workspaceId, lifecycle_state: "active" }] }, { rows: [] },
      { rows: [row(wrongPredecessor)] }]);
    await expect(new DrizzleApprovalPolicyRegistryRepository(broken as never, workspaceId, workspaceRef).append(target))
      .rejects.toEqual(expect.objectContaining({ code: "revision_conflict" }));
  });

  it("accepts published-to-new-draft-to-published revisions under the same policyRef", async () => {
    const original = published();
    const nextDraft = reviseApprovalPolicyDraft({ current: original,
      policy: { ...policy(original.policyRef, 3), maximumProtectionEvidenceAgeSeconds: 1_800,
        maximumProposalLifetimeSeconds: 43_200,
        maximumGrantLifetimeSeconds: 1_200 },
      effectiveFrom: "2026-08-07T00:00:00.000Z", expiresAt: null,
      normalizedBy: { actorRef: "actor_analyst", role: "analyst" } });
    const nextPublished = publishApprovalPolicy({ draft: nextDraft,
      actor: { actorRef: "actor_admin", role: "admin" }, decisionRef: "decision_publish_revision",
      reasonRef: "reason_reviewed_revision", publishedAt: "2026-08-07T11:00:00.000Z" });
    const appendDraft = database([{ rows: [{ id: workspaceId, lifecycle_state: "active" }] }, { rows: [] },
      { rows: [row(original)] }, { rows: [{ canonical_hash: nextDraft.canonicalHash }] }]);
    await expect(new DrizzleApprovalPolicyRegistryRepository(appendDraft as never, workspaceId, workspaceRef)
      .append(nextDraft)).resolves.toMatchObject({ outcome: "inserted" });
    const appendPublished = database([{ rows: [{ id: workspaceId, lifecycle_state: "active" }] }, { rows: [] },
      { rows: [row(nextDraft)] }, { rows: [{ canonical_hash: nextPublished.canonicalHash }] }]);
    await expect(new DrizzleApprovalPolicyRegistryRepository(appendPublished as never, workspaceId, workspaceRef)
      .append(nextPublished)).resolves.toMatchObject({ outcome: "inserted" });
    const resolve = database([{ rows: [{ id: workspaceId, lifecycle_state: "active" }] }, { rows: [
      row(draft(), "33333333-3333-4333-a333-333333333333"), row(original),
      row(nextDraft, "44444444-4444-4444-a444-444444444444"),
      row(nextPublished, "55555555-5555-4555-a555-555555555555"),
    ] }]);
    await expect(new DrizzleApprovalPolicyRegistryRepository(resolve as never, workspaceId, workspaceRef)
      .resolveExistingPostPolicy("2026-08-07T12:00:00.000Z"))
      .resolves.toMatchObject({ policy: { revision: 4, maximumProtectionEvidenceAgeSeconds: 1_800,
        maximumProposalLifetimeSeconds: 43_200,
        maximumGrantLifetimeSeconds: 1_200 },
        source: { revision: 4, definitionId: "55555555-5555-4555-a555-555555555555" } });
  });

  it("resolves exact-one published-active K4 policy with private source identity", async () => {
    const definition = published();
    const db = database([{ rows: [{ id: workspaceId, lifecycle_state: "active" }] }, { rows: [
      row(draft(), "33333333-3333-4333-a333-333333333333"), row(definition),
    ] }]);
    const resolved = await new DrizzleApprovalPolicyRegistryRepository(db as never, workspaceId, workspaceRef)
      .resolveExistingPostPolicy("2026-08-07T12:00:00.000Z");
    expect(resolved).toMatchObject({ policy: { policyRef: definition.policyRef, maximumGrantLifetimeSeconds: 600 },
      policyHash: definition.policyHash, source: { definitionId, canonicalHash: definition.canonicalHash,
        applicability: { actionType: "existing_post_promotion", risk: "K4" } } });
    expect(new PgDialect().sqlToQuery(db.execute.mock.calls[0]![0]).sql).toContain("for share");
  });

  it("lists and selects server-private artifacts while rechecking tenant and policy bindings", async () => {
    const definition = draft();
    const listed = database([{ rows: [{ id: workspaceId, lifecycle_state: "active" }] }, { rows: [row(definition)] }]);
    await expect(new DrizzleApprovalPolicyRegistryRepository(listed as never, workspaceId, workspaceRef).listArtifacts())
      .resolves.toEqual([definition]);
    expect(new PgDialect().sqlToQuery(listed.execute.mock.calls[1]![0]).sql).toContain("limit 1001");
    const latest = database([{ rows: [{ id: workspaceId, lifecycle_state: "active" }] }, { rows: [row(definition)] }]);
    await expect(new DrizzleApprovalPolicyRegistryRepository(latest as never, workspaceId, workspaceRef)
      .latestArtifact(definition.policyRef)).resolves.toEqual(definition);
    const wrongPolicy = draft({ policyRef: "policy_other" });
    const corrupt = database([{ rows: [{ id: workspaceId, lifecycle_state: "active" }] }, { rows: [row(wrongPolicy)] }]);
    await expect(new DrizzleApprovalPolicyRegistryRepository(corrupt as never, workspaceId, workspaceRef)
      .latestArtifact(definition.policyRef)).rejects.toMatchObject({ code: "corrupt_store" });
  });

  it("fails closed for no policy, ambiguity, cross-tenant, inactive workspace, and corrupt rows", async () => {
    const empty = database([{ rows: [{ id: workspaceId, lifecycle_state: "active" }] }, { rows: [] }]);
    await expect(new DrizzleApprovalPolicyRegistryRepository(empty as never, workspaceId, workspaceRef)
      .resolveExistingPostPolicy("2026-08-07T12:00:00.000Z")).rejects.toEqual(expect.objectContaining({ code: "not_found" }));
    const one = published("policy_one"); const two = published("policy_two");
    const ambiguous = database([{ rows: [{ id: workspaceId, lifecycle_state: "active" }] },
      { rows: [row(draft({ policyRef: one.policyRef }), "33333333-3333-4333-a333-333333333333"), row(one),
        row(draft({ policyRef: two.policyRef }), "44444444-4444-4444-a444-444444444444"),
        row(two, "55555555-5555-4555-a555-555555555555")] }]);
    await expect(new DrizzleApprovalPolicyRegistryRepository(ambiguous as never, workspaceId, workspaceRef)
      .resolveExistingPostPolicy("2026-08-07T12:00:00.000Z")).rejects.toEqual(expect.objectContaining({ code: "ambiguous" }));
    const untouched = database([]);
    await expect(new DrizzleApprovalPolicyRegistryRepository(untouched as never, workspaceId, workspaceRef)
      .append(draft({ workspaceRef: "workspace_other" }))).rejects.toEqual(expect.objectContaining({ code: "workspace_scope_mismatch" }));
    expect(untouched.execute).not.toHaveBeenCalled();
    const inactive = database([{ rows: [{ id: workspaceId, lifecycle_state: "tombstoning" }] }]);
    await expect(new DrizzleApprovalPolicyRegistryRepository(inactive as never, workspaceId, workspaceRef).append(draft()))
      .rejects.toEqual(expect.objectContaining({ code: "inactive_workspace" }));
    const corrupt = database([{ rows: [{ id: workspaceId, lifecycle_state: "active" }] },
      { rows: [row(draft({ policyRef: one.policyRef }), "33333333-3333-4333-a333-333333333333"),
        { ...row(one), policy_hash: "0".repeat(64) }] }]);
    await expect(new DrizzleApprovalPolicyRegistryRepository(corrupt as never, workspaceId, workspaceRef)
      .resolveExistingPostPolicy("2026-08-07T12:00:00.000Z")).rejects.toEqual(expect.objectContaining({ code: "corrupt_store" }));
    const brokenChain = database([{ rows: [{ id: workspaceId, lifecycle_state: "active" }] }, { rows: [row(one)] }]);
    await expect(new DrizzleApprovalPolicyRegistryRepository(brokenChain as never, workspaceId, workspaceRef)
      .resolveExistingPostPolicy("2026-08-07T12:00:00.000Z")).rejects.toEqual(expect.objectContaining({ code: "corrupt_store" }));
  });

  it("exposes no approval, grant, execution, snapshot, or Meta method", () => {
    expect(Object.getOwnPropertyNames(DrizzleApprovalPolicyRegistryRepository.prototype).sort())
      .toEqual(["append", "constructor", "latestArtifact", "listArtifacts", "resolveExistingPostPolicy", "resolvePolicy"]);
    expect(() => new DrizzleApprovalPolicyRegistryRepository({} as never, "invalid", workspaceRef))
      .toThrow(ApprovalPolicyRegistryRepositoryError);
  });
});
