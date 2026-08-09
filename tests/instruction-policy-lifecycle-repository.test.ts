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
    const results = [{ rows: [{ id: workspaceId }] }, { rows: [] }];
    const tx = { execute: vi.fn(async (_query: unknown) => results.shift()) };
    const database = { transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)) };
    await expect(new DrizzleInstructionPolicyLifecycleRepository(database as never).mutate({ workspaceId,
      workspaceRef: "workspace_test", actorId, actorRef: "actor_owner", role: "owner",
      occurredAt: "2026-08-09T20:00:00.000Z", command: { operation: "publish",
        expectedRegistryHash: "f".repeat(64), policyRef: "policy_health", expectedVersion: 1,
        expectedPolicyHash: "e".repeat(64), reasonCode: "owner_publish" } })).rejects.toMatchObject({ code: "conflict" });
    expect(tx.execute).toHaveBeenCalledTimes(2);
    const first = new PgDialect().sqlToQuery(tx.execute.mock.calls[0]![0] as never).sql;
    expect(first).toContain("for update"); expect(first).toContain("lifecycle_state = 'active'");
  });

  it("requires every draft revision to bind a new provenance reference", async () => {
    const draft = artifact();
    const { authority: _authority, canonicalHash: _hash, ...input } = draft;
    const revision = parseStrictInstructionPolicy({ ...input, policyVersion: 2,
      previousVersionHash: draft.canonicalHash, status: "draft", reasonCode: "owner_revise" });
    const results = [{ rows: [{ id: workspaceId }] }, { rows: [row(draft)] }];
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
    expect(tx.execute).toHaveBeenCalledTimes(2);
  });

  it("binds publication revision, invalidation and audit to one transaction", async () => {
    const draft = artifact(); const { authority: _authority, canonicalHash: _hash, ...input } = draft;
    const published = parseStrictInstructionPolicy({ ...input, policyVersion: 2,
      previousVersionHash: draft.canonicalHash, status: "published", reasonCode: "owner_publish" });
    const results = [
      { rows: [{ id: workspaceId }] }, { rows: [row(draft)] }, { rows: [] }, { rows: [{ id: actorId }] },
      { rows: [] }, { rows: [] }, { rows: [] }, { rows: [row(draft), { ...row(published),
        id: "55555555-5555-4555-8555-555555555555" }] },
    ];
    const tx = { execute: vi.fn(async (_query: unknown) => results.shift()) };
    const database = { transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)) };
    const initial = await new DrizzleInstructionPolicyLifecycleRepository({ execute: vi.fn(async (_query: unknown) => ({ rows: [row(draft)] })) } as never)
      .inspect(workspaceId);
    const result = await new DrizzleInstructionPolicyLifecycleRepository(database as never).mutate({ workspaceId,
      workspaceRef: "workspace_test", actorId, actorRef: "actor_owner", role: "owner",
      occurredAt: "2026-08-09T20:00:00.000Z", command: { operation: "publish",
        expectedRegistryHash: initial.registryHash, policyRef: draft.policyRef, expectedVersion: 1,
        expectedPolicyHash: draft.canonicalHash, reasonCode: "owner_publish" } });
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
  });
});
