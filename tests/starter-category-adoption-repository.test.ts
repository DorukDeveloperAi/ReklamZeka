import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

import { buildStarterCategoryAdoptionPlan, starterCategoryAdoptionDigest,
  starterCategoryProfileDraftManifestDigest } from "@/application/starter-category-adoption-service";
import type { CategoryAuthoringState } from "@/application/category-authoring-service";
import { DrizzleCategoryAuthoringRepository } from "@/connectors/categories/category-authoring-drizzle-repository";
import { DrizzleCategoryProfileLifecycleRepository } from
  "@/connectors/categories/category-profile-lifecycle-drizzle-repository";
import { DrizzleCategoryProfileRepository } from "@/connectors/categories/category-profile-drizzle-repository";
import { DrizzleCategoryRegistryRepository } from "@/connectors/categories/category-registry-drizzle-repository";
import { DrizzleStarterCategoryAdoptionRepository } from
  "@/connectors/categories/starter-category-adoption-drizzle-repository";
import { createCategoryProfile } from "@/domain/categories/category-profile";
import { categoryDefinitionPublicRef } from "@/domain/categories/public-reference";
import { STARTER_CATEGORY_PLAYBOOK_CATALOG } from "@/domain/categories/starter-playbook-catalog";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const workspaceRef = "workspace_starter";
const emptyCategories = Object.freeze({ registryHash: "a".repeat(64), dimensions: Object.freeze([]),
  assignments: Object.freeze([]), targets: Object.freeze([]) });
const emptyProfiles = Object.freeze({ registryHash: "b".repeat(64), definitions: Object.freeze([]) });

function dimensions(withDefinitions: boolean): CategoryAuthoringState {
  return Object.freeze({ registryHash: (withDefinitions ? "d" : "c").repeat(64), assignments: Object.freeze([]),
    targets: Object.freeze([]), dimensions: Object.freeze(STARTER_CATEGORY_PLAYBOOK_CATALOG.dimensions.map((dimension) =>
      Object.freeze({ ref: dimension.dimensionRef, key: dimension.dimensionKey, name: dimension.label,
        description: `ReklamZeka starter dimension · ${dimension.dimensionKey}`,
        cardinality: dimension.suggestedCardinality, allowedEntityLevels: dimension.suggestedEntityLevels,
        version: 1, definitions: Object.freeze(withDefinitions ? STARTER_CATEGORY_PLAYBOOK_CATALOG.categoryTemplates
          .filter((template) => template.dimensionKey === dimension.dimensionKey && template.categoryKey !== null
            && template.kind === "concrete_example" && template.ownerConfigurationFields.length === 0)
          .map((template) => Object.freeze({ ref: categoryDefinitionPublicRef(dimension.dimensionKey, template.categoryKey!),
            key: template.categoryKey!, label: template.label, description: template.description, version: 1 })) : []) }))),
  });
}
const initialPlan = buildStarterCategoryAdoptionPlan(workspaceRef, emptyCategories, emptyProfiles, "actor_starter");
const fullCategories = dimensions(true);
const partialCategories = Object.freeze({ ...emptyCategories, registryHash: "9".repeat(64),
  dimensions: Object.freeze([dimensions(false).dimensions.find((dimension) =>
    dimension.key === "audience_strategy")!]) });
const partialPlan = buildStarterCategoryAdoptionPlan(workspaceRef, partialCategories, emptyProfiles, "actor_starter");
const finalProfiles = Object.freeze({ registryHash: "e".repeat(64), definitions: Object.freeze(initialPlan.profileDrafts.map((draft) => {
  const dimension = STARTER_CATEGORY_PLAYBOOK_CATALOG.categoryTemplates.find((template) =>
    template.templateRef === draft.categoryTemplateRef)!.dimensionKey;
  return Object.freeze({ dimensionRef: STARTER_CATEGORY_PLAYBOOK_CATALOG.dimensions.find((item) =>
    item.dimensionKey === dimension)!.dimensionRef, dimensionKey: dimension, definitionRef: draft.categoryRef,
    label: draft.material.label, description: draft.material.description,
    currentProfile: createCategoryProfile({ workspaceRef, profileRef: draft.profileRef, categoryRef: draft.categoryRef,
      parentCategoryRef: null, label: draft.material.label, description: draft.material.description,
      color: draft.material.color, ownerRef: "actor_starter", status: "draft", bindings: draft.material.bindings }) });
})) });
const command = Object.freeze({ planHash: initialPlan.planHash, expectedRegistryHash: initialPlan.registryHash,
  expectedProfileRegistryHash: initialPlan.profileRegistryHash, targetRefs: initialPlan.targetRefs,
  confirmation: "adopt_starter_category_playbook" as const,
  acknowledgedPendingOwnerConfiguration: true as const });
const partialCommand = Object.freeze({ planHash: partialPlan.planHash,
  expectedRegistryHash: partialPlan.registryHash, expectedProfileRegistryHash: partialPlan.profileRegistryHash,
  targetRefs: partialPlan.targetRefs, confirmation: "adopt_starter_category_playbook" as const,
  acknowledgedPendingOwnerConfiguration: true as const });
