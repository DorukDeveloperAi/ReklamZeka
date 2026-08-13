import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/db/schema";
import { createLocalOperationalTimelineHandler } from "@/server/local-operational-timeline-runtime";
import { operationalTimelineNotConfiguredResponse } from "@/server/operational-timeline-http";
import { localDecisionRoomConfig } from "@/server/local-decision-room-runtime";
export const dynamic = "force-dynamic"; export const runtime = "nodejs";
let database: ReturnType<typeof drizzle<typeof schema>> | null = null;
export async function GET(request: Request) { try {
  const config = localDecisionRoomConfig({ DATABASE_URL: process.env.DATABASE_URL, REKLAMZEKA_LOCAL_SESSION_ENABLED: process.env.REKLAMZEKA_LOCAL_SESSION_ENABLED,
    REKLAMZEKA_LOCAL_ORIGIN: process.env.REKLAMZEKA_LOCAL_ORIGIN, REKLAMZEKA_LOCAL_WORKSPACE_ID: process.env.REKLAMZEKA_LOCAL_WORKSPACE_ID,
    REKLAMZEKA_LOCAL_WORKSPACE_REF: process.env.REKLAMZEKA_LOCAL_WORKSPACE_REF, REKLAMZEKA_LOCAL_USER_ID: process.env.REKLAMZEKA_LOCAL_USER_ID,
    REKLAMZEKA_LOCAL_READER_REF: process.env.REKLAMZEKA_LOCAL_READER_REF, REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY: process.env.REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY });
  if (!config) return operationalTimelineNotConfiguredResponse();
  if (!database) database = drizzle(new Pool({ connectionString: process.env.DATABASE_URL, max: 2, connectionTimeoutMillis: 5_000, statement_timeout: 10_000, allowExitOnIdle: true }), { schema });
  return createLocalOperationalTimelineHandler({ database, config })(request);
} catch { return operationalTimelineNotConfiguredResponse(); } }
