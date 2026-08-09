import { describe, expect, it } from "vitest";

import {
  assertValidCategoryProfile,
  bindCategoryProfiles,
  CategoryProfileError,
  createCategoryProfile,
  reviseCategoryProfile,
} from "@/domain/categories/category-profile";
import { categoryDefinitionPublicRef } from "@/domain/categories/public-reference";
import { resolveEffectiveCategory, type CategoryDefinition, type CategoryDimension } from "@/domain/categories/registry";

const workspaceId = "11111111-1111-4111-a111-111111111111";
const categoryRef = categoryDefinitionPublicRef("service_line", "cardiology");
const bindings = Object.freeze({
  analysisPlaybookRefs: ["analysis_playbook_health_v1"],
  ruleInstructionBundleRefs: ["instruction_bundle_clinical_v1"],
  budgetPolicyRefs: ["budget_policy_cardiology_v1"],
  transferPolicyRefs: ["transfer_policy_protected_v1"],
  schedulePolicyRefs: ["schedule_policy_weekday_v1"],
  actionPolicyRefs: ["guardrail_cardiology_v1", "approval_policy_cardiology_v1"],
  creativePolicyRefs: ["creative_policy_health_v1"],
});

function input(status: "draft" | "active" = "draft") {
  return { workspaceRef: "workspace_doruk", profileRef: "category_profile_cardiology",
    categoryRef, parentCategoryRef: null, label: "Kardiyoloji", description: "Kalp sağlığı hizmetleri",
    color: "#A31F34", ownerRef: "actor_category_owner", status, bindings } as const;
}
function profile(status: "draft" | "active" = "draft") {
  return createCategoryProfile(input(status));
}

function frozenCategory() {
  const dimension: CategoryDimension = { id: "dimension-service", workspaceId, key: "service_line", version: 1,
    cardinality: "single", allowedEntityLevels: ["campaign"], archivedAt: null };
  const definition: CategoryDefinition = { id: "definition-cardiology", workspaceId, dimensionId: dimension.id,
    key: "cardiology", label: "Kardiyoloji", version: 1, archivedAt: null };
  return resolveEffectiveCategory({ dimension, definitions: [definition], path: { workspaceId,
    nodes: [{ level: "campaign", id: "campaign-cardiology" }] }, assignments: [{ id: "assignment-cardiology",
      workspaceId, dimensionId: dimension.id, definitionId: definition.id,
      entity: { level: "campaign", id: "campaign-cardiology" }, operation: "add", source: "manual",
      manualLock: true, evidence: [{ kind: "owner", ref: "statement-cardiology" }], confidence: 1,
      version: 1, archivedAt: null }] }).frozenContext;
}

describe("CategoryProfile contract", () => {
  it("normalizes every R-09.10 binding, metadata field and negative capability into a stable hash", () => {
    const created = profile();
    expect(created).toMatchObject({ schemaVersion: "category-profile/1.0.0", categoryRef,
      parentCategoryRef: null, color: "#A31F34", ownerRef: "actor_category_owner", status: "draft",
      version: 1, previousProfileHash: null, authority: { canAuthorizeAction: false, canExecuteWrite: false,
        canWriteMeta: false, canGrantApproval: false } });
    expect(created.bindings).toEqual({ ...bindings,
      actionPolicyRefs: ["approval_policy_cardiology_v1", "guardrail_cardiology_v1"] });
    expect(created.profileHash).toMatch(/^[a-f0-9]{64}$/);
    expect(assertValidCategoryProfile(JSON.parse(JSON.stringify(created)))).toEqual(created);
  });

  it("keeps an append-only hash chain and rejects terminal lifecycle transitions", () => {
    const draft = profile();
    const active = reviseCategoryProfile({ current: draft, changes: { status: "active", color: "#B22040" } });
    const archived = reviseCategoryProfile({ current: active, changes: { status: "archived" } });
    expect(active).toMatchObject({ version: 2, previousProfileHash: draft.profileHash, status: "active" });
    expect(archived).toMatchObject({ version: 3, previousProfileHash: active.profileHash, status: "archived" });
    expect(() => reviseCategoryProfile({ current: archived, changes: { status: "active" } }))
      .toThrowError(expect.objectContaining<Partial<CategoryProfileError>>({ code: "invalid_transition" }));
  });

  it("rejects wrong ref families, extra fields, raw UUIDs, secret material and tampering", () => {
    expect(() => createCategoryProfile({ ...input(),
      bindings: { ...bindings, budgetPolicyRefs: ["creative_policy_wrong_family"] } }))
      .toThrowError(expect.objectContaining<Partial<CategoryProfileError>>({ code: "invalid_input" }));
    expect(() => createCategoryProfile({ ...input(), description: `raw ${workspaceId}` }))
      .toThrowError(CategoryProfileError);
    expect(() => createCategoryProfile({ ...input(), description: "Bearer abcdef" }))
      .toThrowError(CategoryProfileError);
    expect(() => assertValidCategoryProfile({ ...profile(), unexpectedAuthority: true }))
      .toThrowError(expect.objectContaining<Partial<CategoryProfileError>>({ code: "inauthentic_profile" }));
    expect(() => assertValidCategoryProfile({ ...profile(), color: "#000000" })).toThrowError(CategoryProfileError);
  });

  it("binds only active matching profiles by ref/version/hash without changing the historical source", () => {
    const source = frozenCategory();
    const active = reviseCategoryProfile({ current: profile(), changes: { status: "active" } });
    const bound = bindCategoryProfiles(source, [active]);
    expect(bound.profileBindings).toEqual([{ categoryRef, profileRef: active.profileRef,
      profileVersion: 2, profileHash: active.profileHash }]);
    expect(bound.resolutionHash).not.toBe(source.resolutionHash);
    expect(source.profileBindings).toBeUndefined();
    expect(() => bindCategoryProfiles(source, [profile()])).toThrowError(
      expect.objectContaining<Partial<CategoryProfileError>>({ code: "scope_mismatch" }));
    expect(() => bindCategoryProfiles({ ...source, resolutionHash: "0".repeat(64) }, [active]))
      .toThrowError(expect.objectContaining<Partial<CategoryProfileError>>({ code: "inauthentic_profile" }));
  });
});
