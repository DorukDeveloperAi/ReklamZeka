import { describe, expect, it } from "vitest";
import { GuidanceStudioService, type GuidanceStudioRepository } from "@/application/guidance-studio-service";
import { createGuidanceRegistry, type GuidanceRegistry } from "@/domain/guidance/registry";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const principal = { actor: { userId }, workspaceId, workspaceRef: "workspace_test", readerRef: "reader_test" } as const;
const category = { ref: "category_1234567890abcdef12345678", label: "Saç Ekimi", dimension: "İç kampanya" } as const;

function memory(role: "owner" | "admin" | "analyst" | "viewer" = "owner") {
  let registry = createGuidanceRegistry({ workspaceId, sources: [], cards: [], bindings: [], sets: [] });
  const audits: string[] = [];
  const repository: GuidanceStudioRepository = {
    load: async () => registry,
    listActiveCategories: async () => [category],
    saveAudited: async (next, input) => {
      if (input.expectedRegistryHash !== registry.registryHash) throw new Error("conflict");
      registry = next; audits.push(input.action);
      return { outcome: "inserted", registryHash: registry.registryHash, auditAppended: true,
        contextInvalidationAppended: input.action === "guidance.published" || input.action === "guidance.archived" };
    },
  };
  return { service: new GuidanceStudioService(repository, [{ userId, workspaceId, role }]), audits,
    registry: () => registry as GuidanceRegistry };
}

const draft = { title: "Learning döneminde sakin kal", body: "Acil risk yoksa 72 saat gözlemle.",
  strength: "should" as const, topic: "cadence", scope: { facet: "internal_category" as const,
    value: category.ref, entityType: null, mode: "default" as const, priority: 60 } };

describe("GuidanceStudioService", () => {
  it("preserves the owner statement separately and creates guidance-only scoped draft", async () => {
    const state = memory(); const before = await state.service.list(principal);
    const created = await state.service.createDraft(principal, { ...draft, expectedRegistryHash: before.registryHash });
    expect(created.item).toMatchObject({ status: "draft", title: draft.title, body: draft.body,
      scope: { facet: "internal_category", value: category.ref }, version: 1 });
    expect(created.contextInvalidated).toBe(false);
    expect(state.registry().sources[0]).toMatchObject({ sourceType: "owner_statement", content: draft.body, status: "draft" });
    expect(state.registry().cards[0]).toMatchObject({ authority: "guidance_only", status: "draft" });
    expect(state.audits).toEqual(["guidance.draft_created"]);
  });

  it("revises, publishes and archives through immutable consecutive revisions", async () => {
    const state = memory(); const initial = await state.service.list(principal);
    let result = await state.service.createDraft(principal, { ...draft, expectedRegistryHash: initial.registryHash });
    result = await state.service.mutate(principal, { cardRef: result.item.cardRef, expectedVersion: 1,
      expectedRegistryHash: result.registryHash, operation: "revise", ...draft, body: "En az 72 saat gözlemle." });
    expect(result.item).toMatchObject({ version: 2, status: "draft", body: "En az 72 saat gözlemle." });
    expect(result.contextInvalidated).toBe(false);
    result = await state.service.mutate(principal, { cardRef: result.item.cardRef, expectedVersion: 2,
      expectedRegistryHash: result.registryHash, operation: "publish" });
    expect(result.item).toMatchObject({ version: 3, status: "published" });
    expect(result.contextInvalidated).toBe(true);
    result = await state.service.mutate(principal, { cardRef: result.item.cardRef, expectedVersion: 3,
      expectedRegistryHash: result.registryHash, operation: "archive" });
    expect(result.item).toMatchObject({ version: 4, status: "archived" });
    expect(result.contextInvalidated).toBe(true);
    expect(state.audits).toEqual(["guidance.draft_created", "guidance.draft_revised", "guidance.published", "guidance.archived"]);
  });

  it("allows analysts to draft but reserves publish/archive for owner or admin", async () => {
    const state = memory("analyst"); const initial = await state.service.list(principal);
    const created = await state.service.createDraft(principal, { ...draft, expectedRegistryHash: initial.registryHash });
    await expect(state.service.mutate(principal, { cardRef: created.item.cardRef, expectedVersion: 1,
      expectedRegistryHash: created.registryHash, operation: "publish" })).rejects.toMatchObject({ name: "AuthorizationError" });
  });

  it("rejects an internal category ref that is not in the active canonical catalog", async () => {
    const state = memory(); const initial = await state.service.list(principal);
    await expect(state.service.createDraft(principal, { ...draft, expectedRegistryHash: initial.registryHash,
      scope: { ...draft.scope, value: "category_ffffffffffffffffffffffff" } })).rejects.toMatchObject({ code: "not_found" });
  });
});
