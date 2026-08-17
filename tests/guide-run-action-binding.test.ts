import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

import { WORKSPACE_TOMBSTONE_PURGE_TABLES } from "@/connectors/meta/workspace-tombstone-purge-drizzle-adapter";
import { DrizzleGuideRunActionBindingRepository, GuideRunActionBindingRepositoryError } from "@/connectors/guides/guide-run-action-binding-drizzle-repository";

const migration = readFileSync("drizzle/20260817210000_p06_action_bindings.sql", "utf8");
const id = "123e4567-e89b-42d3-a456-426614174000";
const hash = "a".repeat(64);

describe("P06 guide-run action binding", () => {
  it("is private, immutable, binds canonical queue identities and is deleted before P05 parents", () => {
    expect(migration).toContain("guide_run_artifacts_workspace_row_unique");
    expect(migration).toContain("REFERENCES action_proposal_units(workspace_id,id)");
    expect(migration).toContain("REFERENCES action_proposal_bundles(workspace_id,id)");
    expect(migration).toContain("h.state IS DISTINCT FROM 'completed'");
    expect(migration).toContain("gh.current_active_revision_id IS DISTINCT FROM r.guide_revision_id");
    expect(migration).toContain("a.payload_hash IS DISTINCT FROM public.guide_run_sha256(a.payload)");
    expect(migration).toContain("candidate ?& ARRAY['candidateRef','candidateHash','action','routing','stageable']");
    expect(migration).toContain("candidate->>'routing' NOT IN ('human_approval','limited_autonomy_review')");
    expect(migration).toContain("b.plan_ref IS DISTINCT FROM 'guide_candidate_'||candidate->>'candidateHash'");
    expect(migration).toContain("u.source_hash IS DISTINCT FROM b.plan_hash");
    expect(migration).toContain("ENABLE ROW LEVEL SECURITY"); expect(migration).toContain("FORCE ROW LEVEL SECURITY");
    expect(migration).toContain("REVOKE ALL PRIVILEGES ON TABLE guide_run_action_bindings FROM PUBLIC,anon,authenticated,service_role");
    expect(WORKSPACE_TOMBSTONE_PURGE_TABLES.indexOf("guide_run_action_bindings")).toBeLessThan(WORKSPACE_TOMBSTONE_PURGE_TABLES.indexOf("guide_runs"));
    expect(WORKSPACE_TOMBSTONE_PURGE_TABLES.indexOf("guide_run_action_bindings")).toBeLessThan(WORKSPACE_TOMBSTONE_PURGE_TABLES.indexOf("action_proposal_units"));
    expect(WORKSPACE_TOMBSTONE_PURGE_TABLES.indexOf("action_proposal_unit_frozen_contexts")).toBeLessThan(WORKSPACE_TOMBSTONE_PURGE_TABLES.indexOf("action_proposal_units"));
    expect(WORKSPACE_TOMBSTONE_PURGE_TABLES.indexOf("slice_rule_budget_action_unit_bindings")).toBeLessThan(WORKSPACE_TOMBSTONE_PURGE_TABLES.indexOf("action_proposal_units"));
  });

  it("rejects malformed binding input before any repository query", async () => {
    const execute = vi.fn(); const repo = new DrizzleGuideRunActionBindingRepository({ execute, transaction: async (work: any) => await work({ execute }) } as never);
    await expect(repo.bind({ workspaceId: "bad", runRef: "guide_run_" + "a".repeat(24) })).rejects.toBeInstanceOf(GuideRunActionBindingRepositoryError);
    expect(execute).not.toHaveBeenCalled();
  });

  it("has no approval, execution or Meta dependency", () => {
    const source = readFileSync("src/connectors/guides/guide-run-action-binding-drizzle-repository.ts", "utf8");
    expect(source).not.toMatch(/executeMeta|graph\.facebook|fetch\(/i);
    expect(source).toContain("h.state='completed'");
    expect(source).toContain("current_active_revision_id=r.guide_revision_id");
    expect(source).toContain("GuideRunCandidateActionStagingPort");
    expect(source).not.toContain("join action_proposal_units u on u.source_hash");
  });
});
