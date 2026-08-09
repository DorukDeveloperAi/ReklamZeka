import { readFileSync } from "node:fs";

import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

import {
  CategoryProfileRepositoryError,
  DrizzleCategoryProfileRepository,
} from "@/connectors/categories/category-profile-drizzle-repository";
import { createCategoryProfile, reviseCategoryProfile, type CategoryProfileRevision } from
  "@/domain/categories/category-profile";
import { categoryDefinitionPublicRef } from "@/domain/categories/public-reference";
import { categoryProfileRevisions } from "@/db/schema";

const workspaceId = "11111111-1111-4111-a111-111111111111";
const definitionId = "22222222-2222-4222-a222-222222222222";
const categoryRef = categoryDefinitionPublicRef("service_line", "cardiology");
const binding = { categoryDefinitionId: definitionId, parentCategoryDefinitionId: null,
  observedAt: "2026-08-09T20:00:00.000Z" } as const;

function input(status: "draft" | "active" = "draft") {
  return { workspaceRef: "workspace_doruk", profileRef: "category_profile_cardiology",
    categoryRef, parentCategoryRef: null, label: "Kardiyoloji", description: "Kalp hizmetleri", color: "#A31F34",
    ownerRef: "actor_category_owner", status, bindings: { analysisPlaybookRefs: ["analysis_playbook_health_v1"],
      ruleInstructionBundleRefs: ["instruction_bundle_health_v1"], budgetPolicyRefs: ["budget_policy_health_v1"],
      transferPolicyRefs: ["transfer_policy_health_v1"], schedulePolicyRefs: ["schedule_policy_health_v1"],
      actionPolicyRefs: ["guardrail_health_v1"], creativePolicyRefs: ["creative_policy_health_v1"] } } as const;
}
function profile(status: "draft" | "active" = "draft") {
  return createCategoryProfile(input(status));
}
function stored(artifact: CategoryProfileRevision) {
  return { category_definition_id: definitionId, workspace_ref: artifact.workspaceRef,
    profile_ref: artifact.profileRef, category_ref: artifact.categoryRef,
    version: artifact.version, previous_profile_hash: artifact.previousProfileHash, status: artifact.status,
    profile_hash: artifact.profileHash, profile_payload: artifact };
}
function database(results: readonly unknown[]) {
  const execute = vi.fn();
  for (const result of results) execute.mockResolvedValueOnce(result);
  const transaction = vi.fn(async (callback: (tx: { execute: typeof execute }) => Promise<unknown>) => callback({ execute }));
  return { execute, transaction };
}
const workspace = { rows: [{ id: workspaceId, lifecycle_state: "active" }] };
const category = { rows: [{ id: definitionId, dimension_id: "dimension-id", dimension_key: "service_line",
  definition_key: "cardiology" }] };

