import { describe, expect, it, vi } from "vitest";

import { buildCategoryAssignmentCommand, isArchiveMutationReady, isRevisionMutationReady, loadCategoryAuthoringState,
  parseCategoryArchiveImpact, parseCategoryAuthoringState,
  runCategoryAuthoringMutation } from "@/app/dashboard/category-inventory-panel";

const refs = { dimension: `dimension_${"a".repeat(24)}`, definition: `category_${"b".repeat(24)}`,
  assignment: `assignment_${"c".repeat(24)}`, entity: `category_entity_${"d".repeat(24)}`,
  adEntity: `category_entity_${"f".repeat(24)}` };
const hash = "e".repeat(64);
const authority = { canCreate: true, canRevise: true, canArchive: true, canAssign: true,
  canAuthorizeAction: false, canWriteMeta: false } as const;
const authoringPayload = { contractVersion: "category-authoring/1.0.0", registryHash: hash,
  dimensions: [{ ref: refs.dimension, key: "service_line", name: "Hizmet", description: null,
    cardinality: "single", allowedEntityLevels: ["campaign", "creative"], version: 3,
    definitions: [{ ref: refs.definition, key: "hair", label: "Saç", description: null, version: 2 }] }],
  assignments: [{ ref: refs.assignment, dimensionRef: refs.dimension, definitionRef: refs.definition,
    entity: { level: "campaign", ref: refs.entity }, operation: "add", manualLock: false,
    confidenceBasisPoints: 9_000, version: 1 }], targets: [
    { ref: refs.entity, level: "campaign", label: "Lead kampanyası", viaAdRef: null },
    { ref: `category_entity_${"1".repeat(24)}`, level: "creative", label: "Kreatif · Reklam üzerinden",
      viaAdRef: refs.adEntity },
  ], authority };
const exactBlockers = { activeDefinitions: 0, activeAssignments: 0, manualLocks: 0, guidanceDrafts: 0,
  guidancePublished: 0, activePromotionBindings: 0, activePromotionTemplateScopes: 0,
  activeAdvisedPractices: 0, activeCategoryProfiles: 0, autonomyDrafts: 0, autonomyPublished: 0,
  guardrailDrafts: 0, guardrailPublished: 0 };
const integrity = { unclassifiedJsonbColumns: 0, missingManifestJsonbColumns: 0, unresolvedCategoryRefs: 0,
  inconsistentPromotionEdges: 0, malformedCategoryContracts: 0, corruptLifecycleRows: 0, ambiguousLineage: 0 };
const impactPayload = { contractVersion: "category-archive-impact/2.0.0", impactHash: "f".repeat(64),
  target: { kind: "definition", ref: refs.definition, label: "Saç", version: 2 }, exactBlockers,
  conservativeBlockers: { nonTerminalActionProposalUnits: 0 }, historicalImpact: { archivedGuidance: 0,
    expiredPromotionBindings: 0, supersededPromotionTemplateScopes: 0, retiredAdvisedPractices: 0,
    supersededAdvisedPractices: 0, historicalCategoryProfiles: 0,
    effectiveContexts: 1, alreadyInvalidatedContexts: 0,
    budgetProposals: 0, terminalActionProposalUnits: 0 }, invalidationPlan: {
    categoryResolutionComponents: 1, contextsNeedingInvalidation: 1 }, coverage: { complete: true,
    precision: "exact_with_conservative_action_queue", manifestVersion: "category-dependency-manifest/1.0.0",
    exactRelational: ["category_assignments"], exactContractRef: ["guidance_contract"],
    conservative: ["action_proposal_units"], partialOrUnknown: [], integrity }, disposition: "review_required",
  archiveAllowed: false, authority: { canArchive: false, canAssign: false, canAuthorizeAction: false, canWriteMeta: false } };

