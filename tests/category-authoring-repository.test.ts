import { describe, expect, it, vi } from "vitest";
import { CategoryAuthoringError } from "@/application/category-authoring-service";
import { DrizzleCategoryAuthoringRepository } from "@/connectors/categories/category-authoring-drizzle-repository";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const dimensionId = "22222222-2222-4222-8222-222222222222";
const definitionId = "33333333-3333-4333-8333-333333333333";
const assignmentId = "44444444-4444-4444-8444-444444444444";
const campaignId = "55555555-5555-4555-8555-555555555555";

function stateResults() { return [
  { rows: [{ id: workspaceId }] },
  { rows: [{ id: dimensionId, key: "service_line", name: "Hizmet", description: null,
    cardinality: "multi", allowed_entity_levels: ["campaign", "ad_set"], version: 1 }] },
  { rows: [{ id: definitionId, dimension_id: dimensionId, dimension_key: "service_line",
    key: "dental", label: "Dental", description: null, version: 1 }] },
  { rows: [{ id: assignmentId, dimension_id: dimensionId, definition_id: definitionId,
    entity_level: "campaign", entity_id: campaignId, operation: "add", manual_lock: true,
    confidence: 1, version: 1 }] },
]; }

describe("DrizzleCategoryAuthoringRepository", () => {
  it("projects a deterministic public registry without internal UUIDs", async () => {
    const results = stateResults(); const execute = vi.fn(async () => results.shift());
    const state = await new DrizzleCategoryAuthoringRepository({ execute } as never).inspect(workspaceId);
    expect(state).toMatchObject({ registryHash: expect.stringMatching(/^[a-f0-9]{64}$/), dimensions: [{
      ref: expect.stringMatching(/^dimension_[a-f0-9]{24}$/), definitions: [{
        ref: expect.stringMatching(/^category_[a-f0-9]{24}$/) }],
    }], assignments: [{ ref: expect.stringMatching(/^assignment_[a-f0-9]{24}$/),
      entity: { ref: expect.stringMatching(/^category_entity_[a-f0-9]{24}$/) }, manualLock: true }] });
    const serialized = JSON.stringify(state);
    for (const internal of [workspaceId, dimensionId, definitionId, assignmentId, campaignId]) {
      expect(serialized).not.toContain(internal);
    }
  });

  it("checks the registry hash after the workspace lock and before any mutation", async () => {
    const results = [{ rows: [{ id: workspaceId }] }, ...stateResults()];
    const tx = { execute: vi.fn(async () => results.shift()) };
    const database = { transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)) };
    const repository = new DrizzleCategoryAuthoringRepository(database as never);
    await expect(repository.mutate({ workspaceId, actorId: "66666666-6666-4666-8666-666666666666",
      actorRef: "reader_test", role: "owner", occurredAt: "2026-08-09T18:00:00.000Z",
      command: { operation: "archive_dimension", dimensionRef: "dimension_1234567890abcdef12345678",
        expectedVersion: 1, expectedRegistryHash: "f".repeat(64), expectedImpactHash: "e".repeat(64) } }))
      .rejects.toMatchObject({ code: "conflict" });
    expect(database.transaction).toHaveBeenCalledTimes(1);
    expect(tx.execute).toHaveBeenCalledTimes(5);
  });

  it("keeps registry projection assignment refs opaque even though mapping mutations are not exposed", async () => {
    const results = stateResults(); const execute = vi.fn(async () => results.shift());
    const state = await new DrizzleCategoryAuthoringRepository({ execute } as never).inspect(workspaceId);
    expect(state.assignments[0]?.ref).toMatch(/^assignment_[a-f0-9]{24}$/);
  });
});