describe("Drizzle CategoryProfile repository", () => {
  it("appends the first tenant-bound revision under an active workspace lock", async () => {
    const artifact = profile();
    const db = database([workspace, category, { rows: [] }, { rows: [] }, { rows: [{ profile_hash: artifact.profileHash }] }]);
    await expect(new DrizzleCategoryProfileRepository(db as never, workspaceId, artifact.workspaceRef)
      .append(artifact, binding)).resolves.toEqual({ outcome: "inserted", profileHash: artifact.profileHash,
        invalidationsAppended: 0 });
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(new PgDialect().sqlToQuery(db.execute.mock.calls[0]![0]).sql).toContain("for update");
    const insert = new PgDialect().sqlToQuery(db.execute.mock.calls[4]![0]).sql;
    expect(insert).toContain("insert into category_profile_revisions");
    expect(insert).not.toContain("meta_");
  });

  it("appends a continuous revision and selectively invalidates only the prior profile hash", async () => {
    const first = profile();
    const second = reviseCategoryProfile({ current: first, changes: { status: "active" } });
    const db = database([workspace, category, { rows: [] }, { rows: [stored(first)] },
      { rows: [{ profile_hash: second.profileHash }] }, { rows: [{ id: "invalidation" }] }]);
    await expect(new DrizzleCategoryProfileRepository(db as never, workspaceId, first.workspaceRef)
      .append(second, binding)).resolves.toEqual({ outcome: "inserted", profileHash: second.profileHash,
        invalidationsAppended: 1 });
    const invalidation = new PgDialect().sqlToQuery(db.execute.mock.calls[5]![0]);
    expect(invalidation.sql).toContain("'category_profile'");
    expect(invalidation.sql).toContain("on conflict (workspace_id, event_hash) do nothing");
    expect(invalidation.params).toEqual(expect.arrayContaining([first.profileRef, first.profileHash]));
    expect(invalidation.params).not.toContain(second.profileHash);
  });

  it("returns exact replay unchanged and fails closed on same-version conflict", async () => {
    const artifact = profile();
    const replay = database([workspace, category, { rows: [stored(artifact)] }]);
    await expect(new DrizzleCategoryProfileRepository(replay as never, workspaceId, artifact.workspaceRef)
      .append(artifact, binding)).resolves.toEqual({ outcome: "unchanged", profileHash: artifact.profileHash,
        invalidationsAppended: 0 });

    const alternative = createCategoryProfile({ ...input(), label: "Alternatif" });
    const conflict = database([workspace, category, { rows: [stored(artifact)] }]);
    await expect(new DrizzleCategoryProfileRepository(conflict as never, workspaceId, artifact.workspaceRef)
      .append(alternative, binding)).rejects.toEqual(expect.objectContaining({ code: "revision_conflict" }));
  });

  it("rejects cross-tenant, wrong category refs, inactive workspaces and tampered payloads", async () => {
    const artifact = profile();
    const untouched = database([]);
    await expect(new DrizzleCategoryProfileRepository(untouched as never, workspaceId, "workspace_other")
      .append(artifact, binding)).rejects.toEqual(expect.objectContaining({ code: "workspace_scope_mismatch" }));
    expect(untouched.execute).not.toHaveBeenCalled();

    const wrongCategory = database([workspace, { rows: [{ ...category.rows[0], definition_key: "neurology" }] }]);
    await expect(new DrizzleCategoryProfileRepository(wrongCategory as never, workspaceId, artifact.workspaceRef)
      .append(artifact, binding)).rejects.toEqual(expect.objectContaining({ code: "category_scope_mismatch" }));

    const inactive = database([{ rows: [{ id: workspaceId, lifecycle_state: "tombstoning" }] }]);
    await expect(new DrizzleCategoryProfileRepository(inactive as never, workspaceId, artifact.workspaceRef)
      .append(artifact, binding)).rejects.toEqual(expect.objectContaining({ code: "inactive_workspace" }));

    const tampered = database([]);
    await expect(new DrizzleCategoryProfileRepository(tampered as never, workspaceId, artifact.workspaceRef)
      .append({ ...artifact, profileHash: "0".repeat(64) }, binding))
      .rejects.toEqual(expect.objectContaining({ code: "invalid_input" }));
    expect(tampered.execute).not.toHaveBeenCalled();
  });

  it("rejects a second current profile series and recursive parent cycles", async () => {
    const original = profile("active");
    const secondSeries = createCategoryProfile({ ...input("active"), profileRef: "category_profile_cardiology_other" });
    const duplicate = database([workspace, category, { rows: [] }, { rows: [stored(original)] }]);
    await expect(new DrizzleCategoryProfileRepository(duplicate as never, workspaceId, original.workspaceRef)
      .append(secondSeries, binding)).rejects.toEqual(expect.objectContaining({ code: "revision_conflict" }));

    const childId = "33333333-3333-4333-a333-333333333333";
    const childRef = categoryDefinitionPublicRef("service_line", "child_service");
    const cyclic = reviseCategoryProfile({ current: original, changes: { parentCategoryRef: childRef } });
    const cycleDb = database([workspace, category, { rows: [{ id: childId, dimension_id: "dimension-id",
      dimension_key: "service_line", definition_key: "child_service" }] }, { rows: [{ id: definitionId }] }]);
    await expect(new DrizzleCategoryProfileRepository(cycleDb as never, workspaceId, original.workspaceRef)
      .append(cyclic, { ...binding, parentCategoryDefinitionId: childId }))
      .rejects.toEqual(expect.objectContaining({ code: "category_scope_mismatch" }));
    expect(new PgDialect().sqlToQuery(cycleDb.execute.mock.calls[3]![0]).sql).toContain("with recursive latest_profile");
  });

  it("loads only the latest authentic private artifact and exposes no mutation authority", async () => {
    const artifact = reviseCategoryProfile({ current: profile(), changes: { status: "active" } });
    const db = database([workspace, { rows: [stored(artifact)] }]);
    await expect(new DrizzleCategoryProfileRepository(db as never, workspaceId, artifact.workspaceRef)
      .latestArtifact(artifact.profileRef)).resolves.toEqual(artifact);
    expect(new PgDialect().sqlToQuery(db.execute.mock.calls[1]![0]).sql).toMatch(/order by version desc limit 1/i);
    expect(Object.getOwnPropertyNames(DrizzleCategoryProfileRepository.prototype).sort())
      .toEqual(["append", "constructor", "latestArtifact"]);
    expect(() => new DrizzleCategoryProfileRepository({} as never, "raw", artifact.workspaceRef))
      .toThrow(CategoryProfileRepositoryError);
  });
});

