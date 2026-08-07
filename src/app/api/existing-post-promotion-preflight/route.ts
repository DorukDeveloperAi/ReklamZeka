import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "@/db/schema";
import { existingPostPromotionPreflightNotConfiguredResponse } from "@/server/existing-post-promotion-preflight-http";
import {
  createLocalExistingPostPromotionCatalogRouteHandler,
  existingPostPromotionCatalogNotConfiguredResponse,
} from "@/server/local-existing-post-promotion-catalog-runtime";
import { localDecisionRoomConfig } from "@/server/local-decision-room-runtime";
import { createLocalExistingPostPromotionPreflightRouteHandler } from "@/server/local-existing-post-promotion-preflight-runtime";
import { createLocalExistingPostPromotionProposalDraftRouteHandler } from "@/server/local-existing-post-promotion-proposal-draft-runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

let runtimeDatabase: ReturnType<typeof drizzle<typeof schema>> | null = null;

function environment() {
  return {
    DATABASE_URL: process.env.DATABASE_URL,
    REKLAMZEKA_LOCAL_SESSION_ENABLED: process.env.REKLAMZEKA_LOCAL_SESSION_ENABLED,
    REKLAMZEKA_LOCAL_ORIGIN: process.env.REKLAMZEKA_LOCAL_ORIGIN,
    REKLAMZEKA_LOCAL_WORKSPACE_ID: process.env.REKLAMZEKA_LOCAL_WORKSPACE_ID,
    REKLAMZEKA_LOCAL_WORKSPACE_REF: process.env.REKLAMZEKA_LOCAL_WORKSPACE_REF,
    REKLAMZEKA_LOCAL_USER_ID: process.env.REKLAMZEKA_LOCAL_USER_ID,
    REKLAMZEKA_LOCAL_READER_REF: process.env.REKLAMZEKA_LOCAL_READER_REF,
    REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY: process.env.REKLAMZEKA_LOCAL_SESSION_SIGNING_KEY,
  };
}

function configuredRuntime() {
  try {
    const values = environment();
    const config = localDecisionRoomConfig(values);
    if (!config) return null;
    if (!runtimeDatabase) {
      const pool = new Pool({ connectionString: values.DATABASE_URL, max: 2,
        connectionTimeoutMillis: 5_000, statement_timeout: 10_000,
        idleTimeoutMillis: 30_000, allowExitOnIdle: true });
      pool.on("error", () => undefined);
      runtimeDatabase = drizzle(pool, { schema });
    }
    return { database: runtimeDatabase, config } as const;
  } catch {
    return null;
  }
}

export function POST(): ReturnType<typeof existingPostPromotionPreflightNotConfiguredResponse>;
export function POST(request: Request): Promise<Response> | Response;
export function POST(request?: Request) {
  const configured = configuredRuntime();
  return configured && request
    ? request.headers.get("x-reklamzeka-intent") === "existing-post-promotion-proposal-draft"
      ? createLocalExistingPostPromotionProposalDraftRouteHandler(configured)(request)
      : createLocalExistingPostPromotionPreflightRouteHandler(configured)(request)
    : existingPostPromotionPreflightNotConfiguredResponse();
}

export function GET(): ReturnType<typeof existingPostPromotionCatalogNotConfiguredResponse>;
export function GET(request: Request): Promise<Response> | Response;
export function GET(request?: Request) {
  const configured = configuredRuntime();
  return configured && request
    ? createLocalExistingPostPromotionCatalogRouteHandler(configured)(request)
    : existingPostPromotionCatalogNotConfiguredResponse();
}
