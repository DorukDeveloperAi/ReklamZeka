import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "@/db/schema";
import { createLocalOperationReadHandler, localDecisionRoomConfig } from "@/server/local-operation-read-runtime";
import { operationReadUnavailable } from "@/server/operation-read-http";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type LocalOperationEnvironment = Readonly<{
  DATABASE_URL: string | undefined;
  REKLAMZEKA_LOCAL_SESSION_ENABLED: string | undefined;
  REKLAMZEKA_LOCAL_ORIGIN: string | undefined;
  REKLAMZEKA_LOCAL_WORKSPACE_ID: string | undefined;
  REKLAMZEKA_LOCAL_WORKSPACE_REF: string | undefined;
  REKLAMZEKA_LOCAL_USER_ID: string | undefined;
  REKLAMZEKA_LOCAL_READER_REF: string | undefined;
  REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY: string | undefined;
}>;

type Database = ReturnType<typeof drizzle<typeof schema>>;
let handler: ReturnType<typeof createLocalOperationReadHandler> | null = null;

/** Do not pass process.env itself: the local boundary intentionally rejects unknown config keys. */
export function localOperationEnvironment(environment: NodeJS.ProcessEnv): LocalOperationEnvironment {
  return {
    DATABASE_URL: environment.DATABASE_URL,
    REKLAMZEKA_LOCAL_SESSION_ENABLED: environment.REKLAMZEKA_LOCAL_SESSION_ENABLED,
    REKLAMZEKA_LOCAL_ORIGIN: environment.REKLAMZEKA_LOCAL_ORIGIN,
    REKLAMZEKA_LOCAL_WORKSPACE_ID: environment.REKLAMZEKA_LOCAL_WORKSPACE_ID,
    REKLAMZEKA_LOCAL_WORKSPACE_REF: environment.REKLAMZEKA_LOCAL_WORKSPACE_REF,
    REKLAMZEKA_LOCAL_USER_ID: environment.REKLAMZEKA_LOCAL_USER_ID,
    REKLAMZEKA_LOCAL_READER_REF: environment.REKLAMZEKA_LOCAL_READER_REF,
    REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY: environment.REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY,
  };
}

export function createOperationReadRouteHandler(input: Readonly<{
  environment: LocalOperationEnvironment;
  database: Database;
}>) {
  try {
    const config = localDecisionRoomConfig(input.environment);
    if (!config || !input.environment.DATABASE_URL) return null;
    return createLocalOperationReadHandler({ database: input.database, config });
  } catch {
    return null;
  }
}

function configuredHandler() {
  if (handler) return handler;
  const environment = localOperationEnvironment(process.env);
  const config = localDecisionRoomConfig(environment);
  if (!config || !environment.DATABASE_URL) return null;
  const pool = new Pool({
    connectionString: environment.DATABASE_URL,
    max: 2,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 10_000,
    idleTimeoutMillis: 30_000,
    allowExitOnIdle: true,
  });
  pool.on("error", () => undefined);
  handler = createLocalOperationReadHandler({ database: drizzle(pool, { schema }), config });
  return handler;
}

export function GET(request: Request) {
  try {
    return configuredHandler()?.(request) ?? operationReadUnavailable();
  } catch {
    return operationReadUnavailable();
  }
}
