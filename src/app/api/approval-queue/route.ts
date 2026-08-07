import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "@/db/schema";
import {
  approvalQueueNotConfiguredResponse,
  createLocalApprovalQueueRouteHandler,
} from "@/server/local-approval-queue-runtime";
import { localDecisionRoomConfig } from "@/server/local-decision-room-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

let runtimeDatabase: ReturnType<typeof drizzle<typeof schema>> | null = null;

function configuredHandler() {
  try {
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
    if (!config) return null;
    if (!runtimeDatabase) {
      const pool = new Pool({
        connectionString: environment.DATABASE_URL,
        max: 2,
        connectionTimeoutMillis: 5_000,
        statement_timeout: 10_000,
        idleTimeoutMillis: 30_000,
        allowExitOnIdle: true,
      });
      pool.on("error", () => undefined);
      runtimeDatabase = drizzle(pool, { schema });
    }
    return createLocalApprovalQueueRouteHandler({ database: runtimeDatabase, config });
  } catch {
    return null;
  }
}

// No POST/PATCH/PUT/DELETE export exists: approval decisions and execution stay closed.
export function GET(): ReturnType<typeof approvalQueueNotConfiguredResponse>;
export function GET(request: Request): Promise<Response> | Response;
export function GET(request?: Request) {
  const handler = configuredHandler();
  return handler && request ? handler(request) : approvalQueueNotConfiguredResponse();
}
