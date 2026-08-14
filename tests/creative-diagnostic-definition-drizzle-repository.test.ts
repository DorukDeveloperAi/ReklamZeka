import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import { createCreativeDiagnosticDefinition } from "@/analyses/creative-diagnostic-definition";
import {
  CreativeDiagnosticDefinitionRepositoryError,
  DrizzleCreativeDiagnosticDefinitionRepository,
} from "@/connectors/analyses/creative-diagnostic-definition-drizzle-repository";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const occurredAt = "2026-08-11T14:00:00.000Z";
const command = Object.freeze({ definition: Object.freeze({ definitionRef: "creative_definition_1234567890abcdef12345678",
  revision: 1, previousHash: null, state: "draft" as const, minimumImpressions: 100,
  minimumFrequencyIncreaseFraction: 0.2, minimumCtrDeclineFraction: 0.1, maximumCoverageGapDays: 1 }) });

function harness(responses: readonly (readonly unknown[])[]) {
  let index = 0;
  const execute = vi.fn(async () => ({ rows: responses[index++] ?? [] }));
  const database = { execute, transaction: async (work: (transaction: unknown) => Promise<unknown>) => work({ execute }) };
  return { execute, repository: new DrizzleCreativeDiagnosticDefinitionRepository(database as never) };
}
function input(overrides: Record<string, unknown> = {}) {
  return { workspaceId, actorId, actorRef: "actor_owner", role: "owner" as const, occurredAt, command, ...overrides };
}
function rendered(execute: ReturnType<typeof vi.fn>): string {
  return (execute.mock.calls as unknown[][]).map(([query]) => new PgDialect().sqlToQuery(query as never).sql).join("\n");
}

describe("DrizzleCreativeDiagnosticDefinitionRepository", () => {
  it("reads only the exact latest published revision and never falls back", async () => {
    const published = createCreativeDiagnosticDefinition({ ...command.definition, state: "published" });
    const loaded = harness([[{ revision: published.revision, definition_hash: published.definitionHash,
      previous_hash: published.previousHash, state: published.state, definition_payload: published }]]);
    await expect(loaded.repository.loadCurrentPublished({ workspaceId, definitionRef: published.definitionRef })).resolves.toEqual(published);
    const draft = createCreativeDiagnosticDefinition(command.definition);
    const rejected = harness([[{ revision: draft.revision, definition_hash: draft.definitionHash,
      previous_hash: draft.previousHash, state: draft.state, definition_payload: draft }]]);
    await expect(rejected.repository.loadCurrentPublished({ workspaceId, definitionRef: draft.definitionRef })).rejects.toMatchObject({ code: "not_found" });
    expect(rendered(rejected.execute)).toContain("order by revision desc limit 1");
  });

  it("appends an owner-authorized genesis definition and its immutable audit event", async () => {
    const subject = harness([[{ id: workspaceId }], [{ role: "owner" }], [], [], [], [], []]);
    await expect(subject.repository.append(input())).resolves.toMatchObject({ replayed: false,
      definition: { definitionRef: command.definition.definitionRef, revision: 1, state: "draft" },
      capabilities: { canPublish: false, canApprove: false, canExecute: false, canWriteMeta: false, canAccessNetwork: false } });
    const sql = rendered(subject.execute);
    expect(sql).toContain("lifecycle_state = 'active'");
    expect(sql).toContain("memberships");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("insert into creative_diagnostic_definition_revisions");
    expect(sql).toContain("insert into audit_events");
    expect(sql).not.toMatch(/meta_write|approval_grant|http|mcp/i);
  });

  it("replays the exact latest immutable command without a second append or audit", async () => {
    const definition = createCreativeDiagnosticDefinition(command.definition);
    const subject = harness([[{ id: workspaceId }], [{ role: "owner" }], [], [{
      revision: definition.revision, definition_hash: definition.definitionHash, previous_hash: definition.previousHash,
      state: definition.state, definition_payload: definition,
    }]]);
    await expect(subject.repository.append(input())).resolves.toMatchObject({ replayed: true, definition });
    const sql = rendered(subject.execute);
    expect(sql).not.toContain("insert into creative_diagnostic_definition_revisions");
    expect(sql).not.toContain("insert into audit_events");
  });

  it("rejects non-owner, stale revision and tampered latest payload before append", async () => {
    const definition = createCreativeDiagnosticDefinition(command.definition);
    const cases = [
      { expected: "forbidden", commandInput: command, responses: [[{ id: workspaceId }], [{ role: "analyst" }]] },
      { expected: "conflict", commandInput: command, responses: [[{ id: workspaceId }], [{ role: "owner" }], [], [{
        revision: definition.revision, definition_hash: definition.definitionHash, previous_hash: definition.previousHash,
        state: definition.state, definition_payload: definition,
      }]] },
      { expected: "corrupt_store", commandInput: command, responses: [[{ id: workspaceId }], [{ role: "owner" }], [], [{
        revision: definition.revision, definition_hash: "a".repeat(64), previous_hash: definition.previousHash,
        state: definition.state, definition_payload: definition,
      }]] },
    ] as const;
    for (const entry of cases) {
      const subject = harness(entry.responses);
      const commandInput = entry.expected === "conflict" ? { definition: { ...command.definition, minimumImpressions: 101 } } : entry.commandInput;
      await expect(subject.repository.append(input({ command: commandInput }))).rejects.toMatchObject({
        name: CreativeDiagnosticDefinitionRepositoryError.name, code: entry.expected,
      });
      expect(rendered(subject.execute)).not.toContain("insert into creative_diagnostic_definition_revisions");
    }
  });
});
