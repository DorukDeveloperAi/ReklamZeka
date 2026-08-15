import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

import { DrizzleSkillCatalogRepository } from "@/connectors/orchestrator/skill-catalog-drizzle-repository";
import { catalogHash } from "@/application/skill-catalog-service";

const workspaceId = "00000000-0000-4000-8000-000000000001";
const actorId = "00000000-0000-4000-8000-000000000002";
const sourceId = "00000000-0000-4000-8000-000000000003";
const playbookRef = "playbook_alpha";
const hash = "a".repeat(64);

function database(results: readonly unknown[][]) {
  const dialect = new PgDialect(); const queue = [...results]; const queries: ReturnType<PgDialect["sqlToQuery"]>[] = [];
  const db = { execute: vi.fn(async (query: Parameters<PgDialect["sqlToQuery"]>[0]) => {
    queries.push(dialect.sqlToQuery(query)); return { rows: queue.shift() ?? [] };
  }) };
  return { queries, db: { ...db, transaction: vi.fn(async (callback: (transaction: typeof db) => unknown) => callback(db)) } };
}

function head(patch: Record<string, unknown> = {}) {
  return { revision: 3, playbook_hash: hash, source_id: sourceId, state: "active", payload: { title: "Eski", body: "Eski snippet" }, ...patch };
}

describe("Skill catalog append-only playbook repository", () => {
  it("creates revision +1 from the locked canonical head and never updates the old row", async () => {
    const fixture = database([[], [head()], [{ id: sourceId }], [{ revision: 4 }]]);
    const result = await new DrizzleSkillCatalogRepository(fixture.db as never).appendPlaybookRevision({ workspaceId, actorId,
      playbookRef, expectedRevision: 3, title: "Yeni", body: "Kullanıcı snippet'i", sourceOptionId: sourceId });
    expect(result).toMatchObject({ kind: "playbook", ref: playbookRef, revision: 4, title: "Yeni", body: "Kullanıcı snippet'i" });
    const sql = fixture.queries.map((query) => query.sql).join("\n");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("limit 1 for update");
    expect(sql).toContain("revision, previous_hash, playbook_hash");
    expect(sql).not.toMatch(/\bupdate\s+orchestrator_playbook_revisions|\bdelete\s+from\s+orchestrator_playbook_revisions/i);
    expect(sql).toContain("id::text = $2 and source_type = 'official_meta_guidance'");
    expect(JSON.stringify(result)).not.toContain(hash);
  });

  it.each([
    ["stale expected revision", [[], [head()],], { expectedRevision: 2 }, "stale_head"],
    ["source missing", [[], [head()], []], {}, "source_not_found"],
    ["source mismatch", [[], [head()], [{ id: "00000000-0000-4000-8000-000000000004" }]], {}, "source_mismatch"],
    ["duplicate immutable payload", [[], [head({ playbook_hash: catalogHash({ title: "Yeni", body: "Snippet" }) })], [{ id: sourceId }]], {}, "duplicate_revision"],
    ["duplicate insert conflict", [[], [head()], [{ id: sourceId }], []], {}, "write_conflict"],
  ])("fails closed for %s", async (_label, results, patch, code) => {
    const fixture = database(results as readonly unknown[][]);
    await expect(new DrizzleSkillCatalogRepository(fixture.db as never).appendPlaybookRevision({ workspaceId, actorId, playbookRef,
      expectedRevision: 3, title: "Yeni", body: "Snippet", sourceOptionId: sourceId, ...patch })).rejects.toThrow(code);
  });

  it("does not list an older active revision after a tombstone head", async () => {
    const fixture = database([[], []]);
    await new DrizzleSkillCatalogRepository(fixture.db as never).list(workspaceId);
    const query = fixture.queries[1]!;
    expect(query.sql).toContain("select distinct on (playbook_ref)");
    expect(query.sql).toContain("where current.state = 'active'");
    expect(query.sql).not.toContain("where workspace_id = $1::uuid and state = 'active'");
  });
});
