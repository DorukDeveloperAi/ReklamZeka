import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("current effective analysis context PostgreSQL verifier", () => {
  it("uses the actual closed-world reader and materializes only repository-owned evidence", () => {
    const source = readFileSync("scripts/verify-current-effective-analysis-context-source-postgres.ts", "utf8");
    expect(source).toContain("new DrizzleCurrentEffectiveAnalysisContextSourceReader(database as never)");
    expect(source).toContain("createDrizzleEffectiveAnalysisContextComposer({ database: database as never })");
    expect(source).toContain("new DrizzlePolicyAuthorityCatalogMaterializerRepository(database as never).materialize");
    expect(source).toContain("new DrizzleCategoryAuthoringRepository(database as never)");
    expect(source).toContain("new DrizzleGuidanceCampaignSelectionRepository(database as never).publish");
    expect(source).toContain("new WorkspaceTombstoneService(new DrizzleWorkspaceTombstoneStore(database as never, purge)");
    expect(source).toContain("for (const fixtureWorkspaceId of [workspaceId, foreignWorkspaceId])");
    expect(source).toContain("foreignPurgeCandidateCount");
    expect(source).toContain("foreignActiveSurvivorCount");
    expect(source).toContain('process.env.VERIFIER_PHASE_OUTPUT === "1"');
    expect(source).toContain('"tombstone_foreign"');
    expect(source).toContain("workspace_tombstone_purge_schema_not_migrated");
    expect(source).toContain("closed_world_current_source_ready_compose_save_reload");
    expect(source).not.toContain("prototype.loadCurrent");
    expect(source).not.toContain("insert into tenant_authority_snapshots");
    expect(source).not.toContain("insert into policy_authority_catalog");
  });
});
