import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "@/db/schema";
import { localDecisionRoomConfig } from "@/server/local-decision-room-runtime";
import { createLocalManualMetaReadSyncRouteHandler } from "@/server/local-meta-read-sync-runtime";
import { metaReadSyncNotConfiguredResponse } from "@/server/meta-read-sync-manual-http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

let handler: ReturnType<typeof createLocalManualMetaReadSyncRouteHandler> | null = null;
function getHandler() {
  if (handler) return handler;
  try {
    const environment = { DATABASE_URL: process.env.DATABASE_URL,
      REKLAMZEKA_LOCAL_SESSION_ENABLED: process.env.REKLAMZEKA_LOCAL_SESSION_ENABLED,
      REKLAMZEKA_LOCAL_ORIGIN: process.env.REKLAMZEKA_LOCAL_ORIGIN,
      REKLAMZEKA_LOCAL_WORKSPACE_ID: process.env.REKLAMZEKA_LOCAL_WORKSPACE_ID,
      REKLAMZEKA_LOCAL_WORKSPACE_REF: process.env.REKLAMZEKA_LOCAL_WORKSPACE_REF,
      REKLAMZEKA_LOCAL_USER_ID: process.env.REKLAMZEKA_LOCAL_USER_ID,
      REKLAMZEKA_LOCAL_READER_REF: process.env.REKLAMZEKA_LOCAL_READER_REF,
      REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY: process.env.REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY };
    const config = localDecisionRoomConfig(environment); if (!config || !environment.DATABASE_URL) return null;
    const pool = new Pool({ connectionString: environment.DATABASE_URL, max: 1, connectionTimeoutMillis: 5_000,
      statement_timeout: 90_000, idleTimeoutMillis: 30_000, allowExitOnIdle: true });
    pool.on("error", () => undefined);
    handler = createLocalManualMetaReadSyncRouteHandler({ database: drizzle(pool, { schema }), config,
      environment: process.env });
    return handler;
  } catch { return null; }
}
export async function POST(request: Request) {
  const configured = getHandler();
  return configured ? configured(request) : metaReadSyncNotConfiguredResponse();
}
