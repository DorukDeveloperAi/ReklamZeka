import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { and, eq, inArray, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "@/db/schema";
import { LOCAL_SESSION_COOKIE, mintLocalSessionCapability } from "@/security/local-session-capability";
import { localDecisionRoomConfig } from "@/server/local-decision-room-runtime";
import { createLocalAgentCoordinationHandlers } from "@/server/local-agent-session-runtime";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const environment = {
  DATABASE_URL: process.env.DATABASE_URL,
  REKLAMZEKA_LOCAL_SESSION_ENABLED: process.env.REKLAMZEKA_LOCAL_SESSION_ENABLED,
  REKLAMZEKA_LOCAL_ORIGIN: process.env.REKLAMZEKA_LOCAL_ORIGIN,
  REKLAMZEKA_LOCAL_WORKSPACE_ID: process.env.REKLAMZEKA_LOCAL_WORKSPACE_ID,
  REKLAMZEKA_LOCAL_WORKSPACE_REF: process.env.REKLAMZEKA_LOCAL_WORKSPACE_REF,
  REKLAMZEKA_LOCAL_USER_ID: process.env.REKLAMZEKA_LOCAL_USER_ID,
  REKLAMZEKA_LOCAL_READER_REF: process.env.REKLAMZEKA_LOCAL_READER_REF,
  REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY: process.env.REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY,
};
const config = localDecisionRoomConfig(environment);
if (!config || !environment.DATABASE_URL) throw new Error("Local agent HTTP kabul ortamı yapılandırılmadı");
const databaseUrl = process.env.DIRECT_DATABASE_URL?.trim() || environment.DATABASE_URL;
const osUid = typeof process.getuid === "function" ? process.getuid() : -1;
if (osUid < 0) throw new Error("Local OS user binding kullanılamıyor");

const now = Math.floor(Date.now() / 1000);
const dashboardRef = `session_${randomBytes(16).toString("hex")}`;
const cliRef = `session_${randomBytes(16).toString("hex")}`;
const dashboard = mintLocalSessionCapability({ kind: "session", workspaceId: config.workspaceId,
  workspaceRef: config.workspaceRef, userId: config.userId, readerRef: config.readerRef, osUid,
  issuedAt: now - 1, expiresAt: now + 300, sessionRef: dashboardRef }, config.signingKey);
const cli = mintLocalSessionCapability({ kind: "session", workspaceId: config.workspaceId,
  workspaceRef: config.workspaceRef, userId: config.userId, readerRef: config.readerRef, osUid,
  issuedAt: now - 1, expiresAt: now + 300, sessionRef: cliRef }, config.signingKey);
const pool = new Pool({ connectionString: databaseUrl, max: 1,
  connectionTimeoutMillis: 10_000, statement_timeout: 30_000,
  idle_in_transaction_session_timeout: 10_000, keepAlive: true });
pool.on("error", () => undefined);
const database = drizzle(pool, { schema });

const request = (path: string, method: string, intent: string, credential: "cookie" | "bearer",
  token: string, body?: unknown) => {
  const text = body === undefined ? undefined : JSON.stringify(body);
  return new Request(`${config.origin}${path}`, { method, headers: {
    Host: new URL(config.origin).host, "X-ReklamZeka-Intent": intent,
    ...(credential === "cookie" ? { Cookie: `${LOCAL_SESSION_COOKIE}=${encodeURIComponent(token)}`,
      Origin: config.origin, "Sec-Fetch-Site": "same-origin" }
      : { Authorization: `Bearer ${token}`, "Sec-Fetch-Site": "none" }),
    ...(text === undefined ? {} : { "Content-Type": "application/json",
      "Content-Length": String(Buffer.byteLength(text)) }),
  }, body: text });
};
const client = { clientRef: "client_acceptance", transport: "project_stdio",
  allowedTools: ["decision_room_list"] } as const;

let dashboardRegistered = false;
let cliRegistered = false;
let listed = false;
let created = false;
let consumed = false;
let replayRejected = false;
let rollbackClean = false;

try {
  const handlers = createLocalAgentCoordinationHandlers({ database, config });
  dashboardRegistered = (await handlers.sessions.POST(request("/api/local-agent-sessions", "POST",
    "local-agent-session-create", "cookie", dashboard.token, {}))).status === 201;
  cliRegistered = (await handlers.sessions.POST(request("/api/local-agent-sessions", "POST",
    "local-agent-session-register", "bearer", cli.token, client))).status === 201;
  const listResponse = await handlers.sessions.GET(request("/api/local-agent-sessions", "GET",
    "local-agent-sessions-read", "cookie", dashboard.token));
  const list = await listResponse.json() as { sessions?: Array<{ sessionRef?: string }> };
  listed = listResponse.status === 200 && list.sessions?.some((session) => session.sessionRef === cliRef) === true
    && list.sessions.every((session) => session.sessionRef !== dashboardRef);
  const handoffResponse = await handlers.handoffs.POST(request("/api/local-agent-handoffs", "POST",
    "local-agent-handoff-create", "cookie", dashboard.token, { targetSessionRef: cliRef,
      context: { intent: "analysis", entityRef: "portfolio_acceptance", timeframeRef: "timeframe_last_7d",
        contextRef: "context_acceptance", contextVersion: 1, templateRef: null,
        correlationRef: `correlation_${randomBytes(16).toString("hex")}` }, ttlSeconds: 30 }));
  const handoff = await handoffResponse.json() as { handoff?: { handoffRef?: string } };
  created = handoffResponse.status === 201 && typeof handoff.handoff?.handoffRef === "string";
  if (!handoff.handoff?.handoffRef) throw new Error("Handoff ref üretilmedi");
  const consumeBody = { ...client, handoffRef: handoff.handoff.handoffRef };
  consumed = (await handlers.handoffs.PATCH(request("/api/local-agent-handoffs", "PATCH",
    "local-agent-handoff-consume", "bearer", cli.token, consumeBody))).status === 200;
  replayRejected = (await handlers.handoffs.PATCH(request("/api/local-agent-handoffs", "PATCH",
    "local-agent-handoff-consume", "bearer", cli.token, consumeBody))).status === 409;
  if (![dashboardRegistered, cliRegistered, listed, created, consumed, replayRejected].every(Boolean)) {
    throw new Error("Local agent HTTP PostgreSQL kabulü başarısız");
  }
} finally {
  await database.delete(schema.localAgentHandoffs).where(and(
    eq(schema.localAgentHandoffs.workspaceId, config.workspaceId),
    or(inArray(schema.localAgentHandoffs.creatorSessionRef, [dashboardRef, cliRef]),
      inArray(schema.localAgentHandoffs.targetSessionRef, [dashboardRef, cliRef])),
  ));
  await database.delete(schema.localAgentSessions).where(and(eq(schema.localAgentSessions.workspaceId, config.workspaceId),
    inArray(schema.localAgentSessions.sessionRef, [dashboardRef, cliRef])));
  const sessions = await database.select({ ref: schema.localAgentSessions.sessionRef })
    .from(schema.localAgentSessions).where(and(eq(schema.localAgentSessions.workspaceId, config.workspaceId),
      inArray(schema.localAgentSessions.sessionRef, [dashboardRef, cliRef])));
  rollbackClean = sessions.length === 0;
  await pool.end();
}
if (!rollbackClean) throw new Error("Local agent HTTP kabul temizliği başarısız");

console.log(JSON.stringify({ dashboardRegistered, cliRegistered, listed, created, consumed, replayRejected,
  cleanupVerified: rollbackClean, temporaryRowsRetained: false, modelCalls: 0, metaWriteCalls: 0 }));
