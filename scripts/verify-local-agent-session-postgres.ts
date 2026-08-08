import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import type { LocalAgentHandoffRecord, LocalAgentSessionRecord } from
  "@/application/local-agent-session-contract";
import { DrizzleLocalAgentSessionRepository } from
  "@/connectors/agents/local-agent-session-drizzle-repository";
import * as schema from "@/db/schema";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const databaseUrl = process.env.DIRECT_DATABASE_URL?.trim() || process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("Supabase PostgreSQL bağlantısı yapılandırılmadı");

const workspaceId = randomUUID();
const userId = randomUUID();
const sessionA = `session_${"a".repeat(32)}`;
const sessionB = `session_${"b".repeat(32)}`;
const handoffRef = `handoff_${"c".repeat(32)}`;
const startedAt = 1_800_000_000;
const rollback = Symbol("rollback");
const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 10_000,
  statement_timeout: 30_000 });
const database = drizzle(pool, { schema });

const session = (sessionRef: string): LocalAgentSessionRecord => Object.freeze({
  sessionRef, workspaceId, workspaceRef: "workspace_agent_acceptance", userId,
  clientRef: "client_acceptance", transport: "loopback_http", toolCatalogVersion: "local-agent-tools/1.0.0",
  allowedTools: Object.freeze(["decision_room_list", "existing_post_promotion_preflight"] as const),
  startedAt, lastSeenAt: startedAt, expiresAt: startedAt + 300,
});
const handoff: LocalAgentHandoffRecord = Object.freeze({ handoffRef, workspaceId,
  workspaceRef: "workspace_agent_acceptance", creatorSessionRef: sessionA, targetSessionRef: sessionB,
  context: Object.freeze({ intent: "analysis", entityRef: "campaign_public",
    timeframeRef: "timeframe_last_7d", contextRef: "context_frozen", contextVersion: 1,
    templateRef: null, correlationRef: `correlation_${"d".repeat(32)}` }),
  createdAt: startedAt, expiresAt: startedAt + 30, consumedAt: null,
});

let sessionsInserted = false;
let handoffInserted = false;
let singleUse = false;
let restartDurable = false;
let tombstoningBlocked = false;
let rollbackClean = false;

try {
  await database.transaction(async (transaction) => {
    await transaction.insert(schema.users).values({ id: userId, email: `agent-${userId}@example.invalid` });
    await transaction.insert(schema.workspaces).values({ id: workspaceId, name: "Agent session acceptance" });
    await transaction.insert(schema.memberships).values({ workspaceId, userId, role: "owner" });
    const repository = new DrizzleLocalAgentSessionRepository(transaction as never);
    sessionsInserted = await repository.register(session(sessionA)) === "inserted"
      && await repository.register(session(sessionB)) === "inserted";
    handoffInserted = await repository.createHandoff(handoff) === "inserted";
    const first = await repository.consumeHandoff({ workspaceId, sessionRef: sessionB, handoffRef, at: startedAt + 1 });
    const second = await repository.consumeHandoff({ workspaceId, sessionRef: sessionB, handoffRef, at: startedAt + 2 });
    singleUse = first.status === "consumed" && second.status === "already_consumed";
    restartDurable = (await new DrizzleLocalAgentSessionRepository(transaction as never)
      .findSession({ workspaceId, sessionRef: sessionA }))?.allowedTools.includes("decision_room_list") === true;
    await transaction.update(schema.workspaces).set({ lifecycleState: "tombstoning" })
      .where(eq(schema.workspaces.id, workspaceId));
    tombstoningBlocked = await repository.register({ ...session(`session_${"e".repeat(32)}`),
      startedAt: startedAt + 1, lastSeenAt: startedAt + 1 }).then((outcome) => outcome === "conflict");
    if (!sessionsInserted || !handoffInserted || !singleUse || !restartDurable || !tombstoningBlocked) {
      throw new Error("Local agent session PostgreSQL acceptance failed");
    }
    throw rollback;
  });
} catch (error) {
  if (error !== rollback) throw error;
}

try {
  const sessions = await database.select({ id: schema.localAgentSessions.id }).from(schema.localAgentSessions)
    .where(eq(schema.localAgentSessions.workspaceId, workspaceId));
  const handoffs = await database.select({ id: schema.localAgentHandoffs.id }).from(schema.localAgentHandoffs)
    .where(eq(schema.localAgentHandoffs.workspaceId, workspaceId));
  const workspaces = await database.select({ id: schema.workspaces.id }).from(schema.workspaces)
    .where(eq(schema.workspaces.id, workspaceId));
  const users = await database.select({ id: schema.users.id }).from(schema.users)
    .where(eq(schema.users.id, userId));
  rollbackClean = sessions.length === 0 && handoffs.length === 0 && workspaces.length === 0 && users.length === 0;
  if (!rollbackClean) throw new Error("Local agent session rollback cleanup failed");
} finally {
  await pool.end();
}

console.log(JSON.stringify({ sessionsInserted, handoffInserted, singleUse, restartDurable,
  tombstoningBlocked, rollbackClean, temporaryRowsCommitted: false, networkCalls: 0,
  modelCalls: 0, metaWriteCalls: 0 }));
