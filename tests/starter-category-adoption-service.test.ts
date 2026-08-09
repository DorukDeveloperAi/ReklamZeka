import { describe, expect, it, vi } from "vitest";

import { buildStarterCategoryAdoptionPlan, StarterCategoryAdoptionService } from
  "@/application/starter-category-adoption-service";
import type { CategoryAuthoringState } from "@/application/category-authoring-service";
import { categoryDefinitionPublicRef, categoryDimensionPublicRef } from "@/domain/categories/public-reference";
import { STARTER_CATEGORY_PLAYBOOK_CATALOG } from "@/domain/categories/starter-playbook-catalog";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const ownerId = "22222222-2222-4222-8222-222222222222";
const viewerId = "33333333-3333-4333-8333-333333333333";
const analystId = "44444444-4444-4444-8444-444444444444";
const principal = (userId: string) => ({ actor: { userId }, workspaceId,
  workspaceRef: "workspace_starter", readerRef: `reader_${userId.slice(0, 8)}` }) as const;
const empty = (registryHash = "a".repeat(64)): CategoryAuthoringState => Object.freeze({
  registryHash, dimensions: [], assignments: [], targets: [],
});
const memberships = [{ userId: ownerId, workspaceId, role: "owner" as const },
  { userId: viewerId, workspaceId, role: "viewer" as const },
  { userId: analystId, workspaceId, role: "analyst" as const }];

describe("starter category adoption plan", () => {
  it("covers all 14 canonical dimensions and remains deterministic, bounded and authority-free", () => {
    const first = buildStarterCategoryAdoptionPlan("workspace_starter", empty());
    const second = buildStarterCategoryAdoptionPlan("workspace_starter", empty());
    expect(second).toEqual(first);
    expect(first.summary).toMatchObject({ canonicalDimensions: 14, dimensionsToCreate: 14,
      definitionsToCreate: 7, profileProposals: 42, satisfied: 0, conflicts: 0 });
    expect(first.dimensionCoverage.map((item) => item.dimensionKey)).toEqual([
      "service_line", "brand_clinic", "geo_market", "language", "campaign_role", "funnel_intent",
      "audience_strategy", "destination", "budget_pool", "operating_mode", "lifecycle", "experiment",
      "protection_class", "custom",
    ]);
    expect(first.blockers.map((item) => item.code)).toEqual(expect.arrayContaining([
      "atomic_multi_command_category_adoption_unavailable", "category_profile_registry_unavailable",
      "owner_configuration_required",
    ]));
    expect(first).toMatchObject({ status: "preview_only", ownerConfirmationRequired: true,
      authority: { canPersist: false, canAuthorizeAction: false, canWriteMeta: false, canPublishPolicy: false } });
    expect(JSON.stringify(first)).not.toMatch(new RegExp(workspaceId));
  });

  it("is idempotent for compatible existing category material and parks incompatible dimensions", () => {
    const dimension = { ref: categoryDimensionPublicRef("audience_strategy"), key: "audience_strategy",
      name: "Kitle stratejisi", description: null, cardinality: "single" as const,
      allowedEntityLevels: ["campaign", "ad_set"] as const, version: 1,
      definitions: [{ ref: categoryDefinitionPublicRef("audience_strategy", "prospecting"), key: "prospecting",
        label: "Yeni kitle", description: null, version: 1 }] };
    const compatible = buildStarterCategoryAdoptionPlan("workspace_starter", {
      ...empty(), dimensions: [dimension],
    });
    expect(compatible.dimensionCoverage.find((item) => item.dimensionKey === "audience_strategy")?.disposition)
      .toBe("satisfied");
    expect(compatible.categoryCommands).not.toContainEqual(expect.objectContaining({ key: "audience_strategy" }));
    expect(compatible.categoryCommands).not.toContainEqual(expect.objectContaining({ key: "prospecting" }));
    const conflicted = buildStarterCategoryAdoptionPlan("workspace_starter", {
      ...empty(), dimensions: [{ ...dimension, cardinality: "multi" as const }],
    });
    expect(conflicted.dimensionCoverage.find((item) => item.dimensionKey === "audience_strategy")?.disposition)
      .toBe("conflict");
    expect(conflicted.categoryCommands.filter((command) => command.operation === "create_definition"
      && command.dimensionRef === dimension.ref)).toEqual([]);
    expect(conflicted.profileProposals.filter((proposal) =>
      proposal.categoryTemplateRef.includes("audience_strategy"))).toEqual([]);
  });

  it("allows only owner confirmation, revalidates OCC and returns a replay-stable zero-write blocker", async () => {
    const inspect = vi.fn(async () => empty());
    const service = new StarterCategoryAdoptionService({ inspect }, memberships);
    const preview = await service.preview(principal(ownerId));
    const command = { planHash: preview.planHash, expectedRegistryHash: preview.registryHash,
      confirmation: "adopt_starter_category_playbook" as const };
    const first = await service.confirm(principal(ownerId), command);
    const second = await service.confirm(principal(ownerId), command);
    expect(second).toEqual(first);
    expect(first).toMatchObject({ status: "blocked", persistenceAttempted: false,
      blocker: "atomic_multi_command_category_adoption_unavailable",
      continuation: { replay: command }, authority: { canPersist: false, canConfirm: true,
        canAuthorizeAction: false, canWriteMeta: false, canPublishPolicy: false } });
    await expect(service.confirm(principal(analystId), command)).rejects.toBeTruthy();
    expect((await service.preview(principal(viewerId))).authority.canConfirm).toBe(false);

    const stale = new StarterCategoryAdoptionService({ inspect: vi.fn(async () => empty("b".repeat(64))) }, memberships);
    await expect(stale.confirm(principal(ownerId), command)).rejects.toMatchObject({ code: "conflict" });
  });

  it("reports dimension conflict rather than an atomic-batch capability when no commands can be proposed", async () => {
    const dimensions = STARTER_CATEGORY_PLAYBOOK_CATALOG.dimensions.map((template) => ({
      ref: template.dimensionRef, key: template.dimensionKey, name: template.label, description: null,
      cardinality: template.suggestedCardinality === "single" ? "multi" as const : "single" as const,
      allowedEntityLevels: template.suggestedEntityLevels, version: 1, definitions: [],
    }));
    const inspect = vi.fn(async () => ({ ...empty(), dimensions }));
    const service = new StarterCategoryAdoptionService({ inspect }, memberships);
    const preview = await service.preview(principal(ownerId));
    expect(preview).toMatchObject({ summary: { dimensionsToCreate: 0, definitionsToCreate: 0,
      profileProposals: 0, conflicts: 14 } });
    expect(preview.blockers.some((entry) =>
      entry.code === "atomic_multi_command_category_adoption_unavailable")).toBe(false);
    await expect(service.confirm(principal(ownerId), { planHash: preview.planHash,
      expectedRegistryHash: preview.registryHash, confirmation: "adopt_starter_category_playbook" }))
      .resolves.toMatchObject({ blocker: "incompatible_existing_dimension",
        continuation: { requiredCapability: "owner_category_dimension_conflict_resolution/1.0.0" } });
  });
});
