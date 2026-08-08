import { readFileSync } from "node:fs";
import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import {
  categoryAssignmentOperation,
  categoryAssignmentSource,
  categoryAssignments,
  categoryCardinality,
  categoryDefinitions,
  categoryDimensions,
  categoryEntityLevel,
} from "@/db/schema";

function indexNames(table: Parameters<typeof getTableConfig>[0]): readonly string[] {
  return getTableConfig(table).indexes
    .map((entry) => entry.config.name)
    .filter((name): name is string => name !== undefined);
}

function foreignKeyNames(table: Parameters<typeof getTableConfig>[0]): readonly string[] {
  return getTableConfig(table).foreignKeys
    .map((entry) => entry.getName())
    .filter((name): name is string => name !== undefined);
}

describe("category registry persistence contract", () => {
  it("models dimension cardinality, hierarchy levels and assignment behavior", () => {
    expect(categoryCardinality.enumValues).toEqual(["single", "multi"]);
    expect(categoryEntityLevel.enumValues).toEqual(["campaign", "ad_set", "ad", "creative"]);
    expect(categoryAssignmentOperation.enumValues).toEqual(["add", "override", "deny"]);
    expect(categoryAssignmentSource.enumValues).toEqual(["manual", "agent", "deterministic"]);

    expect(getTableName(categoryDimensions)).toBe("category_dimensions");
    expect(getTableColumns(categoryDimensions)).toMatchObject({
      workspaceId: expect.anything(),
      key: expect.anything(),
      cardinality: expect.anything(),
      allowedEntityLevels: expect.anything(),
      version: expect.anything(),
      archivedAt: expect.anything(),
    });
    expect(getTableColumns(categoryDefinitions)).toMatchObject({
      workspaceId: expect.anything(),
      dimensionId: expect.anything(),
      key: expect.anything(),
      version: expect.anything(),
      archivedAt: expect.anything(),
    });
    expect(getTableColumns(categoryAssignments)).toMatchObject({
      workspaceId: expect.anything(),
      dimensionId: expect.anything(),
      definitionId: expect.anything(),
      entityLevel: expect.anything(),
      campaignId: expect.anything(),
      adSetId: expect.anything(),
      adId: expect.anything(),
      creativeId: expect.anything(),
      operation: expect.anything(),
      manualLock: expect.anything(),
      evidence: expect.anything(),
      confidence: expect.anything(),
      version: expect.anything(),
      supersedesAssignmentId: expect.anything(),
      archivedAt: expect.anything(),
    });
  });

  it("indexes active revisions and every polymorphic entity access path", () => {
    expect(indexNames(categoryDimensions)).toEqual(expect.arrayContaining([
      "category_dimensions_workspace_key_version_unique",
      "category_dimensions_workspace_active_key_unique",
    ]));
    expect(indexNames(categoryDefinitions)).toEqual(expect.arrayContaining([
      "category_definitions_workspace_dimension_key_version_unique",
      "category_definitions_workspace_dimension_active_key_unique",
    ]));
    expect(indexNames(categoryAssignments)).toEqual(expect.arrayContaining([
      "category_assignments_campaign_active_value_unique",
      "category_assignments_ad_set_active_value_unique",
      "category_assignments_ad_active_value_unique",
      "category_assignments_creative_active_value_unique",
      "category_assignments_workspace_dimension_idx",
      "category_assignments_definition_idx",
      "category_assignments_supersedes_idx",
    ]));
    expect(foreignKeyNames(categoryAssignments)).toEqual(expect.arrayContaining([
      "category_assignments_definition_scope_fk",
      "category_assignments_campaign_scope_fk",
      "category_assignments_ad_set_scope_fk",
      "category_assignments_ad_scope_fk",
      "category_assignments_creative_scope_fk",
      "category_assignments_supersedes_scope_fk",
    ]));
  });

  it("keeps all registry tables closed to Supabase Data API roles", () => {
    const migration = readFileSync(
      new URL("../drizzle/20260807131041_fine_wolverine.sql", import.meta.url),
      "utf8",
    );
    for (const table of ["category_dimensions", "category_definitions", "category_assignments"]) {
      expect(migration).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      expect(migration).toContain(
        `REVOKE ALL PRIVILEGES ON TABLE "${table}" FROM PUBLIC, anon, authenticated`,
      );
    }
  });
});
