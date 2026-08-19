import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/db/schema";
import { createLocalScopeReportSavedHandlers } from "@/server/local-scope-report-saved-runtime";
import { localDecisionRoomConfig } from "@/server/local-decision-room-runtime";
import { scopeReportSavedUnavailable } from "@/server/scope-report-saved-http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
let handlers: ReturnType<typeof createLocalScopeReportSavedHandlers> | null =
  null;
function getHandlers() {
  if (handlers) return handlers;
  const config = localDecisionRoomConfig({
    DATABASE_URL: process.env.DATABASE_URL,
    REKLAMZEKA_LOCAL_SESSION_ENABLED:
      process.env.REKLAMZEKA_LOCAL_SESSION_ENABLED,
    REKLAMZEKA_LOCAL_ORIGIN: process.env.REKLAMZEKA_LOCAL_ORIGIN,
    REKLAMZEKA_LOCAL_WORKSPACE_ID: process.env.REKLAMZEKA_LOCAL_WORKSPACE_ID,
    REKLAMZEKA_LOCAL_WORKSPACE_REF: process.env.REKLAMZEKA_LOCAL_WORKSPACE_REF,
    REKLAMZEKA_LOCAL_USER_ID: process.env.REKLAMZEKA_LOCAL_USER_ID,
    REKLAMZEKA_LOCAL_READER_REF: process.env.REKLAMZEKA_LOCAL_READER_REF,
    REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY:
      process.env.REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY,
  });
  if (!config || !process.env.DATABASE_URL) return null;
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 2,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 10_000,
    idleTimeoutMillis: 30_000,
    allowExitOnIdle: true,
  });
  pool.on("error", () => undefined);
  handlers = createLocalScopeReportSavedHandlers({
    database: drizzle(pool, { schema }),
    config,
  });
  return handlers;
}
export function GET(request: Request) {
  try {
    return getHandlers()?.GET(request) ?? scopeReportSavedUnavailable();
  } catch {
    return scopeReportSavedUnavailable();
  }
}
export function POST(request: Request) {
  try {
    return getHandlers()?.POST(request) ?? scopeReportSavedUnavailable();
  } catch {
    return scopeReportSavedUnavailable();
  }
}
