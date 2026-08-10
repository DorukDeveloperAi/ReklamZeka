import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { DrizzleAccountGroupLifecycleRepository } from
  "@/connectors/policies/account-group-lifecycle-drizzle-repository";
import type { PrivateAccountGroupLifecycleCommand } from
  "@/connectors/policies/account-group-lifecycle-drizzle-repository";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const accountId = "33333333-3333-4333-8333-333333333333";
const command = { operation: "create_active" as const, groupRef: "account_group_primary",
  expectedHeadHash: "GENESIS" as const, accountRefs: ["account_safe"] };

function repository(responses: readonly (readonly unknown[])[]) {
  let index = 0;
  const execute = vi.fn(async () => ({ rows: responses[index++] ?? [] }));
  const database = { execute, transaction: async (work: (transaction: unknown) => Promise<unknown>) => work({ execute }) };
  return { execute, repository: new DrizzleAccountGroupLifecycleRepository(database as never) };
}
function input(commandInput: PrivateAccountGroupLifecycleCommand = command) {
  return { workspaceId, workspaceRef: "workspace_primary", actorId, actorRef: "actor_owner", role: "owner" as const,
    occurredAt: "2026-08-10T12:00:00.000Z", command: commandInput };
}
function sqls(execute: ReturnType<typeof vi.fn>) {
  return (execute.mock.calls as unknown[][]).map(([query]) => new PgDialect().sqlToQuery(query as never).sql).join("\n");
}

describe("DrizzleAccountGroupLifecycleRepository", () => {
  it("creates a tenant-local active group with exact non-disappeared opaque account bindings, invalidation and audit", async () => {
    const harness = repository([
      [{ id: workspaceId }], [{ role: "owner" }], [], [],
      [{ id: accountId, external_account_id: "account_safe" }], [], [], [], [{ id: "created" }],
      [{ component_version: "d".repeat(64) }], [], [], [], [],
    ]);
    await expect(harness.repository.mutate(input())).resolves.toMatchObject({ groupRef: command.groupRef, revision: 1,
      status: "active", replayed: false, capabilities: { canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false } });
    const rendered = sqls(harness.execute);
    expect(rendered).toContain("lifecycle_state = 'active'");
    expect(rendered).toContain("for update");
    expect(rendered).toContain("pg_advisory_xact_lock");
    expect(rendered).toContain("disappeared_at is null");
    expect(rendered).toContain("insert into account_groups");
    expect(rendered).toContain("insert into account_group_revisions");
    expect(rendered).toContain("insert into account_group_account_bindings");
    expect(rendered).toContain("update account_groups set current_revision");
    expect(rendered).toContain("effective_campaign_context_components");
    expect(rendered).toContain("effective_campaign_context_invalidations");
    expect(rendered).toContain("insert into audit_events");
    expect(rendered).not.toMatch(/approval_grant|meta_write|http|mcp/i);
  });

  it("returns an exact immutable retry without another append, invalidation, or audit", async () => {
    const headHash = "a".repeat(64);
    const payload = { schemaVersion: "account-group/1.0.0", workspaceRef: "workspace_primary", groupRef: command.groupRef,
      revision: 1, previousRevisionHash: null, status: "active", accountRefs: ["account_safe"],
      actor: { ref: "actor_owner", role: "owner" }, recordedAt: "2026-08-10T12:00:00.000Z",
      authority: { canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false, canSchedule: false,
        canCallTool: false, canAccessNetwork: false, canQuerySql: false }, revisionHash: headHash };
    const harness = repository([[{ id: workspaceId }], [{ role: "owner" }], [],
      [{ id: "44444444-4444-4444-8444-444444444444", current_revision: 1, current_revision_hash: headHash }],
      [{ id: "55555555-5555-4555-8555-555555555555", status: "active", revision_hash: headHash, payload }]]);
    await expect(harness.repository.mutate(input())).resolves.toMatchObject({ revision: 1, revisionHash: headHash, replayed: true });
    const rendered = sqls(harness.execute);
    expect(rendered).not.toContain("insert into account_group_revisions");
    expect(rendered).not.toContain("effective_campaign_context_invalidations");
    expect(rendered).not.toContain("insert into audit_events");
  });

  it("rejects an owner mismatch, stale predecessor, disappeared account, and archive memberships before an append", async () => {
    const headHash = "b".repeat(64);
    const cases = [
      { expected: "forbidden", command: command, responses: [[{ id: workspaceId }], [{ role: "analyst" }]] },
      { expected: "conflict", command, responses: [[{ id: workspaceId }], [{ role: "owner" }], [],
        [{ id: "44444444-4444-4444-8444-444444444444", current_revision: 1, current_revision_hash: headHash }],
        [{ id: "55555555-5555-4555-8555-555555555555", status: "active", revision_hash: headHash, payload: {} }]] },
      { expected: "not_found", command, responses: [[{ id: workspaceId }], [{ role: "owner" }], [], [], []] },
      { expected: "invalid_input", command: { operation: "archive" as const, groupRef: command.groupRef,
        expectedHeadHash: headHash, accountRefs: ["account_safe"] }, responses: [] },
    ] as const;
    for (const entry of cases) {
      const harness = repository(entry.responses);
      await expect(harness.repository.mutate(input(entry.command))).rejects.toMatchObject({ code: entry.expected });
      expect(sqls(harness.execute)).not.toContain("insert into account_group_revisions");
    }
  });

  it("revises an active head and archives only with an empty immutable membership set", async () => {
    const firstHash = "c".repeat(64);
    const groupId = "44444444-4444-4444-8444-444444444444";
    const revision = repository([[{ id: workspaceId }], [{ role: "owner" }], [],
      [{ id: groupId, current_revision: 1, current_revision_hash: firstHash }],
      [{ id: "55555555-5555-4555-8555-555555555555", status: "active", revision_hash: firstHash, payload: {} }],
      [{ id: accountId, external_account_id: "account_safe" }], [], [], [{ id: groupId }], [], [], [], []]);
    await expect(revision.repository.mutate(input({ operation: "revise_active", groupRef: command.groupRef,
      expectedHeadHash: firstHash, accountRefs: ["account_safe"] }))).resolves.toMatchObject({ revision: 2, status: "active" });

    const archive = repository([[{ id: workspaceId }], [{ role: "owner" }], [],
      [{ id: groupId, current_revision: 1, current_revision_hash: firstHash }],
      [{ id: "55555555-5555-4555-8555-555555555555", status: "active", revision_hash: firstHash, payload: {} }],
      [], [{ id: groupId }], [], [], [], []]);
    await expect(archive.repository.mutate(input({ operation: "archive", groupRef: command.groupRef,
      expectedHeadHash: firstHash, accountRefs: [] }))).resolves.toMatchObject({ revision: 2, status: "archived" });
    expect(sqls(archive.execute)).not.toContain("insert into account_group_account_bindings");
  });
});
