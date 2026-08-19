import { describe, expect, it, vi } from "vitest";

import { buildStarterCategoryAdoptionPlan, StarterCategoryAdoptionService } from
  "@/application/starter-category-adoption-service";
import type { CategoryAuthoringState } from "@/application/category-authoring-service";
import { createCategoryProfile } from "@/domain/categories/category-profile";
import { categoryDefinitionPublicRef, categoryDimensionPublicRef } from "@/domain/categories/public-reference";
import { STARTER_CATEGORY_PLAYBOOK_CATALOG } from "@/domain/categories/starter-playbook-catalog";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const ownerId = "22222222-2222-4222-8222-222222222222";
const viewerId = "33333333-3333-4333-8333-333333333333";
const analystId = "44444444-4444-4444-8444-444444444444";
const principal = (userId: string) => ({ actor: { userId }, workspaceId,
  workspaceRef: "workspace_starter", readerRef: "actor_starter_owner" }) as const;
const empty = (registryHash = "a".repeat(64)): CategoryAuthoringState => Object.freeze({
  registryHash, dimensions: [], assignments: [], targets: [],
});
const profiles = Object.freeze({ registryHash: "b".repeat(64), definitions: Object.freeze([]) });
const memberships = [{ userId: ownerId, workspaceId, role: "owner" as const },
  { userId: viewerId, workspaceId, role: "viewer" as const },
  { userId: analystId, workspaceId, role: "analyst" as const }];
const result = Object.freeze({ outcome: "inserted" as const, registryHash: "c".repeat(64),
  profileRegistryHash: "d".repeat(64), dimensionsCreated: 15, definitionsCreated: 9,
  profileDraftsCreated: 9, auditAppended: true, categoryInvalidationsAppended: 0,
  profileInvalidationsAppended: 0 });

