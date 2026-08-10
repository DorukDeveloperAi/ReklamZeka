import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { DrizzlePolicySemanticBindingLifecycleRepository } from
  "@/connectors/policies/policy-semantic-binding-lifecycle-drizzle-repository";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const policyId = "33333333-3333-4333-8333-333333333333";
const command = { policyRef: "policy_primary", expectedPolicyVersion: 1, expectedPolicyHash: "a".repeat(64),
  semanticRef: "semantic_budget_guardrail", expectedHeadHash: "GENESIS" as const,
  fact: { kind: "budget_guardrail", threshold: 1200, sources: ["policy_primary"] } };

function repository(responses: readonly unknown[][]) {
  let index = 0;
  const execute = vi.fn(async () => ({ rows: responses[index++] ?? [] }));
  const database = { execute, transaction: async (work: (transaction: unknown) => Promise<unknown>) => work({ execute }) };
  return { execute, repository: new DrizzlePolicySemanticBindingLifecycleRepository(database as never) };
}
function input() { return { workspaceId, workspaceRef: "workspace_primary", actorId, actorRef: "actor_owner",
  role: "owner" as const, occurredAt: "2026-08-10T12:00:00.000Z", command }; }

describe("DrizzlePolicySemanticBindingLifecycleRepository", () => {
  it("writes an exact published-policy fact, invalidates frozen authority contexts, and audits it atomically", async () => {
    const harness = repository([
      [{ id: workspaceId }], [{ role: "owner" }],
      [{ id: policyId, workspace_ref: "workspace_primary", policy_version: 1, canonical_hash: "a".repeat(64), status: "published" }],
      [], [], [], [{ component_version: "b".repeat(64) }], [], [], [], [], [],
    ]);
    await expect(harness.repository.append(input())).resolves.toMatchObject({ semanticRef: command.semanticRef, revision: 1,
      replayed: false, capabilities: { canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false } });
    const rendered = (harness.execute.mock.calls as unknown[][]).map(([query]) => new PgDialect().sqlToQuery(query as never).sql).join("\n");
    expect(rendered).toContain("policy_version = $3");
    expect(rendered).toContain("for update");
    expect(rendered).toContain("pg_advisory_xact_lock");
    expect(rendered).toContain("insert into policy_semantic_binding_revisions");
    expect(rendered).toContain("effective_campaign_context_invalidations");
    expect(rendered).toContain("insert into audit_events");
    expect(rendered).not.toMatch(/approval_grant|meta_write|http|mcp/i);
  });

  it("rejects stale heads or non-owner/admin membership before any semantic append", async () => {
    for (const entry of [
      { expected: "forbidden", responses: [[{ id: workspaceId }], [{ role: "analyst" }]] },
      { expected: "conflict", responses: [[{ id: workspaceId }], [{ role: "owner" }],
        [{ id: policyId, workspace_ref: "workspace_primary", policy_version: 1, canonical_hash: "a".repeat(64), status: "published" }], [],
        [{ revision: 1, revision_hash: "b".repeat(64), payload: {} }]] },
    ]) {
      const harness = repository(entry.responses);
      await expect(harness.repository.append(input())).rejects.toMatchObject({ code: entry.expected });
      const rendered = (harness.execute.mock.calls as unknown[][]).map(([query]) => new PgDialect().sqlToQuery(query as never).sql).join("\n");
      expect(rendered).not.toContain("insert into policy_semantic_binding_revisions");
    }
  });

  it("is idempotent only for an unchanged latest immutable command", async () => {
    const core = { schemaVersion: "policy-semantic-binding/1.0.0", workspaceRef: "workspace_primary", policyRef: "policy_primary",
      policyVersion: 1, policyHash: "a".repeat(64), semanticRef: command.semanticRef, revision: 1, previousRevisionHash: null,
      fact: command.fact, actor: { ref: "actor_owner", role: "owner" }, recordedAt: "2026-08-10T12:00:00.000Z",
      authority: { canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false, canSchedule: false,
        canCallTool: false, canAccessNetwork: false, canQuerySql: false } };
    const harness = repository([[{ id: workspaceId }], [{ role: "owner" }],
      [{ id: policyId, workspace_ref: "workspace_primary", policy_version: 1, canonical_hash: "a".repeat(64), status: "published" }], [],
      [{ revision: 1, revision_hash: "c".repeat(64), payload: { ...core, revisionHash: "c".repeat(64) } }]]);
    await expect(harness.repository.append(input())).resolves.toMatchObject({ revision: 1, revisionHash: "c".repeat(64), replayed: true });
    const rendered = (harness.execute.mock.calls as unknown[][]).map(([query]) => new PgDialect().sqlToQuery(query as never).sql).join("\n");
    expect(rendered).not.toContain("insert into policy_semantic_binding_revisions");
    expect(rendered).not.toContain("insert into audit_events");
  });

  it("accepts a valid second revision, replays its exact latest command, and rejects a stale predecessor", async () => {
    const previousHash = "d".repeat(64);
    const second = { ...command, expectedHeadHash: previousHash };
    const previousPayload = { schemaVersion: "policy-semantic-binding/1.0.0", workspaceRef: "workspace_primary",
      policyRef: "policy_primary", policyVersion: 1, policyHash: "a".repeat(64), semanticRef: command.semanticRef,
      revision: 1, previousRevisionHash: null, fact: command.fact, actor: { ref: "actor_owner", role: "owner" },
      recordedAt: "2026-08-10T12:00:00.000Z", authority: { canPublish: false, canApprove: false, canExecute: false,
        canWriteMeta: false, canSchedule: false, canCallTool: false, canAccessNetwork: false, canQuerySql: false }, revisionHash: previousHash };
    const success = repository([[{ id: workspaceId }], [{ role: "owner" }],
      [{ id: policyId, workspace_ref: "workspace_primary", policy_version: 1, canonical_hash: "a".repeat(64), status: "published" }], [],
      [{ revision: 1, revision_hash: previousHash, payload: previousPayload }], [], [{ component_version: "b".repeat(64) }], [], [], [], [], []]);
    await expect(success.repository.append({ ...input(), command: second })).resolves.toMatchObject({ revision: 2, replayed: false });

    const secondPayload = { ...previousPayload, revision: 2, previousRevisionHash: previousHash };
    const replay = repository([[{ id: workspaceId }], [{ role: "owner" }],
      [{ id: policyId, workspace_ref: "workspace_primary", policy_version: 1, canonical_hash: "a".repeat(64), status: "published" }], [],
      [{ revision: 2, revision_hash: "e".repeat(64), payload: { ...secondPayload, revisionHash: "e".repeat(64) } }]]);
    await expect(replay.repository.append({ ...input(), command: second })).resolves.toMatchObject({ revision: 2, replayed: true });

    const stale = repository([[{ id: workspaceId }], [{ role: "owner" }],
      [{ id: policyId, workspace_ref: "workspace_primary", policy_version: 1, canonical_hash: "a".repeat(64), status: "published" }], [],
      [{ revision: 2, revision_hash: "e".repeat(64), payload: { ...secondPayload, revisionHash: "e".repeat(64) } }]]);
    await expect(stale.repository.append(input())).rejects.toMatchObject({ code: "conflict" });
  });
});
