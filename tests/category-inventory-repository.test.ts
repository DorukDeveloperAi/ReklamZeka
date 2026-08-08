import { describe, expect, it, vi } from "vitest";
import { DrizzleCategoryInventoryRepository } from "@/connectors/categories/category-inventory-drizzle-repository";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const dimensionId = "22222222-2222-4222-8222-222222222222";
const definitionId = "33333333-3333-4333-8333-333333333333";

describe("DrizzleCategoryInventoryRepository projection", () => {
  it("maps bounded evidence/confidence aggregates without exposing raw evidence refs or UUIDs", async () => {
    const results = [
      { rows: [{ id: workspaceId }] },
      { rows: [{ id: dimensionId, key: "campaign_type", name: "Kampanya türü", description: null,
        cardinality: "single", allowed_entity_levels: ["campaign"], version: 1 }] },
      { rows: [{ dimension_id: dimensionId, definition_id: definitionId, key: "evergreen", label: "Evergreen",
        description: null, version: 1 }] },
      { rows: [{ dimension_id: dimensionId, definition_id: definitionId, total: 2, manual_locked: 1,
        manual: 1, agent: 1, deterministic: 0, add_count: 2, override_count: 0, deny_count: 0 }] },
      { rows: [{ definition_id: definitionId, minimum_bps: 6999, average_bps: 8500,
        below_review_threshold: 1, evidence_records: 3, assignments_with_observed_at: 1,
        invalid_evidence_assignments: 0 }] },
      { rows: [{ definition_id: definitionId, kind: "owner_instruction", total: 2 }] },
      { rows: [{ dimension_id: dimensionId, entity_level: "campaign", assigned: 2, denied: 0 }] },
      { rows: [{ entity_level: "campaign", total: 5 }, { entity_level: "ad_set", total: 0 },
        { entity_level: "ad", total: 0 }, { entity_level: "creative", total: 0 }] },
      { rows: [{ dimensions_without_definitions: 0, definitions_without_assignments: 0,
        stale_target_assignments: 0, assignments_under_archived_registry: 0 }] },
    ];
    const execute = vi.fn(async () => results.shift());
    const snapshot = await new DrizzleCategoryInventoryRepository({ execute } as never).list(workspaceId);
    expect(snapshot.dimensions[0]?.definitions[0]).toMatchObject({
      ref: expect.stringMatching(/^category_/), confidence: { minimumBasisPoints: 6999,
        averageBasisPoints: 8500, belowReviewThreshold: 1 }, evidenceHealth: {
        evidenceRecords: 3, assignmentsWithObservedAt: 1, invalidEvidenceAssignments: 0,
        kinds: [{ kind: "owner_instruction", count: 2 }],
      },
    });
    expect(JSON.stringify(snapshot)).not.toContain(workspaceId);
    expect(JSON.stringify(snapshot)).not.toContain(dimensionId);
    expect(JSON.stringify(snapshot)).not.toContain(definitionId);
    expect(JSON.stringify(snapshot)).not.toContain("evidence-ref");
    expect(execute).toHaveBeenCalledTimes(9);
  });

  it("keeps zero-population coverage ratio null", async () => {
    const results = [{ rows: [{ id: workspaceId }] }, { rows: [{ id: dimensionId, key: "creative_type",
      name: "Kreatif türü", description: null, cardinality: "multi", allowed_entity_levels: ["creative"], version: 1 }] },
    { rows: [] }, { rows: [] }, { rows: [] }, { rows: [] }, { rows: [] },
    { rows: [{ entity_level: "campaign", total: 0 }, { entity_level: "ad_set", total: 0 },
      { entity_level: "ad", total: 0 }, { entity_level: "creative", total: 0 }] },
    { rows: [{ dimensions_without_definitions: 1, definitions_without_assignments: 0,
      stale_target_assignments: 0, assignments_under_archived_registry: 0 }] }];
    const snapshot = await new DrizzleCategoryInventoryRepository({ execute: vi.fn(async () => results.shift()) } as never)
      .list(workspaceId);
    expect(snapshot.dimensions[0]?.coverage[0]).toMatchObject({ totalEntities: 0,
      directlyAssignedEntities: 0, coverageBasisPoints: null });
  });
});
