import { describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { CategoryAuthoringError } from "@/application/category-authoring-service";
import { appendAssignmentInvalidations,
  DrizzleCategoryAuthoringRepository } from "@/connectors/categories/category-authoring-drizzle-repository";
import { DrizzleCategoryRegistryRepository } from "@/connectors/categories/category-registry-drizzle-repository";

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
    entity_level: "campaign", entity_id: campaignId, operation: "add", source: "manual", manual_lock: true,
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

  it("binds hidden assignment source semantics into the optimistic registry hash", async () => {
    const manualResults = stateResults();
    const manual = await new DrizzleCategoryAuthoringRepository({ execute: vi.fn(async () => manualResults.shift()) } as never)
      .inspect(workspaceId);
    const agentResults = stateResults();
    (agentResults[3]!.rows[0] as { source: string }).source = "agent";
    const agent = await new DrizzleCategoryAuthoringRepository({ execute: vi.fn(async () => agentResults.shift()) } as never)
      .inspect(workspaceId);
    expect(agent.registryHash).not.toBe(manual.registryHash);
    expect(JSON.stringify(agent)).not.toContain('"source"');
  });

  it("keeps ordinary revise/archive closed for locked or non-manual assignments", async () => {
    for (const testCase of [
      { assignment: { source: "manual", manual_lock: true }, operation: "revise_assignment" as const },
      { assignment: { source: "manual", manual_lock: true }, operation: "archive_assignment" as const },
      { assignment: { source: "agent", manual_lock: false }, operation: "revise_assignment" as const },
      { assignment: { source: "agent", manual_lock: false }, operation: "archive_assignment" as const },
    ]) {
      const results = stateResults();
      results[3] = { rows: [{ id: assignmentId, dimension_id: dimensionId, definition_id: definitionId,
        entity_level: "campaign", entity_id: campaignId, operation: "add", confidence: 1, version: 1,
        ...testCase.assignment }] };
      const inspectionResults = [...results];
      const current = await new DrizzleCategoryAuthoringRepository({ execute: vi.fn(async () => inspectionResults.shift()) } as never)
        .inspect(workspaceId);
      const command = testCase.operation === "revise_assignment"
        ? { operation: testCase.operation, assignmentRef: current.assignments[0]!.ref, expectedVersion: 1,
            assignmentOperation: "deny" as const, manualLock: false, confidenceBasisPoints: 8_000,
            expectedRegistryHash: current.registryHash }
        : { operation: testCase.operation, assignmentRef: current.assignments[0]!.ref, expectedVersion: 1,
            expectedRegistryHash: current.registryHash };
      const mutationResults = [{ rows: [{ id: workspaceId }] }, ...results];
      const tx = { execute: vi.fn(async () => mutationResults.shift()) };
      const database = { transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)) };
      await expect(new DrizzleCategoryAuthoringRepository(database as never).mutate({ workspaceId,
        actorId: "66666666-6666-4666-8666-666666666666", actorRef: "reader_test", role: "owner",
        occurredAt: "2026-08-09T18:00:00.000Z", command })).rejects.toMatchObject({ code: "manual_lock" });
      expect(tx.execute).toHaveBeenCalledTimes(5);
    }
  });

  it("appends exact-entity invalidations only for affected category resolution contexts", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [{ component_ref: dimensionId, component_version: "resolution-v1",
        entity_type: "campaign", entity_ref: "campaign_external_safe" }] })
      .mockResolvedValueOnce({ rows: [{ id: "77777777-7777-4777-8777-777777777777" }] });
    await expect(appendAssignmentInvalidations({ database: { execute } as never, workspaceId, dimensionId,
      target: { target: { level: "campaign", id: campaignId }, externalRef: "campaign_external_safe" },
      reasonCode: "source_changed", occurredAt: "2026-08-09T18:00:00.000Z" })).resolves.toBe(1);
    const dialect = new PgDialect();
    const selectSql = dialect.sqlToQuery(execute.mock.calls[0]![0]).sql;
    const insertSql = dialect.sqlToQuery(execute.mock.calls[1]![0]).sql;
    expect(selectSql).toContain("effective_campaign_context_components");
    expect(selectSql).toContain("hierarchyRefs");
    expect(selectSql).toContain("context.campaign_ref");
    expect(insertSql).toContain("exact_entity_component");
    expect(insertSql).not.toContain("workspace_component");
  });

  it("binds explicit unlock, exact invalidation and audit to the same outer transaction", async () => {
    const initialResults = stateResults();
    const current = await new DrizzleCategoryAuthoringRepository({ execute: vi.fn(async () => initialResults.shift()) } as never)
      .inspect(workspaceId);
    const after = stateResults();
    const results = [
      { rows: [{ id: workspaceId }] }, ...stateResults(),
      { rows: [{ id: campaignId, external_ref: "campaign_external_safe" }] },
      { rows: [{ component_ref: dimensionId, component_version: "resolution-v1",
        entity_type: "campaign", entity_ref: "campaign_external_safe" }] },
      { rows: [{ id: "77777777-7777-4777-8777-777777777777" }] },
      { rows: [] }, { rows: [] }, { rows: [] }, ...after,
    ];
    const tx = { execute: vi.fn(async () => results.shift()) };
    const database = { transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)) };
    const unlock = vi.spyOn(DrizzleCategoryRegistryRepository.prototype, "unlockAssignment")
      .mockResolvedValue({} as never);
    try {
      const result = await new DrizzleCategoryAuthoringRepository(database as never).mutate({ workspaceId,
        actorId: "66666666-6666-4666-8666-666666666666", actorRef: "reader_owner", role: "owner",
        occurredAt: "2026-08-09T18:00:00.000Z", command: { operation: "unlock_assignment",
          assignmentRef: current.assignments[0]!.ref, expectedVersion: 1,
          expectedRegistryHash: current.registryHash } });
      expect(result).toMatchObject({ auditAppended: true, invalidationsAppended: 1 });
      expect(unlock).toHaveBeenCalledWith(expect.objectContaining({ workspaceId, assignmentId, expectedVersion: 1,
        evidence: [{ kind: "manual_unlock", ref: "reader_owner", observedAt: "2026-08-09T18:00:00.000Z" }] }));
      expect(database.transaction).toHaveBeenCalledTimes(1);
      const calls = tx.execute.mock.calls as unknown as [unknown][];
      const statements = calls.map((call) => new PgDialect().sqlToQuery(call[0] as never).sql).join("\n");
      expect(statements).toContain("exact_entity_component");
      expect(statements).toContain("insert into audit_events");
    } finally { unlock.mockRestore(); }
  });
});
