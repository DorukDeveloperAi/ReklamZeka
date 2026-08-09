import { createHash } from "node:crypto";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { DrizzleInstructionPolicyLifecycleRepository } from
  "@/connectors/policies/instruction-policy-lifecycle-drizzle-repository";
import { parseStrictInstructionPolicy, type StrictInstructionPolicy } from "@/domain/policies/instruction-policy-dsl";
import { EFFECTIVE_CONTEXT_INSTRUCTION_POLICY_COMPONENT_REF } from "@/analyses/effective-campaign-context";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const rawText = "Sağlık kategorisini önceliklendir.";
const rawHash = createHash("sha256").update(rawText).digest("hex");

function artifact(status: "draft" | "published" = "draft", version = 1,
  previousVersionHash: string | null = null): StrictInstructionPolicy {
  return parseStrictInstructionPolicy({ dslVersion: "strict-instruction-policy/1.0.0", workspaceRef: "workspace_test",
    policyRef: "policy_health", policyVersion: version, previousVersionHash, policyType: "preference",
    owner: { actorRef: "actor_owner", role: "owner" }, status, reasonCode: status === "draft" ? "owner_draft" : "owner_publish",
    priority: 500, effectiveDates: { from: "2026-08-09T00:00:00.000Z", until: null }, scope: { global: false,
      accountGroupRefs: [], accountRefs: ["account_main"], objectiveRefs: [],
      internalCategoryRefs: ["category_health"], entities: [], topicRefs: [] },
    source: { rawProvenanceRef: "provenance_health", rawTextHash: rawHash, promotedFromGuidanceRefs: [] },
    clause: { kind: "preference", subjectRef: "subject_budget", preferredRefs: ["category_health"],
      weightBasisPoints: 7000 } });
}

function row(policy: StrictInstructionPolicy) {
  return { id: "33333333-3333-4333-8333-333333333333",
    raw_provenance_id: "44444444-4444-4444-8444-444444444444", workspace_ref: policy.workspaceRef,
    policy_ref: policy.policyRef, policy_version: policy.policyVersion, previous_version_hash: policy.previousVersionHash,
    policy_type: policy.policyType, status: policy.status, raw_provenance_ref: policy.source.rawProvenanceRef,
    raw_text_hash: policy.source.rawTextHash, canonical_hash: policy.canonicalHash, policy_payload: policy,
    raw_text: rawText, captured_by_actor_ref: "actor_owner", captured_at: "2026-08-09T19:59:00.000Z",
    recorded_at: "2026-08-09T20:00:00.000Z" };
}

