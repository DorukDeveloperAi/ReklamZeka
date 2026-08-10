import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { DrizzleAuthorityTopicLifecycleRepository } from
  "@/connectors/policies/authority-topic-lifecycle-drizzle-repository";
import type { PrivateAuthorityTopicLifecycleCommand } from
  "@/connectors/policies/authority-topic-lifecycle-drizzle-repository";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const topicId = "33333333-3333-4333-8333-333333333333";
const categoryId = "44444444-4444-4444-8444-444444444444";
const categoryRef = "category_56a311c7e4f0b7d158dbd254";
const command = { operation: "create_active" as const, topicRef: "topic_budget_guardrail",
  expectedHeadHash: "GENESIS" as const, categoryRefs: [categoryRef] };

function repository(responses: readonly (readonly unknown[])[]) {
  let index = 0;
  const execute = vi.fn(async () => ({ rows: responses[index++] ?? [] }));
  const database = { execute, transaction: async (work: (transaction: unknown) => Promise<unknown>) => work({ execute }) };
  return { execute, repository: new DrizzleAuthorityTopicLifecycleRepository(database as never) };
}
function input(commandInput: PrivateAuthorityTopicLifecycleCommand = command) {
  return { workspaceId, workspaceRef: "workspace_primary", actorId, actorRef: "actor_owner", role: "owner" as const,
    occurredAt: "2026-08-10T12:00:00.000Z", command: commandInput };
}
function sqls(execute: ReturnType<typeof vi.fn>) {
  return (execute.mock.calls as unknown[][]).map(([query]) => new PgDialect().sqlToQuery(query as never).sql).join("\n");
}

describe("DrizzleAuthorityTopicLifecycleRepository", () => {
  it("creates tenant-local active topic evidence with active category bindings, invalidation and audit", async () => {
    const harness = repository([
      [{ id: workspaceId }], [{ role: "owner" }], [], [],
      [{ id: categoryId, dimension_key: "objective", definition_key: "budget" }], [{ id: categoryId }], [], [], [], [{ id: topicId }],
      [{ component_version: "a".repeat(64) }], [], [], [], [],
    ]);
    await expect(harness.repository.mutate(input())).resolves.toMatchObject({ topicRef: command.topicRef, revision: 1,
      status: "active", replayed: false, capabilities: { canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false } });
    const rendered = sqls(harness.execute);
    expect(rendered).toContain("lifecycle_state = 'active'");
    expect(rendered).toContain("memberships");
    expect(rendered).toContain("for update");
    expect(rendered).toContain("pg_advisory_xact_lock");
    expect(rendered).toContain("definition.archived_at is null");
    expect(rendered).toContain("dimension.archived_at is null");
    expect(rendered).toContain("insert into authority_topics");
    expect(rendered).toContain("insert into authority_topic_revisions");
    expect(rendered).toContain("insert into category_topic_bindings");
    expect(rendered).toContain("update authority_topics set current_revision");
    expect(rendered).toContain("effective_campaign_context_invalidations");
    expect(rendered).toContain("insert into audit_events");
    expect(rendered).not.toMatch(/approval_grant|meta_write|http|mcp/i);
  });

  it("only replays the exact immutable latest command and performs no second mutation", async () => {
    const headHash = "b".repeat(64);
    const payload = { schemaVersion: "authority-topic/1.0.0", workspaceRef: "workspace_primary", topicRef: command.topicRef,
      revision: 1, previousRevisionHash: null, status: "active", categoryRefs: [categoryRef],
      actor: { ref: "actor_owner", role: "owner" }, recordedAt: "2026-08-10T12:00:00.000Z",
      authority: { canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false, canSchedule: false,
        canCallTool: false, canAccessNetwork: false, canQuerySql: false }, revisionHash: headHash };
    const harness = repository([[{ id: workspaceId }], [{ role: "owner" }], [],
      [{ id: topicId, current_revision: 1, current_revision_hash: headHash }],
      [{ id: "55555555-5555-4555-8555-555555555555", status: "active", revision_hash: headHash, payload }]]);
    await expect(harness.repository.mutate(input())).resolves.toMatchObject({ revision: 1, revisionHash: headHash, replayed: true });
    const rendered = sqls(harness.execute);
    expect(rendered).not.toContain("insert into authority_topic_revisions");
    expect(rendered).not.toContain("category_topic_bindings");
    expect(rendered).not.toContain("effective_campaign_context_invalidations");
    expect(rendered).not.toContain("insert into audit_events");
  });

  it("rejects a non-owner, stale head, missing/archived category and malformed archive before append", async () => {
    const headHash = "c".repeat(64);
    const cases = [
      { expected: "forbidden", command, responses: [[{ id: workspaceId }], [{ role: "analyst" }]] },
      { expected: "conflict", command, responses: [[{ id: workspaceId }], [{ role: "owner" }], [],
        [{ id: topicId, current_revision: 1, current_revision_hash: headHash }],
        [{ id: "55555555-5555-4555-8555-555555555555", status: "active", revision_hash: headHash, payload: {} }]] },
      { expected: "not_found", command, responses: [[{ id: workspaceId }], [{ role: "owner" }], [], [], []] },
      { expected: "invalid_input", command: { operation: "archive" as const, topicRef: command.topicRef,
        expectedHeadHash: headHash, categoryRefs: [categoryRef] }, responses: [] },
    ] as const;
    for (const entry of cases) {
      const harness = repository(entry.responses);
      await expect(harness.repository.mutate(input(entry.command))).rejects.toMatchObject({ code: entry.expected });
      expect(sqls(harness.execute)).not.toContain("insert into authority_topic_revisions");
    }
  });

  it("revises active evidence and archives it only with no category bindings", async () => {
    const firstHash = "d".repeat(64);
    const revision = repository([[{ id: workspaceId }], [{ role: "owner" }], [],
      [{ id: topicId, current_revision: 1, current_revision_hash: firstHash }],
      [{ id: "55555555-5555-4555-8555-555555555555", status: "active", revision_hash: firstHash, payload: {} }],
      [{ id: categoryId, dimension_key: "objective", definition_key: "budget" }], [{ id: categoryId }], [], [], [{ id: topicId }], [], [], [], []]);
    await expect(revision.repository.mutate(input({ operation: "revise_active", topicRef: command.topicRef,
      expectedHeadHash: firstHash, categoryRefs: [categoryRef] }))).resolves.toMatchObject({ revision: 2, status: "active" });
    const archive = repository([[{ id: workspaceId }], [{ role: "owner" }], [],
      [{ id: topicId, current_revision: 1, current_revision_hash: firstHash }],
      [{ id: "55555555-5555-4555-8555-555555555555", status: "active", revision_hash: firstHash, payload: {} }],
      [], [{ id: topicId }], [], [], [], []]);
    await expect(archive.repository.mutate(input({ operation: "archive", topicRef: command.topicRef,
      expectedHeadHash: firstHash, categoryRefs: [] }))).resolves.toMatchObject({ revision: 2, status: "archived" });
    expect(sqls(archive.execute)).not.toContain("insert into category_topic_bindings");
  });
});