describe("A09.7 guarded category authoring dashboard contract", () => {
  it("loads authority and optimistic state through the guarded same-origin GET contract", async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify(authoringPayload), { status: 200 }));
    await expect(loadCategoryAuthoringState(request as unknown as typeof fetch)).resolves.toMatchObject({
      registryHash: hash, authority });
    expect(request).toHaveBeenCalledWith("/api/category-authoring", { cache: "no-store", credentials: "same-origin",
      headers: { "X-ReklamZeka-Intent": "category-authoring-read" } });
  });

  it("accepts only the complete v2 impact contract and opens archive for matching server authority/version", () => {
    const state = parseCategoryAuthoringState(authoringPayload);
    const impact = parseCategoryArchiveImpact(impactPayload);
    expect(isArchiveMutationReady(impact, state)).toBe(true);
    expect(isRevisionMutationReady(impact, state)).toBe(true);
    expect(() => parseCategoryArchiveImpact({ ...impactPayload,
      contractVersion: "category-archive-impact/1.0.0" })).toThrow("güvenli sözleşmeyi");
    expect(() => parseCategoryArchiveImpact({ ...impactPayload, coverage: { ...impactPayload.coverage,
      integrity: { ...integrity, ambiguousLineage: 1 } } })).toThrow("güvenli sözleşmeyi");
  });

  it("keeps archive closed for conservative blockers, incomplete coverage, stale version, or viewer authority", () => {
    const state = parseCategoryAuthoringState(authoringPayload);
    const impact = parseCategoryArchiveImpact(impactPayload);
    expect(isArchiveMutationReady({ ...impact, conservativeBlockers: { nonTerminalActionProposalUnits: 1 } }, state)).toBe(false);
    expect(isArchiveMutationReady({ ...impact, coverage: { ...impact.coverage, complete: false,
      partialOrUnknown: ["unknown_contract"] } }, state)).toBe(false);
    expect(isArchiveMutationReady({ ...impact, target: { ...impact.target, version: 3 } }, state)).toBe(false);
    expect(isArchiveMutationReady(impact, { ...state, authority: { ...state.authority, canArchive: false } })).toBe(false);
    expect(isRevisionMutationReady(impact, { ...state, authority: { ...state.authority, canRevise: false } })).toBe(false);
  });

  it("binds definition revision to the preview hash, registry hash, and matching expected version", async () => {
    const request = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ contractVersion: "category-authoring/1.0.0",
      state: { registryHash: hash, dimensions: authoringPayload.dimensions, assignments: authoringPayload.assignments,
        targets: authoringPayload.targets },
      auditAppended: true, invalidationsAppended: 1, authority, canAuthorizeAction: false, canWriteMeta: false }), { status: 200 }));
    const command = { operation: "revise_definition" as const, definitionRef: refs.definition, expectedVersion: 2,
      label: "Saç ekimi", description: "Güncel tanım", expectedRegistryHash: hash,
      expectedImpactHash: impactPayload.impactHash };
    await runCategoryAuthoringMutation(command, request as unknown as typeof fetch);
    expect(request).toHaveBeenCalledWith("/api/category-authoring", expect.objectContaining({
      body: JSON.stringify({ command }), headers: expect.objectContaining({
        "X-ReklamZeka-Intent": "category-authoring-mutate" }) }));
    const dimensionCommand = { operation: "revise_dimension" as const, dimensionRef: refs.dimension,
      expectedVersion: 3, name: "Hizmet hattı", description: null, cardinality: "multi",
      allowedEntityLevels: ["campaign", "ad_set"], expectedRegistryHash: hash,
      expectedImpactHash: impactPayload.impactHash };
    await runCategoryAuthoringMutation(dimensionCommand, request as unknown as typeof fetch);
    expect(request).toHaveBeenLastCalledWith("/api/category-authoring", expect.objectContaining({
      body: JSON.stringify({ command: dimensionCommand }) }));
  });

  it("sends the exact optimistic mutation envelope and preserves closed action/Meta authority", async () => {
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ contractVersion: "category-authoring/1.0.0",
      state: { registryHash: hash, dimensions: authoringPayload.dimensions, assignments: authoringPayload.assignments,
        targets: authoringPayload.targets },
      auditAppended: true, invalidationsAppended: 1, authority, canAuthorizeAction: false, canWriteMeta: false }), { status: 200 }));
    const command = { operation: "archive_definition" as const, definitionRef: refs.definition, expectedVersion: 2,
      expectedRegistryHash: hash, expectedImpactHash: impactPayload.impactHash };
    const result = await runCategoryAuthoringMutation(command, request as unknown as typeof fetch);
    expect(result.invalidationsAppended).toBe(1);
    expect(request).toHaveBeenCalledWith("/api/category-authoring", expect.objectContaining({ method: "POST",
      credentials: "same-origin", headers: { "Content-Type": "application/json",
        "X-ReklamZeka-Intent": "category-authoring-mutate" }, body: JSON.stringify({ command }) }));
  });

  it("fails closed when role authority is inconsistent or action/Meta authority opens", async () => {
    expect(() => parseCategoryAuthoringState({ ...authoringPayload,
      authority: { ...authority, canAssign: false } })).toThrow("güvenli sözleşmeyi");
    const request = vi.fn().mockResolvedValue(new Response(JSON.stringify({ contractVersion: "category-authoring/1.0.0",
      state: { registryHash: hash, dimensions: authoringPayload.dimensions, assignments: authoringPayload.assignments,
        targets: authoringPayload.targets },
      auditAppended: true, invalidationsAppended: 0, authority, canAuthorizeAction: true, canWriteMeta: false }), { status: 200 }));
    await expect(runCategoryAuthoringMutation({ operation: "create_definition", dimensionRef: refs.dimension,
      key: "new_value", label: "Yeni", description: null, expectedRegistryHash: hash },
    request as unknown as typeof fetch)).rejects.toThrow("güvenli sözleşmeyi");
  });

  it("accepts only opaque workspace targets and exact creative via-ad paths", () => {
    const state = parseCategoryAuthoringState(authoringPayload);
    expect(state.targets).toHaveLength(2);
    expect(buildCategoryAssignmentCommand(state, { dimensionRef: refs.dimension, definitionRef: refs.definition,
      level: "creative", targetKey: `${state.targets[1]!.ref}:${refs.adEntity}`, operation: "override",
      manualLock: true, confidencePercent: "92.5" })).toEqual({ operation: "create_assignment",
      dimensionRef: refs.dimension, definitionRef: refs.definition, entityLevel: "creative",
      entityRef: state.targets[1]!.ref, viaAdRef: refs.adEntity, assignmentOperation: "override", manualLock: true,
      confidenceBasisPoints: 9_250, expectedRegistryHash: hash });
    expect(() => parseCategoryAuthoringState({ ...authoringPayload, targets: [{
      ref: "123456789012345", level: "campaign", label: "Leak", viaAdRef: null,
    }] })).toThrow("güvenli sözleşmeyi");
    expect(() => parseCategoryAuthoringState({ ...authoringPayload, targets: [{
      ref: `category_entity_${"1".repeat(24)}`, level: "creative", label: "Ambiguous", viaAdRef: null,
    }] })).toThrow("güvenli sözleşmeyi");
    expect(buildCategoryAssignmentCommand({ ...state, authority: { ...state.authority, canCreate: false,
      canRevise: false, canArchive: false, canAssign: false } }, { dimensionRef: refs.dimension,
      definitionRef: refs.definition, level: "campaign", targetKey: `${refs.entity}:direct`, operation: "add",
      manualLock: false, confidencePercent: "100" })).toBeNull();
  });
});