describe("DrizzleInstructionPolicyLifecycleRepository", () => {
  it("projects bounded same-workspace raw provenance beside normalized history and diffs", async () => {
    const draft = artifact(); const published = artifact("published", 2, draft.canonicalHash);
    const execute = vi.fn(async (_query: unknown) => ({ rows: [row(draft), { ...row(published),
      id: "55555555-5555-4555-8555-555555555555" }] }));
    const state = await new DrizzleInstructionPolicyLifecycleRepository({ execute } as never).inspect(workspaceId);
    expect(state.current[0]?.policy).toMatchObject({ status: "published", policyVersion: 2,
      authority: { canExecute: false, canWriteMeta: false, canApprove: false } });
    expect(state.history).toHaveLength(2); expect(state.diffs[0]).toMatchObject({ fromVersion: 1, toVersion: 2 });
    expect(state.diffs[0]?.changedPaths).toEqual(expect.arrayContaining(["status", "policyVersion", "previousVersionHash"]));
    expect(state.history[0]?.rawProvenance).toMatchObject({ rawText, rawTextHash: rawHash,
      provenanceRef: "provenance_health", capturedByActorRef: "actor_owner" });
    const rendered = new PgDialect().sqlToQuery(execute.mock.calls[0]![0] as never).sql;
    expect(rendered).toContain("instruction_policy_raw_provenance");
    expect(rendered).toContain("provenance.workspace_id = revision.workspace_id");
  });

  it("checks expected registry hash after locking the active workspace", async () => {
    const results = [{ rows: [{ id: workspaceId }] }, { rows: [{ role: "owner" }] }, { rows: [] }];
    const tx = { execute: vi.fn(async (_query: unknown) => results.shift()) };
    const database = { transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)) };
    await expect(new DrizzleInstructionPolicyLifecycleRepository(database as never).mutate({ workspaceId,
      workspaceRef: "workspace_test", actorId, actorRef: "actor_owner", role: "owner",
      occurredAt: "2026-08-09T20:00:00.000Z", command: { operation: "publish",
        expectedRegistryHash: "f".repeat(64), policyRef: "policy_health", expectedVersion: 1,
        expectedPolicyHash: "e".repeat(64), expectedImpactHash: "d".repeat(64),
        reasonCode: "owner_publish" } })).rejects.toMatchObject({ code: "conflict" });
    expect(tx.execute).toHaveBeenCalledTimes(3);
    const first = new PgDialect().sqlToQuery(tx.execute.mock.calls[0]![0] as never).sql;
    expect(first).toContain("for update"); expect(first).toContain("lifecycle_state = 'active'");
  });

  it("requires every draft revision to bind a new provenance reference", async () => {
    const draft = artifact();
    const { authority: _authority, canonicalHash: _hash, ...input } = draft;
    const revision = parseStrictInstructionPolicy({ ...input, policyVersion: 2,
      previousVersionHash: draft.canonicalHash, status: "draft", reasonCode: "owner_revise" });
    const results = [{ rows: [{ id: workspaceId }] }, { rows: [{ role: "owner" }] }, { rows: [row(draft)] }];
    const tx = { execute: vi.fn(async (_query: unknown) => results.shift()) };
    const database = { transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)) };
    const initial = await new DrizzleInstructionPolicyLifecycleRepository({
      execute: vi.fn(async (_query: unknown) => ({ rows: [row(draft)] })),
    } as never).inspect(workspaceId);
    await expect(new DrizzleInstructionPolicyLifecycleRepository(database as never).mutate({ workspaceId,
      workspaceRef: "workspace_test", actorId, actorRef: "actor_owner", role: "owner",
      occurredAt: "2026-08-09T20:00:00.000Z", command: { operation: "revise_draft",
        expectedRegistryHash: initial.registryHash, expectedVersion: 1, expectedPolicyHash: draft.canonicalHash,
        rawText, policy: revision } })).rejects.toMatchObject({ code: "invalid_transition" });
    expect(tx.execute).toHaveBeenCalledTimes(3);
  });

  it("binds publication revision, invalidation and audit to one transaction", async () => {
    const draft = artifact(); const { authority: _authority, canonicalHash: _hash, ...input } = draft;
    const published = parseStrictInstructionPolicy({ ...input, policyVersion: 2,
      previousVersionHash: draft.canonicalHash, status: "published", reasonCode: "owner_publish" });
    const results = [
      { rows: [{ id: workspaceId }] }, { rows: [{ role: "owner" }] }, { rows: [row(draft)] }, { rows: [] },
      { rows: [{ id: actorId }] }, { rows: [] }, { rows: [] }, { rows: [] }, { rows: [row(draft), { ...row(published),
        id: "55555555-5555-4555-8555-555555555555" }] },
    ];
    const tx = { execute: vi.fn(async (_query: unknown) => results.shift()) };
    const database = { transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)) };
    const initial = await new DrizzleInstructionPolicyLifecycleRepository({ execute: vi.fn(async (_query: unknown) => ({ rows: [row(draft)] })) } as never)
      .inspect(workspaceId);
    const impactHash = "d".repeat(64);
    const impact = { preview: vi.fn(async () => ({ impactHash, operation: "publish" as const,
      registryHash: initial.registryHash, target: { policyRef: draft.policyRef, policyVersion: 1,
        policyHash: draft.canonicalHash, status: "draft" as const }, exactBlockers: { currentInboundExceptions: 0,
        enabledSchedules: 0, nonTerminalActionUnits: 0 }, historicalImpact: { historicalInboundExceptions: 0,
        directAppliedContexts: 0, directSuppressedContexts: 0, directParkedContexts: 0, alreadyInvalidatedContexts: 0,
        budgetProposals: 0, currentAnalysisTemplates: 0, supersededAnalysisTemplates: 0, runAssets: 0,
        decisionLedgerRecords: 0, terminalActionUnits: 0 }, invalidationPlan: { registryComponents: 1,
        contextsNeedingInvalidation: 2 }, coverage: { complete: true, manifestVersion: "instruction-policy-dependency-manifest/1.0.0",
        exactRelational: [], exactContractRef: [], partialOrUnknown: [], nonAuthoritativeNotes: [], integrity: { unclassifiedJsonbColumns: 0,
          missingManifestJsonbColumns: 0, brokenPolicyRevisionChains: 0, unresolvedExceptionRefs: 0,
          malformedContextPolicies: 0, inconsistentContextComponents: 0, corruptActionLifecycleRows: 0,
          rowCapExceeded: 0 } }, disposition: "review_required" as const, mutationAllowed: true,
      authority: { canPublish: false as const, canPause: false as const, canArchive: false as const,
        canApprove: false as const, canExecute: false as const, canSchedule: false as const,
        canCallTool: false as const, canWriteMeta: false as const } })) };
    const result = await new DrizzleInstructionPolicyLifecycleRepository(database as never, () => impact).mutate({ workspaceId,
      workspaceRef: "workspace_test", actorId, actorRef: "actor_owner", role: "owner",
      occurredAt: "2026-08-09T20:00:00.000Z", command: { operation: "publish",
        expectedRegistryHash: initial.registryHash, policyRef: draft.policyRef, expectedVersion: 1,
        expectedPolicyHash: draft.canonicalHash, expectedImpactHash: impactHash, reasonCode: "owner_publish" } });
    expect(result).toMatchObject({ auditAppended: true, contextInvalidationAppended: true,
      state: { current: [{ policy: { status: "published" } }] } });
    expect(database.transaction).toHaveBeenCalledOnce();
    const rendered = tx.execute.mock.calls.map((call) => new PgDialect().sqlToQuery(call[0] as never).sql).join("\n");
    expect(rendered).toContain("insert into strict_instruction_policy_revisions");
    expect(rendered).toContain("insert into effective_campaign_context_invalidations");
    expect(rendered).toContain("insert into audit_events");
    const invalidationCall = tx.execute.mock.calls.find((call) =>
      new PgDialect().sqlToQuery(call[0] as never).sql.includes("insert into effective_campaign_context_invalidations"));
    const invalidation = new PgDialect().sqlToQuery(invalidationCall![0] as never);
    expect(invalidation.params).toContain(EFFECTIVE_CONTEXT_INSTRUCTION_POLICY_COMPONENT_REF);
    expect(invalidation.params).toContain(initial.registryHash);
    expect(rendered).not.toMatch(/update\s+effective_campaign_contexts/i);
    const auditCall = tx.execute.mock.calls.find((call) =>
      new PgDialect().sqlToQuery(call[0] as never).sql.includes("insert into audit_events"));
    const audit = new PgDialect().sqlToQuery(auditCall![0] as never);
    const metadata = audit.params.map((value) => { try { return typeof value === "string" ? JSON.parse(value) : null; }
      catch { return null; } }).find((value) => value?.expectedImpactHash === impactHash);
    expect(metadata).toMatchObject({ expectedImpactHash: impactHash, actualImpactHash: impactHash,
      invalidationPlanContexts: 2, invalidationEventsAppended: 1, invalidationReasonCode: "source_changed",
      reasonCode: "owner_publish" });
  });

  it("rechecks current membership after the workspace lock and before persistence", async () => {
    const tx = { execute: vi.fn(async () => ({ rows: tx.execute.mock.calls.length === 1
      ? [{ id: workspaceId }] : [{ role: "analyst" }] })) };
    const database = { transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)) };
    await expect(new DrizzleInstructionPolicyLifecycleRepository(database as never).mutate({ workspaceId,
      workspaceRef: "workspace_test", actorId, actorRef: "actor_owner", role: "owner",
      occurredAt: "2026-08-09T20:00:00.000Z", command: { operation: "publish",
        expectedRegistryHash: "a".repeat(64), policyRef: "policy_health", expectedVersion: 1,
        expectedPolicyHash: "b".repeat(64), expectedImpactHash: "c".repeat(64),
        reasonCode: "owner_publish" } })).rejects.toMatchObject({ code: "forbidden" });
    expect(tx.execute).toHaveBeenCalledTimes(2);
  });

  it("fails lifecycle mutation closed before persistence when persisted coverage is partial", async () => {
    const draft = artifact(); const initial = await new DrizzleInstructionPolicyLifecycleRepository({
      execute: vi.fn(async () => ({ rows: [row(draft)] })),
    } as never).inspect(workspaceId);
    const results = [{ rows: [{ id: workspaceId }] }, { rows: [{ role: "owner" }] }, { rows: [row(draft)] }];
    const tx = { execute: vi.fn(async () => results.shift()) };
    const database = { transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)) };
    const impactHash = "d".repeat(64);
    const partialImpact = { preview: vi.fn(async () => ({ impactHash, operation: "publish", registryHash: initial.registryHash,
      target: { policyRef: draft.policyRef, policyVersion: 1, policyHash: draft.canonicalHash, status: "draft" },
      exactBlockers: { currentInboundExceptions: 0, enabledSchedules: 0, nonTerminalActionUnits: 0 },
      invalidationPlan: { contextsNeedingInvalidation: 0 }, coverage: { complete: false,
        partialOrUnknown: ["manual_policy_locks"], integrity: { unclassifiedJsonbColumns: 0,
          missingManifestJsonbColumns: 0, brokenPolicyRevisionChains: 0, unresolvedExceptionRefs: 0,
          malformedContextPolicies: 0, inconsistentContextComponents: 0, corruptActionLifecycleRows: 0,
          rowCapExceeded: 0 } }, disposition: "blocked", mutationAllowed: false })) };
    await expect(new DrizzleInstructionPolicyLifecycleRepository(database as never, () => partialImpact as never)
      .mutate({ workspaceId, workspaceRef: "workspace_test", actorId, actorRef: "actor_owner", role: "owner",
        occurredAt: "2026-08-09T20:00:00.000Z", command: { operation: "publish",
          expectedRegistryHash: initial.registryHash, policyRef: draft.policyRef, expectedVersion: 1,
          expectedPolicyHash: draft.canonicalHash, expectedImpactHash: impactHash,
          reasonCode: "owner_publish" } })).rejects.toMatchObject({ code: "dependency_blocked" });
    expect(tx.execute).toHaveBeenCalledTimes(3);
  });

  it("rejects a recomputed impact bound to the wrong operation, policy ref, or target status", async () => {
    const draft = artifact(); const initial = await new DrizzleInstructionPolicyLifecycleRepository({
      execute: vi.fn(async () => ({ rows: [row(draft)] })),
    } as never).inspect(workspaceId);
    const impactHash = "d".repeat(64);
    const base = { impactHash, operation: "publish", registryHash: initial.registryHash,
      target: { policyRef: draft.policyRef, policyVersion: 1, policyHash: draft.canonicalHash, status: "draft" },
      exactBlockers: { currentInboundExceptions: 0, enabledSchedules: 0, nonTerminalActionUnits: 0 },
      invalidationPlan: { contextsNeedingInvalidation: 0 }, coverage: { complete: true, partialOrUnknown: [],
        integrity: { unclassifiedJsonbColumns: 0, missingManifestJsonbColumns: 0, brokenPolicyRevisionChains: 0,
          unresolvedExceptionRefs: 0, malformedContextPolicies: 0, inconsistentContextComponents: 0,
          corruptActionLifecycleRows: 0, rowCapExceeded: 0 } }, disposition: "review_required", mutationAllowed: true };
    const wrongBindings = [
      { ...base, operation: "archive" },
      { ...base, target: { ...base.target, policyRef: "policy_other" } },
      { ...base, target: { ...base.target, status: "paused" } },
    ];
    for (const impact of wrongBindings) {
      const results = [{ rows: [{ id: workspaceId }] }, { rows: [{ role: "owner" }] }, { rows: [row(draft)] }];
      const tx = { execute: vi.fn(async () => results.shift()) };
      const database = { transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)) };
      await expect(new DrizzleInstructionPolicyLifecycleRepository(database as never,
        () => ({ preview: vi.fn(async () => impact) }) as never).mutate({ workspaceId,
        workspaceRef: "workspace_test", actorId, actorRef: "actor_owner", role: "owner",
        occurredAt: "2026-08-09T20:00:00.000Z", command: { operation: "publish",
          expectedRegistryHash: initial.registryHash, policyRef: draft.policyRef, expectedVersion: 1,
          expectedPolicyHash: draft.canonicalHash, expectedImpactHash: impactHash,
          reasonCode: "owner_publish" } })).rejects.toMatchObject({ code: "conflict" });
      expect(tx.execute).toHaveBeenCalledTimes(3);
    }
  });

  it("rolls revision, invalidation and audit back together when the audit append fails", async () => {
    const draft = artifact(); const initial = await new DrizzleInstructionPolicyLifecycleRepository({
      execute: vi.fn(async () => ({ rows: [row(draft)] })),
    } as never).inspect(workspaceId);
    const staged: string[] = []; const committed: string[] = [];
    const tx = { execute: vi.fn(async (query: unknown) => {
      const rendered = new PgDialect().sqlToQuery(query as never).sql;
      if (rendered.includes("from workspaces")) return { rows: [{ id: workspaceId }] };
      if (rendered.includes("from memberships")) return { rows: [{ role: "owner" }] };
      if (rendered.includes("from strict_instruction_policy_revisions")) return { rows: [row(draft)] };
      if (rendered.includes("insert into strict_instruction_policy_revisions")) { staged.push("revision"); return { rows: [] }; }
      if (rendered.includes("insert into effective_campaign_context_invalidations")) {
        staged.push("invalidation"); return { rows: [{ id: actorId }] };
      }
      if (rendered.includes("select pg_advisory_xact_lock")) return { rows: [] };
      if (rendered.includes("select event_hash from audit_events")) return { rows: [] };
      if (rendered.includes("insert into audit_events")) { staged.push("audit"); throw new Error("audit_append_failed"); }
      return { rows: [] };
    }) };
    const database = { transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => {
      try { const result = await callback(tx); committed.push(...staged); return result; }
      catch (reason) { throw reason; }
    }) };
    const impactHash = "d".repeat(64);
    const completeImpact = { preview: vi.fn(async () => ({ impactHash, operation: "publish", registryHash: initial.registryHash,
      target: { policyRef: draft.policyRef, policyVersion: 1, policyHash: draft.canonicalHash, status: "draft" },
      exactBlockers: { currentInboundExceptions: 0, enabledSchedules: 0, nonTerminalActionUnits: 0 },
      invalidationPlan: { contextsNeedingInvalidation: 2 }, coverage: { complete: true, partialOrUnknown: [],
        integrity: { unclassifiedJsonbColumns: 0, missingManifestJsonbColumns: 0, brokenPolicyRevisionChains: 0,
          unresolvedExceptionRefs: 0, malformedContextPolicies: 0, inconsistentContextComponents: 0,
          corruptActionLifecycleRows: 0, rowCapExceeded: 0 } }, disposition: "review_required", mutationAllowed: true })) };
    await expect(new DrizzleInstructionPolicyLifecycleRepository(database as never, () => completeImpact as never)
      .mutate({ workspaceId, workspaceRef: "workspace_test", actorId, actorRef: "actor_owner", role: "owner",
        occurredAt: "2026-08-09T20:00:00.000Z", command: { operation: "publish",
          expectedRegistryHash: initial.registryHash, policyRef: draft.policyRef, expectedVersion: 1,
          expectedPolicyHash: draft.canonicalHash, expectedImpactHash: impactHash,
          reasonCode: "owner_publish" } })).rejects.toThrow("audit_append_failed");
    expect(staged).toEqual(["revision", "invalidation", "audit"]); expect(committed).toEqual([]);
  });
});
