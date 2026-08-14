import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { createCreativeDiagnosticSettlementPolicy } from "@/analyses/creative-diagnostic-settlement-policy";
import { DrizzleCreativeDiagnosticSettlementPolicyRepository } from "@/connectors/analyses/creative-diagnostic-settlement-policy-drizzle-repository";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const policy = Object.freeze({ policyRef: "creative_settlement_1234567890abcdef12345678", revision: 1, previousHash: null, state: "draft" as const, settlementLagDays: 3 });
function harness(responses: readonly (readonly unknown[])[]) {
  let index = 0;
  const execute = vi.fn(async () => ({ rows: responses[index++] ?? [] }));
  const database = { execute, transaction: async (work: (tx: unknown) => Promise<unknown>) => work({ execute }) };
  return { execute, repository: new DrizzleCreativeDiagnosticSettlementPolicyRepository(database as never) };
}
function input(overrides: Record<string, unknown> = {}) { return { workspaceId, actorId, actorRef: "actor_owner", role: "owner" as const, occurredAt: "2026-08-11T18:00:00.000Z", command: { policy }, ...overrides }; }
function sqlOf(execute: ReturnType<typeof vi.fn>) { return (execute.mock.calls as unknown[][]).map(([query]) => new PgDialect().sqlToQuery(query as never).sql).join("\n"); }

describe("DrizzleCreativeDiagnosticSettlementPolicyRepository", () => {
  it("writes an owner-authorized immutable genesis, advances the guarded head, and audits it", async () => {
    const subject = harness([[{ id: workspaceId }], [{ role: "owner" }], [], [], [], [], [], []]);
    await expect(subject.repository.append(input())).resolves.toMatchObject({ replayed: false, policy: { revision: 1 }, capabilities: { canPublish: false, canWriteMeta: false, canAccessNetwork: false } });
    const rendered = sqlOf(subject.execute);
    expect(rendered).toContain("creative_diagnostic_settlement_policy_revisions");
    expect(rendered).toContain("update creative_diagnostic_settlement_policies set current_revision");
    expect(rendered).toContain("insert into audit_events");
    expect(rendered).not.toMatch(/meta_write|approval_grant|http|mcp/i);
  });

  it("replays only an exact latest immutable policy without an audit append", async () => {
    const existing = createCreativeDiagnosticSettlementPolicy(policy);
    const subject = harness([[{ id: workspaceId }], [{ role: "owner" }], [], [{ id: "33333333-3333-4333-8333-333333333333", current_revision: 1, current_policy_hash: existing.policyHash }], [{ revision: 1, policy_hash: existing.policyHash, previous_hash: null, state: "draft", settlement_lag_days: 3, payload: existing }]]);
    await expect(subject.repository.append(input())).resolves.toMatchObject({ replayed: true, policy: existing });
    expect(sqlOf(subject.execute)).not.toContain("insert into audit_events");
  });

  it("loads only the head's current published policy", async () => {
    const published = createCreativeDiagnosticSettlementPolicy({ ...policy, state: "published" });
    const subject = harness([[{ revision: 1, policy_hash: published.policyHash, previous_hash: null, state: "published", settlement_lag_days: 3, payload: published }]]);
    await expect(subject.repository.loadCurrentPublished({ workspaceId, policyRef: policy.policyRef })).resolves.toEqual(published);
    expect(sqlOf(subject.execute)).toContain("head.current_revision");
  });
});
