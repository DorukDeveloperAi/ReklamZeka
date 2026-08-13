import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/db/schema";
import { createLocalTemporalRecommendationHandlers } from "@/server/local-temporal-recommendation-runtime";
import { localDecisionRoomConfig } from "@/server/local-decision-room-runtime";
import { temporalRecommendationNotConfiguredResponse } from "@/server/temporal-recommendation-http";

export const dynamic = "force-dynamic"; export const runtime = "nodejs";
let database: ReturnType<typeof drizzle<typeof schema>> | null = null;
async function handler(request: Request) { try {
  const config = localDecisionRoomConfig({ DATABASE_URL: process.env.DATABASE_URL, REKLAMZEKA_LOCAL_SESSION_ENABLED: process.env.REKLAMZEKA_LOCAL_SESSION_ENABLED,
    REKLAMZEKA_LOCAL_ORIGIN: process.env.REKLAMZEKA_LOCAL_ORIGIN, REKLAMZEKA_LOCAL_WORKSPACE_ID: process.env.REKLAMZEKA_LOCAL_WORKSPACE_ID,
    REKLAMZEKA_LOCAL_WORKSPACE_REF: process.env.REKLAMZEKA_LOCAL_WORKSPACE_REF, REKLAMZEKA_LOCAL_USER_ID: process.env.REKLAMZEKA_LOCAL_USER_ID,
    REKLAMZEKA_LOCAL_READER_REF: process.env.REKLAMZEKA_LOCAL_READER_REF, REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY: process.env.REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY });
  if (!config) return temporalRecommendationNotConfiguredResponse();
  if (!database) database = drizzle(new Pool({ connectionString: process.env.DATABASE_URL, max: 2, connectionTimeoutMillis: 5_000, statement_timeout: 10_000, allowExitOnIdle: true }), { schema });
  return createLocalTemporalRecommendationHandlers({ database, config })(request);
} catch { return temporalRecommendationNotConfiguredResponse(); } }
export const GET = handler; export const POST = handler;