describe("starter category adoption plan", () => {
  it("covers the strict market boundary and folds concrete starter values into deterministic draft profiles", () => {
    const first = buildStarterCategoryAdoptionPlan("workspace_starter", empty(), profiles);
    const second = buildStarterCategoryAdoptionPlan("workspace_starter", empty(), profiles);
    expect(second).toEqual(first);
    expect(first.summary).toMatchObject({ canonicalDimensions: 15, dimensionsToCreate: 15,
      definitionsToCreate: 9, profileProposals: 54, profileDraftsToCreate: 9, satisfied: 0, conflicts: 0 });
    expect(first.profileDrafts).toHaveLength(9); expect(first.targetRefs).toHaveLength(33);
    for (const draft of first.profileDrafts) {
      expect(draft).toMatchObject({ disposition: "create", proposalHashes: expect.any(Array),
        profileRef: expect.stringMatching(/^category_profile_starter_[a-f0-9]{24}$/) });
      expect(draft.proposalHashes).toHaveLength(6);
      expect(draft.material.bindings.analysisPlaybookRefs).toHaveLength(6);
      expect(new Set(draft.material.bindings.analysisPlaybookRefs).size).toBe(6);
    }
    expect(first.blockers).toContainEqual(expect.objectContaining({ code: "pending_owner_configuration",
      blocking: false }));
    expect(first.blockers.some((blocker) => blocker.blocking)).toBe(false);
    expect(first).toMatchObject({ status: "preview_only", pendingOwnerConfigurationAcknowledgementRequired: true,
      authority: { canPersist: false, canAuthorizeAction: false, canWriteMeta: false, canPublishPolicy: false } });
    expect(JSON.stringify(first)).not.toContain(workspaceId);
  });

  it("is idempotent for compatible category material and hard-blocks incompatible dimensions", () => {
    const dimension = { ref: categoryDimensionPublicRef("audience_strategy"), key: "audience_strategy",
      name: "Kitle stratejisi", description: null, cardinality: "single" as const,
      allowedEntityLevels: ["campaign", "ad_set"] as const, version: 1,
      definitions: [{ ref: categoryDefinitionPublicRef("audience_strategy", "prospecting"), key: "prospecting",
        label: "Yeni kitle", description: null, version: 1 }] };
    const compatible = buildStarterCategoryAdoptionPlan("workspace_starter", {
      ...empty(), dimensions: [dimension],
    }, profiles);
    expect(compatible.dimensionCoverage.find((item) => item.dimensionKey === "audience_strategy")?.disposition)
      .toBe("satisfied");
    expect(compatible.categoryCommands).not.toContainEqual(expect.objectContaining({ key: "audience_strategy" }));
    expect(compatible.categoryCommands).not.toContainEqual(expect.objectContaining({ key: "prospecting" }));
    const conflicted = buildStarterCategoryAdoptionPlan("workspace_starter", {
      ...empty(), dimensions: [{ ...dimension, cardinality: "multi" as const }],
    }, profiles);
    expect(conflicted.blockers).toContainEqual(expect.objectContaining({ code: "incompatible_existing_dimension",
      blocking: true }));
    expect(conflicted.categoryCommands.filter((command) => command.operation === "create_definition"
      && command.dimensionRef === dimension.ref)).toEqual([]);
    expect(conflicted.profileProposals.filter((proposal) =>
      proposal.categoryTemplateRef.includes("audience_strategy"))).toEqual([]);
  });

  it("accepts only the exact deterministic profile hash and parks different profile content", () => {
    const initial = buildStarterCategoryAdoptionPlan("workspace_starter", empty(), profiles);
    const draft = initial.profileDrafts[0]!;
    const template = STARTER_CATEGORY_PLAYBOOK_CATALOG.categoryTemplates.find((item) =>
      item.templateRef === draft.categoryTemplateRef)!;
    const dimension = STARTER_CATEGORY_PLAYBOOK_CATALOG.dimensions.find((item) =>
      item.dimensionKey === template.dimensionKey)!;
    const artifact = (ownerRef: string) => createCategoryProfile({ workspaceRef: "workspace_starter",
      profileRef: draft.profileRef, categoryRef: draft.categoryRef, parentCategoryRef: null,
      label: draft.material.label, description: draft.material.description, color: draft.material.color,
      ownerRef, status: "draft", bindings: draft.material.bindings });
    const state = (currentProfile: ReturnType<typeof artifact>) => ({ registryHash: "c".repeat(64), definitions: [{
      dimensionRef: dimension.dimensionRef, dimensionKey: dimension.dimensionKey, definitionRef: draft.categoryRef,
      label: draft.material.label, description: draft.material.description, currentProfile,
    }] });
    expect(buildStarterCategoryAdoptionPlan("workspace_starter", empty(),
      state(artifact("actor_starter_catalog"))).profileDrafts[0]).toMatchObject({ disposition: "satisfied",
      expectedProfileHash: artifact("actor_starter_catalog").profileHash });
    const conflicted = buildStarterCategoryAdoptionPlan("workspace_starter", empty(),
      state(artifact("actor_different_owner")));
    expect(conflicted.profileDrafts[0]).toMatchObject({ disposition: "conflict" });
    expect(conflicted.blockers).toContainEqual(expect.objectContaining({
      code: "existing_category_profile_conflict", blocking: true, refs: [draft.profileRef] }));
  });

  it("grants only owner/admin core persistence and binds acknowledgement, profile OCC and target refs", async () => {
    const inspect = vi.fn(async () => ({ categories: empty(), profiles })); const adopt = vi.fn(async () => result);
    const service = new StarterCategoryAdoptionService({ inspect, adopt }, memberships);
    const preview = await service.preview(principal(ownerId));
    const command = { planHash: preview.planHash, expectedRegistryHash: preview.registryHash,
      expectedProfileRegistryHash: preview.profileRegistryHash, targetRefs: preview.targetRefs,
      confirmation: "adopt_starter_category_playbook" as const,
      acknowledgedPendingOwnerConfiguration: true as const };
    await expect(service.confirm(principal(ownerId), command)).resolves.toMatchObject({
      status: "core_adopted_with_owner_configuration_pending", pendingOwnerConfiguration: expect.any(Array),
      result, authority: { canPersist: true, canAuthorizeAction: false, canWriteMeta: false } });
    expect(adopt).toHaveBeenCalledWith(expect.objectContaining({ workspaceId, actorId: ownerId,
      actorRef: "actor_starter_owner", role: "owner", command }));
    await expect(service.confirm(principal(analystId), command)).rejects.toBeTruthy();
    expect((await service.preview(principal(viewerId))).authority).toMatchObject({ canConfirm: false, canPersist: false });
    await expect(service.confirm(principal(ownerId), { ...command,
      acknowledgedPendingOwnerConfiguration: false as never })).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("retains all canonical dimensions in exact catalog order", () => {
    expect(STARTER_CATEGORY_PLAYBOOK_CATALOG.dimensions.map((item) => item.dimensionKey)).toEqual([
      "market", "service_line", "brand_clinic", "geo_market", "language", "campaign_role", "funnel_intent",
      "audience_strategy", "destination", "budget_pool", "operating_mode", "lifecycle", "experiment",
      "protection_class", "custom",
    ]);
  });
});
