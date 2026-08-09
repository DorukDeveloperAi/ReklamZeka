import { createHash } from "node:crypto";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { DrizzleInstructionPolicyImpactRepository } from
  "@/connectors/policies/instruction-policy-impact-drizzle-repository";
import { INSTRUCTION_POLICY_JSONB_MANIFEST } from "@/domain/policies/instruction-policy-dependency-manifest";
import { parseStrictInstructionPolicy } from "@/domain/policies/instruction-policy-dsl";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const rawHash = createHash("sha256").update("Talimat").digest("hex");
function policy(input: Readonly<{ policyRef: string; kind?: "preference" | "exception"; refs?: readonly string[] }>) {
  return parseStrictInstructionPolicy({ dslVersion: "strict-instruction-policy/1.0.0", workspaceRef: "workspace_test",
    policyRef: input.policyRef, policyVersion: 1, previousVersionHash: null, policyType: input.kind === "exception"
      ? "exception" : "preference", owner: { actorRef: "actor_owner", role: "owner" }, status: "published",
    reasonCode: "owner_publish", priority: 100, effectiveDates: { from: "2026-08-10T00:00:00.000Z", until: null },
    scope: { global: true, accountGroupRefs: [], accountRefs: [], objectiveRefs: [], internalCategoryRefs: [],
      entities: [], topicRefs: [] }, source: { rawProvenanceRef: `provenance_${input.policyRef}`,
      rawTextHash: rawHash, promotedFromGuidanceRefs: [] }, clause: input.kind === "exception"
      ? { kind: "exception", policyRefs: input.refs ?? [], effect: "suppress", justificationReasonCode: "owner_exception" }
      : { kind: "preference", subjectRef: "subject_budget", preferredRefs: ["category_health"], weightBasisPoints: 7000 } });
}
function row(artifact: ReturnType<typeof policy>) { return { policy_ref: artifact.policyRef,
  policy_version: artifact.policyVersion, previous_version_hash: artifact.previousVersionHash, status: artifact.status,
  canonical_hash: artifact.canonicalHash, policy_payload: artifact, recorded_at: "2026-08-10T00:00:00.000Z" }; }
const emptyCounts = { registry_components: 2, contexts_needing_invalidation: 2, already_invalidated_contexts: 1,
  direct_applied_contexts: 3, direct_suppressed_contexts: 1, direct_parked_contexts: 0, budget_proposals: 2,
  current_analysis_templates: 1, superseded_analysis_templates: 1, enabled_schedules: 1, run_assets: 2,
  decision_ledger_records: 2, nonterminal_action_units: 1, terminal_action_units: 2,
  malformed_context_policies: 0, unresolved_context_policy_refs: 0, inconsistent_context_components: 0,
  corrupt_action_lifecycle_rows: 0, affected_contexts: 4 };
function database(overrides: Partial<typeof emptyCounts> = {}) {
  const target = policy({ policyRef: "policy_health" });
  const inbound = policy({ policyRef: "policy_exception", kind: "exception", refs: ["policy_health"] });
  const results = [{ rows: [{ id: workspaceId }] },
    { rows: INSTRUCTION_POLICY_JSONB_MANIFEST.map(({ table, column }) => ({ table, column })) },
    { rows: [row(target), row(inbound)] }, { rows: [{ ...emptyCounts, ...overrides }] }];
  return { target, execute: vi.fn(async () => results.shift()) };
}

describe("DrizzleInstructionPolicyImpactRepository", () => {
  it("classifies exact blockers, history and invalidation while keeping prospective coverage closed", async () => {
    const db = database(); const result = await new DrizzleInstructionPolicyImpactRepository(db as never)
      .preview(workspaceId, "policy_health", "publish");
    expect(result).toMatchObject({ operation: "publish", exactBlockers: { currentInboundExceptions: 1,
      enabledSchedules: 1, nonTerminalActionUnits: 1 }, historicalImpact: { directAppliedContexts: 3,
      budgetProposals: 2, currentAnalysisTemplates: 1, runAssets: 2, decisionLedgerRecords: 2,
      terminalActionUnits: 2 }, invalidationPlan: { registryComponents: 2, contextsNeedingInvalidation: 2 },
      coverage: { complete: false, partialOrUnknown: ["trusted_authority_catalog", "manual_policy_locks",
        "account_group_scope", "topic_scope", "opaque_action_policy_context"],
        nonAuthoritativeNotes: ["action_context_hash_index_explain_not_verified"], integrity: {
        unclassifiedJsonbColumns: 0, missingManifestJsonbColumns: 0 } }, disposition: "blocked",
      mutationAllowed: false, authority: { canPublish: false, canExecute: false, canWriteMeta: false } });
    expect(result?.impactHash).toMatch(/^[a-f0-9]{64}$/);
    const rendered = new PgDialect().sqlToQuery((db.execute.mock.calls as unknown[][])[3]![0] as never).sql;
    for (const family of ["budget_proposal_versions", "analysis_template_definitions", "decision_room_schedules",
      "decision_room_run_analysis_assets", "decision_ledger_records", "action_proposal_units"]) {
      expect(rendered).toContain(family);
    }
  });

  it("hashes deterministically and includes integrity/counter changes", async () => {
    const first = await new DrizzleInstructionPolicyImpactRepository(database() as never)
      .preview(workspaceId, "policy_health", "archive");
    const replay = await new DrizzleInstructionPolicyImpactRepository(database() as never)
      .preview(workspaceId, "policy_health", "archive");
    const changed = await new DrizzleInstructionPolicyImpactRepository(database({ budget_proposals: 3 }) as never)
      .preview(workspaceId, "policy_health", "archive");
    expect(first?.impactHash).toBe(replay?.impactHash); expect(changed?.impactHash).not.toBe(first?.impactHash);
  });

  it("marks oversized persisted dependency families as an integrity blocker", async () => {
    const result = await new DrizzleInstructionPolicyImpactRepository(database({ nonterminal_action_units: 20_001 }) as never)
      .preview(workspaceId, "policy_health", "archive");
    expect(result).toMatchObject({ coverage: { complete: false, integrity: { rowCapExceeded: 1 } },
      disposition: "blocked", mutationAllowed: false });
  });

  it("denies inactive/cross-tenant workspace before reading policy dependencies", async () => {
    const db = { execute: vi.fn(async () => ({ rows: [] })) };
    await expect(new DrizzleInstructionPolicyImpactRepository(db as never)
      .preview(workspaceId, "policy_health", "pause")).rejects.toMatchObject({ code: "workspace_scope_mismatch" });
    expect(db.execute).toHaveBeenCalledOnce();
  });
});
