import { describe, expect, it, vi } from "vitest";
import { AuthorizationError } from "@/security/authorization";
import {
  CategoryAuthoringError,
  CategoryAuthoringService,
  type CategoryAuthoringRepository,
  type CategoryAuthoringState,
} from "@/application/category-authoring-service";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const ownerId = "22222222-2222-4222-8222-222222222222";
const analystId = "33333333-3333-4333-8333-333333333333";
const viewerId = "44444444-4444-4444-8444-444444444444";
const adminId = "55555555-5555-4555-8555-555555555555";
const state: CategoryAuthoringState = Object.freeze({ registryHash: "a".repeat(64), dimensions: [], assignments: [] });
const memberships = [
  { userId: ownerId, workspaceId, role: "owner" as const },
  { userId: analystId, workspaceId, role: "analyst" as const },
  { userId: viewerId, workspaceId, role: "viewer" as const },
  { userId: adminId, workspaceId, role: "admin" as const },
];
const principal = (userId: string) => ({ actor: { userId }, workspaceId,
  workspaceRef: "workspace_test", readerRef: `reader_${userId.slice(0, 8)}` }) as const;

function repository(): CategoryAuthoringRepository & { mutate: ReturnType<typeof vi.fn> } {
  return { inspect: vi.fn(async () => state), mutate: vi.fn(async () => ({ state,
    auditAppended: true as const, invalidationsAppended: 0 })) };
}

describe("CategoryAuthoringService", () => {
  it("keeps viewer inspection read-only and exposes no action or Meta authority", async () => {
    const result = await new CategoryAuthoringService(repository(), memberships).inspect(principal(viewerId));
    expect(result).toMatchObject({ contractVersion: "category-authoring/1.0.0", registryHash: "a".repeat(64),
      authority: { canCreate: false, canRevise: false, canArchive: false, canAssign: false,
        canAuthorizeAction: false, canWriteMeta: false } });
  });

  it("allows owner publication mutation and normalizes bounded dimension input", async () => {
    const repo = repository();
    const result = await new CategoryAuthoringService(repo, memberships).mutate(principal(ownerId), {
      operation: "create_dimension", key: "service_line", name: "  Hizmet hattı  ", description: null,
      cardinality: "multi", allowedEntityLevels: ["campaign", "ad_set"], expectedRegistryHash: "a".repeat(64),
    });
    expect(result).toMatchObject({ auditAppended: true, invalidationsAppended: 0,
      canAuthorizeAction: false, canWriteMeta: false });
    expect(repo.mutate).toHaveBeenCalledWith(expect.objectContaining({ workspaceId, actorId: ownerId, role: "owner",
      command: expect.objectContaining({ operation: "create_dimension", name: "Hizmet hattı",
        allowedEntityLevels: ["ad_set", "campaign"] }) }));
  });

  it("denies analyst active registry mutations even with a syntactically valid command", async () => {
    await expect(new CategoryAuthoringService(repository(), memberships).mutate(principal(analystId), {
      operation: "archive_dimension", dimensionRef: "dimension_1234567890abcdef12345678", expectedVersion: 1,
      expectedRegistryHash: "a".repeat(64), expectedImpactHash: "b".repeat(64),
    })).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("normalizes guarded manual assignment authoring without accepting actor, workspace, source or evidence", async () => {
    const repo = repository();
    await new CategoryAuthoringService(repo, memberships).mutate(principal(ownerId), {
      operation: "create_assignment", dimensionRef: `dimension_${"1".repeat(24)}`,
      definitionRef: `category_${"2".repeat(24)}`, entityLevel: "campaign",
      entityRef: `category_entity_${"3".repeat(24)}`, viaAdRef: null, assignmentOperation: "add",
      manualLock: true, confidenceBasisPoints: 9_250, expectedRegistryHash: "a".repeat(64),
    });
    expect(repo.mutate).toHaveBeenCalledWith(expect.objectContaining({ workspaceId, actorId: ownerId, role: "owner",
      command: { operation: "create_assignment", dimensionRef: `dimension_${"1".repeat(24)}`,
        definitionRef: `category_${"2".repeat(24)}`, entityLevel: "campaign",
        entityRef: `category_entity_${"3".repeat(24)}`, viaAdRef: null, assignmentOperation: "add",
        manualLock: true, confidenceBasisPoints: 9_250, expectedRegistryHash: "a".repeat(64) } }));
  });

  it("denies analyst assignment publication because no assignment draft/preview workflow exists", async () => {
    await expect(new CategoryAuthoringService(repository(), memberships).mutate(principal(analystId), {
      operation: "archive_assignment", assignmentRef: `assignment_${"4".repeat(24)}`, expectedVersion: 1,
      expectedRegistryHash: "a".repeat(64),
    })).rejects.toBeInstanceOf(AuthorizationError);
  });

  it("allows admin assignment publication and denies viewer publication", async () => {
    const command = { operation: "unlock_assignment" as const, assignmentRef: `assignment_${"4".repeat(24)}`,
      expectedVersion: 1, expectedRegistryHash: "a".repeat(64) };
    const repo = repository();
    await expect(new CategoryAuthoringService(repo, memberships).mutate(principal(adminId), command)).resolves
      .toMatchObject({ auditAppended: true });
    expect(repo.mutate).toHaveBeenCalledWith(expect.objectContaining({ role: "admin", actorId: adminId }));
    await expect(new CategoryAuthoringService(repository(), memberships).mutate(principal(viewerId), command))
      .rejects.toBeInstanceOf(AuthorizationError);
  });

  it("rejects ambiguous creative paths and out-of-range assignment confidence", async () => {
    const base = { operation: "create_assignment" as const, dimensionRef: `dimension_${"1".repeat(24)}`,
      definitionRef: `category_${"2".repeat(24)}`, entityRef: `category_entity_${"3".repeat(24)}`,
      assignmentOperation: "add" as const, manualLock: false, expectedRegistryHash: "a".repeat(64) };
    await expect(new CategoryAuthoringService(repository(), memberships).mutate(principal(ownerId), {
      ...base, entityLevel: "creative", viaAdRef: null, confidenceBasisPoints: 10_000,
    })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(new CategoryAuthoringService(repository(), memberships).mutate(principal(ownerId), {
      ...base, entityLevel: "campaign", viaAdRef: null, confidenceBasisPoints: 10_001,
    })).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("keeps assignment/mapping authority closed in this registry lifecycle slice", async () => {
    expect((await new CategoryAuthoringService(repository(), memberships).inspect(principal(ownerId)))
      .authority.canAssign).toBe(false);
  });
});