const existingDimensionId = "55555555-5555-4555-8555-555555555555";
const createdDimensionId = "33333333-3333-4333-8333-333333333333";

function fixture(options: Readonly<{ role?: string; auditFails?: boolean; replay?: boolean;
  frozenExistingDimension?: boolean }> = {}) {
  const statements: string[] = []; let auditMetadata: Record<string, unknown> | null = null; let rolledBack = false;
  const execute = vi.fn(async (statement: never) => {
    const rendered = new PgDialect().sqlToQuery(statement); statements.push(rendered.sql);
    if (rendered.sql.includes("select id::text from workspaces")) return { rows: [{ id: workspaceId }] };
    if (rendered.sql.includes("select role::text from memberships")) return { rows: options.role === "missing"
      ? [] : [{ role: options.role ?? "owner" }] };
    if (rendered.sql.includes("action = 'starter_category.core_adopted'")) return { rows: options.replay
      ? [{ event_hash: "f".repeat(64) }] : [] };
    if (rendered.sql.includes("select id::text from category_dimensions")) {
      return { rows: [{ id: rendered.params.includes("audience_strategy") ? existingDimensionId : createdDimensionId }] };
    }
    if (rendered.sql.includes("select definition.id::text from category_definitions")) {
      return { rows: [{ id: "44444444-4444-4444-8444-444444444444" }] };
    }
    if (rendered.sql.includes("select event_hash from audit_events")) return { rows: [] };
    if (rendered.sql.includes("select distinct component_ref, component_version from effective_campaign_context_components")) {
      return { rows: options.frozenExistingDimension && rendered.params.includes(existingDimensionId)
        ? [{ component_ref: existingDimensionId, component_version: "8".repeat(64) }] : [] };
    }
    if (rendered.sql.includes("insert into effective_campaign_context_invalidations")) {
      return { rows: [{ id: "66666666-6666-4666-8666-666666666666" }] };
    }
    if (options.auditFails && rendered.sql.includes("insert into audit_events")) throw new Error("audit_failed");
    if (rendered.sql.includes("insert into audit_events")) {
      const encoded = rendered.params.find((value) => typeof value === "string" && value.includes('"planHash"'));
      auditMetadata = JSON.parse(String(encoded)) as Record<string, unknown>;
    }
    return { rows: [] };
  });
  const tx = { execute, transaction: vi.fn(async (callback: (value: unknown) => Promise<unknown>) => callback(tx)) };
  const db = { execute, transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => {
    try { return await callback(tx); } catch (reason) { rolledBack = true; throw reason; }
  }) };
  return { db, statements, get auditMetadata() { return auditMetadata; }, get rolledBack() { return rolledBack; } };
}

function spies(mode: "create" | "replay" | "partial" = "create") {
  const categoryStates = mode === "create" ? [emptyCategories, dimensions(false), fullCategories, fullCategories]
    : mode === "partial" ? [partialCategories, dimensions(false), fullCategories, fullCategories] : [fullCategories];
  const profileStates = mode === "replay" ? [finalProfiles] : [emptyProfiles, finalProfiles];
  const inspectCategory = vi.spyOn(DrizzleCategoryAuthoringRepository.prototype, "inspect")
    .mockImplementation(async () => categoryStates.shift()!);
  const inspectProfiles = vi.spyOn(DrizzleCategoryProfileLifecycleRepository.prototype, "inspect")
    .mockImplementation(async () => profileStates.shift()!);
  const createDimension = vi.spyOn(DrizzleCategoryRegistryRepository.prototype, "createDimension")
    .mockResolvedValue({ id: "33333333-3333-4333-8333-333333333333" } as never);
  const createDefinition = vi.spyOn(DrizzleCategoryRegistryRepository.prototype, "createDefinition")
    .mockResolvedValue({ id: "44444444-4444-4444-8444-444444444444" } as never);
  const append = vi.spyOn(DrizzleCategoryProfileRepository.prototype, "append")
    .mockImplementation(async (profile) => ({ outcome: "inserted", profileHash: (profile as { profileHash: string }).profileHash,
      invalidationsAppended: 0 }));
  return { inspectCategory, inspectProfiles, createDimension, createDefinition, append,
    restore() { inspectCategory.mockRestore(); inspectProfiles.mockRestore(); createDimension.mockRestore();
      createDefinition.mockRestore(); append.mockRestore(); } };
}

