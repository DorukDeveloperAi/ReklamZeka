import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "@/db/schema";
import { guideRunManualNotConfiguredResponse } from "@/server/guide-run-manual-http";
import { createLocalGuideRunManualHandler } from "@/server/local-guide-run-manual-runtime";
import { localDecisionRoomConfig } from "@/server/local-decision-room-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 180;

let database: ReturnType<typeof drizzle<typeof schema>> | null = null;

function handler() {
  try {
    const config = localDecisionRoomConfig({
      DATABASE_URL: process.env.DATABASE_URL,
      REKLAMZEKA_LOCAL_SESSION_ENABLED:
        process.env.REKLAMZEKA_LOCAL_SESSION_ENABLED,
      REKLAMZEKA_LOCAL_ORIGIN: process.env.REKLAMZEKA_LOCAL_ORIGIN,
      REKLAMZEKA_LOCAL_WORKSPACE_ID: process.env.REKLAMZEKA_LOCAL_WORKSPACE_ID,
      REKLAMZEKA_LOCAL_WORKSPACE_REF:
        process.env.REKLAMZEKA_LOCAL_WORKSPACE_REF,
      REKLAMZEKA_LOCAL_USER_ID: process.env.REKLAMZEKA_LOCAL_USER_ID,
      REKLAMZEKA_LOCAL_READER_REF: process.env.REKLAMZEKA_LOCAL_READER_REF,
      REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY:
        process.env.REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY,
    });
    if (!config || !process.env.DATABASE_URL) return null;
    if (!database) {
      const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        max: 2,
        connectionTimeoutMillis: 5_000,
        statement_timeout: 30_000,
        idleTimeoutMillis: 30_000,
        allowExitOnIdle: true,
      });
      pool.on("error", () => undefined);
      database = drizzle(pool, { schema });
    }
    return createLocalGuideRunManualHandler({
      database,
      config,
      environment: process.env,
    });
  } catch {
    return null;
  }
}

export function POST(request?: Request) {
  const found = handler();
  return found && request
    ? found(request)
    : guideRunManualNotConfiguredResponse();
}
