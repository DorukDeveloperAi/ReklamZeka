import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { InstructionPolicyLifecycleService, type InstructionPolicyLifecycleRepository } from
  "@/application/instruction-policy-lifecycle-service";
import { parseStrictInstructionPolicy } from "@/domain/policies/instruction-policy-dsl";
import { AuthorizationError } from "@/security/authorization";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const users = { owner: "22222222-2222-4222-8222-222222222222",
  analyst: "33333333-3333-4333-8333-333333333333", viewer: "44444444-4444-4444-8444-444444444444" };
const memberships = Object.entries(users).map(([role, userId]) => ({ userId, workspaceId,
  role: role as "owner" | "analyst" | "viewer" }));
const principal = (role: keyof typeof users) => ({ actor: { userId: users[role] }, workspaceId,
  workspaceRef: "workspace_test", readerRef: `actor_${role}` }) as const;
const raw = "Bu portföyde sağlık kategorisini önceliklendir.";

function policy(role: "owner" | "analyst", version = 1, previousVersionHash: string | null = null) {
  return parseStrictInstructionPolicy({ dslVersion: "strict-instruction-policy/1.0.0", workspaceRef: "workspace_test",
    policyRef: "policy_health_priority", policyVersion: version, previousVersionHash, policyType: "preference",
    owner: { actorRef: `actor_${role}`, role }, status: "draft", reasonCode: "portfolio_priority", priority: 500,
    effectiveDates: { from: "2026-08-09T00:00:00.000Z", until: null }, scope: { global: false,
      accountGroupRefs: [], accountRefs: ["account_primary"], objectiveRefs: [],
      internalCategoryRefs: ["category_health"], entities: [], topicRefs: [] },
    source: { rawProvenanceRef: `provenance_${role}_${version}`,
      rawTextHash: createHash("sha256").update(raw).digest("hex"), promotedFromGuidanceRefs: [] },
    clause: { kind: "preference", subjectRef: "subject_budget", preferredRefs: ["category_health"],
      weightBasisPoints: 7000 } });
}

function repository(): InstructionPolicyLifecycleRepository & { mutate: ReturnType<typeof vi.fn> } {
  const state = { registryHash: "a".repeat(64), current: [], history: [], diffs: [] } as const;
  return { inspect: vi.fn(async () => state), mutate: vi.fn(async () => ({ state, auditAppended: true as const,
    contextInvalidationAppended: false })) };
}

describe("InstructionPolicyLifecycleService", () => {
  it("keeps viewer history read-only and authority-free", async () => {
    const result = await new InstructionPolicyLifecycleService(repository(), memberships).inspect(principal("viewer"));
    expect(result).toMatchObject({ registryHash: "a".repeat(64), authority: { canRead: true, canDraft: false,
      canPublish: false, canPause: false, canArchive: false, canApprove: false, canExecute: false,
      canWriteMeta: false, canSchedule: false, canCallTool: false } });
  });

  it("allows analyst draft creation with hash-bound raw provenance but no runtime authority", async () => {
    const repo = repository(); const artifact = policy("analyst");
    const result = await new InstructionPolicyLifecycleService(repo, memberships).mutate(principal("analyst"), {
      operation: "create_draft", expectedRegistryHash: "a".repeat(64), rawText: raw, policy: artifact });
    expect(result).toMatchObject({ auditAppended: true, canApprove: false, canExecute: false, canWriteMeta: false });
    expect(repo.mutate).toHaveBeenCalledWith(expect.objectContaining({ role: "analyst", actorRef: "actor_analyst",
      command: expect.objectContaining({ operation: "create_draft", policy: artifact, rawText: raw }) }));
  });

  it("requires the exact version/hash chain for draft revision", async () => {
    const repo = repository(); const previous = policy("analyst");
    await expect(new InstructionPolicyLifecycleService(repo, memberships).mutate(principal("analyst"), {
      operation: "revise_draft", expectedRegistryHash: "a".repeat(64), expectedVersion: 1,
      expectedPolicyHash: previous.canonicalHash, rawText: raw, policy: policy("analyst", 2, "b".repeat(64)),
    })).rejects.toMatchObject({ code: "invalid_input" });
    expect(repo.mutate).not.toHaveBeenCalled();
  });

  it("denies analyst publish and viewer draft before persistence", async () => {
    const command = { operation: "publish" as const, expectedRegistryHash: "a".repeat(64),
      policyRef: "policy_health_priority", expectedVersion: 1, expectedPolicyHash: "b".repeat(64),
      reasonCode: "owner_publish" };
    await expect(new InstructionPolicyLifecycleService(repository(), memberships).mutate(principal("analyst"), command))
      .rejects.toBeInstanceOf(AuthorizationError);
    await expect(new InstructionPolicyLifecycleService(repository(), memberships).mutate(principal("viewer"), {
      operation: "create_draft", expectedRegistryHash: "a".repeat(64), rawText: raw, policy: policy("analyst"),
    })).rejects.toBeInstanceOf(AuthorizationError);
  });
});