describe("DrizzleStarterCategoryAdoptionRepository", () => {
  it("locks, rechecks membership and atomically creates the 14+7+7 core batch with one exact audit", async () => {
    const fake = fixture(); const mocked = spies();
    try {
      const result = await new DrizzleStarterCategoryAdoptionRepository(fake.db as never).adopt({ workspaceId,
        workspaceRef, actorId, actorRef: "actor_starter", role: "owner",
        occurredAt: "2026-08-10T10:00:00.000Z", command });
      expect(result).toMatchObject({ outcome: "inserted", dimensionsCreated: 14, definitionsCreated: 7,
        profileDraftsCreated: 7, auditAppended: true, categoryInvalidationsAppended: 0,
        profileInvalidationsAppended: 0 });
      expect(mocked.createDimension).toHaveBeenCalledTimes(14);
      expect(mocked.createDefinition).toHaveBeenCalledTimes(7); expect(mocked.append).toHaveBeenCalledTimes(7);
      expect(fake.statements[0]).toContain("for update");
      expect(fake.auditMetadata).toMatchObject({ planHash: initialPlan.planHash, targetRefCount: 28,
        catalogVersion: initialPlan.catalogVersion, catalogHash: initialPlan.catalogHash,
        proposalManifestHash: starterCategoryAdoptionDigest(initialPlan.profileProposals), proposalCount: 42,
        profileDraftManifestHash: starterCategoryProfileDraftManifestDigest(initialPlan.profileDrafts),
        profileDraftCount: 7,
        pendingOwnerConfigurationAcknowledged: true, dimensionsCreated: 14, definitionsCreated: 7,
        profileDraftsCreated: 7, categoryInvalidationsAppended: 0, profileInvalidationsAppended: 0 });
      expect(fake.db.transaction).toHaveBeenCalledTimes(1);
    } finally { mocked.restore(); }
  });

  it("invalidates exact frozen category-resolution components for a new definition under an existing dimension", async () => {
    const fake = fixture({ frozenExistingDimension: true }); const mocked = spies("partial");
    try {
      const result = await new DrizzleStarterCategoryAdoptionRepository(fake.db as never).adopt({ workspaceId,
        workspaceRef, actorId, actorRef: "actor_starter", role: "owner",
        occurredAt: "2026-08-10T10:00:30.000Z", command: partialCommand });
      expect(result).toMatchObject({ outcome: "inserted", dimensionsCreated: 13, definitionsCreated: 7,
        profileDraftsCreated: 7, categoryInvalidationsAppended: 1 });
      expect(fake.auditMetadata).toMatchObject({ categoryInvalidationsAppended: 1,
        proposalManifestHash: starterCategoryAdoptionDigest(partialPlan.profileProposals), proposalCount: 42,
        profileDraftManifestHash: starterCategoryProfileDraftManifestDigest(partialPlan.profileDrafts),
        profileDraftCount: 7 });
      expect(fake.statements.some((statement) => statement.includes("effective_campaign_context_components"))).toBe(true);
      expect(fake.statements.some((statement) => statement.includes("insert into effective_campaign_context_invalidations")))
        .toBe(true);
    } finally { mocked.restore(); }
  });

  it("treats exact completed replay as unchanged without duplicate category, profile or audit writes", async () => {
    const fake = fixture({ replay: true }); const mocked = spies("replay");
    try {
      await expect(new DrizzleStarterCategoryAdoptionRepository(fake.db as never).adopt({ workspaceId,
        workspaceRef, actorId, actorRef: "actor_starter", role: "owner",
        occurredAt: "2026-08-10T10:01:00.000Z", command })).resolves.toMatchObject({ outcome: "unchanged",
        auditAppended: false, dimensionsCreated: 0, definitionsCreated: 0, profileDraftsCreated: 0 });
      expect(mocked.createDimension).not.toHaveBeenCalled(); expect(mocked.createDefinition).not.toHaveBeenCalled();
      expect(mocked.append).not.toHaveBeenCalled();
      expect(fake.statements.some((statement) => statement.includes("insert into audit_events"))).toBe(false);
    } finally { mocked.restore(); }
  });

  it("hard-blocks stale OCC and transaction-time membership revocation before any write", async () => {
    for (const testCase of [{ fake: fixture({ role: "missing" }), command, expected: "forbidden" },
      { fake: fixture(), command: { ...command, planHash: "f".repeat(64) }, expected: "conflict" }]) {
      const mocked = spies();
      try {
        await expect(new DrizzleStarterCategoryAdoptionRepository(testCase.fake.db as never).adopt({ workspaceId,
          workspaceRef, actorId, actorRef: "actor_starter", role: "owner",
          occurredAt: "2026-08-10T10:02:00.000Z", command: testCase.command }))
          .rejects.toMatchObject({ code: testCase.expected });
        expect(mocked.createDimension).not.toHaveBeenCalled(); expect(mocked.append).not.toHaveBeenCalled();
      } finally { mocked.restore(); }
    }
  });

  it("rolls category/profile/invalidation work back when the final append-only audit fails", async () => {
    const fake = fixture({ auditFails: true, frozenExistingDimension: true }); const mocked = spies("partial");
    try {
      await expect(new DrizzleStarterCategoryAdoptionRepository(fake.db as never).adopt({ workspaceId,
        workspaceRef, actorId, actorRef: "actor_starter", role: "owner",
        occurredAt: "2026-08-10T10:03:00.000Z", command: partialCommand })).rejects.toThrow("audit_failed");
      expect(mocked.append).toHaveBeenCalledTimes(7); expect(fake.rolledBack).toBe(true);
      expect(fake.statements.some((statement) => statement.includes("insert into effective_campaign_context_invalidations")))
        .toBe(true);
    } finally { mocked.restore(); }
  });
});
