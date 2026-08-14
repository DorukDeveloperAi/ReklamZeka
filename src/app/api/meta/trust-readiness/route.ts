import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/db/schema";
import { createLocalMetaTrustReadinessRouteHandler, metaTrustReadinessNotConfiguredResponse } from "@/server/local-meta-trust-readiness-runtime";
import { localDecisionRoomConfig } from "@/server/local-decision-room-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
let database: ReturnType<typeof drizzle<typeof schema>> | null = null;

function handler() {
  try {
    const env = { DATABASE_URL: process.env.DATABASE_URL, REKLAMZEKA_LOCAL_SESSION_ENABLED: process.env.REKLAMZEKA_LOCAL_SESSION_ENABLED,
      REKLAMZEKA_LOCAL_ORIGIN: process.env.REKLAMZEKA_LOCAL_ORIGIN, REKLAMZEKA_LOCAL_WORKSPACE_ID: process.env.REKLAMZEKA_LOCAL_WORKSPACE_ID,
      REKLAMZEKA_LOCAL_WORKSPACE_REF: process.env.REKLAMZEKA_LOCAL_WORKSPACE_REF, REKLAMZEKA_LOCAL_USER_ID: process.env.REKLAMZEKA_LOCAL_USER_ID,
      REKLAMZEKA_LOCAL_READER_REF: process.env.REKLAMZEKA_LOCAL_READER_REF, REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY: process.env.REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY };
    const config = localDecisionRoomConfig(env); if (!config) return null;
    if (!database) database = drizzle(new Pool({ connectionString: env.DATABASE_URL, max: 2, connectionTimeoutMillis: 5_000,
      statement_timeout: 10_000, idleTimeoutMillis: 30_000, allowExitOnIdle: true }), { schema });
    return createLocalMetaTrustReadinessRouteHandler({ database, config });
  } catch { return null; }
}
export function GET(): ReturnType<typeof metaTrustReadinessNotConfiguredResponse>;
export function GET(request: Request): Promise<Response> | Response;
export function GET(request?: Request) { const configured = handler(); return configured && request ? configured(request) : metaTrustReadinessNotConfiguredResponse(); }
