import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

import { DrizzlePromotionTemplateLifecycleRepository } from
  "@/connectors/meta/promotion/promotion-template-lifecycle-drizzle-repository";

const workspaceId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";

function command() {
  return { operation: "create_preset_draft" as const, expectedRegistryHash: "f".repeat(64),
    selection: { scopeRef: null, postType: null, instruction: null }, alias: "Yeni preset" };
}

describe("PromotionTemplate lifecycle Drizzle repository", () => {
  it("locks the active workspace and rechecks exact same-transaction membership before reading lifecycle state", async () => {
    const statements: string[] = [];
    const results = [{ rows: [{ id: workspaceId }] }, { rows: [] }];
    const tx = { execute: vi.fn(async (query: never) => {
      statements.push(new PgDialect().sqlToQuery(query).sql); return results.shift();
    }) };
    const database = { transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)) };
    await expect(new DrizzlePromotionTemplateLifecycleRepository(database as never).mutate({ workspaceId,
      workspaceRef: "workspace_test", actorId, actorRef: "actor_owner", role: "owner",
      occurredAt: "2026-08-10T00:00:00.000Z", command: command(), sourceCandidate: null }))
      .rejects.toMatchObject({ code: "invalid_transition" });
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain("lifecycle_state = 'active'");
    expect(statements[0]).toContain("for update");
    expect(statements[1]).toContain("from memberships");
    expect(statements[1]).toContain("for update");
  });

  it("rejects stale registry OCC after the lock/recheck and before lifecycle, audit or immutable registry inserts", async () => {
    const statements: string[] = [];
    const tx = { execute: vi.fn(async (query: never) => {
      const sql = new PgDialect().sqlToQuery(query).sql; statements.push(sql);
      if (sql.includes("from workspaces")) return { rows: [{ id: workspaceId }] };
      if (sql.includes("from memberships")) return { rows: [{ role: "owner" }] };
      return { rows: [] };
    }) };
    const database = { transaction: vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx)) };
    await expect(new DrizzlePromotionTemplateLifecycleRepository(database as never).mutate({ workspaceId,
      workspaceRef: "workspace_test", actorId, actorRef: "actor_owner", role: "owner",
      occurredAt: "2026-08-10T00:00:00.000Z", command: command(), sourceCandidate: null }))
      .rejects.toMatchObject({ code: "conflict" });
    expect(statements.filter((item) => item.includes("authoring_revisions where workspace_id"))).toHaveLength(2);
    expect(statements.some((item) => item.includes("insert into audience_preset_authoring_revisions"))).toBe(false);
    expect(statements.some((item) => item.includes("insert into audit_events"))).toBe(false);
    expect(statements.some((item) => item.includes("insert into audience_preset_revisions"))).toBe(false);
  });
});
