import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/db/schema";
import { createLocalBusinessOutcomeReadHandler, createLocalBusinessOutcomeSignalHandler, businessOutcomeSignalNotConfiguredResponse } from "@/server/local-business-outcome-signal-runtime";
import { businessOutcomeReadNotConfiguredResponse } from "@/server/business-outcome-read-http";
import { localDecisionRoomConfig } from "@/server/local-decision-room-runtime";
export const dynamic = "force-dynamic"; export const runtime = "nodejs";
let database: ReturnType<typeof drizzle<typeof schema>> | null = null;
function handlers() { try {
  const environment = { DATABASE_URL: process.env.DATABASE_URL, REKLAMZEKA_LOCAL_SESSION_ENABLED: process.env.REKLAMZEKA_LOCAL_SESSION_ENABLED,
    REKLAMZEKA_LOCAL_ORIGIN: process.env.REKLAMZEKA_LOCAL_ORIGIN, REKLAMZEKA_LOCAL_WORKSPACE_ID: process.env.REKLAMZEKA_LOCAL_WORKSPACE_ID,
    REKLAMZEKA_LOCAL_WORKSPACE_REF: process.env.REKLAMZEKA_LOCAL_WORKSPACE_REF, REKLAMZEKA_LOCAL_USER_ID: process.env.REKLAMZEKA_LOCAL_USER_ID,
    REKLAMZEKA_LOCAL_READER_REF: process.env.REKLAMZEKA_LOCAL_READER_REF, REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY: process.env.REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY };
  const config = localDecisionRoomConfig(environment); if (!config) return null;
  if (!database) { const pool = new Pool({ connectionString: environment.DATABASE_URL, max: 2, connectionTimeoutMillis: 5_000, statement_timeout: 10_000, idleTimeoutMillis: 30_000, allowExitOnIdle: true }); pool.on("error", () => undefined); database = drizzle(pool, { schema }); }
  return Object.freeze({ GET: createLocalBusinessOutcomeReadHandler({ database, config }), POST: createLocalBusinessOutcomeSignalHandler({ database, config }) });
} catch { return null; } }
export function GET(): ReturnType<typeof businessOutcomeReadNotConfiguredResponse>;
export function GET(request: Request): Promise<Response> | Response;
export function GET(request?: Request) { const configured = handlers(); return configured && request ? configured.GET(request) : businessOutcomeReadNotConfiguredResponse(); }
export function POST(): ReturnType<typeof businessOutcomeSignalNotConfiguredResponse>;
export function POST(request: Request): Promise<Response> | Response;
export function POST(request?: Request) { const configured = handlers(); return configured && request ? configured.POST(request) : businessOutcomeSignalNotConfiguredResponse(); }
