import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { WORKSPACE_TOMBSTONE_PURGE_TABLES } from "@/connectors/meta/workspace-tombstone-purge-drizzle-adapter";
import { CATEGORY_JSONB_MANIFEST } from "@/domain/categories/category-dependency-manifest";
import { INSTRUCTION_POLICY_JSONB_MANIFEST } from "@/domain/policies/instruction-policy-dependency-manifest";

const tag = "20260809225244_illegal_gambit";
const migration = readFileSync(`drizzle/${tag}.sql`, "utf8");

describe("progressive formalization persistence migration", () => {
  it("creates an exact append-only G0-G4 hash-chain table with no authority", () => {
    expect(migration).toContain('CREATE TABLE "progressive_formalization_revisions"');
    expect(migration).toContain("progressive_formalization_transition_exact");
    expect(migration).toContain("progressive_formalization_payload_exact");
    expect(migration).toContain("progressive_formalization_nested_exact");
    expect(migration).toContain("- 'schemaVersion' - 'formalizationRef'");
    expect(migration).toContain("#> '{payload,confirmation}' - 'confirmed' - 'confirmationRef' - 'confirmedAt'");
    expect(migration).toContain("#> '{payload,normalizedDraft,authority}' - 'canPublish' - 'canApprove'");
    expect(migration).toContain("#> '{payload,normalizedDraft,strictPolicy}' - 'dslVersion' - 'workspaceRef'");
    expect(migration).toContain("sequence\" <= 2 or \"progressive_formalization_revisions\".\"actor_role\" in ('owner', 'admin')");
    expect(migration).toContain("progressive_formalization_revision_guard");
    expect(migration).toContain("expected_previous <> NEW.previous_revision_hash");
    expect(migration).toContain("progressive_formalization_revision_immutable");
    for (const capability of ["canPublish", "canApprove", "canExecute", "canWriteMeta", "canGrant",
      "canSchedule", "canCallTool", "canAccessNetwork", "canQuerySql"]) {
      expect(migration).toContain(`{authority,${capability}}`);
      expect(migration).toContain(capability);
    }
  });

  it("forces RLS, revokes Supabase roles and allows deletion only during tombstoning", () => {
    expect(migration).toContain('ALTER TABLE "progressive_formalization_revisions" ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('ALTER TABLE "progressive_formalization_revisions" FORCE ROW LEVEL SECURITY');
    expect(migration).toContain('REVOKE ALL PRIVILEGES ON TABLE "progressive_formalization_revisions" FROM PUBLIC, anon, authenticated, service_role');
    expect(migration).toContain("lifecycle_state = 'tombstoning'");
    expect(migration).toContain("REVOKE ALL PRIVILEGES ON FUNCTION progressive_formalization_revision_guard()");
  });

  it("is journaled, catalogued and included in explicit workspace purge", () => {
    const journal = JSON.parse(readFileSync("drizzle/meta/_journal.json", "utf8")) as { entries: { tag: string }[] };
    expect(journal.entries.some((entry) => entry.tag === tag)).toBe(true);
    expect(existsSync("drizzle/meta/20260809225244_snapshot.json")).toBe(true);
    expect(CATEGORY_JSONB_MANIFEST).toContainEqual({ table: "progressive_formalization_revisions",
      column: "revision_payload", policy: "category_contract" });
    expect(INSTRUCTION_POLICY_JSONB_MANIFEST).toContainEqual({ table: "progressive_formalization_revisions",
      column: "revision_payload", policy: "policy_contract" });
    expect(WORKSPACE_TOMBSTONE_PURGE_TABLES).toContain("progressive_formalization_revisions");
  });
});