describe("CategoryProfile migration boundary", () => {
  const migration = readFileSync("drizzle/20260809191740_category_profile_registry.sql", "utf8");

  it("creates a tenant-bound private append-only registry with strict payload checks", () => {
    expect(getTableName(categoryProfileRevisions)).toBe("category_profile_revisions");
    expect(getTableColumns(categoryProfileRevisions)).toMatchObject({ workspaceId: expect.anything(),
      categoryDefinitionId: expect.anything(), parentCategoryDefinitionId: expect.anything(),
      profileRef: expect.anything(), categoryRef: expect.anything(), parentCategoryRef: expect.anything(),
      version: expect.anything(), previousProfileHash: expect.anything(), color: expect.anything(),
      ownerRef: expect.anything(), status: expect.anything(), profilePayload: expect.anything() });
    expect(getTableConfig(categoryProfileRevisions).indexes.map((index) => index.config.name))
      .toEqual(expect.arrayContaining(["category_profile_revisions_workspace_profile_version_unique",
        "category_profile_revisions_workspace_definition_version_unique",
        "category_profile_revisions_workspace_hash_unique", "category_profile_revisions_latest_idx"]));
    expect(migration).toContain('CREATE TABLE "category_profile_revisions"');
    expect(migration).toContain("category_profile_revisions_definition_scope_fk");
    expect(migration).toContain("category_profile_revisions_parent_scope_fk");
    expect(migration).toContain("category_profile_revisions_workspace_profile_version_unique");
    expect(migration).toContain("ALTER TABLE category_profile_revisions ENABLE ROW LEVEL SECURITY");
    expect(migration).toContain("ALTER TABLE category_profile_revisions FORCE ROW LEVEL SECURITY");
    expect(migration).toContain("CREATE POLICY category_profile_revisions_tenant_select");
    expect(migration).toContain("membership.user_id = (select auth.uid())");
    expect(migration).toContain("REVOKE ALL PRIVILEGES ON TABLE category_profile_revisions FROM PUBLIC, anon, authenticated, service_role");
    expect(migration).toContain("REVOKE ALL PRIVILEGES ON FUNCTION category_profile_revisions_append_only() FROM PUBLIC, anon, authenticated, service_role");
    expect(migration).toContain("BEFORE UPDATE ON category_profile_revisions");
    expect(migration).toContain("SET search_path = ''");
    expect(migration).not.toMatch(/SECURITY\s+DEFINER|GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE|ALL).*category_profile/i);
  });

  it("allowlists every typed ref family and adds the selective context component", () => {
    for (const value of ["analysisPlaybookRefs", "ruleInstructionBundleRefs", "budgetPolicyRefs",
      "transferPolicyRefs", "schedulePolicyRefs", "actionPolicyRefs", "creativePolicyRefs"]) {
      expect(migration).toContain(value);
    }
    expect(migration).toContain("'category_profile', 'guidance_pack'");
    expect(migration).toContain("canAuthorizeAction}' = 'false'::jsonb");
    expect(migration).toContain("canExecuteWrite}' = 'false'::jsonb");
    expect(migration).toContain("canWriteMeta}' = 'false'::jsonb");
    expect(migration).toContain("canGrantApproval}' = 'false'::jsonb");
    expect(migration).not.toMatch(/\b(?:insert|update|delete)\s+(?:into|from)?\s*category_definitions/i);
  });
});
