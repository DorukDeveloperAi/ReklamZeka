import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/db/schema";
import { autonomyRuleStudioNotConfiguredResponse } from "@/server/autonomy-rule-studio-http";
import { createLocalAutonomyRuleStudioHandlers } from "@/server/local-autonomy-rule-studio-runtime";
import { localDecisionRoomConfig } from "@/server/local-decision-room-runtime";

export const dynamic = "force-dynamic"; export const runtime = "nodejs";
let database: ReturnType<typeof drizzle<typeof schema>> | null = null;
function handlers() { try {
  const environment = { DATABASE_URL: process.env.DATABASE_URL, REKLAMZEKA_LOCAL_SESSION_ENABLED: process.env.REKLAMZEKA_LOCAL_SESSION_ENABLED,
    REKLAMZEKA_LOCAL_ORIGIN: process.env.REKLAMZEKA_LOCAL_ORIGIN, REKLAMZEKA_LOCAL_WORKSPACE_ID: process.env.REKLAMZEKA_LOCAL_WORKSPACE_ID,
    REKLAMZEKA_LOCAL_WORKSPACE_REF: process.env.REKLAMZEKA_LOCAL_WORKSPACE_REF, REKLAMZEKA_LOCAL_USER_ID: process.env.REKLAMZEKA_LOCAL_USER_ID,
    REKLAMZEKA_LOCAL_READER_REF: process.env.REKLAMZEKA_LOCAL_READER_REF, REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY: process.env.REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY };
  const config = localDecisionRoomConfig(environment); if (!config) return null;
  if (!database) { const pool = new Pool({ connectionString: environment.DATABASE_URL, max: 2, statement_timeout: 10_000, allowExitOnIdle: true }); database = drizzle(pool, { schema }); }
  return createLocalAutonomyRuleStudioHandlers({ database, config });
} catch { return null; } }
export function GET(request?: Request) { const found = handlers(); return found && request ? found.GET(request) : autonomyRuleStudioNotConfiguredResponse(); }
export function POST(request?: Request) { const found = handlers(); return found && request ? found.POST(request) : autonomyRuleStudioNotConfiguredResponse(); }
