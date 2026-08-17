import { describe, expect, it } from "vitest";
import { SliceRegistryError, SliceRegistryService, type SliceRegistryRepository } from "@/application/slice-registry-service";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const marketId = "33333333-3333-4333-8333-333333333333";
const service = (repository: SliceRegistryRepository) => new SliceRegistryService(repository);
const draft = { sliceRef: "slice_growth", revisionRef: "slice_revision_growth_1", revisionNumber: 1,
  market: { dimensionId: "dimension_market", valueId: "category_yerli", key: "yerli" as const }, predicates: [] };
const bindings = { marketDefinitionId: marketId, predicates: [], overrides: [] };

describe("P03 canonical slice registry service", () => {
  it("creates a normalised immutable draft only through server-resolved bindings", async () => {
    const calls: unknown[] = [];
    const repository: SliceRegistryRepository = { create: async (input) => { calls.push(input); return { sliceId: "44444444-4444-4444-8444-444444444444", revisionId: "55555555-5555-4555-8555-555555555555" }; }, publish: async () => ({ revisionId: "x" }), freeze: async () => ({ snapshotId: "x" }) };
    const result = await service(repository).create({ workspaceId, actorId, label: "  Büyüme  ", draft, bindings });
    expect(result.sliceId).toBe("44444444-4444-4444-8444-444444444444");
    expect(calls[0]).toMatchObject({ label: "Büyüme", revision: { definitionHash: expect.stringMatching(/^[a-f0-9]{64}$/) } });
  });

  it("rejects an ambiguous override target before persistence", async () => {
    const repository: SliceRegistryRepository = { create: async () => ({ sliceId: "x", revisionId: "x" }), publish: async () => ({ revisionId: "x" }), freeze: async () => ({ snapshotId: "x" }) };
    await expect(service(repository).create({ workspaceId, actorId, label: "Büyüme", draft, bindings: { ...bindings, overrides: [{ operation: "include", entityLevel: "campaign", campaignId: actorId, adSetId: actorId }] } })).rejects.toMatchObject({ code: "invalid_binding" } satisfies Partial<SliceRegistryError>);
  });

  it("requires bindings for every definition predicate", async () => {
    const repository: SliceRegistryRepository = { create: async () => ({ sliceId: "x", revisionId: "x" }), publish: async () => ({ revisionId: "x" }), freeze: async () => ({ snapshotId: "x" }) };
    const withPredicate = { ...draft, predicates: [{ dimensionId: "dimension_service", key: "service", values: [{ valueId: "category_service", key: "service" }] }] };
    await expect(service(repository).create({ workspaceId, actorId, label: "Büyüme", draft: withPredicate, bindings })).rejects.toMatchObject({ code: "invalid_binding" } satisfies Partial<SliceRegistryError>);
  });
});
