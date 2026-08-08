import { readFileSync } from "node:fs";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

import type { LocalAgentHandoffRecord, LocalAgentSessionRecord } from
  "@/application/local-agent-session-contract";
import { DrizzleLocalAgentSessionRepository } from
  "@/connectors/agents/local-agent-session-drizzle-repository";

const workspaceId = "11111111-1111-4111-a111-111111111111";
const userId = "22222222-2222-4222-a222-222222222222";
const sessionRef = "session_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const targetSessionRef = "session_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const handoffRef = "handoff_cccccccccccccccccccccccccccccccc";
const startedAt = 1_800_000_000;

const session: LocalAgentSessionRecord = Object.freeze({
  workspaceId, workspaceRef: "workspace_alpha", userId, sessionRef, clientRef: "client_local",
  transport: "loopback_http", toolCatalogVersion: "local-agent-tools/1.0.0",
  allowedTools: Object.freeze(["decision_room_list", "approval_queue_list",
    "existing_post_promotion_preflight"] as const),
  startedAt, lastSeenAt: startedAt, expiresAt: startedAt + 300,
});
const sessionRow = Object.freeze({ workspace_id: workspaceId, workspace_ref: session.workspaceRef,
  user_id: userId, session_ref: sessionRef, client_ref: session.clientRef, transport: session.transport,
  tool_catalog_version: session.toolCatalogVersion, allowed_tools: session.allowedTools,
  started_at: new Date(startedAt * 1000), last_seen_at: new Date(startedAt * 1000),
  expires_at: new Date((startedAt + 300) * 1000) });
const handoff: LocalAgentHandoffRecord = Object.freeze({ handoffRef, workspaceId,
  workspaceRef: "workspace_alpha", creatorSessionRef: sessionRef, targetSessionRef,
  context: Object.freeze({ intent: "analysis", entityRef: "campaign_public",
    timeframeRef: "timeframe_last_7d", contextRef: "context_frozen", contextVersion: 1,
    templateRef: null, correlationRef: "correlation_dddddddddddddddddddddddddddddddd" }),
  createdAt: startedAt, expiresAt: startedAt + 30, consumedAt: null });
const handoffRow = Object.freeze({ handoff_ref: handoffRef, workspace_id: workspaceId,
  workspace_ref: handoff.workspaceRef, creator_session_ref: sessionRef, target_session_ref: targetSessionRef,
  intent: handoff.context.intent, entity_ref: handoff.context.entityRef,
  timeframe_ref: handoff.context.timeframeRef, context_ref: handoff.context.contextRef,
  context_version: 1, template_ref: null, correlation_ref: handoff.context.correlationRef,
  created_at: new Date(startedAt * 1000), expires_at: new Date((startedAt + 30) * 1000), consumed_at: null });

function database(results: readonly unknown[]) {
  const rendered: string[] = [];
  const queue = [...results];
  const execute = vi.fn(async (query: Parameters<PgDialect["sqlToQuery"]>[0]) => {
    rendered.push(new PgDialect().sqlToQuery(query).sql);
    const next = queue.shift();
    if (next === undefined) throw new Error("unexpected query");
    return next;
  });
  return { database: { execute, transaction: async (run: (tx: { execute: typeof execute }) => unknown) => run({ execute }) },
    rendered, execute };
}

describe("durable local agent session/handoff repository", () => {
  it("locks an active workspace before inserting an exact 13-catalog-compatible session", async () => {
    const source = database([{ rows: [{ id: workspaceId }] }, { rows: [sessionRow] }]);
    await expect(new DrizzleLocalAgentSessionRepository(source.database as never).register(session))
      .resolves.toBe("inserted");
    expect(source.rendered[0]).toMatch(/from workspaces.*lifecycle_state = 'active'.*for update/s);
    expect(source.rendered[1]).toContain("insert into local_agent_sessions");
  });

  it("does not write a session when the workspace is absent or tombstoning", async () => {
    const source = database([{ rows: [] }]);
    await expect(new DrizzleLocalAgentSessionRepository(source.database as never).register(session))
      .resolves.toBe("conflict");
    expect(source.execute).toHaveBeenCalledTimes(1);
  });

  it("consumes with one conditional update and preserves a typed single-use result", async () => {
    const consumed = { ...handoffRow, consumed_at: new Date((startedAt + 1) * 1000) };
    const source = database([{ rows: [consumed] }]);
    await expect(new DrizzleLocalAgentSessionRepository(source.database as never).consumeHandoff({
      workspaceId, sessionRef: targetSessionRef, handoffRef, at: startedAt + 1,
    })).resolves.toMatchObject({ status: "consumed", record: { consumedAt: startedAt + 1 } });
    expect(source.rendered[0]).toMatch(/update local_agent_handoffs set consumed_at.*target_session_ref.*consumed_at is null.*expires_at >/s);
  });

  it("lists a bounded same-user, same-workspace active set with tenant-leftmost filtering", async () => {
    const source = database([{ rows: [sessionRow] }]);
    await expect(new DrizzleLocalAgentSessionRepository(source.database as never).listActiveSessions({
      workspaceId, userId, at: startedAt, limit: 20,
    })).resolves.toEqual([session]);
    expect(source.rendered[0]).toMatch(/where session\.workspace_id = .* and session\.user_id = .*and session\.expires_at >/s);
    expect(source.rendered[0]).toContain("order by session.last_seen_at desc, session.session_ref asc");
    expect(source.rendered[0]).toContain("limit $4");
  });

  it("fails closed on a corrupt stored tool or context instead of projecting it", async () => {
    const badSession = database([{ rows: [{ ...sessionRow, allowed_tools: ["execute_action"] }] }]);
    await expect(new DrizzleLocalAgentSessionRepository(badSession.database as never).findSession({
      workspaceId, sessionRef,
    })).rejects.toMatchObject({ code: "corrupt_store" });
    const badHandoff = database([{ rows: [{ ...handoffRow, entity_ref: "raw_payload_private" }] }]);
    await expect(new DrizzleLocalAgentSessionRepository(badHandoff.database as never).consumeHandoff({
      workspaceId, sessionRef: targetSessionRef, handoffRef, at: startedAt + 1,
    })).rejects.toMatchObject({ code: "corrupt_store" });
  });

  it("keeps migration ordering, RLS, grants, constraints and tool catalog fail-closed", () => {
    const migration = readFileSync("drizzle/20260807235345_local_agent_session_handoff.sql", "utf8");
    expect(migration.indexOf("local_agent_sessions_workspace_session_unique"))
      .toBeLessThan(migration.indexOf("local_agent_handoffs_workspace_creator_session_fk"));
    expect(migration).toContain("jsonb_array_length(\"local_agent_sessions\".\"allowed_tools\") between 1 and 13");
    for (const tool of ["approval_queue_list", "approval_queue_get", "existing_post_promotion_preflight"])
      expect(migration).toContain(`\"${tool}\"`);
    expect(migration).toContain("last_seen_at\" < \"local_agent_sessions\".\"expires_at");
    for (const table of ["local_agent_sessions", "local_agent_handoffs"]) {
      expect(migration).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      expect(migration).toContain(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`);
      expect(migration).toContain(`REVOKE ALL PRIVILEGES ON TABLE ${table} FROM PUBLIC, anon, authenticated, service_role`);
    }
    expect(migration).not.toMatch(/security definer|create (?:or replace )?function/i);
  });
});
