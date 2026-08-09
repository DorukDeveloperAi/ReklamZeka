import { describe, expect, it, vi } from "vitest";
import { CategoryProfileLifecycleService } from "@/application/category-profile-lifecycle-service";
import { AuthorizationError } from "@/security/authorization";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const principal = { actor: { userId: "22222222-2222-4222-8222-222222222222" }, workspaceId,
  workspaceRef: "workspace_test", readerRef: "actor_owner" } as const;
const emptyState = { registryHash: "a".repeat(64), definitions: [] } as const;
const bindings = { analysisPlaybookRefs: ["analysis_playbook_health"], ruleInstructionBundleRefs: [],
  budgetPolicyRefs: [], transferPolicyRefs: [], schedulePolicyRefs: [], actionPolicyRefs: [], creativePolicyRefs: [] } as const;
function service(role: "owner" | "admin" | "analyst" | "viewer") {
  const repository = { inspect: vi.fn(async () => emptyState), mutate: vi.fn(async () => ({ state: emptyState,
    profile: { profileRef: "category_profile_test" }, auditAppended: true, invalidationsAppended: 0 })) };
  return { repository, service: new CategoryProfileLifecycleService(repository as never,
    [{ userId: principal.actor.userId, workspaceId, role }]) };
}

describe("CategoryProfile lifecycle service", () => {
  it("projects owner/admin lifecycle authority without policy, action or Meta authority", async () => {
    const result = await service("owner").service.inspect(principal);
    expect(result.authority).toEqual({ canRead: true, canCreate: true, canRevise: true, canPublish: true,
      canPause: true, canArchive: true, canPublishPolicy: false, canAuthorizeAction: false,
      canExecute: false, canWriteMeta: false });
  });

  it("keeps analyst and viewer read-only", async () => {
    for (const role of ["analyst", "viewer"] as const) {
      const current = service(role);
      await expect(current.service.inspect(principal)).resolves.toMatchObject({ authority: { canRead: true,
        canCreate: false, canRevise: false, canPublish: false, canPause: false, canArchive: false } });
      await expect(current.service.mutate(principal, { operation: "archive", profileRef: "category_profile_test",
        expectedVersion: 1, expectedProfileHash: "b".repeat(64), expectedRegistryHash: "a".repeat(64),
        reasonCode: "owner_archive" })).rejects.toBeInstanceOf(AuthorizationError);
      expect(current.repository.mutate).not.toHaveBeenCalled();
    }
  });

  it("derives actor/workspace/owner server-side and validates all seven typed binding lists", async () => {
    const current = service("admin");
    await current.service.mutate(principal, { operation: "create_draft",
      definitionRef: `category_${"1".repeat(24)}`, parentDefinitionRef: null, label: "Kardiyoloji",
      description: "Kalp sağlığı hizmetleri", color: "#A31F34", bindings,
      expectedRegistryHash: "a".repeat(64) });
    expect(current.repository.mutate).toHaveBeenCalledWith(expect.objectContaining({ workspaceId,
      workspaceRef: principal.workspaceRef, actorId: principal.actor.userId, actorRef: principal.readerRef,
      role: "admin", command: expect.objectContaining({ operation: "create_draft", bindings }) }));
    await expect(current.service.mutate(principal, { operation: "create_draft",
      definitionRef: `category_${"1".repeat(24)}`, parentDefinitionRef: null, label: "Kardiyoloji",
      description: "Kalp sağlığı hizmetleri", color: "#a31f34", bindings,
      expectedRegistryHash: "a".repeat(64) })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(current.service.mutate(principal, { operation: "create_draft",
      definitionRef: `category_${"1".repeat(24)}`, parentDefinitionRef: null, label: "Kardiyoloji",
      description: "Kalp sağlığı hizmetleri", color: "#A31F34", bindings: { ...bindings,
        analysisPlaybookRefs: [] }, expectedRegistryHash: "a".repeat(64) })).rejects.toMatchObject({ code: "invalid_input" });
  });
});
