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
        contextInvalidationAppended: ["guidance.published", "guidance.archived", "guidance_set.reviewed",
          "guidance_set.archived"].includes(input.action) };
    },
  };
  return { service: new GuidanceStudioService(repository, [{ userId, workspaceId, role }]), repository, audits,
    registry: () => registry as GuidanceRegistry };
}

const draft = { title: "Learning döneminde sakin kal", body: "Acil risk yoksa 72 saat gözlemle.",
  strength: "should" as const, topic: "cadence", scopes: [{ facet: "internal_category" as const,
    value: category.ref, entityType: null, mode: "default" as const, priority: 60 }] };

describe("GuidanceStudioService", () => {
  it("persists canonical objective bindings and canonicalizes only reviewed Meta aliases", async () => {
    for (const [input, expected] of [["lead_generation", "lead_generation"],
      ["OUTCOME_LEADS", "lead_generation"], ["LEAD_GENERATION", "lead_generation"]] as const) {
      const state = memory(); const initial = await state.service.list(principal);
      const created = await state.service.createDraft(principal, { ...draft,
        scopes: [{ facet: "objective", value: input, entityType: null, mode: "default", priority: 60 }],
        expectedRegistryHash: initial.registryHash });
      expect(created.item.scopes[0]?.value).toBe(expected);
      expect(state.registry().bindings[0]?.value).toBe(expected);
    }
    const unknown = memory(); const initial = await unknown.service.list(principal);
    await expect(unknown.service.createDraft(principal, { ...draft,
      scopes: [{ facet: "objective", value: "OUTCOME_FUTURE", entityType: null, mode: "default", priority: 60 }],
      expectedRegistryHash: initial.registryHash })).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("preserves the owner statement separately and creates guidance-only scoped draft", async () => {
    const state = memory(); const before = await state.service.list(principal);
    const created = await state.service.createDraft(principal, { ...draft, expectedRegistryHash: before.registryHash });
    expect(created.item).toMatchObject({ status: "draft", title: draft.title, body: draft.body,
      scopes: [{ facet: "internal_category", value: category.ref }], version: 1 });
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

  it("authors non-owner provenance and requires owner review evidence before official publication", async () => {
    const analystState = memory("analyst"); const initial = await analystState.service.list(principal);
    const strategy = await analystState.service.createDraft(principal, { ...draft,
      source: { type: "business_strategy", ref: "strategy_quarterly", url: null,
        capturedAt: "2026-08-09T18:00:00.000Z", reviewBy: null }, expectedRegistryHash: initial.registryHash });
    expect(analystState.registry().sources[0]).toMatchObject({ sourceType: "business_strategy",
      sourceRef: "strategy_quarterly", status: "draft" });
    await expect(analystState.service.mutate(principal, { cardRef: strategy.item.cardRef, expectedVersion: 1,
      expectedRegistryHash: strategy.registryHash, operation: "publish" }))
      .rejects.toMatchObject({ name: "AuthorizationError" });

    const ownerState = memory("owner"); const ownerInitial = await ownerState.service.list(principal);
    const official = await ownerState.service.createDraft(principal, { ...draft,
      source: { type: "official_meta_guidance", ref: "meta_business_help", url: "https://www.facebook.com/business/help/example",
        capturedAt: "2026-08-09T18:00:00.000Z", reviewBy: "2027-08-09T18:00:00.000Z" },
      scopes: [{ facet: "funnel", value: "consideration", entityType: null, mode: "default", priority: 70 }],
      expectedRegistryHash: ownerInitial.registryHash });
    const published = await ownerState.service.mutate(principal, { cardRef: official.item.cardRef, expectedVersion: 1,
      expectedRegistryHash: official.registryHash, operation: "publish" });
    expect(published.item).toMatchObject({ status: "published", sources: [{ type: "official_meta_guidance",
      ref: "meta_business_help", url: "https://www.facebook.com/business/help/example" }] });
    expect(ownerState.registry().sources[0]?.reviewedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("rejects non-Meta HTTPS hosts before an official draft reaches persistence", async () => {
    const state = memory("owner"); const initial = await state.service.list(principal);
    await expect(state.service.createDraft(principal, { ...draft,
      source: { type: "official_meta_guidance", ref: "meta_fake", url: "https://example.com/meta-help",
        capturedAt: "2026-08-09T18:00:00.000Z", reviewBy: "2027-08-09T18:00:00.000Z" },
      expectedRegistryHash: initial.registryHash })).rejects.toMatchObject({ code: "invalid_input" });
    expect(state.registry().sources).toEqual([]);
  });

  it("projects every same-type source without silently truncating provenance", async () => {
    const state = memory("owner"); const current = state.registry();
    const cardRef = `guidance_${"a".repeat(24)}`;
    const sourceRefs = [`source_${"b".repeat(24)}`, `source_${"c".repeat(24)}`] as const;
    const next = createGuidanceRegistry({ workspaceId, sources: sourceRefs.map((id, index) => ({ id, workspaceId,
      sourceType: "observed_result" as const, title: `Gözlem ${index + 1}`, sourceRef: `evidence_observation_${index + 1}`,
      sourceUrl: null, content: `Gözlem ${index + 1}`, author: "reader_test", capturedAt: "2026-08-09T18:00:00.000Z",
      reviewedAt: "2026-08-09T19:00:00.000Z", reviewBy: null, status: "published" as const, version: 1 })),
    cards: [{ id: cardRef, workspaceId, sourceType: "observed_result", sourceIds: sourceRefs,
      title: "Birleşik gözlem", body: "İki ayrı kanıtı birlikte değerlendir.", rationale: null, strength: "consider",
      topic: "evidence", decisionKey: null, positionKey: null, authority: "guidance_only", status: "published",
      effectiveFrom: null, effectiveTo: null, ownerRef: "reader_test", version: 1 }], bindings: [{
      id: `binding_${"d".repeat(24)}`, workspaceId, cardId: cardRef, facet: "global", value: null,
      entityType: null, mode: "default", priority: 50, version: 1 }], sets: [] });
    await state.repository.saveAudited(next, { expectedRegistryHash: current.registryHash,
      actorId: userId, action: "guidance.published", resourceId: cardRef,
      occurredAt: "2026-08-09T20:00:00.000Z", metadata: { version: 1 } });
    expect((await state.service.list(principal)).items[0]?.sources.map((source) => source.ref))
      .toEqual(["evidence_observation_1", "evidence_observation_2"]);
  });

  it("rejects an internal category ref that is not in the active canonical catalog", async () => {
    const state = memory(); const initial = await state.service.list(principal);
    await expect(state.service.createDraft(principal, { ...draft, expectedRegistryHash: initial.registryHash,
      scopes: [{ ...draft.scopes[0]!, value: "category_ffffffffffffffffffffffff" }] })).rejects.toMatchObject({ code: "not_found" });
  });

  it("rejects nested scope authority injection before persistence", async () => {
    const state = memory(); const initial = await state.service.list(principal);
    await expect(state.service.createDraft(principal, { ...draft, expectedRegistryHash: initial.registryHash,
      scopes: [{ ...draft.scopes[0]!, canWriteMeta: true }] as never })).rejects.toMatchObject({ code: "invalid_input" });
    expect(state.registry().cards).toEqual([]);
  });

  it("authors conjunctive multi-facet scopes and keeps binding cardinality stable across revisions", async () => {
    const state = memory(); const initial = await state.service.list(principal);
    const scopes = [draft.scopes[0]!, { facet: "account" as const, value: "account_aaaaaaaaaaaaaaaaaaaaaaaa",
      entityType: null, mode: "default" as const, priority: 70 }, { facet: "topic" as const, value: "budget",
      entityType: null, mode: "exception" as const, priority: 80 }];
    const created = await state.service.createDraft(principal, { ...draft, scopes, expectedRegistryHash: initial.registryHash });
    expect(created.item.scopes).toHaveLength(3);
    expect(state.registry().bindings.filter((binding) => binding.cardId === created.item.cardRef)).toHaveLength(3);
    await expect(state.service.mutate(principal, { cardRef: created.item.cardRef, expectedVersion: 1,
      expectedRegistryHash: created.registryHash, operation: "revise", ...draft }))
      .rejects.toMatchObject({ code: "invalid_transition" });
  });

  it("authors ordered reviewed guidance sets from published cards and invalidates only effective transitions", async () => {
    const state = memory(); let snapshot = await state.service.list(principal);
    let first = await state.service.createDraft(principal, { ...draft, title: "Birinci", expectedRegistryHash: snapshot.registryHash });
    first = await state.service.mutate(principal, { cardRef: first.item.cardRef, expectedVersion: 1,
      expectedRegistryHash: first.registryHash, operation: "publish" });
    let second = await state.service.createDraft(principal, { ...draft, title: "İkinci",
      expectedRegistryHash: first.registryHash });
    second = await state.service.mutate(principal, { cardRef: second.item.cardRef, expectedVersion: 1,
      expectedRegistryHash: second.registryHash, operation: "publish" });

    const created = await state.service.createSetDraft(principal, { name: "Bütçe değerlendirme sırası",
      orderedCardRefs: [second.item.cardRef, first.item.cardRef], expectedRegistryHash: second.registryHash });
    expect(created.set).toMatchObject({ version: 1, reviewStatus: "draft",
      orderedCards: [{ cardRef: second.item.cardRef, status: "published" },
        { cardRef: first.item.cardRef, status: "published" }] });
    expect(created.contextInvalidated).toBe(false);
    const revised = await state.service.mutateSet(principal, { setRef: created.set.setRef, expectedVersion: 1,
      expectedRegistryHash: created.registryHash, operation: "revise", name: "Güncel bütçe sırası",
      orderedCardRefs: [first.item.cardRef, second.item.cardRef] });
    expect(revised.set.orderedCards.map((item) => item.cardRef)).toEqual([first.item.cardRef, second.item.cardRef]);
    expect(revised.contextInvalidated).toBe(false);
    await expect(state.service.mutateSet(principal, { setRef: created.set.setRef, expectedVersion: 1,
      expectedRegistryHash: revised.registryHash, operation: "review" }))
      .rejects.toMatchObject({ code: "conflict" });
    const reviewed = await state.service.mutateSet(principal, { setRef: created.set.setRef, expectedVersion: 2,
      expectedRegistryHash: revised.registryHash, operation: "review" });
    expect(reviewed.set).toMatchObject({ version: 3, reviewStatus: "reviewed" });
    expect(reviewed.contextInvalidated).toBe(true);
    const archived = await state.service.mutateSet(principal, { setRef: created.set.setRef, expectedVersion: 3,
      expectedRegistryHash: reviewed.registryHash, operation: "archive" });
    expect(archived.set).toMatchObject({ version: 4, reviewStatus: "archived" });
    expect(archived.contextInvalidated).toBe(true);
    expect(state.registry().sets).toEqual([expect.objectContaining({ id: created.set.setRef, version: 4,
      orderedCardIds: [first.item.cardRef, second.item.cardRef] })]);
    expect(state.audits.slice(-4)).toEqual(["guidance_set.draft_created", "guidance_set.draft_revised",
      "guidance_set.reviewed", "guidance_set.archived"]);
  });

  it("lets analysts draft/revise sets but denies review and rejects non-published or duplicate card refs", async () => {
    const owner = memory(); const initial = await owner.service.list(principal);
    const draftCard = await owner.service.createDraft(principal, { ...draft, expectedRegistryHash: initial.registryHash });
    await expect(owner.service.createSetDraft(principal, { name: "Erken set",
      orderedCardRefs: [draftCard.item.cardRef], expectedRegistryHash: draftCard.registryHash }))
      .rejects.toMatchObject({ code: "invalid_transition" });
    const published = await owner.service.mutate(principal, { cardRef: draftCard.item.cardRef, expectedVersion: 1,
      expectedRegistryHash: draftCard.registryHash, operation: "publish" });
    await expect(owner.service.createSetDraft(principal, { name: "Tekrarlı set",
      orderedCardRefs: [published.item.cardRef, published.item.cardRef], expectedRegistryHash: published.registryHash }))
      .rejects.toMatchObject({ code: "invalid_input" });

    const analyst = new GuidanceStudioService(owner.repository,
      [{ userId, workspaceId, role: "analyst" }]);
    const created = await analyst.createSetDraft(principal, { name: "Analyst taslağı",
      orderedCardRefs: [published.item.cardRef], expectedRegistryHash: published.registryHash });
    const revised = await analyst.mutateSet(principal, { setRef: created.set.setRef, expectedVersion: 1,
      expectedRegistryHash: created.registryHash, operation: "revise", name: "Analyst güncellemesi",
      orderedCardRefs: [published.item.cardRef] });
    await expect(analyst.mutateSet(principal, { setRef: created.set.setRef, expectedVersion: 2,
      expectedRegistryHash: revised.registryHash, operation: "review" }))
      .rejects.toMatchObject({ name: "AuthorizationError" });
  });
});
