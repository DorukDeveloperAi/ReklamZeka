import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/db/schema";
import { decisionRoomNotConfiguredResponse } from "@/server/decision-room-http";
import {
  createLocalDecisionRoomRouteHandlers,
  localDecisionRoomConfig,
} from "@/server/local-decision-room-runtime";
import {
  createLocalDecisionRoomDryRunHandler,
  decisionRoomDryRunNotConfiguredResponse,
  localDecisionRoomDryRunConfig,
} from "@/server/local-decision-room-dry-run-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

let runtimeDatabase: ReturnType<typeof drizzle<typeof schema>> | null = null;

function configuredHandlers() {
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
      REKLAMZEKA_ANALYSIS_SETTLEMENT_POLICY_REF: process.env.REKLAMZEKA_ANALYSIS_SETTLEMENT_POLICY_REF,
      REKLAMZEKA_ANALYSIS_SETTLED_THROUGH_DATE: process.env.REKLAMZEKA_ANALYSIS_SETTLED_THROUGH_DATE,
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
      // Prevent node-postgres from escalating an idle-client error into an
      // unhandled process event; details may contain private infrastructure.
      pool.on("error", () => undefined);
      runtimeDatabase = drizzle(pool, { schema });
    }
    const dryRunConfig = localDecisionRoomDryRunConfig(environment);
    return {
      ...createLocalDecisionRoomRouteHandlers({ database: runtimeDatabase, config }),
      POST: dryRunConfig ? createLocalDecisionRoomDryRunHandler({ database: runtimeDatabase, config: dryRunConfig }) : null,
    };
  } catch {
    return null;
  }
}

// Fail closed unless every local binding is configured and current DB
// membership validates. Demo fixture data is never substituted here.
export function GET(): ReturnType<typeof decisionRoomNotConfiguredResponse>;
export function GET(request: Request): Promise<Response> | Response;
export function GET(request?: Request) {
  const handlers = configuredHandlers();
  return handlers && request ? handlers.GET(request) : decisionRoomNotConfiguredResponse();
}

export function PATCH(): ReturnType<typeof decisionRoomNotConfiguredResponse>;
export function PATCH(request: Request): Promise<Response> | Response;
export function PATCH(request?: Request) {
  const handlers = configuredHandlers();
  return handlers && request ? handlers.PATCH(request) : decisionRoomNotConfiguredResponse();
}

export function POST(): ReturnType<typeof decisionRoomDryRunNotConfiguredResponse>;
export function POST(request: Request): Promise<Response> | Response;
export function POST(request?: Request) {
  const handlers = configuredHandlers();
  return handlers?.POST && request ? handlers.POST(request) : decisionRoomDryRunNotConfiguredResponse();
}
