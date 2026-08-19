import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/db/schema";
import { createLocalScopeReportHandler } from "@/server/local-scope-report-runtime";
import { localDecisionRoomConfig } from "@/server/local-decision-room-runtime";
import { scopeReportUnavailable } from "@/server/scope-report-http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
let handler: ReturnType<typeof createLocalScopeReportHandler> | null = null;
export function GET(request: Request) {
  try {
    if (handler) return handler(request);
    const config = localDecisionRoomConfig({ DATABASE_URL: process.env.DATABASE_URL, REKLAMZEKA_LOCAL_SESSION_ENABLED: process.env.REKLAMZEKA_LOCAL_SESSION_ENABLED,
      REKLAMZEKA_LOCAL_ORIGIN: process.env.REKLAMZEKA_LOCAL_ORIGIN, REKLAMZEKA_LOCAL_WORKSPACE_ID: process.env.REKLAMZEKA_LOCAL_WORKSPACE_ID,
      REKLAMZEKA_LOCAL_WORKSPACE_REF: process.env.REKLAMZEKA_LOCAL_WORKSPACE_REF, REKLAMZEKA_LOCAL_USER_ID: process.env.REKLAMZEKA_LOCAL_USER_ID,
      REKLAMZEKA_LOCAL_READER_REF: process.env.REKLAMZEKA_LOCAL_READER_REF, REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY: process.env.REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY });
    if (!config || !process.env.DATABASE_URL) return scopeReportUnavailable();
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2, connectionTimeoutMillis: 5_000, statement_timeout: 10_000, idleTimeoutMillis: 30_000, allowExitOnIdle: true });
    pool.on("error", () => undefined);
    handler = createLocalScopeReportHandler({ database: drizzle(pool, { schema }), config });
    return handler(request);
  } catch { return scopeReportUnavailable(); }
}
