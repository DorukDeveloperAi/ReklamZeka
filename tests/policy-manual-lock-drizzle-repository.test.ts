import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { DrizzlePolicyManualLockRepository } from "@/connectors/policies/policy-manual-lock-drizzle-repository";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const policyId = "33333333-3333-4333-8333-333333333333";
const command = { policyRef: "policy_primary", expectedPolicyVersion: 1, expectedPolicyHash: "a".repeat(64),
  lockRef: "manual_lock_primary", expectedHeadHash: "GENESIS" as const, operation: "lock" as const,
  reasonCode: "owner_confirmed", ownerConfirmation: { confirmed: true as const, confirmationRef: "confirmation_primary" } };

function repository(responses: readonly unknown[][]) {
  let index = 0;
  const execute = vi.fn(async () => ({ rows: responses[index++] ?? [] }));
  const database = { execute, transaction: async (work: (transaction: unknown) => Promise<unknown>) => work({ execute }) };
  return { execute, repository: new DrizzlePolicyManualLockRepository(database as never) };
}

describe("DrizzlePolicyManualLockRepository", () => {
  it("atomically appends an owner-confirmed lock, authority invalidation, and immutable audit fact", async () => {
    const harness = repository([
      [{ id: workspaceId }], [{ role: "owner" }],
      [{ id: policyId, workspace_ref: "workspace_primary", policy_version: 1, canonical_hash: "a".repeat(64), status: "published" }],
      [], [], [{ component_version: "b".repeat(64) }], [], [], [], [], [],
    ]);
    await expect(harness.repository.append({ workspaceId, workspaceRef: "workspace_primary", actorId, actorRef: "actor_owner",
      role: "owner", occurredAt: "2026-08-10T10:00:00.000Z", command })).resolves.toMatchObject({ operation: "lock", sequence: 1,
      capabilities: { canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false } });
    const rendered = (harness.execute.mock.calls as unknown[][]).map(([query]) =>
      new PgDialect().sqlToQuery(query as never).sql).join("\n");
    expect(rendered).toContain("for update");
    expect(rendered).toContain("insert into policy_manual_lock_revisions");
    expect(rendered).toContain("from effective_campaign_context_components");
    expect(rendered).toContain("effective_campaign_context_invalidations");
    expect(rendered).toContain("insert into audit_events");
    expect(rendered).not.toMatch(/approval_grant|execute|meta_write/i);
    const invalidation = (harness.execute.mock.calls as unknown[][]).map(([query]) =>
      new PgDialect().sqlToQuery(query as never)).find((query) => query.sql.includes("effective_campaign_context_invalidations"));
    expect(invalidation?.params).toContain("b".repeat(64));
  });

  it("fails before mutation for a stale head, non-owner membership, or illegal unlock", async () => {
    for (const entry of [
      { expected: "forbidden", responses: [[{ id: workspaceId }], [{ role: "analyst" }]] },
      { expected: "conflict", responses: [[{ id: workspaceId }], [{ role: "owner" }], [{ id: policyId, workspace_ref: "workspace_primary", policy_version: 1,
        canonical_hash: "a".repeat(64), status: "published" }], [{ sequence: 1, revision_hash: "b".repeat(64), operation: "lock" }]] },
    ]) {
      const harness = repository(entry.responses);
      await expect(harness.repository.append({ workspaceId, workspaceRef: "workspace_primary", actorId, actorRef: "actor_owner",
        role: "owner", occurredAt: "2026-08-10T10:00:00.000Z", command })).rejects.toMatchObject({ code: entry.expected });
      const rendered = (harness.execute.mock.calls as unknown[][]).map(([query]) =>
        new PgDialect().sqlToQuery(query as never).sql).join("\n");
      expect(rendered).not.toContain("insert into policy_manual_lock_revisions");
    }
  });
});
