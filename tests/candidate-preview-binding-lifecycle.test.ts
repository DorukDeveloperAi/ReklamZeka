import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { DrizzleCandidatePreviewBindingRepository, CandidatePreviewBindingRepositoryError } from
  "@/connectors/guidance/candidate-preview-binding-drizzle-repository";

const input = {
  workspaceId: "11111111-1111-4111-8111-111111111111", workspaceRef: "workspace_primary",
  actorId: "22222222-2222-4222-8222-222222222222", actorRef: "actor_owner", role: "owner" as const,
  occurredAt: "2026-08-11T12:00:00.000Z", command: {
    formalizationRef: "formalization_primary", expectedHeadHash: "GENESIS" as const, expectedG2HeadHash: "a".repeat(64),
    guidanceSetRef: "guidance_set_primary", guidanceSetVersion: 1, guidanceSetHash: "b".repeat(64),
    policyRef: "policy_primary", policyVersion: 1, policyHash: "c".repeat(64), targetAccountRef: "account_primary",
    authoritySnapshotRef: "authority_snapshot_primary", authoritySnapshotHash: "d".repeat(64), authorityTier: "platform_legal_tenant_safety" as const,
    decision: { decisionKey: "decision_primary", positionKey: "position_primary" },
  },
};

describe("candidate preview binding lifecycle", () => {
  it("rejects an unstructured decision before any database interaction", async () => {
    const execute = vi.fn(); const repository = new DrizzleCandidatePreviewBindingRepository({ execute, transaction: vi.fn() } as never);
    await expect(repository.bind({ ...input, command: { ...input.command, decision: { decisionKey: "", positionKey: "position_primary" } } }))
      .rejects.toBeInstanceOf(CandidatePreviewBindingRepositoryError);
    expect(execute).not.toHaveBeenCalled();
  });

  it("ships tenant FKs, forced RLS, revoke, OCC, and tombstone-only append guards", () => {
    const migration = readFileSync("drizzle/20260811140427_volatile_spirit.sql", "utf8");
    for (const table of ["candidate_preview_binding_revisions", "candidate_preview_binding_heads", "candidate_preview_binding_invalidations"]) {
      expect(migration).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
      expect(migration).toContain(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`);
    }
    expect(migration).toContain("candidate_preview_binding_revisions_guidance_scope_fk");
    expect(migration).toContain("candidate_preview_binding_heads_revision_scope_fk");
    expect(migration).toContain("candidate_preview_binding_head_occ_conflict");
    expect(migration).toContain("candidate_preview_binding_append_only");
    expect(migration).toContain("candidate_preview_binding_revisions_decision_exact");
    expect(migration).toContain("candidate_preview_binding_revisions_authority_closed");
    expect(migration).toContain("'decisionKey' - 'positionKey'");
    for (const capability of ["canPublish", "canApprove", "canExecute", "canWriteMeta", "canSchedule", "canCallTool", "canAccessNetwork", "canQuerySql"]) expect(migration).toContain(`{authority,${capability}}`);
    expect(migration).toContain("productionAuthoritySourceBound}') is distinct from 'true'::jsonb");
    expect(migration).toContain("FROM PUBLIC, anon, authenticated, service_role");
  });

  it("uses the trusted loader and revalidates all mutable source heads before read-time use", () => {
    const writer = readFileSync("src/connectors/guidance/candidate-preview-binding-drizzle-repository.ts", "utf8");
    const bridge = readFileSync("src/connectors/guidance/authoritative-g3-evidence-bridge-drizzle-resolver.ts", "utf8");
    expect(writer).toContain("this.authority.loadInTransaction(tx");
    for (const field of ["guidance.version === c.guidanceSetVersion", "policy.version === c.policyVersion",
      "snapshot?.ref === c.authoritySnapshotRef", "decision?.decisionKey === c.decision.decisionKey"]) expect(writer).toContain(field);
    for (const source of ["progressive_formalization_revisions g2", "guidance_sets guidance",
      "strict_instruction_policy_revisions policy", "tenant_authority_snapshot_heads snapshot_head"]) expect(bridge).toContain(source);
    expect(bridge).toContain("evaluatedAt: new Date().toISOString()");
    expect(bridge).toContain("new DrizzleTrustedPolicyAuthorityRepository(database)");
  });

  it("moves the applied candidate constraint forward to the canonical authority-tier vocabulary", () => {
    const migration = readFileSync("drizzle/20260811143706_candidate_preview_binding_authority_tier_contract.sql", "utf8");
    expect(migration).toContain('DROP CONSTRAINT "candidate_preview_binding_revisions_identity"');
    expect(migration).toContain("platform_legal_tenant_safety");
    expect(migration).toContain("metric_rule");
    expect(migration).toContain('DROP CONSTRAINT "candidate_preview_binding_revisions_decision_exact"');
    expect(migration).toContain("IS TRUE");
  });
});
